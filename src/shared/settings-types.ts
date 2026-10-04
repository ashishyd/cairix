/**
 * Settings types and defaults with NO runtime dependencies. The renderer
 * imports this file (not ./settings), so the validation library stays out of
 * the UI bundle. ./settings checks that its zod schema matches these types.
 */
import { DEFAULT_DASHBOARD, type DashboardItem } from './dashboard'
import { DEFAULT_ONBOARDING, type OnboardingFlags } from './onboarding'

export const ACCENTS = ['blue', 'green', 'amber', 'violet', 'rose', 'slate'] as const
export type Accent = (typeof ACCENTS)[number]

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  accent: Accent
  density: 'comfortable' | 'compact'
  fontSize: number
  vibrancy: boolean
  /** Electron accelerator, e.g. `CommandOrControl+Alt+K`. Empty disables it. */
  globalHotkey: string
  /** moduleId -> enabled. Absent means "use the module's default". */
  enabledModules: Record<string, boolean>
  /** Show the live dev-server count next to the menu bar icon. */
  trayShowsPortCount: boolean
  /** Run the AI review automatically when pending changes settle (uses your Claude quota). Instant checks always run. */
  reviewWithAi: boolean
  /** The Home dashboard: ordered widgets. */
  dashboard: DashboardItem[]
  /** Script ids pinned to the Home dashboard. */
  pinnedScripts: string[]
  /** commandId -> combo. '' = unbound, absent = the command's default. */
  keybindings: Record<string, string>
  /** First-run checklist progress (milestones that aren't always inferable). */
  onboarding: OnboardingFlags
}

/** Partial update from the UI. Onboarding may be incomplete and is merged server-side. */
export type SettingsPatch = Omit<Partial<Settings>, 'onboarding'> & {
  onboarding?: Partial<OnboardingFlags>
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: 'blue',
  density: 'comfortable',
  fontSize: 13,
  vibrancy: true,
  globalHotkey: 'CommandOrControl+Alt+K',
  enabledModules: {},
  trayShowsPortCount: true,
  reviewWithAi: false,
  dashboard: DEFAULT_DASHBOARD,
  pinnedScripts: [],
  keybindings: {},
  onboarding: DEFAULT_ONBOARDING
}
