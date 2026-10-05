import { describe, expect, it } from 'vitest'
import { BACKOFF_MS, MAX_RESTARTS, Supervisor, WINDOW_MS, type SupervisorDeps } from '../src/main/modules/scripts/supervisor'
import { applyLaunchAtLogin, shouldShowWindowOnStart } from '../src/main/login'
import { crashLoopNotice } from '../src/main/modules/notify/rules'
import { DEFAULT_SETTINGS, settingsPatchSchema, settingsSchema } from '../src/shared/settings'
import type { RunInfo } from '../src/shared/types'

const run = (over: Partial<RunInfo> = {}): RunInfo => ({
  runId: 'r', scriptId: 'p1:dev', projectId: 'p1', projectName: 'web-app', scriptName: 'dev', command: 'pnpm dev',
  pid: 1, startedAt: 0, endedAt: 3000, status: 'failed', exitCode: 1, ports: [], ...over
})

/** A supervisor on a fake clock: `tick(ms)` advances time and fires due timers in order. */
function fake(opts: { enabled?: boolean } = {}) {
  let t = 0
  const timers: Array<{ at: number; fn: () => void; id: number; live: boolean }> = []
  const restarts: Array<{ attempt: number; args?: string[] }> = []
  const gaveUp: number[] = []
  const state = { enabled: opts.enabled ?? true, failRestart: false }
  const deps: SupervisorDeps = {
    enabled: () => state.enabled,
    restart: async (info, attempt) => {
      restarts.push({ attempt, args: info.args })
      if (state.failRestart) throw new Error('untrusted')
    },
    onGiveUp: (_i, n) => gaveUp.push(n),
    now: () => t,
    setTimer: (fn, ms) => {
      const e = { at: t + ms, fn, id: timers.length, live: true }
      timers.push(e)
      return e
    },
    clearTimer: (h) => void ((h as { live: boolean }).live = false)
  }
  const sup = new Supervisor(deps)
  const tick = (ms: number): void => {
    const end = t + ms
    for (;;) {
      const next = timers.filter((x) => x.live && x.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      t = next.at
      next.live = false
      next.fn()
    }
    t = end
  }
  return { sup, tick, restarts, gaveUp, state, now: () => t }
}

describe('auto-restart supervisor', () => {
  it('restarts a crashed script after a short wait, with the same arguments', () => {
    const f = fake()
    expect(f.sup.onRunEnded(run({ args: ['--port', '4000'] }))).toBe('restart')
    f.tick(BACKOFF_MS[0] - 1)
    expect(f.restarts).toEqual([])
    f.tick(1)
    expect(f.restarts).toEqual([{ attempt: 1, args: ['--port', '4000'] }])
  })
  it('waits longer after each crash', () => {
    const f = fake()
    for (let i = 0; i < 3; i++) {
      f.sup.onRunEnded(run({ endedAt: f.now() }))
      f.tick(BACKOFF_MS[i])
    }
    expect(f.restarts.map((r) => r.attempt)).toEqual([1, 2, 3])
    expect(BACKOFF_MS[2]).toBeGreaterThan(BACKOFF_MS[0])
  })
  it('gives up after too many crashes in a row, and says how many', () => {
    const f = fake()
    for (let i = 0; i < MAX_RESTARTS; i++) {
      expect(f.sup.onRunEnded(run({ startedAt: f.now(), endedAt: f.now() + 10 }))).toBe('restart')
      f.tick(20_000)
    }
    expect(f.restarts).toHaveLength(MAX_RESTARTS)
    expect(f.sup.onRunEnded(run({ startedAt: f.now(), endedAt: f.now() + 10 }))).toBe('gave-up')
    expect(f.gaveUp).toEqual([MAX_RESTARTS])
    f.tick(60_000)
    expect(f.restarts).toHaveLength(MAX_RESTARTS) // no further tries
  })
  it('starts counting from zero once a run has stayed up for a whole window', () => {
    const f = fake()
    for (let i = 0; i < MAX_RESTARTS - 1; i++) {
      f.sup.onRunEnded(run({ endedAt: f.now() }))
      f.tick(20_000)
    }
    expect(f.sup.onRunEnded(run({ startedAt: 0, endedAt: WINDOW_MS + 1 }))).toBe('restart')
    f.tick(BACKOFF_MS[0])
    expect(f.restarts.at(-1)!.attempt).toBe(1)
  })
  it('forgets crashes that are old enough', () => {
    const f = fake()
    for (let i = 0; i < MAX_RESTARTS; i++) {
      f.sup.onRunEnded(run({ endedAt: f.now() }))
      f.tick(20_000)
    }
    f.tick(WINDOW_MS)
    expect(f.sup.onRunEnded(run({ startedAt: f.now(), endedAt: f.now() + 5 }))).toBe('restart')
  })
  it('never restarts what you stopped, what finished normally, or a port clash', () => {
    const f = fake()
    expect(f.sup.onRunEnded(run({ status: 'stopped' }))).toBe('ignored')
    expect(f.sup.onRunEnded(run({ status: 'exited', exitCode: 0 }))).toBe('ignored')
    expect(f.sup.onRunEnded(run({ portConflict: 3000 }))).toBe('ignored')
    f.tick(60_000)
    expect(f.restarts).toEqual([])
  })
  it('does nothing for a script that is not opted in, or when switched off before the timer fires', () => {
    const off = fake({ enabled: false })
    expect(off.sup.onRunEnded(run())).toBe('ignored')
    const f = fake()
    f.sup.onRunEnded(run())
    f.state.enabled = false
    f.tick(10_000)
    expect(f.restarts).toEqual([])
  })
  it('drops a queued restart when the script is started by someone else meanwhile', () => {
    const f = fake()
    f.sup.onRunEnded(run())
    expect(f.sup.isPending('p1:dev')).toBe(true)
    f.sup.onRunStarted('p1:dev')
    expect(f.sup.isPending('p1:dev')).toBe(false)
    f.tick(10_000)
    expect(f.restarts).toEqual([])
  })
  it('survives a restart that cannot happen (for example the folder was untrusted)', async () => {
    const f = fake()
    f.state.failRestart = true
    f.sup.onRunEnded(run())
    f.tick(BACKOFF_MS[0])
    await Promise.resolve()
    expect(f.restarts).toHaveLength(1)
  })
  it('dispose cancels everything queued', () => {
    const f = fake()
    f.sup.onRunEnded(run())
    f.sup.dispose()
    f.tick(60_000)
    expect(f.restarts).toEqual([])
  })
  it('uses custom waits when given', () => {
    let fired = 0
    const sup = new Supervisor({ enabled: () => true, restart: async () => void fired++, onGiveUp: () => undefined, backoff: [5], now: () => 0, setTimer: (fn, ms) => (ms === 5 ? fn() : undefined) })
    sup.onRunEnded(run())
    expect(fired).toBe(1)
  })
})

describe('crash-loop notice', () => {
  it('says auto-restart gave up and how often it tried', () => {
    const n = crashLoopNotice(run(), 5, () => true)
    expect(n.title).toBe('dev keeps crashing')
    expect(n.body).toBe('Auto-restart gave up after 5 tries (last exit code 1)')
    expect(n.target).toEqual({ kind: 'project', projectId: 'p1', tab: 'scripts' })
  })
})

describe('launch at login', () => {
  it('registers only in the installed app, hidden', () => {
    const calls: unknown[] = []
    expect(applyLaunchAtLogin(true, { isPackaged: true, set: (o) => calls.push(o) })).toBe(true)
    expect(calls).toEqual([{ openAtLogin: true, openAsHidden: true }])
    expect(applyLaunchAtLogin(false, { isPackaged: true, set: (o) => calls.push(o) })).toBe(true)
    expect(calls.at(-1)).toEqual({ openAtLogin: false, openAsHidden: false })
  })
  it('never touches Login Items from a dev run', () => {
    const calls: unknown[] = []
    expect(applyLaunchAtLogin(true, { isPackaged: false, set: (o) => calls.push(o) })).toBe(false)
    expect(calls).toEqual([])
  })
  it('opens the window normally, but not when started as a login item', () => {
    expect(shouldShowWindowOnStart({})).toBe(true)
    expect(shouldShowWindowOnStart({ wasOpenedAtLogin: false })).toBe(true)
    expect(shouldShowWindowOnStart({ wasOpenedAtLogin: true })).toBe(false)
    expect(shouldShowWindowOnStart({ wasOpenedAsHidden: true })).toBe(false)
  })
})

describe('the new settings', () => {
  it('default to off and empty, and validate on patch', () => {
    expect(DEFAULT_SETTINGS.launchAtLogin).toBe(false)
    expect(settingsSchema.parse({}).autoRestartScripts).toEqual([])
    expect(settingsPatchSchema.parse({ launchAtLogin: true, autoRestartScripts: ['p1:dev'] })).toEqual({ launchAtLogin: true, autoRestartScripts: ['p1:dev'] })
    expect(settingsPatchSchema.safeParse({ launchAtLogin: 'yes' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ autoRestartScripts: [1] }).success).toBe(false)
  })
})
