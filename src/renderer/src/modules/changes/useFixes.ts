import { useCallback, useState } from 'react'
import type { Finding, FixProposal } from '@shared/types'
import { errMsg } from '@/lib/util'
import { toast } from '@/stores/toast-store'
import type { Work } from './FindingCard'

/**
 * The prepare → preview → apply → undo flow shared by the Changes and Audit
 * tabs. `prepare` is whichever IPC call builds the proposal; apply/undo are
 * common because both tabs share one proposal store in main.
 */
export function useFixes(prepare: (findingId: string) => Promise<FixProposal>, onChanged: () => void) {
  const [work, setWork] = useState<Record<string, Work>>({})
  const [applied, setApplied] = useState<FixProposal[]>([])
  const set = (id: string, w: Work): void => setWork((cur) => ({ ...cur, [id]: w }))

  const fix = useCallback(
    async (f: Finding) => {
      set(f.id, { busy: 'preparing' })
      try {
        set(f.id, { proposal: await prepare(f.id) })
      } catch (e) {
        set(f.id, { error: errMsg(e) })
      }
    },
    [prepare]
  )

  const apply = useCallback(
    async (f: Finding) => {
      const p = work[f.id]?.proposal
      if (!p) return
      set(f.id, { proposal: p, busy: 'applying' })
      try {
        const done = await window.cairix.changes.apply(p.id)
        setApplied((a) => [done, ...a])
        set(f.id, {})
        toast.success(`Applied to ${done.files.join(', ')}`)
        onChanged()
      } catch (e) {
        set(f.id, { proposal: p, error: errMsg(e) })
      }
    },
    [work, onChanged]
  )

  const undo = useCallback(
    async (p: FixProposal) => {
      try {
        await window.cairix.changes.undo(p.id)
        setApplied((a) => a.filter((x) => x.id !== p.id))
        toast.success('Fix undone')
        onChanged()
      } catch (e) {
        toast.error(errMsg(e))
      }
    },
    [onChanged]
  )

  const discard = useCallback((id: string) => set(id, {}), [])
  const reset = useCallback(() => {
    setWork({})
    setApplied([])
  }, [])
  return { work, applied, fix, apply, undo, discard, reset }
}
