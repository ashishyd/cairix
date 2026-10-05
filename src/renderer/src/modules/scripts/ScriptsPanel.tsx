import { Pin, PinOff, ChevronDown, ChevronRight, ExternalLink, Play, FolderSync, Repeat, RotateCw, ShieldAlert, Square, Terminal as TerminalIcon, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PortConflict, PortEntry, RunInfo, ScriptCategory, ScriptDef } from '@shared/types'
import { Button, Chip, Dialog, EmptyState, IconButton, StatusDot } from '@/components/ui'
import { formatEnvLines, parseEnvLines } from '@shared/args'
import { cx, errMsg, formatKb, parseArgs } from '@/lib/util'
import type { ProjectTabProps } from '@/modules/registry'
import { usePortsStore } from '@/stores/ports-store'
import { useProjectsStore } from '@/stores/projects-store'
import { isActive, runForScript, useScriptsStore } from '@/stores/scripts-store'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'
import { LogView } from './LogView'

const GROUPS: Array<{ key: ScriptCategory; title: string }> = [
  { key: 'dev', title: 'Run' },
  { key: 'build', title: 'Build' },
  { key: 'test', title: 'Test' },
  { key: 'lint', title: 'Lint & types' },
  { key: 'db', title: 'Database' },
  { key: 'other', title: 'Other' }
]

const SOURCE_LABEL: Record<ScriptDef['source'], string> = {
  'package.json': 'package.json',
  pyproject: 'pyproject.toml',
  'manage.py': 'Django',
  makefile: 'Makefile',
  'python-file': 'Python',
  compose: 'Compose',
  toolchain: 'toolchain'
}

function runStatusChip(run: RunInfo): React.JSX.Element | null {
  if (isActive(run)) return null
  if (run.status === 'failed') return <Chip tone="danger">Failed{run.exitCode != null ? ` · exit ${run.exitCode}` : ''}</Chip>
  if (run.status === 'stopped') return <Chip>Stopped</Chip>
  return <Chip tone="success">Done</Chip>
}

