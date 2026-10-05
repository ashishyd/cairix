import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CATCHUP_MS, describeTrigger, isDue, lastOccurrence, nextOccurrence, nextRunAt, parseTime, triggerProblem } from '../src/shared/schedules'
import { Scheduler, type SchedulerDeps } from '../src/main/modules/schedules/service'
import { ScheduleStore } from '../src/main/modules/schedules/store'
import type { ScheduleDraft, ScheduleTrigger } from '../src/shared/types'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-sched-')))
  dirs.push(d)
  return d
}
/** Local time on a fixed day: Wed 15 Jan 2025. */
const at = (h: number, m = 0, day = 15): number => new Date(2025, 0, day, h, m, 0, 0).getTime()
const daily = (time: string, days: number[] = []): Extract<ScheduleTrigger, { kind: 'daily' }> => ({ kind: 'daily', time, days })

describe('schedule timing', () => {
  it('reads times and describes triggers', () => {
    expect(parseTime('09:30')).toEqual({ h: 9, m: 30 })
    for (const bad of ['9:30', '24:00', '12:60', 'noon', '']) expect(parseTime(bad), bad).toBeNull()
    expect(describeTrigger({ kind: 'every', minutes: 30 })).toBe('Every 30 minutes')
    expect(describeTrigger({ kind: 'every', minutes: 60 })).toBe('Every hour')
    expect(describeTrigger({ kind: 'every', minutes: 180 })).toBe('Every 3 hours')
    expect(describeTrigger({ kind: 'every', minutes: 1440 })).toBe('Every day')
    expect(describeTrigger(daily('09:00', [1, 2, 3, 4, 5]))).toBe('At 09:00, Mon, Tue, Wed, Thu, Fri')
    expect(describeTrigger(daily('09:00', []))).toBe('At 09:00, every day')
    expect(describeTrigger({ kind: 'git-change', projectId: 'p' }, 'web')).toBe('When a branch changes in web')
  })
  it('finds the last and next daily occurrence, honouring days of the week', () => {
    expect(lastOccurrence(daily('09:00'), at(10))).toBe(at(9))
    expect(lastOccurrence(daily('09:00'), at(8))).toBe(at(9, 0, 14))
    expect(nextOccurrence(daily('09:00'), at(8))).toBe(at(9))
    expect(nextOccurrence(daily('09:00'), at(9))).toBe(at(9, 0, 16)) // strictly after
    // Wednesday 15th; Friday only
    expect(nextOccurrence(daily('09:00', [5]), at(10))).toBe(at(9, 0, 17))
    expect(lastOccurrence(daily('09:00', [5]), at(10))).toBe(at(9, 0, 10))
  })
  it('an interval is due once it has elapsed since the last run (or creation)', () => {
    const s = { trigger: { kind: 'every', minutes: 10 } as ScheduleTrigger, createdAt: at(9), lastRunAt: undefined as number | undefined }
    expect(isDue(s, at(9, 9))).toBe(false)
    expect(isDue(s, at(9, 10))).toBe(true)
    expect(isDue({ ...s, lastRunAt: at(9, 10) }, at(9, 15))).toBe(false)
    expect(nextRunAt({ ...s, lastRunAt: at(9, 10) }, at(9, 15))).toBe(at(9, 20))
  })
  it('a daily run is due once per occurrence, not before creation, and not when long missed', () => {
    const s = { trigger: daily('09:00'), createdAt: at(8), lastRunAt: undefined as number | undefined }
    expect(isDue(s, at(8, 59))).toBe(false)
    expect(isDue(s, at(9))).toBe(true)
    expect(isDue({ ...s, lastRunAt: at(9, 0) }, at(9, 30))).toBe(false) // already ran
    expect(isDue({ ...s, createdAt: at(10) }, at(10, 5))).toBe(false) // created after today's time
    expect(isDue(s, at(9) + CATCHUP_MS)).toBe(true) // woke up late: catch up once
    expect(isDue(s, at(9) + CATCHUP_MS + 60_000)).toBe(false) // too stale
    expect(isDue({ trigger: { kind: 'git-change', projectId: 'p' }, createdAt: 0 }, at(9))).toBe(false)
  })
  it('validates triggers', () => {
    expect(triggerProblem({ kind: 'every', minutes: 0 })).toMatch(/interval/)
    expect(triggerProblem({ kind: 'every', minutes: 1.5 })).toMatch(/interval/)
    expect(triggerProblem({ kind: 'every', minutes: 60 * 24 * 31 })).toMatch(/interval/)
    expect(triggerProblem({ kind: 'every', minutes: 5 })).toBeNull()
    expect(triggerProblem(daily('25:00'))).toMatch(/HH:MM/)
    expect(triggerProblem(daily('09:00', [7]))).toMatch(/days/)
    expect(triggerProblem({ kind: 'git-change', projectId: '' })).toMatch(/project/)
  })
})

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({ name: 'Nightly', enabled: true, trigger: { kind: 'every', minutes: 30 }, target: { kind: 'script', scriptId: 'p:build', label: 'build' }, ...over })

