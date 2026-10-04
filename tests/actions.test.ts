import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { envName, parseTemplate, render, toShell, validateTemplate, variablesIn } from '../src/main/modules/actions/template'
import { runAction, previewAction, resolveValues, type ExecDeps } from '../src/main/modules/actions/exec'
import { ActionStore } from '../src/main/modules/actions/store'
import type { CustomAction, Project, Workspace } from '../src/shared/types'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-act-')))
  dirs.push(d)
  return d
}

/** Runs a compiled template in a real shell with the given variable values, as the app does. */
function runShell(template: string, values: Record<string, string>, cwd = tmp()): string {
  const { script, vars } = toShell(template)
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' }
  for (const v of vars) env[envName(v)] = values[v] ?? ''
  return execFileSync('/bin/zsh', ['-c', script], { cwd, env, encoding: 'utf8' })
}

describe('template parsing', () => {
  it('finds variables and tracks the quote each sits in', () => {
    expect(parseTemplate(`echo {file} "{branch}" '{port}'`).filter((p) => p.type === 'var')).toEqual([
      { type: 'var', name: 'file', quote: 'none' },
      { type: 'var', name: 'branch', quote: 'double' },
      { type: 'var', name: 'port', quote: 'single' }
    ])
  })
  it('ignores braces that are not variables (shell syntax, JSON, ${…})', () => {
    expect(variablesIn('echo ${HOME} {a,b} { "x": 1 } {Not_A_Var}')).toEqual([])
  })
  it('dedupes variable names', () => {
    expect(variablesIn('{port}{port}{pid}')).toEqual(['port', 'pid'])
  })
  it('respects escaped quotes', () => {
    expect(parseTemplate('echo \\"{file}').find((p) => p.type === 'var')).toMatchObject({ quote: 'none' })
  })
})

describe('validation', () => {
  it('rejects variables that do not exist for the scope, naming the ones that do', () => {
    expect(validateTemplate('open {port}', 'project', 'shell')).toMatch(/\{port\} is not available for project actions.*\{project\.path\}/)
    expect(validateTemplate('open {file}', 'port', 'shell')).toMatch(/not available/)
    expect(validateTemplate('echo {port} {url} {pid}', 'port', 'shell')).toBeNull()
    expect(validateTemplate('code {file}:{line}', 'finding', 'shell')).toBeNull()
  })
  it("rejects shell variables inside single quotes, where the shell would not expand them", () => {
    expect(validateTemplate("echo '{file}'", 'finding', 'shell')).toMatch(/single quotes/)
    expect(validateTemplate("https://x/?q='{file}'", 'finding', 'url')).toBeNull() // fine outside a shell
  })
  it('rejects empty, huge and NUL-containing templates', () => {
    expect(validateTemplate('  ', 'project', 'shell')).toMatch(/Enter/)
    expect(validateTemplate('x'.repeat(2001), 'project', 'shell')).toMatch(/too long/)
    expect(validateTemplate('a\0b', 'project', 'shell')).toMatch(/invalid/)
  })
})

describe('shell safety (real zsh)', () => {
  const EVIL = `a; touch PWNED_1 $(touch PWNED_2) \`touch PWNED_3\` && touch PWNED_4 | cat > PWNED_5`
  it('treats hostile values as plain data: nothing is executed or created', () => {
    const cwd = tmp()
    const out = runShell('printf %s {file}', { file: EVIL }, cwd)
    expect(out).toBe(EVIL)
    for (let i = 1; i <= 5; i++) expect(existsSync(join(cwd, `PWNED_${i}`))).toBe(false)
  })
  it('works the same when you write the quotes yourself', () => {
    const cwd = tmp()
    expect(runShell('printf %s "{file}"', { file: EVIL }, cwd)).toBe(EVIL)
    expect(runShell('printf %s "prefix-{file}-suffix"', { file: 'x y' }, cwd)).toBe('prefix-x y-suffix')
    expect(existsSync(join(cwd, 'PWNED_1'))).toBe(false)
  })
  it('keeps values with spaces, globs and leading dashes as one argument', () => {
    const cwd = tmp()
    writeFileSync(join(cwd, 'real.txt'), '')
    expect(runShell('printf "[%s]" {file}', { file: '*.txt' }, cwd)).toBe('[*.txt]') // no glob expansion
    expect(runShell('printf "[%s]" {file}', { file: 'two words' }, cwd)).toBe('[two words]')
    expect(runShell('printf "[%s]" {file}', { file: '' }, cwd)).toBe('[]')
  })
  it('passes ordinary values through and supports several variables', () => {
    expect(runShell('echo {port}-{pid}', { port: '3000', pid: '42' }).trim()).toBe('3000-42')
    expect(runShell('echo {project.name}', { 'project.name': 'apps/web' }).trim()).toBe('apps/web')
  })
})

