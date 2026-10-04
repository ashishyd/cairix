import { describe, expect, it, vi } from 'vitest'
import {
  buildTree,
  CwdCache,
  footprintRoot,
  scanPorts,
  subtreePostOrder,
  type RunCommand,
  type ScanDeps
} from '../src/main/modules/ports/scanner'
import { planKill, terminateTree, type TerminateDeps } from '../src/main/modules/ports/kill'
import { parsePs } from '../src/main/modules/ports/parse'

// A realistic slice of a dev machine: launchd, macOS services, a terminal with a
// pnpm → sh → node → next-server chain, a python http.server, and Cairix itself.
const PS = [
  '    1     0     1   9000  0.1 23-04:00:01 /sbin/launchd',
  '  625     1   625   7000  0.0 23-03:59:59 /usr/libexec/rapportd',
  '  666     1   666  40000  0.0 23-03:59:58 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter',
  '  700     1   700   5000  0.0 02:20:00 -zsh',
  ' 7001   700  7001  30000  0.0 02:14:09 node /usr/local/lib/pnpm.cjs run dev',
  ' 7002  7001  7001  15000  0.0 02:14:08 sh -c next dev',
  ' 7003  7002  7001 120000  1.0 02:14:08 node /Users/x/viblix/node_modules/.bin/../next/dist/bin/next dev',
  ' 7004  7003  7001 300000  5.5 02:14:06 next-server (v15.0.0)',
  ' 8000   700  8000  20000  0.0       05:00 /opt/homebrew/bin/python3 -m http.server 8765',
  '  100     1   100  80000  3.0 01:00:00 /Applications/Cairix.app/Contents/MacOS/Cairix',
  '  101   100   100  40000  0.0 01:00:00 /Applications/Cairix.app/Contents/Frameworks/Helper',
  ' 9000     1  9000  10000  0.0 03:00:00 /usr/sbin/sshd -D'
].join('\n')

const LSOF = [
  'p625', 'crapportd', 'Lashish', 'f1', 'n*:49152',
  'p666', 'cControlCenter', 'Lashish', 'f1', 'n*:7000', 'f2', 'n*:5000',
  'p7004', 'cnext-server\\x20(v15.0.0)', 'Lashish', 'f1', 'n*:3000', 'f2', 'n[::1]:3000',
  'p8000', 'cPython', 'Lashish', 'f1', 'n127.0.0.1:8765',
  'p100', 'cCairix', 'Lashish', 'f1', 'n127.0.0.1:5173',
  'p9000', 'csshd', 'Lroot', 'f1', 'n*:22'
].join('\n')

const CWD = ['p7004', 'fcwd', 'n/Users/x/viblix/apps/web', 'p8000', 'fcwd', 'n/Users/x/scratch'].join('\n')

function fakeRun(overrides: Partial<Record<string, string | Error>> = {}): RunCommand & { calls: string[][] } {
  const calls: string[][] = []
  const fn = (async (file: string, args: string[]) => {
    calls.push([file, ...args])
    const key = file === 'lsof' ? (args.includes('cwd') ? 'cwd' : 'listen') : 'ps'
    const out = overrides[key] ?? { listen: LSOF, ps: PS, cwd: CWD }[key]
    if (out instanceof Error) throw out
    return out as string
  }) as RunCommand & { calls: string[][] }
  fn.calls = calls
  return fn
}

const deps = (run: RunCommand, extra: Partial<ScanDeps> = {}): ScanDeps => ({
  run,
  currentUser: 'ashish',
  selfPid: 101, // a Cairix helper; its ancestors (100) are Cairix too
  resolveProject: (cwd) => (cwd.startsWith('/Users/x/viblix/apps/web') ? { id: 'p1', name: 'viblix/web' } : undefined),
  ...extra
})

describe('footprintRoot', () => {
  const { byPid, children } = buildTree(parsePs(PS))
  it('climbs launcher wrappers in the same process group but stops at the terminal shell', () => {
    expect(footprintRoot(7004, byPid, children)).toBe(7001) // next-server ← node ← sh ← pnpm; zsh (700) is a different group
  })
  it('does not climb out of a lone process', () => {
    expect(footprintRoot(8000, byPid, children)).toBe(8000)
    expect(footprintRoot(666, byPid, children)).toBe(666)
  })

  it('does not climb into a shared wrapper: one row must not own the whole turbo stack', () => {
    // pnpm dev -> turbo -> [ sh -> node web (3000),  sh -> node api (3001) ]
    const turbo = parsePs(
      [
        ' 10  1  10  30000 0.0 01:00 node /x/pnpm.cjs dev',
        ' 11 10  10  50000 0.0 01:00 node /x/turbo run dev',
        ' 12 11  10  10000 0.0 01:00 sh -c next dev',
        ' 13 12  10 200000 1.0 01:00 node /x/next/dist/bin/next dev',
        ' 14 11  10  10000 0.0 01:00 sh -c node api.js',
        ' 15 14  10 100000 1.0 01:00 node api.js'
      ].join('\n')
    )
    const t = buildTree(turbo)
    expect(footprintRoot(13, t.byPid, t.children)).toBe(12) // stops below turbo (2 children)
    expect(footprintRoot(15, t.byPid, t.children)).toBe(14)
    // killing the web server leaves api and turbo alone
    expect(subtreePostOrder(12, t.children)).toEqual([13, 12])
  })
})

