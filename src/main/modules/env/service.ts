import { lstat, readdir, readFile, realpath, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { hasTokenShape, redactTokens } from '@shared/redact'
import type { EnvDrift, EnvFileInfo, EnvSnapshot, EnvVarInfo } from '@shared/types'
import { ENV_FILE, isTemplateName, parseEnv, parseWorktrees, removeVar, serializeEnv, setVar, SENSITIVE_KEY, varsOf, KEY_RE } from './parse'

const MAX_FILE = 256 * 1024
const MAX_VALUE = 8 * 1024
const TEMPLATE_ORDER = ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.defaults']

export interface EnvDeps {
  project(id: string): { path: string; trusted: boolean; name: string; hasGit: boolean } | undefined
  /** Runs git in the project. Rejects on a non-zero exit. */
  git(cwd: string, args: string[]): Promise<string>
}

/** A value is safe to show without a click when it is short, not secret-looking and carries no credentials. */
export function previewOf(key: string, value: string): string | undefined {
  if (value === '' || SENSITIVE_KEY.test(key) || value.length > 80 || value.includes('\n')) return undefined
  if (hasTokenShape(value) || redactTokens(value) !== value) return undefined
  return value
}

/** Key names (never values) from the non-template `.env*` files of a folder. Symlinks and huge files are skipped. */
export async function envKeysOf(dir: string): Promise<string[]> {
  const keys = new Set<string>()
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => ENV_FILE.test(n) && !isTemplateName(n))
  for (const n of names) {
    const st = await lstat(join(dir, n)).catch(() => null)
    if (!st?.isFile() || st.size > MAX_FILE) continue
    for (const v of varsOf(parseEnv(await readFile(join(dir, n), 'utf8').catch(() => '')))) keys.add(v.key)
  }
  return [...keys].sort()
}

const MAX_DRIFT_KEYS = 30

/**
 * Reads and edits a project's `.env*` files. The renderer only ever names a
 * project and a file *name*; the path is built here, the name must look like an
 * env file, symlinks are refused, and nothing happens in a folder you have not
 * trusted. Values leave this module only when asked for one at a time.
 */
export class EnvService {
  constructor(private readonly deps: EnvDeps) {}