describe('render for non-shell targets', () => {
  it('url-encodes values so they cannot break out of a link', () => {
    expect(render('https://x.dev/?f={file}', { file: 'a b&c=d#e' }, encodeURIComponent)).toBe('https://x.dev/?f=a%20b%26c%3Dd%23e')
  })
})

describe('store', () => {
  const draft = { name: 'Git status', scope: 'project', kind: 'shell', template: 'git status -sb', confirm: false } as const
  it('saves, edits, deletes and survives a restart', () => {
    const dir = tmp()
    let events = 0
    const s = new ActionStore(dir, () => events++)
    const a = s.save(draft)
    expect(a.id).toBeTruthy()
    s.save({ ...a, name: 'Status' })
    expect(s.list().map((x) => x.name)).toEqual(['Status'])
    expect(new ActionStore(dir).list()).toHaveLength(1)
    s.delete(a.id)
    expect(new ActionStore(dir).list()).toEqual([])
    expect(events).toBe(3)
  })
  it('refuses invalid actions with a readable message', () => {
    const s = new ActionStore(tmp())
    expect(() => s.save({ ...draft, template: 'echo {port}' })).toThrow(/not available/)
    expect(() => s.save({ ...draft, name: '  ' })).toThrow(/name/)
    expect(() => s.save({ ...draft, kind: 'app', template: '', app: '--evil' })).toThrow(/application name/)
    expect(() => s.save({ ...draft, kind: 'url', template: 'javascript:alert(1)' })).toThrow(/https/)
    expect(() => s.save({ ...draft, id: 'nope' })).toThrow(/no longer exists/)
  })
  it('an app action with no path defaults to the project folder', () => {
    expect(new ActionStore(tmp()).save({ name: 'Cursor', scope: 'project', kind: 'app', app: 'Cursor', template: '', confirm: false }).template).toBe('{project.path}')
  })
  it('ignores a corrupt actions file instead of failing to start', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'actions.json'), '{ nope')
    expect(new ActionStore(dir).list()).toEqual([])
  })
})

