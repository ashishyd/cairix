import type { RunRecord } from './types'

/** "850 ms", "42s", "3m 05s", "1h 02m". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** A run counts as a failure when it failed; stopping it yourself is not one. */
export const isFailure = (r: Pick<RunRecord, 'status'>): boolean => r.status === 'failed'

export interface ScriptStats {
  key: string
  scriptId: string
  projectId: string
  projectName: string
  scriptName: string
  runs: number
  failures: number
  /** Fraction of finished runs that did not fail, ignoring ones you stopped yourself. */
  successRate: number
  /** Mean duration of runs that ran to the end (exited or failed), in ms. */
  avgMs: number
  lastRunAt: number
  lastStatus: RunRecord['status']
  /** More than one of the last five completed runs failed. */
  flaky: boolean
}

/** Per-script reliability. Runs you stopped yourself count as runs but not as outcomes. */
export function summarizeRuns(records: RunRecord[]): ScriptStats[] {
  const groups = new Map<string, RunRecord[]>()
  for (const r of records) {
    const key = `${r.projectId}\u0000${r.scriptId}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  const out: ScriptStats[] = []
  for (const [key, list] of groups) {
    const newest = [...list].sort((a, b) => b.endedAt - a.endedAt)
    const completed = newest.filter((r) => r.status !== 'stopped')
    const failures = completed.filter(isFailure).length
    const timed = completed.map((r) => r.durationMs)
    out.push({
      key,
      scriptId: newest[0].scriptId,
      projectId: newest[0].projectId,
      projectName: newest[0].projectName,
      scriptName: newest[0].scriptName,
      runs: list.length,
      failures,
      successRate: completed.length === 0 ? 1 : (completed.length - failures) / completed.length,
      avgMs: timed.length === 0 ? 0 : timed.reduce((a, b) => a + b, 0) / timed.length,
      lastRunAt: newest[0].endedAt,
      lastStatus: newest[0].status,
      flaky: completed.slice(0, 5).filter(isFailure).length >= 2
    })
  }
  return out.sort((a, b) => b.lastRunAt - a.lastRunAt)
}
