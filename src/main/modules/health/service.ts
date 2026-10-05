import { execFile } from 'child_process'
import { lstat, readFile, realpath, rm } from 'fs/promises'
import { join } from 'path'
import type { DepsReport, DiskHog, HealthSnapshot, ToolCheck } from '@shared/types'
import { spawnEnv } from '../../shell-env'
import { buildReport } from './deps'
import { firstLine, parseVer, satisfies, toolVersion } from './versions'

type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/** Folders that can be deleted safely because a command rebuilds them. */
const HOGS: Array<{ name: string; regenerate: (m: Manager | undefined) => string; needs?: string }> = [
  { name: 'node_modules', regenerate: (m) => `${m ?? 'npm'} install` },
  { name: '.next', regenerate: () => 'next dev / next build' },
  { name: '.nuxt', regenerate: () => 'nuxt dev / nuxt build' },
  { name: '.turbo', regenerate: () => 'turbo run' },
  { name: '.svelte-kit', regenerate: () => 'vite dev / build' },
  { name: '.parcel-cache', regenerate: () => 'parcel' },
  { name: '.expo', regenerate: () => 'expo start' },
  { name: '.gradle', regenerate: () => 'gradle build' },
  { name: 'coverage', regenerate: () => 'your test command' },
  { name: 'dist', regenerate: () => 'your build command' },
  { name: 'build', regenerate: () => 'your build command' },
  { name: '.venv', regenerate: () => 'python -m venv .venv && pip install' },
  { name: 'venv', regenerate: () => 'python -m venv venv && pip install' },
  { name: '__pycache__', regenerate: () => 'python (automatic)' },
  { name: 'target', regenerate: () => 'cargo build', needs: 'Cargo.toml' },
  { name: 'Pods', regenerate: () => 'pod install', needs: 'Podfile' }
]
const CLEANABLE = new Set(HOGS.map((h) => h.name))

export interface HealthDeps {
  project(id: string): { path: string; trusted: boolean; name: string; hasGit: boolean } | undefined
  /** Version output of `bin --version` run in the project, or undefined if it is not installed. */
  version?(bin: string, args: string[], cwd: string): Promise<string | undefined>
  /** Disk use of a path in KiB. */
  size?(path: string): Promise<number>
  /** `git ls-files -- name` output (empty = not tracked). */
  git(cwd: string, args: string[]): Promise<string>
  /** Runs a command and returns stdout even when it exits non-zero (npm outdated does that on purpose). */
  runTolerant?(file: string, args: string[], cwd: string): Promise<string>
  /** Does this project have a running script? Cleaning is refused then. */
  isRunning(projectId: string): boolean
  /** Hide folders smaller than this (KiB). */
  minKb?: number
}

function defaultVersion(bin: string, args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    void spawnEnv().then((env) => execFile(bin, args, { cwd, env, timeout: 8000 }, (err, stdout, stderr) => resolve(err ? undefined : (stdout || stderr).trim())))
  })
}

function defaultSize(path: string): Promise<number> {
  return new Promise((resolve) => execFile('du', ['-sk', path], { timeout: 30_000 }, (err, stdout) => resolve(err ? 0 : Number.parseInt(stdout, 10) || 0)))
}

function defaultTolerant(file: string, args: string[], cwd: string): Promise<string> {
  // Test hook, like CAIRIX_CLAUDE_BIN: a stand-in so tests never reach the network. It gets the manager name first.
  const fake = process.env.CAIRIX_FAKE_PM
  if (fake) {
    file = fake
    args = [process.env.CAIRIX_FAKE_PM_NAME ?? 'npm', ...args]
  }
  return new Promise((resolve, reject) => {
    void spawnEnv({ CI: '1', NO_COLOR: '1' }).then((env) =>
      execFile(file, args, { cwd, env, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
        const e = err as NodeJS.ErrnoException | null
        if (e && (e.code === 'ENOENT' || !stdout)) reject(new Error(e.code === 'ENOENT' ? `${file} is not installed.` : e.message.split('\n')[0]))
        else resolve(stdout)
      })
    )
  })
}

async function read(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, () => false)
}

/**
 * Is this project set up the way it says it wants to be, and what is it costing?
 * Everything here is read-only except {@link clean}, which can only remove a
 * fixed list of regenerable folders at the top of a trusted project.
 */
export class HealthService {
  constructor(private readonly deps: HealthDeps) {}

