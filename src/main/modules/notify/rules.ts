import { formatDuration } from '@shared/runs'
import type { AgentTask, AuditState, NavigateTarget, RunInfo } from '@shared/types'

/** What is worth interrupting someone for. Pure, so the rules are tested without Electron. */
export interface Notice {
  kind: 'runs' | 'tasks' | 'audits'
  title: string
  body: string
  target: NavigateTarget
}

/** A run that finishes OK is only news when it took long enough that you probably looked away. */
export const LONG_RUN_MS = 15_000

const clip = (s: string, n = 110): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s.replace(/\s+/g, ' '))
/** Runs started from Commands or Actions aren't tied to a project. */
const SYNTHETIC_PROJECTS = new Set(['history', 'action'])

export function runNotice(run: RunInfo, projectExists: (id: string) => boolean): Notice | null {
  if (!run.endedAt) return null
  const ms = run.endedAt - run.startedAt
  const target: NavigateTarget = !SYNTHETIC_PROJECTS.has(run.projectId) && projectExists(run.projectId)
    ? { kind: 'project', projectId: run.projectId, tab: 'scripts' }
    : { kind: 'machine', page: 'runs' }
  const where = SYNTHETIC_PROJECTS.has(run.projectId) ? '' : `${run.projectName} · `
  if (run.status === 'failed') {
    const why = run.portConflict ? `port ${run.portConflict} is already in use` : run.exitCode != null ? `exit code ${run.exitCode}` : 'could not start'
    return { kind: 'runs', title: `${clip(run.scriptName, 60)} failed`, body: `${where}${why} · after ${formatDuration(ms)}`, target }
  }
  if (run.status === 'exited' && ms >= LONG_RUN_MS) {
    return { kind: 'runs', title: `${clip(run.scriptName, 60)} finished`, body: `${where}took ${formatDuration(ms)}`, target }
  }
  return null // stopped by you, or finished quickly
}

export function taskNotice(task: AgentTask): Notice | null {
  const target: NavigateTarget = { kind: 'project', projectId: task.projectId, tab: 'tasks' }
  if (task.status === 'done') {
    const ready = task.mode === 'edit' && task.changes && task.changes.files.length > 0
    return {
      kind: 'tasks',
      title: ready ? 'Agent changes ready to review' : 'Agent task finished',
      body: ready ? `${task.changes!.files.length} file${task.changes!.files.length === 1 ? '' : 's'} changed · ${clip(task.prompt, 70)}` : clip(task.prompt),
      target
    }
  }
  if (task.status === 'failed') return { kind: 'tasks', title: 'Agent task failed', body: clip(task.error ?? task.prompt), target }
  return null
}

export function auditNotice(state: AuditState, projectName: string): Notice | null {
  const target: NavigateTarget = { kind: 'project', projectId: state.projectId, tab: 'audit' }
  if (state.phase === 'done') {
    const n = state.findings.length
    return { kind: 'audits', title: `Audit finished for ${clip(projectName, 50)}`, body: n === 0 ? 'No findings.' : `${n} finding${n === 1 ? '' : 's'}${state.error ? ' (partial results)' : ''}`, target }
  }
  if (state.phase === 'error') return { kind: 'audits', title: `Audit failed for ${clip(projectName, 50)}`, body: clip(state.error ?? 'It could not finish.'), target }
  return null
}
