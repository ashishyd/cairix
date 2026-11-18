import type { ActionDraft, Runbook } from '@shared/types'
import { isInteractive, isRisky, programOf } from './describe'
import type { ParsedCommand } from './parse'
import { entryId } from './store'

const MIN_LEN = 2
const MAX_LEN = 5
const MIN_COUNT = 3
/** Commands further apart than this were not one routine. */
const MAX_GAP_S = 30 * 60
const MAX_RESULTS = 10
const TRIVIAL = new Set(['ls', 'pwd', 'clear', 'exit', 'history', 'git status'])

/**
 * `cd` is excluded because history does not say where a sequence started, so a
 * saved `cd ../x` would land somewhere else. A skipped command (secret, never-track
 * rule) arrives as '' and breaks the sequence, so two commands never look adjacent
 * when something sat between them.
 */
function usable(win: ParsedCommand[]): boolean {
  const cmds = win.map((c) => c.command)
  if (cmds.some((c) => c === '' || programOf(c) === 'cd' || isInteractive(c) || /&\s*$/.test(c))) return false
  if (new Set(cmds).size < 2 || cmds.every((c) => TRIVIAL.has(c))) return false
  for (let i = 1; i < win.length; i++) {
    const a = win[i - 1].ts
    const b = win[i].ts
    if (a !== undefined && b !== undefined && b - a > MAX_GAP_S) return false
  }
  return true
}

const contains = (hay: string[], needle: string[]): boolean => hay.some((_, i) => needle.every((n, j) => hay[i + j] === n))

/** Command sequences (2–5 commands, in order, close in time) that you ran at least 3 times. Pure: history in, runbooks out. */
export function findRunbooks(history: ParsedCommand[]): Runbook[] {
  const seq = history.map((c) => ({ ...c, command: c.command.trim() }))
  const found: Runbook[] = []
  for (let len = Math.min(MAX_LEN, seq.length); len >= MIN_LEN; len--) {
    // Overlapping repeats (a b a b a) count once per non-overlapping pass.
    const groups = new Map<string, { count: number; end: number; last: number }>()
    for (let i = 0; i + len <= seq.length; i++) {
      const win = seq.slice(i, i + len)
      if (!usable(win)) continue
      const key = win.map((c) => c.command).join('\u0000')
      const g = groups.get(key) ?? { count: 0, end: 0, last: 0 }
      if (i >= g.end) {
        g.count++
        g.end = i + len
        g.last = (win[len - 1].ts ?? 0) * 1000
      } else g.last = Math.max(g.last, (win[len - 1].ts ?? 0) * 1000)
      groups.set(key, g)
    }
    for (const [key, g] of groups) {
      if (g.count < MIN_COUNT) continue
      const commands = key.split('\u0000')
      // A shorter run that only ever appears inside a longer one is the same routine.
      if (found.some((f) => f.count >= g.count && contains(f.commands, commands))) continue
      found.push({ id: entryId(key), commands, count: g.count, lastRun: g.last, risky: commands.some(isRisky) })
    }
  }
  return found.sort((a, b) => b.count * b.commands.length - a.count * a.commands.length || b.lastRun - a.lastRun).slice(0, MAX_RESULTS)
}

/** The Action a runbook is saved as: one confirmed shell action that runs the commands in order and stops at the first failure. */
export function runbookDraft(rb: Runbook, name: string): ActionDraft {
  return { name: name.trim(), scope: 'project', kind: 'shell', template: rb.commands.join(' && '), confirm: true }
}
