import type { AgentSession, FlightEvent, GitState } from './types'

export interface BriefItem {
  tone: 'danger' | 'warning' | 'info'
  text: string
}

const DAY = 86_400_000
const ago = (ms: number, now: number): string => {
  const m = Math.max(0, Math.round((now - ms) / 60_000))
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

/**
 * What to know when you open a project, from data Cairix already has (no AI,
 * no network). Empty when there is nothing worth saying.
 */
export function buildBrief(i: { git?: GitState; events: FlightEvent[]; sessions: AgentSession[]; now: number }): BriefItem[] {
  const out: BriefItem[] = []
  const { git, now } = i
  const recent = (kind: FlightEvent['kind'], within: number): FlightEvent[] => i.events.filter((e) => e.kind === kind && now - e.at <= within).sort((a, b) => b.at - a.at)

  if (git) {
    if (git.conflicted > 0) out.push({ tone: 'danger', text: `${git.conflicted} file${git.conflicted === 1 ? '' : 's'} in merge conflict.` })
    const dirty = git.staged + git.changed + git.untracked
    const where = git.branch ?? `detached at ${git.detached ?? 'HEAD'}`
    const parts = [dirty > 0 && `${dirty} uncommitted file${dirty === 1 ? '' : 's'}`, git.ahead > 0 && `${git.ahead} commit${git.ahead === 1 ? '' : 's'} not pushed`, git.behind > 0 && `${git.behind} behind ${git.upstream ?? 'upstream'}`, git.stashes.length > 0 && `${git.stashes.length} stash${git.stashes.length === 1 ? '' : 'es'}`].filter(Boolean)
    if (parts.length) out.push({ tone: 'info', text: `On ${where}: ${parts.join(', ')}.` })
  }

  const switched = recent('branch', 7 * DAY)[0]
  if (switched) out.push({ tone: 'info', text: `${switched.title}, ${ago(switched.at, now)}.` })

  // One line per failing script, not one per failure.
  const failed = new Map<string, FlightEvent[]>()
  for (const e of recent('crash', DAY)) failed.set(e.title, [...(failed.get(e.title) ?? []), e])
  for (const [title, list] of failed) out.push({ tone: 'danger', text: `${title}${list.length > 1 ? ` ${list.length} times` : ''} in the last day, most recently ${ago(list[0].at, now)}${list[0].detail ? ` (${list[0].detail})` : ''}.` })

  for (const s of i.sessions) {
    out.push({ tone: 'info', text: `${s.kind === 'claude' ? 'Claude Code' : 'Cursor'} session "${s.title}" is ${s.status === 'busy' ? 'working' : s.status === 'idle' ? 'idle, waiting for you' : 'running'} here.` })
  }

  const deps = recent('deps', 7 * DAY)[0]
  if (deps) out.push({ tone: 'warning', text: `Dependencies changed ${ago(deps.at, now)}. If something fails to import, reinstall.` })
  return out
}
