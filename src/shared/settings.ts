import { z } from 'zod'
import { comboProblem } from './keybindings'
import { DEFAULT_LEARN, LEVELS, MAX_TOPICS, MAX_TOPIC_LENGTH } from './learn'
import { DEFAULT_ONBOARDING } from './onboarding'
import { ACCENTS, DEFAULT_NOTIFICATIONS, DEFAULT_SETTINGS, type Settings } from './settings-types'

export { ACCENTS, DEFAULT_SETTINGS }
export type { Accent, Settings, SettingsPatch } from './settings-types'

const onboardingSchema = z.object({
  dismissed: z.boolean(),
  ranScript: z.boolean(),
  openedChanges: z.boolean(),
  openedTasks: z.boolean()
})

const notificationsSchema = z.object({
  enabled: z.boolean(),
  onlyInBackground: z.boolean(),
  runs: z.boolean(),
  tasks: z.boolean(),
  audits: z.boolean()
})

const learnSchema = z.object({
  topics: z.array(z.string().min(1).max(MAX_TOPIC_LENGTH)).max(MAX_TOPICS),
  level: z.enum(LEVELS),
  autoGenerate: z.boolean()
})

/** Field validators, without defaults: shared by the full schema and the patch schema. */
const fields = {
  theme: z.enum(['system', 'light', 'dark']),
  accent: z.enum(ACCENTS),
  density: z.enum(['comfortable', 'compact']),
  fontSize: z.number().int().min(12).max(16),
  vibrancy: z.boolean(),
  globalHotkey: z.string().max(64),
  enabledModules: z.record(z.string().max(64), z.boolean()),
  trayShowsPortCount: z.boolean(),
  reviewWithAi: z.boolean(),
  dashboard: z.array(z.object({ id: z.string().max(40), type: z.string().max(40), size: z.enum(['half', 'full']) })).max(24),
  pinnedScripts: z.array(z.string().max(200)).max(50),
  autoRestartScripts: z.array(z.string().max(200)).max(100),
  launchAtLogin: z.boolean(),
  keybindings: z.record(z.string().max(80), z.string().max(40).refine((v) => v === '' || comboProblem(v) === null, 'Not a usable shortcut')).refine((r) => Object.keys(r).length <= 200),
  onboarding: onboardingSchema,
  notifications: notificationsSchema,
  learn: learnSchema
}

/**
 * User preferences as stored. Everything has a default so a missing or
 * partially corrupt settings file degrades to defaults instead of breaking
 * startup, and unknown keys from a newer version are dropped on read.
 */
export const settingsSchema = z.object({
  theme: fields.theme.default(DEFAULT_SETTINGS.theme),
  accent: fields.accent.default(DEFAULT_SETTINGS.accent),
  density: fields.density.default(DEFAULT_SETTINGS.density),
  fontSize: fields.fontSize.default(DEFAULT_SETTINGS.fontSize),
  vibrancy: fields.vibrancy.default(DEFAULT_SETTINGS.vibrancy),
  globalHotkey: fields.globalHotkey.default(DEFAULT_SETTINGS.globalHotkey),
  enabledModules: fields.enabledModules.default(DEFAULT_SETTINGS.enabledModules),
  trayShowsPortCount: fields.trayShowsPortCount.default(DEFAULT_SETTINGS.trayShowsPortCount),
  reviewWithAi: fields.reviewWithAi.default(DEFAULT_SETTINGS.reviewWithAi),
  dashboard: fields.dashboard.default(DEFAULT_SETTINGS.dashboard),
  pinnedScripts: fields.pinnedScripts.default(DEFAULT_SETTINGS.pinnedScripts),
  autoRestartScripts: fields.autoRestartScripts.default(DEFAULT_SETTINGS.autoRestartScripts),
  launchAtLogin: fields.launchAtLogin.default(DEFAULT_SETTINGS.launchAtLogin),
  // Lenient on read: one bad hand-edited shortcut must not throw away every other setting. The patch schema stays strict.
  keybindings: z.record(z.string().max(80), z.string().max(40)).default(DEFAULT_SETTINGS.keybindings),
  onboarding: onboardingSchema.default(DEFAULT_ONBOARDING).catch(DEFAULT_ONBOARDING),
  notifications: notificationsSchema.default(DEFAULT_NOTIFICATIONS).catch(DEFAULT_NOTIFICATIONS),
  learn: learnSchema.default(DEFAULT_LEARN).catch(DEFAULT_LEARN)
})

/**
 * A partial update from the UI. Deliberately built from the default-less
 * fields: in zod 4 `.partial()` on the schema above would re-apply every
 * default, so patching one key would silently reset all the others.
 * Onboarding accepts a partial object; main merges it into the stored flags.
 */
export const settingsPatchSchema = z
  .object({ ...fields, onboarding: onboardingSchema.partial(), notifications: notificationsSchema.partial(), learn: learnSchema.partial() })
  .partial()
  .strict()

// Compile-time guarantee that the schema and the dependency-free type agree.
type Parsed = z.infer<typeof settingsSchema>
const _schemaMatchesType: [Parsed] extends [Settings] ? ([Settings] extends [Parsed] ? true : never) : never = true
void _schemaMatchesType
