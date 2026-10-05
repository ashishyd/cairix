import { open, stat, truncate } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { HistoryHookStatus, HistorySnapshot } from '@shared/types'
import { hasBlock, installHook, parseHookLog, rcBlock, readRc, removeHook, type HookPaths } from './hook'
import { parseHistory, unmetafy, type HistoryFormat } from './parse'
import { HistoryStore } from './store'

const POLL_MS = 4000
/** Largest slice read in one go. A first import of a huge file simply takes a few rounds. */
const MAX_READ = 8 * 1024 * 1024
/** The hook's log is trimmed once it is this big and fully read, so command text does not pile up. */
const HOOK_LOG_MAX = 512 * 1024
/** On first import, only the newest part of a very large file is counted. */
const FIRST_IMPORT_TAIL = 16 * 1024 * 1024

export interface HistorySource {
  path: string
  format: HistoryFormat | 'hook'
}

export function defaultSources(home: string, env: NodeJS.ProcessEnv = process.env): HistorySource[] {
  return [
    { path: env.HISTFILE || join(env.ZDOTDIR || home, '.zsh_history'), format: 'zsh' },
    { path: join(home, '.bash_history'), format: 'bash' },
    { path: join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'fish', 'fish_history'), format: 'fish' }
  ]
}

export interface HistoryServiceDeps {
  dataDir: string
  home?: string
  /** Environment used to find history files and .zshrc (HISTFILE, ZDOTDIR...). Tests pass `{}` so a real shell setup cannot leak in. */
  env?: NodeJS.ProcessEnv
  /** Where the optional hook lives. Defaults to a `shell` folder inside `dataDir`. */
  hookDir?: string
  sources?: HistorySource[]
  /** False when the user switched the History module off: nothing is read or stored. */
  isEnabled(): boolean
  onChange(snapshot: HistorySnapshot): void
  now?: () => number
}

/**
 * Learns what you run in *any* terminal by reading the shell's own history
 * file: no shell hooks to install and nothing to configure. It remembers how
 * far it has read, so each command is counted once.
 *
 * zsh on macOS appends to the file as each command finishes (SHARE_HISTORY);
 * shells set up to write only on exit show up when the terminal tab closes.
 */
export class HistoryService {
  readonly store: HistoryStore
  private readonly sources: HistorySource[]
  private readonly hook: HookPaths
  private hookLogSeen = false
  private found = new Map<string, boolean>()
  private timer?: NodeJS.Timeout
  private busy = false

  constructor(private readonly deps: HistoryServiceDeps) {
    this.store = new HistoryStore(deps.dataDir)
    const home = deps.home ?? homedir()
    const hookDir = deps.hookDir ?? join(deps.dataDir, 'shell')
    const env = deps.env ?? process.env
    this.hook = { rcFile: join(env.ZDOTDIR || home, '.zshrc'), hookPath: join(hookDir, 'cairix-hook.zsh'), logPath: join(hookDir, 'commands.log') }
    this.sources = [...(deps.sources ?? defaultSources(home, env)), { path: this.hook.logPath, format: 'hook' as const }]
  }

  start(): void {
    const tick = (): void => {
      void this.poll().finally(() => {
        this.timer = setTimeout(tick, POLL_MS)
        this.timer.unref()
      })
    }
    tick()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.store.save()
  }

  snapshot(): HistorySnapshot {
    return {
      entries: this.store.entries(),
      rules: this.store.getRules(),
      sources: this.sources.filter((s) => s.format !== 'hook').map((s) => ({ path: s.path, found: this.found.get(s.path) ?? false })),
      tracking: this.deps.isEnabled(),
      hook: this.hookStatus()
    }
  }

  hookStatus(): HistoryHookStatus {
    return {
      installed: hasBlock(readRc(this.hook.rcFile)),
      recording: this.hookLogSeen || this.store.hasFolderData(),
      rcFile: this.hook.rcFile,
      snippet: rcBlock(this.hook.hookPath)
    }
  }

  installHook(): HistorySnapshot {
    installHook(this.hook)
    return this.persist()
  }

  removeHook(): HistorySnapshot {
    removeHook(this.hook)
    return this.persist()
  }

  ignore(rule: { kind: 'command' | 'program'; value: string }): HistorySnapshot {
    this.store.addRule(rule)
    return this.persist()
  }

  unignore(rule: { kind: 'command' | 'program'; value: string }): HistorySnapshot {
    this.store.removeRule(rule)
    return this.persist()
  }

  /** Reads whatever was appended since last time. Safe to call concurrently. */
  async poll(): Promise<void> {
    if (this.busy || !this.deps.isEnabled()) return
    this.busy = true
    try {
      let changed = false
      for (const src of this.sources) changed = (await this.readSource(src)) || changed
      if (changed) this.persist()
      else this.store.save() // read offsets still need saving
    } finally {
      this.busy = false
    }
  }

  private persist(): HistorySnapshot {
    this.store.save()
    const snap = this.snapshot()
    this.deps.onChange(snap)
    return snap
  }

  private async readSource(src: HistorySource): Promise<boolean> {
    let st
    try {
      st = await stat(src.path)
    } catch {
      this.found.set(src.path, false)
      return false
    }
    this.found.set(src.path, true)
    if (src.format === 'hook' && st.size > 0) this.hookLogSeen = true
    const prev = this.store.getSource(src.path)
    const firstTail = prev ? 0 : Math.max(0, st.size - FIRST_IMPORT_TAIL)
    const offset = prev?.offset ?? firstTail
    // A new inode or a shorter file means the shell rewrote it (compaction on exit).
    // Its old lines were already counted as they were appended, so skip to the end
    // rather than counting them all again.
    if (prev && (prev.ino !== st.ino || st.size < prev.offset)) {
      this.store.setSource(src.path, { offset: st.size, ino: st.ino })
      return true
    }
    if (st.size <= offset) {
      this.store.setSource(src.path, { offset, ino: st.ino })
      return false
    }

    const length = Math.min(st.size - offset, MAX_READ)
    const buf = Buffer.alloc(length)
    const fh = await open(src.path, 'r')
    try {
      await fh.read(buf, 0, length, offset)
    } finally {
      await fh.close()
    }
    // Only whole lines: the shell may be mid-write, so stop at the last newline.
    // A first import that starts mid-file also drops the partial line it landed in.
    const end = buf.lastIndexOf(0x0a)
    if (end < 0) return false
    const start = !prev && firstTail > 0 ? buf.indexOf(0x0a) + 1 : 0
    const body = buf.subarray(start, end)
    const next = offset + end + 1
    if (src.format === 'hook') {
      this.hookLogSeen = true
      const n = this.store.ingestFolders(parseHookLog(body.toString('utf8')))
      // Fully read and big: start the log over so command text is not kept around.
      if (next >= st.size && st.size > HOOK_LOG_MAX) {
        await truncate(src.path, 0).catch(() => undefined)
        this.store.setSource(src.path, { offset: 0, ino: st.ino })
      } else this.store.setSource(src.path, { offset: next, ino: st.ino })
      return n > 0
    }
    const text = src.format === 'zsh' ? unmetafy(body) : body.toString('utf8')
    const recorded = this.store.ingest(parseHistory(text, src.format), (this.deps.now ?? Date.now)())
    this.store.setSource(src.path, { offset: next, ino: st.ino })
    return recorded > 0
  }
}
