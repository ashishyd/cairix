import { FolderSearch, Package, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DiscoveryPreview, Project } from '@shared/types'
import { cx, errMsg } from '@/lib/util'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'
import { Button, Chip, Dialog } from './ui'

function depthOf(p: Project, byId: Map<string, Project>): number {
  let d = 0
  for (let cur = p; cur.parentId && byId.has(cur.parentId); cur = byId.get(cur.parentId)!) d++
  return d
}

const KIND_LABEL: Record<string, string> = { node: 'Node', python: 'Python', rust: 'Rust', go: 'Go', compose: 'Compose', make: 'Make' }

/**
 * Pick a folder, preview what Cairix found inside it (nested apps included),
 * let the user untick anything, then add. The native dialog is the only way
 * to choose a path, so the renderer can't make main crawl a folder it invented.
 */
export function AddFolderDialog(): React.JSX.Element | null {
  const setAddFolder = useUiStore((s) => s.setAddFolder)
  const go = useUiStore((s) => s.go)
  const [phase, setPhase] = useState<'picking' | 'scanning' | 'preview' | 'adding'>('picking')
  const [preview, setPreview] = useState<DiscoveryPreview | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [trusted, setTrusted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = (): void => setAddFolder(false)

  async function pick(): Promise<void> {
    setError(null)
    setPhase('picking')
    try {
      const path = await window.cairix.projects.pickFolder()
      if (!path) return close()
      setPhase('scanning')
      const found = await window.cairix.projects.preview(path)
      setPreview(found)
      setExcluded(new Set())
      setPhase('preview')
    } catch (e) {
      setError(errMsg(e))
      setPhase('preview')
      setPreview(null)
    }
  }

  useEffect(() => {
    void pick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const byId = useMemo(() => new Map((preview?.projects ?? []).map((p) => [p.id, p])), [preview])
  const selected = (preview?.projects.length ?? 0) - excluded.size

  async function add(): Promise<void> {
    if (!preview) return
    setPhase('adding')
    try {
      const ws = await window.cairix.projects.add({ path: preview.rootPath, excludedPaths: [...excluded], trusted })
      toast.success(`Added ${ws.name}: ${ws.projects.length} project${ws.projects.length === 1 ? '' : 's'}`)
      const first = ws.projects[0]
      if (first) go({ kind: 'project', projectId: first.id, tab: 'scripts' })
      close()
    } catch (e) {
      setError(errMsg(e))
      setPhase('preview')
    }
  }

  // The native folder picker is modal and visible on its own; show nothing behind it.
  if (phase === 'picking') return null

  return (
    <Dialog
      title="Add a folder"
      description={preview ? undefined : 'Pick a project, or a folder that holds several.'}
      onClose={close}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={() => void pick()}>Choose another…</Button>
          <span className="flex-1" />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" busy={phase === 'adding' || phase === 'scanning'} disabled={!preview || selected === 0} onClick={() => void add()}>
            {selected > 0 ? `Add ${selected} project${selected === 1 ? '' : 's'}` : 'Add'}
          </Button>
        </>
      }
    >
      {phase === 'scanning' && (
        <p className="flex items-center gap-2 py-10 text-cx-muted">
          <FolderSearch size={16} className="animate-pulse2" /> Looking for projects…
        </p>
      )}

      {error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-cx-danger/30 bg-cx-danger/8 p-3 text-cx-danger" role="alert">
          <TriangleAlert size={16} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {preview && (
        <div className="animate-fade">
          <div className="mb-3">
            <p className="text-md font-semibold">{preview.name}</p>
            <p className="selectable truncate text-sm text-cx-muted" title={preview.rootPath}>{preview.rootPath}</p>
          </div>

          {preview.alreadyAdded && <p className="mb-3 rounded-lg bg-cx-accent/10 p-2.5 text-cx-accent-text">This folder is already in Cairix. Adding it again rescans it.</p>}
          {preview.truncated && <p className="mb-3 rounded-lg bg-cx-warning/12 p-2.5 text-cx-warning">This folder is very large, so the scan stopped early. Pick a more specific folder for a complete list.</p>}

          {preview.projects.length === 0 ? (
            <p className="py-8 text-center text-cx-muted">No projects found here. Cairix looks for package.json, pyproject.toml, requirements.txt, Cargo.toml, go.mod, Compose files and git repos.</p>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-cx-muted">{preview.projects.length} found{selected !== preview.projects.length && ` · ${selected} selected`}</span>
                <span className="flex gap-3 text-sm text-cx-accent-text">
                  <button onClick={() => setExcluded(new Set())}>Select all</button>
                  <button onClick={() => setExcluded(new Set(preview.projects.map((p) => p.path)))}>None</button>
                </span>
              </div>
              <ul className="max-h-[300px] overflow-y-auto rounded-xl border border-cx-border">
                {preview.projects.map((p) => {
                  const on = !excluded.has(p.path)
                  return (
                    <li key={p.id} className="border-b border-cx-border/60 last:border-0">
                      <label className="flex cursor-pointer items-center gap-2.5 py-2 pr-3 hover:bg-cx-hover/50" style={{ paddingLeft: 12 + depthOf(p, byId) * 18 }}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setExcluded((prev) => {
                            const next = new Set(prev)
                            if (on) next.add(p.path)
                            else next.delete(p.path)
                            return next
                          })}
                          className="h-3.5 w-3.5 accent-[rgb(var(--cx-accent))]"
                        />
                        <Package size={14} className="shrink-0 text-cx-muted" />
                        <span className={cx('min-w-0 flex-1 truncate', !on && 'text-cx-faint line-through')}>{p.relPath || preview.name}</span>
                        {p.isMonorepoRoot && <Chip tone="accent">monorepo</Chip>}
                        {p.kinds.map((k) => <Chip key={k}>{KIND_LABEL[k]}</Chip>)}
                      </label>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          <label className={cx('mt-4 flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors', trusted ? 'border-cx-success/40 bg-cx-success/8 hover:bg-cx-success/12' : 'border-cx-warning/40 bg-cx-warning/8 hover:bg-cx-warning/12')}>
            <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[rgb(var(--cx-accent))]" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <ShieldAlert size={14} className={trusted ? 'text-cx-success' : 'text-cx-warning'} />
                {trusted ? 'This folder will be trusted' : 'Trust this folder to unlock Run, Tasks and Audit'}
              </span>
              <span className="mt-0.5 block text-cx-muted">A script can run any code, so only trust folders you wrote or have read. You can change this any time from the project header.</span>
            </span>
          </label>
        </div>
      )}
    </Dialog>
  )
}
