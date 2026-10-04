import { redactCommand } from '@shared/redact'
import type { PortEntry, PortSnapshot } from '@shared/types'
import { classify, portHint, protection } from './classify'
import { isExposed, parseLsofCwd, parseLsofListeners, parsePs, type Proc } from './parse'

/** Runs a command and returns stdout. Injected so tests can feed captured output. */
export type RunCommand = (file: string, args: string[]) => Promise<string>

export interface ScanDeps {
  run: RunCommand
  /** Login name of whoever runs Cairix, to protect other users' processes. */
  currentUser: string
  /** Cairix's own pid. Its whole ancestor chain is treated as "Cairix itself". */
  selfPid: number
  /** Map a working directory to an added project. */
  resolveProject?: (cwd: string) => { id: string; name: string } | undefined
  /** Which Cairix-started run (if any) owns this pid, given its ancestor chain. */
  runForAncestors?: (ancestors: number[]) => string | undefined
  /** Host port -> container name, when Docker is reachable. */
  dockerPorts?: () => Promise<Map<number, string>>
  now?: () => number
}

/**
 * Remembers each pid's cwd so we only ask lsof about new processes. Misses are
 * remembered too: processes we can't inspect (root-owned, other users') would
 * otherwise be re-queried on every 2-second scan.
 */
export class CwdCache {
  private cache = new Map<number, { cwd: string | null; uptimeSec: number }>()

  async lookup(run: RunCommand, procs: Map<number, Proc>, pids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>()
    const missing: number[] = []
    for (const pid of pids) {
      const hit = this.cache.get(pid)
      const proc = procs.get(pid)
      // uptime going backwards means the pid was reused by a different process
      if (hit && proc && proc.uptimeSec >= hit.uptimeSec - 2) {
        if (hit.cwd) out.set(pid, hit.cwd)
      } else missing.push(pid)
    }
    if (missing.length > 0) {
      try {
        const fresh = parseLsofCwd(await run('lsof', ['-a', '-d', 'cwd', '-p', missing.join(','), '-Fpn']))
        for (const pid of missing) {
          const cwd = fresh.get(pid) ?? null
          if (cwd) out.set(pid, cwd)
          this.cache.set(pid, { cwd, uptimeSec: procs.get(pid)?.uptimeSec ?? 0 })
        }
      } catch {
        /* cwd is a nicety and a failure may be transient: don't cache it, ports still work */
      }
    }
    for (const pid of [...this.cache.keys()]) if (!procs.has(pid)) this.cache.delete(pid)
    return out
  }
}

/** A process that merely launches the real server: pnpm, node, python, make, a shell... */
const WRAPPER = /^(?:\S*\/)?(?:node|pnpm|npm|npx|yarn|bun|bunx|python[\d.]*|uv|poetry|make|sh|bash|zsh|tsx|nodemon)(?:\s|$)/

export function buildTree(procs: Proc[]): { byPid: Map<number, Proc>; children: Map<number, number[]> } {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const children = new Map<number, number[]>()
  for (const p of procs) {
    const list = children.get(p.ppid)
    if (list) list.push(p.pid)
    else children.set(p.ppid, [p.pid])
  }
  return { byPid, children }
}

export function ancestorsOf(pid: number, byPid: Map<number, Proc>, limit = 32): number[] {
  const chain: number[] = []
  let cur = byPid.get(pid)
  while (cur && cur.ppid > 0 && chain.length < limit) {
    chain.push(cur.ppid)
    cur = byPid.get(cur.ppid)
  }
  return chain
}

/** All pids at or below `root`, leaves first (the order to signal them in). */
export function subtreePostOrder(root: number, children: Map<number, number[]>): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  const visit = (pid: number): void => {
    if (seen.has(pid)) return
    seen.add(pid)
    for (const c of children.get(pid) ?? []) visit(c)
    out.push(pid)
  }
  visit(root)
  return out
}

/**
 * The top of the process tree that "is" this dev server. A listener such as
 * `next-server` is usually wrapped (`pnpm` → `sh` → `node next dev` → worker),
 * and the memory the user cares about is the whole stack, and killing "the
 * server" should take the wrappers with it or they'd respawn it.
 *
 * Climb only while the parent is a known launcher, in the same process group,
 * AND has this process as its only child. The last rule matters in monorepos:
 * `pnpm dev` → `turbo` → [web, api, worker] must not make every row show (or
 * kill) the entire stack. Stops at terminal shells (different group) and launchd.
 */
