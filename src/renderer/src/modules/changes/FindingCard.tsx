import { BookOpen, CircleAlert, FileDiff, Info, Lightbulb, Sparkles, TriangleAlert, Wand2, X } from 'lucide-react'
import type { Finding, FixProposal, Severity } from '@shared/types'
import { Button, Chip } from '@/components/ui'
import { ActionMenu } from '@/modules/actions/ActionMenu'
import { cx, errMsg } from '@/lib/util'
import { toast } from '@/stores/toast-store'
import { Cost } from '@/lib/cost'

const SEVERITY: Record<Severity, { icon: typeof Info; tone: string; label: string }> = {
  error: { icon: CircleAlert, tone: 'text-cx-danger', label: 'Must fix' },
  warning: { icon: TriangleAlert, tone: 'text-cx-warning', label: 'Should fix' },
  info: { icon: Lightbulb, tone: 'text-cx-accent-text', label: 'Suggestion' }
}

export function PatchView({ patch }: { patch: string }): React.JSX.Element {
  return (
    <pre className="selectable max-h-[220px] overflow-auto rounded-lg border border-cx-border bg-cx-surface py-1.5 font-mono text-xs leading-[1.6]" aria-label="Proposed change">
      {patch.split('\n').filter((l) => !l.startsWith('---') && !l.startsWith('+++') && !l.startsWith('diff ') && !l.startsWith('index ')).map((l, i) => (
        <div key={i} className={cx('whitespace-pre px-3', l.startsWith('+') && 'bg-cx-success/12 text-cx-success', l.startsWith('-') && 'bg-cx-danger/10 text-cx-danger', l.startsWith('@@') && 'text-cx-faint')}>
          {l || ' '}
        </div>
      ))}
    </pre>
  )
}

export interface Work {
  busy?: 'preparing' | 'applying'
  proposal?: FixProposal
  error?: string
}

export function FindingCard({ f, projectId, trusted, work, onFix, onApply, onDiscard, onIgnore }: {
  f: Finding
  projectId: string
  trusted: boolean
  work: Work
  onFix: () => void
  onApply: () => void
  onDiscard: () => void
  onIgnore: () => void
}): React.JSX.Element {
  const sev = SEVERITY[f.severity]
  const Icon = sev.icon
  return (
    <li className="rounded-xl border border-cx-border bg-cx-raised p-4 animate-fade">
      <div className="flex items-start gap-3">
        <Icon size={17} className={cx('mt-0.5 shrink-0', sev.tone)} aria-label={sev.label} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{f.title}</h3>
            <Chip tone={f.severity === 'error' ? 'danger' : f.severity === 'warning' ? 'warning' : 'accent'}>{sev.label}</Chip>
            <Chip>{f.category}</Chip>
            {f.origin === 'ai' && <Chip tone="accent"><Sparkles size={10} /> AI</Chip>}
          </div>
          <p className="mt-0.5 font-mono text-xs text-cx-faint">{f.file}{f.line ? `:${f.line}` : ''}</p>
          <p className="selectable mt-2 text-cx-muted">{f.explanation}</p>
        </div>
      </div>

      {work.proposal ? (
        <div className="mt-3 space-y-2.5">
          <p className="flex items-center gap-2 text-sm text-cx-muted">
            <FileDiff size={13} /> {work.proposal.by === 'quick-fix' ? 'Instant fix' : 'Fix prepared by Claude in a throwaway copy'}: {work.proposal.files.join(', ')}
            {work.proposal.costUsd !== undefined && <span className="text-cx-faint"> · <Cost usd={work.proposal.costUsd} /></span>}
          </p>
          <PatchView patch={work.proposal.patch} />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" busy={work.busy === 'applying'} onClick={onApply}>Apply to my files</Button>
            <Button size="sm" onClick={onDiscard}>Discard</Button>
            <span className="self-center text-sm text-cx-faint">Nothing has changed yet. You can undo after applying.</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={f.quickFix ? Wand2 : Sparkles}
            busy={work.busy === 'preparing'}
            disabled={!trusted}
            title={trusted ? undefined : 'Trust this folder first'}
            onClick={onFix}
          >
            {work.busy === 'preparing' ? (f.quickFix ? 'Preparing…' : 'Claude is working…') : f.quickFix ? 'Quick fix' : 'Fix with Claude'}
          </Button>
          {f.learn && (
            <button
              onClick={() => void window.cairix.app.openExternal(f.learn!.url).catch((e) => toast.error(errMsg(e)))}
              title={f.learn.title}
              className="no-drag inline-flex h-7 items-center gap-1.5 rounded-lg border border-cx-border px-2.5 text-sm font-medium text-cx-text hover:bg-cx-hover"
            >
              <BookOpen size={13} className="text-cx-accent-text" /> Learn: {f.learn.title} <span className="text-cx-faint">· {f.learn.source}</span>
            </button>
          )}
          <Button variant="ghost" size="sm" icon={X} onClick={onIgnore} title="Hide this finding">Ignore</Button>
          <ActionMenu hideWhenEmpty ctx={{ scope: 'finding', projectId, file: f.file, line: f.line }} label="Actions for this finding" />
        </div>
      )}
      {work.error && <p className="mt-2 text-cx-danger" role="alert">{work.error}</p>}
    </li>
  )
}

