import { access, readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import type { PackageManager, Project, ScriptCategory, ScriptDef, ScriptSource } from '@shared/types'

/**
 * Turns a project folder into a list of runnable scripts. Detection is pure
 * file reading. The renderer only ever sees `ScriptDef` (display data) and
 * asks to run one *by id*; the command to spawn stays on this side of the
 * IPC boundary so a compromised renderer can't run arbitrary commands.
 */

export interface SpawnSpec {
  file: string
  args: string[]
  cwd: string
  /**
   * How extra user arguments are appended. npm needs `--` before them
   * (`npm run dev -- --port 4000`); the others forward them as-is.
   */
  argsSeparator?: '--'
  /** Extra environment for this process only (custom actions pass their {variables} here). */
  env?: Record<string, string>
}

export interface ResolvedScript {
  def: ScriptDef
  spawn: SpawnSpec
}

// ───────────────────────── helpers ─────────────────────────

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

const CATEGORY_TOKENS: Array<[ScriptCategory, string[]]> = [
  // Order matters: `test:watch` is a test script, `build:watch` a build script.
  ['test', ['test', 'tests', 'spec', 'e2e', 'unit', 'integration', 'vitest', 'jest', 'playwright', 'cypress', 'coverage']],
  ['lint', ['lint', 'format', 'fmt', 'prettier', 'eslint', 'ruff', 'mypy', 'typecheck', 'tsc', 'check', 'types']],
  ['build', ['build', 'compile', 'bundle', 'dist', 'package', 'pack', 'release', 'export']],
  ['db', ['db', 'migrate', 'migration', 'migrations', 'seed', 'prisma', 'drizzle', 'schema', 'makemigrations']],
  ['dev', ['dev', 'start', 'serve', 'watch', 'run', 'runserver', 'up', 'preview', 'storybook']]
]

/** Splits `test:watch`, `db_push`, `buildProd` into lowercase word tokens. */
function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function categorize(name: string): ScriptCategory {
  const t = tokens(name)
  for (const [category, words] of CATEGORY_TOKENS) if (t.some((w) => words.includes(w))) return category
  return 'other'
}

const NEEDS_TTY = /\b(inquirer|prompts?|enquirer|readline)\b|--interactive|\bcreate-[\w-]+\b|\bnpm init\b/

const sid = (project: Project, source: ScriptSource, name: string): string => `${project.id}:${source}:${name}`

function def(
  project: Project,
  source: ScriptSource,
  name: string,
  command: string,
  needsTty = false
): ScriptDef {
  return {
    id: sid(project, source, name),
    projectId: project.id,
    name,
    command,
    source,
    category: categorize(name),
    needsTty
  }
}

// ───────────────────────── Node ─────────────────────────

/** Lifecycle hooks run automatically around other scripts; listing them is noise. */
const LIFECYCLE = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'prepare',
  'publish',
  'postpublish',
  'preversion',
  'version',
  'postversion',
  'dependencies'
])

function runArgs(pm: PackageManager, script: string): Pick<SpawnSpec, 'file' | 'args' | 'argsSeparator'> {
  return { file: pm, args: ['run', script], argsSeparator: pm === 'npm' ? '--' : undefined }
}

async function nodeScripts(project: Project): Promise<ResolvedScript[]> {
  let pkg: { scripts?: Record<string, unknown> }
  try {
    pkg = JSON.parse(await readFile(join(project.path, 'package.json'), 'utf8'))
  } catch {
    return []
  }
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  const pm = project.packageManager ?? 'npm'
  const names = Object.keys(scripts)
  const out: ResolvedScript[] = []
  for (const name of names) {
    const cmd = scripts[name]
    if (typeof cmd !== 'string' || LIFECYCLE.has(name)) continue
    // pre<x>/post<x> hooks are only noise when <x> is also a script.
    const hookOf = name.match(/^(pre|post)(.+)$/)?.[2]
    if (hookOf && names.includes(hookOf)) continue
    out.push({
      def: def(project, 'package.json', name, cmd, NEEDS_TTY.test(cmd)),
      spawn: { ...runArgs(pm, name), cwd: project.path }
    })
  }
  return out
}

