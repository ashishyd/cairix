import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { LABEL_CLASS, SPACE_SCALE, TYPE_CLASS, TYPE_SCALE } from '../src/shared/design'

const css = readFileSync(join(__dirname, '../src/renderer/src/styles/globals.css'), 'utf8')
const tw = readFileSync(join(__dirname, '../tailwind.config.js'), 'utf8')

describe('typed design scale', () => {
  it('declares every type token in CSS relative to --cx-font-size', () => {
    expect(css).toMatch(/--cx-font-size:\s*13px/)
    for (const key of Object.keys(TYPE_SCALE)) {
      expect(css, `missing --cx-text-${key}`).toMatch(new RegExp(`--cx-text-${key}:`))
    }
    expect(css).toMatch(/--cx-text-base:\s*var\(--cx-font-size\)/)
  })

  it('exposes the same type keys to Tailwind', () => {
    for (const key of Object.keys(TYPE_SCALE)) {
      const twKey = key === '2xs' || key === '2xl' ? `'${key}'` : key
      expect(tw, `tailwind missing ${key}`).toContain(twKey)
      expect(tw).toContain(`var(--cx-text-${key})`)
    }
  })

  it('maps TYPE_CLASS to Tailwind utilities', () => {
    expect(TYPE_CLASS).toEqual({
      '2xs': 'text-2xs',
      xs: 'text-xs',
      sm: 'text-sm',
      base: 'text-base',
      md: 'text-md',
      lg: 'text-lg',
      xl: 'text-xl',
      '2xl': 'text-2xl'
    })
  })

  it('declares spacing tokens used by page chrome', () => {
    expect(SPACE_SCALE.pageX).toBe(32)
    expect(SPACE_SCALE.pageY).toBe(24)
    expect(css).toMatch(/--cx-page-x:\s*32px/)
    expect(css).toMatch(/--cx-page-y:\s*24px/)
    expect(css).toMatch(/--cx-row-y:\s*10px/)
    expect(css).toMatch(/\[data-density='compact'\][\s\S]*--cx-row-y:\s*6px/)
    expect(tw).toContain("'page-x'")
    expect(tw).toContain("'page-y'")
    expect(tw).toContain("'row-y'")
  })

  it('keeps the section-label utility in sync with LABEL_CLASS', () => {
    expect(LABEL_CLASS).toBe('text-xs font-semibold uppercase tracking-wider text-cx-faint')
    expect(css).toContain('.cx-label')
    expect(css).toContain('font-size: var(--cx-text-xs)')
  })

  it('renderer has no leftover arbitrary text-[Npx] sizes', () => {
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const ent of require('fs').readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name)
        if (ent.isDirectory()) walk(p)
        else if (ent.name.endsWith('.tsx')) {
          const src = readFileSync(p, 'utf8')
          const m = src.match(/text-\[\d+(?:\.\d+)?px\]/g)
          if (m) hits.push(`${p}: ${m.join(', ')}`)
        }
      }
    }
    walk(join(__dirname, '../src/renderer/src'))
    expect(hits, hits.join('\n')).toEqual([])
  })
})