describe('the schedule store', () => {
  it('saves, edits and deletes, across restarts', () => {
    const dir = tmp()
    const s = new ScheduleStore(dir)
    const a = s.save(draft(), 1000)
    expect(a).toMatchObject({ name: 'Nightly', createdAt: 1000 })
    s.save({ ...draft({ name: 'Renamed' }), id: a.id }, 2000)
    expect(new ScheduleStore(dir).all()).toEqual([expect.objectContaining({ id: a.id, name: 'Renamed', createdAt: 1000 })])
    s.delete(a.id)
    expect(new ScheduleStore(dir).all()).toEqual([])
  })
  it('restarts the clock when the trigger changes, but not when only the name does', () => {
    const s = new ScheduleStore(tmp())
    const a = s.save(draft(), 1000)
    s.record(a.id, { lastRunAt: 1500, lastStatus: 'started' })
    expect(s.save({ ...draft({ name: 'x' }), id: a.id }, 3000)).toMatchObject({ createdAt: 1000, lastRunAt: 1500 })
    expect(s.save({ ...draft({ trigger: { kind: 'every', minutes: 5 } }), id: a.id }, 4000)).toMatchObject({ createdAt: 4000, lastRunAt: undefined })
  })
  it('rejects bad input', () => {
    const s = new ScheduleStore(tmp())
    expect(() => s.save(draft({ name: '   ' }))).toThrow(/name/)
    expect(() => s.save(draft({ trigger: { kind: 'every', minutes: 0 } }))).toThrow(/interval/)
    expect(() => s.save({ ...draft(), id: 'ghost' })).toThrow(/no longer exists/)
    expect(() => s.save(draft({ target: { kind: 'task', projectId: 'p', prompt: '', agent: 'claude' } }))).toThrow()
    expect(() => s.save({ ...draft(), trigger: { kind: 'weird' } as never })).toThrow()
  })
  it('stops at 50', () => {
    const s = new ScheduleStore(tmp())
    for (let i = 0; i < 50; i++) s.save(draft({ name: `n${i}` }))
    expect(() => s.save(draft())).toThrow(/At most 50/)
  })
})

function harness(over: Partial<SchedulerDeps> = {}) {
  let t = at(9)
  const started: string[] = []
  const tasks: string[] = []
  const heads = new Map<string, string>()
  const store = new ScheduleStore(tmp())
  const deps: SchedulerDeps = {
    isScriptActive: () => false,
    startScript: async (id) => void started.push(id),
    startTask: async (x) => void tasks.push(x.prompt),
    headOf: async (id) => heads.get(id),
    now: () => t,
    ...over
  }
  const sched = new Scheduler(store, deps)
  return { store, sched, started, tasks, heads, advance: (ms: number) => void (t += ms), setNow: (x: number) => void (t = x), now: () => t }
}

