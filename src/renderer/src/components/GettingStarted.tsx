import { Check, ChevronRight, Circle, X } from 'lucide-react'
import { onboardingComplete, onboardingSteps, onboardingVisible, type OnboardingStepId } from '@shared/onboarding'
import { Button, Chip } from '@/components/ui'
import { useProjectsStore } from '@/stores/projects-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUiStore } from '@/stores/ui-store'

/** Home checklist that teaches Trust → Run → Review → Task. Auto-hides when dismissed. */
export function GettingStarted(): React.JSX.Element | null {
  const workspaces = useProjectsStore((s) => s.workspaces)
  const onboarding = useSettingsStore((s) => s.settings.onboarding)
  const patch = useSettingsStore((s) => s.patch)
  const go = useUiStore((s) => s.go)
  const setAddFolder = useUiStore((s) => s.setAddFolder)

  const input = {
    hasFolder: workspaces.length > 0,
    trusted: workspaces.some((w) => w.trusted),
    ranScript: onboarding.ranScript,
    openedChanges: onboarding.openedChanges,
    openedTasks: onboarding.openedTasks,
    dismissed: onboarding.dismissed
  }

  if (onboarding.dismissed) return null
  if (!onboardingVisible(input) && !onboardingComplete(input)) return null

  const steps = onboardingSteps(input)
  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length
  const firstProject = workspaces.flatMap((w) => w.projects.map((p) => ({ project: p, workspace: w })))[0]
  const untrusted = workspaces.find((w) => !w.trusted)
  const nextId = steps.find((s) => !s.done)?.id

  function act(id: OnboardingStepId): void {
    if (id === 'add') {
      setAddFolder(true)
      return
    }
    if (id === 'trust') {
      const target = untrusted?.projects[0] ?? firstProject?.project
      if (target) go({ kind: 'project', projectId: target.id, tab: 'scripts' })
      return
    }
    if (!firstProject) {
      setAddFolder(true)
      return
    }
    const tab = id === 'run' ? 'scripts' : id === 'changes' ? 'changes' : 'tasks'
    go({ kind: 'project', projectId: firstProject.project.id, tab })
  }

  function dismiss(): void {
    void patch({ onboarding: { dismissed: true } })
  }

  if (allDone) {
    return (
      <section className="mb-5 flex items-center gap-3 rounded-2xl border border-cx-success/30 bg-cx-success/10 px-4 py-3 animate-fade">
        <Check size={18} className="shrink-0 text-cx-success" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-cx-success">You’re set up</p>
          <p className="text-sm text-cx-muted">Trust → Run → Review → Task. ⌘K finds anything; ⌘⇧2–5 jumps Review sections.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={dismiss}>Dismiss</Button>
      </section>
    )
  }

  return (
    <section className="mb-5 rounded-2xl border border-cx-border bg-cx-raised p-4 animate-fade" aria-label="Getting started">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Getting started</h2>
            <Chip tone="accent">{doneCount}/{steps.length}</Chip>
          </div>
          <p className="mt-0.5 text-sm text-cx-muted">Run it, fix it, learn it — five steps to the core loop.</p>
        </div>
        <button
          onClick={dismiss}
          className="no-drag rounded-md p-1 text-cx-faint hover:bg-cx-hover hover:text-cx-text"
          aria-label="Dismiss getting started"
          title="Dismiss"
        >
          <X size={15} />
        </button>
      </div>

      <ol className="space-y-1">
        {steps.map((step) => {
          const next = step.id === nextId
          return (
            <li key={step.id}>
              <button
                onClick={() => act(step.id)}
                disabled={step.done}
                className="no-drag flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors enabled:hover:bg-cx-hover/70 disabled:cursor-default"
              >
                <span className="mt-0.5 shrink-0">
                  {step.done ? <Check size={16} className="text-cx-success" /> : <Circle size={16} className={next ? 'text-cx-accent-text' : 'text-cx-faint'} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={step.done ? 'text-cx-muted line-through' : 'font-medium'}>{step.title}</span>
                  <span className="mt-0.5 block text-sm text-cx-faint">{step.detail}</span>
                </span>
                {!step.done && <ChevronRight size={14} className={`mt-1 shrink-0 ${next ? 'text-cx-accent-text' : 'text-cx-faint'}`} />}
              </button>
            </li>
          )
        })}
      </ol>

      {untrusted && (
        <p className="mt-2 px-2.5 text-sm text-cx-faint">Tip: on a project, click the “Not trusted” chip in the header.</p>
      )}
    </section>
  )
}
