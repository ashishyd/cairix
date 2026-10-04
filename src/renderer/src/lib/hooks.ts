import { useEffect } from 'react'

/** Calls `onEscape` on Escape. `capture` lets an overlay win over a parent dialog. (From Vaultic.) */
export function useEscapeKey(onEscape: () => void, enabled = true, capture = false): void {
  useEffect(() => {
    if (!enabled) return
    function handle(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (capture) e.stopImmediatePropagation()
      onEscape()
    }
    window.addEventListener('keydown', handle, capture)
    return () => window.removeEventListener('keydown', handle, capture)
  }, [onEscape, enabled, capture])
}
