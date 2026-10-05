import { isDue, nextRunAt } from '@shared/schedules'
import type { Schedule, TaskAgent } from '@shared/types'
import type { ScheduleStore, StoredSchedule } from './store'

const TICK_MS = 20_000

export interface SchedulerDeps {
  isScriptActive(scriptId: string): boolean
  startScript(scriptId: string): Promise<void>
  startTask(t: { projectId: string; prompt: string; agent: TaskAgent }): Promise<void>
  /** Current commit of a project, for branch-change schedules. */
  headOf(projectId: string): Promise<string | undefined>
  /** How often to check. Tests shorten it. */
  tickMs?: number
  now?(): number
  setInterval?(fn: () => void, ms: number): unknown
  clearInterval?(t: unknown): void
}

/** Runs schedules. Time-based ones are checked on a short tick; branch-change ones compare the project's commit. */
export class Scheduler {
  private timer?: unknown
  private heads = new Map<string, string>()
  private busy = new Set<string>()

  constructor(private readonly store: ScheduleStore, private readonly deps: SchedulerDeps) {}

  start(): void {
    const t = (this.deps.setInterval ?? ((f, ms) => setInterval(f, ms)))(() => void this.tick(), this.deps.tickMs ?? TICK_MS)
    ;(t as { unref?: () => void }).unref?.()
    this.timer = t
    void this.tick()
  }

  stop(): void {
    if (this.timer !== undefined) (this.deps.clearInterval ?? ((x) => clearInterval(x as NodeJS.Timeout)))(this.timer)
    this.timer = undefined
  }

  list(): Schedule[] {
    const now = this.now()
    return this.store.all().map((s) => ({ ...s, nextRunAt: s.enabled ? nextRunAt(s, now) : undefined }))
  }

  /** One pass over every enabled schedule. Exposed so tests can drive the clock. */
  async tick(): Promise<void> {
    const now = this.now()
    for (const s of [...this.store.all()]) {
      if (!s.enabled || this.busy.has(s.id)) continue
      try {
        if (s.trigger.kind === 'git-change') {
          const head = await this.deps.headOf(s.trigger.projectId)
          const prev = this.heads.get(s.id)
          if (head) this.heads.set(s.id, head)
          // The first look only records where the project is; a change after that is the event.
          if (prev !== undefined && head && head !== prev) await this.fire(s, 'the branch changed')
        } else if (isDue(s, now)) await this.fire(s, 'on schedule')
      } catch {
        /* one broken schedule must not stop the others */
      }
    }
  }

  async runNow(id: string): Promise<Schedule> {
    const s = this.store.get(id)
    if (!s) throw new Error('That schedule no longer exists.')
    await this.fire(s, 'run by you')
    return this.list().find((x) => x.id === id)!
  }

  private async fire(s: StoredSchedule, why: string): Promise<void> {
    this.busy.add(s.id)
    const at = this.now()
    try {
      if (s.target.kind === 'script') {
        if (this.deps.isScriptActive(s.target.scriptId)) return this.store.record(s.id, { lastRunAt: at, lastStatus: 'skipped', lastMessage: `${s.target.label} was already running` })
        await this.deps.startScript(s.target.scriptId)
        this.store.record(s.id, { lastRunAt: at, lastStatus: 'started', lastMessage: `Started ${s.target.label} (${why})` })
      } else {
        await this.deps.startTask({ projectId: s.target.projectId, prompt: s.target.prompt, agent: s.target.agent })
        this.store.record(s.id, { lastRunAt: at, lastStatus: 'started', lastMessage: `Started an agent task (${why})` })
      }
    } catch (e) {
      this.store.record(s.id, { lastRunAt: at, lastStatus: 'failed', lastMessage: (e instanceof Error ? e.message : String(e)).slice(0, 280) })
    } finally {
      this.busy.delete(s.id)
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}
