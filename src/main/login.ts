/**
 * Launch at login, kept free of Electron imports so the rules are testable.
 *
 * Only the installed app registers itself: a dev run would otherwise add the
 * bare Electron binary to the user's Login Items.
 */
export interface LoginItemApi {
  isPackaged: boolean
  set(settings: { openAtLogin: boolean; openAsHidden: boolean }): void
}

/** Returns whether anything was registered. */
export function applyLaunchAtLogin(enabled: boolean, api: LoginItemApi): boolean {
  if (!api.isPackaged) return false
  // Hidden: signing in should put Cairix in the menu bar, not throw a window at you.
  api.set({ openAtLogin: enabled, openAsHidden: enabled })
  return true
}

/** True unless macOS started us as a login item. */
export function shouldShowWindowOnStart(info: { wasOpenedAtLogin?: boolean; wasOpenedAsHidden?: boolean }): boolean {
  return !(info.wasOpenedAtLogin || info.wasOpenedAsHidden)
}
