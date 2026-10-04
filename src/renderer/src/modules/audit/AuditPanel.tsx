import { ChevronDown, CircleCheck, ClipboardCopy, ScanSearch, Square, TriangleAlert, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AUDIT_CATEGORIES, type AuditCategory, type AuditPlan, type AuditState, type Severity } from '@shared/types'
import { Button, Chip, EmptyState, InlineAlert } from '@/components/ui'
import { cx, errMsg, timeAgo } from '@/lib/util'
import { FindingCard } from '@/modules/changes/FindingCard'
import { useFixes } from '@/modules/changes/useFixes'
import type { ProjectTabProps } from '@/modules/registry'
import { toast } from '@/stores/toast-store'
import { Cost } from '@/lib/cost'

const LABEL: Record<AuditCategory, string> = {
  bugs: 'Bugs',
  security: 'Security',
  performance: 'Performance',
  accessibility: 'Accessibility',
  ux: 'UI / UX',
  maintainability: 'Maintainability'
}

export function auditReport(name: string, s: AuditState): string {
  const by = (sev: Severity): number => s.findings.filter((f) => f.severity === sev).length
  const lines = [
    `# Code audit: ${name}`,
    '',
    `${s.filesAnalyzed} files analysed · ${by('error')} must fix · ${by('warning')} should fix · ${by('info')} suggestions`,
    ''
  ]
  for (const f of s.findings) {
    lines.push(`## ${f.title}`, `\`${f.file}${f.line ? `:${f.line}` : ''}\` · ${f.severity} · ${f.category}`, '', f.explanation, '')
    if (f.learn) lines.push(`Learn: [${f.learn.title}](${f.learn.url})`, '')
  }
  return lines.join('\n')
}

