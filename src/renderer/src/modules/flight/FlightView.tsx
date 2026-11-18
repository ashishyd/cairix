import { Bug, GitBranch, GitCommit, KeyRound, PlaneTakeoff, Package, RefreshCw, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FlightEvent, FlightKind } from '@shared/types'
import { Button, Chip, EmptyState, InlineAlert, PageHeader, Skeleton } from '@/components/ui'
import { errMsg, timeAgo } from '@/lib/util'
import { useUiStore } from '@/stores/ui-store'

const ICON: Record<FlightKind, LucideIcon> = { branch: GitBranch, commit: GitCommit, deps: Package, env: KeyRound, crash: Bug }

function Row({ e }: { e: FlightEvent }): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const Icon = ICON[e.kind]
  return (
    <li className="flex items-center gap-3 border-b border-cx-border/60 px-4 last:border-0" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
      <Icon size={15} className={e.kind === 'crash' ? 'shrink-0 text-cx-danger' : 'shrink-0 text-cx-muted'} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="selectable truncate font-medium">{e.title}</p>
        {e.detail && <p className="selectable truncate font-mono text-sm text-cx-muted">{e.detail}</p>}
      </div>
      <button className="no-drag shrink-0" onClick={() => go({ kind: 'project', projectId: e.projectId, tab: 'scripts' })} title="Open project">
        <Chip>{e.projectName}</Chip>
      </button>
      <span className="w-20 shrink-0 text-right text-sm text-cx-faint">{timeAgo(e.at)}</span>
    </li>
  )
}

/** "What changed since this last worked?", across every trusted project. */
export function FlightView(): React.JSX.Element {
  const [events, setEvents] = useState<FlightEvent[] | null>(null)
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => {
    try {
      setEvents(await window.cairix.flight.list())
      setError(undefined)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])
  useEffect(() => {
    void refresh()
    // Poll only while visible; the recorder itself samples every 30 s.
    const t = setInterval(() => !document.hidden && void refresh(), 15_000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <PageHeader
        title="Flight recorder"
        subtitle="Branch switches, commits, dependency and env changes, and failed runs in your trusted projects. Env values are never recorded, only key names."
        actions={<Button icon={RefreshCw} onClick={() => void refresh()}>Refresh</Button>}
      />
      <div className="mt-5">
        {error ? (
          <InlineAlert tone="danger">
            Could not read the timeline: {error}{' '}
            <button className="no-drag underline" onClick={() => void refresh()}>Retry</button>
          </InlineAlert>
        ) : events === null ? (
          <Skeleton rows={4} />
        ) : events.length === 0 ? (
          <EmptyState icon={PlaneTakeoff} title="Nothing has changed yet">
            Cairix watches the projects you trust. Switch a branch, update a dependency or edit a .env file and it shows up here.
          </EmptyState>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
            {events.map((e) => (
              <Row key={e.id} e={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
