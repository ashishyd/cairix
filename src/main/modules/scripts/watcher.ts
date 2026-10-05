import { watch as fsWatch } from 'fs'
import type { RunInfo } from '@shared/types'

/** Folders that change constantly and never mean "my code changed". */
const IGNORED_SEGMENTS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.cache', 'coverage', '__pycache__', '.venv', 'venv',
  'target', '.svelte-kit', '.parcel-cache', '.pytest_cache', '.mypy_cache', '.idea', '.vscode', '.expo', '.gradle'
])
const IGNORED_FILE = /(\.log|\.tmp|\.swp|\.swx|\.pyc|~)$|^(\.DS_Store|\.#.*|#.*#)$/

/** A path (relative to the project) whose change should not restart anything. */
export function isIgnoredPath(rel: string): boolean {
  const parts = rel.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return true
  return parts.slice(0, -1).some((s) => IGNORED_SEGMENTS.has(s)) || IGNORED_SEGMENTS.has(parts.at(-1)!) || IGNORED_FILE.test(parts.at(-1)!)
}

export const DEBOUNCE_MS = 500
/** Changes right after a start are the script's own startup noise (generated files, caches). */
export const GRACE_MS = 1500
/** More than this many restarts inside the window means the script keeps changing what it watches. */
export const MAX_RESTARTS = 5
export const LOOP_WINDOW_MS = 30_000

export interface WatchHandle {
  close(): void
}

export interface RunWatcherDeps {
  /** The folder to watch for this run, or undefined when it has none (Commands, Actions). */
  folderOf(info: RunInfo): string | undefined
  /** Is "restart on file change" on for this script? */
  enabled(scriptId: string): boolean
  watch(dir: string, onChange: (relPath: string) => void): WatchHandle
  /** Stops the run and starts it again. */
  restart(info: RunInfo): Promise<void>
  /** Restarting too often: watching was stopped for this run. */
  onLoop(info: RunInfo): void
  now?(): number
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(t: unknown): void
}

interface Active {
  info: RunInfo
  handle: WatchHandle
  startedAt: number
  timer?: unknown
}

/** Watches the folder of each running script that opted in, and restarts it (debounced) when its code changes. */
export class RunWatcher {
  private active = new Map<string, Active>()
  /** scriptId -> recent restart times, kept across the runs a restart creates. */
  private restarts = new Map<string, number[]>()

  constructor(private readonly deps: RunWatcherDeps) {}

  onRunStarted(info: RunInfo): void {
    if (this.active.has(info.runId) || !this.deps.enabled(info.scriptId)) return
    const dir = this.deps.folderOf(info)
    if (!dir) return
    const entry: Active = { info, startedAt: this.now(), handle: { close: () => undefined } }
    try {
      entry.handle = this.deps.watch(dir, (rel) => this.changed(entry, rel))
    } catch {
      return // not watchable (folder gone, too many open files): the script still runs
    }
    this.active.set(info.runId, entry)
  }

  onRunEnded(info: RunInfo): void {
    const a = this.active.get(info.runId)
    if (!a) return
    this.close(a)
  }

  isWatching(runId: string): boolean {
    return this.active.has(runId)
  }

  dispose(): void {
    for (const a of [...this.active.values()]) this.close(a)
  }

  private changed(a: Active, rel: string): void {
    if (isIgnoredPath(rel) || this.now() - a.startedAt < GRACE_MS || !this.deps.enabled(a.info.scriptId)) return
    if (a.timer !== undefined) (this.deps.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout)))(a.timer)
    a.timer = (this.deps.setTimer ?? ((f, ms) => setTimeout(f, ms)))(() => {
      a.timer = undefined
      if (!this.active.has(a.info.runId) || !this.deps.enabled(a.info.scriptId)) return
      const now = this.now()
      const recent = (this.restarts.get(a.info.scriptId) ?? []).filter((t) => now - t < LOOP_WINDOW_MS)
      if (recent.length >= MAX_RESTARTS) {
        this.restarts.delete(a.info.scriptId)
        this.close(a)
        this.deps.onLoop(a.info)
        return
      }
      this.restarts.set(a.info.scriptId, [...recent, now])
      this.close(a) // the new run gets its own watcher when it starts
      void this.deps.restart(a.info).catch(() => undefined)
    }, DEBOUNCE_MS)
  }

  private close(a: Active): void {
    if (a.timer !== undefined) (this.deps.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout)))(a.timer)
    a.timer = undefined
    try {
      a.handle.close()
    } catch {
      /* already closed */
    }
    this.active.delete(a.info.runId)
  }
  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}

/** Real recursive watch (macOS FSEvents). Events outside the folder's tree never arrive. */
export function watchFolder(dir: string, onChange: (relPath: string) => void): WatchHandle {
  const w = fsWatch(dir, { recursive: true }, (_event, filename) => onChange(filename ? String(filename) : ''))
  w.on('error', () => w.close())
  return { close: () => w.close() }
}
