import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ONBOARDING,
  nextOnboardingStep,
  onboardingComplete,
  onboardingSteps,
  onboardingVisible
} from '../src/shared/onboarding'
import { DEFAULT_SETTINGS, settingsPatchSchema, settingsSchema } from '../src/shared/settings'

const base = {
  hasFolder: true,
  trusted: false,
  ranScript: false,
  openedChanges: false,
  openedTasks: false,
  dismissed: false
}

describe('onboarding', () => {
  it('starts with add done when a folder exists, trust next', () => {
    const steps = onboardingSteps(base)
    expect(steps.find((s) => s.id === 'add')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'trust')?.done).toBe(false)
    expect(nextOnboardingStep(base)?.id).toBe('trust')
    expect(onboardingVisible(base)).toBe(true)
  })

  it('hides when dismissed', () => {
    expect(onboardingVisible({ ...base, dismissed: true })).toBe(false)
  })

  it('hides when every step is done', () => {
    const done = { ...base, trusted: true, ranScript: true, openedChanges: true, openedTasks: true }
    expect(onboardingComplete(done)).toBe(true)
    expect(onboardingVisible(done)).toBe(false)
    expect(nextOnboardingStep(done)).toBeNull()
  })

  it('defaults live in settings', () => {
    expect(settingsSchema.parse({}).onboarding).toEqual(DEFAULT_ONBOARDING)
    expect(DEFAULT_SETTINGS.onboarding).toEqual(DEFAULT_ONBOARDING)
  })

  it('accepts a partial onboarding patch', () => {
    const parsed = settingsPatchSchema.parse({ onboarding: { ranScript: true } })
    expect(parsed.onboarding).toEqual({ ranScript: true })
  })

  it('recovers a corrupt onboarding blob', () => {
    expect(settingsSchema.parse({ onboarding: { dismissed: true } }).onboarding).toEqual(DEFAULT_ONBOARDING)
  })
})
