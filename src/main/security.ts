import { realpathSync } from 'fs'
import { isAbsolute, relative, resolve, sep } from 'path'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * `shell.openExternal` hands a URL to the OS, so only open what a user could
 * reasonably click: https anywhere, http only for local dev servers.
 */
export function isSafeExternalUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
}

/** True when `child` is `parent` or lives inside it, after resolving symlinks. */
export function isInside(parent: string, child: string): boolean {
  if (!isAbsolute(parent) || !isAbsolute(child)) return false
  let p: string
  let c: string
  try {
    p = realpathSync(resolve(parent))
    c = realpathSync(resolve(child))
  } catch {
    return false
  }
  const rel = relative(p, c)
  if (rel === '') return true
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
