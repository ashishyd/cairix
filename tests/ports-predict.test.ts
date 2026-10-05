import { describe, expect, it } from 'vitest'
import { predictPorts } from '../src/shared/ports-predict'
import { findFileRefs } from '../src/shared/log-links'
import { editorAttempts } from '../src/main/modules/scripts/editor'

const ports = (cmd: string, env: Record<string, string> = {}): number[] => predictPorts(cmd, env).map((p) => p.port)

describe('predicting the port a script will use', () => {
  it('reads an explicit port flag', () => {
    expect(ports('next dev --port 4000')).toEqual([4000])
    expect(ports('vite --port=5000')).toEqual([5000])
    expect(ports('node server.js --port 8081')).toEqual([8081])
    expect(predictPorts('next dev -p 3100')[0]).toEqual({ port: 3100, why: '-p 3100' })
  })
  it('only treats -p as a port for tools known to mean that', () => {
    expect(ports('python -m foo -p 1234')).toEqual([])
    expect(ports('grep -p 1234')).toEqual([])
  })
  it('reads bind addresses and positional ports', () => {
    expect(ports('python manage.py runserver 0.0.0.0:9000')).toEqual([9000])
    expect(ports('gunicorn app:app --bind 127.0.0.1:5001')).toEqual([5001])
    expect(ports('python -m http.server 8123')).toEqual([8123])
  })
  it('reads PORT= written in the command, and PORT from the environment for known servers', () => {
    expect(ports('PORT=4321 node server.js')).toEqual([4321])
    expect(ports('next dev', { PORT: '3500' })).toEqual([3500])
    expect(predictPorts('next dev', { PORT: '3500' }, 'PORT in .env')[0].why).toBe('PORT in .env')
  })
  it('does not guess from the environment for something that is not a server', () => {
    expect(ports('tsc -b', { PORT: '3500' })).toEqual([])
    expect(ports('node build.js', { PORT: '3500' })).toEqual([])
  })
  it('falls back to the framework default, and says nothing when it cannot tell', () => {
    expect(ports('next dev')).toEqual([3000])
    expect(ports('vite')).toEqual([5173])
    expect(ports('vite preview')).toEqual([4173])
    expect(ports('astro dev')).toEqual([4321])
    expect(ports('flask run')).toEqual([5000])
    expect(ports('python manage.py runserver')).toEqual([8000])
    expect(ports('ng serve')).toEqual([4200])
    expect(ports('node server.js')).toEqual([])
    expect(ports('pnpm test')).toEqual([])
    expect(ports('')).toEqual([])
  })
  it('an explicit port beats the default and the environment', () => {
    expect(ports('next dev --port 4000', { PORT: '3500' })).toEqual([4000])
  })
  it('ignores impossible ports', () => {
    expect(ports('next dev --port 99999')).toEqual([3000])
    expect(ports('next dev --port 0')).toEqual([3000])
  })
})

describe('file references in output', () => {
  const refs = (s: string) => findFileRefs(s).map((r) => [s.slice(r.start, r.end), r.path, r.line, r.column])
  it('finds node stack frames with line and column', () => {
    expect(refs('    at handler (/Users/me/app/src/server.ts:42:13)')).toEqual([['/Users/me/app/src/server.ts:42:13', '/Users/me/app/src/server.ts', 42, 13]])
    expect(refs('    at Object.<anonymous> (src/index.js:7:1)')).toEqual([['src/index.js:7:1', 'src/index.js', 7, 1]])
  })
  it('finds compiler-style output', () => {
    expect(refs('src/components/Button.tsx:12:5 - error TS2322: nope')).toEqual([['src/components/Button.tsx:12:5', 'src/components/Button.tsx', 12, 5]])
    expect(refs('./lib/util.ts:3')).toEqual([['./lib/util.ts:3', './lib/util.ts', 3, undefined]])
  })
  it('finds python tracebacks', () => {
    const line = '  File "/home/me/app/main.py", line 18, in run'
    expect(findFileRefs(line)).toEqual([{ start: line.indexOf('/home'), end: line.indexOf(', in'), path: '/home/me/app/main.py', line: 18 }])
  })
  it('finds a path with no line number', () => {
    expect(refs('Cannot find module ./config/db.js')).toEqual([['./config/db.js', './config/db.js', undefined, undefined]])
  })
  it('does not turn URLs, versions or plain words into links', () => {
    expect(refs('GET https://example.com/app/main.js:10 200')).toEqual([])
    expect(refs('listening on localhost:3000')).toEqual([])
    expect(refs('v1.2.3 released, see README for notes')).toEqual([])
    expect(refs('image sha256:abcdef')).toEqual([])
  })
  it('reports several in one line, in order', () => {
    expect(refs('a/b.ts:1 then c/d.py:2').map((r) => r[1])).toEqual(['a/b.ts', 'c/d.py'])
  })
})

describe('opening a file in an editor', () => {
  it('tries Cursor, then VS Code, then the default editor, with the line', () => {
    const a = editorAttempts('/p/a.ts', 12, 5, undefined)
    expect(a.map((x) => x.file)).toEqual(['cursor', 'code', 'open'])
    expect(a[0].args).toEqual(['--goto', '/p/a.ts:12:5'])
    expect(a[2].args).toEqual(['-t', '/p/a.ts'])
    expect(editorAttempts('/p/a.ts', undefined, undefined, undefined)[0].args).toEqual(['--goto', '/p/a.ts'])
  })
  it('uses only the override when one is set (tests)', () => {
    expect(editorAttempts('/p/a.ts', 3, undefined, '/tmp/fake-editor')).toEqual([{ file: '/tmp/fake-editor', args: ['--goto', '/p/a.ts:3'] }])
  })
})
