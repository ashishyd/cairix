import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ScriptConfigStore, validateConfig } from '../src/main/modules/scripts/config'
import { DEBOUNCE_MS, GRACE_MS, isIgnoredPath, LOOP_WINDOW_MS, MAX_RESTARTS, RunWatcher, type RunWatcherDeps } from '../src/main/modules/scripts/watcher'
import { formatEnvLines, parseArgs, parseEnvLines } from '../src/shared/args'
import type { RunInfo, ScriptConfig } from '../src/shared/types'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-cfg-')))
  dirs.push(d)
  return d
}
const cfg = (over: Partial<ScriptConfig> = {}): ScriptConfig => ({ args: '', env: {}, watch: false, ...over })

describe('KEY=value lines and arguments', () => {
  it('parses env lines, skipping blanks and comments and unquoting', () => {
    expect(parseEnvLines('PORT=4000\n\n# note\nexport A="x y"\nB=\'q\'\nC=a=b\n')).toEqual({ PORT: '4000', A: 'x y', B: 'q', C: 'a=b' })
  })
  it('names the line that is wrong', () => {
    expect(() => parseEnvLines('A=1\noops\n')).toThrow('Line 2')
    expect(() => parseEnvLines('=x')).toThrow('Line 1')
  })
  it('round-trips through format', () => {
    expect(parseEnvLines(formatEnvLines({ A: '1', B: 'two words' }))).toEqual({ A: '1', B: 'two words' })
  })
  it('splits arguments with quotes', () => {
    expect(parseArgs(`--port 4000 --name 'my app'`)).toEqual(['--port', '4000', '--name', 'my app'])
  })
})

describe('validating a saved config', () => {
  it('accepts normal arguments and variables', () => {
    expect(validateConfig(cfg({ args: ' --port 4000 ', env: { PORT: '4000', _X1: 'y' } }))).toEqual({ args: '--port 4000', env: { PORT: '4000', _X1: 'y' }, watch: false })
  })
  it('refuses names that are not variables, and ones that load foreign code', () => {
    expect(() => validateConfig(cfg({ env: { 'A B': '1' } }))).toThrow(/not a valid variable name/)
    expect(() => validateConfig(cfg({ env: { DYLD_INSERT_LIBRARIES: '/x.dylib' } }))).toThrow(/loads other code/)
    expect(() => validateConfig(cfg({ env: { LD_PRELOAD: '/x.so' } }))).toThrow(/loads other code/)
    expect(() => validateConfig(cfg({ env: { NODE_OPTIONS: '--require /tmp/evil.js' } }))).toThrow(/NODE_OPTIONS/)
    expect(() => validateConfig(cfg({ env: { NODE_OPTIONS: '--import=x' } }))).toThrow(/NODE_OPTIONS/)
    expect(validateConfig(cfg({ env: { NODE_OPTIONS: '--max-old-space-size=4096' } })).env.NODE_OPTIONS).toBe('--max-old-space-size=4096')
  })
  it('limits size', () => {
    expect(() => validateConfig(cfg({ env: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`K${i}`, '1'])) }))).toThrow(/At most 50/)
    expect(() => validateConfig(cfg({ env: { A: 'x'.repeat(4001) } }))).toThrow()
  })
})

describe('the config store', () => {
  it('saves across restarts and tells listeners', () => {
    const dir = tmp()
    const seen: number[] = []
    const s = new ScriptConfigStore(dir, (c) => seen.push(Object.keys(c).length))
    s.set('p:dev', cfg({ args: '--port 1', env: { A: '1' }, watch: true }))
    expect(new ScriptConfigStore(dir).get('p:dev')).toEqual({ args: '--port 1', env: { A: '1' }, watch: true })
    expect(seen).toEqual([1])
  })
  it('drops a config with nothing set, and one set to null', () => {
    const s = new ScriptConfigStore(tmp())
    s.set('a', cfg({ watch: true }))
    s.set('a', cfg())
    expect(s.get('a')).toBeUndefined()
    s.set('b', cfg({ args: 'x' }))
    s.set('b', null)
    expect(s.all()).toEqual({})
  })
  it('does not save an invalid config', () => {
    const s = new ScriptConfigStore(tmp())
    expect(() => s.set('a', cfg({ env: { LD_PRELOAD: 'x' } }))).toThrow()
    expect(s.all()).toEqual({})
  })
  it('starts empty from a corrupt file', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'script-configs.json'), '{nope')
    expect(new ScriptConfigStore(dir).all()).toEqual({})
    expect(readFileSync(join(dir, 'script-configs.json'), 'utf8')).toBe('{nope')
  })
})

describe('which changes are ignored', () => {
  it('ignores dependency folders, build output, caches, logs and editor files', () => {
    for (const p of ['node_modules/x/index.js', 'src/node_modules/y.js', '.git/HEAD', 'dist/app.js', '.next/cache/a', 'app.log', 'a.swp', '.DS_Store', 'src/.#lock', '__pycache__/m.pyc', 'build', '']) expect(isIgnoredPath(p), p).toBe(true)
  })
  it('keeps real source changes', () => {
    for (const p of ['src/index.ts', 'package.json', 'server.js', 'app/models/user.rb', '.env', 'docs/readme.md']) expect(isIgnoredPath(p), p).toBe(false)
  })
})