function ScriptRow({
  script,
  run,
  entries,
  trusted,
  selected,
  onSelect
}: {
  script: ScriptDef
  run: RunInfo | undefined
  entries: PortEntry[]
  trusted: boolean
  selected: boolean
  onSelect: (runId: string | null) => void
}): React.JSX.Element {
  const { run: start, stop } = useScriptsStore()
  const setKillTarget = useUiStore((s) => s.setKillTarget)
  const pinned = useSettingsStore((st) => st.settings.pinnedScripts.includes(script.id))
  const autoRestart = useSettingsStore((st) => st.settings.autoRestartScripts.includes(script.id))
  const patchSettings = useSettingsStore((st) => st.patch)
  const cfg = useScriptsStore((st) => st.configs[script.id])
  const saveConfig = useScriptsStore((st) => st.saveConfig)
  const watching = !!cfg?.watch
  const [argText, setArgText] = useState(cfg?.args ?? '')
  const [envText, setEnvText] = useState(formatEnvLines(cfg?.env ?? {}))
  // Saved defaults load after the first render and change when saved; show what is stored.
  const savedArgs = cfg?.args ?? ''
  const savedEnv = formatEnvLines(cfg?.env ?? {})
  useEffect(() => setArgText(savedArgs), [savedArgs])
  useEffect(() => setEnvText(savedEnv), [savedEnv])
  const dirty = argText.trim() !== savedArgs || envText.trim() !== savedEnv
  const [argsOpen, setArgsOpen] = useState(false)
  const active = !!run && isActive(run)
  const mine = run ? entries.filter((e) => e.runId === run.runId) : []
  const memKb = [...new Map(mine.map((e) => [e.footprintPid, e.treeRssKb]))].reduce((a, [, kb]) => a + kb, 0)
  // Who is holding the port this run complained about (subscribed unconditionally: hooks can't be conditional).
  const conflictPort = run?.portConflict
  const conflictEntry = usePortsStore((s) => (conflictPort ? s.snapshot?.entries.find((e) => e.port === conflictPort) : undefined))

  const [conflicts, setConflicts] = useState<PortConflict[] | null>(null)
  const [freeing, setFreeing] = useState(false)

  /** Starts the script, first checking that the port it will use is free (skipped when we just freed it). */
  async function go(skipCheck = false): Promise<void> {
    const args = parseArgs(argText)
    if (skipCheck !== true) {
      try {
        const clash = await window.cairix.scripts.checkPorts(script.id, args)
        if (clash.length > 0) return setConflicts(clash)
      } catch {
        /* the check is advice; never let it stop a run */
      }
    }
    const r = await start(script.id, args)
    if (r) onSelect(r.runId)
  }

  async function stopHoldersAndRun(): Promise<void> {
    if (!conflicts) return
    setFreeing(true)
    try {
      for (const c of conflicts) {
        const r = await window.cairix.ports.kill({ pid: c.pid })
        if (!r.ok) throw new Error(r.stillAlive.length > 0 ? `${c.holder} did not stop. Use the Ports page to force quit it.` : (r.error ?? `Could not stop ${c.holder}.`))
      }
      setConflicts(null)
      await go(true)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setFreeing(false)
    }
  }

  async function restart(): Promise<void> {
    if (!run) return
    await stop(run.runId)
    // Wait for the old process group to be gone before starting a new one on the same port.
    const gone = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => (unsub(), resolve(false)), 8000)
      const unsub = useScriptsStore.subscribe((s) => {
        const cur = s.runs[run.runId]
        if (!cur || !isActive(cur)) (clearTimeout(t), unsub(), resolve(true))
      })
    })
    if (gone) await go(true)
    else toast.error('The old process did not exit in time. Stop it from the Ports page.')
  }

  async function saveDefaults(): Promise<void> {
    let env: Record<string, string>
    try {
      env = parseEnvLines(envText)
    } catch (e) {
      return void toast.error(errMsg(e))
    }
    if (await saveConfig(script.id, { args: argText.trim(), env, watch: watching })) toast.success(`Saved defaults for ${script.name}`)
  }

  async function openTerminal(): Promise<void> {
    try {
      await window.cairix.scripts.openInTerminal({ scriptId: script.id, args: parseArgs(argText) })
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  return (
    <div className={cx('border-b border-cx-border/60 last:border-0', selected && 'bg-cx-accent/6')}>
      <div className="group flex items-center gap-3 px-4" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
        <button onClick={() => setArgsOpen(!argsOpen)} aria-label={argsOpen ? 'Hide arguments' : 'Add arguments'} aria-expanded={argsOpen} title="Arguments" className="text-cx-faint hover:text-cx-text">
          {argsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {run && <StatusDot tone={active ? 'success' : run.status === 'failed' ? 'danger' : 'muted'} pulse={active} />}
            <span className="truncate font-mono text-base font-medium">{script.name}</span>
            {run && runStatusChip(run)}
            {run?.autoRestarts ? <Chip tone="warning" title="Cairix restarted this after a crash">auto-restarted ×{run.autoRestarts}</Chip> : null}
            {autoRestart && !run?.autoRestarts && <Chip title="Restarts by itself if it crashes">auto-restart</Chip>}
            {watching && <Chip title="Restarts when files in this project change">watching</Chip>}
            {(savedArgs || savedEnv) && <Chip title={savedEnv ? 'Has saved arguments or environment variables' : 'Has saved arguments'}>defaults</Chip>}
            {script.needsTty && <Chip tone="warning" title="Probably asks questions, so it works best in a real terminal">interactive</Chip>}
          </div>
          <p className="mt-0.5 truncate pl-0 font-mono text-xs text-cx-faint" title={script.command}>{script.command}</p>
        </div>

        {active && run && (
          <div className="flex items-center gap-2 text-sm text-cx-muted">
            {run.ports.map((p) => (
              <button key={p} onClick={() => void window.cairix.app.openExternal(`http://localhost:${p}`).catch((e) => toast.error(errMsg(e)))} title={`Open localhost:${p}`} className="inline-flex items-center gap-1 rounded-md bg-cx-success/12 px-1.5 py-px font-mono font-medium text-cx-success hover:bg-cx-success/20">
                :{p} <ExternalLink size={10} />
              </button>
            ))}
            {memKb > 0 && <span className="tabular-nums">{formatKb(memKb)}</span>}
          </div>
        )}

        <Chip className="hidden xl:inline-flex">{SOURCE_LABEL[script.source]}</Chip>

        <div className="flex items-center gap-1">
          <IconButton
            icon={FolderSync}
            label={watching ? 'Stop restarting when files change' : 'Restart when files change'}
            aria-pressed={watching}
            onClick={() => void saveConfig(script.id, { args: savedArgs, env: cfg?.env ?? {}, watch: !watching })}
            className={watching ? 'bg-cx-accent/12 text-cx-accent-text' : undefined}
          />
          <IconButton
            icon={Repeat}
            label={autoRestart ? 'Turn off auto-restart' : 'Restart automatically if it crashes'}
            aria-pressed={autoRestart}
            onClick={() => {
              const cur = useSettingsStore.getState().settings.autoRestartScripts
              void patchSettings({ autoRestartScripts: autoRestart ? cur.filter((x) => x !== script.id) : [...cur, script.id] })
            }}
            className={autoRestart ? 'bg-cx-accent/12 text-cx-accent-text' : undefined}
          />
          <IconButton
            icon={pinned ? PinOff : Pin}
            label={pinned ? 'Unpin from Home' : 'Pin to Home'}
            onClick={() => {
              const cur = useSettingsStore.getState().settings.pinnedScripts
              void patchSettings({ pinnedScripts: pinned ? cur.filter((x) => x !== script.id) : [...cur, script.id] })
            }}
            className={pinned ? 'text-cx-accent-text' : undefined}
          />
          {run && (
            <Button size="sm" variant="ghost" onClick={() => onSelect(selected ? null : run.runId)}>
              {selected ? 'Hide log' : 'Log'}
            </Button>
          )}
          {active && run ? (
            <>
              <IconButton icon={RotateCw} label="Restart" onClick={() => void restart()} />
              <Button size="sm" variant="secondary" icon={Square} busy={run.status === 'stopping'} onClick={() => void stop(run.runId)}>
                Stop
              </Button>
            </>
          ) : script.needsTty ? (
            <>
              <Button size="sm" variant="primary" icon={TerminalIcon} disabled={!trusted} onClick={() => void openTerminal()} title={trusted ? 'Run in Terminal.app' : 'Trust this folder first'}>
                Terminal
              </Button>
              <Button size="sm" variant="ghost" disabled={!trusted} onClick={() => void go()}>Run here</Button>
            </>
          ) : (
            <Button size="sm" variant="primary" icon={Play} disabled={!trusted} onClick={() => void go()} title={trusted ? `Run ${script.name}` : 'Trust this folder first'}>
              Run
            </Button>
          )}
        </div>
      </div>

      {argsOpen && (
        <div className="space-y-2 px-4 pb-3 pl-11 animate-fade">
          <div className="flex items-center gap-2">
            <span className="w-[130px] text-sm text-cx-muted">Extra arguments</span>
            <input
              value={argText}
              onChange={(e) => setArgText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !active && trusted && void go()}
              placeholder="--port 4000"
              aria-label={`Arguments for ${script.name}`}
              className="no-drag h-7 w-72 rounded-md border border-cx-border bg-cx-raised px-2 font-mono text-sm outline-none focus:border-cx-accent"
            />
          </div>
          <div className="flex items-start gap-2">
            <span className="w-[130px] pt-1 text-sm text-cx-muted">Environment</span>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              rows={Math.min(6, Math.max(2, envText.split('\n').length))}
              spellCheck={false}
              placeholder={'PORT=4000\nDEBUG=app:*'}
              aria-label={`Environment variables for ${script.name}`}
              className="no-drag w-72 resize-none rounded-md border border-cx-border bg-cx-raised px-2 py-1 font-mono text-sm outline-none focus:border-cx-accent"
            />
            <div className="flex flex-col gap-1.5 pt-0.5">
              <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void saveDefaults()}>Save as default</Button>
              {(savedArgs || savedEnv) && <Button size="sm" variant="ghost" onClick={() => void saveConfig(script.id, watching ? { args: '', env: {}, watch: true } : null)}>Clear defaults</Button>}
            </div>
          </div>
          <p className="pl-[138px] text-xs text-cx-faint">Used when you press Run, and by shortcuts and the Home dashboard. Added to the script's environment only. Stored on this Mac; keep real secrets in a .env file.</p>
        </div>
      )}

      {conflicts && (
        <Dialog
          title={conflicts.length === 1 ? `Port ${conflicts[0].port} is already in use` : 'Ports are already in use'}
          onClose={() => setConflicts(null)}
          width={500}
          footer={
            <>
              <Button onClick={() => setConflicts(null)} disabled={freeing}>Cancel</Button>
              <Button onClick={() => { setConflicts(null); void go(true) }} disabled={freeing}>Run anyway</Button>
              {conflicts.every((c) => !c.protected) && <Button variant="primary" busy={freeing} onClick={() => void stopHoldersAndRun()}>Stop it and run</Button>}
            </>
          }
        >
          <p className="mb-3 text-cx-muted"><span className="font-mono font-medium text-cx-text">{script.name}</span> will probably use {conflicts.length === 1 ? 'this port' : 'these ports'}, and something is already listening:</p>
          <ul className="space-y-2">
            {conflicts.map((c) => (
              <li key={c.port} className="rounded-lg border border-cx-border px-3 py-2">
                <p><span className="font-mono font-semibold">:{c.port}</span> held by <span className="font-medium">{c.holder}</span>{c.framework && c.framework !== c.holder ? ` (${c.framework})` : ''}{c.projectName ? <> from <span className="font-medium">{c.projectName}</span></> : null}</p>
                <p className="text-sm text-cx-faint">Expected because of {c.why}{c.protected ? ' · protected, Cairix will not stop it' : ''}</p>
                {c.hint && <p className="mt-1 text-sm text-cx-warning">{c.hint}</p>}
              </li>
            ))}
          </ul>
        </Dialog>
      )}

      {run?.portConflict && !active && (
        <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg bg-cx-warning/12 px-3 py-2 text-cx-warning animate-fade" role="alert">
          <TriangleAlert size={15} className="shrink-0" />
          <span className="min-w-0 flex-1">
            Port <span className="font-mono font-semibold">{run.portConflict}</span> is already in use
            {conflictEntry ? <> by <span className="font-medium">{conflictEntry.name}</span>.</> : '.'}
          </span>
          {conflictEntry && !conflictEntry.protected ? (
            <Button size="sm" variant="secondary" onClick={() => setKillTarget(conflictEntry)}>Stop it</Button>
          ) : conflictEntry?.hint ? (
            <span className="text-sm">{conflictEntry.hint}</span>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void go()}>Retry</Button>
          )}
        </div>
      )}
    </div>
  )
}