export function footprintRoot(pid: number, byPid: Map<number, Proc>, children: Map<number, number[]>): number {
  let root = pid
  for (;;) {
    const proc = byPid.get(root)
    const parent = proc && byPid.get(proc.ppid)
    if (!proc || !parent || parent.pid <= 1) return root
    if (parent.pgid !== proc.pgid || !WRAPPER.test(parent.command)) return root
    if ((children.get(parent.pid)?.length ?? 0) !== 1) return root
    root = parent.pid
  }
}

/** The snapshot for the UI plus the process tree it was built from (needed to plan a kill). */
export interface ScanResult {
  snapshot: PortSnapshot
  byPid: Map<number, Proc>
  children: Map<number, number[]>
  selfPids: Set<number>
}

export async function scanPorts(deps: ScanDeps, cwdCache: CwdCache): Promise<ScanResult> {
  const started = (deps.now ?? Date.now)()
  let byPid = new Map<number, Proc>()
  let children = new Map<number, number[]>()
  let selfPids = new Set<number>([deps.selfPid])

  const done = (entries: PortEntry[], error?: string): ScanResult => {
    const roots = new Map<number, number>()
    for (const e of entries) {
      if ((e.category === 'dev' || e.category === 'database') && !e.protected) roots.set(e.footprintPid, e.treeRssKb)
    }
    const at = (deps.now ?? Date.now)()
    return {
      snapshot: {
        at,
        entries,
        devRssKb: [...roots.values()].reduce((a, b) => a + b, 0),
        tookMs: at - started,
        error
      },
      byPid,
      children,
      selfPids
    }
  }

  let lsofOut: string
  let psOut: string
  try {
    ;[lsofOut, psOut] = await Promise.all([
      deps.run('lsof', ['+c', '0', '-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcLn']),
      deps.run('ps', ['-axo', 'pid=,ppid=,pgid=,rss=,pcpu=,etime=,command='])
    ])
  } catch (err) {
    return done([], err instanceof Error ? err.message : String(err))
  }

  const listeners = parseLsofListeners(lsofOut)
  ;({ byPid, children } = buildTree(parsePs(psOut)))
  selfPids = new Set([deps.selfPid, ...ancestorsOf(deps.selfPid, byPid)])
  const cwds = await cwdCache.lookup(deps.run, byPid, [...new Set(listeners.map((l) => l.pid))])
  const docker = deps.dockerPorts ? await deps.dockerPorts().catch(() => new Map<number, string>()) : new Map()

  const sum = (root: number, pick: (p: Proc) => number): number => {
    let total = 0
    for (const pid of subtreePostOrder(root, children)) {
      const p = byPid.get(pid)
      if (p) total += pick(p)
    }
    return total
  }

  const entries: PortEntry[] = []
  for (const l of listeners) {
    const proc = byPid.get(l.pid)
    if (!proc) continue // exited between lsof and ps
    const root = footprintRoot(l.pid, byPid, children)
    const { framework, category } = classify(proc.command)
    const prot = protection({
      pid: l.pid,
      command: proc.command,
      selfPids,
      currentUser: deps.currentUser,
      user: l.user
    })
    const cwd = cwds.get(l.pid)
    const project = cwd ? deps.resolveProject?.(cwd) : undefined
    const container = docker.get(l.port)

    entries.push({
      port: l.port,
      address: l.address,
      exposed: isExposed(l.address),
      pid: l.pid,
      ppid: proc.ppid,
      pgid: proc.pgid,
      name: l.name || proc.command.split(/\s+/)[0],
      // Classified above from the raw command; only a redacted copy leaves this function.
      cmdline: redactCommand(proc.command),
      user: l.user,
      rssKb: proc.rssKb,
      treeRssKb: sum(root, (p) => p.rssKb),
      footprintPid: root,
      cpu: Math.round(sum(root, (p) => p.cpu) * 10) / 10,
      uptimeSec: proc.uptimeSec,
      cwd,
      projectId: project?.id,
      projectName: project?.name,
      runId: deps.runForAncestors?.([l.pid, ...ancestorsOf(l.pid, byPid)]),
      framework,
      category: prot.protected && /macOS/.test(prot.reason ?? '') ? 'system' : category,
      protected: prot.protected,
      protectReason: prot.reason,
      hint: container ? `Docker container: ${container}` : portHint(l.port, proc.command)
    })
  }

  entries.sort((a, b) => a.port - b.port || a.pid - b.pid)
  return done(entries)
}
