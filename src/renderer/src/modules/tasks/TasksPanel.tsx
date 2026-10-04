import { Ban, Bot, ChevronDown, CircleAlert, CircleCheck, FileDiff, Play, Trash2, Undo2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CAIRIX_COMMAND_EVENT } from '@shared/keybindings'
import type { AgentTask, FixProposal, TaskAgent, TaskCapabilities, TaskMode } from '@shared/types'
import { Button, Chip, EmptyState, IconButton, InlineAlert, Kbd, Segmented, StatusDot } from '@/components/ui'
import { useShortcut } from '@/lib/commands'
import { cx, errMsg, timeAgo } from '@/lib/util'
import { PatchView } from '@/modules/changes/FindingCard'
import type { ProjectTabProps } from '@/modules/registry'
import { toast } from '@/stores/toast-store'
import { Cost, useIsSubscription } from '@/lib/cost'

const BUDGETS = [0.25, 0.5, 1, 2]

interface Review {
  proposal?: FixProposal
  busy?: 'loading' | 'applying'
  error?: string
}

function duration(t: AgentTask): string {
  const s = Math.max(1, Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function TaskCard({ t, review, onCancel, onRemove, onReview, onApply, onUndo, onDiscard }: {
  t: AgentTask
  review: Review
  onCancel: () => void
  onRemove: () => void
  onReview: () => void
  onApply: () => void
  onUndo: () => void
  onDiscard: () => void
}): React.JSX.Element {
  const running = t.status === 'running'
  const feed = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (running) feed.current?.scrollTo({ top: feed.current.scrollHeight })
  }, [t.events.length, running])
  const p = review.proposal

  return (
    <li className="rounded-xl border border-cx-border bg-cx-raised p-4 animate-fade">
      <div className="flex items-start gap-3">
        <div className="mt-1.5">
          <StatusDot tone={running ? 'warning' : t.status === 'done' ? 'success' : t.status === 'failed' ? 'danger' : 'muted'} pulse={running} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="selectable line-clamp-3 whitespace-pre-wrap font-medium">{t.prompt}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-cx-faint">
            <Chip tone={t.agent === 'claude' ? 'accent' : 'neutral'}>{t.agent === 'claude' ? 'Claude Code' : 'Cursor'}</Chip>
            <Chip tone={t.mode === 'edit' ? 'warning' : 'neutral'}>{t.mode === 'edit' ? 'makes changes' : 'read-only'}</Chip>
            <span>{running ? `running ${duration(t)}` : `${t.status === 'done' ? 'finished' : t.status} in ${duration(t)}`} · {timeAgo(t.startedAt)}</span>
            {t.costUsd !== undefined && <span>· <Cost usd={t.costUsd} /></span>}
          </div>
        </div>
        {running ? <Button size="sm" icon={Ban} onClick={onCancel}>Cancel</Button> : <IconButton icon={Trash2} label="Remove from history" tone="danger" onClick={onRemove} />}
      </div>

      {t.events.length > 0 && (
        <ul ref={feed} aria-label="Activity" className={cx('mt-3 space-y-1 overflow-y-auto rounded-lg bg-cx-surface p-2.5 text-sm', running ? 'max-h-[170px]' : 'max-h-[110px]')}>
          {t.events.map((e, i) => (
            <li key={i} className={cx('flex gap-2', e.kind === 'tool' && 'font-mono text-sm text-cx-muted', e.kind === 'info' && 'text-cx-faint', e.kind === 'error' && 'text-cx-danger')}>
              {e.kind === 'tool' && <Wrench size={12} className="mt-0.5 shrink-0" />}
              <span className="selectable min-w-0 whitespace-pre-wrap break-words">{e.text}</span>
            </li>
          ))}
        </ul>
      )}

      {t.status === 'failed' && <p className="mt-3 flex items-start gap-2 text-cx-danger" role="alert"><CircleAlert size={15} className="mt-0.5 shrink-0" />{t.error}</p>}

      {t.status === 'done' && t.result && (
        <div className="mt-3">
          <p className="mb-1 cx-label">Answer</p>
          <p className="selectable whitespace-pre-wrap text-cx-text">{t.result}</p>
        </div>
      )}

      {t.status === 'done' && t.mode === 'edit' && (
        <div className="mt-3 space-y-2.5">
          {t.changes ? (
            <>
              <p className="flex items-center gap-2 text-cx-muted"><FileDiff size={14} /> Changed {t.changes.files.length} file{t.changes.files.length === 1 ? '' : 's'}: <span className="font-mono text-sm text-cx-text">{t.changes.files.slice(0, 3).join(', ')}{t.changes.files.length > 3 ? ` +${t.changes.files.length - 3}` : ''}</span> <span className="text-cx-success">+{t.changes.additions}</span> <span className="text-cx-danger">−{t.changes.deletions}</span></p>
              {!p && <Button variant="primary" size="sm" icon={FileDiff} busy={review.busy === 'loading'} onClick={onReview}>Review changes</Button>}
              {p && <PatchView patch={p.patch} />}
              {p && !p.applied && (
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" busy={review.busy === 'applying'} onClick={onApply}>Apply to my files</Button>
                  <Button size="sm" onClick={onDiscard}>Discard</Button>
                  <span className="text-sm text-cx-faint">Your files are untouched until you apply, and you can undo.</span>
                </div>
              )}
              {p?.applied && (
                <div className="flex items-center gap-2 rounded-lg bg-cx-success/10 px-3 py-2 text-cx-success"><CircleCheck size={15} /> <span className="flex-1">Applied to your files</span><Button size="sm" variant="ghost" icon={Undo2} onClick={onUndo}>Undo</Button></div>
              )}
            </>
          ) : (
            <p className="text-cx-muted">The agent made no changes.</p>
          )}
          {review.error && <p className="text-cx-danger" role="alert">{review.error}</p>}
        </div>
      )}
    </li>
  )
}

