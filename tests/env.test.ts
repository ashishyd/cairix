import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { formatValue, parseEnv, removeVar, serializeEnv, setVar, varsOf } from '../src/main/modules/env/parse'
import { EnvService, previewOf, type EnvDeps } from '../src/main/modules/env/service'

describe('reading .env files', () => {
  it('reads plain, quoted, exported and commented values', () => {
    const e = parseEnv(`# comment\nPORT=3000\nexport NAME = "my app"  # trailing\nSINGLE='a b'\nBARE=value # note\nEMPTY=\n\nURL=http://x/?a=b#frag\n`)
    expect(varsOf(e)).toEqual([
      { key: 'PORT', value: '3000' },
      { key: 'NAME', value: 'my app' },
      { key: 'SINGLE', value: 'a b' },
      { key: 'BARE', value: 'value' },
      { key: 'EMPTY', value: '' },
      { key: 'URL', value: 'http://x/?a=b#frag' }
    ])
  })
  it('reads escapes and values that span lines', () => {
    const e = parseEnv('A="line1\\nline2"\nKEY="-----BEGIN\nabc\n-----END"\nAFTER=1\n')
    expect(varsOf(e)).toEqual([{ key: 'A', value: 'line1\nline2' }, { key: 'KEY', value: '-----BEGIN\nabc\n-----END' }, { key: 'AFTER', value: '1' }])
  })
  it('lets the last assignment win, like dotenv', () => {
    expect(varsOf(parseEnv('A=1\nA=2\n'))).toEqual([{ key: 'A', value: '2' }])
  })
  it('does not treat comments or junk as variables', () => {
    expect(varsOf(parseEnv('#A=1\n  # B=2\nnot a var\n=x\n'))).toEqual([])
  })
})

describe('editing keeps everything else intact', () => {
  const src = '# db\nexport HOST=localhost\n\nPORT=3000 # dev\nSECRET="a b"\n'
  it('changes only the touched line', () => {
    expect(serializeEnv(setVar(parseEnv(src), 'PORT', '4000'))).toBe('# db\nexport HOST=localhost\n\nPORT=4000\nSECRET="a b"\n')
    expect(serializeEnv(setVar(parseEnv(src), 'HOST', '127.0.0.1'))).toContain('export HOST=127.0.0.1')
  })
  it('appends a new variable and removes one without touching comments', () => {
    expect(serializeEnv(setVar(parseEnv(src), 'NEW', 'x y'))).toBe(src + 'NEW="x y"\n')
    expect(serializeEnv(removeVar(parseEnv(src), 'PORT'))).toBe('# db\nexport HOST=localhost\n\nSECRET="a b"\n')
  })
  it('quotes only what needs it, and round-trips awkward values', () => {
    expect(formatValue('abc')).toBe('abc')
    expect(formatValue('')).toBe('')
    for (const v of ['a b', 'say "hi"', 'x#y z', 'back\\slash', 'multi\nline', '$HOME', "it's"]) {
      expect(varsOf(parseEnv(serializeEnv(setVar([], 'K', v))))).toEqual([{ key: 'K', value: v }])
    }
  })
  it('refuses a bad variable name', () => {
    expect(() => setVar([], '1BAD', 'x')).toThrow(/letters, digits/)
    expect(() => setVar([], 'has space', 'x')).toThrow()
  })
})

describe('previews', () => {
  it('shows harmless values and hides anything secret-looking', () => {
    expect(previewOf('PORT', '3000')).toBe('3000')
    expect(previewOf('API_TOKEN', 'abc')).toBeUndefined()
    expect(previewOf('PLAIN', 'sk-abcdefghijklmnopqrstuvwxyz')).toBeUndefined()
    expect(previewOf('DB', 'postgres://user:pw@host/db')).toBeUndefined()
    expect(previewOf('LONG', 'x'.repeat(100))).toBeUndefined()
    expect(previewOf('E', '')).toBeUndefined()
  })
})

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function setup(files: Record<string, string>, over: Partial<{ trusted: boolean; hasGit: boolean; ignored: string[]; tracked: string[] }> = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-env-')))
  dirs.push(dir)
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c)
  const ignored = new Set(over.ignored ?? [])
  const tracked = new Set(over.tracked ?? [])
  const deps: EnvDeps = {
    project: (id) => (id === 'p' ? { path: dir, trusted: over.trusted ?? true, name: 'web-app', hasGit: over.hasGit ?? true } : undefined),
    git: async (_cwd, args) => {
      const name = args.at(-1)!
      if (args[0] === 'check-ignore' && ignored.has(name)) return ''
      if (args[0] === 'ls-files' && tracked.has(name)) return ''
      throw new Error('exit 1')
    }
  }
  return { svc: new EnvService(deps), dir }
}

