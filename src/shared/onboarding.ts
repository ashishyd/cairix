/**
 * First-run activation: teach Trust → Run → Review → Task without a separate
 * tutorial app. Progress is mostly inferred from live state; a few milestones
 * are recorded in settings because they aren't otherwise durable.
 */

export interface OnboardingFlags {
  dismissed: boolean
  /** Set after Cairix successfully starts a script (runs aren't persisted across restarts). */
  ranScript: boolean
  /** Set the first time the user opens a project's Changes tab. */
  openedChanges: boolean
  /** Set the first time the user opens a project's Tasks tab. */
  openedTasks: boolean
}

export const DEFAULT_ONBOARDING: OnboardingFlags = {
  dismissed: false,
  ranScript: false,
  openedChanges: false,
  openedTasks: false
}

export type OnboardingStepId = 'add' | 'trust' | 'run' | 'changes' | 'tasks'

export interface OnboardingStep {
  id: OnboardingStepId
  title: string
  detail: string
  done: boolean
}

export interface OnboardingInput {
  hasFolder: boolean
  trusted: boolean
  ranScript: boolean
  openedChanges: boolean
  openedTasks: boolean
  dismissed: boolean
}

export function onboardingSteps(input: OnboardingInput): OnboardingStep[] {
  return [
    {
      id: 'add',
      title: 'Add a folder',
      detail: 'Point Cairix at a project or a folder of projects.',
      done: input.hasFolder
    },
    {
      id: 'trust',
      title: 'Trust a folder',
      detail: 'Unlocks Run, Tasks and Audit for that folder.',
      done: input.trusted
    },
    {
      id: 'run',
      title: 'Run a script',
      detail: 'One click from the Scripts tab — package.json, Make, Python, Compose.',
      done: input.ranScript
    },
    {
      id: 'changes',
      title: 'Open Review → Changes',
      detail: 'Instant checks, optional Claude review, one-click fix and learn links.',
      done: input.openedChanges
    },
    {
      id: 'tasks',
      title: 'Open Review → Tasks',
      detail: 'Ask Claude or Cursor in plain words; apply edits only after you review.',
      done: input.openedTasks
    }
  ]
}

export function onboardingVisible(input: OnboardingInput): boolean {
  if (input.dismissed) return false
  return onboardingSteps(input).some((s) => !s.done)
}

export function onboardingComplete(input: OnboardingInput): boolean {
  return onboardingSteps(input).every((s) => s.done)
}

/** Next incomplete step, or null when everything is done. */
export function nextOnboardingStep(input: OnboardingInput): OnboardingStep | null {
  return onboardingSteps(input).find((s) => !s.done) ?? null
}
