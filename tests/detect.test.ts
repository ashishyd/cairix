import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { discoverProjects } from '../src/main/modules/projects/discovery'
import {
  categorize,
  detectScripts,
  parseMakeTargets,
  parseTomlStringTables
} from '../src/main/modules/scripts/detect'
import { json, makeTree } from './helpers'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function scriptsFor(files: Record<string, string>, rel = '') {
  const t = makeTree(files)
  cleanups.push(t.cleanup)
  const { projects } = await discoverProjects(t.root)
  const project = projects.find((p) => p.relPath === rel)
  if (!project) throw new Error(`no project at "${rel}": ${projects.map((p) => p.relPath).join(', ')}`)
  return { scripts: await detectScripts(project), root: t.root, project }
}

describe('categorize', () => {
  it.each([
    ['dev', 'dev'],
    ['start:prod', 'dev'],
    ['test:watch', 'test'], // test wins over watch
    ['build:watch', 'build'],
    ['typecheck', 'lint'],
    ['db:push', 'db'],
    ['db_migrate', 'db'],
    ['buildProd', 'build'],
    ['latest-news', 'other'], // "test" inside a word must not match
    ['storybook', 'dev'],
    ['clean', 'other']
  ])('%s -> %s', (name, expected) => {
    expect(categorize(name)).toBe(expected)
  })
})

