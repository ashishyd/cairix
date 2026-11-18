import { dialog } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import { getMainWindow } from '../../window'
import { MAX_ROUTER_CHARS } from './ai'
import type { WifiService } from './service'

export function registerWifiHandlers(w: WifiService): void {
  handle(IPC.wifiStatus, z.tuple([]), () => w.status())
  handle(IPC.wifiSpeedTest, z.tuple([]), () => w.speedTest())
  handle(IPC.wifiSaveRouter, z.tuple([z.string().max(MAX_ROUTER_CHARS)]), (text) => w.saveRouter(text))
  // Main opens the picker itself, so the page never hands over a path.
  handle(IPC.wifiReadRouterImage, z.tuple([]), async () => {
    const win = getMainWindow()
    const opts = { title: 'Router photo or screenshot', message: 'A photo of the router label or box, or a screenshot of its admin page.', buttonLabel: 'Read with Claude', properties: ['openFile' as const], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : w.readRouterImage(r.filePaths[0])
  })
  handle(IPC.wifiAiPlan, z.tuple([]), () => w.aiPlan())
}
