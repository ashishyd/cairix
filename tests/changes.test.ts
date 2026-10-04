import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { buildReviewPrompt, CliError, diffForAi, parseEnvelope, parseReview } from '../src/main/modules/changes/ai'
import { quickFixPatch, runChecks } from '../src/main/modules/changes/checks'
import { parseDiff } from '../src/main/modules/changes/diff'
import { parseStatus, readChanges } from '../src/main/modules/changes/git'
import { isAllowedUrl, learnFor, TOPICS } from '../src/main/modules/changes/learn'
import { ChangesService } from '../src/main/modules/changes/service'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-chg-')))
  dirs.push(d)
  return d
}
const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })
const write = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

function repo(files: Record<string, string> = { 'src/a.ts': 'export const a = 1\n' }): string {
  const root = tmp()
  sh(root, 'init', '-q', '-b', 'main')
  sh(root, 'config', 'user.email', 't@t')
  sh(root, 'config', 'user.name', 't')
  for (const [k, v] of Object.entries(files)) write(root, k, v)
  sh(root, 'add', '-A')
  sh(root, 'commit', '-q', '-m', 'init')
  return root
}

function service(root: string, over: Partial<ConstructorParameters<typeof ChangesService>[0]> = {}): ChangesService {
  return new ChangesService({
    dataDir: tmp(),
    project: () => ({ path: root, trusted: true }),
    detectClaude: async () => ({ installed: true, version: 'fake' }),
    ...over
  })
}

describe('diff + status parsing', () => {
  it('collects added lines with their new line numbers', () => {
    const d = parseDiff(
      ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -1,2 +1,4 @@', ' keep', '+one', ' keep2', '+two', '-gone'].join('\n')
    )
    expect(d[0].added).toEqual([{ line: 2, text: 'one' }, { line: 4, text: 'two' }])
    expect(d[0]).toMatchObject({ additions: 2, deletions: 1, path: 'x.ts' })
  })

  it('parses porcelain v2 status including untracked and renames', () => {
    const out = ['# branch.head main', '1 .M N... 100644 100644 100644 a b src/a.ts', '1 A. N... 000000 100644 100644 a b new file.ts', '2 R. N... 100644 100644 100644 a b R100 new.ts', 'old.ts', '? scratch.txt', ''].join('\0')
    const s = parseStatus(out)
    expect(s.branch).toBe('main')
    expect(s.entries).toEqual([
      { path: 'src/a.ts', status: 'M', staged: false },
      { path: 'new file.ts', status: 'A', staged: true },
      { path: 'new.ts', status: 'R', staged: true },
      { path: 'scratch.txt', status: '?', staged: false }
    ])
  })
})

describe('instant checks', () => {
  const check = (path: string, ...lines: string[]) =>
    runChecks([{ path, added: lines.map((text, i) => ({ line: i + 1, text })), additions: lines.length, deletions: 0, binary: false, isNew: false }])

  it.each([
    ['a.ts', 'debugger', 'Leftover debugger statement'],
    ['a.ts', "  it.only('works', () => {})", 'A focused test (.only) will silently skip the rest'],
    ['a.ts', 'const r = eval(code)', 'eval() runs arbitrary code'],
    ['a.ts', 'const re = new RegExp(userInput)', 'A RegExp is built from a variable'],
    ['a.tsx', 'el.innerHTML = html', 'Raw HTML is inserted into the page'],
    ['a.ts', 'console.log(user)', 'console.log left in the code'],
    ['a.ts', 'const x: any = 1', 'The any type turns off type checking'],
    ['a.py', 'except:', 'A bare except hides every error'],
    ['a.py', 'subprocess.run(cmd, shell=True)', 'subprocess with shell=True can run injected commands'],
    ['a.py', "requests.get(u, verify=False)", 'TLS certificate checking is turned off'],
    ['a.ts', '<<<<<<< HEAD', 'Unresolved merge conflict marker'],
    ['a.ts', "const k = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'", 'A credential looks like it is hard-coded here'],
    ['a.ts', 'const password = "Tr0ub4dor&3xyzabcd12"', 'A credential looks like it is hard-coded here']
  ])('%s: %s', (path, line, title) => {
    const f = check(path, line)
    expect(f.map((x) => x.title)).toEqual([title])
  })

  it('does not flag placeholders, env lookups, comments or look-alikes', () => {
    expect(check('a.ts', 'const key = process.env.API_KEY', '// debugger', "const token = 'your_token_here_please'", 'const re = new RegExp("^a+$")', 'const re2 = new RegExp(escapeRegExp(q))', 'evaluate(x)', 'myeval(x)', "const tokenUrl = 'https://auth.example.com/oauth/token/endpoint'", "const authors = 'abcdefghijklmnop'", "const secretPath = './secrets/file.json'")).toEqual([])
    expect(check('a.test.ts', 'console.log(x)')).toEqual([]) // tests may log
    expect(check('a.py', 'debugger')).toEqual([]) // JS rule only on JS files
  })

  it('flags a committed .env file but not .env.example', () => {
    const file = (path: string) => [{ path, added: [{ line: 1, text: 'A=1' }], additions: 1, deletions: 0, binary: false, isNew: true }]
    expect(runChecks(file('.env.local')).map((f) => f.title)).toEqual(['An .env file is about to be committed'])
    expect(runChecks(file('.env.example'))).toEqual([])
  })

  it('gives stable ids so dismissals persist, and attaches a learn link', () => {
    const a = check('a.ts', 'debugger')[0]
    expect(check('a.ts', 'debugger')[0].id).toBe(a.id)
    expect(a.learn?.url).toMatch(/^https:\/\/developer\.mozilla\.org/)
    expect(a.learn?.source).toBe('MDN')
  })
})