const run = (over: Partial<RunInfo> = {}): RunInfo => ({
  runId: 'r1', scriptId: 'p1:dev', projectId: 'p1', projectName: 'web', scriptName: 'dev', command: 'pnpm dev', pid: 1, startedAt: 0, status: 'running', ports: [], ...over
})

function fakeWatcher(opts: { enabled?: boolean; folder?: string | undefined } = {}) {
  let t = 0
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = []
  const emit: Array<(rel: string) => void> = []
  const closed: number[] = []
  const restarts: string[] = []
  const loops: string[] = []
  const state = { enabled: opts.enabled ?? true, watchThrows: false }
  const deps: RunWatcherDeps = {
    folderOf: () => ('folder' in opts ? opts.folder : '/proj'),
    enabled: () => state.enabled,
    watch: (_d, cb) => {
      if (state.watchThrows) throw new Error('EMFILE')
      emit.push(cb)
      const i = emit.length - 1
      return { close: () => void closed.push(i) }
    },
    restart: async (i) => void restarts.push(i.runId),
    onLoop: (i) => void loops.push(i.runId),
    now: () => t,
    setTimer: (fn, ms) => { const e = { at: t + ms, fn, live: true }; timers.push(e); return e },
    clearTimer: (h) => void ((h as { live: boolean }).live = false)
  }
  const w = new RunWatcher(deps)
  const tick = (ms: number): void => {
    const end = t + ms
    for (;;) {
      const n = timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!n) break
      t = n.at; n.live = false; n.fn()
    }
    t = end
  }
  return { w, tick, emit, closed, restarts, loops, state, now: () => t }
}

describe('restart on file change', () => {
  it('restarts once after a burst of edits, and watches the new run itself', () => {
    const f = fakeWatcher()
    f.w.onRunStarted(run())
    f.tick(GRACE_MS)
    f.emit[0]('src/a.ts'); f.tick(100); f.emit[0]('src/b.ts'); f.tick(100); f.emit[0]('src/a.ts')
    f.tick(DEBOUNCE_MS - 1)
    expect(f.restarts).toEqual([])
    f.tick(1)
    expect(f.restarts).toEqual(['r1'])
    expect(f.w.isWatching('r1')).toBe(false)
  })
  it('ignores noise, startup churn, and scripts that did not opt in', () => {
    const f = fakeWatcher()
    f.w.onRunStarted(run())
    f.emit[0]('src/early.ts') // inside the grace period
    f.tick(GRACE_MS)
    f.emit[0]('node_modules/x.js'); f.emit[0]('app.log')
    f.tick(5000)
    expect(f.restarts).toEqual([])
    const off = fakeWatcher({ enabled: false })
    off.w.onRunStarted(run())
    expect(off.emit).toHaveLength(0)
  })
  it('does not watch runs with no folder, and survives a folder that cannot be watched', () => {
    const none = fakeWatcher({ folder: undefined })
    none.w.onRunStarted(run())
    expect(none.emit).toHaveLength(0)
    const bad = fakeWatcher()
    bad.state.watchThrows = true
    expect(() => bad.w.onRunStarted(run())).not.toThrow()
    expect(bad.w.isWatching('r1')).toBe(false)
  })
  it('stops watching and cancels a queued restart when the run ends', () => {
    const f = fakeWatcher()
    f.w.onRunStarted(run())
    f.tick(GRACE_MS)
    f.emit[0]('src/a.ts')
    f.w.onRunEnded(run({ status: 'stopped', endedAt: 9 }))
    f.tick(5000)
    expect(f.restarts).toEqual([])
    expect(f.closed).toEqual([0])
  })
  it('gives up when the script keeps changing its own files', () => {
    const f = fakeWatcher()
    for (let i = 0; i < MAX_RESTARTS; i++) {
      f.w.onRunStarted(run({ runId: `r${i}` }))
      f.tick(GRACE_MS)
      f.emit[i]('src/generated.ts')
      f.tick(DEBOUNCE_MS)
    }
    expect(f.restarts).toHaveLength(MAX_RESTARTS)
    f.w.onRunStarted(run({ runId: 'last' }))
    f.tick(GRACE_MS)
    f.emit[MAX_RESTARTS]('src/generated.ts')
    f.tick(DEBOUNCE_MS)
    expect(f.loops).toEqual(['last'])
    expect(f.restarts).toHaveLength(MAX_RESTARTS)
    expect(f.w.isWatching('last')).toBe(false)
    expect(LOOP_WINDOW_MS).toBeGreaterThan(DEBOUNCE_MS * MAX_RESTARTS)
  })
  it('switching it off before the timer fires cancels the restart', () => {
    const f = fakeWatcher()
    f.w.onRunStarted(run())
    f.tick(GRACE_MS)
    f.emit[0]('src/a.ts')
    f.state.enabled = false
    f.tick(5000)
    expect(f.restarts).toEqual([])
  })
  it('dispose closes every watcher', () => {
    const f = fakeWatcher()
    f.w.onRunStarted(run({ runId: 'a' }))
    f.w.onRunStarted(run({ runId: 'b' }))
    f.w.dispose()
    expect(f.closed.sort()).toEqual([0, 1])
  })
})
