import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import { getMainWindow } from '../../window'
import type { Broker } from './broker'
import type { PluginManager } from './manager'
import { senders } from './registry'

const id = z.string().max(80)
const kind = z.enum(['widget', 'tab'])
const ctx = z.object({ projectId: z.string().max(80).optional() })

export function registerPluginsHandlers(manager: PluginManager, broker: Broker): void {
  // ── the app UI ──
  handle(IPC.pluginsList, z.tuple([]), async () => {
    await manager.refresh()
    return { plugins: manager.list(), broken: manager.broken() }
  })
  handle(IPC.pluginsInstall, z.tuple([]), async () => {
    const win = getMainWindow()
    const opts = { title: 'Install a plugin', message: 'Choose the plugin folder (it contains cairix-plugin.json).', buttonLabel: 'Install', properties: ['openDirectory' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : manager.install(r.filePaths[0])
  })
  handle(IPC.pluginsSetEnabled, z.tuple([id, z.boolean()]), (i, on) => manager.setEnabled(i, on))
  handle(IPC.pluginsUninstall, z.tuple([id]), (i) => manager.uninstall(i))
  handle(IPC.pluginsRender, z.tuple([id, kind, id, ctx]), (i, k, c, x) => manager.render(i, k, c, x))
  handle(IPC.pluginsAction, z.tuple([id, kind, id, id, z.string().max(500).optional(), ctx]), (i, k, c, a, p, x) => manager.action(i, k, c, a, p, x))
  handle(IPC.pluginsCommand, z.tuple([id, id]), (i, c) => manager.runCommand(i, c))

  // ── plugin sandboxes calling out. Identity = the sending window, never the message. ──
  ipcMain.handle(IPC.pluginRpc, (event, method: unknown, args: unknown) => {
    const endpoint = senders.get(event.sender.id)
    if (!endpoint || typeof method !== 'string') throw new Error('Unknown plugin window.')
    return broker.handle(endpoint.pluginId, method, args)
  })
  ipcMain.on(IPC.pluginReply, (event, reqId: unknown, msg: unknown) => {
    if (typeof reqId !== 'string' || !msg || typeof msg !== 'object') return
    senders.get(event.sender.id)?.onReply(reqId, msg as { ok: boolean; result?: unknown; error?: string })
  })
}
