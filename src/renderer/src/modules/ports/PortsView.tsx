import { Plug, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PortEntry, Project } from '@shared/types'
import { Button, EmptyState, IconButton, Segmented } from '@/components/ui'
import { fuzzyMatch, formatKb } from '@/lib/util'
import { isDevServer, usePortsStore } from '@/stores/ports-store'
import { PortsTable } from './PortsTable'

function summarize(entries: PortEntry[]): { servers: number; kb: number } {
  const roots = new Map<number, number>()
  for (const e of entries) if (isDevServer(e)) roots.set(e.footprintPid, e.treeRssKb)
  return { servers: roots.size, kb: [...roots.values()].reduce((a, b) => a + b, 0) }
}

/** Machine-wide view of everything listening on localhost. */
export function PortsView(): React.JSX.Element {
  const snapshot = usePortsStore((s) => s.snapshot)
  const refresh = usePortsStore((s) => s.refresh)
  const [filter, setFilter] = useState<'dev' | 'all'>('dev')
  const [query, setQuery] = useState('')

  const all = snapshot?.entries ?? []
  const { servers, kb } = useMemo(() => summarize(all), [all])
  const visible = useMemo(() => {
    const base = filter === 'dev' ? all.filter(isDevServer) : all
    const q = query.trim()
    if (!q) return base
    return base.filter((e) => fuzzyMatch([String(e.port), e.name, e.framework ?? '', e.projectName ?? '', e.cmdline], q) >= 0)
  }, [all, filter, query])

  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ports</h1>
          <p className="mt-0.5 text-cx-muted">
            {snapshot ? (
              <>
                {servers} dev server{servers === 1 ? '' : 's'} using <span className="font-medium text-cx-text">{formatKb(kb)}</span>
                {snapshot.tookMs > 0 && <span className="text-cx-faint"> · scanned in {snapshot.tookMs} ms</span>}
              </>
            ) : (
              'Scanning…'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="no-drag flex h-8 w-56 items-center gap-2 rounded-lg border border-cx-border bg-cx-raised px-2.5 focus-within:border-cx-accent">
            <Search size={14} className="text-cx-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by port or name" aria-label="Filter ports" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-cx-faint" />
          </label>
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'dev', label: 'Dev servers' }, { value: 'all', label: 'All' }]} />
          <IconButton icon={RefreshCw} label="Refresh now" onClick={() => void refresh()} />
        </div>
      </div>

      {snapshot?.error && <p className="mb-4 rounded-lg bg-cx-danger/10 p-3 text-cx-danger" role="alert">Could not scan ports: {snapshot.error}</p>}

      {visible.length > 0 ? (
        <PortsTable entries={visible} />
      ) : snapshot ? (
        <EmptyState
          icon={Plug}
          title={query ? 'Nothing matches that filter' : filter === 'dev' ? 'No dev servers are listening' : 'Nothing is listening'}
          action={filter === 'dev' && all.length > 0 && !query ? <Button onClick={() => setFilter('all')}>Show all {all.length} listeners</Button> : undefined}
        >
          {filter === 'dev' && !query && 'Start a script from one of your projects and its port will show up here, with memory and a one-click stop.'}
        </EmptyState>
      ) : null}
    </div>
  )
}

/** The same table scoped to one project (including servers started from its sub-projects). */
export function ProjectPorts({ project }: { project: Project }): React.JSX.Element {
  const snapshot = usePortsStore((s) => s.snapshot)
  const entries = (snapshot?.entries ?? []).filter(
    (e) => e.cwd && (e.cwd === project.path || e.cwd.startsWith(project.path + '/'))
  )
  return (
    <div className="h-full overflow-y-auto px-page-x py-5">
      {entries.length > 0 ? (
        <PortsTable entries={entries} showProject={false} />
      ) : (
        <EmptyState icon={Plug} title="No servers running for this project">
          Run a script on the Scripts tab. Its port, memory and a stop button appear here.
        </EmptyState>
      )}
    </div>
  )
}
