/**
 * Keyboard shortcuts: the command list, a canonical text form for key
 * combinations ("Mod+Shift+K"), and the rules for what may be bound. Pure, so
 * the fiddly parts (macOS Option-key characters, conflicts, reserved keys) are
 * unit-tested rather than discovered by users.
 *
 * "Mod" is ⌘ on macOS and Ctrl elsewhere; "Ctrl" is the real Control key on macOS.
 */

export type CommandGroup = 'General' | 'Navigate' | 'Project' | 'Review'

export interface CommandDef {
  id: string
  title: string
  group: CommandGroup
  /** Default combo; '' means unbound by default. */
  default: string
}

export const COMMANDS: CommandDef[] = [
  { id: 'palette.open', title: 'Open command palette', group: 'General', default: 'Mod+K' },
  { id: 'settings.open', title: 'Open settings', group: 'General', default: 'Mod+,' },
  { id: 'shortcuts.open', title: 'Show keyboard shortcuts', group: 'General', default: 'Mod+/' },
  { id: 'folder.add', title: 'Add folder…', group: 'General', default: 'Mod+O' },
  { id: 'nav.home', title: 'Go to Home', group: 'Navigate', default: 'Mod+1' },
  { id: 'nav.ports', title: 'Go to Ports', group: 'Navigate', default: 'Mod+2' },
  { id: 'nav.agents', title: 'Go to Agents', group: 'Navigate', default: 'Mod+3' },
  { id: 'nav.actions', title: 'Go to Actions', group: 'Navigate', default: 'Mod+4' },
  { id: 'nav.plugins', title: 'Go to Plugins', group: 'Navigate', default: 'Mod+5' },
  { id: 'nav.processes', title: 'Go to Processes', group: 'Navigate', default: 'Mod+6' },
  { id: 'nav.runs', title: 'Go to Runs', group: 'Navigate', default: 'Mod+8' },
  { id: 'nav.history', title: 'Go to Commands', group: 'Navigate', default: 'Mod+7' },
  { id: 'project.tab.next', title: 'Next project tab', group: 'Project', default: 'Mod+Alt+ArrowRight' },
  { id: 'project.tab.prev', title: 'Previous project tab', group: 'Project', default: 'Mod+Alt+ArrowLeft' },
  { id: 'project.scripts', title: 'Open Scripts', group: 'Project', default: 'Mod+Shift+1' },
  { id: 'project.review', title: 'Open Review', group: 'Review', default: 'Mod+Shift+2' },
  { id: 'project.changes', title: 'Open Changes', group: 'Review', default: 'Mod+Shift+3' },
  { id: 'project.tasks', title: 'Open Tasks', group: 'Review', default: 'Mod+Shift+4' },
  { id: 'project.audit', title: 'Open Audit', group: 'Review', default: 'Mod+Shift+5' },
  { id: 'review.section.next', title: 'Next Review section', group: 'Review', default: 'Mod+Shift+ArrowRight' },
  { id: 'review.section.prev', title: 'Previous Review section', group: 'Review', default: 'Mod+Shift+ArrowLeft' },
  { id: 'review.ai', title: 'Review pending changes with AI', group: 'Review', default: 'Mod+Shift+R' },
  { id: 'tasks.new', title: 'New agent task', group: 'Review', default: 'Mod+Shift+N' }
]

/** DOM event name for in-panel Review actions (AI review, focus task compose). */
export const CAIRIX_COMMAND_EVENT = 'cairix:command'

/** Custom actions can be bound too; their command ids look like `action:<uuid>`. */
export const ACTION_PREFIX = 'action:'

// ───────────────────────── combos ─────────────────────────

export interface Combo {
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

const NAMED = new Set(['Enter', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)])
const PUNCT = new Set([',', '.', '/', ';', "'", '[', ']', '\\', '-', '=', '`'])

export function parseCombo(text: string): Combo | null {
  if (!text) return null
  const parts = text.split('+')
  // a literal "+" key is written "Mod++"
  const key = text.endsWith('++') ? '+' : parts.pop()!
  const mods = text.endsWith('++') ? parts.slice(0, -1).filter(Boolean) : parts
  const c: Combo = { mod: false, ctrl: false, alt: false, shift: false, key }
  for (const m of mods) {
    if (m === 'Mod') c.mod = true
    else if (m === 'Ctrl') c.ctrl = true
    else if (m === 'Alt') c.alt = true
    else if (m === 'Shift') c.shift = true
    else return null
  }
  const keyOk = /^[A-Z0-9]$/.test(key) || PUNCT.has(key) || NAMED.has(key) || key === '+'
  return keyOk ? c : null
}