export function AuditPanel({ project, workspace }: ProjectTabProps): React.JSX.Element {
  const [cats, setCats] = useState<AuditCategory[]>([...AUDIT_CATEGORIES])
  const [plan, setPlan] = useState<AuditPlan | null>(null)
  const [state, setState] = useState<AuditState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sev, setSev] = useState<Severity | 'all'>('all')
  const [cat, setCat] = useState<string>('all')
  const [setupOpen, setSetupOpen] = useState(true)

  const reload = useCallback(async () => {
    try {
      setState(await window.cairix.audit.status(project.id))
    } catch (e) {
      setError(errMsg(e))
    }
  }, [project.id])
  const { work, applied, fix, apply, undo, discard, reset } = useFixes((id) => window.cairix.audit.fix(project.id, id), () => void 0)

  useEffect(() => {
    setState(null)
    setPlan(null)
    setSetupOpen(true)
    reset()
    void reload()
  }, [project.id, reload, reset])

  // What the audit would do, refreshed as categories change. Nothing is sent anywhere yet.
  useEffect(() => {
    if (cats.length === 0) return setPlan(null)
    let live = true
    const t = setTimeout(() => {
      window.cairix.audit.plan(project.id, { categories: cats }).then((p) => live && setPlan(p), (e) => live && setError(errMsg(e)))
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [project.id, cats])

  const running = state?.phase === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void reload(), 900)
    return () => clearInterval(t)
  }, [running, reload])

  async function start(): Promise<void> {
    setError(null)
    setSev('all')
    setCat('all')
    reset()
    try {
      setState(await window.cairix.audit.start(project.id, { categories: cats }))
      setSetupOpen(false)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const visible = useMemo(() => (state?.findings ?? []).filter((f) => (sev === 'all' || f.severity === sev) && (cat === 'all' || f.category === cat)), [state, sev, cat])
  const categoriesPresent = useMemo(() => [...new Set((state?.findings ?? []).map((f) => f.category))].sort(), [state])
  const counts = (s: Severity): number => (state?.findings ?? []).filter((f) => f.severity === s).length
  const finished = state && ['done', 'cancelled', 'error'].includes(state.phase)
  const canStart = !!plan && plan.files > 0 && plan.aiAvailable && workspace.trusted && cats.length > 0 && !running
  const hasResults = !!(state && state.phase !== 'idle' && (state.findings.length > 0 || finished))
  const showSetup = !running && (setupOpen || !hasResults)

  // Collapse setup once when results first appear (initial load or run finish).
  useEffect(() => {
    if (finished) setSetupOpen((open) => (hasResults ? false : open))
  }, [finished, hasResults])

  return (
    <div className="h-full overflow-y-auto px-page-x py-5">
      {error && <div className="mb-4"><InlineAlert tone="danger">{error}</InlineAlert></div>}

      {hasResults && !running && !showSetup && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-cx-muted">Last audit results below. Start a new run when you want a fresh pass.</p>
          <Button size="sm" icon={ScanSearch} onClick={() => setSetupOpen(true)}>New audit</Button>
        </div>
      )}

      {showSetup && (
        <section className="rounded-xl border border-cx-border bg-cx-raised p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold"><ScanSearch size={17} className="text-cx-accent-text" /> Audit this project</h2>
              <p className="mt-1 text-cx-muted">Claude reads your source files and reports real problems, each with a one-click fix and a link to learn why. Free instant checks run first.</p>
            </div>
            {hasResults && (
              <Button size="sm" variant="ghost" icon={ChevronDown} onClick={() => setSetupOpen(false)}>Hide</Button>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="What to look for">
            {AUDIT_CATEGORIES.map((c) => {
              const on = cats.includes(c)
              return (
                <button key={c} role="checkbox" aria-checked={on} onClick={() => setCats(on ? cats.filter((x) => x !== c) : [...cats, c])} className={cx('no-drag rounded-lg border px-3 py-1 text-sm font-medium transition-colors', on ? 'border-cx-accent bg-cx-accent/12 text-cx-accent-text' : 'border-cx-border text-cx-muted hover:bg-cx-hover')}>
                  {LABEL[c]}
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button variant="primary" icon={ScanSearch} disabled={!canStart} onClick={() => void start()} title={!workspace.trusted ? 'Trust this folder first' : !plan?.aiAvailable ? 'Claude CLI not found' : undefined}>
              {finished ? 'Run audit again' : 'Run audit'}
            </Button>
            {plan ? (
              plan.files === 0 ? (
                <span className="text-cx-muted">No source files found to audit.</span>
              ) : (
                <span className="text-sm text-cx-muted">
                  Will analyse <b className="font-medium text-cx-text">{plan.files}</b>{plan.totalFiles > plan.files ? ` of ${plan.totalFiles}` : ''} files · ~{Math.round(plan.tokensEstimate / 1000)}k tokens · {plan.requests} request{plan.requests === 1 ? '' : 's'} · never more than <b className="font-medium text-cx-text"><Cost usd={plan.maxCostUsd} digits={2} limit /></b>
                </span>
              )
            ) : (
              <span className="text-cx-faint">Planning…</span>
            )}
          </div>
          {plan && plan.totalFiles > plan.files && <p className="mt-2 text-sm text-cx-faint">The project is larger than one audit covers, so application code is analysed first and tests last.</p>}
          {plan && !plan.isRepo && <div className="mt-2"><InlineAlert tone="warning">Not a git repository: you can audit, but one-click fixes need git.</InlineAlert></div>}
          {plan && !plan.aiAvailable && <div className="mt-2"><InlineAlert tone="warning">Claude CLI not found, so only the free instant checks can run.</InlineAlert></div>}
        </section>
      )}

      {running && state && (
        <section className="rounded-xl border border-cx-border bg-cx-raised p-5" aria-live="polite">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Auditing…</h2>
            <Button size="sm" icon={Square} onClick={() => void window.cairix.audit.cancel(project.id).then(setState)}>Cancel</Button>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-cx-hover" role="progressbar" aria-valuemin={0} aria-valuemax={state.progress.total} aria-valuenow={state.progress.done}>
            <div className="h-full rounded-full bg-cx-accent transition-all" style={{ width: `${state.progress.total ? Math.max(4, (state.progress.done / state.progress.total) * 100) : 4}%` }} />
          </div>
          <p className="mt-2 text-sm text-cx-muted">
            {state.progress.done} of {state.progress.total} requests · {state.findings.length} findings so far · <Cost usd={state.costUsd} /> used
          </p>
        </section>
      )}

      {state?.phase === 'error' && <div className="mt-4"><InlineAlert tone="warning" icon={TriangleAlert}>The audit couldn't finish: {state.error}</InlineAlert></div>}
      {state?.phase === 'done' && state.error && <div className="mt-4"><InlineAlert tone="warning" icon={TriangleAlert}>{state.error}</InlineAlert></div>}

      {applied.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {applied.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg bg-cx-success/10 px-3 py-2 text-cx-success animate-fade">
              <CircleCheck size={15} /> <span className="min-w-0 flex-1 truncate">Applied to {p.files.join(', ')}</span>
              <Button size="sm" variant="ghost" icon={Undo2} onClick={() => void undo(p)}>Undo</Button>
            </li>
          ))}
        </ul>
      )}

      {hasResults && state && (
        <section className={cx(showSetup || running ? 'mt-5' : undefined)}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Results</h2>
            <Chip tone="danger">{counts('error')} must fix</Chip>
            <Chip tone="warning">{counts('warning')} should fix</Chip>
            <Chip tone="accent">{counts('info')} suggestions</Chip>
            {state.compared && <Chip title={`Compared with the audit ${timeAgo(state.compared.at)}`}>{state.compared.newCount} new · {state.compared.fixedCount} gone</Chip>}
            <span className="flex-1" />
            {finished && state.costUsd > 0 && <span className="text-sm text-cx-faint"><Cost usd={state.costUsd} /> · {state.filesAnalyzed} files</span>}
            {finished && state.findings.length > 0 && (
              <Button size="sm" icon={ClipboardCopy} onClick={() => void navigator.clipboard.writeText(auditReport(project.name, state)).then(() => toast.success('Report copied as Markdown'))}>Copy report</Button>
            )}
          </div>

          {state.findings.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {(['all', 'error', 'warning', 'info'] as const).map((s) => (
                <button key={s} onClick={() => setSev(s)} aria-pressed={sev === s} className={cx('no-drag rounded-lg px-2.5 py-0.5 font-medium', sev === s ? 'bg-cx-text text-cx-bg' : 'text-cx-muted hover:bg-cx-hover')}>
                  {s === 'all' ? 'All' : s === 'error' ? 'Must fix' : s === 'warning' ? 'Should fix' : 'Suggestions'}
                </button>
              ))}
              <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category" className="no-drag ml-2 rounded-md border border-cx-border bg-cx-raised px-2 py-0.5">
                <option value="all">Every category</option>
                {categoriesPresent.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {finished && state.findings.length === 0 && state.phase === 'done' ? (
            <EmptyState icon={CircleCheck} title="No issues found">Nothing worth flagging in {state.filesAnalyzed} files. That's a good result.</EmptyState>
          ) : (
            <ul className="mt-4 space-y-3" aria-label="Audit findings">
              {visible.map((f) => (
                <FindingCard key={f.id} f={f} projectId={project.id} trusted={workspace.trusted} work={work[f.id] ?? {}} onFix={() => void fix(f)} onApply={() => void apply(f)} onDiscard={() => discard(f.id)} onIgnore={() => void window.cairix.audit.dismiss(project.id, f.id).then(setState)} />
              ))}
            </ul>
          )}
          {state.dismissedCount > 0 && <p className="mt-4 text-center text-sm text-cx-faint">{state.dismissedCount} ignored finding{state.dismissedCount === 1 ? '' : 's'}</p>}
        </section>
      )}
    </div>
  )
}
