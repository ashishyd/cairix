import { ArrowDown, ArrowUp, GripVertical, LayoutGrid, Maximize2, Minimize2, Plus, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { addWidget, availableToAdd, DEFAULT_DASHBOARD, isWidgetType, moveBefore, nudge, removeWidget, setSize, WIDGETS, type DashboardItem } from '@shared/dashboard'
import { Button, IconButton } from '@/components/ui'
import { contributionKey } from '@shared/plugins'
import { PluginView } from '@/modules/plugins/PluginView'
import { usePluginsStore } from '@/stores/plugins-store'
import { cx } from '@/lib/util'
import { useSettingsStore } from '@/stores/settings-store'
import { WIDGET_COMPONENTS } from './widgets'

/**
 * The Home dashboard. In normal use it is just the widgets. "Customize" turns
 * on edit mode: drag a card (or use the arrow buttons, which work from the
 * keyboard) to reorder, switch between half and full width, remove, or add
 * from the gallery. Changes save instantly with the rest of your settings.
 */
export function Dashboard(): React.JSX.Element {
  const layout = useSettingsStore((s) => s.settings.dashboard)
  const patch = useSettingsStore((s) => s.patch)
  const [editing, setEditing] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null | 'end'>(null)
  const [gallery, setGallery] = useState(false)
  const plugins = usePluginsStore((st) => st.plugins)
  // Widgets contributed by running plugins, keyed "plugin:<id>:<widget>".
  const pluginWidgets = plugins.filter((p) => p.state === 'running').flatMap((p) => p.manifest.contributes.widgets.map((w) => ({ key: contributionKey(p.manifest.id, w.id), pluginId: p.manifest.id, id: w.id, title: w.title, description: w.description ?? `From ${p.manifest.name}`, size: w.size ?? 'half' as const })))

  const save = (next: DashboardItem[]): void => void patch({ dashboard: next })
  const drop = (target: string | null): void => {
    if (dragId) save(moveBefore(layout, dragId, target))
    setDragId(null)
    setOverId(null)
  }
  const addable = availableToAdd(layout)
  const addablePlugin = pluginWidgets.filter((w) => !layout.some((i) => i.type === w.key))
  // Unknown types (from a newer version) stay in the saved layout but are not drawn.
  // A plugin widget is drawn only while its plugin is running; otherwise it stays saved but hidden.
  const shown = layout.filter((i) => isWidgetType(i.type) || pluginWidgets.some((w) => w.key === i.type))

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
        {editing && (
          <>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => save(DEFAULT_DASHBOARD)}>Reset layout</Button>
            <div className="relative">
              <Button size="sm" icon={Plus} disabled={addable.length + addablePlugin.length === 0} onClick={() => setGallery(!gallery)} aria-expanded={gallery}>Add widget</Button>
              {gallery && addable.length + addablePlugin.length > 0 && (
                <div role="menu" className="absolute right-0 top-9 z-30 w-72 overflow-hidden rounded-xl border border-cx-border bg-cx-raised py-1 shadow-xl animate-pop">
                  {addable.map((t) => (
                    <button key={t} role="menuitem" onClick={() => { save(addWidget(layout, t, `${t}-${Date.now().toString(36)}`)); setGallery(false) }} className="block w-full px-3 py-2 text-left hover:bg-cx-hover">
                      <span className="block font-medium">{WIDGETS[t].title}</span>
                      <span className="block text-sm text-cx-muted">{WIDGETS[t].description}</span>
                    </button>
                  ))}
                  {addablePlugin.map((w) => (
                    <button key={w.key} role="menuitem" onClick={() => { save([...layout, { id: `${w.pluginId}-${w.id}-${Date.now().toString(36)}`.slice(0, 40), type: w.key, size: w.size }]); setGallery(false) }} className="block w-full px-3 py-2 text-left hover:bg-cx-hover">
                      <span className="block font-medium">{w.title} <span className="text-xs font-normal text-cx-faint">plugin</span></span>
                      <span className="block text-sm text-cx-muted">{w.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <Button size="sm" variant={editing ? 'primary' : 'secondary'} icon={LayoutGrid} onClick={() => { setEditing(!editing); setGallery(false) }}>
          {editing ? 'Done' : 'Customize'}
        </Button>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-cx-border p-8 text-center text-cx-muted">Your dashboard is empty. Press Customize, then Add widget.</p>
      ) : (
        <div className="grid grid-cols-2 items-start gap-4">
          {shown.map((item, idx) => {
            const pw = pluginWidgets.find((w) => w.key === item.type)
            const meta = pw ? { title: pw.title } : WIDGETS[item.type as keyof typeof WIDGETS]
            const Body = pw ? () => <PluginView pluginId={pw.pluginId} kind="widget" contribId={pw.id} /> : WIDGET_COMPONENTS[item.type as keyof typeof WIDGET_COMPONENTS]
            const i = layout.findIndex((x) => x.id === item.id)
            return (
              <section
                key={item.id}
                aria-label={meta.title}
                draggable={editing}
                onDragStart={(e) => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id) }}
                onDragEnd={() => { setDragId(null); setOverId(null) }}
                onDragOver={(e) => { if (editing && dragId) { e.preventDefault(); setOverId(item.id) } }}
                onDrop={(e) => { e.preventDefault(); drop(item.id) }}
                className={cx(
                  'rounded-2xl border bg-cx-raised p-4 transition-shadow',
                  item.size === 'full' ? 'col-span-2' : 'col-span-1',
                  editing ? 'cursor-grab border-dashed border-cx-border' : 'border-cx-border',
                  dragId === item.id && 'opacity-40',
                  overId === item.id && dragId !== item.id && 'ring-2 ring-cx-accent'
                )}
              >
                <header className="mb-3 flex items-center gap-1.5">
                  {editing && <GripVertical size={15} className="-ml-1 shrink-0 text-cx-faint" aria-hidden />}
                  <h2 className="flex-1 cx-label">{meta.title}</h2>
                  {editing && (
                    <>
                      <IconButton icon={ArrowUp} label={`Move ${meta.title} up`} size={13} disabled={idx === 0} onClick={() => save(nudge(layout, item.id, -1))} />
                      <IconButton icon={ArrowDown} label={`Move ${meta.title} down`} size={13} disabled={i === layout.length - 1} onClick={() => save(nudge(layout, item.id, 1))} />
                      <IconButton icon={item.size === 'full' ? Minimize2 : Maximize2} label={item.size === 'full' ? `Make ${meta.title} half width` : `Make ${meta.title} full width`} size={13} onClick={() => save(setSize(layout, item.id, item.size === 'full' ? 'half' : 'full'))} />
                      <IconButton icon={X} label={`Remove ${meta.title}`} size={13} tone="danger" onClick={() => save(removeWidget(layout, item.id))} />
                    </>
                  )}
                </header>
                <div className={cx(editing && 'pointer-events-none select-none')}>
                  <Body />
                </div>
              </section>
            )
          })}
        </div>
      )}
      {editing && dragId && (
        <div onDragOver={(e) => { e.preventDefault(); setOverId('end') }} onDrop={(e) => { e.preventDefault(); drop(null) }} className={cx('mt-4 rounded-xl border-2 border-dashed p-4 text-center text-cx-muted', overId === 'end' ? 'border-cx-accent text-cx-accent-text' : 'border-cx-border')}>
          Drop here to move to the end
        </div>
      )}
    </div>
  )
}
