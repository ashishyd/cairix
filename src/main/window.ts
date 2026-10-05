import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { z } from 'zod'
import { readJson, writeJsonAtomic } from './json-store'
import { isSafeExternalUrl } from './security'

let mainWindow: BrowserWindow | null = null

const boundsSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().min(600),
  height: z.number().min(400)
})
const boundsFile = (): string => join(app.getPath('userData'), 'window-state.json')

export const getMainWindow = (): BrowserWindow | null =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow : null

/** Restores the last bounds only if they still land on a connected display. */
function restoreBounds(): { x?: number; y?: number; width: number; height: number } {
  const saved = readJson<z.infer<typeof boundsSchema>>(boundsFile(), boundsSchema, () => ({ width: 1220, height: 800 }))
  if (saved.x === undefined || saved.y === undefined) return saved
  const visible = screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return saved.x! < b.x + b.width - 80 && saved.x! + saved.width > b.x + 80 && saved.y! >= b.y - 10 && saved.y! < b.y + b.height - 80
  })
  return visible ? saved : { width: saved.width, height: saved.height }
}

export function createMainWindow(opts: { vibrancy: boolean; showOnReady?: boolean }): BrowserWindow {
  const win = new BrowserWindow({
    ...restoreBounds(),
    minWidth: 920,
    minHeight: 600,
    show: false,
    title: 'Cairix',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: opts.vibrancy ? 'sidebar' : undefined,
    visualEffectState: 'followWindow',
    backgroundColor: opts.vibrancy ? '#00000000' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  mainWindow = win

  // Started as a login item: stay in the menu bar until the user opens us.
  win.once('ready-to-show', () => opts.showOnReady !== false && win.show())

  let saveTimer: NodeJS.Timeout | undefined
  const saveBounds = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMaximized() && !win.isFullScreen()) {
        writeJsonAtomic(boundsFile(), win.getBounds())
      }
    }, 400)
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)

  // The renderer is one local page. Links open in the user's browser (if safe);
  // the window itself never navigates anywhere else.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

export function showMainWindow(): void {
  const win = getMainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
