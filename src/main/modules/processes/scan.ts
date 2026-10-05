import { redactCommand } from '@shared/redact'
import type { PortCategory, PortEntry, ProcessEntry } from '@shared/types'
import { classify, protection } from '../ports/classify'
import { parsePs, type Proc } from '../ports/parse'
import { buildTree, subtreePostOrder, type RunCommand } from '../ports/scanner'

export type ProcessFilter = 'dev' | 'all'

export interface ProcessScanDeps {
  run: RunCommand
  currentUser: string
  selfPid: number
  /** Listening ports, to show which background process owns which port. */
  ports(): PortEntry[]
  /** Which Cairix-started run (if any) owns one of these pids. */
  runForAncestors?(chain: number[]): string | undefined
}

export interface ProcessScan {
  entries: ProcessEntry[]
  total: number
  byPid: Map<number, Proc>
  children: Map<number, number[]>
  selfPids: Set<number>
}

/** Apps installed in /Applications are not "background processes" you'd want to stop from a dev tool. */
const INSTALLED_APP = /\/Applications\/[^/]+\.app\//

/** Shells and terminal plumbing hold sessions open; they are never the thing to show, and must not swallow what they launched. */
const SHELL_LIKE = /^(?:-?(?:zsh|bash|sh|fish|dash|tcsh|ksh)|login|tmux|screen|sudo|su|ssh-agent)(?:\s|:|$)/

const MAX_ROWS = 300

/** Friendly name: the app bundle for `.app` executables (their names can contain spaces), else the executable's file name. */
export function shortName(command: string): string {
  const app = command.match(/([^/]+)\.app\/Contents\/MacOS\//)
  if (app) return app[1]
  const exe = command.match(/^\S+/)?.[0] ?? command
  return exe.split('/').pop() || exe
}

function ancestorChain(pid: number, byPid: Map<number, Proc>): number[] {
  const chain: number[] = []
  let cur = byPid.get(pid)
  while (cur && cur.ppid > 0 && chain.length < 32) {
    chain.push(cur.ppid)
    cur = byPid.get(cur.ppid)
  }
  return chain
}

/**
 * Lists the current user's background work, one row per process *tree*: the
 * top-most matching process stands for everything it launched, so `pnpm dev`
 * shows once with the memory of the whole stack instead of ten `node` rows.
 *
 * `dev` keeps recognised dev tooling and databases; `all` keeps every process
 * of yours that is not part of macOS, an installed app, or Cairix itself.
 */
export async function scanProcesses(deps: ProcessScanDeps, filter: ProcessFilter): Promise<ProcessScan> {
  const out = await deps.run('ps', ['-U', deps.currentUser, '-o', 'pid=,ppid=,pgid=,rss=,pcpu=,etime=,command='])
  const procs = parsePs(out)
  const { byPid, children } = buildTree(procs)
  const selfPids = new Set<number>([deps.selfPid, ...ancestorChain(deps.selfPid, byPid)])

  const listening = new Map<number, number[]>()
  for (const e of deps.ports()) listening.set(e.pid, [...(listening.get(e.pid) ?? []), e.port])

  const candidate = new Map<number, { category: PortCategory; framework?: string }>()
  for (const p of procs) {
    if (p.pid <= 1 || selfPids.has(p.pid)) continue
    // Cairix's own helpers (GPU, renderer, plugin windows) are children of its main process.
    if (ancestorChain(p.pid, byPid).includes(deps.selfPid)) continue
    if (INSTALLED_APP.test(p.command) || SHELL_LIKE.test(shortName(p.command))) continue
    const prot = protection({ pid: p.pid, command: p.command, selfPids, currentUser: deps.currentUser, user: deps.currentUser })
    if (prot.protected) continue
    const c = classify(p.command)
    if (filter === 'dev' && c.category === 'other') continue
    candidate.set(p.pid, c)
  }

  const entries: ProcessEntry[] = []
  for (const [pid, c] of candidate) {
    const chain = ancestorChain(pid, byPid)
    if (chain.some((a) => candidate.has(a))) continue // shown under its ancestor
    const proc = byPid.get(pid)!
    const tree = subtreePostOrder(pid, children).filter((x) => byPid.has(x))
    let treeRss = 0
    const ports = new Set<number>()
    for (const t of tree) {
      treeRss += byPid.get(t)!.rssKb
      for (const port of listening.get(t) ?? []) ports.add(port)
    }
    const runId = deps.runForAncestors?.([pid, ...chain])
    entries.push({
      pid,
      name: shortName(proc.command),
      cmdline: redactCommand(proc.command),
      rssKb: proc.rssKb,
      treeRssKb: treeRss,
      procCount: tree.length,
      cpu: tree.reduce((a, t) => a + byPid.get(t)!.cpu, 0),
      uptimeSec: proc.uptimeSec,
      ports: [...ports].sort((a, b) => a - b),
      runId,
      framework: c.framework,
      category: c.category
    })
  }
  entries.sort((a, b) => b.treeRssKb - a.treeRssKb)
  return { entries: entries.slice(0, MAX_ROWS), total: procs.length, byPid, children, selfPids }
}

export type StopPlan = { ok: true; targets: number[] } | { ok: false; error: string }

/**
 * What may be signalled to stop `pid`: only a tree root from a scan taken just
 * now (so a stale or forged pid is refused), never Cairix itself or pid 1.
 */
export function planStop(scan: ProcessScan, pid: number): StopPlan {
  const entry = scan.entries.find((e) => e.pid === pid)
  if (!entry) return { ok: false, error: 'That process is no longer running.' }
  const targets = subtreePostOrder(pid, scan.children).filter((p) => scan.byPid.has(p))
  if (targets.some((p) => p <= 1)) return { ok: false, error: 'Refusing to signal a system process.' }
  if (targets.some((p) => scan.selfPids.has(p))) return { ok: false, error: 'This process shares a tree with Cairix itself.' }
  return { ok: true, targets }
}
