import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import { DEFAULT_SETTINGS, settingsSchema, type Settings, type SettingsPatch } from '@shared/settings'
import { readJson, writeJsonAtomic } from './json-store'

let current: Settings | null = null
const listeners = new Set<(s: Settings) => void>()

const settingsFile = (): string => join(app.getPath('userData'), 'settings.json')

export function getSettings(): Settings {
  if (!current) current = readJson(settingsFile(), settingsSchema, () => ({ ...DEFAULT_SETTINGS }))
  return current
}

/** Applies the parts of settings that live in Electron itself (not in CSS). */
export function applyNativeSettings(s: Settings): void {
  nativeTheme.themeSource = s.theme
}

export function updateSettings(patch: SettingsPatch): Settings {
  const prev = getSettings()
  // Undefined means "not provided", never "reset to default".
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const merged = {
    ...prev,
    ...defined,
    // Module toggles merge key-by-key so toggling one module can't wipe the others.
    enabledModules: { ...prev.enabledModules, ...(patch.enabledModules ?? {}) },
    // Same for onboarding milestones — a partial patch must not clear other flags.
    onboarding: { ...prev.onboarding, ...(patch.onboarding ?? {}) },
    notifications: { ...prev.notifications, ...(patch.notifications ?? {}) }
  }
  const next = settingsSchema.parse(merged)
  current = next
  writeJsonAtomic(settingsFile(), next)
  applyNativeSettings(next)
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.settingsChanged, next)
  for (const l of listeners) l(next)
  return next
}

export function onSettingsChange(cb: (s: Settings) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
