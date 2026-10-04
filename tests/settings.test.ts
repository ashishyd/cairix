import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, settingsPatchSchema, settingsSchema } from '../src/shared/settings'

describe('settings schemas', () => {
  it('fills every default for an empty or partial stored file', () => {
    expect(settingsSchema.parse({})).toEqual(DEFAULT_SETTINGS)
    expect(settingsSchema.parse({ theme: 'dark' })).toEqual({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('drops unknown keys from a newer version instead of failing', () => {
    expect(settingsSchema.parse({ theme: 'light', somethingNew: 1 })).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' })
  })

  it('a patch contains ONLY the keys that were sent (no re-applied defaults)', () => {
    // Regression guard: zod 4's partial() on the defaulted schema would return every key here.
    expect(settingsPatchSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' })
    expect(settingsPatchSchema.parse({})).toEqual({})
  })

  it('rejects invalid values and unknown patch keys', () => {
    expect(settingsPatchSchema.safeParse({ theme: 'neon' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ fontSize: 40 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ notASetting: true }).success).toBe(false)
  })
})
