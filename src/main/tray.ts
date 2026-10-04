import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'

let tray: Tray | null = null
let onShow: () => void = () => undefined
let counts = { dev: 0, runs: 0 }

/** Packaged: extraResources land in Contents/Resources. Dev: the project's resources folder. */
export function resourcePath(...parts: string[]): string {
  return app.isPackaged ? join(process.resourcesPath, ...parts) : join(app.getAppPath(), 'resources', ...parts)
}

function menu(): Menu {
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`
  return Menu.buildFromTemplate([
    { label: 'Open Cairix', click: () => onShow() },
    { type: 'separator' },
    { label: `${plural(counts.dev, 'dev server')} listening`, enabled: false },
    { label: `${plural(counts.runs, 'script')} running from Cairix`, enabled: false },
    { type: 'separator' },
    { label: 'Quit Cairix', accelerator: 'Command+Q', click: () => app.quit() }
  ])
}

export function createTray(show: () => void): void {
  onShow = show
  const image = nativeImage.createFromPath(resourcePath('trayTemplate.png'))
  image.setTemplateImage(true) // macOS tints it for light/dark menu bars
  tray = new Tray(image)
  tray.setToolTip('Cairix')
  tray.setContextMenu(menu())
}

let lastShown = { dev: -1, runs: -1, showCount: true }

/** `dev` = listening dev servers (shown beside the icon); `runs` = scripts started by Cairix. */
export function setTrayStatus(next: { dev: number; runs: number }, showCount: boolean): void {
  if (!tray) return
  if (next.dev === lastShown.dev && next.runs === lastShown.runs && showCount === lastShown.showCount) return
  lastShown = { ...next, showCount }
  counts = next
  tray.setTitle(showCount && next.dev > 0 ? ` ${next.dev}` : '')
  tray.setContextMenu(menu())
}
