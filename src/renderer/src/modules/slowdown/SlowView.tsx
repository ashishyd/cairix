import { Gauge, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { SlowFinding, SlowReport } from '@shared/types'
import { Button, Chip, Dialog, EmptyState, IconButton, InlineAlert, PageHeader, Skeleton, StatusDot } from '@/components/ui'
import { cx, errMsg } from '@/lib/util'
import { toast } from '@/stores/toast-store'

const TONE = { high: 'danger', medium: 'warning', low: 'muted' } as const

/** What is slowing this Mac down, worst first, with a confirmed one-click fix where it is safe. */
export function SlowView(): React.JSX.Element {
  const [report, setReport] = useState<SlowReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // `force` flips on after a polite stop did not work.
  const [confirm, setConfirm] = useState<{ finding: SlowFinding; force: boolean } | null>(null)
  const [fixing, setFixing] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setReport(await window.cairix.slowdown.diagnose())
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  async function fix(): Promise<void> {
    if (!confirm) return
    setFixing(true)
    try {
      const r = await window.cairix.slowdown.fix(confirm.finding.id, confirm.force)
      setReport(r.report)
      if (r.stuck) return setConfirm({ finding: confirm.finding, force: true })
      setConfirm(null)
      if (r.ok) toast.success(r.message)
      else toast.error(r.message)
    } catch (e) {
      toast.error(errMsg(e))
      setConfirm(null)
    } finally {
      setFixing(false)
    }
  }

  const stuck = confirm?.force
  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <PageHeader
        title="Slow Mac"
        subtitle={report ? `Load ${report.load1.toFixed(1)} on ${report.cores} cores · checked ${new Date(report.at).toLocaleTimeString()}` : 'Checking…'}
        actions={<IconButton icon={RefreshCw} label="Check again" onClick={() => void check()} disabled={checking} />}
      />
      {error ? (
        <EmptyState icon={Gauge} title="Could not check this Mac" action={<Button onClick={() => void check()}>Try again</Button>}>
          <span className="selectable">{error}</span>
        </EmptyState>
      ) : !report ? (
        <Skeleton rows={4} />
      ) : report.findings.length === 0 ? (
        <EmptyState icon={Gauge} title="Nothing is slowing this Mac right now" action={<Button onClick={() => void check()}>Check again</Button>}>
          If it still feels slow, run this while it happens: CPU, memory, disk and heat are read at that moment.
        </EmptyState>
      ) : (
        <>
        <section aria-label="Summary" className="mb-4 flex flex-wrap items-center gap-5 rounded-xl border border-cx-border bg-cx-raised p-4">
          <div className="min-w-[240px] flex-1">
            <p className="text-lg font-semibold tracking-tight">{report.findings[0].title}</p>
            <p className="mt-0.5 text-cx-muted">
              {report.findings.length} {report.findings.length === 1 ? 'cause' : 'causes'} found, worst first.{' '}
              {report.findings.filter((f) => f.fix).length > 0 ? `${report.findings.filter((f) => f.fix).length} can be fixed here, each after you confirm.` : 'None can be fixed from here.'}
            </p>
          </div>
          <div className="w-52" aria-label={`Load ${report.load1.toFixed(1)} on ${report.cores} cores`}>
            <div className="mb-1 flex justify-between text-xs text-cx-faint"><span>CPU load</span><span className="tabular-nums">{report.load1.toFixed(1)} / {report.cores}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-cx-hover"><i className={cx('block h-full rounded-full', report.load1 / report.cores >= 1 ? 'bg-cx-danger' : report.load1 / report.cores >= 0.7 ? 'bg-cx-warning' : 'bg-cx-success')} style={{ width: `${Math.min(100, (report.load1 / report.cores) * 100)}%` }} /></div>
          </div>
        </section>
        <section aria-label="Causes" className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
          {report.findings.map((f) => (
            <div key={f.id} className="flex items-start gap-3 border-b border-cx-border/60 px-4 last:border-0" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
              <span className="mt-1.5"><StatusDot tone={TONE[f.severity]} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">{f.title}{f.severity === 'high' && <Chip tone="danger">Biggest</Chip>}</span>
                <span className="selectable block text-sm text-cx-muted">{f.detail}</span>
              </span>
              {f.fix && <Button size="sm" onClick={() => setConfirm({ finding: f, force: false })}>{f.fix.label}</Button>}
            </div>
          ))}
        </section>
        </>
      )}
      {confirm && (
        <Dialog
          title={stuck ? 'Force stop?' : confirm.finding.fix?.label ?? 'Fix'}
          description={confirm.finding.title}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="danger" busy={fixing} disabled={fixing} onClick={() => void fix()}>{stuck ? 'Force stop' : confirm.finding.fix?.label}</Button>
            </>
          }
        >
          {stuck && <InlineAlert tone="warning">It is still running after a polite stop request. Force stop ends it immediately; unsaved work in it is lost.</InlineAlert>}
          <p className="selectable mt-2 text-cx-muted">{confirm.finding.detail}</p>
        </Dialog>
      )}
    </div>
  )
}
