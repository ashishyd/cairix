import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join, relative } from 'path'
import { z } from 'zod'
import { redactTokens } from '@shared/redact'
import type { AgentCli, AgentTask, FixProposal, StartTaskRequest, TaskCapabilities, TaskEvent } from '@shared/types'
import { readJson, writeJsonAtomic } from '../../json-store'
import { spawnEnv } from '../../shell-env'
import { claudeBin } from '../changes/ai'
import { parseDiff } from '../changes/diff'
import { withSnapshotWorktree, worktreePatch } from '../changes/fix'
import { readChanges } from '../changes/git'
import { parseStreamLine } from './stream'

export const cursorBin = (): string => process.env.CAIRIX_CURSOR_BIN || 'cursor-agent'

const MAX_EVENTS = 500
const VISIBLE_EVENTS = 80
const MAX_HISTORY = 50
const MAX_PATCH = 1_000_000
const DEFAULT_TIMEOUT_MS = 10 * 60_000

const request = z.object({
  agent: z.enum(['claude', 'cursor']),
  mode: z.enum(['read', 'edit']),
  prompt: z.string().trim().min(1, 'Describe what you want done.').max(8000, 'That prompt is too long (8000 characters at most).'),
  budgetUsd: z.number().min(0.05).max(5).optional()
})

export interface TasksDeps {
  project(id: string): { path: string; trusted: boolean } | undefined
  dataDir: string
  detect(bin: string): Promise<AgentCli>
  registerProposal(projectId: string, sourceId: string, patch: string, costUsd?: number): Promise<FixProposal>
  /** Override executables (tests). */
  bins?: { claude?: string; cursor?: string }
  maxConcurrent?: number
  timeoutMs?: number
  /** Called once a task has reached a final state (done, failed or cancelled). */
  onFinish?(task: AgentTask): void
}

export interface Command {
  file: string
  args: string[]
  /** Text to send on stdin. Used for Claude so the prompt never appears in the process list. */
  stdin?: string
}

const PREAMBLE = {
  read: 'You are answering a question about this codebase. Read what you need, but do not modify any file and do not run commands.',
  edit: 'Make the requested change directly in the files with the smallest correct edits. Do not run commands, install anything, or touch unrelated code. When done, reply with a short summary of what you changed.'
}

/** Pure: the exact command line for a task. Tested directly, because this is where read-only is enforced. */
export function buildCommand(req: StartTaskRequest, cwd: string, bins: { claude: string; cursor: string }): Command {
  const full = `${PREAMBLE[req.mode]}\n\n${req.prompt}`
  if (req.agent === 'claude') {
    return {
      file: bins.claude,
      stdin: full,
      args: [
        '-p', '--output-format', 'stream-json', '--verbose',
        '--no-session-persistence', '--strict-mcp-config',
        '--max-budget-usd', String(req.budgetUsd ?? 0.5),
        ...(req.mode === 'read'
          ? ['--allowedTools', 'Read Grep Glob', '--disallowedTools', 'Bash Edit Write NotebookEdit WebFetch WebSearch', '--permission-mode', 'plan']
          : ['--allowedTools', 'Read Grep Glob Edit Write', '--disallowedTools', 'Bash WebFetch WebSearch', '--permission-mode', 'acceptEdits'])
      ]
    }
  }
  return { file: bins.cursor, args: ['-p', full, '--output-format', 'stream-json', '--sandbox', 'enabled', '--workspace', cwd, ...(req.mode === 'read' ? ['--mode', 'ask'] : [])] }
}

const AUTH = /authenticat|sign.?in|log.?in|oauth|credential|not logged/i

export class TasksService {
  private tasks: AgentTask[]
  private aborts = new Map<string, AbortController>()
  private patches = new Map<string, string>()
  private readonly file: string

  constructor(private readonly deps: TasksDeps) {
    this.file = join(deps.dataDir, 'agent-tasks.json')
    const stored = readJson(this.file, z.object({ tasks: z.array(z.any()) }), () => ({ tasks: [] })).tasks as AgentTask[]
    // A task that was running when Cairix quit cannot still be running.
    this.tasks = stored.map((t) => (t.status === 'running' ? { ...t, status: 'failed' as const, endedAt: Date.now(), error: 'Cairix was closed while this was running.' } : t))
  }

