import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Accessibility guard. Reads the REAL design tokens out of globals.css and
 * checks WCAG contrast, so a "just tweak the grey" change can't quietly make
 * text unreadable. (This caught tertiary text at 2.8:1 and amber/green text
 * at ~3:1 in light mode.)
 */

const css = readFileSync(join(__dirname, '../src/renderer/src/styles/globals.css'), 'utf8')
type RGB = [number, number, number]

function block(startPattern: RegExp): string {
  const m = css.match(startPattern)
  if (!m || m.index === undefined) throw new Error(`block not found: ${startPattern}`)
  let depth = 0
  for (let i = css.indexOf('{', m.index); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', m.index) + 1, i)
  }
  throw new Error('unterminated block')
}

function tokens(text: string): Record<string, RGB> {
  const out: Record<string, RGB> = {}
  for (const m of text.matchAll(/--cx-([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) out[m[1]] = [+m[2], +m[3], +m[4]]
  return out
}

const lightTokens = tokens(block(/^:root\s*\{/m))
const darkTokens = { ...lightTokens, ...tokens(block(/@media \(prefers-color-scheme: dark\)\s*\{/)) }

const lum = ([r, g, b]: RGB): number => {
  const f = (v: number): number => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: RGB, b: RGB): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

describe.each([
  ['light', lightTokens],
  ['dark', darkTokens]
] as const)('%s theme contrast', (_name, t) => {
  it.each(['text', 'muted'])('%s is >= 4.5:1 on bg, surface and hover', (k) => {
    for (const bg of ['bg', 'surface', 'hover']) expect(ratio(t[k], t[bg]), `${k} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  it('faint (tertiary) text is >= 4.5:1 on bg and surface, >= 3.5:1 on hover', () => {
    for (const bg of ['bg', 'surface']) expect(ratio(t.faint, t[bg]), `faint on ${bg}`).toBeGreaterThanOrEqual(4.5)
    expect(ratio(t.faint, t.hover)).toBeGreaterThanOrEqual(3.5)
  })

  it.each(['success', 'warning', 'danger'])('%s text is >= 4.5:1 on bg and surface', (k) => {
    for (const bg of ['bg', 'surface']) expect(ratio(t[k], t[bg]), `${k} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  it('text keeps its hierarchy: text > muted > faint', () => {
    expect(ratio(t.text, t.bg)).toBeGreaterThan(ratio(t.muted, t.bg))
    expect(ratio(t.muted, t.bg)).toBeGreaterThan(ratio(t.faint, t.bg))
  })
})

describe('accent presets', () => {
  const accents = ['blue', 'green', 'amber', 'violet', 'rose', 'slate'].map((name) => {
    const m = css.match(new RegExp(`\\[data-accent='${name}'\\]\\s*\\{([^}]*)\\}`))
    if (!m) throw new Error(`accent ${name} missing`)
    return { name, t: tokens(m[1]) }
  })

  it.each(accents.map((a) => [a.name, a] as const))('%s: white text on the fill is >= 4.5:1', (_n, a) => {
    expect(ratio(a.t.accent, [255, 255, 255])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(accents.map((a) => [a.name, a] as const))('%s: ink is readable on light and dark surfaces', (_n, a) => {
    for (const bg of ['bg', 'surface', 'hover']) {
      expect(ratio(a.t['accent-ink-light'], lightTokens[bg]), `light ink on ${bg}`).toBeGreaterThanOrEqual(4.5)
      expect(ratio(a.t['accent-ink-dark'], darkTokens[bg]), `dark ink on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(accents.map((a) => [a.name, a] as const))('%s: fill stays visible against the dark background (>= 3:1)', (_n, a) => {
    expect(ratio(a.t.accent, darkTokens.bg)).toBeGreaterThanOrEqual(3)
  })
})