describe('the scheduler', () => {
  it('runs an interval script when due, then waits a full interval', async () => {
    const h = harness()
    h.store.save(draft({ trigger: { kind: 'every', minutes: 10 } }), h.now())
    await h.sched.tick()
    expect(h.started).toEqual([])
    h.advance(10 * 60_000)
    await h.sched.tick()
    expect(h.started).toEqual(['p:build'])
    await h.sched.tick()
    h.advance(5 * 60_000)
    await h.sched.tick()
    expect(h.started).toHaveLength(1)
    h.advance(5 * 60_000)
    await h.sched.tick()
    expect(h.started).toHaveLength(2)
    expect(h.store.all()[0]).toMatchObject({ lastStatus: 'started' })
  })
  it('does not run paused schedules, and runs a daily one once', async () => {
    const h = harness()
    h.setNow(at(8))
    h.store.save(draft({ enabled: false, trigger: daily('09:00') }), h.now())
    h.store.save(draft({ name: 'Daily', trigger: daily('09:00') }), h.now())
    h.setNow(at(9, 1))
    await h.sched.tick()
    await h.sched.tick()
    expect(h.started).toEqual(['p:build'])
  })
  it('skips a script that is already running instead of starting a second copy', async () => {
    const h = harness({ isScriptActive: () => true })
    h.store.save(draft({ trigger: { kind: 'every', minutes: 1 } }), h.now())
    h.advance(60_000)
    await h.sched.tick()
    expect(h.started).toEqual([])
    expect(h.store.all()[0]).toMatchObject({ lastStatus: 'skipped', lastMessage: expect.stringContaining('already running') })
  })
  it('records a failure (an untrusted folder, a missing CLI) without stopping the others', async () => {
    const h = harness({ startScript: async (id) => { if (id === 'p:bad') throw new Error('Trust the folder first') ; } })
    h.store.save(draft({ name: 'bad', target: { kind: 'script', scriptId: 'p:bad', label: 'bad' }, trigger: { kind: 'every', minutes: 1 } }), h.now())
    h.store.save(draft({ name: 'good', trigger: { kind: 'every', minutes: 1 } }), h.now())
    h.advance(60_000)
    await h.sched.tick()
    expect(h.store.all().map((s) => [s.name, s.lastStatus])).toEqual([['bad', 'failed'], ['good', 'started']])
    expect(h.store.all()[0].lastMessage).toBe('Trust the folder first')
  })
  it('starts an agent task with the prompt', async () => {
    const h = harness()
    h.store.save(draft({ target: { kind: 'task', projectId: 'p', prompt: 'Summarise changes', agent: 'claude' }, trigger: { kind: 'every', minutes: 1 } }), h.now())
    h.advance(60_000)
    await h.sched.tick()
    expect(h.tasks).toEqual(['Summarise changes'])
  })
  it('fires a branch-change schedule only when the commit changes after the first look', async () => {
    const h = harness()
    h.heads.set('p', 'aaa')
    h.store.save(draft({ trigger: { kind: 'git-change', projectId: 'p' } }), h.now())
    await h.sched.tick() // baseline
    await h.sched.tick()
    expect(h.started).toEqual([])
    h.heads.set('p', 'bbb')
    await h.sched.tick()
    expect(h.started).toEqual(['p:build'])
    await h.sched.tick()
    expect(h.started).toHaveLength(1)
    h.heads.delete('p') // git unavailable: nothing happens
    await h.sched.tick()
    expect(h.started).toHaveLength(1)
  })
  it('run now works on a paused schedule, and lists the next run time', async () => {
    const h = harness()
    const s = h.store.save(draft({ enabled: false }), h.now())
    expect((await h.sched.runNow(s.id)).lastStatus).toBe('started')
    await expect(h.sched.runNow('ghost')).rejects.toThrow(/no longer exists/)
    h.store.save({ ...draft({ trigger: { kind: 'every', minutes: 30 }, enabled: false }), id: s.id }, h.now())
    expect(h.sched.list()[0].nextRunAt).toBeUndefined() // paused: no next run
    h.store.save({ ...draft({ trigger: { kind: 'every', minutes: 30 }, enabled: true }), id: s.id }, h.now())
    expect(h.sched.list()[0].nextRunAt).toBe(h.now() + 30 * 60_000)
  })
})
