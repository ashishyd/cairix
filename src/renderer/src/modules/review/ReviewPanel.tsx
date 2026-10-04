import { ArrowRight, Bot, CircleCheck, FileDiff, GitCompare, ScanSearch, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MODULES, isModuleEnabled } from '@shared/modules'
import { isReviewNestedId, isReviewSection, reviewTabFor, type ReviewNestedId, type ReviewSection } from '@shared/review'
import type { AgentTask, AuditState, ChangesState } from '@shared/types'
import { Button, Chip, Kbd, Segmented, Skeleton, StatusDot } from '@/components/ui'
import { Cost } from '@/lib/cost'
import { useShortcut } from '@/lib/commands'
import { cx, errMsg, timeAgo } from '@/lib/util'
import { AuditPanel } from '@/modules/audit/AuditPanel'
import { ChangesPanel } from '@/modules/changes/ChangesPanel'
import type { ProjectTabProps } from '@/modules/registry'
import { TasksPanel } from '@/modules/tasks/TasksPanel'
import { useSettingsStore } from '@/stores/settings-store'
import { useUiStore } from '@/stores/ui-store'

const SECTION_META: Record<ReviewNestedId, { title: string; icon: typeof GitCompare; blurb: string }> = {
  changes: { title: 'Changes', icon: GitCompare, blurb: 'Pending diff, instant checks, Claude review' },
  tasks: { title: 'Tasks', icon: Sparkles, blurb: 'Ask Claude or Cursor; apply edits after review' },
  audit: { title: 'Audit', icon: ScanSearch, blurb: 'On-demand pass across the whole project' }
}

function enabledReviewSections(enabled: Record<string, boolean>): ReviewNestedId[] {
  return (['changes', 'tasks', 'audit'] as const).filter((id) => {
    const m = MODULES.find((x) => x.id === id)
    return !!m && isModuleEnabled(m, enabled)
  })
}

function OverviewCard({
  icon: Icon,
  title,
  body,
  trailing,
  onOpen,
  tone = 'neutral'
}: {
  icon: typeof GitCompare
  title: string
  body: React.ReactNode
  trailing?: React.ReactNode
  onOpen: () => void
  tone?: 'neutral' | 'warning' | 'success' | 'danger'
}): React.JSX.Element {
  const tones = {
    neutral: 'border-cx-border bg-cx-raised',
    warning: 'border-cx-warning/35 bg-cx-warning/8',
    success: 'border-cx-success/35 bg-cx-success/8',
    danger: 'border-cx-danger/35 bg-cx-danger/8'
  }
  return (
    <button
      onClick={onOpen}
      className={cx('no-drag flex flex-col rounded-2xl border p-4 text-left transition-colors hover:bg-cx-hover/40', tones[tone])}
    >
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-cx-accent-text" />
        <span className="font-medium">{title}</span>
        <span className="flex-1" />
        {trailing}
        <ArrowRight size={14} className="text-cx-faint" />
      </div>
      <div className="mt-2 text-sm text-cx-muted">{body}</div>
    </button>
  )
}

