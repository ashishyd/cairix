import { describe, expect, it } from 'vitest'
import { ACTION_PREFIX, COMMANDS, comboFromEvent, comboProblem, effectiveBindings, findConflict, formatCombo, matchEvent, normalizeCombo, parseCombo, stringifyCombo, withBinding, type KeyEventLike } from '../src/shared/keybindings'
import { settingsPatchSchema, settingsSchema } from '../src/shared/settings'

const ev = (o: Partial<KeyEventLike> & { key: string }): KeyEventLike => ({ code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })

describe('combos', () => {
  it('round-trips and canonicalises modifier order', () => {
    expect(normalizeCombo('Shift+Mod+K')).toBe('Mod+Shift+K')
    expect(normalizeCombo('Alt+Mod+ArrowRight')).toBe('Mod+Alt+ArrowRight')
    expect(stringifyCombo(parseCombo('Mod+,')!)).toBe('Mod+,')
    expect(normalizeCombo('Mod++')).toBe('Mod++')
  })
  it('rejects junk', () => {
    for (const bad of ['', 'Foo+K', 'Mod+', 'Mod+kk', 'Mod+Escape', 'Mod+Backspace', 'Mod+F13']) expect(parseCombo(bad), bad).toBeNull()
  })
})

describe('key events', () => {
  it('maps Cmd+K on mac and Ctrl+K elsewhere to Mod+K', () => {
    expect(stringifyCombo(comboFromEvent(ev({ key: 'k', metaKey: true }), true)!)).toBe('Mod+K')
    expect(stringifyCombo(comboFromEvent(ev({ key: 'k', ctrlKey: true }), false)!)).toBe('Mod+K')
    expect(stringifyCombo(comboFromEvent(ev({ key: 'k', ctrlKey: true }), true)!)).toBe('Ctrl+K')
  })
  it('uses the physical key when Option changes the character (⌥K is "˚" on a Mac)', () => {
    expect(stringifyCombo(comboFromEvent(ev({ key: '˚', code: 'KeyK', altKey: true, metaKey: true }), true)!)).toBe('Mod+Alt+K')
    expect(stringifyCombo(comboFromEvent(ev({ key: '¡', code: 'Digit1', altKey: true, metaKey: true }), true)!)).toBe('Mod+Alt+1')
    expect(stringifyCombo(comboFromEvent(ev({ key: '≤', code: 'Comma', altKey: true, metaKey: true }), true)!)).toBe('Mod+Alt+,')
  })
  it('keeps shifted punctuation expressible: Cmd+Shift+/ is not "?"', () => {
    expect(stringifyCombo(comboFromEvent(ev({ key: '?', code: 'Slash', shiftKey: true, metaKey: true }), true)!)).toBe('Mod+Shift+/')
    expect(stringifyCombo(comboFromEvent(ev({ key: '!', code: 'Digit1', shiftKey: true, metaKey: true }), true)!)).toBe('Mod+Shift+1')
  })
  it('respects the printed layout (AZERTY: the key labelled A reports key "a")', () => {
    expect(stringifyCombo(comboFromEvent(ev({ key: 'a', code: 'KeyQ', metaKey: true }), true)!)).toBe('Mod+A')
  })
  it('names special keys and ignores bare modifier presses', () => {
    expect(stringifyCombo(comboFromEvent(ev({ key: 'ArrowRight', metaKey: true, altKey: true }), true)!)).toBe('Mod+Alt+ArrowRight')
    expect(stringifyCombo(comboFromEvent(ev({ key: ' ', ctrlKey: true }), true)!)).toBe('Ctrl+Space')
    for (const k of ['Meta', 'Shift', 'Alt', 'Control']) expect(comboFromEvent(ev({ key: k, metaKey: true }), true)).toBeNull()
  })
})

