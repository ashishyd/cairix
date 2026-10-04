import { describe, expect, it } from 'vitest'
import { addWidget, availableToAdd, DEFAULT_DASHBOARD, MAX_WIDGETS, moveBefore, nudge, removeWidget, sanitize, setSize, WIDGETS, type DashboardItem } from '../src/shared/dashboard'
import { DEFAULT_SETTINGS, settingsPatchSchema, settingsSchema } from '../src/shared/settings'

const ids = (l: DashboardItem[]): string[] => l.map((i) => i.id)
const L: DashboardItem[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'stats', size: 'half' }))

describe('dashboard layout', () => {
  it('moves an item before another, to the end, and ignores nonsense', () => {
    expect(ids(moveBefore(L, 'd', 'a'))).toEqual(['d', 'a', 'b', 'c'])
    expect(ids(moveBefore(L, 'a', 'c'))).toEqual(['b', 'a', 'c', 'd'])
    expect(ids(moveBefore(L, 'a', null))).toEqual(['b', 'c', 'd', 'a'])
    expect(moveBefore(L, 'a', 'a')).toBe(L)
    expect(moveBefore(L, 'zzz', 'a')).toBe(L)
    expect(moveBefore(L, 'a', 'zzz')).toBe(L)
  })
  it('nudges one place and stops at the ends', () => {
    expect(ids(nudge(L, 'b', -1))).toEqual(['b', 'a', 'c', 'd'])
    expect(ids(nudge(L, 'b', 1))).toEqual(['a', 'c', 'b', 'd'])
    expect(nudge(L, 'a', -1)).toBe(L)
    expect(nudge(L, 'd', 1)).toBe(L)
  })
  it('never mutates its input', () => {
    const copy = JSON.stringify(L)
    moveBefore(L, 'd', 'a'); nudge(L, 'a', 1); removeWidget(L, 'a'); setSize(L, 'a', 'full'); addWidget(L, 'pinned', 'x')
    expect(JSON.stringify(L)).toBe(copy)
  })
  it('adds a widget at its default size, removes, and resizes', () => {
    const added = addWidget(DEFAULT_DASHBOARD.slice(0, 1), 'pinned', 'pinned-1')
    expect(added.at(-1)).toEqual({ id: 'pinned-1', type: 'pinned', size: WIDGETS.pinned.defaultSize })
    expect(ids(removeWidget(L, 'b'))).toEqual(['a', 'c', 'd'])
    expect(setSize(L, 'a', 'full')[0].size).toBe('full')
    expect(setSize(L, 'a', 'full')[1].size).toBe('half')
  })
  it('offers only widgets that are not on the dashboard yet', () => {
    expect(availableToAdd(DEFAULT_DASHBOARD)).toEqual(['pinned'])
    expect(availableToAdd([])).toHaveLength(Object.keys(WIDGETS).length)
  })
  it('caps the number of widgets', () => {
    const full = Array.from({ length: MAX_WIDGETS }, (_, i) => ({ id: `w${i}`, type: 'stats', size: 'half' as const }))
    expect(addWidget(full, 'pinned', 'one-more')).toBe(full)
  })
  it('sanitize drops duplicate ids and over-long lists but keeps unknown types', () => {
    const messy = [{ id: 'a', type: 'stats', size: 'half' as const }, { id: 'a', type: 'running', size: 'full' as const }, { id: 'future', type: 'from-a-newer-version', size: 'half' as const }]
    expect(sanitize(messy)).toEqual([messy[0], messy[2]])
  })
})

describe('dashboard in settings', () => {
  it('defaults to the standard layout and no pinned scripts', () => {
    expect(settingsSchema.parse({}).dashboard).toEqual(DEFAULT_DASHBOARD)
    expect(settingsSchema.parse({}).pinnedScripts).toEqual([])
    expect(DEFAULT_SETTINGS.dashboard).toBe(DEFAULT_DASHBOARD)
  })
  it('patching the layout does not reset other settings', () => {
    const patch = settingsPatchSchema.parse({ dashboard: [{ id: 'x', type: 'stats', size: 'full' }] })
    expect(Object.keys(patch)).toEqual(['dashboard'])
  })
  it('rejects a malformed layout instead of storing it', () => {
    expect(settingsPatchSchema.safeParse({ dashboard: [{ id: 'x', type: 'stats', size: 'huge' }] }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ dashboard: Array.from({ length: 25 }, (_, i) => ({ id: `${i}`, type: 's', size: 'half' })) }).success).toBe(false)
  })
})
