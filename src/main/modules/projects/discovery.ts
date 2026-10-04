import { createHash } from 'crypto'
import { readdir, readFile } from 'fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'path'
import type { PackageManager, Project, ProjectKind } from '@shared/types'

/**
 * Read-only recursive project discovery. The walk shape (excluded dirs, depth
 * cap, skip unreadable) is carried over from Vaultic's env scanner; what's new
 * is marker-based detection and parent/child grouping so a monorepo like
 * `viblix` shows up as one root with its apps and packages nested under it.
 *
 * It never writes, never follows symlinks, and stops at hard caps so pointing
 * it at a huge folder (like $HOME) degrades to a partial result, not a hang.
 */

/** Directories that never contain projects worth listing. */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'vendor',
  'Pods',
  'DerivedData',
  '__pycache__',
  '__fixtures__',
  '__mocks__',
  'site-packages'
])

export const MAX_DEPTH = 6
export const MAX_DIRS = 20_000
export const MAX_PROJECTS = 500

const STRONG_PYTHON = ['pyproject.toml', 'requirements.txt', 'setup.py', 'setup.cfg', 'Pipfile', 'manage.py']
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
const MAKE_FILES = ['Makefile', 'makefile', 'GNUmakefile']
const MONOREPO_FILES = ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json']
const MEANINGFUL_PKG_KEYS = [
  'name',
  'scripts',
  'dependencies',
  'devDependencies',
  'workspaces',
  'bin',
  'main',
  'exports'
]

export function projectId(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 12)
}

interface PackageJson {
  name?: string
  packageManager?: string
  workspaces?: unknown
  [key: string]: unknown
}

async function readPackageJson(dir: string): Promise<PackageJson | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as PackageJson) : null
  } catch {
    return null
  }
}

/**
 * Which package manager a project uses. `packageManager` in package.json wins;
 * otherwise the nearest lockfile, searching upward to the workspace root
 * because monorepo members keep their lockfile at the top.
 */
export async function detectPackageManager(
  projectDir: string,
  workspaceRoot: string
): Promise<PackageManager | undefined> {
  let dir = projectDir
  for (;;) {
    let names: Set<string>
    try {
      names = new Set(await readdir(dir))
    } catch {
      names = new Set()
    }
    const field = (await readPackageJson(dir))?.packageManager
    const fromField = typeof field === 'string' ? field.split('@')[0] : undefined
    if (fromField === 'pnpm' || fromField === 'yarn' || fromField === 'bun' || fromField === 'npm') return fromField
    if (names.has('pnpm-lock.yaml')) return 'pnpm'
    if (names.has('yarn.lock')) return 'yarn'
    if (names.has('bun.lock') || names.has('bun.lockb')) return 'bun'
    if (names.has('package-lock.json') || names.has('npm-shrinkwrap.json')) return 'npm'
    if (dir === workspaceRoot) return undefined
    const parent = join(dir, '..')
    if (parent === dir || !isWithin(workspaceRoot, parent)) return undefined
    dir = parent
  }
}

function isWithin(root: string, dir: string): boolean {
  const rel = relative(root, dir)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

export interface DiscoveryResult {
  projects: Project[]
  truncated: boolean
}

export async function discoverProjects(rootPath: string): Promise<DiscoveryResult> {
  const projects: Project[] = []
  let dirsVisited = 0
  let truncated = false

  async function walk(dir: string, depth: number, parentId: string | null): Promise<void> {
    if (truncated) return
    if (++dirsVisited > MAX_DIRS || projects.length >= MAX_PROJECTS) {
      truncated = true
      return
    }

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable, skip
    }
    const names = new Set(entries.map((e) => e.name))

    // A virtualenv is a directory tree full of Python packages and bin
    // scripts, never a project of its own.
    if (names.has('pyvenv.cfg')) return

    let nextParent = parentId
    const project = await inspect(dir, names, depth === 0)
    if (project) {
      projects.push({ ...project, parentId })
      nextParent = project.id
    }

    if (depth >= MAX_DEPTH) return
    for (const entry of entries) {
      if (!entry.isDirectory()) continue // also skips symlinks: no loops, no escaping the folder
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue
      await walk(join(dir, entry.name), depth + 1, nextParent)
    }
  }

  async function inspect(
    dir: string,
    names: Set<string>,
    isRoot: boolean
  ): Promise<Omit<Project, 'parentId'> | null> {
    const kinds: ProjectKind[] = []
    let name = basename(dir)
    let isMonorepoRoot = MONOREPO_FILES.some((f) => names.has(f))

    if (names.has('package.json')) {
      const pkg = await readPackageJson(dir)
      // Nested marker-only files like {"type":"module"} aren't projects.
      const meaningful = pkg === null || MEANINGFUL_PKG_KEYS.some((k) => k in pkg)
      if (meaningful || isRoot) {
        kinds.push('node')
        if (pkg?.workspaces) isMonorepoRoot = true
        if (typeof pkg?.name === 'string' && pkg.name) name = pkg.name
      }
    }
    if (STRONG_PYTHON.some((f) => names.has(f))) kinds.push('python')
    if (names.has('Cargo.toml')) kinds.push('rust')
    if (names.has('go.mod')) kinds.push('go')
    if (COMPOSE_FILES.some((f) => names.has(f))) kinds.push('compose')
    const hasGit = names.has('.git')
    // A Makefile alone is too common (docs, vendored code) to be a project.
    // It counts when it sits next to a repo root or is the folder the user added.
    if (MAKE_FILES.some((f) => names.has(f)) && (hasGit || isRoot || kinds.length > 0)) kinds.push('make')

    if (kinds.length === 0 && !hasGit) return null

    const rel = relative(rootPath, dir)
    return {
      id: projectId(dir),
      name,
      path: dir,
      relPath: rel,
      kinds,
      isMonorepoRoot,
      hasGit
    }
  }

  await walk(rootPath, 0, null)

  // Package manager needs filesystem reads up the tree, so resolve it after the walk.
  const resolved = await Promise.all(
    projects.map(async (p) =>
      p.kinds.includes('node')
        ? { ...p, packageManager: (await detectPackageManager(p.path, rootPath)) ?? ('npm' as PackageManager) }
        : p
    )
  )
  resolved.sort((a, b) => a.path.localeCompare(b.path))
  return { projects: resolved, truncated }
}
