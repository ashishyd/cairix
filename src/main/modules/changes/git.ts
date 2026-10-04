import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { open, stat } from 'fs/promises'
import { join } from 'path'
import { spawnEnv } from '../../shell-env'
import { parseDiff, wholeFileAsAdded, type DiffFile } from './diff'

/** Git's well-known empty tree, so a repo with no commits yet can still be diffed. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MAX_UNTRACKED = 200_000
const MAX_DIFF = 600_000

export function git(cwd: string, args: string[], opts: { input?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    void spawnEnv({ GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }).then((env) => {
      const child = execFile('git', args, { cwd, env, timeout: opts.timeout ?? 20_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim().split('\n')[0] || err.message))
        else resolve(stdout)
      })
      if (opts.input !== undefined) child.stdin?.end(opts.input)
    })
  })
}

export interface StatusEntry {
  path: string
  status: string
  staged: boolean
}

/** Parses `git status --porcelain=v2 --branch -z`. */
export function parseStatus(out: string): { branch?: string; entries: StatusEntry[] } {
  const parts = out.split('\0')
  let branch: string | undefined
  const entries: StatusEntry[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) continue
    if (p.startsWith('# branch.head ')) branch = p.slice(14)
    else if (p.startsWith('1 ')) {
      const f = p.split(' ')
      const xy = f[1]
      entries.push({ path: f.slice(8).join(' '), status: xy[0] !== '.' ? xy[0] : xy[1], staged: xy[0] !== '.' })
    } else if (p.startsWith('2 ')) {
      const f = p.split(' ')
      entries.push({ path: f.slice(9).join(' '), status: 'R', staged: f[1][0] !== '.' })
      i++ // the original path follows as its own NUL-separated field
    } else if (p.startsWith('? ')) entries.push({ path: p.slice(2), status: '?', staged: false })
  }
  return { branch, entries }
}

export interface RepoChanges {
  isRepo: boolean
  /** Repository top-level folder. Paths in `entries`/`files` are relative to it. */
  top: string
  branch?: string
  entries: StatusEntry[]
  files: DiffFile[]
  /** Unified diff text of tracked changes (what the AI sees, before redaction). */
  diff: string
  fingerprint: string
}

export async function readChanges(root: string): Promise<RepoChanges> {
  const empty: RepoChanges = { isRepo: false, top: root, entries: [], files: [], diff: '', fingerprint: 'none' }
  try {
    if ((await git(root, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return empty
  } catch {
    return empty
  }
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim()
  // Limit to this project's folder (`-- .`): in a monorepo the Changes tab for apps/web shouldn't list apps/api.
  const status = parseStatus(await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--', '.']))
  const base = await git(root, ['rev-parse', '--verify', '-q', 'HEAD']).then((s) => s.trim(), () => EMPTY_TREE)
  let diff = ''
  try {
    diff = (await git(root, ['diff', base, '--no-color', '--no-ext-diff', '--no-renames', '-U3', '--', '.'])).slice(0, MAX_DIFF)
  } catch {
    /* unreadable diff: report no tracked changes rather than failing the panel */
  }
  const files = parseDiff(diff)
  const stamp: string[] = []
  for (const e of status.entries.filter((x) => x.status === '?')) {
    try {
      const full = join(top, e.path)
      const st = await stat(full)
      stamp.push(`${e.path}:${st.size}:${Math.round(st.mtimeMs)}`)
      if (st.size <= MAX_UNTRACKED) {
        const fh = await open(full, 'r')
        try {
          const buf = Buffer.alloc(st.size)
          await fh.read(buf, 0, st.size, 0)
          if (!buf.includes(0)) files.push(wholeFileAsAdded(e.path, buf.toString('utf8')))
        } finally {
          await fh.close()
        }
      }
    } catch {
      /* vanished between status and read */
    }
  }
  const fingerprint = createHash('sha1').update(diff).update(stamp.join('\n')).digest('hex').slice(0, 16)
  return { isRepo: true, top, branch: status.branch, entries: status.entries, files, diff, fingerprint }
}