function Overview({ project, workspace, sections, goSection }: ProjectTabProps & { sections: ReviewNestedId[]; goSection: (s: ReviewNestedId) => void }): React.JSX.Element {
  const [changes, setChanges] = useState<ChangesState | null>(null)
  const [tasks, setTasks] = useState<AgentTask[] | null>(null)
  const [audit, setAudit] = useState<AuditState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [c, t, a] = await Promise.all([
        sections.includes('changes') ? window.cairix.changes.get(project.id) : Promise.resolve(null),
        sections.includes('tasks') ? window.cairix.tasks.list(project.id) : Promise.resolve(null),
        sections.includes('audit') ? window.cairix.audit.status(project.id) : Promise.resolve(null)
      ])
      setChanges(c)
      setTasks(t)
      setAudit(a)
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [project.id, sections])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => !document.hidden && void refresh(), 5000)
    return () => clearInterval(id)
  }, [refresh])

  const awaitingApply = (tasks ?? []).filter((t) => t.status === 'done' && t.mode === 'edit' && t.changes)
  const runningTasks = (tasks ?? []).filter((t) => t.status === 'running')
  const findingCount = changes?.findings.length ?? 0
  const mustFix = changes?.findings.filter((f) => f.severity === 'error').length ?? 0
  const auditFindings = audit?.findings.length ?? 0
  const auditDone = audit && ['done', 'cancelled', 'error'].includes(audit.phase)

  if (error) return <p className="px-page-x py-5 text-cx-danger" role="alert">{error}</p>
  if ((sections.includes('changes') && !changes) || (sections.includes('tasks') && !tasks) || (sections.includes('audit') && !audit)) {
    return (
      <div className="space-y-3 px-8 py-6" aria-busy>
        <Skeleton rows={2} />
        <Skeleton rows={3} className="mt-2" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-page-x py-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Review workspace</h2>
        <p className="mt-0.5 text-cx-muted">
          {workspace.trusted
            ? 'Pending changes, agent work and audits — fix and learn without leaving this tab.'
            : 'Trust this folder to run AI review, tasks and audits. Instant change checks still work.'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {sections.includes('changes') && changes && (
          <OverviewCard
            icon={GitCompare}
            title="Changes"
            tone={mustFix > 0 ? 'danger' : findingCount > 0 ? 'warning' : changes.files.length > 0 ? 'neutral' : 'success'}
            trailing={
              mustFix > 0 ? <Chip tone="danger">{mustFix}</Chip>
                : findingCount > 0 ? <Chip tone="warning">{findingCount}</Chip>
                  : changes.files.length === 0 ? <Chip tone="success">clean</Chip>
                    : <Chip>{changes.files.length} files</Chip>
            }
            onOpen={() => goSection('changes')}
            body={
              !changes.isRepo ? 'Not a git repo yet — run git init to review diffs.'
                : changes.files.length === 0 ? 'Working tree is clean.'
                  : findingCount > 0
                    ? `${findingCount} finding${findingCount === 1 ? '' : 's'} on ${changes.files.length} changed file${changes.files.length === 1 ? '' : 's'}.`
                    : `${changes.files.length} changed file${changes.files.length === 1 ? '' : 's'} · instant checks clean${changes.ai.reviewed ? ' · AI reviewed' : ''}.`
            }
          />
        )}

        {sections.includes('tasks') && tasks && (
          <OverviewCard
            icon={Bot}
            title="Tasks"
            tone={awaitingApply.length > 0 ? 'warning' : runningTasks.length > 0 ? 'neutral' : 'success'}
            trailing={
              awaitingApply.length > 0 ? <Chip tone="warning">{awaitingApply.length} to apply</Chip>
                : runningTasks.length > 0 ? <Chip tone="accent">{runningTasks.length} running</Chip>
                  : <Chip>{tasks.length}</Chip>
            }
            onOpen={() => goSection('tasks')}
            body={
              awaitingApply.length > 0
                ? `${awaitingApply.length} finished edit${awaitingApply.length === 1 ? '' : 's'} waiting for Apply.`
                : runningTasks.length > 0
                  ? `${runningTasks.length} agent${runningTasks.length === 1 ? '' : 's'} working now.`
                  : tasks.length === 0
                    ? 'No tasks yet — describe a job in plain words.'
                    : `${tasks.length} task${tasks.length === 1 ? '' : 's'} in history.`
            }
          />
        )}

        {sections.includes('audit') && audit && (
          <OverviewCard
            icon={ScanSearch}
            title="Audit"
            tone={audit.phase === 'running' ? 'warning' : auditFindings > 0 ? 'warning' : auditDone ? 'success' : 'neutral'}
            trailing={
              audit.phase === 'running' ? <StatusDot tone="warning" pulse />
                : auditFindings > 0 ? <Chip tone="warning">{auditFindings}</Chip>
                  : auditDone ? <Chip tone="success">done</Chip>
                    : null
            }
            onOpen={() => goSection('audit')}
            body={
              audit.phase === 'running' ? (
                <>Auditing… {audit.progress.done}/{audit.progress.total} · {auditFindings} findings so far.</>
              ) : auditDone ? (
                auditFindings > 0 ? (
                  <>
                    {auditFindings} finding{auditFindings === 1 ? '' : 's'} from {audit.filesAnalyzed} files
                    {audit.finishedAt ? ` · ${timeAgo(audit.finishedAt)}` : ''}
                    {audit.costUsd !== undefined && audit.costUsd > 0 && <> · <Cost usd={audit.costUsd} /></>}
                    .
                  </>
                ) : (
                  <>Last audit was clean across {audit.filesAnalyzed} files.</>
                )
              ) : (
                'Run an on-demand audit when you want a full-project pass.'
              )
            }
          />
        )}
      </div>

      {(mustFix > 0 || awaitingApply.length > 0) && (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-cx-border bg-cx-surface px-4 py-3">
          <CircleCheck size={15} className="text-cx-accent-text" />
          <span className="text-base text-cx-muted">Start with what needs action:</span>
          {mustFix > 0 && (
            <Button size="sm" variant="primary" icon={FileDiff} onClick={() => goSection('changes')}>
              Fix {mustFix} change{mustFix === 1 ? '' : 's'}
            </Button>
          )}
          {awaitingApply.length > 0 && (
            <Button size="sm" variant={mustFix > 0 ? 'secondary' : 'primary'} icon={Sparkles} onClick={() => goSection('tasks')}>
              Review task edits
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function ReviewPanel({ project, workspace }: ProjectTabProps): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const view = useUiStore((s) => s.view)
  const enabled = useSettingsStore((s) => s.settings.enabledModules)
  const sections = useMemo(() => enabledReviewSections(enabled), [enabled])

  const rawTab = view.kind === 'project' && view.projectId === project.id ? view.tab : 'review'
  const section: ReviewSection = useMemo(() => {
    if (rawTab.startsWith('review:')) {
      const s = rawTab.slice('review:'.length)
      if (isReviewSection(s)) return s
    }
    if (isReviewNestedId(rawTab)) return rawTab
    return 'overview'
  }, [rawTab])

  // If the active nested module was turned off, fall back to overview.
  const active: ReviewSection = section !== 'overview' && !sections.includes(section) ? 'overview' : section

  function goSection(next: ReviewSection): void {
    go({ kind: 'project', projectId: project.id, tab: reviewTabFor(next) })
  }

  const segmentOptions = useMemo(() => {
    const opts: Array<{ value: ReviewSection; label: string }> = [{ value: 'overview', label: 'Overview' }]
    for (const id of sections) opts.push({ value: id, label: SECTION_META[id].title })
    return opts
  }, [sections])

  const tipReview = useShortcut('project.review')
  const tipChanges = useShortcut('project.changes')
  const tipTasks = useShortcut('project.tasks')
  const tipAudit = useShortcut('project.audit')
  const tipNext = useShortcut('review.section.next')
  const tipPrev = useShortcut('review.section.prev')
  const tipAi = useShortcut('review.ai')
  const tipNewTask = useShortcut('tasks.new')
  const activeTip =
    active === 'overview' ? tipReview
      : active === 'changes' ? tipChanges
        : active === 'tasks' ? tipTasks
          : tipAudit

  if (sections.length === 0) {
    return (
      <div className="px-page-x py-10 text-center text-cx-muted">
        All review modules are turned off. Enable Changes, Tasks or Audit under Settings → Modules.
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-cx-border/70 px-page-x py-3">
        <Segmented value={active} options={segmentOptions} onChange={goSection} />
        {active !== 'overview' && (
          <span className="min-w-0 flex-1 truncate text-sm text-cx-faint">{SECTION_META[active as ReviewNestedId]?.blurb}</span>
        )}
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-cx-faint">
          {activeTip && <><Kbd>{activeTip}</Kbd><span className="sr-only">Open this section</span></>}
          {tipPrev && tipNext && <><Kbd>{tipPrev}</Kbd><span>/</span><Kbd>{tipNext}</Kbd><span>sections</span></>}
          {active === 'changes' && tipAi && <><Kbd>{tipAi}</Kbd><span>AI</span></>}
          {active === 'tasks' && tipNewTask && <><Kbd>{tipNewTask}</Kbd><span>new</span></>}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {active === 'overview' && <Overview project={project} workspace={workspace} sections={sections} goSection={goSection} />}
        {active === 'changes' && <ChangesPanel project={project} workspace={workspace} />}
        {active === 'tasks' && <TasksPanel project={project} workspace={workspace} />}
        {active === 'audit' && <AuditPanel project={project} workspace={workspace} />}
      </div>
    </div>
  )
}
