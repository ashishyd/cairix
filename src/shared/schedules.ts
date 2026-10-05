import type { Schedule, ScheduleTrigger } from './types'

/** A missed daily run still fires if Cairix wakes up within this long after it was due (a laptop that was asleep). */
export const CATCHUP_MS = 6 * 3_600_000
export const MIN_INTERVAL_MINUTES = 1
export const MAX_INTERVAL_MINUTES = 60 * 24 * 30

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function parseTime(time: string): { h: number; m: number } | null {
  const m = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  return m ? { h: +m[1], m: +m[2] } : null
}

const allowed = (days: number[], d: Date): boolean => days.length === 0 || days.includes(d.getDay())

/** The most recent daily occurrence at or before `now` (local time), within the last week. */
export function lastOccurrence(trigger: Extract<ScheduleTrigger, { kind: 'daily' }>, now: number): number | undefined {
  const t = parseTime(trigger.time)
  if (!t) return undefined
  for (let back = 0; back <= 7; back++) {
    const d = new Date(now)
    d.setDate(d.getDate() - back)
    d.setHours(t.h, t.m, 0, 0)
    if (d.getTime() <= now && allowed(trigger.days, d)) return d.getTime()
  }
  return undefined
}

/** The first daily occurrence strictly after `from`. */
export function nextOccurrence(trigger: Extract<ScheduleTrigger, { kind: 'daily' }>, from: number): number | undefined {
  const t = parseTime(trigger.time)
  if (!t) return undefined
  for (let ahead = 0; ahead <= 8; ahead++) {
    const d = new Date(from)
    d.setDate(d.getDate() + ahead)
    d.setHours(t.h, t.m, 0, 0)
    if (d.getTime() > from && allowed(trigger.days, d)) return d.getTime()
  }
  return undefined
}

type TimeBased = Pick<Schedule, 'trigger' | 'lastRunAt'> & { createdAt: number }

/** Should a time-based schedule run now? (Branch-change schedules are event driven, so never "due".) */
export function isDue(s: TimeBased, now: number): boolean {
  const t = s.trigger
  if (t.kind === 'every') return now >= (s.lastRunAt ?? s.createdAt) + t.minutes * 60_000
  if (t.kind === 'daily') {
    const occ = lastOccurrence(t, now)
    // Not before it was created (a new "daily at 9" made at 10 must not fire at once), not twice, not stale.
    return occ !== undefined && occ >= s.createdAt && (s.lastRunAt ?? 0) < occ && now - occ <= CATCHUP_MS
  }
  return false
}

/** When it will next fire, for display. */
export function nextRunAt(s: TimeBased, now: number): number | undefined {
  const t = s.trigger
  if (t.kind === 'every') return Math.max(now, (s.lastRunAt ?? s.createdAt) + t.minutes * 60_000)
  if (t.kind === 'daily') return isDue(s, now) ? now : nextOccurrence(t, now)
  return undefined
}

export function describeTrigger(t: ScheduleTrigger, projectName?: string): string {
  if (t.kind === 'every') {
    const m = t.minutes
    if (m % 1440 === 0) return m === 1440 ? 'Every day' : `Every ${m / 1440} days`
    if (m % 60 === 0) return m === 60 ? 'Every hour' : `Every ${m / 60} hours`
    return m === 1 ? 'Every minute' : `Every ${m} minutes`
  }
  if (t.kind === 'daily') {
    const days = t.days.length === 0 || t.days.length === 7 ? 'every day' : [...t.days].sort().map((d) => DAY_NAMES[d]).join(', ')
    return `At ${t.time}, ${days}`
  }
  return `When a branch changes${projectName ? ` in ${projectName}` : ''}`
}

/** Returns a message for the first thing wrong with a trigger, or null. */
export function triggerProblem(t: ScheduleTrigger): string | null {
  if (t.kind === 'every') {
    if (!Number.isInteger(t.minutes) || t.minutes < MIN_INTERVAL_MINUTES || t.minutes > MAX_INTERVAL_MINUTES) return `Choose an interval between ${MIN_INTERVAL_MINUTES} minute and 30 days.`
    return null
  }
  if (t.kind === 'daily') {
    if (!parseTime(t.time)) return 'Enter the time as HH:MM, for example 09:30.'
    if (t.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Pick days of the week.'
    return null
  }
  return t.projectId ? null : 'Choose a project to watch.'
}