  private bins(): { claude: string; cursor: string } {
    return { claude: this.deps.bins?.claude ?? claudeBin(), cursor: this.deps.bins?.cursor ?? cursorBin() }
  }

  async capabilities(): Promise<TaskCapabilities> {
    const b = this.bins()
    const [claude, cursor] = await Promise.all([this.deps.detect(b.claude), this.deps.detect(b.cursor)])
    return { claude: claude.installed, cursor: cursor.installed }
  }

  list(projectId: string): AgentTask[] {
    return this.tasks
      .filter((t) => t.projectId === projectId)
      .map((t) => ({ ...t, events: t.events.slice(-VISIBLE_EVENTS) }))
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  private save(): void {
    this.tasks = this.tasks.slice(-MAX_HISTORY)
    writeJsonAtomic(this.file, { tasks: this.tasks })
  }

  async start(projectId: string, raw: StartTaskRequest): Promise<AgentTask> {
    const req = request.parse(raw)
    const project = this.deps.project(projectId)
    if (!project) throw new Error('That project is no longer in Cairix.')
    if (!project.trusted) throw new Error('Trust this folder before giving an agent a task in it.')
    if (this.tasks.filter((t) => t.status === 'running').length >= (this.deps.maxConcurrent ?? 3)) {
      throw new Error('Three tasks are already running. Wait for one to finish or cancel it.')
    }
    const bin = req.agent === 'claude' ? this.bins().claude : this.bins().cursor
    if (!(await this.deps.detect(bin)).installed) throw new Error(`${req.agent === 'claude' ? 'Claude Code' : 'The Cursor agent'} was not found on your PATH.`)

    let top = project.path
    if (req.mode === 'edit') {
      const repo = await readChanges(project.path)
      if (!repo.isRepo) throw new Error('Tasks that change code need this folder to be a git repository, so the result can be reviewed safely. Use read-only mode instead.')
      top = repo.top
    }

    const task: AgentTask = { id: randomUUID(), projectId, agent: req.agent, mode: req.mode, prompt: req.prompt, status: 'running', startedAt: Date.now(), events: [], budgetUsd: req.agent === 'claude' ? req.budgetUsd ?? 0.5 : undefined }
    this.tasks.push(task)
    this.save()
    const abort = new AbortController()
    this.aborts.set(task.id, abort)
    void this.execute(task, req, project.path, top, abort.signal).finally(() => this.aborts.delete(task.id))
    return { ...task }
  }

  cancel(taskId: string): AgentTask {
    this.aborts.get(taskId)?.abort()
    return this.get(taskId)
  }

  stopAll(): void {
    for (const a of this.aborts.values()) a.abort()
  }

  private get(taskId: string): AgentTask {
    const t = this.tasks.find((x) => x.id === taskId)
    if (!t) throw new Error('That task no longer exists.')
    return { ...t, events: t.events.slice(-VISIBLE_EVENTS) }
  }

  async remove(taskId: string): Promise<void> {
    const t = this.tasks.find((x) => x.id === taskId)
    if (t?.status === 'running') throw new Error('Cancel the task before removing it.')
    this.tasks = this.tasks.filter((x) => x.id !== taskId)
    this.patches.delete(taskId)
    await rm(join(this.deps.dataDir, 'agent-tasks', `${taskId}.patch`), { force: true })
    this.save()
  }

  async propose(taskId: string): Promise<FixProposal> {
    const t = this.tasks.find((x) => x.id === taskId)
    if (!t || t.mode !== 'edit' || t.status !== 'done' || !t.changes) throw new Error('This task has no changes to apply.')
    const patch = this.patches.get(taskId) ?? (await readFile(join(this.deps.dataDir, 'agent-tasks', `${taskId}.patch`), 'utf8').catch(() => ''))
    if (!patch) throw new Error('The saved changes for this task are gone.')
    return this.deps.registerProposal(t.projectId, taskId, patch, t.costUsd)
  }

  // ───────────────────────── running ─────────────────────────

  private async execute(task: AgentTask, req: StartTaskRequest, projectPath: string, top: string, signal: AbortSignal): Promise<void> {
    const t = this.tasks.find((x) => x.id === task.id)!
    const push = (e: TaskEvent): void => {
      t.events.push(e)
      if (t.events.length > MAX_EVENTS) t.events.splice(0, t.events.length - MAX_EVENTS)
    }
    try {
      let patch = ''
      if (req.mode === 'read') {
        await this.runCli(t, req, projectPath, push, signal)
      } else {
        const repo = await readChanges(projectPath)
        patch = await withSnapshotWorktree(top, join(this.deps.dataDir, 'worktrees'), repo.entries.map((e) => ({ path: e.path, status: e.status })), async (wt) => {
          await this.runCli(t, req, join(wt, relative(top, projectPath)), push, signal)
          return worktreePatch(wt)
        })
      }
      if (signal.aborted) throw new Error('__cancelled__')
      if (req.mode === 'edit') {
        if (patch.length > MAX_PATCH) throw new Error('The agent changed too much to review safely (over 1 MB).')
        if (patch.trim()) {
          const files = parseDiff(patch)
          t.changes = { files: files.map((f) => f.path), additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) }
          this.patches.set(t.id, patch)
          await mkdir(join(this.deps.dataDir, 'agent-tasks'), { recursive: true })
          await writeFile(join(this.deps.dataDir, 'agent-tasks', `${t.id}.patch`), patch)
        }
      }
      t.status = 'done'
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (signal.aborted || msg === '__cancelled__') {
        t.status = 'cancelled'
        push({ kind: 'info', text: 'Cancelled.' })
      } else {
        t.status = 'failed'
        t.error = msg
      }
    } finally {
      t.endedAt = Date.now()
      this.save()
      this.deps.onFinish?.({ ...t })
    }
  }