export function TasksPanel({ project, workspace }: ProjectTabProps): React.JSX.Element {
  const sub = useIsSubscription()
  const [caps, setCaps] = useState<TaskCapabilities | null>(null)
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [prompt, setPrompt] = useState('')
  const [agent, setAgent] = useState<TaskAgent>('claude')
  const [mode, setMode] = useState<TaskMode>('read')
  const [budget, setBudget] = useState(0.5)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [composeOpen, setComposeOpen] = useState(true)
  const [reviews, setReviews] = useState<Record<string, Review>>({})
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const newTaskShortcut = useShortcut('tasks.new')

  const refresh = useCallback(async () => {
    try {
      setTasks(await window.cairix.tasks.list(project.id))
    } catch (e) {
      setError(errMsg(e))
    }
  }, [project.id])

  useEffect(() => {
    setTasks([])
    setReviews({})
    setComposeOpen(true)
    void window.cairix.tasks.capabilities().then((c) => {
      setCaps(c)
      if (!c.claude && c.cursor) setAgent('cursor')
    })
    void refresh()
  }, [project.id, refresh])

  // ⌘⇧N opens compose and focuses the prompt.
  useEffect(() => {
    const onCommand = (e: Event): void => {
      if ((e as CustomEvent<string>).detail !== 'tasks.new') return
      setComposeOpen(true)
      requestAnimationFrame(() => promptRef.current?.focus())
    }
    window.addEventListener(CAIRIX_COMMAND_EVENT, onCommand)
    return () => window.removeEventListener(CAIRIX_COMMAND_EVENT, onCommand)
  }, [])

  const anyRunning = tasks.some((t) => t.status === 'running')
  useEffect(() => {
    const t = setInterval(() => !document.hidden && void refresh(), anyRunning ? 900 : 6000)
    return () => clearInterval(t)
  }, [anyRunning, refresh])

  const setR = (id: string, r: Review): void => setReviews((cur) => ({ ...cur, [id]: r }))

  async function start(): Promise<void> {
    setStarting(true)
    setError(null)
    try {
      await window.cairix.tasks.start(project.id, { agent, mode, prompt, budgetUsd: agent === 'claude' ? budget : undefined })
      setPrompt('')
      setComposeOpen(false)
      await refresh()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setStarting(false)
    }
  }

  async function review(t: AgentTask): Promise<void> {
    setR(t.id, { busy: 'loading' })
    try {
      setR(t.id, { proposal: await window.cairix.tasks.propose(t.id) })
    } catch (e) {
      setR(t.id, { error: errMsg(e) })
    }
  }
  async function apply(t: AgentTask): Promise<void> {
    const p = reviews[t.id]?.proposal
    if (!p) return
    setR(t.id, { proposal: p, busy: 'applying' })
    try {
      const done = await window.cairix.changes.apply(p.id)
      setR(t.id, { proposal: done })
      toast.success(`Applied to ${done.files.join(', ')}`)
    } catch (e) {
      setR(t.id, { proposal: p, error: errMsg(e) })
    }
  }
  async function undo(t: AgentTask): Promise<void> {
    const p = reviews[t.id]?.proposal
    if (!p) return
    try {
      setR(t.id, { proposal: await window.cairix.changes.undo(p.id) })
      toast.success('Change undone')
    } catch (e) {
      setR(t.id, { proposal: p, error: errMsg(e) })
    }
  }

  const installed = (a: TaskAgent): boolean => (caps ? caps[a] : true)
  const none = caps && !caps.claude && !caps.cursor
  const canStart = !!prompt.trim() && !starting && installed(agent) && workspace.trusted
  const showCompose = composeOpen || tasks.length === 0

  return (
    <div className="h-full overflow-y-auto px-page-x py-5">
      {tasks.length > 0 && !showCompose && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-cx-muted">{tasks.length} task{tasks.length === 1 ? '' : 's'} · review Apply before anything touches your files</p>
          <Button size="sm" variant="primary" icon={Play} onClick={() => { setComposeOpen(true); requestAnimationFrame(() => promptRef.current?.focus()) }} title={newTaskShortcut || undefined}>
            New task{newTaskShortcut ? <> <Kbd>{newTaskShortcut}</Kbd></> : null}
          </Button>
        </div>
      )}

      {showCompose && (
        <section className="rounded-xl border border-cx-border bg-cx-raised p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold"><Bot size={17} className="text-cx-accent-text" /> Give an agent a task</h2>
              <p className="mt-1 text-cx-muted">Describe a job in plain words. The agent runs in the background; you review what it did before anything touches your files.</p>
            </div>
            {tasks.length > 0 && (
              <Button size="sm" variant="ghost" icon={ChevronDown} onClick={() => setComposeOpen(false)}>Hide</Button>
            )}
          </div>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canStart && void start()}
            aria-label="Task for the agent"
            rows={3}
            placeholder={mode === 'read' ? 'Where is authentication handled, and how does it work?' : 'Add input validation to the signup handler and a test for it.'}
            className="no-drag mt-3 w-full resize-none rounded-lg border border-cx-border bg-cx-surface p-3 outline-none focus:border-cx-accent"
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
            <div>
              <span className="mb-1 block text-sm text-cx-muted">Agent</span>
              <Segmented value={agent} onChange={setAgent} options={[{ value: 'claude', label: installed('claude') ? 'Claude Code' : 'Claude Code (not found)' }, { value: 'cursor', label: installed('cursor') ? 'Cursor' : 'Cursor (not found)' }]} />
            </div>
            <div>
              <span className="mb-1 block text-sm text-cx-muted">It may</span>
              <Segmented value={mode} onChange={setMode} options={[{ value: 'read', label: 'Only read and answer' }, { value: 'edit', label: 'Make changes' }]} />
            </div>
            {agent === 'claude' && (
              <label>
                <span className="mb-1 block text-sm text-cx-muted">Use at most</span>
                <select value={budget} onChange={(e) => setBudget(Number(e.target.value))} aria-label="Spending limit" className="no-drag h-8 rounded-lg border border-cx-border bg-cx-raised px-2">
                  {BUDGETS.map((b) => <option key={b} value={b}>${b.toFixed(2)}{sub ? ' (plan usage)' : ''}</option>)}
                </select>
              </label>
            )}
            <span className="flex-1" />
            <Button variant="primary" icon={Play} busy={starting} disabled={!canStart} onClick={() => void start()} title={!workspace.trusted ? 'Trust this folder first' : '⌘↩'}>
              Start task <Kbd>⌘↩</Kbd>
            </Button>
          </div>
          <p className="mt-3 text-sm text-cx-faint">
            {mode === 'read'
              ? 'Read-only: the agent can look through the code but cannot change files or run commands.'
              : 'The agent edits a throwaway copy of your project (your uncommitted work included). It cannot run commands. Nothing reaches your files until you click Apply.'}
          </p>
          {none && <div className="mt-2"><InlineAlert tone="warning">Neither Claude Code nor the Cursor agent was found on your PATH.</InlineAlert></div>}
          {!workspace.trusted && <div className="mt-2"><InlineAlert tone="warning">Trust this folder to run tasks in it.</InlineAlert></div>}
          {error && <div className="mt-2"><InlineAlert tone="danger">{error}</InlineAlert></div>}
        </section>
      )}

      {tasks.length === 0 ? (
        <EmptyState icon={Bot} title="No tasks yet">Try “Explain how this project is structured”, or switch to “Make changes” and ask for a small, specific edit.</EmptyState>
      ) : (
        <ul className={cx('space-y-3', showCompose && 'mt-5')} aria-label="Tasks">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              t={t}
              review={reviews[t.id] ?? {}}
              onCancel={() => void window.cairix.tasks.cancel(t.id).then(refresh)}
              onRemove={() => void window.cairix.tasks.remove(t.id).then(refresh, (e) => toast.error(errMsg(e)))}
              onReview={() => void review(t)}
              onApply={() => void apply(t)}
              onUndo={() => void undo(t)}
              onDiscard={() => setR(t.id, {})}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
