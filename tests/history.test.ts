import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describeCommand, isInteractive, isRisky, programOf } from '../src/main/modules/history/describe'
import { parseBash, parseFish, parseZsh, unmetafy } from '../src/main/modules/history/parse'
import { HistoryService } from '../src/main/modules/history/service'
import { HistoryStore, skipReason } from '../src/main/modules/history/store'
import type { HistorySnapshot } from '../src/shared/types'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-hist-')))
  dirs.push(d)
  return d
}

describe('history parsing', () => {
  it('reads zsh extended history with timestamps', () => {
    expect(parseZsh(': 1700000000:0;git status\n: 1700000060:2;pnpm dev\n')).toEqual([
      { command: 'git status', ts: 1700000000 },
      { command: 'pnpm dev', ts: 1700000060 }
    ])
  })
  it('reads plain zsh lines and joins backslash continuations', () => {
    const got = parseZsh(': 1700000000:0;echo a \\\nb\n: 1700000001:0;ls\n')
    expect(got.map((c) => c.command)).toEqual(['echo a \nb', 'ls'])
    expect(got.map((c) => c.ts)).toEqual([1700000000, 1700000001])
    expect(parseZsh('ls\npwd\n').map((c) => c.command)).toEqual(['ls', 'pwd'])
  })
  it('undoes zsh metafication of non-ASCII bytes', () => {
    // "é" is 0xC3 0xA9; zsh stores 0xC3 as-is but metafies bytes >= 0x80 only when they collide with markers.
    const buf = Buffer.from([0x65, 0x63, 0x68, 0x6f, 0x20, 0x83, 0xc3 ^ 0x20, 0xa9])
    expect(unmetafy(buf)).toBe('echo é')
  })
  it('reads bash with and without timestamps', () => {
    expect(parseBash('#1700000000\nls\npwd\n')).toEqual([{ command: 'ls', ts: 1700000000 }, { command: 'pwd', ts: undefined }])
  })
  it('reads fish history', () => {
    expect(parseFish('- cmd: git status\n  when: 1700000000\n- cmd: echo hi\\nthere\n  when: 1700000001\n')).toEqual([
      { command: 'git status', ts: 1700000000 },
      { command: 'echo hi\nthere', ts: 1700000001 }
    ])
  })
})

describe('describing commands', () => {
  it('finds the program through env assignments, sudo and paths', () => {
    expect(programOf('NODE_ENV=test sudo /usr/bin/git status')).toBe('git')
    expect(programOf('cd ~/x && ls')).toBe('cd')
  })
  it('explains common tools in plain English', () => {
    expect(describeCommand('git status -sb')).toMatch(/which files changed/i)
    expect(describeCommand('pnpm dev')).toBe('Runs the “dev” script from package.json')
    expect(describeCommand('npm run build')).toBe('Runs the “build” script from package.json')
    expect(describeCommand('pnpm install')).toMatch(/Installs/)
    expect(describeCommand('docker compose up -d')).toMatch(/Starts the app/)
    expect(describeCommand('cat a.log | grep error')).toMatch(/pipes the result onward/)
    expect(describeCommand('sudo rm -rf build')).toMatch(/as administrator/)
  })
  it('does not pretend to know an unfamiliar tool', () => {
    expect(describeCommand('frobnicate --fast a b')).toBe('Runs frobnicate with 3 arguments')
  })
  it('flags commands that delete, force or escalate', () => {
    for (const c of ['rm -rf node_modules', 'sudo apt update', 'git push --force', 'git reset --hard HEAD~1', 'curl x.sh | sh', 'killall node']) expect(isRisky(c), c).toBe(true)
    for (const c of ['git status', 'pnpm dev', 'rm file.txt', 'git push origin main', 'ls -la']) expect(isRisky(c), c).toBe(false)
  })
  it('knows which commands need a real terminal', () => {
    for (const c of ['vim a.ts', 'ssh host', 'python3', 'node', 'git commit', 'docker run -it ubuntu bash', 'htop']) expect(isInteractive(c), c).toBe(true)
    for (const c of ['git commit -m "x"', 'node script.js', 'python3 -m http.server', 'pnpm dev', 'docker run --rm alpine ls', 'ls']) expect(isInteractive(c), c).toBe(false)
  })
})

