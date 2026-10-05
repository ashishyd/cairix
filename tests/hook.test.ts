import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { addBlock, BLOCK_END, BLOCK_START, hasBlock, hookScript, installHook, parseHookLog, removeHook, stripBlock } from '../src/main/modules/history/hook'
import { HistoryService } from '../src/main/modules/history/service'
import { HistoryStore } from '../src/main/modules/history/store'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "cairix hook-")))
  dirs.push(d)
  return d
}

describe('the .zshrc block', () => {
  it('adds one clearly marked block and is idempotent', () => {
    const once = addBlock('export A=1\n', '/x/hook.zsh')
    expect(once).toContain(BLOCK_START)
    expect(once.startsWith('export A=1\n')).toBe(true)
    expect(addBlock(once, '/x/hook.zsh')).toBe(once)
    expect(once.split(BLOCK_START)).toHaveLength(2)
  })
  it('removes exactly its own block and nothing else', () => {
    const rc = 'export A=1\nalias g=git\n'
    expect(stripBlock(addBlock(rc, '/x/hook.zsh'))).toBe(rc)
    expect(stripBlock(rc)).toBe(rc)
    const between = `before\n${BLOCK_START}\nsource x\n${BLOCK_END}\nafter\n`
    expect(stripBlock(between)).toBe('before\nafter\n')
  })
  it('works on an empty or newline-less file', () => {
    expect(hasBlock(addBlock('', '/h'))).toBe(true)
    expect(addBlock('no newline', '/h').startsWith('no newline\n')).toBe(true)
  })
  it('quotes a hook path that has spaces', () => {
    expect(addBlock('', '/Users/me/Library/Application Support/Cairix/hook.zsh')).toContain("source '/Users/me/Library/Application Support/Cairix/hook.zsh'")
  })
})

describe('installing the hook', () => {
  function paths() {
    const home = tmp()
    return { home, p: { rcFile: join(home, '.zshrc'), hookPath: join(home, 'data dir', 'shell', 'cairix-hook.zsh'), logPath: join(home, 'data dir', 'shell', 'commands.log') } }
  }
  it('writes the hook, backs up .zshrc once, and can be undone', () => {
    const { p } = paths()
    writeFileSync(p.rcFile, 'export A=1\n')
    installHook(p)
    installHook(p)
    expect(existsSync(p.hookPath)).toBe(true)
    expect(readFileSync(`${p.rcFile}.cairix-backup`, 'utf8')).toBe('export A=1\n')
    expect(readFileSync(p.rcFile, 'utf8').split(BLOCK_START)).toHaveLength(2)
    removeHook(p)
    expect(readFileSync(p.rcFile, 'utf8')).toBe('export A=1\n')
  })
  it('works when there is no .zshrc yet', () => {
    const { p } = paths()
    installHook(p)
    expect(hasBlock(readFileSync(p.rcFile, 'utf8'))).toBe(true)
    expect(existsSync(`${p.rcFile}.cairix-backup`)).toBe(false)
  })
})

describe('the hook itself, in a real zsh', () => {
  const zsh = (() => { try { return execFileSync('/bin/zsh', ['-c', 'echo ok']).toString().trim() === 'ok' } catch { return false } })()
  it.skipIf(!zsh)('registers a preexec hook and logs time, resolved folder and command', () => {
    const dir = tmp()
    const log = join(dir, 'commands.log')
    const hook = join(dir, 'hook.zsh')
    writeFileSync(hook, hookScript(log))
    const work = join(dir, 'work dir')
    mkdirSync(work)
    const out = execFileSync('/bin/zsh', ['-f', '-c', `source ${JSON.stringify(hook)}; print -l $preexec_functions; cd ${JSON.stringify(work)}; _cairix_preexec 'git status'; _cairix_preexec ' secret thing'; _cairix_preexec $'multi\\nline\\tcmd'; _cairix_preexec ''`]).toString()
    expect(out).toContain('_cairix_preexec')
    const entries = parseHookLog(readFileSync(log, 'utf8'))
    expect(entries.map((e) => e.command)).toEqual(['git status', 'multi line cmd'])
    expect(entries[0].cwd).toBe(work)
    expect(entries[0].ts).toBeGreaterThan(1_600_000_000)
  })
})

