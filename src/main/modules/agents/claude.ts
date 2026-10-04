import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import type { Proc } from '../ports/parse'

/**
 * Live Claude Code sessions, from the registry the CLI keeps in
 * ~/.claude/sessions/<pid>.json. Each file describes one running session
 * (title, working folder, busy/idle).
 *
 * Hard rules, because that folder also holds secrets:
 *  - Only `<digits>.json` files are read. The sibling `*.key` files hold
 *    per-session peer tokens and are never opened.
 *  - Only the fields below are parsed. Fields like `messagingSocketPath` are
 *    never read, stored or forwarded.
 */

const sessionFile = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string(),
  cwd: z.string(),
  startedAt: z.number(),
  procStart: z.string().optional(),
  version: z.string().optional(),
  entrypoint: z.string().optional(),
  name: z.string().optional(),
  status: z.string().optional(),
  updatedAt: z.number().optional()
})

export type ClaudeSessionRecord = z.infer<typeof sessionFile>

/** Reads and validates the registry. Malformed files are skipped, never fatal. */
export async function readClaudeSessions(home: string): Promise<ClaudeSessionRecord[]> {
  const dir = join(home, '.claude', 'sessions')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: ClaudeSessionRecord[] = []
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue // never touch *.key
    try {
      const parsed = sessionFile.safeParse(JSON.parse(await readFile(join(dir, name), 'utf8')))
      if (parsed.success) out.push(parsed.data)
    } catch {
      /* half-written or corrupt: ignore */
    }
  }
  return out
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * A session file outlives a crashed process, and pids get reused. A session is
 * live only if its pid exists AND that process started at the time recorded in
 * the file (`procStart` is `ps -o lstart` format).
 */
export function isSessionLive(rec: ClaudeSessionRecord, procs: Map<number, Proc>, lstart: Map<number, string>): boolean {
  if (!procs.has(rec.pid)) return false
  const started = lstart.get(rec.pid)
  if (rec.procStart && started) return norm(rec.procStart) === norm(started)
  return true // no start time to compare: the pid being alive is the best evidence we have
}

/** Parses `ps -o pid=,lstart= -p …` into pid -> start-time string. */
export function parseLstart(output: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.+?)\s*$/)
    if (m) map.set(Number(m[1]), m[2])
  }
  return map
}
