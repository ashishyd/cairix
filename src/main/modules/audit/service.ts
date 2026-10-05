import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import { AUDIT_CATEGORIES, type AgentCli, type AuditOptions, type AuditPlan, type AuditState, type Finding } from '@shared/types'
import { readJson, writeJsonAtomic } from '../../json-store'
import { CliError, parseReview, reviewArgs, runClaude, type RunClaudeOptions } from '../changes/ai'
import { runChecks } from '../changes/checks'
import { wholeFileAsAdded } from '../changes/diff'
import { TOPIC_IDS } from '../changes/learn'
import { buildAuditPrompt, estimate, listProjectFiles, makeShards, readShard, selectFiles } from './files'

export interface AuditDeps {
  project(id: string): { path: string; trusted: boolean } | undefined
  dataDir: string
  detectClaude(): Promise<AgentCli>
  isDismissed(projectId: string, findingId: string): boolean
  run?: (o: RunClaudeOptions) => ReturnType<typeof runClaude>
  concurrency?: number
  /** Called once an audit has reached a final state. */
  onFinish?(state: AuditState): void
}

interface Job {
  state: AuditState
  abort: AbortController
  /** All findings before dismissals are applied. */
  all: Finding[]
}

const saved = z.object({ at: z.number(), ids: z.array(z.string()) })
const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12)

const optsSchema = z.object({ categories: z.array(z.enum(AUDIT_CATEGORIES)).min(1) })

export class AuditService {
  private jobs = new Map<string, Job>()
  constructor(private readonly deps: AuditDeps) {}

  private project(id: string): { path: string; trusted: boolean } {
    const p = this.deps.project(id)
    if (!p) throw new Error('That project is no longer in Cairix.')
    return p
  }

  async plan(projectId: string, opts: AuditOptions): Promise<AuditPlan> {
    const { path } = this.project(projectId)
    optsSchema.parse(opts)
    const { isRepo, files } = await listProjectFiles(path)
    const { chosen, total } = selectFiles(files)
    const shards = makeShards(chosen)
    const est = estimate(chosen, shards)
    return {
      isRepo,
      totalFiles: total,
      files: chosen.length,
      bytes: est.bytes,
      tokensEstimate: est.tokens,
      requests: shards.length,
      maxCostUsd: est.maxCostUsd,
      aiAvailable: (await this.deps.detectClaude()).installed
    }
  }

  status(projectId: string): AuditState {
    this.project(projectId)
    const job = this.jobs.get(projectId)
    if (!job) return idle(projectId)
    return this.view(job)
  }

  private view(job: Job): AuditState {
    const visible = job.all.filter((f) => !this.deps.isDismissed(job.state.projectId, f.id)).sort(order)
    return { ...job.state, findings: visible, dismissedCount: job.all.length - visible.length }
  }

  cancel(projectId: string): AuditState {
    const job = this.jobs.get(projectId)
    if (job?.state.phase === 'running') job.abort.abort()
    return this.status(projectId)
  }

  /** Starts an audit and returns immediately; poll `status` for progress. */
  async start(projectId: string, opts: AuditOptions): Promise<AuditState> {
    const project = this.project(projectId)
    if (!project.trusted) throw new Error('Trust this folder before auditing it.')
    optsSchema.parse(opts)
    if (this.jobs.get(projectId)?.state.phase === 'running') return this.status(projectId)

    const { files, top } = await listProjectFiles(project.path)
    const { chosen } = selectFiles(files)
    if (chosen.length === 0) throw new Error('No source files to audit in this project.')
    const shards = makeShards(chosen)

    const job: Job = {
      abort: new AbortController(),
      all: [],
      state: { ...idle(projectId), phase: 'running', startedAt: Date.now(), progress: { done: 0, total: shards.length }, filesAnalyzed: chosen.length }
    }
    this.jobs.set(projectId, job)
    void this.execute(job, top, shards, opts)
    return this.view(job)
  }

