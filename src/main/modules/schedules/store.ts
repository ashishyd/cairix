import { randomUUID } from 'crypto'
import { join } from 'path'
import { z } from 'zod'
import { triggerProblem } from '@shared/schedules'
import type { Schedule, ScheduleDraft } from '@shared/types'
import { readJson, writeJsonAtomic } from '../../json-store'

const MAX_SCHEDULES = 50

const trigger = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('every'), minutes: z.number() }),
  z.object({ kind: z.literal('daily'), time: z.string().max(5), days: z.array(z.number()).max(7) }),
  z.object({ kind: z.literal('git-change'), projectId: z.string().max(64) })
])
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('script'), scriptId: z.string().max(300), label: z.string().max(100) }),
  z.object({ kind: z.literal('task'), projectId: z.string().max(64), prompt: z.string().min(1).max(2000), agent: z.enum(['claude', 'cursor']) })
])
const schedule = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  enabled: z.boolean(),
  trigger,
  target,
  createdAt: z.number(),
  lastRunAt: z.number().optional(),
  lastStatus: z.enum(['started', 'skipped', 'failed']).optional(),
  lastMessage: z.string().max(300).optional()
})
export const draftSchema = schedule.omit({ id: true, createdAt: true, lastRunAt: true, lastStatus: true, lastMessage: true }).extend({ id: z.string().optional() })
const file = z.object({ version: z.literal(1), schedules: z.array(schedule) })

export type StoredSchedule = Schedule & { createdAt: number }

export class ScheduleStore {
  private list: StoredSchedule[]
  private readonly path: string

  constructor(dir: string, private readonly onChange: () => void = () => undefined) {
    this.path = join(dir, 'schedules.json')
    this.list = readJson(this.path, file, () => ({ version: 1 as const, schedules: [] })).schedules as StoredSchedule[]
  }

  all(): StoredSchedule[] {
    return this.list
  }
  get(id: string): StoredSchedule | undefined {
    return this.list.find((s) => s.id === id)
  }

  /** Validates and saves a draft. A changed trigger starts counting from now, not from the old one. */
  save(raw: ScheduleDraft, now = Date.now()): StoredSchedule {
    const d = draftSchema.parse(raw)
    d.name = d.name.trim()
    if (!d.name) throw new Error('Give the schedule a name.')
    const problem = triggerProblem(d.trigger)
    if (problem) throw new Error(problem)
    const existing = d.id ? this.get(d.id) : undefined
    if (d.id && !existing) throw new Error('That schedule no longer exists.')
    if (!existing && this.list.length >= MAX_SCHEDULES) throw new Error(`At most ${MAX_SCHEDULES} schedules.`)
    const saved: StoredSchedule = existing
      ? { ...existing, ...d, id: existing.id, createdAt: JSON.stringify(existing.trigger) === JSON.stringify(d.trigger) ? existing.createdAt : now, lastRunAt: JSON.stringify(existing.trigger) === JSON.stringify(d.trigger) ? existing.lastRunAt : undefined }
      : { ...d, id: randomUUID(), createdAt: now }
    this.list = existing ? this.list.map((s) => (s.id === saved.id ? saved : s)) : [...this.list, saved]
    this.persist()
    return saved
  }

  /** Records the outcome of a run. */
  record(id: string, patch: Pick<Schedule, 'lastRunAt' | 'lastStatus' | 'lastMessage'>): void {
    const s = this.get(id)
    if (!s) return
    Object.assign(s, patch)
    this.persist()
  }

  delete(id: string): void {
    this.list = this.list.filter((s) => s.id !== id)
    this.persist()
  }

  private persist(): void {
    writeJsonAtomic(this.path, { version: 1, schedules: this.list })
    this.onChange()
  }
}
