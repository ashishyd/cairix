import { randomUUID } from 'crypto'
import { stat } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod'
import type { FlightEvent, FlightSince } from '@shared/types'
import { readJson, writeJsonAtomic } from '../../json-store'
import { envKeysOf } from '../env/service'

export interface FlightDeps {
  file: string
  projects(): Array<{ id: string; name: string; path: string; trusted: boolean; hasGit: boolean }>
  /** Runs git in a folder. Rejects on a non-zero exit. */
  git(cwd: string, args: string[]): Promise<string>
  failedRuns(): Array<{ runId: string; projectId: string; projectName: string; scriptName: string; endedAt: number; exitCode?: number | null }>
  /** When this script last finished well before `before`, or null. */
  lastPassAt(projectId: string, scriptName: string, before: number): number | null
  now?(): number
}

const PER_PROJECT = 200
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'uv.lock', 'poetry.lock', 'Cargo.lock', 'go.sum']

const sample = z.object({ branch: z.string(), head: z.string(), lock: z.string(), envKeys: z.array(z.string()) })
const event = z.object({
  id: z.string(),
  at: z.number(),
  projectId: z.string(),
  projectName: z.string(),
  kind: z.enum(['branch', 'commit', 'deps', 'env', 'crash']),
  title: z.string(),
  detail: z.string().optional()
})
const stored = z.object({ samples: z.record(z.string(), sample), events: z.array(event), runsSeenAt: z.number() })
type Sample = z.infer<typeof sample>
type Stored = z.infer<typeof stored>

/** What changed between two samples of one project. Pure, so it is tested without a disk. */
export function diffSamples(prev: Sample, next: Sample): Array<Pick<FlightEvent, 'kind' | 'title' | 'detail'>> {
  const out: Array<Pick<FlightEvent, 'kind' | 'title' | 'detail'>> = []
  if (prev.branch !== next.branch) out.push({ kind: 'branch', title: `Switched branch: ${prev.branch || '?'} → ${next.branch || '?'}` })
  else if (prev.head !== next.head) out.push({ kind: 'commit', title: `New commit on ${next.branch || 'HEAD'}`, detail: next.head.slice(0, 7) })
  if (prev.lock !== next.lock) out.push({ kind: 'deps', title: 'Dependencies changed', detail: next.lock.split(':')[0] || 'lockfile removed' })
  const added = next.envKeys.filter((k) => !prev.envKeys.includes(k))
  const removed = prev.envKeys.filter((k) => !next.envKeys.includes(k))
  if (added.length || removed.length) {
    out.push({ kind: 'env', title: 'Env keys changed', detail: [added.length && `added ${added.join(', ')}`, removed.length && `removed ${removed.join(', ')}`].filter(Boolean).join(' · ') })
  }
  return out
}

/**
 * Remembers what changed in each trusted project: branch switches, commits,
 * lockfile changes, env key names and failed runs. It samples on a timer and
 * logs only the differences, so "what changed since this last worked?" has an
 * answer. Env VALUES are never read into the log, only key names.
 */
export class FlightService {
  private timer?: ReturnType<typeof setInterval>
  private busy = false
  private data: Stored
  constructor(private readonly deps: FlightDeps) {
    this.data = readJson(deps.file, stored, () => ({ samples: {}, events: [], runsSeenAt: 0 }))
  }

  list(): FlightEvent[] {
    return [...this.data.events].sort((a, b) => b.at - a.at)
  }

  /** Changes in the failed run's project since its script last passed. Only failure events qualify. */
  sinceGood(eventId: string): FlightSince | null {
    const fail = this.data.events.find((e) => e.id === eventId && e.kind === 'crash')
    if (!fail) return null
    const scriptName = fail.title.replace(/ failed$/, '')
    const passedAt = this.deps.lastPassAt(fail.projectId, scriptName, fail.at)
    const events = this.list()
      .filter((e) => e.projectId === fail.projectId && e.kind !== 'crash' && e.at <= fail.at && (passedAt === null || e.at > passedAt))
      .reverse()
    return { passedAt, failedAt: fail.at, scriptName, events }
  }

  start(intervalMs = 30_000): void {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async tick(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const now = (this.deps.now ?? Date.now)()
      const fresh: FlightEvent[] = []
      // Reading a folder is something that only happens in projects you have trusted.
      for (const p of this.deps.projects().filter((x) => x.trusted)) {
        const next = await this.sampleOf(p)
        const prev = this.data.samples[p.id]
        this.data.samples[p.id] = next
        if (!prev) continue // first sight is the baseline, not a change
        for (const e of diffSamples(prev, next)) fresh.push({ id: randomUUID(), at: now, projectId: p.id, projectName: p.name, ...e })
      }
      for (const r of this.deps.failedRuns()) {
        if (r.endedAt <= this.data.runsSeenAt) continue
        fresh.push({
          id: `crash:${r.runId}`,
          at: r.endedAt,
          projectId: r.projectId,
          projectName: r.projectName,
          kind: 'crash',
          title: `${r.scriptName} failed`,
          detail: r.exitCode != null ? `exit code ${r.exitCode}` : undefined
        })
        this.data.runsSeenAt = Math.max(this.data.runsSeenAt, r.endedAt)
      }
      this.data.events = cap([...this.data.events, ...fresh])
      writeJsonAtomic(this.deps.file, this.data)
    } finally {
      this.busy = false
    }
  }

  private async sampleOf(p: { path: string; hasGit: boolean }): Promise<Sample> {
    const git = (args: string[]): Promise<string> => (p.hasGit ? this.deps.git(p.path, args).then((s) => s.trim()) : Promise.resolve('')).catch(() => '')
    const [branch, head] = await Promise.all([git(['rev-parse', '--abbrev-ref', 'HEAD']), git(['rev-parse', 'HEAD'])])
    return { branch, head, lock: await lockOf(p.path), envKeys: await envKeysOf(p.path) }
  }
}

// shortcut: size + mtime stand in for a content hash (cheap on big lockfiles); a touch without edits logs one false "changed".
async function lockOf(dir: string): Promise<string> {
  for (const name of LOCKFILES) {
    const s = await stat(join(dir, name)).catch(() => null)
    if (s?.isFile()) return `${name}:${s.size}:${Math.trunc(s.mtimeMs)}`
  }
  return ''
}

/** Newest PER_PROJECT events of each project survive, so one noisy project cannot push out the rest. */
function cap(events: FlightEvent[]): FlightEvent[] {
  const seen = new Map<string, number>()
  const keep: FlightEvent[] = []
  for (const e of [...events].sort((a, b) => b.at - a.at)) {
    const n = (seen.get(e.projectId) ?? 0) + 1
    seen.set(e.projectId, n)
    if (n <= PER_PROJECT) keep.push(e)
  }
  return keep
}