  async scan(projectId: string): Promise<HealthSnapshot> {
    const p = this.project(projectId, false)
    const pkg = await this.pkg(p.path)
    const manager = await this.manager(p.path, pkg)
    const [tools, hogs] = await Promise.all([this.tools(p.path, pkg, manager), this.hogs(projectId, p.path, p.hasGit, manager)])
    return { tools, hogs, manager }
  }

  async report(projectId: string): Promise<DepsReport> {
    const p = this.project(projectId)
    const pkg = await this.pkg(p.path)
    if (!pkg) return { manager: 'none', outdated: [], error: 'This project has no package.json.', ranAt: Date.now() }
    const manager = (await this.manager(p.path, pkg)) ?? 'npm'
    if (manager !== 'npm' && manager !== 'pnpm') return { manager, outdated: [], error: `Dependency checks support npm and pnpm. This project uses ${manager}.`, ranAt: Date.now() }
    const run = this.deps.runTolerant ?? defaultTolerant
    const types: Record<string, string> = {}
    for (const k of ['devDependencies', 'optionalDependencies', 'dependencies'] as const) for (const n of Object.keys((pkg[k] as object) ?? {})) types[n] = k
    const outdatedArgs = manager === 'pnpm' ? ['outdated', '--format', 'json'] : ['outdated', '--json']
    try {
      const [outdated, audit] = await Promise.all([run(manager, outdatedArgs, p.path), run(manager, ['audit', '--json'], p.path).catch((e: Error) => JSON.stringify({ error: { summary: e.message } }))])
      return buildReport(manager, outdated, audit, types)
    } catch (e) {
      return { manager, outdated: [], error: (e as Error).message, ranAt: Date.now() }
    }
  }

