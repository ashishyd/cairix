import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { CliError, parseEnvelope } from '../src/main/modules/changes/ai'
import { ChangesService } from '../src/main/modules/changes/service'
import { TOPIC_IDS } from '../src/main/modules/changes/learn'
import { AuditService } from '../src/main/modules/audit/service'
import { buildAuditPrompt, estimate, listProjectFiles, makeShards, MAX_TOTAL_BYTES, selectFiles, SHARD_BYTES } from '../src/main/modules/audit/files'
import type { AuditState } from '../src/shared/types'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-aud-')))
  dirs.push(d)
  return d
}
const sh = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' })
const write = (root: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
function repo(files: Record<string, string>): string {
  const root = tmp()
  sh(root, 'init', '-q', '-b', 'main')
  sh(root, 'config', 'user.email', 't@t')
  sh(root, 'config', 'user.name', 't')
  for (const [k, v] of Object.entries(files)) write(root, k, v)
  sh(root, 'add', '-A')
  sh(root, 'commit', '-q', '-m', 'init')
  return root
}

type Run = NonNullable<ConstructorParameters<typeof AuditService>[0]['run']>
function services(root: string, run: Run, over: { trusted?: boolean; concurrency?: number } = {}) {
  const dataDir = tmp()
  const project = () => ({ path: root, trusted: over.trusted ?? true })
  const changes = new ChangesService({ dataDir, project, detectClaude: async () => ({ installed: true }), run })
  const audit = new AuditService({
    dataDir, project, run, concurrency: over.concurrency,
    detectClaude: async () => ({ installed: true }),
    isDismissed: (p, f) => changes.isDismissed(p, f)
  })
  return { audit, changes }
}
async function finish(audit: AuditService, id = 'p', ms = 8000): Promise<AuditState> {
  const end = Date.now() + ms
  for (;;) {
    const s = audit.status(id)
    if (s.phase !== 'running') return s
    if (Date.now() > end) throw new Error('audit did not finish')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const OPTS = { categories: ['bugs' as const, 'security' as const] }
const reply = (findings: unknown[]) => ({ text: '', structured: { findings }, costUsd: 0.01 })

describe('file selection and sharding', () => {
  const f = (path: string, size = 1000) => ({ path, size })
  it('keeps source, skips lockfiles, minified, generated, d.ts, env, node_modules, empty and huge files', () => {
    const { chosen, total } = selectFiles([
      f('src/a.ts'), f('src/b.py'), f('pnpm-lock.yaml'), f('dist/x.js'), f('node_modules/p/i.js'), f('a.min.js'), f('types.d.ts'),
      f('.env.js'), f('README.md'), f('src/empty.ts', 0), f('src/huge.ts', 500_000), f('migrations/001.sql'), f('src/a.generated.ts'), f('x.snap')
    ])
    expect(chosen.map((x) => x.path)).toEqual(['src/a.ts', 'src/b.py'])
    expect(total).toBe(2)
  })
  it('puts application code before tests and stays inside the byte budget, reporting the true total', () => {
    const files = Array.from({ length: 30 }, (_, i) => f(`src/f${i}.ts`, 30_000)).concat([f('tests/t.test.ts', 100)])
    const { chosen, total } = selectFiles(files)
    expect(total).toBe(31)
    expect(chosen.reduce((n, x) => n + x.size, 0)).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
    expect(chosen.length).toBeLessThan(31)
    const { chosen: small } = selectFiles([f('tests/a.test.ts', 10), f('src/a.ts', 5000)])
    expect(small.map((x) => x.path)).toEqual(['src/a.ts', 'tests/a.test.ts'])
  })
  it('shards by size and the cost ceiling is requests × per-request cap', () => {
    const files = Array.from({ length: 10 }, (_, i) => f(`src/${i}.ts`, 15_000))
    const shards = makeShards(files)
    for (const s of shards) expect(s.reduce((n, x) => n + x.size, 0)).toBeLessThanOrEqual(SHARD_BYTES + 15_000)
    expect(shards.flat()).toHaveLength(10)
    const e = estimate(files, shards)
    expect(e.maxCostUsd).toBeCloseTo(shards.length * 0.15, 2)
    expect(e.tokens).toBeGreaterThan(40_000)
  })
})

describe('listProjectFiles', () => {
  it('lists git-visible files with repo-relative paths, honouring .gitignore and subfolders', async () => {
    const root = repo({ '.gitignore': 'secret.ts\n', 'apps/web/a.ts': 'x', 'apps/api/b.ts': 'y', 'apps/web/readme.md': 'z' })
    write(root, 'apps/web/new.ts', 'untracked')
    write(root, 'apps/web/secret.ts', 'ignored')
    const r = await listProjectFiles(join(root, 'apps/web'))
    expect(r.isRepo).toBe(true)
    expect(r.files.map((x) => x.path).sort()).toEqual(['apps/web/a.ts', 'apps/web/new.ts'])
  })
  it('falls back to a plain walk outside git', async () => {
    const root = tmp()
    write(root, 'a.ts', 'x'); write(root, 'node_modules/p/i.js', 'x'); write(root, 'src/b.py', 'y')
    const r = await listProjectFiles(root)
    expect(r.isRepo).toBe(false)
    expect(r.files.map((x) => x.path).sort()).toEqual(['a.ts', 'src/b.py'])
  })
})

describe('prompt', () => {
  it('numbers lines, masks credentials, lists only chosen categories and marks files as data', () => {
    const p = buildAuditPrompt([{ path: 'a.ts', content: "const k = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'\nx()" }], ['security'], TOPIC_IDS)
    expect(p).toContain('   2| x()')
    expect(p).not.toContain('sk-ant-api03')
    expect(p).toContain('security:')
    expect(p).not.toContain('accessibility:')
    expect(p).toContain('untrusted DATA')
  })
})

describe('AuditService', () => {
  const sources = { 'src/a.ts': 'export function a(q) {\n  return new RegExp(q)\n}\n', 'src/b.ts': 'export const b = 1\n' }

  it('plans before running: files, requests and a hard cost ceiling', async () => {
    const { audit } = services(repo(sources), async () => reply([]))
    const plan = await audit.plan('p', OPTS)
    expect(plan).toMatchObject({ isRepo: true, files: 2, totalFiles: 2, requests: 1, aiAvailable: true })
    expect(plan.maxCostUsd).toBe(0.15)
  })

  it('runs instant checks + AI, merges, drops hallucinated files and duplicates, and reports cost and progress', async () => {
    const root = repo({ ...sources, 'src/c.ts': 'debugger\n' })
    const { audit } = services(root, async () =>
      reply([
        { file: 'src/a.ts', line: 2, severity: 'warning', category: 'security', title: 'dup of instant regexp check', explanation: 'x' },
        { file: 'src/b.ts', line: 1, severity: 'error', category: 'bugs', title: 'Real bug', explanation: 'Because.', learnTopic: 'async' },
        { file: 'src/ghost.ts', line: 1, severity: 'error', category: 'bugs', title: 'Hallucinated', explanation: 'x' }
      ])
    )
    expect(['running', 'done']).toContain((await audit.start('p', OPTS)).phase)
    const s = await finish(audit)
    expect(s.phase).toBe('done')
    expect(s.progress).toEqual({ done: 1, total: 1 })
    const titles = s.findings.map((f) => f.title)
    expect(titles).toEqual(expect.arrayContaining(['Real bug', 'A RegExp is built from a variable', 'Leftover debugger statement']))
    expect(titles).not.toContain('Hallucinated')
    expect(titles).not.toContain('dup of instant regexp check')
    expect(s.findings.find((f) => f.title === 'Real bug')).toMatchObject({ origin: 'ai', learn: { source: 'MDN' } })
    expect(s.costUsd).toBe(0.01)
    expect(s.filesAnalyzed).toBe(3)
    expect(s.findings[0].severity).toBe('error') // sorted worst first
  })

  it('compares with the previous audit', async () => {
    const root = repo({ 'src/a.ts': 'export const a = 1\n' })
    const answers = [[{ file: 'src/a.ts', line: 1, severity: 'warning', category: 'bugs', title: 'Old issue', explanation: 'x' }], [{ file: 'src/a.ts', line: 1, severity: 'warning', category: 'bugs', title: 'New issue', explanation: 'x' }]]
    let n = 0
    const { audit } = services(root, async () => reply(answers[n++]))
    await audit.start('p', OPTS); expect((await finish(audit)).compared).toBeUndefined()
    await audit.start('p', OPTS)
    expect((await finish(audit)).compared).toMatchObject({ newCount: 1, fixedCount: 1 })
  })

  it('explains a signed-out Claude instead of reporting an empty audit', async () => {
    const { audit } = services(repo(sources), async () => parseEnvelope(JSON.stringify({ is_error: true, result: 'Failed to authenticate: OAuth session expired' })))
    await audit.start('p', OPTS)
    const s = await finish(audit)
    expect(s.phase).toBe('error')
    expect(s.error).toMatch(/not signed in.*claude auth login/i)
  })

  it('keeps going when some requests fail and says the result is partial', async () => {
    const big = (n: number) => `export const v${n} = "${'x'.repeat(30_000)}"\n`
    const root = repo({ 'src/1.ts': big(1), 'src/2.ts': big(2), 'src/3.ts': big(3) })
    let n = 0
    const { audit } = services(root, async () => {
      if (n++ === 0) throw new Error('boom')
      return reply([])
    }, { concurrency: 1 })
    await audit.start('p', OPTS)
    const s = await finish(audit)
    expect(s.phase).toBe('done')
    expect(s.failedRequests).toBe(1)
    expect(s.error).toMatch(/partial/)
    expect(s.progress.done).toBe(s.progress.total)
  })

  it('runs at most `concurrency` requests at once', async () => {
    const big = (n: number) => `export const v${n} = "${'x'.repeat(30_000)}"\n`
    const root = repo(Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`src/${i}.ts`, big(i)])))
    let live = 0, peak = 0
    const { audit } = services(root, async () => {
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 30))
      live--
      return reply([])
    }, { concurrency: 2 })
    await audit.start('p', OPTS)
    await finish(audit)
    expect(peak).toBe(2)
  })

  it('cancel stops in-flight requests promptly and starts no more', async () => {
    const big = (n: number) => `export const v${n} = "${'x'.repeat(30_000)}"\n`
    const root = repo(Object.fromEntries([1, 2, 3, 4].map((i) => [`src/${i}.ts`, big(i)])))
    let started = 0
    const { audit } = services(root, (o) => {
      started++
      return new Promise((_, reject) => o.signal!.addEventListener('abort', () => reject(new CliError('Cancelled.', 'cancelled'))))
    })
    await audit.start('p', OPTS)
    await new Promise((r) => setTimeout(r, 100))
    expect(audit.status('p').phase).toBe('running')
    audit.cancel('p')
    const s = await finish(audit)
    expect(s.phase).toBe('cancelled')
    expect(started).toBe(2) // the two in flight; the queued ones never started
  })

  it('refuses to run in an untrusted folder', async () => {
    const { audit } = services(repo(sources), async () => reply([]), { trusted: false })
    await expect(audit.start('p', OPTS)).rejects.toThrow(/Trust/)
  })

  it('dismissed findings disappear from the results and stay counted', async () => {
    const root = repo({ 'src/c.ts': 'debugger\n' })
    const { audit, changes } = services(root, async () => reply([]))
    await audit.start('p', OPTS)
    const first = await finish(audit)
    changes.dismissOnly('p', first.findings[0].id)
    const s = audit.status('p')
    expect(s.findings).toEqual([])
    expect(s.dismissedCount).toBe(1)
  })

  it('an audit finding can be fixed with the same preview → apply → undo flow', async () => {
    const root = repo({ 'src/c.ts': 'const a = 1\ndebugger\nconst b = 2\n' })
    const { audit, changes } = services(root, async () => reply([]))
    await audit.start('p', OPTS)
    const finding = (await finish(audit)).findings.find((f) => f.title === 'Leftover debugger statement')!
    const proposal = await changes.fixFinding('p', audit.find('p', finding.id)!)
    expect(proposal).toMatchObject({ by: 'quick-fix', files: ['src/c.ts'] })
    await changes.apply(proposal.id)
    expect(readFileSync(join(root, 'src/c.ts'), 'utf8')).toBe('const a = 1\nconst b = 2\n')
    await changes.undo(proposal.id)
    expect(readFileSync(join(root, 'src/c.ts'), 'utf8')).toBe('const a = 1\ndebugger\nconst b = 2\n')
  })
})
