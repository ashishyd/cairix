/** Joins class names, skipping falsy values. (Tiny stand-in for clsx.) */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Electron prefixes errors thrown in main with
 * "Error invoking remote method 'x': Error: ". Strip it so users see the message.
 */
export function errMsg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

/** KiB (as reported by ps) -> "412 MB" / "1.1 GB". */
export function formatKb(kb: number): string {
  if (kb >= 1024 * 1024) return `${(Math.round((kb / 1024 / 1024) * 10) / 10).toFixed(1)} GB`
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`
  return `${Math.round(kb)} KB`
}

export function formatUptime(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.floor(sec))}s`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export { parseArgs } from '@shared/args'

/** Tiny fuzzy matcher: substring hits rank highest; otherwise subsequence match. (From Vaultic.) */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase()
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const idx = t.indexOf(q)
  if (idx !== -1) return 1000 - idx

  let ti = 0
  let score = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return -1
    score += Math.max(1, 10 - (found - ti))
    ti = found + 1
  }
  return score
}

export function fuzzyMatch(texts: string[], query: string): number {
  let best = -1
  for (const text of texts) best = Math.max(best, fuzzyScore(text, query))
  return best
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** `/Users/me/dev/app` -> `~/dev/app` (display only). */
export function tildify(path: string, home?: string): string {
  const h = home ?? (path.match(/^\/Users\/[^/]+/)?.[0] ?? '')
  return h && path.startsWith(h) ? `~${path.slice(h.length)}` : path
}
