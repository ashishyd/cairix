import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MODULES, isModuleEnabled } from '@shared/modules'
import { ACCENTS, DEFAULT_SETTINGS, type Accent } from '@shared/settings-types'
import type { AppInfo } from '@shared/types'
import { cx } from '@/lib/util'
import { useSettingsStore } from '@/stores/settings-store'
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
