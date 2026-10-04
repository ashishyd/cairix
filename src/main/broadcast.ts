import { BrowserWindow } from 'electron'

/** Push an event to every open window. Destroyed windows are skipped. */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
