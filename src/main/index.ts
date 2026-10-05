import { app, globalShortcut, Menu, nativeImage, session } from 'electron'
import { IPC } from '@shared/ipc'
import { contentSecurityPolicy } from '@shared/csp'
import { registerModules, type Modules } from './modules'
import { shouldShowWindowOnStart } from './login'
import { getLoginEnv } from './shell-env'
import { applyNativeSettings, getSettings, onSettingsChange } from './settings'
import { createTray, resourcePath } from './tray'
import { createMainWindow, getMainWindow, showMainWindow } from './window'

app.setName('Cairix')

// Lets automated tests (and a second dev copy) run against throwaway data instead of
// the user's real settings and project list. Must be set before the single-instance lock.
if (process.env.CAIRIX_USER_DATA) app.setPath('userData', process.env.CAIRIX_USER_DATA)

let modules: Modules | null = null
let registeredHotkey: string | null = null

function registerHotkey(accelerator: string): void {
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
  registeredHotkey = null
  if (!accelerator) return
  try {
    const ok = globalShortcut.register(accelerator, () => {
      showMainWindow()
      getMainWindow()?.webContents.send(IPC.uiOpenPalette)
    })
    if (ok) registeredHotkey = accelerator
  } catch {
    /* an invalid accelerator string must never crash startup */
  }
}

/**
 * Dev serves the renderer over http, so the policy is a header (and has to
 * allow HMR). Production loads from file://, where the same policy ships as a
 * <meta> tag injected at build time (see electron.vite.config.ts).
 */
function hardenSession(): void {
  const ses = session.defaultSession
  if (!app.isPackaged) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy(true)] }
      })
    })
  }
  // Cairix never needs camera, mic, geolocation, notifications from the page, etc.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

function buildMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  void app.whenReady().then(() => {
    const settings = getSettings()
    applyNativeSettings(settings)
    hardenSession()
    buildMenu()
    if (process.platform === 'darwin') {
      const icon = nativeImage.createFromPath(resourcePath('icon.png'))
      if (!icon.isEmpty()) app.dock?.setIcon(icon) // in dev the Dock would otherwise show Electron's icon
    }

    void getLoginEnv() // warm the cache (takes ~2 s with nvm); the first script run shouldn't pay for it
    modules = registerModules()
    createMainWindow({ vibrancy: settings.vibrancy, showOnReady: shouldShowWindowOnStart(app.getLoginItemSettings()) })
    createTray(showMainWindow)
    registerHotkey(settings.globalHotkey)

    let prev = settings
    onSettingsChange((next) => {
      if (next.globalHotkey !== prev.globalHotkey) registerHotkey(next.globalHotkey)
      if (next.vibrancy !== prev.vibrancy) {
        getMainWindow()?.setVibrancy(next.vibrancy ? 'sidebar' : null)
      }
      prev = next
    })

    app.on('activate', () => {
      if (getMainWindow()) showMainWindow()
      else createMainWindow({ vibrancy: getSettings().vibrancy })
    })
  })

  // Closing the window keeps Cairix in the menu bar (dev servers it started keep running).
  // Quit explicitly with ⌘Q or the tray menu, which also stops everything Cairix started.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    modules?.dispose()
    globalShortcut.unregisterAll()
  })
}
