import { describe, expect, it } from 'vitest'
import { redactCommand, redactTokens } from '../src/shared/redact'

const M = '•••'

describe('redactCommand', () => {
  it.each([
    // flag styles
    ['cursor-agent --api-key sk-abcdef0123456789abcdef --verbose', `cursor-agent --api-key ${M} --verbose`],
    ['tool --api-key=hunter2 --name x', `tool --api-key=${M} --name x`],
    ['server --client-secret=abc123', `server --client-secret=${M}`],
    ['db --password hunter2', `db --password ${M}`],
    ['db --PASSWORD=hunter2', `db --PASSWORD=${M}`],
    ['run -p secret123 --other', 'run -p secret123 --other'], // `-p` alone is not a known secret flag
    // env assignments in the command line
    ['env OPENAI_API_KEY=abc123 node app.js', `env OPENAI_API_KEY=${M} node app.js`],
    ['GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 node x', `GITHUB_TOKEN=${M} node x`],
    // URLs
    ['psql postgres://admin:s3cr3t@db.local:5432/app', `psql postgres://admin:${M}@db.local:5432/app`],
    ['curl https://user:pw@example.com/x', `curl https://user:${M}@example.com/x`],
    // bare token shapes
    ['node app.js sk-ant-api03-abcdefghijklmnopqrstuvwxyz', `node app.js ${M}`],
    ['run github_pat_11ABCDEFG0abcdefghijklmnop_xyz', `run ${M}`],
    ['x AKIAIOSFODNN7EXAMPLE y', `x ${M} y`],
    ['x eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij y', `x ${M} y`]
  ])('%s', (input, expected) => {
    expect(redactCommand(input)).toBe(expected)
  })

  it('redacts a quoted value after a secret flag', () => {
    expect(redactCommand('tool --token "a b c" run')).toBe(`tool --token ${M} run`)
  })

  it('does not swallow the next flag after a boolean-style auth flag', () => {
    expect(redactCommand('serve --no-auth --verbose --port 3000')).toBe('serve --no-auth --verbose --port 3000')
  })

  it('leaves ordinary command lines untouched', () => {
    const cmd = '/opt/homebrew/bin/python3 -m http.server 8765 --bind 127.0.0.1'
    expect(redactCommand(cmd)).toBe(cmd)
    const next = 'node /Users/x/app/node_modules/next/dist/bin/next dev --turbopack -p 3000'
    expect(redactCommand(next)).toBe(next)
  })

  it('handles the real Cursor agent worker command shape', () => {
    const cmd =
      '/Users/x/Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/bin/cursor-agent --use-system-ca --endpoint https://api2.cursor.sh --api-key crsr_0123456789abcdef0123456789abcdef --name my-worker --label x'
    const out = redactCommand(cmd)
    expect(out).not.toContain('crsr_0123456789abcdef')
    expect(out).toContain('--api-key')
    expect(out).toContain('--name my-worker')
    expect(out).toContain('--endpoint https://api2.cursor.sh')
  })

  it('stays fast on huge unbroken input such as minified code', () => {
    const t = performance.now()
    redactTokens('x'.repeat(300_000) + '\n' + 'a-'.repeat(100_000) + '\n' + 'https'.repeat(60_000))
    expect(performance.now() - t).toBeLessThan(300)
  })

  it('still masks URL passwords after the performance fix', () => {
    expect(redactTokens('db = "postgres://admin:s3cr3t@host/db"')).toBe('db = "postgres://admin:•••@host/db"')
  })

  it('is idempotent', () => {
    const once = redactCommand('a --api-key sk-abcdef0123456789abcdef b')
    expect(redactCommand(once)).toBe(once)
  })
})