describe('learn registry', () => {
  it('every link is https on an allow-listed documentation site', () => {
    for (const [id, link] of Object.entries(TOPICS)) {
      expect(isAllowedUrl(link.url), id).toBe(true)
      expect(link.source, id).not.toBe('')
    }
  })
  it('rejects anything not in the registry or off the allow-list', () => {
    expect(learnFor('made-up-topic')).toBeUndefined()
    expect(isAllowedUrl('http://owasp.org/x')).toBe(false)
    expect(isAllowedUrl('https://evil.example.com/x')).toBe(false)
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('against a real git repo', () => {
  it('reads changes scoped to the project folder, including untracked files', async () => {
    const root = repo({ 'apps/web/a.ts': 'x\n', 'apps/api/b.ts': 'y\n' })
    write(root, 'apps/web/a.ts', 'x\ndebugger\n')
    write(root, 'apps/api/b.ts', 'y\nconsole.log(1)\n')
    write(root, 'apps/web/new.ts', 'eval(x)\n')
    const web = await readChanges(join(root, 'apps/web'))
    expect(web.top).toBe(root)
    expect(web.entries.map((e) => e.path).sort()).toEqual(['apps/web/a.ts', 'apps/web/new.ts'])
    expect(runChecks(web.files).map((f) => f.title).sort()).toEqual(['Leftover debugger statement', 'eval() runs arbitrary code'])
  })

  it('fingerprint changes when the diff changes and not otherwise', async () => {
    const root = repo()
    write(root, 'src/a.ts', 'export const a = 2\n')
    const f1 = (await readChanges(root)).fingerprint
    expect((await readChanges(root)).fingerprint).toBe(f1)
    write(root, 'src/a.ts', 'export const a = 3\n')
    expect((await readChanges(root)).fingerprint).not.toBe(f1)
  })

  it('reports a non-repo and a clean repo without failing', async () => {
    expect((await readChanges(tmp())).isRepo).toBe(false)
    const clean = await readChanges(repo())
    expect(clean).toMatchObject({ isRepo: true, files: [], entries: [] })
  })

  it('instant fix: previews a patch, applies it, and undo restores the file byte-for-byte', async () => {
    const root = repo({ 'src/a.ts': 'const a = 1\n' })
    const original = 'const a = 1\ndebugger\nit.only("x", () => {})\nconst b = 2\n'
    write(root, 'src/a.ts', original)
    const svc = service(root)
    const state = await svc.get('p')
    expect(state.findings.map((f) => f.title)).toEqual(expect.arrayContaining(['Leftover debugger statement', 'A focused test (.only) will silently skip the rest']))
    expect(state.findings.every((f) => f.quickFix)).toBe(true)

    const dbg = state.findings.find((f) => f.title.includes('debugger'))!
    const proposal = await svc.fix('p', dbg.id)
    expect(proposal).toMatchObject({ by: 'quick-fix', applied: false, files: ['src/a.ts'] })
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(original) // preview changed nothing

    await svc.apply(proposal.id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('const a = 1\nit.only("x", () => {})\nconst b = 2\n')

    const only = (await svc.get('p')).findings.find((f) => f.title.includes('.only'))!
    await svc.apply((await svc.fix('p', only.id)).id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('const a = 1\nit("x", () => {})\nconst b = 2\n')

    // Undoing the first fix is a pure insertion, so it still applies cleanly even though another line changed since.
    await svc.undo(proposal.id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('const a = 1\ndebugger\nit("x", () => {})\nconst b = 2\n')
  })

  it('undo restores the exact original when nothing else changed', async () => {
    const root = repo({ 'src/a.ts': 'const a = 1\n' })
    const original = 'const a = 1\ndebugger\n'
    write(root, 'src/a.ts', original)
    const svc = service(root)
    const f = (await svc.get('p')).findings[0]
    const p = await svc.fix('p', f.id)
    await svc.apply(p.id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).not.toBe(original)
    expect((await svc.undo(p.id)).applied).toBe(false)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(original)
  })

  it('refuses to apply a fix if the file changed since the review', async () => {
    const root = repo({ 'src/a.ts': 'const a = 1\n' })
    write(root, 'src/a.ts', 'const a = 1\ndebugger\n')
    const svc = service(root)
    const f = (await svc.get('p')).findings[0]
    const p = await svc.fix('p', f.id)
    write(root, 'src/a.ts', 'const a = 1\nsomething else entirely\n') // user edited meanwhile
    await expect(svc.apply(p.id)).rejects.toThrow(/no longer applies/)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('const a = 1\nsomething else entirely\n')
  })

  it('dismissals persist across service restarts', async () => {
    const root = repo({ 'src/a.ts': 'a\n' })
    write(root, 'src/a.ts', 'a\ndebugger\n')
    const dataDir = tmp()
    const s1 = service(root, { dataDir })
    const f = (await s1.get('p')).findings[0]
    const after = await s1.dismiss('p', f.id)
    expect(after.findings).toEqual([])
    expect(after.dismissedCount).toBe(1)
    expect((await service(root, { dataDir }).get('p')).findings).toEqual([])
  })

  it('will not prepare a fix in an untrusted folder', async () => {
    const root = repo({ 'src/a.ts': 'a\n' })
    write(root, 'src/a.ts', 'a\ndebugger\n')
    const svc = service(root, { project: () => ({ path: root, trusted: false }) })
    const f = (await svc.get('p')).findings[0]
    await expect(svc.fix('p', f.id)).rejects.toThrow(/Trust/)
  })
})

describe('overview across projects', () => {
  it('lists only trusted git projects with uncommitted work, worst first, without calling the AI', async () => {
    const clean = repo({ 'a.ts': 'x\n' })
    const dirty = repo({ 'a.ts': 'x\n' }); write(dirty, 'a.ts', 'x\ndebugger\n')
    const bad = repo({ 'a.ts': 'x\n' }); write(bad, 'a.ts', "x\nconst k = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'\n")
    const untrusted = repo({ 'a.ts': 'x\n' }); write(untrusted, 'a.ts', 'x\ndebugger\n')
    let aiCalls = 0
    const svc = new ChangesService({
      dataDir: tmp(), project: () => undefined, detectClaude: async () => ({ installed: true }),
      run: async () => (aiCalls++, { text: '' }),
      allProjects: () => [
        { id: 'clean', name: 'clean', path: clean, hasGit: true, trusted: true },
        { id: 'dirty', name: 'dirty', path: dirty, hasGit: true, trusted: true },
        { id: 'bad', name: 'bad', path: bad, hasGit: true, trusted: true },
        { id: 'nogit', name: 'nogit', path: tmp(), hasGit: false, trusted: true },
        { id: 'untrusted', name: 'untrusted', path: untrusted, hasGit: true, trusted: false }
      ]
    })
    const o = await svc.overview()
    expect(o.map((x) => [x.name, x.files, x.errors, x.warnings])).toEqual([['bad', 1, 1, 0], ['dirty', 1, 0, 1]])
    expect(aiCalls).toBe(0)
  })

  it('counts a repository once even when several nested projects live in it', async () => {
    const root = repo({ 'apps/web/a.ts': 'x\n', 'apps/api/b.ts': 'y\n' })
    write(root, 'apps/web/a.ts', 'x\ndebugger\n'); write(root, 'apps/api/b.ts', 'y\ndebugger\n')
    const svc = new ChangesService({
      dataDir: tmp(), project: () => undefined, detectClaude: async () => ({ installed: true }),
      allProjects: () => [
        { id: 'root', name: 'mono', path: root, hasGit: true, trusted: true },
        { id: 'web', name: 'apps/web', path: join(root, 'apps/web'), hasGit: true, trusted: true }
      ]
    })
    const o = await svc.overview()
    expect(o.map((x) => x.name)).toEqual(['mono'])
    expect(o[0].files).toBe(2)
  })
})

describe('AI review (fake Claude)', () => {
  const fakeReview = (findings: unknown[]) => async () => ({ text: '', structured: { findings }, costUsd: 0.002 })

  it('validates output: unknown files dropped, bad topics get no link, duplicates of instant checks removed', async () => {
    const root = repo({ 'src/a.ts': 'x\n' })
    write(root, 'src/a.ts', 'x\nconst re = new RegExp(q)\nawait save()\n')
    const svc = service(root, {
      run: fakeReview([
        { file: 'src/a.ts', line: 2, severity: 'warning', category: 'security', title: 'dup of regexp check', explanation: 'x' },
        { file: 'src/a.ts', line: 3, severity: 'error', category: 'bug', title: 'Unhandled rejection', explanation: 'save() may reject.', learnTopic: 'async' },
        { file: 'src/a.ts', line: 3, severity: 'info', category: 'bug', title: 'Made-up link', explanation: 'x', learnTopic: 'not-a-topic' },
        { file: 'src/other.ts', line: 1, severity: 'error', category: 'bug', title: 'Hallucinated file', explanation: 'x' }
      ])
    })
    const state = await svc.review('p')
    const titles = state.findings.map((f) => f.title)
    expect(titles).toContain('Unhandled rejection')
    expect(titles).not.toContain('Hallucinated file')
    expect(titles).not.toContain('dup of regexp check')
    expect(state.findings.find((f) => f.title === 'Unhandled rejection')).toMatchObject({ origin: 'ai', quickFix: false, learn: { source: 'MDN' } })
    expect(state.findings.find((f) => f.title === 'Made-up link')!.learn).toBeUndefined()
    expect(state.ai).toMatchObject({ reviewed: true, reviewing: false, costUsd: 0.002 })
  })

  it('a not-signed-in Claude is reported clearly and keeps the instant checks', async () => {
    const root = repo({ 'src/a.ts': 'x\n' })
    write(root, 'src/a.ts', 'x\ndebugger\n')
    const svc = service(root, { run: async () => parseEnvelope(JSON.stringify({ is_error: true, result: 'Failed to authenticate: OAuth session expired' })) })
    const state = await svc.review('p')
    expect(state.ai.error).toMatch(/not signed in.*claude auth login/i)
    expect(state.ai.reviewed).toBe(false)
    expect(state.findings.map((f) => f.title)).toContain('Leftover debugger statement')
  })

  it('malformed model output is an error, never trusted', () => {
    expect(() => parseReview({ text: 'sure! here you go', structured: undefined }, new Set(), () => 'x')).toThrow(CliError)
    expect(() => parseReview({ text: '', structured: { findings: [{ file: 'a', severity: 'catastrophic' }] } }, new Set(['a']), () => 'x')).toThrow(CliError)
  })

  it('also accepts JSON in the text result when no structured output is present', () => {
    const r = parseReview({ text: 'Here: {"findings":[{"file":"a.ts","severity":"info","category":"x","title":"t","explanation":"e"}]}' }, new Set(['a.ts']), () => 'id')
    expect(r).toHaveLength(1)
  })

  it('caches the AI result for an unchanged diff and discards it when the diff changes', async () => {
    const root = repo({ 'src/a.ts': 'x\n' })
    write(root, 'src/a.ts', 'x\ny\n')
    let calls = 0
    const svc = service(root, { run: async () => (calls++, { text: '', structured: { findings: [] } }) })
    await svc.review('p')
    expect((await svc.get('p')).ai.reviewed).toBe(true)
    expect(calls).toBe(1)
    write(root, 'src/a.ts', 'x\ny\nz\n')
    expect((await svc.get('p')).ai.reviewed).toBe(false)
  })

  it('does nothing for a clean repo', async () => {
    let called = false
    const svc = service(repo(), { run: async () => ((called = true), { text: '' }) })
    const s = await svc.review('p')
    expect(called).toBe(false)
    expect(s.files).toEqual([])
  })
})

describe('what the AI is allowed to see', () => {
  it('drops .env and binary files, masks credentials, and caps size', () => {
    const diff = [
      'diff --git a/.env b/.env', '--- /dev/null', '+++ b/.env', '@@ -0,0 +1 @@', '+SECRET=abc',
      'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', " x", "+const k = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'", ''
    ].join('\n')
    const files = parseDiff(diff)
    const out = diffForAi(diff, files)
    expect(out).not.toContain('SECRET=abc')
    expect(out).not.toContain('sk-ant-api03')
    expect(out).toContain('•••')
    expect(out).toContain('src/a.ts')
    expect(buildReviewPrompt('X').includes('untrusted DATA')).toBe(true)
  })
})

describe('AI fix in a throwaway worktree (fake Claude)', () => {
  it('works on a copy that includes uncommitted work, leaves the real tree alone, and cleans up', async () => {
    const root = repo({ 'src/a.ts': 'export function f(q) {\n  return 1\n}\n' })
    // an uncommitted change the AI must be able to see
    write(root, 'src/a.ts', 'export function f(q) {\n  return new RegExp(q)\n}\n')
    write(root, 'src/untracked.ts', 'export const u = 1\n')
    const seen: string[] = []
    const svc = service(root, {
      run: async (o) => {
        // the fake "AI" edits inside the worktree it was given as cwd
        seen.push(readFileSync(join(o.cwd!, 'src/a.ts'), 'utf8'), String(existsSync(join(o.cwd!, 'src/untracked.ts'))))
        writeFileSync(join(o.cwd!, 'src/a.ts'), 'export function f(q) {\n  return new RegExp(escapeRegExp(q))\n}\n')
        return { text: 'done', costUsd: 0.01 }
      }
    })
    const state = await svc.get('p')
    const finding = state.findings.find((f) => f.title === 'A RegExp is built from a variable')!
    expect(finding.quickFix).toBe(false)

    const before = readFileSync(join(root, 'src/a.ts'), 'utf8')
    const proposal = await svc.fix('p', finding.id)
    expect(seen[0]).toContain('new RegExp(q)') // saw the uncommitted edit
    expect(seen[1]).toBe('true') // and the untracked file
    expect(proposal).toMatchObject({ by: 'claude', costUsd: 0.01, files: ['src/a.ts'] })
    expect(proposal.patch).toContain('+  return new RegExp(escapeRegExp(q))')
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(before) // nothing applied yet
    expect(sh(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1) // worktree removed

    await svc.apply(proposal.id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toContain('escapeRegExp(q)')
    await svc.undo(proposal.id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(before)
    expect(sh(root, 'log', '--oneline').trim().split('\n')).toHaveLength(1) // no commits added to the user's repo
    expect(sh(root, 'branch', '--list').trim()).toBe('* main')
  })

  it('keeps files the AI CREATES: a plain git diff would silently drop them', async () => {
    const root = repo({ 'src/a.ts': 'x\n' })
    write(root, 'src/a.ts', 'x\nconst re = new RegExp(q)\n')
    const svc = service(root, {
      run: async (o) => {
        writeFileSync(join(o.cwd!, 'src/a.test.ts'), 'test("escapes", () => {})\n') // a brand-new file
        return { text: 'added a test' }
      }
    })
    const f = (await svc.get('p')).findings.find((x) => x.title === 'A RegExp is built from a variable')!
    const proposal = await svc.fix('p', f.id)
    expect(proposal.files).toEqual(['src/a.test.ts'])
    await svc.apply(proposal.id)
    expect(readFileSync(join(root, 'src/a.test.ts'), 'utf8')).toContain('escapes')
  })

  it('reports "no change" instead of an empty patch, and still cleans up', async () => {
    const root = repo({ 'src/a.ts': 'x\n' })
    write(root, 'src/a.ts', 'x\nconst re = new RegExp(q)\n')
    const svc = service(root, { run: async () => ({ text: 'nothing to do' }) })
    const f = (await svc.get('p')).findings[0]
    await expect(svc.fix('p', f.id)).rejects.toThrow(/did not change anything/)
    expect(sh(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
  })

  it('quick-fix patches really apply with git', () => {
    const root = repo({ 'a.ts': 'x\n' })
    write(root, 'a.ts', 'x\ndebugger\n')
    const f = runChecks([{ path: 'a.ts', added: [{ line: 2, text: 'debugger' }], additions: 1, deletions: 0, binary: false, isNew: false }])[0]
    const patch = quickFixPatch('a.ts', 2, 'debugger', f)!
    execFileSync('git', ['apply', '--unidiff-zero', '--check'], { cwd: root, input: patch })
  })
})