describe('execution', () => {
  // Lives for the whole group (the per-test cleanup above would delete a tmp() folder after the first test).
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-act-root-')))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const project: Project = { id: 'p1', name: 'web', path: root, relPath: 'apps/web', kinds: ['node'], isMonorepoRoot: false, parentId: null, hasGit: true }
  const workspace: Workspace = { id: 'w1', name: 'ws', path: root, addedAt: 0, trusted: true, excludedPaths: [], projects: [project] }
  const calls: { urls: string[]; apps: Array<[string, string]>; started: Array<{ spawn: { args: string[]; env?: Record<string, string>; cwd: string } }> } = { urls: [], apps: [], started: [] }
  const deps: ExecDeps = {
    runner: { start: async (s: { spawn: { args: string[]; env?: Record<string, string>; cwd: string } }) => (calls.started.push(s), { runId: 'r1' }) } as never,
    findProject: (id) => (id === 'p1' ? { project, workspace } : undefined),
    isInsideWorkspace: (p) => p === root || p.startsWith(root + '/'),
    branchOf: async () => 'feat/x; rm -rf ~',
    openExternal: async (u) => void calls.urls.push(u),
    openInApp: async (a, p) => void calls.apps.push([a, p])
  }
  const act = (o: Partial<CustomAction>): CustomAction => ({ id: 'a1', name: 'A', scope: 'project', kind: 'shell', template: 'echo hi', confirm: false, ...o })

  it('resolves values from ids in main, never from the caller', async () => {
    const { values, cwd } = await resolveValues({ scope: 'port', projectId: 'p1', port: 3000, pid: 7 }, deps)
    expect(values).toMatchObject({ 'project.path': root, 'project.name': 'apps/web', port: '3000', pid: '7', url: 'http://localhost:3000', branch: 'feat/x; rm -rf ~' })
    expect(cwd).toBe(root)
    await expect(resolveValues({ scope: 'project', projectId: 'ghost' }, deps)).rejects.toThrow(/no longer/)
    await expect(resolveValues({ scope: 'port', port: 99999 }, deps)).rejects.toThrow(/port/)
    for (const file of ['../../etc/passwd', '/etc/passwd', 'a/../../b', '']) {
      await expect(resolveValues({ scope: 'finding', projectId: 'p1', file }, deps)).rejects.toThrow(/inside the project/)
    }
  })

  it('shell: starts a run whose command contains NO values, only env references', async () => {
    const r = await runAction(act({ template: 'echo {branch} {project.name}' }), { scope: 'project', projectId: 'p1' }, deps)
    expect(r.runId).toBe('r1')
    const spawn = calls.started.at(-1)!.spawn
    expect(spawn.args[1]).toBe('echo "${CX_BRANCH}" "${CX_PROJECT_NAME}"')
    expect(spawn.args[1]).not.toContain('rm -rf')
    expect(spawn.env).toEqual({ CX_BRANCH: 'feat/x; rm -rf ~', CX_PROJECT_NAME: 'apps/web' })
    expect(spawn.cwd).toBe(root)
    // and the real shell prints the hostile branch name literally
    const out = execFileSync('/bin/zsh', ['-c', spawn.args[1]], { env: { PATH: process.env.PATH ?? '', ...spawn.env }, encoding: 'utf8' })
    expect(out.trim()).toBe('feat/x; rm -rf ~ apps/web')
  })

  it('url: encodes values and only opens safe links', async () => {
    await runAction(act({ kind: 'url', scope: 'port', template: 'http://localhost:{port}/path?from={project.name}' }), { scope: 'port', projectId: 'p1', port: 3000 }, deps)
    expect(calls.urls.at(-1)).toBe('http://localhost:3000/path?from=apps%2Fweb')
    await expect(runAction(act({ kind: 'url', template: 'http://evil.example.com/{project.name}' }), { scope: 'project', projectId: 'p1' }, deps)).rejects.toThrow(/https/)
  })

  it('app: opens only paths inside added folders, with a validated app name', async () => {
    await runAction(act({ kind: 'app', app: 'Cursor', template: '{project.path}' }), { scope: 'project', projectId: 'p1' }, deps)
    expect(calls.apps.at(-1)).toEqual(['Cursor', root])
    await expect(runAction(act({ kind: 'app', app: 'Cursor', template: '/etc' }), { scope: 'project', projectId: 'p1' }, deps)).rejects.toThrow(/folders you added/)
    await expect(runAction(act({ kind: 'app', app: '-a evil', template: '{project.path}' }), { scope: 'project', projectId: 'p1' }, deps)).rejects.toThrow(/not valid/)
  })

  it("won't run an action in the wrong scope or with a missing value", async () => {
    await expect(runAction(act({ scope: 'port', template: 'echo {port}' }), { scope: 'project', projectId: 'p1' }, deps)).rejects.toThrow(/port action/)
    await expect(runAction(act({ scope: 'port', template: 'cd {project.path}' }), { scope: 'port', port: 3000 }, deps)).rejects.toThrow(/project\.path.*not known/)
  })

  it('preview describes what would happen, with values filled in', async () => {
    const p = await previewAction(act({ template: 'git -C {project.path} status', confirm: true }), { scope: 'project', projectId: 'p1' }, deps)
    expect(p).toMatchObject({ kind: 'shell', confirm: true })
    expect(p.summary).toBe(`Run: git -C ${root} status`)
  })
})
