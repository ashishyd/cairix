import { rmSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { readJson, writeJsonAtomic } from '../../json-store'

/**
 * The only door out of a plugin's sandbox. Plugins have no Node, no files and
 * no network of their own: every capability is a `method` here, and every
 * method re-checks the permissions the USER granted (not what the plugin
 * claims). The plugin is identified by main from which window sent the call,
 * never from anything in the message.
 */

export class PermissionError extends Error {}

export interface BrokerDeps {
  grantedFor(pluginId: string): string[]
  projects(): Array<{ id: string; name: string; path: string; kinds: string[] }>
  ports(): Array<{ port: number; name: string; framework?: string; project?: string; memoryKb: number; category: string }>
  agents(): Array<{ title: string; kind: string; status: string; project?: string }>
  dataDir: string
  notify(pluginId: string, message: string, kind: 'info' | 'success' | 'error'): void
  openUrl(url: string): Promise<void>
  fetchImpl?: typeof fetch
}

const need = (granted: string[], perm: string, what: string): void => {
  if (!granted.includes(perm)) throw new PermissionError(`This plugin was not allowed to ${what}. It needs the "${perm}" permission.`)
}

// ───────────────────────── network ─────────────────────────

/** `network:api.github.com` matches exactly; `network:*.example.com` matches subdomains (not the bare domain). */
export function hostAllowed(host: string, granted: string[]): boolean {
  const h = host.toLowerCase()
  return granted.some((p) => {
    if (!p.startsWith('network:')) return false
    const allowed = p.slice(8).toLowerCase()
    return allowed.startsWith('*.') ? h.endsWith(allowed.slice(1)) && h.length > allowed.length - 1 : h === allowed
  })
}

const FORBIDDEN_HEADERS = /^(?:cookie|host|content-length|connection|transfer-encoding|origin|referer|upgrade|proxy-.*|sec-.*)$/i
const MAX_RESPONSE = 1_000_000
const MAX_BODY = 256_000
const TIMEOUT_MS = 10_000

const fetchArgs = z.object({
  url: z.string().max(2000),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  headers: z.record(z.string().max(100), z.string().max(2000)).refine((h) => Object.keys(h).length <= 20).optional(),
  body: z.string().max(MAX_BODY).optional()
})

async function brokeredFetch(granted: string[], raw: unknown, impl: typeof fetch): Promise<{ status: number; ok: boolean; contentType: string; text: string }> {
  const a = fetchArgs.parse(raw)
  let url: URL
  try {
    url = new URL(a.url)
  } catch {
    throw new Error('That is not a valid URL.')
  }
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(a.headers ?? {})) if (!FORBIDDEN_HEADERS.test(k)) headers[k] = v

  for (let hop = 0; hop <= 3; hop++) {
    if (url.protocol !== 'https:') throw new PermissionError('Plugins can only use https:// addresses.')
    if (!hostAllowed(url.hostname, granted)) throw new PermissionError(`This plugin was not allowed to contact ${url.hostname}. It needs "network:${url.hostname}".`)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await impl(url, { method: a.method, headers, body: a.method === 'GET' ? undefined : a.body, redirect: 'manual', signal: ctl.signal, credentials: 'omit' } as RequestInit)
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url) // every hop is re-checked against the allowlist
        continue
      }
      const reader = res.body?.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_RESPONSE) {
          await reader.cancel()
          throw new Error('The response was too large (1 MB limit).')
        }
        chunks.push(value)
      }
      return { status: res.status, ok: res.ok, contentType: res.headers.get('content-type') ?? '', text: Buffer.concat(chunks).toString('utf8') }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('The request timed out.')
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('Too many redirects.')
}

// ───────────────────────── storage ─────────────────────────

const MAX_VALUE = 256_000
const MAX_TOTAL = 1_000_000
const key = z.string().regex(/^[\w.:-]{1,80}$/)

class PluginStorage {
  private data: Record<string, unknown>
  private readonly file: string
  constructor(dir: string, pluginId: string) {
    this.file = join(dir, 'plugin-data', `${pluginId}.json`)
    this.data = readJson(this.file, z.record(z.string(), z.unknown()), () => ({}))
  }
  get(k: string): unknown {
    return this.data[k] ?? null
  }
  set(k: string, v: unknown): void {
    const json = JSON.stringify(v ?? null)
    if (json.length > MAX_VALUE) throw new Error('That value is too large (256 KB limit per key).')
    const next = { ...this.data, [k]: JSON.parse(json) }
    if (JSON.stringify(next).length > MAX_TOTAL) throw new Error("This plugin's storage is full (1 MB).")
    this.data = next
    writeJsonAtomic(this.file, next)
  }
  delete(k: string): void {
    const { [k]: _gone, ...rest } = this.data
    void _gone
    this.data = rest
    writeJsonAtomic(this.file, rest)
  }
  keys(): string[] {
    return Object.keys(this.data)
  }
}

// ───────────────────────── the broker ─────────────────────────

export class Broker {
  private stores = new Map<string, PluginStorage>()
  constructor(private readonly deps: BrokerDeps) {}

  private store(id: string): PluginStorage {
    let s = this.stores.get(id)
    if (!s) this.stores.set(id, (s = new PluginStorage(this.deps.dataDir, id)))
    return s
  }

  /** Delete everything a plugin stored (after uninstall): leaving a removed plugin's data behind would be a privacy leak. */
  purge(id: string): void {
    this.stores.delete(id)
    rmSync(join(this.deps.dataDir, 'plugin-data', `${id}.json`), { force: true })
  }

  async handle(pluginId: string, method: string, args: unknown): Promise<unknown> {
    const g = this.deps.grantedFor(pluginId)
    const a = (args ?? {}) as Record<string, unknown>
    switch (method) {
      case 'projects.list':
        need(g, 'projects.read', 'see your projects')
        return this.deps.projects()
      case 'ports.list':
        need(g, 'ports.read', 'see your ports')
        return this.deps.ports()
      case 'agents.list':
        need(g, 'agents.read', 'see your agents')
        return this.deps.agents()
      case 'storage.get':
        need(g, 'storage', 'store data')
        return this.store(pluginId).get(key.parse(a.key))
      case 'storage.set':
        need(g, 'storage', 'store data')
        this.store(pluginId).set(key.parse(a.key), a.value)
        return null
      case 'storage.delete':
        need(g, 'storage', 'store data')
        this.store(pluginId).delete(key.parse(a.key))
        return null
      case 'storage.keys':
        need(g, 'storage', 'store data')
        return this.store(pluginId).keys()
      case 'http.fetch':
        return brokeredFetch(g, args, this.deps.fetchImpl ?? fetch)
      case 'ui.notify': {
        need(g, 'notify', 'show notifications')
        const p = z.object({ message: z.string().min(1).max(200), kind: z.enum(['info', 'success', 'error']).default('info') }).parse(a)
        this.deps.notify(pluginId, p.message, p.kind)
        return null
      }
      case 'ui.openUrl': {
        need(g, 'openUrl', 'open links')
        const url = z.string().max(500).parse(a.url)
        if (new URL(url).protocol !== 'https:') throw new PermissionError('Plugins can only open https:// links.')
        await this.deps.openUrl(url)
        return null
      }
      default:
        throw new Error(`Unknown method "${method}".`)
    }
  }
}
