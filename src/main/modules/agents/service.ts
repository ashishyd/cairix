import { execFile } from 'child_process'
import { basename } from 'path'
import { promisify } from 'util'
import type { AgentCli, AgentSession, AgentsSnapshot } from '@shared/types'
import { spawnEnv } from '../../shell-env'
import { parsePs } from '../ports/parse'
import { buildTree, CwdCache, type RunCommand } from '../ports/scanner'
import { isSessionLive, parseLstart, readClaudeSessions } from './claude'
import { cursorApp, findCursorWorkers, readCursorPlans } from './cursor'

const execFileAsync = promisify(execFile)

// ───────────────────────── CLI detection ─────────────────────────

const cliCache = new Map<string, { at: number; value: AgentCli }>()
const CLI_TTL_MS = 5 * 60_000

/** Is the CLI installed and runnable from the user's login shell? Cached: spawning it is slow. */
export async function detectCli(bin: string): Promise<AgentCli> {
  const hit = cliCache.get(bin)
  if (hit && Date.now() - hit.at < CLI_TTL_MS) return hit.value
  let value: AgentCli
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { env: await spawnEnv(), timeout: 5000 })
    value = { installed: true, version: stdout.trim().split('\n')[0]?.slice(0, 80) || undefined }
    if (bin.endsWith('claude')) value.billing = await claudeBilling(bin)
  } catch {
    value = { installed: false }
  }
  cliCache.set(bin, { at: Date.now(), value })
  return value
}

/** `claude auth status` → 'subscription' for a claude.ai login, 'api' for an API key/cloud provider, undefined if unknown. */
export async function claudeBilling(bin: string): Promise<AgentCli['billing']> {
  try {
    const env = await spawnEnv()
    if (env.ANTHROPIC_API_KEY) return 'api'
    const { stdout } = await execFileAsync(bin, ['auth', 'status'], { env, timeout: 5000 })
    return parseBilling(stdout)
  } catch {
    return undefined
  }
}

export function parseBilling(stdout: string): AgentCli['billing'] {
  try {
    const j = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string; apiProvider?: string }
    if (!j.loggedIn) return undefined
    if (j.authMethod === 'claude.ai') return 'subscription'
    return 'api'
  } catch {
    return undefined
  }
}

// ───────────────────────── snapshot ─────────────────────────

export interface AgentsDeps {
  run: RunCommand
  home: string
  resolveProject?: (cwd: string) => { id: string; name: string } | undefined
  detectCli?: (bin: string) => Promise<AgentCli>
  now?: () => number
}

const PS_ARGS = ['-axo', 'pid=,ppid=,pgid=,rss=,pcpu=,etime=,command=']

export async function buildAgentsSnapshot(deps: AgentsDeps, cwdCache: CwdCache): Promise<AgentsSnapshot> {
  const now = (deps.now ?? Date.now)()
  const detect = deps.detectCli ?? detectCli

  const [psOut, records, plans, claude, cursorCli] = await Promise.all([
    deps.run('ps', PS_ARGS).catch(() => ''),
    readClaudeSessions(deps.home),
    readCursorPlans(deps.home),
    detect('claude'),
    detect('cursor-agent')
  ])
  const procList = parsePs(psOut)
  const { byPid } = buildTree(procList)

  // Confirm each registry entry is a live process that really is that session.
  let lstart = new Map<number, string>()
  const candidates = records.filter((r) => byPid.has(r.pid) && r.procStart)
  if (candidates.length > 0) {
    lstart = parseLstart(await deps.run('ps', ['-o', 'pid=,lstart=', '-p', candidates.map((r) => r.pid).join(',')]).catch(() => ''))
  }
  const live = records.filter((r) => isSessionLive(r, byPid, lstart))

  const workers = findCursorWorkers(procList)
  const workerCwds = await cwdCache.lookup(deps.run, byPid, workers.map((w) => w.pid))

  const sessions: AgentSession[] = []
  for (const rec of live) {
    const proc = byPid.get(rec.pid)!
    const project = deps.resolveProject?.(rec.cwd)
    sessions.push({
      id: rec.sessionId,
      kind: 'claude',
      pid: rec.pid,
      title: rec.name?.trim() || 'Untitled session',
      cwd: rec.cwd,
      projectId: project?.id,
      projectName: project?.name,
      status: rec.status === 'busy' ? 'busy' : 'idle',
      startedAt: rec.startedAt,
      updatedAt: rec.updatedAt,
      rssKb: proc.rssKb,
      cpu: proc.cpu,
      surface: rec.entrypoint,
      version: rec.version
    })
  }
  for (const w of workers) {
    const cwd = workerCwds.get(w.pid) ?? ''
    const project = cwd ? deps.resolveProject?.(cwd) : undefined
    sessions.push({
      id: `cursor:${w.pid}`,
      kind: 'cursor',
      pid: w.pid,
      title: cwd ? `Cursor agent · ${basename(cwd)}` : 'Cursor agent worker',
      cwd,
      projectId: project?.id,
      projectName: project?.name,
      status: 'running',
      startedAt: now - w.uptimeSec * 1000,
      rssKb: w.rssKb,
      cpu: w.cpu
    })
  }

  // Busy agents first (that's what you glance at), then most recently active.
  const rank = (s: AgentSession): number => (s.status === 'busy' ? 0 : s.status === 'running' ? 1 : 2)
  sessions.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? b.startedAt) - (a.updatedAt ?? a.startedAt))

  const app = cursorApp(procList)
  return {
    at: now,
    claude,
    cursor: { ...cursorCli, appRunning: app.running, appRssKb: app.rssKb },
    sessions,
    plans
  }
}

/** Shares one in-flight build between concurrent callers and keeps the cwd cache across calls. */
export class AgentsService {
  private cwdCache = new CwdCache()
  private inflight?: Promise<AgentsSnapshot>
  constructor(private readonly deps: AgentsDeps) {}

  snapshot(): Promise<AgentsSnapshot> {
    this.inflight ??= buildAgentsSnapshot(this.deps, this.cwdCache).finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }
}
