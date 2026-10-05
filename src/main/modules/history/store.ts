import { createHash } from 'crypto'
import { join } from 'path'
import { z } from 'zod'
import { redactCommand } from '@shared/redact'
import type { HistoryEntry, HistoryRule } from '@shared/types'
import { readJson, writeJsonAtomic } from '../../json-store'
import { describeCommand, isInteractive, isRisky, programOf } from './describe'
import type { HookEntry } from './hook'
import type { ParsedCommand } from './parse'

const MAX_COMMANDS = 5000
const MAX_LENGTH = 2000
const MAX_FOLDERS_PER_COMMAND = 5

const record = z.object({ c: z.string().max(MAX_LENGTH), n: z.number().int().positive(), f: z.number(), l: z.number() })
const file = z.object({
  version: z.literal(1),
  /** Per history file: where we stopped reading, so only new lines are counted. */
  sources: z.record(z.string(), z.object({ offset: z.number().int().nonnegative(), ino: z.number() })),
  commands: z.array(record),
  rules: z.array(z.object({ kind: z.enum(['command', 'program']), value: z.string().max(MAX_LENGTH) })),
  /** command -> folder -> times run there. */
  folders: z.record(z.string(), z.record(z.string(), z.number().int().positive())).default({})
})
type Data = z.infer<typeof file>
type SourceState = Data['sources'][string]

export const entryId = (command: string): string => createHash('sha1').update(command).digest('hex').slice(0, 16)

/**
 * Why a command is never stored. Secrets are checked by redacting: if
 * redaction would change the text it contains a credential, so we keep none of it
 * (we could not re-run a masked command anyway).
 */
export function skipReason(command: string, rules: HistoryRule[]): 'empty' | 'long' | 'secret' | 'rule' | null {
  const c = command.trim()
  if (!c) return 'empty'
  if (c.length > MAX_LENGTH) return 'long'
  if (redactCommand(c) !== c) return 'secret'
  if (isIgnored(c, rules)) return 'rule'
  return null
}

export function isIgnored(command: string, rules: HistoryRule[]): boolean {
  const c = command.trim()
  const prog = programOf(c)
  return rules.some((r) => (r.kind === 'command' ? r.value === c : r.value === prog))
}

function toEntry(r: { c: string; n: number; f: number; l: number }, folders: Record<string, number> = {}): HistoryEntry {
  return {
    id: entryId(r.c),
    command: r.c,
    count: r.n,
    firstSeen: r.f,
    lastRun: r.l,
    program: programOf(r.c),
    description: describeCommand(r.c),
    risky: isRisky(r.c),
    interactive: isInteractive(r.c),
    folders: Object.entries(folders).map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
  }
}

/**
 * The remembered commands. Counts survive restarts; the history files stay the
 * source of truth for new activity. Everything is in memory and written
 * atomically whenever something changes.
 */
export class HistoryStore {
  private commands = new Map<string, { c: string; n: number; f: number; l: number }>()
  private rules: HistoryRule[] = []
  private folders = new Map<string, Record<string, number>>()
  private sources: Record<string, SourceState> = {}
  private readonly path: string
  private dirty = false

  constructor(dir: string) {
    this.path = join(dir, 'history.json')
    const data = readJson(this.path, file, () => ({ version: 1 as const, sources: {}, commands: [], rules: [], folders: {} }))
    this.rules = data.rules
    this.sources = data.sources
    for (const r of data.commands) this.commands.set(r.c, r)
    for (const [c, f] of Object.entries(data.folders)) this.folders.set(c, f)
  }

  getRules(): HistoryRule[] {
    return this.rules
  }
  getSource(path: string): SourceState | undefined {
    return this.sources[path]
  }
  setSource(path: string, state: SourceState): void {
    const cur = this.sources[path]
    if (cur && cur.offset === state.offset && cur.ino === state.ino) return
    this.sources[path] = state
    this.dirty = true
  }

  /** Counts new commands. Returns how many were recorded. */
  ingest(parsed: ParsedCommand[], fallbackTs: number): number {
    let recorded = 0
    for (const p of parsed) {
      const command = p.command.trim()
      if (skipReason(command, this.rules)) continue
      const ts = (p.ts ?? Math.floor(fallbackTs / 1000)) * 1000
      const cur = this.commands.get(command)
      if (cur) {
        cur.n += 1
        cur.l = Math.max(cur.l, ts)
        cur.f = Math.min(cur.f, ts)
      } else this.commands.set(command, { c: command, n: 1, f: ts, l: ts })
      recorded++
    }
    if (recorded > 0) {
      this.prune()
      this.dirty = true
    }
    return recorded
  }

  /** Counts where commands ran, from the shell hook. Skips anything the history would skip. */
  ingestFolders(entries: HookEntry[]): number {
    let n = 0
    for (const e of entries) {
      const command = e.command.trim()
      if (skipReason(command, this.rules)) continue
      const f = this.folders.get(command) ?? {}
      f[e.cwd] = (f[e.cwd] ?? 0) + 1
      const keep = Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, MAX_FOLDERS_PER_COMMAND)
      this.folders.set(command, Object.fromEntries(keep))
      n++
    }
    if (n > 0) this.dirty = true
    return n
  }

  hasFolderData(): boolean {
    return this.folders.size > 0
  }

  /** Adds a rule and forgets everything it now covers. */
  addRule(rule: HistoryRule): void {
    if (!rule.value.trim() || this.rules.some((r) => r.kind === rule.kind && r.value === rule.value)) return
    this.rules = [...this.rules, rule]
    for (const c of [...this.commands.keys()]) if (isIgnored(c, [rule])) this.commands.delete(c)
    for (const c of [...this.folders.keys()]) if (isIgnored(c, [rule])) this.folders.delete(c)
    this.dirty = true
  }

  removeRule(rule: HistoryRule): void {
    this.rules = this.rules.filter((r) => !(r.kind === rule.kind && r.value === rule.value))
    this.dirty = true
  }

  /** Looks a command up by the id the UI holds. The UI never sends command text. */
  find(id: string): string | undefined {
    for (const c of this.commands.keys()) if (entryId(c) === id) return c
    return undefined
  }

  entries(): HistoryEntry[] {
    return [...this.commands.values()].map((r) => toEntry(r, this.folders.get(r.c)))
  }

  entry(id: string): HistoryEntry | undefined {
    const command = this.find(id)
    return command ? toEntry(this.commands.get(command)!, this.folders.get(command)) : undefined
  }

  /** Writes to disk if anything changed. Returns true when it did. */
  save(): boolean {
    if (!this.dirty) return false
    this.dirty = false
    // Folder counts for commands that never reached the history (or were pruned) are dropped.
    for (const c of [...this.folders.keys()]) if (!this.commands.has(c) && this.folders.size > MAX_COMMANDS) this.folders.delete(c)
    const data: Data = { version: 1, sources: this.sources, commands: [...this.commands.values()], rules: this.rules, folders: Object.fromEntries(this.folders) }
    writeJsonAtomic(this.path, data)
    return true
  }

  /** Keeps the list bounded: drops the rarely used, long-unused commands first. */
  private prune(): void {
    if (this.commands.size <= MAX_COMMANDS) return
    const sorted = [...this.commands.values()].sort((a, b) => a.n - b.n || a.l - b.l)
    for (const r of sorted.slice(0, this.commands.size - MAX_COMMANDS)) {
      this.commands.delete(r.c)
      this.folders.delete(r.c)
    }
  }
}