describe('scanPorts', () => {
  it('builds entries with memory footprint, project and category', async () => {
    const { snapshot } = await scanPorts(deps(fakeRun()), new CwdCache())
    const next = snapshot.entries.find((e) => e.port === 3000)!
    expect(next).toMatchObject({
      pid: 7004,
      name: 'next-server (v15.0.0)',
      framework: 'Next.js',
      category: 'dev',
      exposed: true,
      footprintPid: 7001,
      treeRssKb: 30000 + 15000 + 120000 + 300000,
      rssKb: 300000,
      projectId: 'p1',
      projectName: 'viblix/web',
      uptimeSec: 8046,
      protected: false
    })
    expect(next.cpu).toBeCloseTo(6.5, 1)
  })

  it('lists one row per port even when a process listens on several', async () => {
    const { snapshot } = await scanPorts(deps(fakeRun()), new CwdCache())
    expect(snapshot.entries.map((e) => e.port)).toEqual([22, 3000, 5000, 5173, 7000, 8765, 49152])
  })

  it('protects macOS services, explains AirPlay, and protects Cairix and other users', async () => {
    const { snapshot } = await scanPorts(deps(fakeRun()), new CwdCache())
    const by = (port: number) => snapshot.entries.find((e) => e.port === port)!
    expect(by(7000)).toMatchObject({ protected: true, category: 'system' })
    expect(by(7000).hint).toMatch(/AirPlay/)
    expect(by(49152).protected).toBe(true)
    expect(by(5173)).toMatchObject({ protected: true, protectReason: 'This is Cairix itself' })
    expect(by(22).protected).toBe(true) // root-owned
    expect(by(8765)).toMatchObject({ protected: false, framework: 'Python http.server', exposed: false })
  })

  it('totals dev memory once per footprint, excluding protected processes', async () => {
    const { snapshot } = await scanPorts(deps(fakeRun()), new CwdCache())
    // next (465000, listening on one port) + python (20000)
    expect(snapshot.devRssKb).toBe(465000 + 20000)
  })

  it('counts a footprint once even if it serves two ports', async () => {
    const lsof = LSOF.replace('p8000', 'p7004\ncnext-server\nLashish\nf9\nn*:3001\np8000')
    const { snapshot } = await scanPorts(deps(fakeRun({ listen: lsof })), new CwdCache())
    expect(snapshot.entries.filter((e) => e.footprintPid === 7001)).toHaveLength(2)
    expect(snapshot.devRssKb).toBe(465000 + 20000)
  })

  it('never exposes credentials from a process command line', async () => {
    const secretPs = PS.replace(
      '/opt/homebrew/bin/python3 -m http.server 8765',
      '/opt/homebrew/bin/python3 -m http.server 8765 --api-key sk-abcdef0123456789abcdef TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123'
    )
    const { snapshot } = await scanPorts(deps(fakeRun({ ps: secretPs })), new CwdCache())
    const e = snapshot.entries.find((x) => x.port === 8765)!
    expect(e.framework).toBe('Python http.server') // still classified from the raw command
    expect(JSON.stringify(snapshot)).not.toMatch(/sk-abcdef|ghp_abcdef/)
    expect(e.cmdline).toContain('--api-key')
  })

  it('links a listener to the Cairix run that started it', async () => {
    const { snapshot } = await scanPorts(
      deps(fakeRun(), { runForAncestors: (chain) => (chain.includes(7001) ? 'run-1' : undefined) }),
      new CwdCache()
    )
    expect(snapshot.entries.find((e) => e.port === 3000)!.runId).toBe('run-1')
    expect(snapshot.entries.find((e) => e.port === 8765)!.runId).toBeUndefined()
  })

  it('caches cwd lookups and only asks lsof about new pids', async () => {
    const run = fakeRun()
    const cache = new CwdCache()
    await scanPorts(deps(run), cache)
    await scanPorts(deps(run), cache)
    expect(run.calls.filter((c) => c.includes('cwd'))).toHaveLength(1)
  })

  it('degrades to an empty snapshot with an error when lsof/ps fail', async () => {
    const { snapshot } = await scanPorts(deps(fakeRun({ listen: new Error('lsof: not found') })), new CwdCache())
    expect(snapshot.entries).toEqual([])
    expect(snapshot.error).toMatch(/lsof/)
  })

  it('still works when the cwd lookup fails', async () => {
    const { snapshot } = await scanPorts(deps(fakeRun({ cwd: new Error('denied') })), new CwdCache())
    expect(snapshot.entries.find((e) => e.port === 3000)!.projectId).toBeUndefined()
  })
})