// ───────────────────────── Python ─────────────────────────

/** Minimal TOML reader for `name = "value"` pairs inside named tables. */
export function parseTomlStringTables(toml: string, tables: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  let active = false
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      const header = line.match(/^\[([^[\]]+)\]\s*(#.*)?$/)
      active = !!header && tables.includes(header[1].trim())
      continue
    }
    if (!active) continue
    const kv = line.match(/^(["']?)([A-Za-z0-9_.-]+)\1\s*=\s*(["'])(.*?)\3\s*(#.*)?$/)
    if (kv) out[kv[2]] = kv[4]
  }
  return out
}

interface PythonRunner {
  /** Command that runs `python`, e.g. ['/p/.venv/bin/python'] or ['uv','run','python']. */
  python: string[]
  /** A virtualenv's bin directory, where installed console scripts live. */
  binDir?: string
  /** Wrapper that resolves console scripts in a managed env, e.g. ['uv','run']. */
  wrap?: string[]
}

async function pythonRunner(dir: string): Promise<PythonRunner> {
  for (const venv of ['.venv', 'venv', 'env']) {
    const binDir = join(dir, venv, 'bin')
    if (await exists(join(binDir, 'python'))) return { python: [join(binDir, 'python')], binDir }
  }
  if (await exists(join(dir, 'uv.lock'))) return { python: ['uv', 'run', 'python'], wrap: ['uv', 'run'] }
  if (await exists(join(dir, 'poetry.lock'))) return { python: ['poetry', 'run', 'python'], wrap: ['poetry', 'run'] }
  return { python: ['python3'] }
}

const MAIN_GUARD = /if\s+__name__\s*==\s*["']__main__["']/
const MAX_PY_FILE = 200_000

async function pythonFiles(project: Project): Promise<string[]> {
  const found: string[] = []
  for (const sub of ['', 'scripts', 'bin', 'tools']) {
    let names: string[]
    try {
      names = await readdir(join(project.path, sub))
    } catch {
      continue
    }
    for (const f of names.filter((n) => n.endsWith('.py') && n !== 'setup.py' && n !== 'manage.py')) {
      found.push(sub ? `${sub}/${f}` : f)
    }
  }
  return found
}

async function pythonScripts(project: Project): Promise<ResolvedScript[]> {
  const out: ResolvedScript[] = []
  const runner = await pythonRunner(project.path)
  const cwd = project.path

  // 1. console scripts declared in pyproject.toml
  try {
    const toml = await readFile(join(cwd, 'pyproject.toml'), 'utf8')
    const entries = parseTomlStringTables(toml, ['project.scripts', 'tool.poetry.scripts'])
    for (const [name, target] of Object.entries(entries)) {
      const [mod, fn] = target.split(':')
      const direct = runner.binDir ? join(runner.binDir, name) : null
      let spawn: SpawnSpec
      if (direct && (await exists(direct))) spawn = { file: direct, args: [], cwd }
      else if (runner.wrap) spawn = { file: runner.wrap[0], args: [...runner.wrap.slice(1), name], cwd }
      else if (mod && fn) {
        spawn = {
          file: runner.python[0],
          args: [...runner.python.slice(1), '-c', `import sys; from ${mod} import ${fn}; sys.exit(${fn}())`],
          cwd
        }
      } else continue
      out.push({ def: def(project, 'pyproject', name, target), spawn })
    }
  } catch {
    /* no pyproject.toml */
  }

  // 2. Django
  if (await exists(join(cwd, 'manage.py'))) {
    for (const [cmd, tty] of [
      ['runserver', false],
      ['migrate', false],
      ['makemigrations', false],
      ['test', false],
      ['shell', true],
      ['createsuperuser', true]
    ] as const) {
      out.push({
        def: def(project, 'manage.py', cmd, `python manage.py ${cmd}`, tty),
        spawn: { file: runner.python[0], args: [...runner.python.slice(1), 'manage.py', cmd], cwd }
      })
    }
  }

  // 3. runnable .py files (have a __main__ guard)
  for (const rel of await pythonFiles(project)) {
    try {
      const full = join(cwd, rel)
      if ((await stat(full)).size > MAX_PY_FILE) continue
      const text = await readFile(full, 'utf8')
      if (!MAIN_GUARD.test(text)) continue
      out.push({
        def: def(project, 'python-file', rel, `python ${rel}`, /\binput\s*\(/.test(text)),
        spawn: { file: runner.python[0], args: [...runner.python.slice(1), rel], cwd }
      })
    } catch {
      /* unreadable file */
    }
  }
  return out
}

// ───────────────────────── Make / Compose / Cargo / Go ─────────────────────────

export function parseMakeTargets(makefile: string): string[] {
  const targets = new Set<string>()
  for (const line of makefile.split(/\r?\n/)) {
    // Recipe lines start with a tab; variable assignments use `:=`/`::=`.
    if (!line || line.startsWith('\t') || line.startsWith('#') || line.startsWith(' ')) continue
    const m = line.match(/^([^:=#\s][^:=#]*?)\s*:(?![:=])/)
    if (!m) continue
    for (const t of m[1].split(/\s+/)) {
      if (t && !t.startsWith('.') && !/[%$()]/.test(t)) targets.add(t)
    }
  }
  return [...targets]
}

async function makeScripts(project: Project): Promise<ResolvedScript[]> {
  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    try {
      const text = await readFile(join(project.path, name), 'utf8')
      return parseMakeTargets(text).map((t) => ({
        def: def(project, 'makefile', t, `make ${t}`),
        spawn: { file: 'make', args: [t], cwd: project.path }
      }))
    } catch {
      /* try next casing */
    }
  }
  return []
}

function composeScripts(project: Project): ResolvedScript[] {
  const mk = (name: string, args: string[]): ResolvedScript => ({
    def: def(project, 'compose', name, `docker compose ${args.join(' ')}`),
    spawn: { file: 'docker', args: ['compose', ...args], cwd: project.path }
  })
  return [mk('up', ['up']), mk('down', ['down']), mk('build', ['build']), mk('logs', ['logs', '-f', '--tail', '100'])]
}

function simpleToolchain(project: Project, tool: 'cargo' | 'go'): ResolvedScript[] {
  const cmds: Array<[string, string[]]> =
    tool === 'cargo'
      ? [
          ['run', ['run']],
          ['build', ['build']],
          ['test', ['test']],
          ['clippy', ['clippy']]
        ]
      : [
          ['run', ['run', '.']],
          ['build', ['build', './...']],
          ['test', ['test', './...']],
          ['vet', ['vet', './...']]
        ]
  return cmds.map(([name, args]) => ({
    def: def(project, 'toolchain', `${tool} ${name}`, `${tool} ${args.join(' ')}`),
    spawn: { file: tool, args, cwd: project.path }
  }))
}

// ───────────────────────── entry point ─────────────────────────

export async function detectScripts(project: Project): Promise<ResolvedScript[]> {
  const groups = await Promise.all([
    project.kinds.includes('node') ? nodeScripts(project) : [],
    project.kinds.includes('python') ? pythonScripts(project) : [],
    project.kinds.includes('make') ? makeScripts(project) : [],
    project.kinds.includes('compose') ? composeScripts(project) : [],
    project.kinds.includes('rust') ? simpleToolchain(project, 'cargo') : [],
    project.kinds.includes('go') ? simpleToolchain(project, 'go') : []
  ])
  return groups.flat()
}
