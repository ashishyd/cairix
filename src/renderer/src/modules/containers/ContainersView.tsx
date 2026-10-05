import { Container, FileText, Play, RefreshCw, RotateCw, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContainerAction, ContainerInfo, ContainersSnapshot } from '@shared/types'
import { Button, Chip, Dialog, EmptyState, IconButton, StatusDot } from '@/components/ui'
import { errMsg } from '@/lib/util'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'

const STANDALONE = 'Standalone containers'

function Logs({ c, onClose }: { c: ContainerInfo; onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const box = useRef<HTMLPreElement>(null)
  const load = useCallback(async () => {
    try {
      setText(await window.cairix.containers.logs(c.id, 400))
    } catch (e) {
      setText(`Could not read logs: ${errMsg(e)}`)
    }
  }, [c.id])
  useEffect(() => void load(), [load])
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [text])
  return (
    <Dialog title={`Logs · ${c.name}`} onClose={onClose} width={860} footer={<><Button icon={RefreshCw} onClick={() => void load()}>Refresh</Button><Button variant="primary" onClick={onClose}>Close</Button></>}>
      <pre ref={box} aria-label={`Logs of ${c.name}`} className="selectable h-[380px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-cx-border bg-cx-surface p-3 font-mono text-xs">{text === null ? 'Loading…' : text || 'No output yet.'}</pre>
      <p className="mt-2 text-xs text-cx-faint">The last 400 lines. Tokens are masked.</p>
    </Dialog>
  )
}

function Row({ c, busy, onAction, onLogs }: { c: ContainerInfo; busy: boolean; onAction: (a: ContainerAction) => void; onLogs: () => void }): React.JSX.Element {
  const running = c.state === 'running' || c.state === 'restarting'
  return (
    <div className="flex items-center gap-3 border-b border-cx-border/60 px-4 last:border-0 hover:bg-cx-hover/40" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
      <StatusDot tone={c.state === 'running' ? 'success' : c.state === 'restarting' ? 'warning' : 'muted'} pulse={c.state === 'running'} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{c.name}</span>
          {c.composeService && c.composeService !== c.name && <Chip title="Compose service">{c.composeService}</Chip>}
        </span>
        <span className="block truncate text-sm text-cx-faint" title={`${c.image} · ${c.ports || 'no published ports'}`}>{c.image}{c.ports ? ` · ${c.ports}` : ''}</span>
      </span>
      <span className="w-40 shrink-0 truncate text-sm text-cx-muted" title={c.status}>{c.status}</span>
      <span className="flex shrink-0 items-center gap-0.5">
        <IconButton icon={FileText} label={`Logs of ${c.name}`} onClick={onLogs} />
        {running ? (
          <>
            <IconButton icon={RotateCw} label={`Restart ${c.name}`} disabled={busy} onClick={() => onAction('restart')} />
            <IconButton icon={Square} label={`Stop ${c.name}`} tone="danger" disabled={busy} onClick={() => onAction('stop')} />
          </>
        ) : (
          <IconButton icon={Play} label={`Start ${c.name}`} disabled={busy} onClick={() => onAction('start')} />
        )}
      </span>
    </div>
  )
}

/** Docker containers on this Mac, grouped by Compose project. */
export function ContainersView(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const [snap, setSnap] = useState<ContainersSnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [logs, setLogs] = useState<ContainerInfo | null>(null)

  const refresh = useCallback(async () => {
    try {
      setSnap(await window.cairix.containers.list())
    } catch (e) {
      toast.error(errMsg(e))
    }
  }, [])

  // Poll while this page is open and the window is visible.
  useEffect(() => {
    void refresh()
    const t = setInterval(() => !document.hidden && void refresh(), 4000)
    return () => clearInterval(t)
  }, [refresh])

  async function act(c: ContainerInfo, action: ContainerAction): Promise<void> {
    setBusy(c.id)
    try {
      setSnap(await window.cairix.containers.action(c.id, action))
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, ContainerInfo[]>()
    for (const c of snap?.containers ?? []) map.set(c.composeProject ?? STANDALONE, [...(map.get(c.composeProject ?? STANDALONE) ?? []), c])
    return [...map].sort(([a], [b]) => (a === STANDALONE ? 1 : b === STANDALONE ? -1 : a.localeCompare(b)))
  }, [snap])
  const running = snap?.containers.filter((c) => c.state === 'running').length ?? 0

  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Containers</h1>
          <p className="mt-0.5 text-cx-muted">{!snap ? 'Asking Docker…' : snap.available ? `${running} running · ${snap.containers.length} total` : 'Docker is not available'}</p>
        </div>
        <IconButton icon={RefreshCw} label="Refresh now" onClick={() => void refresh()} />
      </div>

      {snap && !snap.available ? (
        <EmptyState icon={Container} title={snap.reason ?? 'Docker is not available'} action={<Button onClick={() => void refresh()}>Check again</Button>}>
          Containers appear here, grouped by Compose project, with start, stop, restart and logs.
        </EmptyState>
      ) : snap && snap.containers.length === 0 ? (
        <EmptyState icon={Container} title="No containers yet">Run <span className="font-mono">docker compose up</span> in a project and its services show up here.</EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map(([name, list]) => {
            const projectId = list.find((c) => c.projectId)?.projectId
            const projectName = list.find((c) => c.projectName)?.projectName
            return (
              <section key={name} aria-label={name} className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
                <header className="flex items-center gap-2 border-b border-cx-border bg-cx-surface px-4 py-2">
                  <h2 className="font-medium">{name}</h2>
                  <Chip>{list.filter((c) => c.state === 'running').length}/{list.length} running</Chip>
                  {projectId && <button onClick={() => go({ kind: 'project', projectId, tab: 'scripts' })} className="no-drag text-sm text-cx-accent-text hover:underline">{projectName}</button>}
                </header>
                {list.map((c) => <Row key={c.id} c={c} busy={busy === c.id} onAction={(a) => void act(c, a)} onLogs={() => setLogs(c)} />)}
              </section>
            )
          })}
        </div>
      )}
      {logs && <Logs c={logs} onClose={() => setLogs(null)} />}
    </div>
  )
}
