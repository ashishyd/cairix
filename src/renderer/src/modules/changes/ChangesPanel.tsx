import { CircleCheck, FileDiff, GitBranch, RotateCcw, Sparkles, TriangleAlert, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CAIRIX_COMMAND_EVENT } from '@shared/keybindings'
import type { ChangesState, Finding } from '@shared/types'
import { Button, Chip, EmptyState, InlineAlert, Kbd, Skeleton } from '@/components/ui'
import { useShortcut } from '@/lib/commands'
import { errMsg } from '@/lib/util'
import type { ProjectTabProps } from '@/modules/registry'
import { FindingCard } from './FindingCard'
import { useFixes } from './useFixes'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { Cost } from '@/lib/cost'

const POLL_MS = 4000
/** How long the diff must stay unchanged before an automatic AI review starts. */
const SETTLE_MS = 20_000

export function ChangesPanel({ project, workspace }: ProjectTabProps): React.JSX.Element {
  const [state, setState] = useState<ChangesState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const autoAi = useSettingsStore((s) => s.settings.reviewWithAi)
  const stable = useRef<{ fp: string; since: number }>({ fp: '', since: 0 })
  const attempted = useRef('')

  const refresh = useCallback(async () => {
    try {
      const next = await window.cairix.changes.get(project.id)
      setState((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
      setError(null)
      if (stable.current.fp !== next.fingerprint) stable.current = { fp: next.fingerprint, since: Date.now() }
    } catch (e) {
      setError(errMsg(e))
    }
  }, [project.id])

  useEffect(() => {
    setState(null)
    void refresh()
    const t = setInterval(() => !document.hidden && void refresh(), POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  const runAi = useCallback(async () => {
    setState((s) => (s ? { ...s, ai: { ...s.ai, reviewing: true, error: undefined } } : s))
    try {
      setState(await window.cairix.changes.review(project.id))
    } catch (e) {
      toast.error(errMsg(e))
      void refresh()
    }
  }, [project.id, refresh])

  const aiShortcut = useShortcut('review.ai')
  const stateRef = useRef(state)
  stateRef.current = state

  // ⌘⇧R (and the command palette) land here after navigating to Changes.
  useEffect(() => {
    const onCommand = (e: Event): void => {
      if ((e as CustomEvent<string>).detail !== 'review.ai') return
      const s = stateRef.current
      if (!s) return
      if (!workspace.trusted) return void toast.info('Trust this folder first')
      if (!s.ai.available) return void toast.info('Claude CLI not found')
      if (s.files.length === 0) return void toast.info('No pending changes to review')
      if (s.ai.reviewing) return
      void runAi()
    }
    window.addEventListener(CAIRIX_COMMAND_EVENT, onCommand)
    return () => window.removeEventListener(CAIRIX_COMMAND_EVENT, onCommand)
  }, [runAi, workspace.trusted])

  // Automatic AI review once the diff has been quiet for a while (opt-in: it uses your Claude quota).
  useEffect(() => {
    if (!autoAi || !state || !workspace.trusted) return
    if (!state.ai.available || state.ai.reviewed || state.ai.reviewing || state.files.length === 0) return
    if (attempted.current === state.fingerprint) return // one attempt per diff, so a failure can't loop
    const wait = Math.max(0, SETTLE_MS - (Date.now() - stable.current.since))
    const t = setTimeout(() => {
      attempted.current = state.fingerprint
      void runAi()
    }, wait)
    return () => clearTimeout(t)
  }, [autoAi, state, workspace.trusted, runAi])

  const { work, applied, fix, apply, discard, undo, reset } = useFixes((id) => window.cairix.changes.fix(project.id, id), () => void refresh())
  useEffect(reset, [project.id, reset])

  async function ignore(f: Finding): Promise<void> {
    try {
      setState(await window.cairix.changes.dismiss(project.id, f.id))
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  if (error && !state) return <div className="px-page-x py-8"><InlineAlert tone="danger">{error}</InlineAlert></div>
  if (!state) {
    return (
      <div className="space-y-3 px-page-x py-8" aria-busy aria-label="Checking for changes">
        <Skeleton rows={2} />
        <Skeleton rows={4} className="mt-4" />
      </div>
    )
  }
  if (!state.isRepo) {
    return <EmptyState icon={GitBranch} title="Not a git repository">Changes can be reviewed once this folder is under git. Run <span className="font-mono text-sm">git init</span> to start.</EmptyState>
  }

  const { ai } = state
  const noFindings = state.findings.length === 0
  const errors = state.findings.filter((f) => f.severity === 'error').length
  const warnings = state.findings.filter((f) => f.severity === 'warning').length
  const infos = state.findings.filter((f) => f.severity === 'info').length
  // Instant findings already give something to act on — keep AI review available but secondary.
  const aiPrimary = noFindings && !ai.reviewed
  return (
    <div className="h-full overflow-y-auto px-page-x py-5">
      <div className="flex flex-wrap items-center gap-3">
        <Chip><GitBranch size={11} /> {state.branch ?? 'detached'}</Chip>
        <span className="text-cx-muted">
          {state.files.length === 0 ? 'No pending changes' : `${state.files.length} changed file${state.files.length === 1 ? '' : 's'}`}
          {state.files.length > 0 && <span className="text-cx-faint"> · +{state.files.reduce((n, f) => n + f.additions, 0)} −{state.files.reduce((n, f) => n + f.deletions, 0)}</span>}
        </span>
        {!noFindings && (
          <span className="flex flex-wrap items-center gap-1.5">
            {errors > 0 && <Chip tone="danger">{errors} must fix</Chip>}
            {warnings > 0 && <Chip tone="warning">{warnings} should fix</Chip>}
            {infos > 0 && <Chip tone="accent">{infos} tips</Chip>}
          </span>
        )}
        <span className="flex-1" />
        {ai.reviewed && <span className="text-sm text-cx-faint">Reviewed by Claude{ai.costUsd !== undefined && <> · <Cost usd={ai.costUsd} /></>}</span>}
        <Button
          size="sm"
          variant={aiPrimary ? 'primary' : 'secondary'}
          icon={ai.reviewed ? RotateCcw : Sparkles}
          busy={ai.reviewing}
          disabled={!ai.available || state.files.length === 0 || !workspace.trusted}
          title={!ai.available ? 'Claude CLI not found' : !workspace.trusted ? 'Trust this folder first' : aiShortcut ? `Sends only the changed lines to your local Claude CLI (${aiShortcut})` : 'Sends only the changed lines to your local Claude CLI'}
          onClick={() => void runAi()}
        >
          {ai.reviewing ? 'Reviewing…' : ai.reviewed ? 'Review again' : 'Review with AI'}
          {!ai.reviewing && aiShortcut && <Kbd>{aiShortcut}</Kbd>}
        </Button>
      </div>

      {ai.error && <div className="mt-3"><InlineAlert tone="warning" icon={TriangleAlert}>AI review didn't run: {ai.error} Your instant checks below still apply.</InlineAlert></div>}

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

      {state.files.length > 0 && (
        <details className="mt-4 rounded-xl border border-cx-border bg-cx-raised">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-cx-muted">Changed files</summary>
          <ul className="border-t border-cx-border/60 px-4 py-2 font-mono text-xs">
            {state.files.map((f) => (
              <li key={f.path} className="flex gap-3 py-0.5"><span className="w-4 text-cx-faint">{f.status}</span><span className="min-w-0 flex-1 truncate">{f.path}</span><span className="text-cx-success">+{f.additions}</span><span className="text-cx-danger">−{f.deletions}</span></li>
            ))}
          </ul>
        </details>
      )}

      {state.files.length === 0 ? (
        <EmptyState icon={FileDiff} title="Nothing to review">Edit some files and Cairix checks the changes automatically within a few seconds.</EmptyState>
      ) : noFindings ? (
        <EmptyState icon={CircleCheck} title="No issues found">
          {ai.reviewed ? 'Instant checks and the AI review both came back clean.' : 'The instant checks came back clean. Run the AI review for a deeper look at logic and security.'}
        </EmptyState>
      ) : (
        <ul className="mt-5 space-y-3" aria-label="Findings">
          {state.findings.map((f) => (
            <FindingCard key={f.id} f={f} projectId={project.id} trusted={workspace.trusted} work={work[f.id] ?? {}} onFix={() => void fix(f)} onApply={() => void apply(f)} onDiscard={() => discard(f.id)} onIgnore={() => void ignore(f)} />
          ))}
        </ul>
      )}
      {state.dismissedCount > 0 && <p className="mt-4 text-center text-sm text-cx-faint">{state.dismissedCount} ignored finding{state.dismissedCount === 1 ? '' : 's'}</p>}
    </div>
  )
}
