import { Keyboard, RotateCcw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ACTION_PREFIX, COMMANDS, comboFromEvent, comboProblem, findConflict, formatCombo, stringifyCombo, withBinding } from '@shared/keybindings'
import { IS_MAC, useBindings } from '@/lib/commands'
import { cx, fuzzyScore } from '@/lib/util'
import { useActionsStore } from '@/stores/actions-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUiStore } from '@/stores/ui-store'
import { Button, Dialog, IconButton } from './ui'

interface Row {
  id: string
  title: string
  group: string
  def: string
}

/**
 * Keyboard shortcut editor. Click "Change", press the keys you want. It tells
 * you plainly if a combination can't be used (it would block typing, or the
 * system owns it) and, if another command has it, offers to take it over.
 */
export function KeybindingsDialog(): React.JSX.Element {
  const close = (): void => useUiStore.getState().setKeybindings(false)
  const setRecordingKey = useUiStore((s) => s.setRecordingKey)
  const overrides = useSettingsStore((s) => s.settings.keybindings)
  const patch = useSettingsStore((s) => s.patch)
  const bindings = useBindings()
  const actions = useActionsStore((s) => s.actions).filter((a) => a.scope === 'project')

  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null)
  const [conflict, setConflict] = useState<{ id: string; combo: string; owner: string } | null>(null)

  const rows: Row[] = useMemo(
    () => [
      ...COMMANDS.map((c) => ({ id: c.id, title: c.title, group: c.group, def: c.default })),
      ...actions.map((a) => ({ id: ACTION_PREFIX + a.id, title: a.name, group: 'Your actions', def: '' }))
    ],
    [actions]
  )
  const titleOf = (id: string): string => rows.find((r) => r.id === id)?.title ?? id
  const shown = rows.filter((r) => !query.trim() || fuzzyScore(`${r.title} ${r.group}`, query) >= 0)

  // While recording, the app-wide handler must not fire the keys being captured.
  useEffect(() => {
    setRecordingKey(recording !== null)
    return () => setRecordingKey(false)
  }, [recording, setRecordingKey])

  function stopRecording(): void {
    setRecording(null)
  }

  function apply(id: string, combo: string, steal = false): void {
    void patch({ keybindings: withBinding(overrides, bindings, id, combo, steal) })
    setProblem(null)
    setConflict(null)
    setRecording(null)
  }

  function onKey(e: React.KeyboardEvent, id: string): void {
    if (recording !== id) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') return stopRecording()
    const combo = comboFromEvent(e.nativeEvent, IS_MAC)
    if (!combo) return // only a modifier so far: keep waiting for the real key
    const text = stringifyCombo(combo)
    const bad = comboProblem(text)
    if (bad) return void (setProblem({ id, text: bad }), setConflict(null))
    const owner = findConflict(bindings, text, id)
    if (owner) return void (setConflict({ id, combo: text, owner }), setProblem(null))
    apply(id, text)
  }

  const isOverridden = (r: Row): boolean => r.id in overrides

  return (
    <Dialog
      title="Keyboard shortcuts"
      description="Click Change, then press the keys you want."
      width={640}
      onClose={() => (recording ? stopRecording() : close())}
      footer={
        <>
          <Button variant="ghost" icon={RotateCcw} disabled={Object.keys(overrides).length === 0} onClick={() => void patch({ keybindings: {} })}>Reset all</Button>
          <span className="flex-1" />
          <Button variant="primary" onClick={close}>Done</Button>
        </>
      }
    >
      <label className="no-drag mb-3 flex h-9 items-center gap-2 rounded-lg border border-cx-border bg-cx-raised px-3 focus-within:border-cx-accent">
        <Search size={14} className="text-cx-faint" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a command" aria-label="Find a command" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-cx-faint" />
      </label>

      {shown.length === 0 && <p className="py-8 text-center text-cx-muted">No commands match “{query}”.</p>}
      {['General', 'Navigate', 'Project', 'Your actions'].map((group) => {
        const list = shown.filter((r) => r.group === group)
        if (list.length === 0) return null
        return (
          <section key={group} className="mb-4">
            <h3 className="mb-1 cx-label">{group}</h3>
            <ul className="divide-y divide-cx-border/60 rounded-xl border border-cx-border">
              {list.map((r) => {
                const combo = bindings[r.id] ?? ''
                const rec = recording === r.id
                return (
                  <li key={r.id} className="px-4 py-2" data-command={r.id}>
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      <button
                        onClick={() => { setRecording(rec ? null : r.id); setProblem(null); setConflict(null) }}
                        onKeyDown={(e) => onKey(e, r.id)}
                        onBlur={() => rec && stopRecording()}
                        aria-label={rec ? `Press the new shortcut for ${r.title}` : `Change shortcut for ${r.title}`}
                        className={cx('no-drag min-w-[132px] rounded-lg border px-3 py-1 text-center text-sm font-medium', rec ? 'border-cx-accent text-cx-accent-text' : 'border-cx-border hover:bg-cx-hover', !combo && !rec && 'text-cx-faint')}
                      >
                        {rec ? 'Press keys…' : combo ? formatCombo(combo, IS_MAC) : 'Not set'}
                      </button>
                      <span className="flex w-[56px] justify-end">
                        {isOverridden(r) && <IconButton icon={RotateCcw} size={13} label={`Reset ${r.title} to default`} onClick={() => apply(r.id, r.def)} />}
                        {combo && <IconButton icon={X} size={13} label={`Clear shortcut for ${r.title}`} onClick={() => apply(r.id, '')} />}
                      </span>
                    </div>
                    {problem?.id === r.id && <p className="mt-1.5 text-sm text-cx-danger" role="alert">{problem.text}</p>}
                    {conflict?.id === r.id && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-cx-warning" role="alert">
                        {formatCombo(conflict.combo, IS_MAC)} is already used by “{titleOf(conflict.owner)}”.
                        <Button size="sm" onClick={() => apply(r.id, conflict.combo, true)}>Use it here instead</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>Keep as is</Button>
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {actions.length === 0 && !query && (
        <p className="flex items-start gap-2 text-sm text-cx-faint"><Keyboard size={13} className="mt-0.5 shrink-0" /> Create a project action under Actions and it appears here, ready to be given a shortcut.</p>
      )}
    </Dialog>
  )
}