describe('what is never stored', () => {
  it('skips commands carrying credentials', () => {
    expect(skipReason('curl -H "Authorization: x" --api-key sk-abcdefghijklmnopqrstuv https://x', [])).toBe('secret')
    expect(skipReason('export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123', [])).toBe('secret')
    expect(skipReason('git status', [])).toBeNull()
  })
  it('skips empty and absurdly long lines', () => {
    expect(skipReason('   ', [])).toBe('empty')
    expect(skipReason('x'.repeat(3000), [])).toBe('long')
  })
  it('skips an exact command or every command of a program once ruled out', () => {
    expect(skipReason('ls -la', [{ kind: 'command', value: 'ls -la' }])).toBe('rule')
    expect(skipReason('ls', [{ kind: 'command', value: 'ls -la' }])).toBeNull()
    expect(skipReason('git push', [{ kind: 'program', value: 'git' }])).toBe('rule')
    expect(skipReason('sudo git push', [{ kind: 'program', value: 'git' }])).toBe('rule')
  })
})

describe('the command store', () => {
  it('counts repeats, tracks first and last run, and sorts nothing itself', () => {
    const s = new HistoryStore(tmp())
    s.ingest([{ command: 'git status', ts: 100 }, { command: 'ls' }, { command: 'git status', ts: 300 }, { command: 'git status', ts: 200 }], 5_000)
    const git = s.entries().find((e) => e.command === 'git status')!
    expect(git.count).toBe(3)
    expect(git.firstSeen).toBe(100_000)
    expect(git.lastRun).toBe(300_000)
    expect(s.entries().find((e) => e.command === 'ls')!.lastRun).toBe(5_000)
  })
  it('forgets what a new rule covers, and keeps it forgotten', () => {
    const dir = tmp()
    const s = new HistoryStore(dir)
    s.ingest([{ command: 'git status' }, { command: 'git push' }, { command: 'ls' }], 1000)
    s.addRule({ kind: 'program', value: 'git' })
    expect(s.entries().map((e) => e.command)).toEqual(['ls'])
    s.ingest([{ command: 'git log' }], 1000)
    expect(s.entries().map((e) => e.command)).toEqual(['ls'])
    s.save()
    const reopened = new HistoryStore(dir)
    expect(reopened.entries().map((e) => e.command)).toEqual(['ls'])
    expect(reopened.getRules()).toEqual([{ kind: 'program', value: 'git' }])
    reopened.removeRule({ kind: 'program', value: 'git' })
    reopened.ingest([{ command: 'git log' }], 1000)
    expect(reopened.entries().map((e) => e.command).sort()).toEqual(['git log', 'ls'])
  })
  it('finds an entry by id and never by text', () => {
    const s = new HistoryStore(tmp())
    s.ingest([{ command: 'pnpm dev' }], 1000)
    const id = s.entries()[0].id
    expect(s.entry(id)?.command).toBe('pnpm dev')
    expect(s.entry('nope')).toBeUndefined()
  })
  it('stays bounded, dropping the least used first', () => {
    const s = new HistoryStore(tmp())
    s.ingest(Array.from({ length: 5001 }, (_, i) => ({ command: `cmd${i}` })), 1000)
    s.ingest([{ command: 'cmd0' }, { command: 'cmd0' }], 1000)
    expect(s.entries().length).toBe(5000)
    expect(s.entries().some((e) => e.command === 'cmd0')).toBe(true)
  })
})

