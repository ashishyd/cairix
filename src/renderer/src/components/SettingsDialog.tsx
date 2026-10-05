import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MODULES, isModuleEnabled } from '@shared/modules'
import { cleanTopic, LEVELS, LEVEL_HINT, LEVEL_LABEL, MAX_TOPICS, TOPIC_GROUPS } from '@shared/learn'
import { ACCENTS, DEFAULT_SETTINGS, type Accent } from '@shared/settings-types'
import type { AppInfo } from '@shared/types'
import { cx, errMsg } from '@/lib/util'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'
import { Button, Chip, Dialog, Segmented, Toggle } from './ui'

const ACCENT_SWATCH: Record<Accent, string> = {
  blue: '#3264D7',
  green: '#047857',
  amber: '#B45309',
  violet: '#7042DE',
  rose: '#CD2855',
  slate: '#586882'
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {hint && <p className="text-sm text-cx-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

/** Topics and level for Daily learn. */
function LearningSettings(): React.JSX.Element {
  const learn = useSettingsStore((s) => s.settings.learn)
  const patch = useSettingsStore((s) => s.patch)
  const [custom, setCustom] = useState('')
  const suggested = new Set(TOPIC_GROUPS.flatMap((g) => g.topics))
  const mine = learn.topics.filter((t) => !suggested.has(t))
  const full = learn.topics.length >= MAX_TOPICS

  const toggle = (t: string): void => void patch({ learn: { topics: learn.topics.includes(t) ? learn.topics.filter((x) => x !== t) : full ? learn.topics : [...learn.topics, t] } })
  const addCustom = (): void => {
    const t = cleanTopic(custom)
    if (!t || learn.topics.some((x) => x.toLowerCase() === t.toLowerCase()) || full) return setCustom('')
    void patch({ learn: { topics: [...learn.topics, t] } })
    setCustom('')
  }

  return (
    <>
      <Row title="Topics to learn" hint={`${learn.topics.length} of ${MAX_TOPICS} chosen. One topic is taught each day, in turn.`}>
        <span />
      </Row>
      <div className="space-y-3 px-4 pb-3">
        {TOPIC_GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-1 text-sm text-cx-muted">{g.title}</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={g.title}>
              {g.topics.map((t) => {
                const on = learn.topics.includes(t)
                return (
                  <button key={t} aria-pressed={on} disabled={!on && full} onClick={() => toggle(t)} className={cx('no-drag rounded-full border px-2.5 py-0.5 text-sm disabled:opacity-40', on ? 'border-cx-accent bg-cx-accent/12 text-cx-accent-text' : 'border-cx-border text-cx-muted hover:bg-cx-hover')}>{t}</button>
                )
              })}
            </div>
          </div>
        ))}
        <div>
          <p className="mb-1 text-sm text-cx-muted">Your own</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {mine.map((t) => <button key={t} aria-pressed onClick={() => toggle(t)} title="Remove" className="no-drag rounded-full border border-cx-accent bg-cx-accent/12 px-2.5 py-0.5 text-sm text-cx-accent-text">{t} ×</button>)}
            <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustom()} placeholder="Add a topic, e.g. Kubernetes" aria-label="Add your own topic" disabled={full} className="no-drag h-7 w-56 rounded-full border border-cx-border bg-cx-raised px-3 text-sm outline-none focus:border-cx-accent disabled:opacity-40" />
            <Button size="sm" onClick={addCustom} disabled={!custom.trim() || full}>Add</Button>
          </div>
        </div>
      </div>
      <Row title="Difficulty" hint={LEVEL_HINT[learn.level]}>
        <Segmented value={learn.level} onChange={(level) => void patch({ learn: { level } })} options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} />
      </Row>
      <Row title="Write today's lesson automatically" hint="When you open Daily learn and there is no lesson yet. Each lesson uses a little of your Claude plan.">
        <Toggle checked={learn.autoGenerate} onChange={(autoGenerate) => void patch({ learn: { autoGenerate } })} label="Write today's lesson automatically" />
      </Row>
    </>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mb-5">
      <h3 className="mb-1 cx-label">{title}</h3>
      <div className="divide-y divide-cx-border/70 rounded-xl border border-cx-border px-4">{children}</div>
    </section>
  )
}

/** Turns a key press into an Electron accelerator string like `CommandOrControl+Alt+K`. */
function toAccelerator(e: React.KeyboardEvent): string | null {
  const named: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc' }
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null
  const key = named[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  const mods = [(e.metaKey || e.ctrlKey) && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean)
  // A global shortcut without a modifier would hijack a normal key everywhere.
  return mods.length > 0 ? [...mods, key].join('+') : null
}

function HotkeyField({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return
          e.preventDefault()
          if (e.key === 'Escape') return setRecording(false)
          const acc = toAccelerator(e)
          if (acc) {
            onChange(acc)
            setRecording(false)
          }
        }}
        className={cx('no-drag min-w-[170px] rounded-lg border px-3 py-1.5 text-center font-mono text-sm', recording ? 'border-cx-accent text-cx-accent-text' : 'border-cx-border')}
      >
        {recording ? 'Press shortcut…' : value.replace('CommandOrControl', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, ' ') || 'None'}
      </button>
      <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_SETTINGS.globalHotkey)}>Reset</Button>
    </div>
  )
}