describe('what may be bound', () => {
  it('requires a real modifier so typing is never hijacked', () => {
    expect(comboProblem('K')).toMatch(/Include/)
    expect(comboProblem('Shift+K')).toMatch(/Shift alone|Include/)
    expect(comboProblem('Mod+K')).toBeNull()
    expect(comboProblem('Alt+J')).toBeNull()
    expect(comboProblem('F5')).toBeNull()
    expect(comboProblem('Ctrl+Space')).toBeNull()
  })
  it('refuses system-owned combos and invalid text', () => {
    for (const r of ['Mod+C', 'Mod+V', 'Mod+Q', 'Mod+W', 'Mod+Shift+Z']) expect(comboProblem(r), r).toMatch(/reserved/)
    expect(comboProblem('nonsense')).toMatch(/not a valid/)
  })
  it('every default command binding is itself valid and unique', () => {
    const seen = new Set<string>()
    for (const c of COMMANDS) {
      expect(comboProblem(c.default), c.id).toBeNull()
      expect(seen.has(c.default), `${c.id} duplicates a default`).toBe(false)
      seen.add(c.default)
    }
  })
})

describe('resolving and editing bindings', () => {
  it('uses defaults, honours overrides, and treats "" as unbound', () => {
    const b = effectiveBindings({ 'palette.open': 'Mod+Shift+P', 'folder.add': '' })
    expect(b['palette.open']).toBe('Mod+Shift+P')
    expect(b['folder.add']).toBe('')
    expect(b['settings.open']).toBe('Mod+,')
  })
  it('includes custom actions, unbound until you give them a key', () => {
    const b = effectiveBindings({ [ACTION_PREFIX + 'a1']: 'Alt+G' }, ['a1', 'a2'])
    expect(b[ACTION_PREFIX + 'a1']).toBe('Alt+G')
    expect(b[ACTION_PREFIX + 'a2']).toBe('')
  })
  it('matches events to commands and ignores unbound combos', () => {
    const b = effectiveBindings({})
    expect(matchEvent(b, ev({ key: 'k', metaKey: true }), true)).toBe('palette.open')
    expect(matchEvent(b, ev({ key: ',', metaKey: true }), true)).toBe('settings.open')
    expect(matchEvent(b, ev({ key: 'j', metaKey: true }), true)).toBeUndefined()
    expect(matchEvent(effectiveBindings({ 'palette.open': '' }), ev({ key: 'k', metaKey: true }), true)).toBeUndefined()
  })
  it('detects conflicts, and lets the user take a key over explicitly', () => {
    const b = effectiveBindings({})
    expect(findConflict(b, 'Mod+K', 'folder.add')).toBe('palette.open')
    expect(findConflict(b, 'Mod+K', 'palette.open')).toBeUndefined()
    expect(findConflict(b, '', 'folder.add')).toBeUndefined()
    expect(() => withBinding({}, b, 'folder.add', 'Mod+K')).toThrow(/already used/i)
    const stolen = withBinding({}, b, 'folder.add', 'Mod+K', true)
    expect(stolen).toEqual({ 'folder.add': 'Mod+K', 'palette.open': '' })
    const after = effectiveBindings(stolen)
    expect(matchEvent(after, ev({ key: 'k', metaKey: true }), true)).toBe('folder.add')
  })
  it("binding back to the default removes the override instead of storing it", () => {
    const b = effectiveBindings({ 'palette.open': 'Mod+Shift+P' })
    expect(withBinding({ 'palette.open': 'Mod+Shift+P' }, b, 'palette.open', 'Mod+K')).toEqual({})
  })
})

describe('display', () => {
  it('uses macOS symbols and spells out other platforms', () => {
    expect(formatCombo('Mod+Shift+K', true)).toBe('⇧⌘K')
    expect(formatCombo('Ctrl+Alt+ArrowRight', true)).toBe('⌃⌥→')
    expect(formatCombo('Mod+Shift+K', false)).toBe('Ctrl+Shift+K')
    expect(formatCombo('', true)).toBe('')
  })
})

describe('stored in settings', () => {
  it('a bad stored shortcut reads as unbound but does not reset the other settings', () => {
    const parsed = settingsSchema.parse({ theme: 'dark', keybindings: { 'palette.open': 'banana' } })
    expect(parsed.theme).toBe('dark')
    expect(effectiveBindings(parsed.keybindings)['palette.open']).toBe('')
  })
  it('accepts a map of command to combo, and rejects junk values', () => {
    expect(settingsPatchSchema.safeParse({ keybindings: { 'palette.open': 'Mod+Shift+P', 'folder.add': '' } }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ keybindings: { 'palette.open': 'K' } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ keybindings: { 'palette.open': 'Mod+Q' } }).success).toBe(false)
  })
})