describe('the env service', () => {
  it('lists files with key metadata and never includes a value that could be secret', async () => {
    const { svc } = setup({ '.env': 'PORT=3000\nAPI_KEY=supersecret\nEMPTY=\n', '.env.example': 'PORT=\nAPI_KEY=\nEMPTY=\nNEW_ONE=\n' }, { ignored: ['.env'] })
    const snap = await svc.list('p')
    expect(JSON.stringify(snap)).not.toContain('supersecret')
    const env = snap.files.find((f) => f.name === '.env')!
    expect(env).toMatchObject({ kind: 'local', gitignored: true, tracked: false, template: '.env.example' })
    expect(env.vars.find((v) => v.key === 'PORT')).toMatchObject({ preview: '3000', sensitive: false })
    expect(env.vars.find((v) => v.key === 'API_KEY')).toMatchObject({ sensitive: true, empty: false, length: 11 })
    expect(env.vars.find((v) => v.key === 'API_KEY')!.preview).toBeUndefined()
    expect(env.missing.sort()).toEqual(['EMPTY', 'NEW_ONE'])
    expect(snap.files.map((f) => f.name)).toEqual(['.env', '.env.example'])
  })
  it('flags files git would commit, and ones it already does', async () => {
    const a = await setup({ '.env': 'A=1\n' }, { ignored: [] }).svc.list('p')
    expect(a.files[0]).toMatchObject({ gitignored: false, tracked: false })
    const b = await setup({ '.env': 'A=1\n' }, { tracked: ['.env'] }).svc.list('p')
    expect(b.files[0].tracked).toBe(true)
    const c = await setup({ '.env': 'A=1\n' }, { hasGit: false }).svc.list('p')
    expect(c.files[0].gitignored).toBeNull()
  })
  it('reports keys that are not in the template', async () => {
    const { svc } = setup({ '.env': 'A=1\nB=2\n', '.env.example': 'A=\n' })
    expect((await svc.list('p')).files[0].extra).toEqual(['B'])
  })
  it('reveals one value on request', async () => {
    const { svc } = setup({ '.env': 'TOKEN=abc def\n' })
    expect(await svc.reveal('p', '.env', 'TOKEN')).toBe('abc def')
    await expect(svc.reveal('p', '.env', 'NOPE')).rejects.toThrow(/not in/)
  })
  it('edits and removes a variable on disk, keeping the file mode and other lines', async () => {
    const { svc, dir } = setup({ '.env': '# keep\nA=1\nB=2\n' })
    chmodSync(join(dir, '.env'), 0o600)
    await svc.set('p', '.env', 'A', 'new value')
    await svc.remove('p', '.env', 'B')
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('# keep\nA="new value"\n')
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600)
    expect(readdirTmp(dir)).toEqual([])
  })
  it('creates .env from the template, and will not overwrite one', async () => {
    const { svc, dir } = setup({ '.env.example': 'A=changeme\nB=\n' })
    const snap = await svc.create('p', '.env', '.env.example')
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('A=changeme\nB=\n')
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600)
    expect(snap.files.map((f) => f.name)).toContain('.env')
    await expect(svc.create('p', '.env', '.env.example')).rejects.toThrow(/already exists/)
  })
  it('adds only the keys that are absent, empty, and leaves set ones alone', async () => {
    const { svc, dir } = setup({ '.env': 'A=real\nEMPTY=\n', '.env.example': 'A=x\nEMPTY=y\nB=z\n' })
    await svc.addMissing('p', '.env')
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('A=real\nEMPTY=\nB=\n')
  })
  it('refuses untrusted folders, unknown projects, odd file names and symlinks', async () => {
    await expect(setup({ '.env': 'A=1\n' }, { trusted: false }).svc.list('p')).rejects.toThrow(/Trust/)
    await expect(setup({}).svc.list('nope')).rejects.toThrow(/no longer in Cairix/)
    const { svc, dir } = setup({ '.env': 'A=1\n' })
    for (const bad of ['../.env', 'secrets.txt', '.env/../x', '.envrc', '/etc/passwd']) await expect(svc.reveal('p', bad, 'A'), bad).rejects.toThrow()
    writeFileSync(join(dir, 'outside.txt'), 'SECRET=1\n')
    symlinkSync(join(dir, 'outside.txt'), join(dir, '.env.local'))
    await expect(svc.reveal('p', '.env.local', 'SECRET')).rejects.toThrow()
    expect((await svc.list('p')).files.map((f) => f.name)).toEqual(['.env'])
    await expect(svc.set('p', '.env', 'A', 'x'.repeat(9000))).rejects.toThrow(/too long/)
    await expect(svc.create('p', '.env.example', '.env')).rejects.toThrow()
    expect(existsSync(join(dir, '.env.example'))).toBe(false)
  })
})

function readdirTmp(dir: string): string[] {
  return require('fs').readdirSync(dir).filter((n: string) => n.endsWith('.tmp'))
}
