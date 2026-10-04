import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { PluginManifest } from '@shared/plugins'
import { senders } from './registry'
import { RUNTIME_SOURCE } from './runtime'

export interface PluginHost {
  start(): Promise<void>
  invoke(kind: 'command' | 'widget' | 'tab' | 'action', id: string, payload: unknown): Promise<unknown>
  stop(): void
  /** Called if the plugin's window dies or stops responding. */
  onCrash(cb: (reason: string) => void): void
}

const CALL_TIMEOUT_MS = 8000

/** An empty page whose policy forbids everything: no scripts it loads itself, no network, no frames. */
const HOST_PAGE =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><title>plugin</title>`
  )

/**
 * Runs one plugin in its own Chromium-sandboxed, invisible window:
 *  - sandbox + contextIsolation, no Node integration, no devtools
 *  - its own in-memory session: separate storage, all permission requests denied
 *  - every network request cancelled (the broker's http.fetch is its only way online)
 *  - cannot navigate or open windows
 * The only bridge in is the tiny preload that forwards `cairix.*` calls to main.
 */
export class ElectronPluginHost implements PluginHost {
  private win?: BrowserWindow
  private pending = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>()
  private crashCb: (reason: string) => void = () => undefined
  private stopped = false

  constructor(private readonly manifest: PluginManifest, private readonly code: string) {}

  onCrash(cb: (reason: string) => void): void {
    this.crashCb = cb
  }

  async start(): Promise<void> {
    const ses = session.fromPartition(`plugin-${this.manifest.id}`) // no "persist:" prefix: memory only
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    ses.setPermissionCheckHandler(() => false)
    ses.webRequest.onBeforeRequest(({ url }, cb) => cb({ cancel: !url.startsWith('data:') }))

    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      webPreferences: {
        session: ses,
        preload: join(__dirname, '../preload/plugin.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        devTools: false,
        backgroundThrottling: false,
        spellcheck: false
      }
    })
    this.win = win
    const wc = win.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (e) => e.preventDefault())
    wc.on('render-process-gone', (_e, d) => this.fail(`The plugin's process exited (${d.reason}).`))
    wc.on('unresponsive', () => this.fail('The plugin stopped responding.'))

    senders.set(wc.id, {
      pluginId: this.manifest.id,
      onReply: (reqId, msg) => {
        const p = this.pending.get(reqId)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(reqId)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(msg.error ?? 'The plugin reported an error.'))
      }
    })

    await win.loadURL(HOST_PAGE)
    await wc.executeJavaScript(RUNTIME_SOURCE)
    // The plugin's code is wrapped in a function so its top-level names stay private.
    await wc.executeJavaScript(`(function () { "use strict";\n${this.code}\n})();`).catch((e: Error) => {
      throw new Error(`The plugin failed to load: ${e.message}`)
    })
  }

  invoke(kind: 'command' | 'widget' | 'tab' | 'action', id: string, payload: unknown): Promise<unknown> {
    const wc = this.win?.webContents
    if (!wc || wc.isDestroyed() || this.stopped) return Promise.reject(new Error('The plugin is not running.'))
    return new Promise((resolve, reject) => {
      const reqId = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error('The plugin took too long to respond.'))
      }, CALL_TIMEOUT_MS)
      this.pending.set(reqId, { resolve, reject, timer })
      wc.send('plugin:invoke', { reqId, kind, id, payload })
    })
  }

  stop(): void {
    this.stopped = true
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('The plugin was stopped.'))
    }
    this.pending.clear()
    const wc = this.win?.webContents
    if (wc) senders.delete(wc.id)
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = undefined
  }

  private fail(reason: string): void {
    if (this.stopped) return
    this.stop()
    this.crashCb(reason)
  }
}
