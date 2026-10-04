import { spawn } from 'child_process'
import { createConnection, createServer } from 'net'
import { userInfo } from 'os'
import { describe, expect, it } from 'vitest'
import { planKill, terminateTree } from '../../src/main/modules/ports/kill'
import { runCommand } from '../../src/main/modules/ports/exec'
import { CwdCache, scanPorts } from '../../src/main/modules/ports/scanner'

/**
 * Opt-in smoke tests against the REAL operating system:
 *   CAIRIX_LIVE=1 pnpm test
 * They start a throw-away `python3 -m http.server`, find it with the real
 * lsof/ps pipeline, kill it with the real kill path, and check the port is
 * actually freed. Everything is cleaned up even if an assertion fails.
 */

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const c = createConnection({ port, host: '127.0.0.1' })
    c.once('connect', () => (c.destroy(), resolve(true)))
    c.once('error', () => resolve(false))
  })
}

async function waitFor(cond: () => Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('timed out waiting for condition')
}

const deps = { run: runCommand, currentUser: userInfo().username, selfPid: process.pid }

describe.skipIf(!process.env.CAIRIX_LIVE)('ports (live, real OS)', () => {
  it('finds a real dev server, kills it, and frees the port', async () => {
    const port = await freePort()
    const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true
    })
    let childLog = ''
    child.stderr!.on('data', (d) => (childLog += String(d)))
    child.on('error', (e) => (childLog += `spawn error: ${e.message}\n`))
    child.on('exit', (code, sig) => (childLog += `exited code=${code} signal=${sig}\n`))
    try {
      await waitFor(() => canConnect(port)).catch((e) => {
        throw new Error(`${e.message}. python3 said: ${childLog || '(nothing)'}`)
      })

      const scan = await scanPorts(deps, new CwdCache())
      const entry = scan.snapshot.entries.find((e) => e.port === port)
      expect(entry, 'scanner should see the new listener').toBeDefined()
      expect(entry).toMatchObject({
        pid: child.pid,
        framework: 'Python http.server',
        category: 'dev',
        exposed: false, // bound to loopback only
        protected: false,
        user: deps.currentUser
      })
      expect(entry!.rssKb).toBeGreaterThan(1000)
      expect(entry!.uptimeSec).toBeLessThan(30)
      expect(entry!.cwd).toBeTruthy()

      const plan = planKill(entry, scan.children, scan.byPid, scan.selfPids)
      expect(plan.ok).toBe(true)
      if (!plan.ok) return
      expect(plan.targets).toContain(child.pid)
      expect(plan.targets).not.toContain(process.pid) // never the test runner

      const result = await terminateTree(plan.targets, false)
      expect(result).toMatchObject({ ok: true, signal: 'SIGTERM', stillAlive: [] })
      await waitFor(async () => !(await canConnect(port)), 3000)

      const after = await scanPorts(deps, new CwdCache())
      expect(after.snapshot.entries.some((e) => e.port === port)).toBe(false)
    } finally {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }, 30_000)

  it('scans the real machine quickly and never offers to kill macOS services', async () => {
    const t = Date.now()
    const { snapshot, byPid } = await scanPorts(deps, new CwdCache())
    expect(Date.now() - t).toBeLessThan(2000)
    expect(snapshot.error).toBeUndefined()
    expect(byPid.size).toBeGreaterThan(50)
    for (const e of snapshot.entries) {
      expect(e.port).toBeGreaterThan(0)
      if (e.cmdline.startsWith('/System/') || e.cmdline.startsWith('/usr/libexec/')) {
        expect(e.protected, `${e.name}:${e.port} is part of macOS`).toBe(true)
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      snapshot.entries
        .map((e) => `${String(e.port).padStart(5)}  ${e.name.slice(0, 22).padEnd(22)} ${e.category.padEnd(8)} ${e.protected ? 'PROTECTED' : ''}`)
        .join('\n')
    )
  })
})