  async list(projectId: string): Promise<EnvSnapshot> {
    const p = this.project(projectId)
    const names = (await readdir(p.path).catch(() => [] as string[])).filter((n) => ENV_FILE.test(n)).sort()
    const parsed = new Map<string, ReturnType<typeof parseEnv>>()
    for (const n of names) {
      const text = await this.read(p.path, n)
      if (text !== null) parsed.set(n, parseEnv(text))
    }
    const templateName = TEMPLATE_ORDER.find((t) => parsed.has(t)) ?? [...parsed.keys()].find(isTemplateName)
    const templateKeys = templateName ? new Set(varsOf(parsed.get(templateName)!).map((v) => v.key)) : null

    const files: EnvFileInfo[] = []
    for (const [name, entries] of parsed) {
      const template = isTemplateName(name)
      const vars: EnvVarInfo[] = varsOf(entries).map(({ key, value }) => ({
        key,
        empty: value === '',
        length: value.length,
        sensitive: SENSITIVE_KEY.test(key) || hasTokenShape(value),
        preview: template ? undefined : previewOf(key, value)
      }))
      const have = new Map(vars.map((v) => [v.key, v]))
      const compare = !template && templateKeys !== null
      files.push({
        name,
        kind: template ? 'template' : 'local',
        vars,
        gitignored: p.hasGit && !template ? await this.git(p.path, ['check-ignore', '-q', '--', name]) : null,
        tracked: p.hasGit && !template ? await this.git(p.path, ['ls-files', '--error-unmatch', '--', name]) : false,
        missing: compare ? [...templateKeys!].filter((k) => !have.has(k) || have.get(k)!.empty) : [],
        extra: compare ? vars.map((v) => v.key).filter((k) => !templateKeys!.has(k)) : [],
        template: compare ? templateName : undefined
      })
    }
    // Templates last: the files you actually use come first.
    files.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'local' ? -1 : 1))
    return { files, hasGit: p.hasGit }
  }

  /**
   * Other git worktrees of this repo whose env files have different key names.
   * Names only. The worktree paths come from git, never from the renderer.
   */
  async drift(projectId: string): Promise<EnvDrift> {
    const p = this.project(projectId)
    if (!p.hasGit) return { worktrees: [] }
    const listing = await this.deps.git(p.path, ['worktree', 'list', '--porcelain']).catch(() => '')
    const self = await realpath(p.path).catch(() => p.path)
    const mine = await envKeysOf(p.path)
    const worktrees: EnvDrift['worktrees'] = []
    for (const w of parseWorktrees(listing)) {
      const real = w.bare ? null : await realpath(w.path).catch(() => null)
      if (!real || real === self) continue
      const theirs = await envKeysOf(real)
      if (theirs.length === 0) continue // a fresh checkout with no env files says nothing
      const missingHere = theirs.filter((k) => !mine.includes(k)).slice(0, MAX_DRIFT_KEYS)
      const extraHere = mine.filter((k) => !theirs.includes(k)).slice(0, MAX_DRIFT_KEYS)
      if (missingHere.length || extraHere.length) worktrees.push({ path: real, branch: w.branch, missingHere, extraHere })
    }
    return { worktrees }
  }

  async reveal(projectId: string, file: string, key: string): Promise<string> {
    const p = this.project(projectId)
    const text = await this.mustRead(p.path, file)
    const hit = varsOf(parseEnv(text)).find((v) => v.key === key)
    if (!hit) throw new Error(`${key} is not in ${file}.`)
    return hit.value
  }

  async set(projectId: string, file: string, key: string, value: string): Promise<EnvSnapshot> {
    const p = this.project(projectId)
    if (value.length > MAX_VALUE) throw new Error('That value is too long.')
    const text = await this.mustRead(p.path, file)
    await this.write(p.path, file, serializeEnv(setVar(parseEnv(text), key, value)))
    return this.list(projectId)
  }

  async remove(projectId: string, file: string, key: string): Promise<EnvSnapshot> {
    const p = this.project(projectId)
    const text = await this.mustRead(p.path, file)
    await this.write(p.path, file, serializeEnv(removeVar(parseEnv(text), key)))
    return this.list(projectId)
  }

  /** `.env` from `.env.example`: same keys and placeholder values, as a starting point. */
  async create(projectId: string, file: string, template: string): Promise<EnvSnapshot> {
    const p = this.project(projectId)
    if (!ENV_FILE.test(file) || isTemplateName(file)) throw new Error('Choose a name like .env or .env.local.')
    if (!isTemplateName(template)) throw new Error('That is not a template file.')
    if ((await this.read(p.path, file)) !== null) throw new Error(`${file} already exists.`)
    const text = await this.mustRead(p.path, template)
    await this.write(p.path, file, text, 0o600)
    return this.list(projectId)
  }

  /** Adds the template's keys that this file does not have at all, empty, so nothing already set is touched. */
  async addMissing(projectId: string, file: string): Promise<EnvSnapshot> {
    const p = this.project(projectId)
    if (isTemplateName(file)) throw new Error('Pick a local file, not a template.')
    const snap = await this.list(projectId)
    const info = snap.files.find((f) => f.name === file)
    if (!info?.template) throw new Error('There is no template to compare with.')
    const have = new Set(info.vars.map((v) => v.key))
    const templateText = await this.mustRead(p.path, info.template)
    let entries = parseEnv(await this.mustRead(p.path, file))
    for (const { key } of varsOf(parseEnv(templateText))) if (!have.has(key) && KEY_RE.test(key)) entries = setVar(entries, key, '')
    await this.write(p.path, file, serializeEnv(entries))
    return this.list(projectId)
  }

  // ───────────────────────── internals ─────────────────────────

  private project(id: string): { path: string; hasGit: boolean } {
    const p = this.deps.project(id)
    if (!p) throw new Error('That project is no longer in Cairix.')
    if (!p.trusted) throw new Error(`Trust "${p.name}" to manage its environment files.`)
    return p
  }

  private async git(cwd: string, args: string[]): Promise<boolean> {
    try {
      await this.deps.git(cwd, args)
      return true
    } catch {
      return false
    }
  }

  /** The file's text, or null if it is missing, too big, or not a plain file (symlinks are refused). */
  private async read(dir: string, name: string): Promise<string | null> {
    if (!ENV_FILE.test(name)) throw new Error('That is not an environment file.')
    const path = join(dir, name)
    const st = await lstat(path).catch(() => null)
    if (!st || !st.isFile() || st.size > MAX_FILE) return null
    return readFile(path, 'utf8')
  }

  private async mustRead(dir: string, name: string): Promise<string> {
    const text = await this.read(dir, name)
    if (text === null) throw new Error(`${name} could not be read.`)
    return text
  }

  private async write(dir: string, name: string, text: string, mode?: number): Promise<void> {
    const path = join(dir, name)
    const st = await lstat(path).catch(() => null)
    if (st && !st.isFile()) throw new Error(`${name} is not a plain file.`)
    const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
    await writeFile(tmp, text, { mode: st ? st.mode & 0o777 : mode ?? 0o600 })
    await rename(tmp, path)
  }
}