/** Canonical text: modifiers in a fixed order, so "Shift+Mod+K" and "Mod+Shift+K" compare equal. */
export function stringifyCombo(c: Combo): string {
  return [c.mod && 'Mod', c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift'].filter(Boolean).concat(c.key === '+' ? ['+'] : [c.key]).join('+')
}

export const normalizeCombo = (text: string): string => {
  const c = parseCombo(text)
  return c ? stringifyCombo(c) : ''
}

export interface KeyEventLike {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const CODE_PUNCT: Record<string, string> = { Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`' }

/**
 * The combo a key event represents, or null if it is only a modifier press.
 * With Option held, macOS changes `key` (Option+K gives "˚"), so the physical
 * key (`code`) is used then; otherwise `key` is used so non-QWERTY layouts
 * behave as printed on the keycaps.
 */
export function comboFromEvent(e: KeyEventLike, isMac: boolean): Combo | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'AltGraph', 'CapsLock'].includes(e.key)) return null
  let key: string
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (e.altKey && /^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (e.altKey && e.code in CODE_PUNCT) key = CODE_PUNCT[e.code]
  else if (e.key === ' ') key = 'Space'
  else if (e.key.length === 1) key = e.key.toUpperCase()
  else key = e.key
  // Shift turns "/" into "?" and "1" into "!": use the unshifted character so "Mod+Shift+/" stays expressible.
  if (e.shiftKey && !e.altKey && e.code in CODE_PUNCT) key = CODE_PUNCT[e.code]
  else if (e.shiftKey && !e.altKey && /^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  return { mod: isMac ? e.metaKey : e.ctrlKey, ctrl: isMac ? e.ctrlKey : false, alt: e.altKey, shift: e.shiftKey, key }
}

// ───────────────────────── rules ─────────────────────────

/** Combos the system or Electron already owns; binding them would break copy/paste or quitting. */
const RESERVED = new Set(['Mod+C', 'Mod+V', 'Mod+X', 'Mod+A', 'Mod+Z', 'Mod+Shift+Z', 'Mod+Q', 'Mod+W', 'Mod+M', 'Mod+H', 'Mod+R', 'Mod+Alt+I', 'Mod+Tab', 'Mod+Space'])

/** Returns why a combo can't be used, or null if it's fine. */
export function comboProblem(text: string): string | null {
  const c = parseCombo(text)
  if (!c) return 'That is not a valid shortcut.'
  const fKey = /^F([1-9]|1[0-2])$/.test(c.key)
  if (!c.mod && !c.ctrl && !c.alt && !fKey) return 'Include ⌘, ⌃ or ⌥ (or use a function key); a bare key would stop you typing.'
  if (c.shift && !c.mod && !c.ctrl && !c.alt && !fKey) return 'Shift alone is not enough; add ⌘, ⌃ or ⌥.'
  if (['Tab', 'Enter', 'Space'].includes(c.key) && !c.mod && !c.ctrl) return 'Pick a combination that includes ⌘ or ⌃ for that key.'
  if (RESERVED.has(stringifyCombo(c))) return 'That shortcut is reserved by the system (copy, paste, quit…).'
  return null
}

// ───────────────────────── resolving ─────────────────────────

/** overrides: commandId -> combo; '' means "explicitly unbound"; absent means default. */
export type Overrides = Record<string, string>

export function effectiveBindings(overrides: Overrides, actionIds: string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of COMMANDS) out[c.id] = c.id in overrides ? normalizeCombo(overrides[c.id]) : c.default
  for (const id of actionIds) out[ACTION_PREFIX + id] = normalizeCombo(overrides[ACTION_PREFIX + id] ?? '')
  return out
}

/** The command that currently owns `combo`, other than `exceptId`. */
export function findConflict(bindings: Record<string, string>, combo: string, exceptId: string): string | undefined {
  const want = normalizeCombo(combo)
  return want ? Object.keys(bindings).find((id) => id !== exceptId && bindings[id] === want) : undefined
}

/** Which command (if any) a key event triggers. */
export function matchEvent(bindings: Record<string, string>, e: KeyEventLike, isMac: boolean): string | undefined {
  const c = comboFromEvent(e, isMac)
  if (!c) return undefined
  const text = stringifyCombo(c)
  return Object.keys(bindings).find((id) => bindings[id] === text)
}

/** Sets or clears a binding, optionally taking the combo away from whoever had it. */
export function withBinding(overrides: Overrides, bindings: Record<string, string>, id: string, combo: string, steal = false): Overrides {
  const next = { ...overrides }
  const want = normalizeCombo(combo)
  const owner = want ? findConflict(bindings, want, id) : undefined
  if (owner) {
    if (!steal) throw new Error(`Already used by another command.`)
    next[owner] = ''
  }
  const def = COMMANDS.find((c) => c.id === id)?.default ?? ''
  if (want === def && !id.startsWith(ACTION_PREFIX)) delete next[id] // back to default: don't store it
  else next[id] = want
  return next
}

// ───────────────────────── display ─────────────────────────

const SYMBOL: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '↩', Space: 'Space' }

export function formatCombo(text: string, isMac: boolean): string {
  const c = parseCombo(text)
  if (!c) return ''
  if (isMac) return [c.ctrl && '⌃', c.alt && '⌥', c.shift && '⇧', c.mod && '⌘', SYMBOL[c.key] ?? c.key].filter(Boolean).join('')
  return [c.mod && 'Ctrl', c.ctrl && 'Meta', c.alt && 'Alt', c.shift && 'Shift', c.key.replace('Arrow', '')].filter(Boolean).join('+')
}
