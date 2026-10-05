import { CalendarClock, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { describeTrigger } from '@shared/schedules'
import type { Schedule, ScheduleDraft, ScriptDef, TaskAgent } from '@shared/types'
import { Button, Chip, Dialog, EmptyState, IconButton, Segmented, Toggle } from '@/components/ui'
import { errMsg, timeAgo } from '@/lib/util'
import { findProjectIn, projectLabel, useProjectsStore } from '@/stores/projects-store'
import { toast } from '@/stores/toast-store'

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
type What = 'script' | 'task'
type When = 'every' | 'daily' | 'git-change'

function fmtNext(ms: number | undefined, now = Date.now()): string {
  if (!ms) return ''
  if (ms <= now + 30_000) return 'any moment'
  const d = new Date(ms)
  const same = d.toDateString() === new Date(now).toDateString()
  return same ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

function Editor({ initial, onClose }: { initial: Schedule | null; onClose: () => void }): React.JSX.Element {
  const workspaces = useProjectsStore((s) => s.workspaces)
  const projects = useMemo(() => workspaces.filter((w) => w.trusted).flatMap((w) => w.projects.map((p) => ({ id: p.id, label: projectLabel({ project: p, workspace: w }), hasGit: p.hasGit }))), [workspaces])

  const t0 = initial?.target
  const w0 = initial?.trigger
  const [name, setName] = useState(initial?.name ?? '')
  const [what, setWhat] = useState<What>(t0?.kind ?? 'script')
  const [projectId, setProjectId] = useState(t0?.kind === 'task' ? t0.projectId : t0?.kind === 'script' ? t0.scriptId.split(':')[0] : projects[0]?.id ?? '')
  const [scripts, setScripts] = useState<ScriptDef[]>([])
  const [scriptId, setScriptId] = useState(t0?.kind === 'script' ? t0.scriptId : '')
  const [agent, setAgent] = useState<TaskAgent>(t0?.kind === 'task' ? t0.agent : 'claude')
  const [prompt, setPrompt] = useState(t0?.kind === 'task' ? t0.prompt : '')
  const [when, setWhen] = useState<When>(w0?.kind ?? 'every')
  const [amount, setAmount] = useState(w0?.kind === 'every' ? (w0.minutes % 1440 === 0 ? w0.minutes / 1440 : w0.minutes % 60 === 0 ? w0.minutes / 60 : w0.minutes) : 30)
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>(w0?.kind === 'every' ? (w0.minutes % 1440 === 0 ? 'days' : w0.minutes % 60 === 0 ? 'hours' : 'minutes') : 'minutes')
  const [time, setTime] = useState(w0?.kind === 'daily' ? w0.time : '09:00')
  const [days, setDays] = useState<number[]>(w0?.kind === 'daily' ? w0.days : [1, 2, 3, 4, 5])
  const [watchId, setWatchId] = useState(w0?.kind === 'git-change' ? w0.projectId : projects.find((p) => p.hasGit)?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (what !== 'script' || !projectId) return
    let live = true
    window.cairix.scripts.list(projectId).then((list) => {
      if (!live) return
      setScripts(list)
      setScriptId((cur) => (list.some((s) => s.id === cur) ? cur : list[0]?.id ?? ''))
    }, () => live && setScripts([]))
    return () => {
      live = false
    }
  }, [what, projectId])

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const script = scripts.find((s) => s.id === scriptId)
      const draft: ScheduleDraft = {
        id: initial?.id,
        name: name.trim() || (what === 'script' ? script?.name ?? 'Script' : 'Agent task'),
        enabled: initial?.enabled ?? true,
        target: what === 'script' ? { kind: 'script', scriptId, label: script ? `${script.name}` : scriptId } : { kind: 'task', projectId, prompt: prompt.trim(), agent },
        trigger: when === 'every' ? { kind: 'every', minutes: Math.round(amount * (unit === 'days' ? 1440 : unit === 'hours' ? 60 : 1)) } : when === 'daily' ? { kind: 'daily', time, days } : { kind: 'git-change', projectId: watchId }
      }
      await window.cairix.schedules.save(draft)
      onClose()
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
  }

  const select = 'no-drag h-9 w-full rounded-lg border border-cx-border bg-cx-raised px-3 outline-none focus:border-cx-accent'
  return (
    <Dialog title={initial ? 'Edit schedule' : 'New schedule'} onClose={onClose} width={580} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-4">
        <label className="block"><span className="mb-1 block font-medium">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly build" aria-label="Schedule name" className={select} /></label>

        <div>
          <span className="mb-1 block font-medium">What should run</span>
          <Segmented value={what} onChange={setWhat} options={[{ value: 'script', label: 'A script' }, { value: 'task', label: 'An agent task' }]} />
        </div>
        <label className="block"><span className="mb-1 block text-sm text-cx-muted">Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project" className={select}>{projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </label>
        {what === 'script' ? (
          <label className="block"><span className="mb-1 block text-sm text-cx-muted">Script</span>
            <select value={scriptId} onChange={(e) => setScriptId(e.target.value)} aria-label="Script" className={select}>{scripts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
        ) : (
          <>
            <Segmented value={agent} onChange={setAgent} options={[{ value: 'claude', label: 'Claude Code' }, { value: 'cursor', label: 'Cursor' }]} />
            <label className="block"><span className="mb-1 block text-sm text-cx-muted">Prompt (read-only: it can answer but not change files)</span>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} aria-label="Task prompt" placeholder="Summarise what changed in this repository since yesterday." className="no-drag w-full resize-none rounded-lg border border-cx-border bg-cx-raised p-3 outline-none focus:border-cx-accent" />
            </label>
          </>
        )}

        <div>
          <span className="mb-1 block font-medium">When</span>
          <Segmented value={when} onChange={setWhen} options={[{ value: 'every', label: 'Every…' }, { value: 'daily', label: 'Daily at…' }, { value: 'git-change', label: 'When a branch changes' }]} />
        </div>
        {when === 'every' && (
          <div className="flex items-center gap-2">
            <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Interval" className="no-drag h-9 w-24 rounded-lg border border-cx-border bg-cx-raised px-3 outline-none focus:border-cx-accent" />
            <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} aria-label="Interval unit" className="no-drag h-9 rounded-lg border border-cx-border bg-cx-raised px-3 outline-none focus:border-cx-accent"><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></select>
          </div>
        )}
        {when === 'daily' && (
          <div className="flex flex-wrap items-center gap-3">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time of day" className="no-drag h-9 rounded-lg border border-cx-border bg-cx-raised px-3 outline-none focus:border-cx-accent" />
            <div className="flex gap-1" role="group" aria-label="Days of the week">
              {DAYS.map((d, i) => (
                <button key={i} type="button" aria-pressed={days.includes(i)} aria-label={DAY_FULL[i]} onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))} className={`no-drag h-8 w-8 rounded-full border text-sm ${days.includes(i) ? 'border-cx-accent bg-cx-accent/12 text-cx-accent-text' : 'border-cx-border text-cx-muted hover:bg-cx-hover'}`}>{d}</button>
              ))}
            </div>
            <span className="text-sm text-cx-faint">{days.length === 0 ? 'every day' : ''}</span>
          </div>
        )}
        {when === 'git-change' && (
          <label className="block"><span className="mb-1 block text-sm text-cx-muted">Watch this project's repository (a new commit, or a switched branch)</span>
            <select value={watchId} onChange={(e) => setWatchId(e.target.value)} aria-label="Project to watch" className={select}>{projects.filter((p) => p.hasGit).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          </label>
        )}
        {error && <p className="text-cx-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

/** Run a script or an agent task on a timer, at a time of day, or when a branch changes. */
export function SchedulesView(): React.JSX.Element {
  const workspaces = useProjectsStore((s) => s.workspaces)
  const [list, setList] = useState<Schedule[] | null>(null)
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void window.cairix.schedules.list().then(setList, (e) => toast.error(errMsg(e)))
    return window.cairix.schedules.onChange(setList)
  }, [])
  // The "next run" column is relative to now: refresh it every so often.
  useEffect(() => {
    const t = setInterval(() => void window.cairix.schedules.list().then(setList, () => undefined), 30_000)
    return () => clearInterval(t)
  }, [])

  async function toggle(s: Schedule): Promise<void> {
    try {
      await window.cairix.schedules.save({ id: s.id, name: s.name, enabled: !s.enabled, trigger: s.trigger, target: s.target })
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
  async function runNow(s: Schedule): Promise<void> {
    setBusy(s.id)
    try {
      const r = await window.cairix.schedules.runNow(s.id)
      if (r.lastStatus === 'failed') toast.error(r.lastMessage ?? 'It could not start.')
      else toast.success(r.lastMessage ?? 'Started')
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(null)
    }
  }
  const projectName = (id: string): string | undefined => {
    const ref = findProjectIn(workspaces, id)
    return ref ? projectLabel(ref) : undefined
  }
  const what = (s: Schedule): string => (s.target.kind === 'script' ? `Runs ${s.target.label}${projectName(s.target.scriptId.split(':')[0]) ? ` in ${projectName(s.target.scriptId.split(':')[0])}` : ''}` : `Asks ${s.target.agent === 'claude' ? 'Claude' : 'Cursor'} in ${projectName(s.target.projectId) ?? 'a project'}: “${s.target.prompt.slice(0, 60)}${s.target.prompt.length > 60 ? '…' : ''}”`)

  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Schedules</h1>
          <p className="mt-0.5 text-cx-muted">Run a script or an agent task automatically. Cairix has to be open (it can sit in the menu bar).</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>New schedule</Button>
      </div>

      {list && list.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing scheduled" action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Create a schedule</Button>}>
          Try a nightly build, a lint pass every hour, or an agent summary of what changed whenever you switch branches.
        </EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised" aria-label="Schedules">
          {list?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 border-b border-cx-border/60 px-4 py-3 last:border-0">
              <Toggle checked={s.enabled} onChange={() => void toggle(s)} label={`${s.enabled ? 'Pause' : 'Resume'} ${s.name}`} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">{s.name}{s.lastStatus === 'failed' && <Chip tone="danger">failed</Chip>}{s.lastStatus === 'skipped' && <Chip>skipped</Chip>}</p>
                <p className="truncate text-sm text-cx-muted">{what(s)} · {describeTrigger(s.trigger, s.trigger.kind === 'git-change' ? projectName(s.trigger.projectId) : undefined)}</p>
                <p className="truncate text-xs text-cx-faint">{s.lastRunAt ? `Last: ${timeAgo(s.lastRunAt)}${s.lastMessage ? ` · ${s.lastMessage}` : ''}` : 'Has not run yet'}{s.enabled && s.nextRunAt ? ` · next ${fmtNext(s.nextRunAt)}` : s.enabled ? '' : ' · paused'}</p>
              </div>
              <Button size="sm" icon={Play} busy={busy === s.id} onClick={() => void runNow(s)} aria-label={`Run ${s.name} now`}>Run now</Button>
              <IconButton icon={Pencil} label={`Edit ${s.name}`} onClick={() => setEditing(s)} />
              <IconButton icon={Trash2} tone="danger" label={`Delete ${s.name}`} onClick={() => void window.cairix.schedules.delete(s.id).catch((e) => toast.error(errMsg(e)))} />
            </li>
          ))}
        </ul>
      )}
      {editing && <Editor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
