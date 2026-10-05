import type { RunInfo } from '@shared/types'

/** Waits before restart attempt 1, 2, 3 ...; the last value repeats. */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000]
/** Crashes inside this window count towards the limit; a run that lived this long starts fresh. */
export const WINDOW_MS = 120_000
export const MAX_RESTARTS = 5

export interface SupervisorDeps {
  /** Has the user switched auto-restart on for this script? Asked again when the timer fires. */
  enabled(scriptId: string): boolean
  /** Starts the script again. `attempt` is how many restarts in a row this is. */
  restart(info: RunInfo, attempt: number): Promise<void>
  /** Gave up: it keeps crashing. */
  onGiveUp(info: RunInfo, attempts: number): void
  /** Waits per attempt (tests shorten it). Defaults to {@link BACKOFF_MS}. */
  backoff?: number[]
  now?(): number
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(t: unknown): void
}

/**
 * Brings a crashed script back, patiently. Only a *failed* run is restarted:
 * stopping it yourself, or it finishing normally, never is. Waits longer after
 * each crash, and after {@link MAX_RESTARTS} crashes inside {@link WINDOW_MS}
 * it stops trying and says so instead of spinning forever. A port clash is
 * not retried either: starting the same thing again cannot fix it.
 */
export class Supervisor {
  private pending = new Map<string, unknown>()
  private attempts = new Map<string, number[]>()

  constructor(private readonly deps: SupervisorDeps) {}

  /**
   * Call with every run that has just reached a final state. Says what happens
   * next: `restart` (queued), `gave-up` (the crash-loop limit was hit and
   * `onGiveUp` ran), or `ignored` (nothing to do: the caller reports the failure).
   */
  onRunEnded(info: RunInfo): 'restart' | 'gave-up' | 'ignored' {
    if (info.status !== 'failed' || info.portConflict || !this.deps.enabled(info.scriptId)) return 'ignored'
    const now = this.now()
    // A run that stayed up for a whole window was healthy: this crash is a fresh one.
    const lived = (info.endedAt ?? now) - info.startedAt
    const recent = lived >= WINDOW_MS ? [] : (this.attempts.get(info.scriptId) ?? []).filter((t) => now - t < WINDOW_MS)
    if (recent.length >= MAX_RESTARTS) {
      this.attempts.delete(info.scriptId)
      this.deps.onGiveUp(info, recent.length)
      return 'gave-up'
    }
    this.attempts.set(info.scriptId, recent)
    const waits = this.deps.backoff?.length ? this.deps.backoff : BACKOFF_MS
    const attempt = recent.length + 1
    this.clear(info.scriptId)
    const timer = this.setTimer(() => {
      this.pending.delete(info.scriptId)
      if (!this.deps.enabled(info.scriptId)) return
      const list = this.attempts.get(info.scriptId) ?? []
      list.push(this.now())
      this.attempts.set(info.scriptId, list)
      void this.deps.restart(info, attempt).catch(() => undefined)
    }, waits[Math.min(attempt, waits.length) - 1])
    this.pending.set(info.scriptId, timer)
    return 'restart'
  }

  /** The script is running again (by you, or by us): any queued restart is moot. */
  onRunStarted(scriptId: string): void {
    this.clear(scriptId)
  }

  /** True while a restart is waiting to happen. */
  isPending(scriptId: string): boolean {
    return this.pending.has(scriptId)
  }

  dispose(): void {
    for (const id of [...this.pending.keys()]) this.clear(id)
  }

  private clear(scriptId: string): void {
    const t = this.pending.get(scriptId)
    if (t === undefined) return
    ;(this.deps.clearTimer ?? ((x) => clearTimeout(x as NodeJS.Timeout)))(t)
    this.pending.delete(scriptId)
  }
  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
  private setTimer(fn: () => void, ms: number): unknown {
    return (this.deps.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms)
  }
}
