import { Plus, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActionContext } from '@shared/types'
import { IconButton } from '@/components/ui'
import { cx } from '@/lib/util'
import { actionsFor, useActionsStore } from '@/stores/actions-store'
import { useUiStore } from '@/stores/ui-store'

/**
 * "⚡" menu listing the user's actions for this kind of thing (a project, a
 * port, a finding). Where space is tight it hides itself until the user has
 * defined at least one action of that scope.
 */
export function ActionMenu({ ctx, hideWhenEmpty = false, label = 'Actions' }: { ctx: ActionContext; hideWhenEmpty?: boolean; label?: string }): React.JSX.Element | null {
  // Select the stable list, then filter: a selector that builds a new array each call loops forever in Zustand 5.
  const all = useActionsStore((s) => s.actions)
  const actions = useMemo(() => actionsFor(all, ctx.scope), [all, ctx.scope])
  const request = useActionsStore((s) => s.request)
  const go = useUiStore((s) => s.go)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (hideWhenEmpty && actions.length === 0) return null
  return (
    <div ref={box} className="no-drag relative">
      <IconButton icon={Zap} label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className={cx(open && 'bg-cx-hover text-cx-text')} />
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-40 min-w-[220px] overflow-hidden rounded-xl border border-cx-border bg-cx-raised py-1 shadow-xl animate-pop">
          {actions.map((a) => (
            <button
              key={a.id}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void request(a, ctx)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-cx-hover"
            >
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="text-xs text-cx-faint">{a.kind}</span>
            </button>
          ))}
          {actions.length === 0 && <p className="px-3 py-2 text-sm text-cx-muted">No {ctx.scope} actions yet.</p>}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              go({ kind: 'machine', page: 'actions' })
            }}
            className="flex w-full items-center gap-2 border-t border-cx-border/70 px-3 py-1.5 text-left text-cx-accent-text hover:bg-cx-hover"
          >
            <Plus size={13} /> {actions.length === 0 ? 'Create an action…' : 'Manage actions…'}
          </button>
        </div>
      )}
    </div>
  )
}
