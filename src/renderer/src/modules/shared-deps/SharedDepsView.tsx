import { ChevronDown, ChevronRight, Layers, ScanSearch, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SharedDepsReport, SharedPackageGroup } from '@shared/types'
import { Button, Chip, Dialog, EmptyState, PageHeader } from '@/components/ui'
import { errMsg, formatKb } from '@/lib/util'
import { toast } from '@/stores/toast-store'

function GroupRow({ g, checked, open, onCheck, onToggle }: { g: SharedPackageGroup; checked: boolean; open: boolean; onCheck: (v: boolean) => void; onToggle: () => void }): React.JSX.Element {
  const blocked = g.copies.filter((c) => !c.trusted).length
  return (
    <li className="border-b border-cx-border/60 last:border-0">
      <div className="flex items-center gap-3 px-4" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Share ${g.key}`} />
        <button onClick={onToggle} aria-expanded={open} className="no-drag flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="truncate font-mono text-sm font-medium">{g.name}</span>
          <span className="font-mono text-sm text-cx-muted">{g.version}</span>
          <Chip>{g.copies.length} copies</Chip>
          {blocked > 0 && <Chip tone="warning" title="Copies in untrusted folders are left alone">{blocked} untrusted</Chip>}
        </button>
        <span className="w-24 text-right tabular-nums" title="Frees about this much">{formatKb(g.reclaimableKb)}</span>
      </div>
      {open && (
        <ul className="bg-cx-surface px-4 py-2 pl-12">
          {g.copies.map((c) => (
            <li key={c.path} className="flex items-center gap-3 py-0.5 text-sm">
              <span className="w-40 shrink-0 truncate text-cx-muted" title={c.projectName}>{c.projectName}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-cx-faint" title={c.path}>{c.path}</span>
              <span className="tabular-nums text-cx-muted">{formatKb(c.sizeKb)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** Packages installed at the same version in several projects, and one click to share a single copy on disk. */
export function SharedDepsView(): React.JSX.Element {
  const [report, setReport] = useState<SharedDepsReport | null>(null)
  const [scanning, setScanning] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  async function scan(): Promise<void> {
    setScanning(true)
    try {
      const r = await window.cairix.sharedDeps.scan()
      setReport(r)
      setPicked(new Set(r.groups.map((g) => g.key)))
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setScanning(false)
    }
  }

  async function apply(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.cairix.sharedDeps.apply([...picked])
      setReport(r.report)
      setPicked(new Set(r.report.groups.map((g) => g.key)))
      setConfirm(false)
      const saved = r.applied.reduce((a, x) => a + x.savedKb, 0)
      toast.success(`Shared ${r.applied.length} package${r.applied.length === 1 ? '' : 's'} · freed ${formatKb(saved)}`)
      if (r.skipped.length) toast.error(`${r.skipped.length} skipped: ${r.skipped[0].reason}`)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function prune(): Promise<void> {
    try {
      const r = await window.cairix.sharedDeps.prune()
      toast.success(r.removed ? `Removed ${r.removed} unused shared cop${r.removed === 1 ? 'y' : 'ies'} (${formatKb(r.freedKb)})` : 'Nothing unused in the shared store')
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const selectedKb = useMemo(() => report?.groups.filter((g) => picked.has(g.key)).reduce((a, g) => a + g.reclaimableKb, 0) ?? 0, [report, picked])
  const toggle = (set: Set<string>, key: string, on: boolean): Set<string> => {
    const n = new Set(set)
    if (on) n.add(key)
    else n.delete(key)
    return n
  }

  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <PageHeader
        title="Shared deps"
        subtitle={report ? `${report.packages} packages in ${report.projects} projects · ${formatKb(report.reclaimableKb)} can be freed` : 'Find packages installed at the same version in several projects.'}
        actions={
          <>
            <Button icon={Trash2} onClick={() => void prune()}>Clean up unused</Button>
            <Button variant={report ? 'secondary' : 'primary'} icon={ScanSearch} busy={scanning} onClick={() => void scan()}>{report ? 'Scan again' : 'Scan projects'}</Button>
          </>
        }
      />
      {!report ? (
        <EmptyState icon={Layers} title={scanning ? 'Scanning node_modules…' : 'Nothing scanned yet'}>
          Looks inside every project you added for packages with the same name and version, and works out how much disk one shared copy would save. Scanning changes nothing.
        </EmptyState>
      ) : report.groups.length === 0 ? (
        <EmptyState icon={Layers} title="No duplicates worth sharing">Every package version is either installed once or already shared.</EmptyState>
      ) : (
        <>
          <section aria-label="Duplicate packages" className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
            <header className="flex items-center justify-between gap-2 border-b border-cx-border bg-cx-surface px-4 py-2">
              <h2 className="cx-label">Installed more than once</h2>
              <span className="text-sm text-cx-muted">{picked.size} of {report.groups.length} selected</span>
            </header>
            <ul>
              {report.groups.map((g) => (
                <GroupRow key={g.key} g={g} checked={picked.has(g.key)} open={open.has(g.key)} onCheck={(v) => setPicked((s) => toggle(s, g.key, v))} onToggle={() => setOpen((s) => toggle(s, g.key, !s.has(g.key)))} />
              ))}
            </ul>
          </section>
          <div className="mt-4 flex items-center justify-end gap-3">
            <span className="text-sm text-cx-muted">Frees about {formatKb(selectedKb)}</span>
            <Button variant="primary" icon={Layers} disabled={picked.size === 0} onClick={() => setConfirm(true)}>Share selected</Button>
          </div>
        </>
      )}
      {confirm && (
        <Dialog title={`Share ${picked.size} package${picked.size === 1 ? '' : 's'}?`} onClose={() => setConfirm(false)} width={520} footer={<><Button onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => void apply()}>Share</Button></>}>
          <p className="text-cx-muted">Identical files in each project's <span className="font-mono text-cx-text">node_modules</span> become hard links to one copy kept in <span className="font-mono text-cx-text">{report?.storeDir}</span>. Frees about {formatKb(selectedKb)}.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-cx-muted">
            <li>Nothing moves: the folders look the same and Node resolves modules as before.</li>
            <li>Only trusted projects with no running script are changed; files that differ are skipped.</li>
            <li>A tool that edits a file inside node_modules in place (such as patch-package) would change it in every project that shares it.</li>
            <li>To undo, delete <span className="font-mono">node_modules</span> and reinstall.</li>
          </ul>
        </Dialog>
      )}
    </div>
  )
}
