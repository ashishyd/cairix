import { afterEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { discoverProjects } from '../src/main/modules/projects/discovery'
import { json, link, makeTree } from './helpers'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
function tree(files: Record<string, string>): string {
  const t = makeTree(files)
  cleanups.push(t.cleanup)
  return t.root
}

describe('discoverProjects', () => {
  it('finds a pnpm monorepo and nests apps under their root', async () => {
    const root = tree({
      'package.json': json({ name: 'mono', workspaces: ['apps/*', 'packages/*'] }),
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n',
      'pnpm-lock.yaml': '',
      'turbo.json': '{}',
      'apps/web/package.json': json({ name: '@mono/web', scripts: { dev: 'next dev' } }),
      'apps/mobile/package.json': json({ name: '@mono/mobile', scripts: { start: 'expo start' } }),
      'packages/shared/package.json': json({ name: '@mono/shared' }),
      'node_modules/left-pad/package.json': json({ name: 'left-pad' })
    })

    const { projects, truncated } = await discoverProjects(root)
    expect(truncated).toBe(false)
    expect(projects.map((p) => p.relPath)).toEqual(['', 'apps/mobile', 'apps/web', 'packages/shared'])

    const rootProject = projects.find((p) => p.relPath === '')!
    expect(rootProject.isMonorepoRoot).toBe(true)
    expect(rootProject.parentId).toBeNull()
    for (const child of projects.filter((p) => p.relPath !== '')) {
      expect(child.parentId).toBe(rootProject.id)
      expect(child.kinds).toEqual(['node'])
      // lockfile lives at the monorepo root; members must inherit it
      expect(child.packageManager).toBe('pnpm')
    }
  })

  it('prefers the packageManager field over lockfiles', async () => {
    const root = tree({
      'package.json': json({ name: 'a', packageManager: 'yarn@4.1.0' }),
      'package-lock.json': ''
    })
    const { projects } = await discoverProjects(root)
    expect(projects[0].packageManager).toBe('yarn')
  })

  it('detects python projects and ignores virtualenvs', async () => {
    const root = tree({
      'svc/pyproject.toml': '[project]\nname="svc"\n',
      'tool/requirements.txt': 'flask\n',
      'svc/.venv/pyvenv.cfg': 'home = /usr/bin',
      'svc/.venv/lib/site-packages/pkg/setup.py': '',
      'venv-no-dot/pyvenv.cfg': '',
      'venv-no-dot/requirements.txt': 'x'
    })
    const { projects } = await discoverProjects(root)
    expect(projects.map((p) => p.relPath)).toEqual(['svc', 'tool'])
    expect(projects.every((p) => p.kinds.includes('python'))).toBe(true)
  })

  it('skips marker-only package.json files such as {"type":"module"}', async () => {
    const root = tree({
      'lib/package.json': json({ name: 'lib' }),
      'lib/dist-esm/package.json': json({ type: 'module' })
    })
    const { projects } = await discoverProjects(root)
    expect(projects.map((p) => p.relPath)).toEqual(['lib'])
  })

  it('treats a Makefile as a project only with another signal', async () => {
    const root = tree({
      'docs/Makefile': 'html:\n\tsphinx\n',
      'tool/Makefile': 'build:\n\tgo build\n',
      'tool/.git/HEAD': 'ref: refs/heads/main'
    })
    const { projects } = await discoverProjects(root)
    expect(projects.map((p) => p.relPath)).toEqual(['tool'])
    expect(projects[0].kinds).toEqual(['make'])
    expect(projects[0].hasGit).toBe(true)
  })

  it('counts a bare git repo and a git worktree (.git file) as projects', async () => {
    const root = tree({
      'repo-a/.git/HEAD': 'ref: refs/heads/main',
      'repo-b/.git': 'gitdir: /elsewhere/.git/worktrees/b',
      'not-a-repo/readme.md': '# hi'
    })
    const { projects } = await discoverProjects(root)
    expect(projects.map((p) => p.relPath)).toEqual(['repo-a', 'repo-b'])
  })

  it('detects compose, rust and go markers', async () => {
    const root = tree({
      'stack/docker-compose.yml': 'services: {}',
      'crate/Cargo.toml': '[package]',
      'svc/go.mod': 'module x'
    })
    const { projects } = await discoverProjects(root)
    const byPath = Object.fromEntries(projects.map((p) => [p.relPath, p.kinds]))
    expect(byPath).toEqual({ stack: ['compose'], crate: ['rust'], svc: ['go'] })
  })

  it('does not follow symlinks (no loops, no escaping the folder)', async () => {
    const outside = tree({ 'secret/package.json': json({ name: 'outside' }) })
    const root = tree({ 'real/package.json': json({ name: 'real' }) })
    link(outside, join(root, 'escape'))
    link(root, join(root, 'real', 'loop'))
    const { projects } = await discoverProjects(root)
    expect(projects.map((p) => p.relPath)).toEqual(['real'])
  })

  it('respects the depth cap', async () => {
    const root = tree({
      'a/b/c/d/e/f/ok/package.json': json({ name: 'ok' }), // depth 7 from root: beyond MAX_DEPTH 6
      'a/b/c/d/e/near/package.json': json({ name: 'near' }) // depth 6: allowed
    })
    const { projects } = await discoverProjects(root)
    expect(projects.map((p) => p.name)).toEqual(['near'])
  })

  it('returns an empty list for an empty or unreadable folder', async () => {
    const root = tree({})
    expect((await discoverProjects(root)).projects).toEqual([])
    expect((await discoverProjects(join(root, 'does-not-exist'))).projects).toEqual([])
  })

  it('gives stable ids across runs', async () => {
    const root = tree({ 'a/package.json': json({ name: 'a' }) })
    const first = await discoverProjects(root)
    const second = await discoverProjects(root)
    expect(first.projects[0].id).toBe(second.projects[0].id)
    expect(first.projects[0].id).toMatch(/^[0-9a-f]{12}$/)
  })
})