  private async execute(job: Job, top: string, shards: Array<Array<{ path: string; size: number }>>, opts: AuditOptions): Promise<void> {
    const { state } = job
    try {
      // 1. Free instant checks over whole files.
      const instant: Finding[] = []
      for (const shard of shards) {
        for (const f of await readShard(top, shard)) instant.push(...runChecks([wholeFileAsAdded(f.path, f.content)]))
      }
      // Debug leftovers are noise across a whole codebase; the Changes tab is where they matter.
      job.all = instant.filter((f) => !(f.severity === 'info' && f.category === 'cleanup'))
      state.instantCount = job.all.length

      // 2. AI requests, a couple at a time.
      const run = this.deps.run ?? runClaude
      let next = 0
      let firstError: string | undefined
      const worker = async (): Promise<void> => {
        while (!job.abort.signal.aborted) {
          const i = next++
          if (i >= shards.length) return
          try {
            const read = await readShard(top, shards[i])
            const result = await run({
              prompt: buildAuditPrompt(read, opts.categories, TOPIC_IDS),
              args: reviewArgs(),
              timeoutMs: 150_000,
              signal: job.abort.signal
            })
            const paths = new Set(read.map((f) => f.path))
            const found = parseReview(result, paths, (file, title) => hash(`${file}|audit|${title}`))
            const have = new Set(job.all.map((f) => `${f.file}:${f.line}`))
            job.all.push(...found.filter((f) => !(f.line && have.has(`${f.file}:${f.line}`))))
            state.costUsd = Math.round((state.costUsd + (result.costUsd ?? 0)) * 10000) / 10000
          } catch (e) {
            if (e instanceof CliError && e.kind === 'cancelled') return
            state.failedRequests++
            firstError ??= e instanceof Error ? e.message : String(e)
          } finally {
            state.progress.done++
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(this.deps.concurrency ?? 2, shards.length) }, worker))

      if (job.abort.signal.aborted) state.phase = 'cancelled'
      else if (state.failedRequests >= shards.length) {
        state.phase = 'error'
        state.error = firstError
      } else {
        state.phase = 'done'
        if (state.failedRequests > 0) state.error = `${state.failedRequests} of ${shards.length} requests failed (${firstError}). Results are partial.`
        state.compared = this.compare(state.projectId, job.all)
      }
    } catch (e) {
      state.phase = 'error'
      state.error = e instanceof Error ? e.message : String(e)
    } finally {
      state.finishedAt = Date.now()
      this.deps.onFinish?.({ ...state })
    }
  }

  /** Diffs against the last completed audit and stores this one for next time. */
  private compare(projectId: string, findings: Finding[]): AuditState['compared'] {
    const file = join(this.deps.dataDir, 'audits', `${projectId}.json`)
    const prev = readJson(file, saved.nullable(), () => null)
    const ids = new Set(findings.map((f) => f.id))
    writeJsonAtomic(file, { at: Date.now(), ids: [...ids] })
    if (!prev) return undefined
    const before = new Set(prev.ids)
    return { newCount: [...ids].filter((i) => !before.has(i)).length, fixedCount: [...before].filter((i) => !ids.has(i)).length, at: prev.at }
  }

  /** Finding lookup for the fix flow. */
  find(projectId: string, findingId: string): Finding | undefined {
    return this.jobs.get(projectId)?.all.find((f) => f.id === findingId)
  }

  /** Reads one line of a file as it is now, to build an exact instant-fix patch. */
  async lineText(top: string, file: string, line: number): Promise<string | undefined> {
    try {
      return (await readFile(join(top, file), 'utf8')).split('\n')[line - 1]
    } catch {
      return undefined
    }
  }
}

function idle(projectId: string): AuditState {
  return { projectId, phase: 'idle', progress: { done: 0, total: 0 }, findings: [], instantCount: 0, costUsd: 0, failedRequests: 0, filesAnalyzed: 0, dismissedCount: 0 }
}
const rank = (s: string): number => (s === 'error' ? 0 : s === 'warning' ? 1 : 2)
const order = (a: Finding, b: Finding): number => rank(a.severity) - rank(b.severity) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)
