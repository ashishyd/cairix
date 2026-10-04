import type { KillResult, PortEntry } from '@shared/types'
import type { Proc } from './parse'
import { subtreePostOrder } from './scanner'

/**
 * Killing is the one irreversible thing Cairix does to the user's machine, so
 * it is split in two: a pure `planKill` that decides *what may be signalled*
 * (and refuses anything protected), and `terminateTree` that does the
 * signalling with graceful-then-force semantics.
 */

export type KillPlan = { ok: true; targets: number[] } | { ok: false; error: string }

/**
 * Plans the kill of one listening entry. The target is the entry's whole
 * footprint (launcher chain + descendants) so killing `next-server` also
 * takes down the `pnpm`/`node` wrappers that would otherwise respawn it.
 * `entry` must come from a scan taken just now, never from the renderer's
 * copy, so a stale or forged pid can't be signalled.
 */
export function planKill(
  entry: PortEntry | undefined,
  children: Map<number, number[]>,
  byPid: Map<number, Proc>,
  selfPids: ReadonlySet<number>
): KillPlan {
  if (!entry) return { ok: false, error: 'That process is no longer listening on a port.' }
  if (entry.protected) return { ok: false, error: entry.protectReason ?? 'This process is protected.' }
  const targets = subtreePostOrder(entry.footprintPid, children).filter((pid) => byPid.has(pid))
  if (targets.some((pid) => pid <= 1)) return { ok: false, error: 'Refusing to signal a system process.' }
  if (targets.some((pid) => selfPids.has(pid))) {
    return { ok: false, error: 'This process shares a tree with Cairix itself.' }
  }
  return { ok: true, targets }
}

export interface TerminateDeps {
  /** process.kill, injectable for tests. Signal 0 only probes. */
  signal: (pid: number, sig: NodeJS.Signals | 0) => void
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export const realTerminateDeps: TerminateDeps = {
  signal: (pid, sig) => {
    process.kill(pid, sig)
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now
}

function isAlive(pid: number, deps: TerminateDeps): boolean {
  try {
    deps.signal(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' // exists, just not ours
  }
}

/** SIGTERM (or SIGKILL when forced), leaves first, then wait for exit. */
export async function terminateTree(
  targets: number[],
  force: boolean,
  deps: TerminateDeps = realTerminateDeps
): Promise<KillResult> {
  const sig: NodeJS.Signals = force ? 'SIGKILL' : 'SIGTERM'
  const signalled: number[] = []
  let error: string | undefined
  for (const pid of targets) {
    try {
      deps.signal(pid, sig)
      signalled.push(pid)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ESRCH') continue // already gone: that's the goal
      error = code === 'EPERM' ? `Permission denied for pid ${pid}.` : `Could not signal pid ${pid}: ${String(e)}`
    }
  }
  const deadline = deps.now() + (force ? 1500 : 3000)
  let alive = signalled.filter((pid) => isAlive(pid, deps))
  while (alive.length > 0 && deps.now() < deadline) {
    await deps.sleep(100)
    alive = alive.filter((pid) => isAlive(pid, deps))
  }
  return { ok: alive.length === 0 && !error, signal: sig, signalled, stillAlive: alive, error }
}
