import { CircleCheck, CircleHelp, HardDrive, PackageSearch, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { DepsReport, DiskHog, HealthSnapshot, ToolCheck } from '@shared/types'
import { Button, Chip, Dialog, EmptyState } from '@/components/ui'
import { errMsg, formatKb } from '@/lib/util'
import { useProjectsStore } from '@/stores/projects-store'
import { toast } from '@/stores/toast-store'
import type { ProjectTabProps } from '../registry'

function Section({ title, label, aside, children }: { title: string; label: string; aside?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <section aria-label={label} className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
      <header className="flex items-center justify-between gap-2 border-b border-cx-border bg-cx-surface px-4 py-2">
        <h2 className="cx-label">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

function ToolRow({ t }: { t: ToolCheck }): React.JSX.Element {
  const Icon = t.ok === true ? CircleCheck : t.ok === false ? TriangleAlert : CircleHelp
  const tone = t.ok === true ? 'text-cx-success' : t.ok === false ? 'text-cx-warning' : 'text-cx-faint'
  return (
    <div className="flex items-start gap-3 border-b border-cx-border/60 px-4 py-2.5 last:border-0">
      <Icon size={16} className={`mt-0.5 shrink-0 ${tone}`} aria-label={t.ok === true ? 'OK' : t.ok === false ? 'Mismatch' : 'Unknown'} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t.tool}{' '}
          <span className="font-normal text-cx-muted">wants <span className="font-mono">{t.wanted}</span> <span className="text-cx-faint">({t.source})</span>{t.actual && <> · you have <span className="font-mono">{t.actual}</span></>}</span>
        </p>
        {t.hint && <p className="text-sm text-cx-warning">{t.hint}</p>}
      </div>
    </div>
  )
}

function DepsView({ report }: { report: DepsReport }): React.JSX.Element {
  const majors = report.outdated.filter((d) => d.major).length
  const v = report.vulns
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-cx-border/60 px-4 py-2.5">
        <Chip tone={report.outdated.length === 0 ? 'success' : 'warning'}>{report.outdated.length === 0 ? 'all up to date' : `${report.outdated.length} outdated`}</Chip>
        {majors > 0 && <Chip tone="warning">{majors} major</Chip>}
        {v && (v.total === 0 ? <Chip tone="success">no known vulnerabilities</Chip> : (
          <>
            {v.critical > 0 && <Chip tone="danger">{v.critical} critical</Chip>}
            {v.high > 0 && <Chip tone="danger">{v.high} high</Chip>}
            {v.moderate > 0 && <Chip tone="warning">{v.moderate} moderate</Chip>}
            {v.low > 0 && <Chip>{v.low} low</Chip>}
          </>
        ))}
        <span className="ml-auto text-xs text-cx-faint">via {report.manager}</span>
      </div>
      {report.vulnError && <p className="px-4 py-2 text-sm text-cx-muted">Vulnerability check unavailable: {report.vulnError}</p>}
      {v && v.top.length > 0 && (
        <ul aria-label="Vulnerabilities" className="border-b border-cx-border/60">
          {v.top.map((x) => (
            <li key={x.name} className="flex items-center gap-3 px-4 py-1.5">
              <Chip tone={x.severity === 'critical' || x.severity === 'high' ? 'danger' : x.severity === 'moderate' ? 'warning' : 'neutral'}>{x.severity}</Chip>
              <span className="font-mono text-sm">{x.name}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-cx-muted">{x.title}</span>
            </li>
          ))}
        </ul>
      )}
      {report.outdated.length > 0 && (
        <ul aria-label="Outdated dependencies">
          {report.outdated.map((d) => (
            <li key={d.name} className="flex items-center gap-3 border-b border-cx-border/60 px-4 py-1.5 last:border-0">
              <span className="w-[220px] shrink-0 truncate font-mono text-sm font-medium" title={d.name}>{d.name}</span>
              <span className="font-mono text-sm text-cx-muted">{d.current} → <span className="text-cx-text">{d.latest}</span></span>
              {d.major && <Chip tone="warning" title="A new major version: may contain breaking changes">major</Chip>}
              <span className="ml-auto text-xs text-cx-faint">{d.type === 'devDependencies' ? 'dev' : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="px-4 py-2 text-xs text-cx-faint">Run your package manager's update command to upgrade. Cairix only reports.</p>
    </div>
  )
}

/** Is this project set up the way it asks to be, are its dependencies fresh and safe, and what is it costing in disk? */
export function HealthPanel({ project, workspace }: ProjectTabProps): React.JSX.Element {
  const setTrust = useProjectsStore((s) => s.setTrust)
  const [snap, setSnap] = useState<HealthSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<DepsReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [cleaning, setCleaning] = useState<DiskHog | null>(null)
  const [cleanBusy, setCleanBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setSnap(await window.cairix.health.scan(project.id))
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [project.id])

  useEffect(() => {
    setSnap(null)
    setReport(null)
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  async function check(): Promise<void> {
    setChecking(true)
    try {
      setReport(await window.cairix.health.deps(project.id))
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setChecking(false)
    }
  }

  async function clean(): Promise<void> {
    if (!cleaning) return
    setCleanBusy(true)
    try {
      setSnap(await window.cairix.health.clean(project.id, cleaning.name))
      toast.success(`Removed ${cleaning.name} (${formatKb(cleaning.sizeKb)})`)
      setCleaning(null)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setCleanBusy(false)
    }
  }

  const total = snap?.hogs.reduce((a, h) => a + h.sizeKb, 0) ?? 0
  const hasPackage = snap?.manager !== undefined

  return (
    <div className="h-full space-y-4 overflow-y-auto px-page-x py-5">
      {error && <p className="rounded-lg bg-cx-danger/10 p-3 text-cx-danger" role="alert">{error}</p>}
      {!workspace.trusted && (
        <div className="flex items-center gap-3 rounded-xl border border-cx-warning/30 bg-cx-warning/10 px-4 py-3" role="alert">
          <ShieldAlert size={18} className="shrink-0 text-cx-warning" />
          <p className="min-w-0 flex-1 text-cx-muted">Trust this folder to check dependencies or clean folders: both run commands in it.</p>
          <Button variant="primary" onClick={() => void setTrust(workspace.id, true)}>Trust folder</Button>
        </div>
      )}

      <Section title="Tool versions" label="Tool versions">
        {!snap ? <p className="px-4 py-3 text-cx-muted">Checking…</p> : snap.tools.length === 0 ? <p className="px-4 py-3 text-cx-muted">This project does not pin a Node, Python, Ruby or Go version, so there is nothing to compare. Add an <span className="font-mono">.nvmrc</span> or <span className="font-mono">engines</span> field to catch “works on my machine”.</p> : snap.tools.map((t) => <ToolRow key={`${t.tool}:${t.source}`} t={t} />)}
      </Section>

      {hasPackage && (
        <Section title="Dependencies" label="Dependencies" aside={<Button size="sm" icon={PackageSearch} busy={checking} disabled={!workspace.trusted} onClick={() => void check()}>{report ? 'Check again' : 'Check for updates & vulnerabilities'}</Button>}>
          {report?.error ? <p className="px-4 py-3 text-cx-warning">{report.error}</p> : report ? <DepsView report={report} /> : <p className="px-4 py-3 text-cx-muted">Looks up newer versions and known vulnerabilities. This uses the network, so it only runs when you ask.</p>}
        </Section>
      )}

      <Section title="Disk space" label="Disk space" aside={total > 0 ? <span className="text-sm text-cx-muted">{formatKb(total)} can be reclaimed</span> : undefined}>
        {!snap ? <p className="px-4 py-3 text-cx-muted">Measuring…</p> : snap.hogs.length === 0 ? (
          <EmptyState icon={HardDrive} title="Nothing big to clean here">Folders like node_modules and build output show up here once they take real space.</EmptyState>
        ) : snap.hogs.map((h) => (
          <div key={h.name} className="flex items-center gap-3 border-b border-cx-border/60 px-4 last:border-0" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-sm font-medium">{h.name}</span>
              <span className="block text-sm text-cx-faint">Comes back with <span className="font-mono">{h.regenerate}</span></span>
            </span>
            <span className="w-20 text-right tabular-nums">{formatKb(h.sizeKb)}</span>
            <Button size="sm" icon={Trash2} disabled={!workspace.trusted} aria-label={`Clean ${h.name}`} onClick={() => setCleaning(h)}>Clean</Button>
          </div>
        ))}
      </Section>

      {cleaning && (
        <Dialog title={`Delete ${cleaning.name}?`} onClose={() => setCleaning(null)} width={480} footer={<><Button onClick={() => setCleaning(null)} disabled={cleanBusy}>Cancel</Button><Button variant="danger" busy={cleanBusy} onClick={() => void clean()}>Delete</Button></>}>
          <p className="text-cx-muted">This removes <span className="font-mono text-cx-text">{cleaning.name}</span> from <span className="font-medium text-cx-text">{project.name}</span> and frees {formatKb(cleaning.sizeKb)}. Nothing in it is tracked by git.</p>
          <p className="mt-2 text-cx-muted">To get it back, run <span className="font-mono text-cx-text">{cleaning.regenerate}</span>.</p>
        </Dialog>
      )}
    </div>
  )
}
