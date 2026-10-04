import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project, RunInfo, RunOutputEvent } from '../src/shared/types'
import type { ResolvedScript } from '../src/main/modules/scripts/detect'

// The real spawnEnv starts a login shell (~2 s with nvm). Tests only need the cleaning behaviour.
vi.mock('../src/main/shell-env', async () => {
  const actual = await vi.importActual<typeof import('../src/main/shell-env')>('../src/main/shell-env')
  return { ...actual, spawnEnv: async (extra: NodeJS.ProcessEnv = {}) => ({ ...actual.cleanChildEnv(process.env), ...extra }) }
})

const {
  ScriptRunner,
  LogBuffer,
  detectPortConflict,
  buildSpawnArgs,
  validateExtraArgs
} = await import('../src/main/modules/scripts/runner')

const project: Project = {
  id: 'p1',
  name: 'demo',
  path: process.cwd(),
  relPath: '',
  kinds: ['node'],
  isMonorepoRoot: false,
  parentId: null,
  hasGit: false
}

function script(name: string, js: string, file = process.execPath): ResolvedScript {
  return {
    def: { id: `p1:package.json:${name}`, projectId: 'p1', name, command: js, source: 'package.json', category: 'dev', needsTty: false },
    spawn: { file, args: file === process.execPath ? ['-e', js] : [], cwd: process.cwd() }
  }
}

function harness() {
  const runs: RunInfo[] = []
  const outputs: RunOutputEvent[] = []
  const runner = new ScriptRunner({ onRun: (i) => runs.push(i), onOutput: (e) => outputs.push(e) })
  const waitFor = async (pred: () => boolean, ms = 8000): Promise<void> => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (pred()) return
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error(`timed out; last run state: ${JSON.stringify(runs.at(-1))}`)
  }
  const last = (id: string): RunInfo | undefined => [...runs].reverse().find((r) => r.runId === id)
  const finished = (id: string) => waitFor(() => !!last(id)?.endedAt)
  return { runner, runs, outputs, waitFor, last, finished }
}

const started: Array<{ stopAll(): void }> = []
afterEach(() => {
  while (started.length) started.pop()!.stopAll()
})
const make = () => {
  const h = harness()
  started.push(h.runner)
  return h
}

describe('LogBuffer', () => {
  it('drops the oldest output past the cap but keeps the newest', () => {
    const b = new LogBuffer(10)
    b.push('aaaa')
    b.push('bbbb')
    b.push('cccc')
    expect(b.toString()).toBe('bbbbcccc')
  })
})

describe('helpers', () => {
  it.each([
    ['Error: listen EADDRINUSE: address already in use :::3000', 3000],
    ['Error: listen EADDRINUSE 127.0.0.1:8080', 8080],
    ['OSError: [Errno 48] Address already in use: 127.0.0.1:8000', 8000],
    ['Port 5173 is in use, trying another one...', 5173],
    ['port 4000 is already in use', 4000]
  ])('detects the port conflict in %j', (text, port) => {
    expect(detectPortConflict(text)).toBe(port)
  })

  it('ignores unrelated output', () => {
    expect(detectPortConflict('ready on http://localhost:3000')).toBeUndefined()
  })

  it('puts "--" before extra args only for npm', () => {
    expect(buildSpawnArgs({ file: 'npm', args: ['run', 'dev'], cwd: '/', argsSeparator: '--' }, ['--port', '4000'])).toEqual(['run', 'dev', '--', '--port', '4000'])
    expect(buildSpawnArgs({ file: 'pnpm', args: ['run', 'dev'], cwd: '/' }, ['--port', '4000'])).toEqual(['run', 'dev', '--port', '4000'])
    expect(buildSpawnArgs({ file: 'pnpm', args: ['run', 'dev'], cwd: '/' }, [])).toEqual(['run', 'dev'])
  })

  it('validates extra args', () => {
    expect(validateExtraArgs(undefined)).toEqual([])
    expect(validateExtraArgs(['--watch'])).toEqual(['--watch'])
    expect(() => validateExtraArgs('rm -rf /')).toThrow()
    expect(() => validateExtraArgs(['a\0b'])).toThrow()
    expect(() => validateExtraArgs(new Array(21).fill('x'))).toThrow()
  })
})