  /** Deletes one folder from the allowlist. Returns the refreshed snapshot. */
  async clean(projectId: string, folder: string): Promise<HealthSnapshot> {
    const p = this.project(projectId)
    if (!CLEANABLE.has(folder)) throw new Error(`${folder} is not on the list of folders Cairix will clean.`)
    if (this.deps.isRunning(projectId)) throw new Error('A script is running in this project. Stop it first.')
    const path = join(p.path, folder)
    const st = await lstat(path).catch(() => null)
    if (!st) throw new Error(`${folder} does not exist.`)
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`${folder} is not a plain folder.`)
    // Never follow a symlink out of the project, and never delete what git tracks.
    if ((await realpath(path)) !== join(await realpath(p.path), folder)) throw new Error(`${folder} points somewhere else.`)
    if (p.hasGit && (await this.deps.git(p.path, ['ls-files', '--', folder]).catch(() => '')).trim() !== '') throw new Error(`git tracks files in ${folder}, so Cairix will not delete it.`)
    await rm(path, { recursive: true, force: true })
    return this.scan(projectId)
  }

  // ───────────────────────── internals ─────────────────────────

  private project(id: string, needTrust = true): { path: string; hasGit: boolean } {
    const p = this.deps.project(id)
    if (!p) throw new Error('That project is no longer in Cairix.')
    if (needTrust && !p.trusted) throw new Error(`Trust "${p.name}" first: this runs its package manager in the folder.`)
    return p
  }

  private async pkg(dir: string): Promise<Record<string, any> | undefined> {
    const text = await read(join(dir, 'package.json'))
    try {
      return text ? JSON.parse(text) : undefined
    } catch {
      return undefined
    }
  }

  private async manager(dir: string, pkg: Record<string, any> | undefined): Promise<Manager | undefined> {
    const declared = typeof pkg?.packageManager === 'string' ? (pkg.packageManager.split('@')[0] as Manager) : undefined
    if (declared && ['npm', 'pnpm', 'yarn', 'bun'].includes(declared)) return declared
    if (await exists(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
    if (await exists(join(dir, 'yarn.lock'))) return 'yarn'
    if ((await exists(join(dir, 'bun.lockb'))) || (await exists(join(dir, 'bun.lock')))) return 'bun'
    if (await exists(join(dir, 'package-lock.json'))) return 'npm'
    return pkg ? 'npm' : undefined
  }

  private async tools(dir: string, pkg: Record<string, any> | undefined, manager: Manager | undefined): Promise<ToolCheck[]> {
    const version = this.deps.version ?? defaultVersion
    const out: ToolCheck[] = []
    const check = async (tool: string, wanted: string, source: string, bin: string, args: string[], hint: string): Promise<void> => {
      const raw = await version(bin, args, dir)
      const actual = raw ? parseVer(raw) : null
      const shown = actual ? `${actual.major}.${actual.minor ?? 0}.${actual.patch ?? 0}` : undefined
      const ok = raw === undefined ? null : satisfies(raw, wanted)
      out.push({ tool, wanted, source, actual: shown, ok, hint: raw === undefined ? `${bin} was not found on your PATH.` : ok === false ? hint : undefined })
    }

    const toolVersions = (await read(join(dir, '.tool-versions'))) ?? ''
    // Node
    const nodeWanted: Array<[string | undefined, string]> = [
      [firstLine((await read(join(dir, '.nvmrc'))) ?? ''), '.nvmrc'],
      [firstLine((await read(join(dir, '.node-version'))) ?? ''), '.node-version'],
      [toolVersion(toolVersions, 'nodejs', 'node'), '.tool-versions'],
      [pkg?.volta?.node, 'package.json volta'],
      [pkg?.engines?.node, 'package.json engines']
    ]
    const node = nodeWanted.find(([w]) => w)
    if (node) await check('Node', node[0]!, node[1], 'node', ['--version'], 'Run `nvm use` (or fnm/volta) in this folder, or install the version it asks for.')

    // Python
    const pyproject = (await read(join(dir, 'pyproject.toml'))) ?? ''
    const runtime = (await read(join(dir, 'runtime.txt')))?.match(/python-(\S+)/)?.[1]
    const pyWanted: Array<[string | undefined, string]> = [
      [firstLine((await read(join(dir, '.python-version'))) ?? ''), '.python-version'],
      [toolVersion(toolVersions, 'python'), '.tool-versions'],
      [pyproject.match(/requires-python\s*=\s*["']([^"']+)["']/)?.[1], 'pyproject.toml'],
      [runtime, 'runtime.txt']
    ]
    const py = pyWanted.find(([w]) => w && /\d/.test(w))
    if (py) await check('Python', py[0]!, py[1], 'python3', ['--version'], 'Use pyenv/uv to install and select the version it asks for.')

    // Ruby, Go
    const ruby = firstLine((await read(join(dir, '.ruby-version'))) ?? '') ?? toolVersion(toolVersions, 'ruby')
    if (ruby) await check('Ruby', ruby.replace(/^ruby-/, ''), '.ruby-version', 'ruby', ['--version'], 'Use rbenv/asdf to select it.')
    const goMod = (await read(join(dir, 'go.mod')))?.match(/^go\s+(\d+\.\d+(?:\.\d+)?)/m)?.[1]
    if (goMod) await check('Go', `>=${goMod}`, 'go.mod', 'go', ['version'], 'Install a newer Go.')

    // Package manager
    if (typeof pkg?.packageManager === 'string' && pkg.packageManager.includes('@')) {
      const [name, wanted] = pkg.packageManager.split('@')
      await check(name, wanted.split('+')[0], 'package.json packageManager', name, ['--version'], `Run \`corepack enable\` so ${name} switches to the pinned version.`)
    }
    // More than one lockfile: two package managers fighting over the same node_modules.
    const locks = [['package-lock.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun']] as const
    const present = [...new Set((await Promise.all(locks.map(async ([f, m]) => ((await exists(join(dir, f))) ? m : null)))).filter((m): m is Manager => !!m))]
    if (present.length > 1) out.push({ tool: 'Lockfiles', wanted: 'one package manager', source: present.join(' + '), ok: false, hint: `Lockfiles for ${present.join(' and ')} exist. Keep one and delete the other so installs are reproducible.` })
    else if (manager && typeof pkg?.packageManager === 'string' && present.length === 1 && present[0] !== manager) out.push({ tool: 'Lockfiles', wanted: manager, source: 'package.json packageManager', actual: present[0], ok: false, hint: `package.json says ${manager} but the lockfile is for ${present[0]}.` })
    return out
  }

  private async hogs(projectId: string, dir: string, hasGit: boolean, manager: Manager | undefined): Promise<DiskHog[]> {
    const size = this.deps.size ?? defaultSize
    const min = this.deps.minKb ?? 5120
    const found = await Promise.all(
      HOGS.map(async (h): Promise<DiskHog | null> => {
        if (h.needs && !(await exists(join(dir, h.needs)))) return null
        const path = join(dir, h.name)
        const st = await lstat(path).catch(() => null)
        if (!st || !st.isDirectory() || st.isSymbolicLink()) return null
        if (hasGit && (await this.deps.git(dir, ['ls-files', '--', h.name]).catch(() => '')).trim() !== '') return null // tracked: not ours to remove
        const sizeKb = await size(path)
        return sizeKb >= min ? { name: h.name, sizeKb, regenerate: h.regenerate(manager) } : null
      })
    )
    void projectId
    return found.filter((h): h is DiskHog => h !== null).sort((a, b) => b.sizeKb - a.sizeKb)
  }
}
