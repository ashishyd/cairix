import { Bot, Check, FileText, Minus } from 'lucide-react'
import type { AgentSession } from '@shared/types'
import { Button, Chip, EmptyState, PageHeader, StatusDot } from '@/components/ui'
import { cx, formatKb, tildify, timeAgo } from '@/lib/util'
import { useAgentsStore } from '@/stores/agents-store'
import { useUiStore } from '@/stores/ui-store'

const KIND_LABEL = { claude: 'Claude Code', cursor: 'Cursor Agent' } as const

function ToolCard({ name, installed, version, detail }: { name: string; installed: boolean; version?: string; detail?: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-cx-border bg-cx-raised px-4 py-3">
      <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg', installed ? 'bg-cx-success/12 text-cx-success' : 'bg-cx-hover text-cx-faint')}>
        {installed ? <Check size={16} /> : <Minus size={16} />}
      </span>
      <div className="min-w-0">
        <p className="font-medium">{name}</p>
        <p className="truncate text-sm text-cx-muted">{installed ? [version, detail].filter(Boolean).join(' · ') || 'Installed' : 'Not found on your PATH'}</p>
      </div>
    </div>
  )
}

function SessionCard({ s }: { s: AgentSession }): React.JSX.Element {
  const go = useUiStore((st) => st.go)
  const busy = s.status === 'busy'
  return (
    <li className="flex items-center gap-4 border-b border-cx-border/60 px-4 last:border-0" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
      <div className="flex w-[84px] shrink-0 items-center gap-2 text-sm font-medium" title={busy ? 'Working on a task' : s.status === 'idle' ? 'Waiting for you' : 'Background worker is running'}>
        <StatusDot tone={busy ? 'warning' : s.status === 'idle' ? 'muted' : 'success'} pulse={busy} />
        <span className={busy ? 'text-cx-warning' : s.status === 'running' ? 'text-cx-success' : 'text-cx-muted'}>{busy ? 'Working' : s.status === 'idle' ? 'Idle' : 'Running'}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{s.title}</span>
          <Chip tone={s.kind === 'claude' ? 'accent' : 'neutral'}>{KIND_LABEL[s.kind]}</Chip>
          {s.surface && <Chip>{s.surface.replace('claude-', '')}</Chip>}
        </div>
        <p className="mt-0.5 truncate text-sm text-cx-faint" title={s.cwd}>
          {s.projectId ? (
            <button className="no-drag text-cx-accent-text hover:underline" onClick={() => go({ kind: 'project', projectId: s.projectId!, tab: 'tasks' })}>
              {s.projectName}
            </button>
          ) : (
            s.cwd && <span className="font-mono">{tildify(s.cwd)}</span>
          )}
          {s.cwd && s.projectId && <span> · {tildify(s.cwd)}</span>}
          <span> · started {timeAgo(s.startedAt)}</span>
          {s.updatedAt && busy === false && <span> · active {timeAgo(s.updatedAt)}</span>}
        </p>
      </div>

      <div className="w-24 shrink-0 text-right text-sm tabular-nums text-cx-muted">
        <span className="block text-cx-text">{formatKb(s.rssKb)}</span>
        <span>{s.cpu.toFixed(s.cpu >= 10 ? 0 : 1)}% CPU</span>
      </div>

      <div className="w-[104px] shrink-0 text-right">
        {s.projectId && (
          <Button size="sm" onClick={() => go({ kind: 'project', projectId: s.projectId!, tab: 'tasks' })}>
            Open tasks
          </Button>
        )}
      </div>
    </li>
  )
}

/** Read-only dashboard of the coding agents running on this machine. */
export function AgentsView(): React.JSX.Element {
  const snapshot = useAgentsStore((s) => s.snapshot)
  const sessions = snapshot?.sessions ?? []
  const busy = sessions.filter((s) => s.status === 'busy').length

  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <PageHeader
        title="Agents"
        subtitle={snapshot ? `${sessions.length} running${busy > 0 ? ` · ${busy} working` : ''} · open a project’s Tasks tab to give Claude or Cursor work` : 'Looking for agents…'}
      />

      {snapshot && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <ToolCard name="Claude Code" installed={snapshot.claude.installed} version={snapshot.claude.version} />
          <ToolCard
            name="Cursor"
            installed={snapshot.cursor.installed || snapshot.cursor.appRunning}
            version={snapshot.cursor.version}
            detail={snapshot.cursor.appRunning ? `editor open, ${formatKb(snapshot.cursor.appRssKb)}` : undefined}
          />
        </div>
      )}

      <h2 className="mb-2 mt-7 cx-label">Running now</h2>
      {sessions.length > 0 ? (
        <ul className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} />
          ))}
        </ul>
      ) : snapshot ? (
        <EmptyState icon={Bot} title="No agents are running">
          Start Claude Code or open a Cursor agent and it shows up here, with whether it's working, where, and how much memory it uses.
        </EmptyState>
      ) : null}

      {snapshot && snapshot.plans.length > 0 && (
        <>
          <h2 className="mb-2 mt-7 cx-label">Recent Cursor plans</h2>
          <ul className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
            {snapshot.plans.map((p) => (
              <li key={p.path} className="flex items-center gap-3 border-b border-cx-border/60 px-4 py-2.5 last:border-0">
                <FileText size={14} className="shrink-0 text-cx-muted" />
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="shrink-0 text-sm text-cx-faint">{timeAgo(p.modifiedAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
