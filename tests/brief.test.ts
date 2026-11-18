import { describe, expect, it } from 'vitest'
import { buildBrief } from '../src/shared/brief'
import type { AgentSession, FlightEvent, GitState } from '../src/shared/types'

const NOW = 1_700_000_000_000
const H = 3_600_000
const git = (over: Partial<GitState> = {}): GitState => ({ branch: 'main', ahead: 0, behind: 0, staged: 0, changed: 0, untracked: 0, conflicted: 0, hasCommits: true, branches: [], stashes: [], recent: [], ...over })
const ev = (kind: FlightEvent['kind'], title: string, ago: number, detail?: string): FlightEvent => ({ id: `${kind}${ago}`, at: NOW - ago, projectId: 'p', projectName: 'p', kind, title, detail })
const agent = (status: AgentSession['status']): AgentSession => ({ id: 'a', kind: 'claude', pid: 1, title: 'Fix login', cwd: '/x', status, startedAt: 0, rssKb: 0, cpu: 0 })

describe('buildBrief', () => {
  it('says nothing when nothing is going on', () => {
    expect(buildBrief({ git: git(), events: [], sessions: [], now: NOW })).toEqual([])
    expect(buildBrief({ events: [], sessions: [], now: NOW })).toEqual([])
  })

  it('summarises git, conflicts, the last branch switch, failed runs, agents and dependency changes', () => {
    const out = buildBrief({
      git: git({ changed: 2, untracked: 1, ahead: 3, conflicted: 1 }),
      events: [ev('branch', 'Switched branch: main → feat/x', 3 * H), ev('crash', 'dev failed', 2 * H, 'exit code 1'), ev('crash', 'dev failed', 5 * H), ev('deps', 'Dependencies changed', 48 * H)],
      sessions: [agent('idle')],
      now: NOW
    })
    expect(out.map((o) => o.text)).toEqual([
      '1 file in merge conflict.',
      'On main: 3 uncommitted files, 3 commits not pushed.',
      'Switched branch: main → feat/x, 3 h ago.',
      'dev failed 2 times in the last day, most recently 2 h ago (exit code 1).',
      'Claude Code session "Fix login" is idle, waiting for you here.',
      'Dependencies changed 2 d ago. If something fails to import, reinstall.'
    ])
    expect(out[0].tone).toBe('danger')
  })

  it('ignores old events', () => {
    expect(buildBrief({ events: [ev('crash', 'dev failed', 3 * 86_400_000), ev('branch', 'Switched branch: a → b', 9 * 86_400_000)], sessions: [], now: NOW })).toEqual([])
  })
})
