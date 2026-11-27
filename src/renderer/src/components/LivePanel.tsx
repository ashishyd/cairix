import { Square } from 'lucide-react'
import { useMemo } from 'react'
import { cx, formatKb } from '@/lib/util'
import { busyCount, useAgentsStore } from '@/stores/agents-store'
import { isDevServer, usePortsStore } from '@/stores/ports-store'
import { isActive, useScriptsStore } from '@/stores/scripts-store'
import { useUiStore } from '@/stores/ui-store'
import { IconButton, StatusDot } from './ui'

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="cx-label">{title}</h3>
      {children.length > 0 ? children : <p className="text-sm text-cx-faint">{empty}</p>}
    </section>
  )
}

const rowClass = 'no-drag flex w-full items-center gap-2.5 rounded-lg border border-cx-border bg-cx-raised px-2.5 py-2 text-left'

/** What is running right now, so you do not have to visit three pages to find out. Every number comes from a store that already exists. */
export function LivePanel(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const runs = useScriptsStore((s) => s.runs)
  const stop = useScriptsStore((s) => s.stop)
  const agents = useAgentsStore((s) => s.snapshot)
  const ports = usePortsStore((s) => s.snapshot)

  const active = useMemo(() => Object.values(runs).filter(isActive).sort((a, b) => b.startedAt - a.startedAt), [runs])
  const working = (agents?.sessions ?? []).filter((s) => s.status !== 'idle')
  const servers = useMemo(() => {
    const byTree = new Map<number, NonNullable<typeof ports>['entries'][number]>()
    for (const e of (ports?.entries ?? []).filter(isDevServer)) if (!byTree.has(e.footprintPid)) byTree.set(e.footprintPid, e)
    return [...byTree.values()]
  }, [ports])
  const memKb = servers.reduce((n, e) => n + e.treeRssKb, 0)

  return (
    <aside aria-label="Live now" className="hidden w-[272px] shrink-0 flex-col gap-5 xl:flex overflow-y-auto border-l border-cx-border bg-cx-surface p-4">
      <h2 className="text-md font-semibold">Live now</h2>

      <Group title="Scripts" empty="Nothing is running.">
        {active.map((r) => (
          <div key={r.runId} className={rowClass}>
            <StatusDot tone="success" pulse />
            <button className="min-w-0 flex-1 text-left" onClick={() => go({ kind: 'project', projectId: r.projectId, tab: 'scripts' })}>
              <span className="block truncate font-medium">{r.scriptName}</span>
              <span className="block truncate text-xs text-cx-faint">{r.projectName}{r.ports.length > 0 ? ` · :${r.ports.join(', :')}` : ''}</span>
            </button>
            <IconButton icon={Square} label={`Stop ${r.scriptName}`} size={13} onClick={() => void stop(r.runId)} />
          </div>
        ))}
      </Group>

      <Group title="Agents" empty="No agents working.">
        {working.map((s) => (
          <button key={s.id} className={cx(rowClass, 'hover:bg-cx-hover')} onClick={() => go({ kind: 'machine', page: 'agents' })}>
            <StatusDot tone="warning" pulse />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.title}</span>
              <span className="block truncate text-xs text-cx-faint">{s.kind === 'claude' ? 'Claude Code' : 'Cursor'}{s.projectName ? ` · ${s.projectName}` : ''}</span>
            </span>
          </button>
        ))}
      </Group>

      <Group title="Dev servers" empty="No dev servers listening.">
        {servers.slice(0, 5).map((e) => (
          <button key={e.footprintPid} className={cx(rowClass, 'hover:bg-cx-hover')} onClick={() => go({ kind: 'machine', page: 'ports' })}>
            <span className="w-11 shrink-0 font-mono text-sm font-medium tabular-nums">{e.port}</span>
            <span className="min-w-0 flex-1 truncate text-cx-muted">{e.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-cx-faint">{formatKb(e.treeRssKb)}</span>
          </button>
        ))}
      </Group>

      {servers.length > 0 && (
        <p className="text-xs text-cx-faint">
          Dev servers use <span className="font-medium tabular-nums text-cx-muted">{formatKb(memKb)}</span>
          {busyCount(agents) > 0 ? ` · ${busyCount(agents)} busy ${busyCount(agents) === 1 ? 'agent' : 'agents'}` : ''}.
        </p>
      )}
    </aside>
  )
}
