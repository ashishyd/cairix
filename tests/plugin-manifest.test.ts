import { describe, expect, it } from 'vitest'
import { describePermission, parseContributionKey } from '../src/shared/plugins'
import { parseManifest, permissionProblem, validateUi } from '../src/main/modules/plugins/manifest'

const base = { apiVersion: 1, id: 'acme.hello', name: 'Hello', version: '1.0.0', main: 'index.js' }

describe('manifest validation', () => {
  it('accepts a minimal manifest and fills defaults', () => {
    const r = parseManifest(base)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.manifest).toMatchObject({ permissions: [], contributes: { commands: [], widgets: [], tabs: [] } })
  })
  it.each([
    [{ ...base, apiVersion: 2 }, /apiVersion/],
    [{ ...base, id: 'hello' }, /dotted id/],
    [{ ...base, id: 'Acme.Hello' }, /dotted id/],
    [{ ...base, id: '../evil.x' }, /dotted id/],
    [{ ...base, version: '1.0' }, /version/],
    [{ ...base, main: '../../etc/passwd.js' }, /main/],
    [{ ...base, main: '/abs/index.js' }, /main/],
    [{ ...base, main: 'index.txt' }, /main/],
    [{ ...base, main: '.hidden/x.js' }, /main/],
    [{ ...base, permissions: ['root'] }, /Unknown permission/],
    [{ ...base, permissions: ['network:localhost'] }, /valid host/],
    [{ ...base, permissions: ['network:http://x.com'] }, /valid host/],
    [{ ...base, contributes: { widgets: [{ id: 'A B', title: 't' }] } }, /id/],
    [{ ...base, contributes: { commands: [{ id: 'x', title: 't' }], tabs: [{ id: 'x', title: 't' }] } }, /unique/]
  ])('rejects %j', (raw, why) => {
    const r = parseManifest(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(why)
  })
  it('accepts valid permissions, including network hosts and wildcards, and dedupes them', () => {
    const r = parseManifest({ ...base, permissions: ['storage', 'network:api.github.com', 'network:*.example.com', 'storage'] })
    expect(r.ok && r.manifest.permissions).toEqual(['storage', 'network:api.github.com', 'network:*.example.com'])
    expect(permissionProblem('ports.read')).toBeNull()
  })
  it('describes permissions in plain language', () => {
    expect(describePermission('network:api.github.com')).toBe('Contact api.github.com over the internet')
    expect(describePermission('projects.read')).toMatch(/projects/)
  })
  it('round-trips contribution keys safely', () => {
    expect(parseContributionKey('plugin:acme.hello:counter')).toEqual({ pluginId: 'acme.hello', id: 'counter' })
    expect(parseContributionKey('plugin:../x:y')).toBeNull()
    expect(parseContributionKey('stats')).toBeNull()
  })
})

describe('UI tree validation (output of untrusted code)', () => {
  it('accepts every node type', () => {
    const ok = validateUi({ type: 'stack', children: [{ type: 'heading', text: 'h' }, { type: 'text', text: 't', tone: 'success' }, { type: 'metric', label: 'a', value: '1' }, { type: 'list', items: [{ title: 'x', action: 'open', payload: 'p' }] }, { type: 'button', label: 'Go', action: 'go' }, { type: 'progress', value: 0.5 }, { type: 'badge', text: 'b' }, { type: 'link', text: 'docs', url: 'https://example.com' }] })
    expect(ok.ok).toBe(true)
  })
  it.each([
    [{ type: 'script', src: 'x' }, /type/i],
    [{ type: 'text' }, /text/],
    [{ type: 'button', label: 'x', action: 'Bad Name!' }, /action/],
    [{ type: 'progress', value: 5 }, /value/],
    [{ type: 'text', text: 'x'.repeat(2001) }, /text/],
    [{ type: 'html', html: '<img onerror=alert(1)>' }, /type/i],
    ['just a string', /root/],
    [null, /root/]
  ])('rejects %j', (raw, why) => {
    const r = validateUi(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(why)
  })
  it('strips unknown properties instead of passing them to the UI', () => {
    const r = validateUi({ type: 'text', text: 'hi', dangerouslySetInnerHTML: '<b>', onClick: 'x' })
    expect(r.ok && r.tree).toEqual({ type: 'text', text: 'hi' })
  })
  it('turns non-https links into inert text', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://example.com', 'data:text/html,x', 'not a url']) {
      const r = validateUi({ type: 'link', text: 'click', url })
      expect(r.ok && r.tree, url).toEqual({ type: 'text', text: 'click', muted: true })
    }
    const nested = validateUi({ type: 'stack', children: [{ type: 'link', text: 'a', url: 'javascript:1' }] })
    expect(nested.ok && nested.tree).toEqual({ type: 'stack', children: [{ type: 'text', text: 'a', muted: true }] })
  })
  it('caps depth and size so a plugin cannot freeze the UI', () => {
    let deep: unknown = { type: 'text', text: 'x' }
    for (let i = 0; i < 8; i++) deep = { type: 'stack', children: [deep] }
    expect(validateUi(deep)).toMatchObject({ ok: false, error: expect.stringMatching(/deeply/) })
    const wide = { type: 'stack', children: Array.from({ length: 50 }, () => ({ type: 'stack', children: Array.from({ length: 50 }, () => ({ type: 'text', text: 'x' })) })) }
    expect(validateUi(wide)).toMatchObject({ ok: false, error: expect.stringMatching(/too large/) })
    expect(validateUi({ type: 'list', items: Array.from({ length: 101 }, () => ({ title: 'x' })) }).ok).toBe(false)
  })
})