  private runCli(t: AgentTask, req: StartTaskRequest, cwd: string, push: (e: TaskEvent) => void, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      void spawnEnv().then((env) => {
        if (signal.aborted) return reject(new Error('__cancelled__'))
        const cmd = buildCommand(req, cwd, this.bins())
        // detached: its own process group, so cancel can stop the agent AND anything it started.
        const child = spawn(cmd.file, cmd.args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
        let buf = ''
        let err = ''
        let final: { text: string; isError: boolean; costUsd?: number } | undefined
        let settled = false
        const finish = (fn: () => void): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          fn()
        }
        const kill = (): void => {
          try {
            process.kill(-child.pid!, 'SIGKILL')
          } catch {
            child.kill('SIGKILL')
          }
        }
        const onAbort = (): void => {
          kill()
          finish(() => reject(new Error('__cancelled__')))
        }
        const timer = setTimeout(() => {
          kill()
          finish(() => reject(new Error('The task took too long and was stopped.')))
        }, this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        signal.addEventListener('abort', onAbort, { once: true })

        const feed = (line: string): void => {
          const p = parseStreamLine(line)
          p.events.forEach(push)
          if (p.final) {
            final = p.final
            t.costUsd = p.final.costUsd ?? t.costUsd
          }
        }
        child.stdout.on('data', (d) => {
          buf += d
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            feed(buf.slice(0, nl))
            buf = buf.slice(nl + 1)
          }
        })
        child.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
        child.stdin.on('error', () => undefined)
        child.on('error', (e: NodeJS.ErrnoException) => finish(() => reject(new Error(e.code === 'ENOENT' ? `${cmd.file} was not found on your PATH.` : e.message))))
        child.on('close', (code) =>
          finish(() => {
            if (buf.trim()) feed(buf)
            if (final) t.result = final.text
            if (final?.isError) return reject(new Error(AUTH.test(final.text) ? 'Claude is not signed in. Run `claude auth login` in a terminal, then try again.' : final.text.slice(0, 300) || 'The agent reported an error.'))
            if (code !== 0 && !final) return reject(new Error(redactTokens((err.trim() || `The agent exited with code ${code}.`).slice(0, 300))))
            resolve()
          })
        )
        child.stdin.end(cmd.stdin ?? '')
      })
    })
  }
}