export function ScriptsPanel({ project, workspace }: ProjectTabProps): React.JSX.Element {
  const [scripts, setScripts] = useState<ScriptDef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const runs = useScriptsStore((s) => s.runs)
  const entries = usePortsStore((s) => s.snapshot?.entries) ?? []
  const setTrust = useProjectsStore((s) => s.setTrust)

  const load = useCallback(async () => {
    try {
      setScripts(await window.cairix.scripts.list(project.id))
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [project.id])

  useEffect(() => {
    setScripts(null)
    setSelectedRunId(null)
    void load()
    // Scripts change when the user edits package.json in their editor; refresh when they come back.
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map<ScriptCategory, ScriptDef[]>()
    for (const s of scripts ?? []) map.set(s.category, [...(map.get(s.category) ?? []), s])
    return GROUPS.map((g) => ({ ...g, items: map.get(g.key) ?? [] })).filter((g) => g.items.length > 0)
  }, [scripts])

  const selectedRun = selectedRunId ? runs[selectedRunId] : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-page-x py-5">
        {!workspace.trusted && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-cx-warning/30 bg-cx-warning/10 px-4 py-3" role="alert">
            <ShieldAlert size={18} className="shrink-0 text-cx-warning" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Trust “{workspace.name}” to run its scripts</p>
              <p className="text-cx-muted">Scripts can run any code in this folder. Only trust code you wrote or have read.</p>
            </div>
            <Button variant="primary" onClick={() => void setTrust(workspace.id, true)}>Trust folder</Button>
          </div>
        )}

        {error && <p className="mb-4 rounded-lg bg-cx-danger/10 p-3 text-cx-danger" role="alert">{error}</p>}

        {scripts === null && !error && <p className="py-10 text-center text-cx-faint">Reading scripts…</p>}

        {scripts !== null && grouped.length === 0 && (
          <EmptyState icon={Play} title="No scripts found">
            Cairix looks for <span className="font-mono text-sm">package.json</span> scripts, <span className="font-mono text-sm">pyproject.toml</span> entry points, Django’s <span className="font-mono text-sm">manage.py</span>, Makefile targets and Compose files.
          </EmptyState>
        )}

        <div className="space-y-5">
          {grouped.map((g) => (
            <section key={g.key}>
              <h3 className="mb-1.5 cx-label">{g.title}</h3>
              <div className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
                {g.items.map((s) => {
                  const run = runForScript(runs, s.id)
                  return (
                    <ScriptRow
                      key={s.id}
                      script={s}
                      run={run}
                      entries={entries}
                      trusted={workspace.trusted}
                      selected={!!run && run.runId === selectedRunId}
                      onSelect={setSelectedRunId}
                    />
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {selectedRun && (
        <div className="flex h-[300px] shrink-0 flex-col border-t border-cx-border bg-cx-surface animate-fade">
          <div className="flex items-center gap-2 border-b border-cx-border/70 px-4 py-1.5">
            <StatusDot tone={isActive(selectedRun) ? 'success' : selectedRun.status === 'failed' ? 'danger' : 'muted'} pulse={isActive(selectedRun)} />
            <span className="font-mono text-sm font-medium">{selectedRun.scriptName}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-cx-faint" title={selectedRun.command}>{selectedRun.command}</span>
            <IconButton icon={X} label="Close log" onClick={() => setSelectedRunId(null)} />
          </div>
          <div className="min-h-0 flex-1">
            <LogView key={selectedRun.runId} runId={selectedRun.runId} />
          </div>
        </div>
      )}
    </div>
  )
}