export function SettingsDialog(): React.JSX.Element {
  const setSettings = useUiStore((s) => s.setSettings)
  const { settings, patch } = useSettingsStore()
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => void window.cairix.app.info().then(setInfo), [])

  return (
    <Dialog title="Settings" onClose={() => setSettings(false)} width={600}>
      <Group title="Appearance">
        <Row title="Theme" hint="Follows macOS unless you choose.">
          <Segmented value={settings.theme} onChange={(theme) => void patch({ theme })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </Row>
        <Row title="Accent colour">
          <div className="flex gap-2" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button
                key={a}
                role="radio"
                aria-checked={settings.accent === a}
                aria-label={a}
                title={a}
                onClick={() => void patch({ accent: a })}
                style={{ background: ACCENT_SWATCH[a] }}
                className="no-drag flex h-6 w-6 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-cx-raised transition-transform hover:scale-110 data-[on=true]:ring-2 data-[on=true]:ring-cx-text/60"
                data-on={settings.accent === a}
              >
                {settings.accent === a && <Check size={13} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Density" hint="Row height in lists and tables.">
          <Segmented value={settings.density} onChange={(density) => void patch({ density })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
        </Row>
        <Row title="Text size" hint={`${settings.fontSize}px`}>
          <input type="range" min={12} max={16} step={1} value={settings.fontSize} onChange={(e) => void patch({ fontSize: Number(e.target.value) })} aria-label="Text size" className="no-drag w-40 accent-[rgb(var(--cx-accent))]" />
        </Row>
        <Row title="Translucent sidebar" hint="Uses macOS vibrancy. Takes effect for new windows.">
          <Toggle checked={settings.vibrancy} onChange={(vibrancy) => void patch({ vibrancy })} label="Translucent sidebar" />
        </Row>
      </Group>

      <Group title="Menu bar & shortcuts">
        <Row title="Show dev server count" hint="A number beside the Cairix icon in the menu bar.">
          <Toggle checked={settings.trayShowsPortCount} onChange={(trayShowsPortCount) => void patch({ trayShowsPortCount })} label="Show dev server count" />
        </Row>
        <Row title="Keyboard shortcuts" hint="Rebind any command, or give your own actions a key.">
          <Button size="sm" onClick={() => useUiStore.getState().setKeybindings(true)}>Customize…</Button>
        </Row>
        <Row title="Global shortcut" hint="Opens Cairix and the command palette from anywhere.">
          <HotkeyField value={settings.globalHotkey} onChange={(globalHotkey) => void patch({ globalHotkey })} />
        </Row>
      </Group>

      <Group title="Startup">
        <Row title="Open Cairix at login" hint="Starts quietly in the menu bar, without a window. Works in the installed app, not in a dev run.">
          <Toggle checked={settings.launchAtLogin} onChange={(launchAtLogin) => void patch({ launchAtLogin })} label="Open Cairix at login" />
        </Row>
      </Group>

      <Group title="Learning">
        <LearningSettings />
      </Group>

      <Group title="Notifications">
        <Row title="Notify me" hint="A macOS notification when a script fails or a long one finishes, and when an agent task or audit completes. Clicking it opens the right page.">
          <Toggle checked={settings.notifications.enabled} onChange={(enabled) => void patch({ notifications: { enabled } })} label="Notify me" />
        </Row>
        <Row title="Only when Cairix is in the background" hint="Stay quiet while a Cairix window is focused.">
          <Toggle checked={settings.notifications.onlyInBackground} disabled={!settings.notifications.enabled} onChange={(onlyInBackground) => void patch({ notifications: { onlyInBackground } })} label="Only when Cairix is in the background" />
        </Row>
        <Row title="Scripts and servers" hint="Failures, and runs that take 15 seconds or more.">
          <Toggle checked={settings.notifications.runs} disabled={!settings.notifications.enabled} onChange={(runs) => void patch({ notifications: { runs } })} label="Notify for scripts and servers" />
        </Row>
        <Row title="Agent tasks">
          <Toggle checked={settings.notifications.tasks} disabled={!settings.notifications.enabled} onChange={(tasks) => void patch({ notifications: { tasks } })} label="Notify for agent tasks" />
        </Row>
        <Row title="Audits">
          <Toggle checked={settings.notifications.audits} disabled={!settings.notifications.enabled} onChange={(audits) => void patch({ notifications: { audits } })} label="Notify for audits" />
        </Row>
        <Row title="Check that it works" hint="macOS may ask permission the first time. Allow it in System Settings → Notifications if you miss them.">
          <Button size="sm" onClick={() => void window.cairix.app.testNotification().then((ok) => (ok ? toast.success('Sent') : toast.error('Notifications are not available here.')), (e) => toast.error(errMsg(e)))}>Send a test</Button>
        </Row>
      </Group>

      <Group title="Code review">
        <Row title="Review with AI automatically" hint="When pending changes settle, send only the changed lines to your local Claude CLI. Uses your Claude quota. Instant checks always run, free.">
          <Toggle checked={settings.reviewWithAi} onChange={(reviewWithAi) => void patch({ reviewWithAi })} label="Review with AI automatically" />
        </Row>
      </Group>

      <Group title="Modules">
        {MODULES.map((m) => {
          const nested = m.id === 'changes' || m.id === 'tasks' || m.id === 'audit'
          return (
            <Row key={m.id} title={nested ? `↳ ${m.title}` : m.title} hint={m.description}>
              {m.status === 'planned' ? (
                <Chip>Planned</Chip>
              ) : (
                <Toggle
                  checked={isModuleEnabled(m, settings.enabledModules)}
                  onChange={(v) => void patch({ enabledModules: { [m.id]: v } })}
                  label={`Enable ${m.title}`}
                />
              )}
            </Row>
          )
        })}
      </Group>

      {info && (
        <p className="selectable pb-1 text-center text-xs text-cx-faint">
          {info.name} {info.version} · Electron {info.electron} · Node {info.node}
          <br />
          <span title="Settings and project list are stored here">{info.userDataPath}</span>
        </p>
      )}
    </Dialog>
  )
}
