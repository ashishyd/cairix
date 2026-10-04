import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload for a plugin's sandboxed window. It exposes three functions and
 * nothing else. Main decides what a call means and whether it is allowed, and
 * identifies the plugin from which window sent it, never from these arguments.
 *
 * This file must stay SELF-CONTAINED (no imports except 'electron'): a
 * sandboxed preload cannot load other files, and a shared import would make
 * the bundler emit a separate chunk that breaks both preloads. The channel
 * names below are checked against src/shared/ipc.ts by tests/plugin-preload.test.ts.
 */
contextBridge.exposeInMainWorld('__host', {
  call: (method: string, args: unknown): Promise<unknown> => ipcRenderer.invoke('plugin:rpc', method, args),
  onInvoke: (cb: (msg: unknown) => void): void => {
    ipcRenderer.on('plugin:invoke', (_e, msg) => cb(msg))
  },
  reply: (reqId: string, msg: unknown): void => ipcRenderer.send('plugin:reply', reqId, msg)
})
