import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContributionKind, RenderContext, UiNode, UiTone } from '@shared/plugins'
import { Button, Chip } from '@/components/ui'
import { cx, errMsg } from '@/lib/util'
import { toast } from '@/stores/toast-store'

const TEXT_TONE: Record<UiTone, string> = { neutral: 'text-cx-text', accent: 'text-cx-accent-text', success: 'text-cx-success', warning: 'text-cx-warning', danger: 'text-cx-danger' }
const CHIP_TONE: Record<UiTone, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = { neutral: 'neutral', accent: 'accent', success: 'success', warning: 'warning', danger: 'danger' }

type Act = (action: string, payload?: string) => void

/**
 * Draws a plugin's declarative UI with Cairix's own components. The tree was
 * validated in main (known node types only, https-only links, size caps), and
 * nothing here ever renders plugin-supplied HTML.
 */
export function UiRenderer({ node, onAction, busy }: { node: UiNode; onAction: Act; busy: boolean }): React.JSX.Element | null {
  switch (node.type) {
    case 'text':
      return <p className={cx('whitespace-pre-wrap', node.muted ? 'text-cx-muted' : TEXT_TONE[node.tone ?? 'neutral'])}>{node.text}</p>
    case 'heading':
      return <h3 className="text-md font-semibold">{node.text}</h3>
    case 'metric':
      return (
        <div className="rounded-xl bg-cx-surface p-3.5">
          <span className="block text-cx-muted">{node.label}</span>
          <span className="mt-1 block text-2xl font-semibold leading-none tracking-tight tabular-nums">{node.value}</span>
          {node.sub && <span className="mt-1.5 block text-sm text-cx-faint">{node.sub}</span>}
        </div>
      )
    case 'badge':
      return <Chip tone={CHIP_TONE[node.tone ?? 'neutral']}>{node.text}</Chip>
    case 'progress':
      return (
        <div>
          {node.label && <p className="mb-1 text-sm text-cx-muted">{node.label}</p>}
          <div className="h-2 overflow-hidden rounded-full bg-cx-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(node.value * 100)}>
            <div className="h-full rounded-full bg-cx-accent" style={{ width: `${Math.round(node.value * 100)}%` }} />
          </div>
        </div>
      )
    case 'link':
      return (
        <button className="no-drag text-left text-cx-accent-text hover:underline" onClick={() => void window.cairix.app.openExternal(node.url).catch((e) => toast.error(errMsg(e)))}>
          {node.text}
        </button>
      )
    case 'button':
      return <Button size="sm" variant={node.variant === 'primary' ? 'primary' : 'secondary'} disabled={busy} onClick={() => onAction(node.action, node.payload)}>{node.label}</Button>
    case 'list':
      return node.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-cx-border p-3 text-cx-muted">{node.empty ?? 'Nothing here.'}</p>
      ) : (
        <ul>
          {node.items.map((it, i) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{it.title}</span>
                  {it.subtitle && <span className="block truncate text-sm text-cx-faint">{it.subtitle}</span>}
                </span>
                {it.badge && <Chip tone={CHIP_TONE[it.tone ?? 'neutral']}>{it.badge}</Chip>}
              </>
            )
            const cls = 'no-drag flex w-full items-center gap-2.5 border-b border-cx-border/60 px-1 py-2 text-left last:border-0'
            return (
              <li key={i}>
                {it.action ? (
                  <button disabled={busy} onClick={() => onAction(it.action!, it.payload)} className={cx(cls, 'rounded-md hover:bg-cx-hover/50')}>{body}</button>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )
    case 'stack':
      return (
        <div className={cx('flex gap-3', node.direction === 'row' ? 'flex-row flex-wrap items-center' : 'flex-col')}>
          {node.children.map((c, i) => <UiRenderer key={i} node={c} onAction={onAction} busy={busy} />)}
        </div>
      )
  }
}

const REFRESH_MS = 10_000

/** Asks a plugin to draw a widget or tab, keeps it fresh, and routes clicks back to the plugin. */
export function PluginView({ pluginId, kind, contribId, ctx = {} }: { pluginId: string; kind: ContributionKind; contribId: string; ctx?: RenderContext }): React.JSX.Element {
  const [tree, setTree] = useState<UiNode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const projectId = ctx.projectId
  const live = useRef(true)

  const render = useCallback(async () => {
    try {
      const t = await window.cairix.plugins.render(pluginId, kind, contribId, { projectId })
      if (live.current) (setTree(t), setError(null))
    } catch (e) {
      if (live.current) setError(errMsg(e))
    }
  }, [pluginId, kind, contribId, projectId])

  useEffect(() => {
    live.current = true
    setTree(null)
    void render()
    const t = setInterval(() => !document.hidden && void render(), REFRESH_MS)
    return () => {
      live.current = false
      clearInterval(t)
    }
  }, [render])

  const act: Act = (action, payload) => {
    setBusy(true)
    window.cairix.plugins
      .action(pluginId, kind, contribId, action, payload, { projectId })
      .then((t) => live.current && (setTree(t), setError(null)))
      .catch((e) => live.current && setError(errMsg(e)))
      .finally(() => live.current && setBusy(false))
  }

  if (error) return <p className="flex items-start gap-2 rounded-lg bg-cx-warning/12 p-3 text-cx-warning" role="alert"><TriangleAlert size={15} className="mt-0.5 shrink-0" />{error}</p>
  if (!tree) return <p className="text-cx-faint">Loading…</p>
  return <UiRenderer node={tree} onAction={act} busy={busy} />
}
