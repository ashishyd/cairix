import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import type { LogSnapshot, Project, RunInfo, RunOutputEvent } from '@shared/types'
import { spawnEnv } from '../../shell-env'
import type { ResolvedScript, SpawnSpec } from './detect'

/**
 * Starts and supervises user scripts. Each run is its own process group
 * (`detached: true`) so Stop takes down the whole tree (pnpm → sh → node →
 * workers) rather than orphaning the real server behind a dead launcher.
 */

const MAX_LOG_CHARS = 2_000_000
const MAX_FINISHED_RUNS = 30
const FLUSH_MS = 50
const FORCE_KILL_AFTER_MS = 5000

/** Bounded text log: oldest output is dropped once the cap is exceeded. */
export class LogBuffer {
  private chunks: string[] = []
  private size = 0
  constructor(private readonly cap = MAX_LOG_CHARS) {}

  push(text: string): void {
    this.chunks.push(text)
    this.size += text.length
    while (this.size > this.cap && this.chunks.length > 1) this.size -= this.chunks.shift()!.length
  }
  toString(): string {
    return this.chunks.join('')
  }
}

const CONFLICT_PATTERNS = [
  /EADDRINUSE[^\n]*?(?::|port\s+)(\d{2,5})\b/i,
  /address already in use[^\n]*?:(\d{2,5})\b/i,
  /port\s+(\d{2,5})\s+is\s+(?:already\s+)?in use/i
]

/** Finds "port N is taken" in dev-server output so the UI can offer to free it. */
export function detectPortConflict(text: string): number | undefined {
  for (const re of CONFLICT_PATTERNS) {
    const m = text.match(re)
    if (m) return Number.parseInt(m[1], 10)
  }
  return undefined
}

export function buildSpawnArgs(spec: SpawnSpec, extra: string[]): string[] {
  if (extra.length === 0) return spec.args
  return spec.argsSeparator ? [...spec.args, spec.argsSeparator, ...extra] : [...spec.args, ...extra]
}

export function validateExtraArgs(args: unknown): string[] {
  if (args === undefined) return []
  if (!Array.isArray(args) || args.length > 20) throw new Error('Too many arguments.')
  for (const a of args) {
    if (typeof a !== 'string' || a.length > 500 || a.includes('\0')) throw new Error('Invalid argument.')
  }
  return args as string[]
}

interface Run {
  info: RunInfo
  child: ChildProcess
  log: LogBuffer
  /** Characters appended so far (never reduced by log trimming). */
  total: number
  stoppedByUser: boolean
  forceTimer?: NodeJS.Timeout
}

export interface RunnerEvents {
  onRun(info: RunInfo): void
  onOutput(e: RunOutputEvent): void
}

export class ScriptRunner {
  private runs = new Map<string, Run>()
  private pending = new Map<string, { offset: number; chunk: string }>()
  private flushTimer?: NodeJS.Timeout

  constructor(private readonly events: RunnerEvents) {}