describe('ScriptRunner (real processes)', () => {
  it('runs a script, streams output with exact offsets, and reports a clean exit', async () => {
    const h = make()
    const info = await h.runner.start(script('hello', "console.log('hello'); console.error('oops'); setTimeout(()=>{},50)"), project, 'demo', [])
    expect(info.status).toBe('running')
    await h.finished(info.runId)

    expect(h.last(info.runId)).toMatchObject({ status: 'exited', exitCode: 0 })
    const log = h.runner.log(info.runId)
    expect(log.text).toContain('hello')
    expect(log.text).toContain('oops')
    // chunk offsets reassemble the exact log
    const rebuilt = h.outputs
      .filter((o) => o.runId === info.runId)
      .sort((a, b) => a.offset - b.offset)
      .reduce((acc, o) => (o.offset === acc.length ? acc + o.chunk : acc), '')
    expect(rebuilt).toBe(log.text)
    expect(log.length).toBe(log.text.length)
  })

  it('marks a non-zero exit as failed', async () => {
    const h = make()
    const info = await h.runner.start(script('boom', 'process.exit(3)'), project, 'demo', [])
    await h.finished(info.runId)
    expect(h.last(info.runId)).toMatchObject({ status: 'failed', exitCode: 3 })
  })

  it('reports a missing executable instead of crashing', async () => {
    const h = make()
    const info = await h.runner.start(script('nope', '', 'definitely-not-a-real-command-xyz'), project, 'demo', [])
    await h.finished(info.runId)
    expect(h.last(info.runId)!.status).toBe('failed')
    expect(h.runner.log(info.runId).text).toMatch(/was not found/)
  })

  it('returns the existing run instead of starting the same script twice', async () => {
    const h = make()
    const s = script('server', 'setInterval(()=>{},1000)')
    const a = await h.runner.start(s, project, 'demo', [])
    const b = await h.runner.start(s, project, 'demo', [])
    expect(b.runId).toBe(a.runId)
    expect(h.runner.list().filter((r) => r.status === 'running')).toHaveLength(1)
  })

  it('Stop terminates the whole process group, including grandchildren', async () => {
    const h = make()
    // parent spawns a grandchild in the SAME group and prints its pid
    const js = `
      const { spawn } = require('child_process');
      const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      console.log('GRANDCHILD=' + g.pid);
      setInterval(()=>{},1000);`
    const info = await h.runner.start(script('tree', js), project, 'demo', [])
    await h.waitFor(() => /GRANDCHILD=\d+/.test(h.runner.log(info.runId).text))
    const grandchild = Number(h.runner.log(info.runId).text.match(/GRANDCHILD=(\d+)/)![1])
    expect(() => process.kill(grandchild, 0)).not.toThrow() // alive

    h.runner.stop(info.runId)
    await h.finished(info.runId)

    expect(h.last(info.runId)!.status).toBe('stopped')
    await h.waitFor(() => {
      try {
        process.kill(grandchild, 0)
        return false
      } catch {
        return true // ESRCH: gone
      }
    }, 3000)
  })

  it('does not leak Cairix runtime variables into scripts', async () => {
    const h = make()
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    process.env.npm_config_user_agent = 'pnpm/10'
    process.env.PNPM_SCRIPT_SRC_DIR = '/x'
    try {
      const info = await h.runner.start(
        script('env', "console.log(JSON.stringify({u:process.env.ELECTRON_RENDERER_URL,n:process.env.npm_config_user_agent,p:process.env.PNPM_SCRIPT_SRC_DIR,f:process.env.FORCE_COLOR,b:process.env.BROWSER}))"),
        project,
        'demo',
        []
      )
      await h.finished(info.runId)
      const line = h.runner.log(info.runId).text.split('\n').find((l) => l.startsWith('{'))!
      expect(JSON.parse(line)).toEqual({ f: '1', b: 'none' }) // others undefined => omitted by JSON
    } finally {
      delete process.env.ELECTRON_RENDERER_URL
      delete process.env.npm_config_user_agent
      delete process.env.PNPM_SCRIPT_SRC_DIR
    }
  })

  it('keeps stdin open so tools that quit on EOF (Create React App) stay alive', async () => {
    const h = make()
    const info = await h.runner.start(
      script('stdin', "process.stdin.on('end',()=>{console.log('STDIN_EOF');process.exit(0)}); process.stdin.resume(); setTimeout(()=>{console.log('STILL_ALIVE');process.exit(0)},400)"),
      project,
      'demo',
      []
    )
    await h.finished(info.runId)
    // The first log line echoes the command (which mentions STDIN_EOF), so match printed lines only.
    const lines = h.runner.log(info.runId).text.split(/\r?\n/)
    expect(lines).toContain('STILL_ALIVE')
    expect(lines).not.toContain('STDIN_EOF')
  })

  it('surfaces a port conflict from the output', async () => {
    const h = make()
    const info = await h.runner.start(
      script('busy', "console.error('Error: listen EADDRINUSE: address already in use :::3000'); process.exit(1)"),
      project,
      'demo',
      []
    )
    await h.finished(info.runId)
    expect(h.last(info.runId)!.portConflict).toBe(3000)
  })

  it('records the ports a run owns and notifies only on change', async () => {
    const h = make()
    const info = await h.runner.start(script('srv', 'setInterval(()=>{},1000)'), project, 'demo', [])
    const before = h.runs.length
    h.runner.setPorts(info.runId, [3000, 3001])
    h.runner.setPorts(info.runId, [3001, 3000]) // same set, different order
    expect(h.runs.length).toBe(before + 1)
    expect(h.last(info.runId)!.ports).toEqual([3000, 3001])
    expect(h.runner.activePids().get(info.pid)).toBe(info.runId)
  })
})