describe('planKill', () => {
  it('targets the whole footprint, children first', async () => {
    const { snapshot, byPid, children, selfPids } = await scanPorts(deps(fakeRun()), new CwdCache())
    const entry = snapshot.entries.find((e) => e.port === 3000)
    expect(planKill(entry, children, byPid, selfPids)).toEqual({ ok: true, targets: [7004, 7003, 7002, 7001] })
  })

  it('refuses protected entries, with the reason', async () => {
    const { snapshot, byPid, children, selfPids } = await scanPorts(deps(fakeRun()), new CwdCache())
    const plan = planKill(snapshot.entries.find((e) => e.port === 7000), children, byPid, selfPids)
    expect(plan).toEqual({ ok: false, error: 'Part of macOS' })
  })

  it('refuses when the entry is gone', async () => {
    const { byPid, children, selfPids } = await scanPorts(deps(fakeRun()), new CwdCache())
    expect(planKill(undefined, children, byPid, selfPids)).toMatchObject({ ok: false })
  })

  it('refuses a tree that includes Cairix even if the entry itself looks unprotected', async () => {
    const { snapshot, byPid, children } = await scanPorts(deps(fakeRun()), new CwdCache())
    const forged = { ...snapshot.entries.find((e) => e.port === 8765)!, protected: false }
    const plan = planKill(forged, children, byPid, new Set([8000]))
    expect(plan).toMatchObject({ ok: false, error: expect.stringMatching(/Cairix/) })
  })

  it('never plans pid 1', async () => {
    const { snapshot, byPid, children, selfPids } = await scanPorts(deps(fakeRun()), new CwdCache())
    const forged = { ...snapshot.entries.find((e) => e.port === 8765)!, protected: false, footprintPid: 1 }
    expect(planKill(forged, children, byPid, selfPids)).toMatchObject({ ok: false })
  })
})

describe('terminateTree', () => {
  function fakeProcs(behaviour: Record<number, 'dies' | 'stubborn' | 'gone' | 'eperm'>) {
    const alive = new Set(Object.entries(behaviour).filter(([, b]) => b !== 'gone').map(([p]) => +p))
    let t = 0
    const sent: Array<[number, string | number]> = []
    const d: TerminateDeps = {
      signal: (pid, sig) => {
        sent.push([pid, sig])
        const b = behaviour[pid]
        if (b === 'gone' || !alive.has(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
        if (b === 'eperm' && sig !== 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
        if (sig === 'SIGTERM' && b === 'dies') alive.delete(pid)
        if (sig === 'SIGKILL') alive.delete(pid)
      },
      sleep: async (ms) => {
        t += ms
      },
      now: () => t
    }
    return { d, sent }
  }

  it('signals leaves first and reports success when everything exits', async () => {
    const { d, sent } = fakeProcs({ 3: 'dies', 2: 'dies', 1: 'dies' })
    const r = await terminateTree([3, 2, 1], false, d)
    expect(r).toMatchObject({ ok: true, signal: 'SIGTERM', signalled: [3, 2, 1], stillAlive: [] })
    expect(sent.filter(([, s]) => s === 'SIGTERM').map(([p]) => p)).toEqual([3, 2, 1])
  })

  it('reports stubborn processes so the UI can offer a force kill', async () => {
    const { d } = fakeProcs({ 2: 'dies', 1: 'stubborn' })
    const r = await terminateTree([2, 1], false, d)
    expect(r).toMatchObject({ ok: false, stillAlive: [1] })
  })

  it('force kill uses SIGKILL and succeeds', async () => {
    const { d } = fakeProcs({ 1: 'stubborn' })
    const r = await terminateTree([1], true, d)
    expect(r).toMatchObject({ ok: true, signal: 'SIGKILL', stillAlive: [] })
  })

  it('treats already-exited processes as success and surfaces permission errors', async () => {
    expect((await terminateTree([5], false, fakeProcs({ 5: 'gone' }).d)).ok).toBe(true)
    const denied = await terminateTree([6], false, fakeProcs({ 6: 'eperm' }).d)
    expect(denied.ok).toBe(false)
    expect(denied.error).toMatch(/Permission denied/)
  })

  it('does not spin forever on a process that never dies', async () => {
    const spy = vi.fn()
    const { d } = fakeProcs({ 1: 'stubborn' })
    const r = await terminateTree([1], false, { ...d, sleep: async (ms) => (spy(ms), d.sleep(ms)) })
    expect(r.stillAlive).toEqual([1])
    expect(spy.mock.calls.length).toBeLessThanOrEqual(31) // 3 s / 100 ms
  })
})
