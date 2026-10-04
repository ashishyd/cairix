import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { IPC } from '../src/shared/ipc'

describe('plugin preload', () => {
  const src = readFileSync(join(__dirname, '../src/preload/plugin.ts'), 'utf8')

  it('is self-contained: it imports only electron (a sandboxed preload cannot load other files)', () => {
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    expect(imports).toEqual(['electron'])
  })
  it('uses exactly the channel names main listens on', () => {
    for (const channel of [IPC.pluginRpc, IPC.pluginReply, IPC.pluginInvoke]) expect(src).toContain(`'${channel}'`)
  })
})

describe('build output', () => {
  const out = join(__dirname, '../out/preload')
  const built = (() => { try { return readdirSync(out) } catch { return null } })()
  it.skipIf(!built)('both preloads are single files with no shared chunk to load', () => {
    expect(built).toEqual(expect.arrayContaining(['index.js', 'plugin.js']))
    expect(built!.filter((f) => !f.endsWith('.js'))).toEqual([]) // no chunks/ folder
    for (const f of ['index.js', 'plugin.js']) {
      const code = readFileSync(join(out, f), 'utf8')
      const requires = [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1])
      expect(requires.filter((r) => r !== 'electron'), `${f} requires something other than electron`).toEqual([])
    }
  })
})
