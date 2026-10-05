/**
 * Settings types and defaults with NO runtime dependencies. The renderer
 * imports this file (not ./settings), so the validation library stays out of
 * the UI bundle. ./settings checks that its zod schema matches these types.
 */
import { DEFAULT_DASHBOARD, type DashboardItem } from './dashboard'
import { DEFAULT_LEARN, type LearnSettings } from './learn'
import { DEFAULT_ONBOARDING, type OnboardingFlags } from './onboarding'

export const ACCENTS = ['blue', 'green', 'amber', 'violet', 'rose', 'slate'] as const
export type Accent = (typeof ACCENTS)[number]

/** Which finished jobs may raise a macOS notification. */
export interface NotificationSettings {
  enabled: boolean
  /** Stay quiet while a Cairix window is focused (you can already see it). */
  onlyInBackground: boolean
  /** Scripts and servers: failures, and long runs that finish. */
  runs: boolean
  /** Agent tasks finishing or failing. */
  tasks: boolean
  /** Audits finishing or failing. */
  audits: boolean
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = { enabled: true, onlyInBackground: true, runs: true, tasks: true, audits: true }

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
  /** Script ids Cairix restarts by itself when they crash. */
  autoRestartScripts: string[]
  /** Open Cairix (in the menu bar, without a window) when you log in. */
  launchAtLogin: boolean
  /** commandId -> combo. '' = unbound, absent = the command's default. */
  keybindings: Record<string, string>
  /** First-run checklist progress (milestones that aren't always inferable). */
  onboarding: OnboardingFlags
  notifications: NotificationSettings
  /** Daily learning: what to study, and how hard. */
  learn: LearnSettings
}

/** Partial update from the UI. Onboarding may be incomplete and is merged server-side. */
export type SettingsPatch = Omit<Partial<Settings>, 'onboarding' | 'notifications' | 'learn'> & {
  learn?: Partial<LearnSettings>
  onboarding?: Partial<OnboardingFlags>
  notifications?: Partial<NotificationSettings>
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
  autoRestartScripts: [],
  launchAtLogin: false,
  keybindings: {},
  onboarding: DEFAULT_ONBOARDING,
  notifications: DEFAULT_NOTIFICATIONS,
  learn: DEFAULT_LEARN
}
