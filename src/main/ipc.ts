import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { pathToFileURL } from 'url'
import { join } from 'path'
import type { z } from 'zod'

/**
 * Only our own renderer may call into main. The dev server URL in
 * development, the packaged index.html otherwise. A webview, an iframe that
 * somehow loaded, or a navigated-away window is rejected.
 */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && dev) return url.startsWith(dev)
  return url.startsWith(pathToFileURL(join(__dirname, '../renderer/index.html')).href)
}

/**
 * Registers an invoke handler whose arguments are validated against a zod
 * tuple. Handlers receive typed, trusted-shape arguments; anything malformed
 * is rejected before it reaches business logic.
 */
export function handle<S extends z.ZodTuple>(
  channel: string,
  schema: S,
  fn: (...args: z.infer<S>) => unknown | Promise<unknown>
): void {
  ipcMain.handle(channel, (event, ...raw: unknown[]) => {
    if (!isTrustedSender(event)) throw new Error('Blocked: untrusted sender.')
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new Error(`Invalid request for ${channel}.`)
    return fn(...(parsed.data as z.infer<S>))
  })
}