  /** Starts a script, or returns the existing run if that script is already running. */
  async start(
    script: ResolvedScript,
    project: Project,
    projectLabel: string,
    extraArgs: string[],
    autoRestarts = 0
  ): Promise<RunInfo> {
    const existing = [...this.runs.values()].find(
      (r) => r.info.scriptId === script.def.id && (r.info.status === 'running' || r.info.status === 'stopping')
    )
    if (existing) return existing.info

    const spec = script.spawn
    const env = await spawnEnv({ FORCE_COLOR: '1', TERM: 'xterm-256color', BROWSER: 'none', ...spec.env })
    const args = buildSpawnArgs(spec, extraArgs)
    const child = spawn(spec.file, args, {
      cwd: spec.cwd,
      env,
      detached: true,
      // stdin stays an open pipe we never write to: tools like Create React App
      // exit when stdin hits EOF, which /dev/null (stdio 'ignore') would cause.
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const runId = randomUUID()
    const info: RunInfo = {
      runId,
      scriptId: script.def.id,
      projectId: project.id,
      projectName: projectLabel,
      scriptName: script.def.name,
      command: [spec.file, ...args].join(' '),
      pid: child.pid ?? 0,
      startedAt: Date.now(),
      status: 'running',
      ports: [],
      ...(extraArgs.length > 0 ? { args: extraArgs } : {}),
      ...(autoRestarts > 0 ? { autoRestarts } : {})
    }
    const run: Run = { info, child, log: new LogBuffer(), total: 0, stoppedByUser: false }
    this.runs.set(runId, run)
    this.trimFinished()
    this.appendLog(run, `\x1b[2m$ ${info.command}\x1b[0m\r\n`)

    const onData = (d: Buffer): void => this.appendLog(run, d.toString('utf8'))
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.stdin?.on('error', () => undefined) // EPIPE after the child exits is expected

    child.on('error', (err: NodeJS.ErrnoException) => {
      const hint =
        err.code === 'ENOENT'
          ? `\`${spec.file}\` was not found. Is it installed and on your PATH?`
          : err.message
      this.appendLog(run, `\r\n\x1b[31mFailed to start: ${hint}\x1b[0m\r\n`)
      this.finish(run, 'failed', null)
    })
    child.on('exit', (code, signal) => {
      // Dying from a signal means someone stopped it (us, or kill from the Ports tab): not a failure.
      const status = run.stoppedByUser || signal ? 'stopped' : code === 0 ? 'exited' : 'failed'
      this.appendLog(
        run,
        `\r\n\x1b[2m[${signal ? `stopped by ${signal}` : `exited with code ${code}`}]\x1b[0m\r\n`
      )
      this.finish(run, status, code)
    })

    this.events.onRun({ ...info })
    return info
  }

  stop(runId: string, force = false): void {
    const run = this.runs.get(runId)
    if (!run || (run.info.status !== 'running' && run.info.status !== 'stopping')) return
    run.stoppedByUser = true
    run.info = { ...run.info, status: 'stopping' }
    this.events.onRun({ ...run.info })
    this.signalGroup(run, force ? 'SIGKILL' : 'SIGTERM')
    if (!force && !run.forceTimer) {
      run.forceTimer = setTimeout(() => this.signalGroup(run, 'SIGKILL'), FORCE_KILL_AFTER_MS)
    }
  }

  /** Called on quit so dev servers don't outlive the app as orphans. */
  stopAll(): void {
    for (const run of this.runs.values()) {
      if (run.info.status === 'running' || run.info.status === 'stopping') {
        run.stoppedByUser = true
        this.signalGroup(run, 'SIGTERM')
      }
    }
  }

  stopForProjects(projectIds: Set<string>): void {
    for (const run of this.runs.values()) if (projectIds.has(run.info.projectId)) this.stop(run.info.runId)
  }

  list(): RunInfo[] {
    return [...this.runs.values()].map((r) => ({ ...r.info })).sort((a, b) => b.startedAt - a.startedAt)
  }

  get(runId: string): RunInfo | undefined {
    const r = this.runs.get(runId)
    return r ? { ...r.info } : undefined
  }

  log(runId: string): LogSnapshot {
    const run = this.runs.get(runId)
    return run ? { text: run.log.toString(), length: run.total } : { text: '', length: 0 }
  }

  /** Active run pids, for linking listening ports back to the run that owns them. */
  activePids(): Map<number, string> {
    const map = new Map<number, string>()
    for (const r of this.runs.values()) {
      if ((r.info.status === 'running' || r.info.status === 'stopping') && r.info.pid > 0) map.set(r.info.pid, r.info.runId)
    }
    return map
  }

  /** Records which ports a run's process tree is listening on; notifies only on change. */
  setPorts(runId: string, ports: number[]): void {
    const run = this.runs.get(runId)
    if (!run) return
    const next = [...new Set(ports)].sort((a, b) => a - b)
    if (next.join() === run.info.ports.join()) return
    run.info = { ...run.info, ports: next }
    this.events.onRun({ ...run.info })
  }

  // ───────────────────────── internals ─────────────────────────

  private signalGroup(run: Run, signal: NodeJS.Signals): void {
    const pid = run.info.pid
    if (pid <= 0) return
    try {
      process.kill(-pid, signal) // negative pid = the whole process group
    } catch {
      try {
        run.child.kill(signal)
      } catch {
        /* already gone */
      }
    }
  }

  private finish(run: Run, status: RunInfo['status'], exitCode: number | null): void {
    if (run.info.endedAt) return // 'error' and 'exit' can both fire
    if (run.forceTimer) clearTimeout(run.forceTimer)
    run.info = { ...run.info, status, exitCode, endedAt: Date.now(), ports: [] }
    this.flush()
    this.events.onRun({ ...run.info })
  }

  private appendLog(run: Run, text: string): void {
    run.log.push(text)
    const queued = this.pending.get(run.info.runId)
    if (queued) queued.chunk += text
    else this.pending.set(run.info.runId, { offset: run.total, chunk: text })
    run.total += text.length
    if (!run.info.portConflict) {
      const port = detectPortConflict(text)
      if (port) {
        run.info = { ...run.info, portConflict: port }
        this.events.onRun({ ...run.info })
      }
    }
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS)
  }

  /** Output is batched so a chatty build doesn't flood the IPC channel. */
  private flush(): void {
    this.flushTimer = undefined
    for (const [runId, { offset, chunk }] of this.pending) this.events.onOutput({ runId, chunk, offset })
    this.pending.clear()
  }

  private trimFinished(): void {
    const finished = [...this.runs.values()]
      .filter((r) => r.info.endedAt)
      .sort((a, b) => (a.info.endedAt ?? 0) - (b.info.endedAt ?? 0))
    while (finished.length > MAX_FINISHED_RUNS) this.runs.delete(finished.shift()!.info.runId)
  }
}
