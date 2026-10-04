import { open, readdir, stat } from 'fs/promises'
import { join } from 'path'
import type { CursorPlan } from '@shared/types'
import type { Proc } from '../ports/parse'

/**
 * Cursor exposes much less than Claude Code does: there is no session
 * registry, so what can be shown honestly is (a) whether the app is running,
 * (b) the background `cursor-agent` worker processes and which folder each
 * works in, and (c) the plans its agent has written to ~/.cursor/plans.
 *
 * Worker command lines contain `--api-key`, so nothing from them is ever
 * returned except pid, memory and the folder: they are matched, not copied.
 */

/** The agent CLI binary (`…/cursor-agent`), not an editor helper that merely mentions it. */
const WORKER = /(?:^|\/)cursor-agent(?:\s|$)/

export function findCursorWorkers(procs: Proc[]): Proc[] {
  return procs.filter((p) => WORKER.test(p.command.split(/\s+--/)[0]))
}

/** Total memory of the Cursor editor (main process plus every helper). */
export function cursorApp(procs: Proc[]): { running: boolean; rssKb: number } {
  const mine = procs.filter((p) => p.command.includes('/Cursor.app/Contents/'))
  return { running: mine.length > 0, rssKb: mine.reduce((n, p) => n + p.rssKb, 0) }
}

/** Plan files start with `---\nname: Some Title\n…`. Read just enough to get the title. */
export function planTitle(head: string, fallback: string): string {
  const m = head.match(/^---\s*\n(?:.*\n)*?name:\s*(.+?)\s*\n/)
  return m ? m[1].replace(/^["']|["']$/g, '') : fallback
}

export async function readCursorPlans(home: string, limit = 8): Promise<CursorPlan[]> {
  const dir = join(home, '.cursor', 'plans')
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.plan.md'))
  } catch {
    return []
  }
  const withTimes = await Promise.all(
    names.map(async (n) => {
      try {
        return { name: n, path: join(dir, n), modifiedAt: (await stat(join(dir, n))).mtimeMs }
      } catch {
        return null
      }
    })
  )
  const recent = withTimes
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, limit)

  return Promise.all(
    recent.map(async (p) => {
      let head = ''
      try {
        const fh = await open(p.path, 'r')
        try {
          const buf = Buffer.alloc(1024)
          const { bytesRead } = await fh.read(buf, 0, 1024, 0)
          head = buf.subarray(0, bytesRead).toString('utf8')
        } finally {
          await fh.close()
        }
      } catch {
        /* unreadable: fall back to the file name */
      }
      return { title: planTitle(head, p.name.replace(/\.plan\.md$/, '').replace(/_[0-9a-f]{8}$/, '').replace(/_/g, ' ')), path: p.path, modifiedAt: p.modifiedAt }
    })
  )
}