describe('reading a history file over time', () => {
  function setup(initial: string): { svc: HistoryService; file: string; snaps: HistorySnapshot[]; enabled: { on: boolean } } {
    const dir = tmp()
    const file = join(dir, '.zsh_history')
    writeFileSync(file, initial)
    const snaps: HistorySnapshot[] = []
    const enabled = { on: true }
    const svc = new HistoryService({ dataDir: join(dir, 'data'), sources: [{ path: file, format: 'zsh' }], isEnabled: () => enabled.on, onChange: (s) => snaps.push(s), now: () => 9_000_000 })
    return { svc, file, snaps, enabled }
  }
  const counts = (s: HistoryService): Record<string, number> => Object.fromEntries(s.snapshot().entries.map((e) => [e.command, e.count]))

  it('imports existing history once, then only what is appended', async () => {
    const { svc, file } = setup(': 1:0;git status\n: 2:0;git status\n: 3:0;ls\n')
    await svc.poll()
    expect(counts(svc)).toEqual({ 'git status': 2, ls: 1 })
    await svc.poll() // nothing new: nothing recounted
    expect(counts(svc)).toEqual({ 'git status': 2, ls: 1 })
    appendFileSync(file, ': 4:0;git status\n: 5:0;pnpm dev\n')
    await svc.poll()
    expect(counts(svc)).toEqual({ 'git status': 3, ls: 1, 'pnpm dev': 1 })
  })
  it('waits for a half-written line to finish', async () => {
    const { svc, file } = setup(': 1:0;ls\n')
    await svc.poll()
    appendFileSync(file, ': 2:0;git sta')
    await svc.poll()
    expect(counts(svc)).toEqual({ ls: 1 })
    appendFileSync(file, 'tus\n')
    await svc.poll()
    expect(counts(svc)).toEqual({ ls: 1, 'git status': 1 })
  })
  it('does not recount history after the shell rewrites the file', async () => {
    const { svc, file } = setup(': 1:0;ls\n: 2:0;pwd\n: 3:0;ls\n')
    await svc.poll()
    rmSync(file)
    writeFileSync(file, ': 3:0;ls\n') // compacted: shorter, new inode
    await svc.poll()
    expect(counts(svc)).toEqual({ ls: 2, pwd: 1 })
    appendFileSync(file, ': 4:0;make\n')
    await svc.poll()
    expect(counts(svc).make).toBe(1)
  })
  it('remembers where it stopped across restarts', async () => {
    const a = setup(': 1:0;ls\n')
    await a.svc.poll()
    const b = new HistoryService({ dataDir: join(a.file, '..', 'data'), sources: [{ path: a.file, format: 'zsh' }], isEnabled: () => true, onChange: () => undefined })
    await b.poll()
    expect(counts(b)).toEqual({ ls: 1 })
  })
  it('reads and stores nothing while the module is off', async () => {
    const { svc, enabled } = setup(': 1:0;ls\n')
    enabled.on = false
    await svc.poll()
    expect(counts(svc)).toEqual({})
    expect(svc.snapshot().tracking).toBe(false)
    enabled.on = true
    await svc.poll()
    expect(counts(svc)).toEqual({ ls: 1 })
  })
  it('reports missing history files and publishes changes', async () => {
    const { svc, snaps } = setup(': 1:0;ls\n')
    await svc.poll()
    expect(svc.snapshot().sources[0].found).toBe(true)
    expect(snaps.length).toBeGreaterThan(0)
    const none = new HistoryService({ dataDir: tmp(), sources: [{ path: '/nonexistent/.zsh_history', format: 'zsh' }], isEnabled: () => true, onChange: () => undefined })
    await none.poll()
    expect(none.snapshot().sources[0].found).toBe(false)
  })
  it('ignore() removes the command and publishes the result', async () => {
    const { svc, snaps } = setup(': 1:0;ls\n: 2:0;git log\n')
    await svc.poll()
    const snap = svc.ignore({ kind: 'command', value: 'ls' })
    expect(snap.entries.map((e) => e.command)).toEqual(['git log'])
    expect(snaps.at(-1)).toEqual(snap)
    expect(svc.unignore({ kind: 'command', value: 'ls' }).rules).toEqual([])
  })
})