describe('node scripts', () => {
  it('lists scripts, hides lifecycle hooks and pre/post hooks of real scripts', async () => {
    const { scripts } = await scriptsFor({
      'package.json': json({
        name: 'app',
        scripts: {
          dev: 'next dev',
          build: 'next build',
          prebuild: 'rimraf dist', // hook of build: hidden
          postinstall: 'patch-package', // lifecycle: hidden
          prepare: 'husky',
          predeploy: 'echo hi', // "deploy" is not a script, so this one is kept
          test: 'vitest'
        }
      }),
      'pnpm-lock.yaml': ''
    })
    expect(scripts.map((s) => s.def.name)).toEqual(['dev', 'build', 'predeploy', 'test'])
    expect(scripts[0].spawn).toMatchObject({ file: 'pnpm', args: ['run', 'dev'] })
    expect(scripts[0].spawn.argsSeparator).toBeUndefined()
  })

  it('uses the right runner per package manager and "--" only for npm', async () => {
    const npm = await scriptsFor({ 'package.json': json({ name: 'a', scripts: { dev: 'x' } }), 'package-lock.json': '' })
    expect(npm.scripts[0].spawn).toMatchObject({ file: 'npm', args: ['run', 'dev'], argsSeparator: '--' })
    const yarn = await scriptsFor({ 'package.json': json({ name: 'a', scripts: { dev: 'x' } }), 'yarn.lock': '' })
    expect(yarn.scripts[0].spawn.file).toBe('yarn')
  })

  it('runs monorepo members in their own folder with the root lockfile', async () => {
    const { scripts, root } = await scriptsFor(
      {
        'package.json': json({ name: 'root', workspaces: ['apps/*'] }),
        'pnpm-lock.yaml': '',
        'apps/web/package.json': json({ name: 'web', scripts: { dev: 'next dev' } })
      },
      'apps/web'
    )
    expect(scripts[0].spawn).toMatchObject({ file: 'pnpm', cwd: join(root, 'apps/web') })
  })

  it('flags likely-interactive scripts', async () => {
    const { scripts } = await scriptsFor({
      'package.json': json({ name: 'a', scripts: { new: 'npm init', dev: 'vite' } })
    })
    expect(Object.fromEntries(scripts.map((s) => [s.def.name, s.def.needsTty]))).toEqual({ new: true, dev: false })
  })

  it('tolerates a package.json with no scripts or invalid JSON', async () => {
    expect((await scriptsFor({ 'package.json': json({ name: 'a' }) })).scripts).toEqual([])
    expect((await scriptsFor({ 'package.json': '{ not json' })).scripts).toEqual([])
  })

  it('gives every script a unique, stable id', async () => {
    const { scripts } = await scriptsFor({ 'package.json': json({ name: 'a', scripts: { a: '1', b: '2' } }) })
    const ids = scripts.map((s) => s.def.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toMatch(/^[0-9a-f]{12}:package\.json:a$/)
  })
})

describe('python scripts', () => {
  it('parses [project.scripts] and [tool.poetry.scripts]', () => {
    const toml = `
[project]
name = "svc"

[project.scripts]
svc = "svc.cli:main"   # comment
worker = 'svc.worker:run'

[tool.poetry.scripts]
legacy = "svc.legacy:go"

[tool.other]
ignored = "nope:nope"
`
    expect(parseTomlStringTables(toml, ['project.scripts', 'tool.poetry.scripts'])).toEqual({
      svc: 'svc.cli:main',
      worker: 'svc.worker:run',
      legacy: 'svc.legacy:go'
    })
  })

  it('builds a python -c fallback when there is no venv or wrapper', async () => {
    const { scripts } = await scriptsFor({
      'pyproject.toml': '[project.scripts]\nsvc = "svc.cli:main"\n'
    })
    expect(scripts[0].def).toMatchObject({ name: 'svc', source: 'pyproject' })
    expect(scripts[0].spawn.file).toBe('python3')
    expect(scripts[0].spawn.args).toEqual(['-c', 'import sys; from svc.cli import main; sys.exit(main())'])
  })

  it('prefers an installed console script inside .venv/bin', async () => {
    const t = makeTree({ 'pyproject.toml': '[project.scripts]\nsvc = "svc.cli:main"\n' })
    cleanups.push(t.cleanup)
    mkdirSync(join(t.root, '.venv/bin'), { recursive: true })
    writeFileSync(join(t.root, '.venv/bin/python'), '')
    writeFileSync(join(t.root, '.venv/bin/svc'), '')
    writeFileSync(join(t.root, '.venv/pyvenv.cfg'), '')
    const { projects } = await discoverProjects(t.root)
    const scripts = await detectScripts(projects[0])
    expect(scripts[0].spawn.file).toBe(join(t.root, '.venv/bin/svc'))
  })

  it('wraps in `uv run` when uv.lock exists', async () => {
    const { scripts } = await scriptsFor({
      'pyproject.toml': '[project.scripts]\nsvc = "svc.cli:main"\n',
      'uv.lock': ''
    })
    expect(scripts[0].spawn).toMatchObject({ file: 'uv', args: ['run', 'svc'] })
  })

  it('lists Django commands and flags the interactive ones', async () => {
    const { scripts } = await scriptsFor({ 'manage.py': 'print("x")' })
    const byName = Object.fromEntries(scripts.map((s) => [s.def.name, s]))
    expect(Object.keys(byName)).toEqual(['runserver', 'migrate', 'makemigrations', 'test', 'shell', 'createsuperuser'])
    expect(byName.runserver.spawn).toMatchObject({ file: 'python3', args: ['manage.py', 'runserver'] })
    expect(byName.shell.def.needsTty).toBe(true)
    expect(byName.runserver.def.needsTty).toBe(false)
  })

  it('only lists .py files that have a __main__ guard', async () => {
    const { scripts } = await scriptsFor({
      'requirements.txt': 'x',
      'tool.py': 'def f(): pass\nif __name__ == "__main__":\n    f()\n',
      'library.py': 'def f(): pass\n',
      'scripts/ask.py': "if __name__ == '__main__':\n    name = input('who? ')\n"
    })
    expect(scripts.map((s) => s.def.name).sort()).toEqual(['scripts/ask.py', 'tool.py'])
    expect(scripts.find((s) => s.def.name === 'scripts/ask.py')!.def.needsTty).toBe(true)
  })
})

describe('make, compose and toolchains', () => {
  it('extracts make targets and skips pattern rules, variables and recipes', () => {
    const mk = [
      'CC := gcc',
      'VERSION ::= 1',
      '.PHONY: build test',
      'build: deps',
      '\tgo build ./...',
      'test lint:',
      '\techo run',
      '%.o: %.c',
      '\t$(CC) -c $<',
      '$(BIN): main.go',
      '# comment: not a target',
      'deploy:'
    ].join('\n')
    expect(parseMakeTargets(mk)).toEqual(['build', 'test', 'lint', 'deploy'])
  })

  it('detects compose, cargo and go', async () => {
    const compose = await scriptsFor({ 'docker-compose.yml': 'services: {}' })
    expect(compose.scripts.map((s) => s.def.name)).toEqual(['up', 'down', 'build', 'logs'])
    expect(compose.scripts[0].spawn).toMatchObject({ file: 'docker', args: ['compose', 'up'] })

    const cargo = await scriptsFor({ 'Cargo.toml': '[package]' })
    expect(cargo.scripts[0].spawn).toMatchObject({ file: 'cargo', args: ['run'] })
    expect(cargo.scripts[0].def.source).toBe('toolchain')

    const go = await scriptsFor({ 'go.mod': 'module x' })
    expect(go.scripts[0].spawn).toMatchObject({ file: 'go', args: ['run', '.'] })
  })
})