describe('reading the hook log', () => {
  it('parses lines and skips malformed ones', () => {
    expect(parseHookLog('1700000000\t/a/b\tgit status\nbad line\n1\trelative\tx\n1700000001\t/c\t\n1700000002\t/a/b\tls\t-la\n')).toEqual([
      { ts: 1700000000, cwd: '/a/b', command: 'git status' },
      { ts: 1700000002, cwd: '/a/b', command: 'ls\t-la' }
    ])
  })
})

describe('folder counts', () => {
  it('count per command and folder, most used first, and survive a restart', () => {
    const dir = tmp()
    const s = new HistoryStore(dir)
    s.ingest([{ command: 'pnpm dev' }], 1000)
    s.ingestFolders([{ command: 'pnpm dev', cwd: '/a' }, { command: 'pnpm dev', cwd: '/b' }, { command: 'pnpm dev', cwd: '/b' }])
    expect(s.entries()[0].folders).toEqual([{ path: '/b', count: 2 }, { path: '/a', count: 1 }])
    s.save()
    expect(new HistoryStore(dir).entries()[0].folders).toEqual([{ path: '/b', count: 2 }, { path: '/a', count: 1 }])
  })
  it('keeps only the five busiest folders per command', () => {
    const s = new HistoryStore(tmp())
    s.ingest([{ command: 'ls' }], 1000)
    s.ingestFolders(Array.from({ length: 8 }, (_, i) => ({ command: 'ls', cwd: `/d${i}` })))
    expect(s.entries()[0].folders).toHaveLength(5)
  })
  it('skips secrets and never-track rules, and forgets folders when a rule is added', () => {
    const s = new HistoryStore(tmp())
    s.ingest([{ command: 'git status' }], 1000)
    s.ingestFolders([{ command: 'git status', cwd: '/a' }, { command: 'curl --api-key sk-abcdefghijklmnopqrstuvwxyz x', cwd: '/a' }])
    s.addRule({ kind: 'program', value: 'git' })
    s.ingest([{ command: 'git status' }], 1000)
    expect(s.entries()).toEqual([])
    expect(s.hasFolderData()).toBe(false)
  })
})

describe('the service with the hook', () => {
  it('learns folders from the log, reports hook status, and installs and removes cleanly', async () => {
    const root = tmp()
    const home = join(root, 'home')
    mkdirSync(home)
    const hist = join(home, '.zsh_history')
    writeFileSync(hist, ': 1:0;pnpm dev\n: 2:0;pnpm dev\n')
    writeFileSync(join(home, '.zshrc'), 'export A=1\n')
    const svc = new HistoryService({ dataDir: join(root, 'data'), home, sources: [{ path: hist, format: 'zsh' }], isEnabled: () => true, onChange: () => undefined })
    await svc.poll()
    expect(svc.snapshot().hook).toMatchObject({ installed: false, recording: false })
    expect(svc.snapshot().sources.map((s) => s.path)).toEqual([hist]) // the hook log is not a "history file"

    expect(svc.installHook().hook.installed).toBe(true)
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toContain(BLOCK_START)
    const log = join(root, 'data', 'shell', 'commands.log')
    appendFileSync(log, '1700000000\t/work/app\tpnpm dev\n1700000001\t/work/app\tpnpm dev\n1700000002\t/work/api\tpnpm dev\n')
    await svc.poll()
    const snap = svc.snapshot()
    expect(snap.hook.recording).toBe(true)
    expect(snap.entries[0]).toMatchObject({ command: 'pnpm dev', count: 2, folders: [{ path: '/work/app', count: 2 }, { path: '/work/api', count: 1 }] })
    await svc.poll() // nothing new: nothing recounted
    expect(svc.snapshot().entries[0].folders[0].count).toBe(2)
    expect(svc.removeHook().hook.installed).toBe(false)
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe('export A=1\n')
  })
})
