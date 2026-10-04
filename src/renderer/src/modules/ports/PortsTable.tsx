import { ChevronDown, ChevronRight, Copy, ExternalLink, Globe, Info, Lock, X } from 'lucide-react'
import { useState } from 'react'
import type { PortEntry } from '@shared/types'
import { Chip, IconButton } from '@/components/ui'
import { ActionMenu } from '@/modules/actions/ActionMenu'
import { cx, errMsg, formatKb, formatUptime } from '@/lib/util'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'

const COLS = '76px minmax(0,1fr) 150px 96px 56px 124px'

async function open(entry: PortEntry): Promise<void> {
  try {
    await window.cairix.app.openExternal(`http://localhost:${entry.port}`)
  } catch (e) {
    toast.error(errMsg(e))
  }
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`Copied ${what}`)
  } catch {
    toast.error('Could not copy to the clipboard.')
  }
}

function Detail({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-[88px] shrink-0 text-cx-faint">{label}</span>
      <span className="selectable min-w-0 break-all font-mono text-xs text-cx-muted">{children}</span>
    </div>
  )
}

function Row({ e, maxKb, showProject, expanded, onToggle }: { e: PortEntry; maxKb: number; showProject: boolean; expanded: boolean; onToggle: () => void }): React.JSX.Element {
  const setKillTarget = useUiStore((s) => s.setKillTarget)
  const go = useUiStore((s) => s.go)
  const webLike = e.category !== 'database' && !e.protected

  return (
    <div className={cx('border-b border-cx-border/60 last:border-0', e.protected && 'opacity-80')}>
      <div className="group grid items-center gap-3 px-4 hover:bg-cx-hover/40" style={{ gridTemplateColumns: COLS, paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
        <span className="font-mono text-md font-semibold tabular-nums">{e.port}</span>

        <button onClick={onToggle} aria-expanded={expanded} className="min-w-0 text-left">
          <span className="flex items-center gap-1.5">
            {expanded ? <ChevronDown size={13} className="shrink-0 text-cx-faint" /> : <ChevronRight size={13} className="shrink-0 text-cx-faint" />}
            <span className="truncate font-medium" title={e.cmdline}>{e.name}</span>
            {e.framework && e.framework !== e.name && <Chip tone={e.category === 'database' ? 'warning' : 'accent'}>{e.framework}</Chip>}
            {e.exposed && !e.protected && <Chip tone="warning" title={`Bound to ${e.address}: other devices on your network can reach this`}><Globe size={10} /> network</Chip>}
            {e.runId && <Chip tone="success" title="Started from Cairix">Cairix</Chip>}
            {e.hint && (
              <span title={e.hint} className="shrink-0 text-cx-faint">
                <Info size={13} aria-label={e.hint} />
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate pl-[19px] text-sm text-cx-faint">
            up {formatUptime(e.uptimeSec)} · pid {e.pid}{e.hint ? ` · ${e.hint}` : ''}
          </span>
        </button>

        <span className="min-w-0 truncate text-cx-muted" title={e.cwd}>
          {e.projectId && showProject ? (
            <button className="truncate text-cx-accent-text hover:underline" onClick={() => go({ kind: 'project', projectId: e.projectId!, tab: 'scripts' })}>
              {e.projectName}
            </button>
          ) : (
            <span className="text-cx-faint">{showProject ? '·' : ''}</span>
          )}
        </span>

        <span>
          <span className="block tabular-nums" title={`This process: ${formatKb(e.rssKb)}`}>{formatKb(e.treeRssKb)}</span>
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-cx-hover">
            <span className="block h-full rounded-full bg-cx-accent/70" style={{ width: `${Math.max(3, Math.round((e.treeRssKb / Math.max(maxKb, 1)) * 100))}%` }} />
          </span>
        </span>

        <span className="tabular-nums text-cx-muted">{e.cpu.toFixed(e.cpu >= 10 ? 0 : 1)}%</span>

        <span className="flex justify-end">
          {e.protected ? (
            <span className="flex h-7 w-7 items-center justify-center text-cx-faint" title={e.protectReason}>
              <Lock size={14} aria-label={e.protectReason ?? 'Protected'} />
            </span>
          ) : (
            <>
              <ActionMenu hideWhenEmpty ctx={{ scope: 'port', projectId: e.projectId, port: e.port, pid: e.pid }} label={`Actions for :${e.port}`} />
              {webLike && <IconButton icon={ExternalLink} label={`Open localhost:${e.port}`} onClick={() => void open(e)} />}
              <IconButton icon={Copy} label="Copy URL" onClick={() => void copy(`http://localhost:${e.port}`, `http://localhost:${e.port}`)} />
              <IconButton icon={X} label={`Stop ${e.name} on :${e.port}`} tone="danger" onClick={() => setKillTarget(e)} />
            </>
          )}
        </span>
      </div>

      {expanded && (
        <div className="animate-fade bg-cx-surface/70 px-4 py-3 pl-[104px] text-sm">
          <Detail label="Command">{e.cmdline}</Detail>
          {e.cwd && <Detail label="Folder">{e.cwd}</Detail>}
          <Detail label="Listening on">{e.address}:{e.port}</Detail>
          <Detail label="Process">pid {e.pid} · parent {e.ppid} · user {e.user}</Detail>
          <Detail label="Memory">{formatKb(e.rssKb)} this process · {formatKb(e.treeRssKb)} with its launchers and workers</Detail>
          {e.protected && e.protectReason && <Detail label="Protected">{e.protectReason}</Detail>}
        </div>
      )}
    </div>
  )
}

export function PortsTable({ entries, showProject = true }: { entries: PortEntry[]; showProject?: boolean }): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)
  const maxKb = entries.reduce((m, e) => Math.max(m, e.treeRssKb), 0)
  return (
    <div className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
      <div className="grid gap-3 border-b border-cx-border bg-cx-surface px-4 py-2 cx-label" style={{ gridTemplateColumns: COLS }}>
        <span>Port</span>
        <span className="pl-[19px]">Process</span>
        <span>{showProject ? 'Project' : ''}</span>
        <span>Memory</span>
        <span>CPU</span>
        <span />
      </div>
      {entries.map((e) => {
        const key = `${e.pid}:${e.port}`
        return <Row key={key} e={e} maxKb={maxKb} showProject={showProject} expanded={expanded === key} onToggle={() => setExpanded(expanded === key ? null : key)} />
      })}
    </div>
  )
}
