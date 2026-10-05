import { Check, CircleCheck, CircleX, Copy, Flame, GraduationCap, Loader2, RefreshCw, Settings as SettingsIcon, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dayKey, LEVEL_LABEL, learnedStreak, topicOfTheDay, type LearnSnapshot, type Lesson } from '@shared/learn'
import { Button, Chip, EmptyState, InlineAlert } from '@/components/ui'
import { cx, errMsg } from '@/lib/util'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'

function Quiz({ lesson }: { lesson: Lesson }): React.JSX.Element | null {
  const [picked, setPicked] = useState<Record<number, number>>({})
  useEffect(() => setPicked({}), [lesson.id])
  const quiz = lesson.content.quiz
  if (quiz.length === 0) return null
  const done = Object.keys(picked).length === quiz.length
  const score = quiz.filter((q, i) => picked[i] === q.answer).length
  return (
    <section aria-label="Quick quiz" className="rounded-xl border border-cx-border bg-cx-surface/60 p-4">
      <h3 className="cx-label mb-3">Quick quiz</h3>
      <div className="space-y-4">
        {quiz.map((q, i) => {
          const answered = picked[i] !== undefined
          return (
            <div key={i}>
              <p className="mb-2 font-medium">{i + 1}. {q.question}</p>
              <div className="space-y-1.5" role="group" aria-label={`Options for question ${i + 1}`}>
                {q.options.map((opt, n) => {
                  const chosen = picked[i] === n
                  const right = n === q.answer
                  return (
                    <button
                      key={n}
                      disabled={answered}
                      onClick={() => setPicked((p) => ({ ...p, [i]: n }))}
                      className={cx(
                        'no-drag flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                        !answered && 'border-cx-border hover:bg-cx-hover',
                        answered && right && 'border-cx-success/50 bg-cx-success/10',
                        answered && chosen && !right && 'border-cx-danger/50 bg-cx-danger/10',
                        answered && !chosen && !right && 'border-cx-border opacity-60'
                      )}
                    >
                      {answered && right ? <CircleCheck size={15} className="shrink-0 text-cx-success" /> : answered && chosen ? <CircleX size={15} className="shrink-0 text-cx-danger" /> : <span className="h-[15px] w-[15px] shrink-0 rounded-full border border-cx-border" />}
                      <span>{opt}</span>
                    </button>
                  )
                })}
              </div>
              {answered && q.explanation && <p className="mt-1.5 text-sm text-cx-muted">{q.explanation}</p>}
            </div>
          )
        })}
      </div>
      {done && <p className="mt-4 font-medium" role="status">{score === quiz.length ? 'All correct. ' : ''}You got {score} of {quiz.length}.</p>}
    </section>
  )
}

function LessonView({ lesson, onMark }: { lesson: Lesson; onMark: (learned: boolean) => void }): React.JSX.Element {
  const c = lesson.content
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(c.example?.code ?? '')
      toast.success('Copied the example')
    } catch {
      toast.error('Could not copy to the clipboard.')
    }
  }
  return (
    <article aria-label={c.title} className="space-y-5">
      <header>
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Chip tone="accent">{lesson.topic}</Chip>
          <Chip>{LEVEL_LABEL[lesson.level]}</Chip>
          <span className="text-sm text-cx-faint">{lesson.date}</span>
        </div>
        <h2 className="text-lg font-semibold tracking-tight">{c.title}</h2>
        <p className="mt-1 text-cx-muted">{c.summary}</p>
      </header>

      {c.keyPoints.length > 0 && (
        <section aria-label="Key points" className="rounded-xl border border-cx-border bg-cx-raised px-4 py-3">
          <h3 className="cx-label mb-1.5">Key points</h3>
          <ul className="list-disc space-y-1 pl-5">{c.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </section>
      )}

      {c.sections.map((s, i) => (
        <section key={i}>
          <h3 className="mb-1 font-semibold">{s.heading}</h3>
          <p className="selectable whitespace-pre-wrap leading-relaxed text-cx-text/90">{s.body}</p>
        </section>
      ))}

      {c.example && (
        <section aria-label="Example">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-semibold">Example{c.example.language ? <span className="ml-2 font-mono text-xs font-normal text-cx-faint">{c.example.language}</span> : null}</h3>
            <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copy()}>Copy</Button>
          </div>
          <pre className="selectable overflow-x-auto rounded-lg border border-cx-border bg-cx-surface p-3 font-mono text-sm">{c.example.code}</pre>
          {c.example.explanation && <p className="mt-1.5 text-sm text-cx-muted">{c.example.explanation}</p>}
        </section>
      )}

      {c.exercise && (
        <section aria-label="Try it" className="rounded-xl border border-cx-accent/30 bg-cx-accent/6 px-4 py-3">
          <h3 className="cx-label mb-1">Try it</h3>
          <p className="selectable whitespace-pre-wrap">{c.exercise}</p>
        </section>
      )}

      <Quiz lesson={lesson} />

      <div className="flex items-center justify-between border-t border-cx-border pt-4">
        <p className="text-sm text-cx-faint">Written by Claude{lesson.costUsd ? ` · about $${lesson.costUsd.toFixed(3)} of plan usage` : ''}. Check anything important against the official docs.</p>
        <Button variant={lesson.learned ? 'secondary' : 'primary'} icon={Check} onClick={() => onMark(!lesson.learned)}>{lesson.learned ? 'Learned ✓ (undo)' : 'Mark as learned'}</Button>
      </div>
    </article>
  )
}

/** One short lesson a day on the topics and level you chose in Settings, written by Claude. */
export function LearnView(): React.JSX.Element {
  const learn = useSettingsStore((s) => s.settings.learn)
  const setSettings = useUiStore((s) => s.setSettings)
  // The page stays mounted behind the Settings dialog: do not spend a lesson on every topic ticked while choosing.
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const [snap, setSnap] = useState<LearnSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [topic, setTopic] = useState<string | undefined>(undefined)
  const [openId, setOpenId] = useState<string | null>(null)
  const tried = useRef(new Set<string>())

  const today = useMemo(() => dayKey(Date.now()), [])
  const topics = learn.topics
  const dayTopic = topicOfTheDay(topics, today)
  const activeTopic = topic && topics.includes(topic) ? topic : dayTopic

  useEffect(() => {
    void window.cairix.learn.list().then(setSnap, (e) => setError(errMsg(e)))
    return window.cairix.learn.onChange(setSnap)
  }, [])

  const generate = useCallback(async (t: string, another = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const lesson = await window.cairix.learn.generate({ topic: t, level: learn.level, another })
      setOpenId(lesson.id)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }, [learn.level])

  const lessons = snap?.lessons ?? []
  const todays = lessons.filter((l) => l.date === today)
  const forTopic = activeTopic ? todays.find((l) => l.topic.toLowerCase() === activeTopic.toLowerCase()) : undefined
  const current = (openId ? lessons.find((l) => l.id === openId) : undefined) ?? forTopic
  const streak = learnedStreak(lessons, today)

  // Write today's lesson when the page opens and there is none yet (once per topic per visit).
  useEffect(() => {
    if (!snap || !learn.autoGenerate || !dayTopic || !snap.claude.installed || busy || settingsOpen) return
    if (todays.some((l) => l.topic.toLowerCase() === dayTopic.toLowerCase()) || tried.current.has(dayTopic)) return
    tried.current.add(dayTopic)
    void generate(dayTopic)
  }, [snap, learn.autoGenerate, dayTopic, busy, settingsOpen, todays, generate])

  async function mark(l: Lesson, learned: boolean): Promise<void> {
    try {
      await window.cairix.learn.mark(l.id, learned)
      if (learned) toast.success('Nice. See you tomorrow.')
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  if (topics.length === 0) {
    return (
      <div className="mx-auto max-w-[760px] px-page-x py-page-y">
        <h1 className="mb-5 text-xl font-semibold tracking-tight">Daily learn</h1>
        <EmptyState icon={GraduationCap} title="Pick what you want to learn" action={<Button variant="primary" icon={SettingsIcon} onClick={() => setSettings(true)}>Choose topics</Button>}>
          Choose one or more topics and a level in Settings. Each day Cairix asks Claude for a short lesson with an example, an exercise and a quiz.
        </EmptyState>
      </div>
    )
  }

  const older = lessons.filter((l) => l.id !== current?.id).slice(0, 12)

  return (
    <div className="mx-auto max-w-[760px] px-page-x py-page-y">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Daily learn</h1>
          <p className="mt-0.5 text-cx-muted">Today: <span className="font-medium text-cx-text">{dayTopic}</span> · {LEVEL_LABEL[learn.level]}</p>
        </div>
        <div className="flex items-center gap-2">
          {streak > 0 && <Chip tone="warning" title="Days in a row with a lesson marked as learned"><Flame size={11} /> {streak}-day streak</Chip>}
          <Button icon={SettingsIcon} onClick={() => setSettings(true)}>Topics &amp; level</Button>
        </div>
      </div>

      {topics.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Topics">
          {topics.map((t) => {
            const has = todays.some((l) => l.topic.toLowerCase() === t.toLowerCase())
            return (
              <button key={t} aria-pressed={t === activeTopic} onClick={() => { setTopic(t); setOpenId(null) }} className={cx('no-drag rounded-full border px-3 py-1 text-sm', t === activeTopic ? 'border-cx-accent bg-cx-accent/12 text-cx-accent-text' : 'border-cx-border text-cx-muted hover:bg-cx-hover')}>
                {t}{t === dayTopic ? ' · today' : ''}{has ? ' ✓' : ''}
              </button>
            )
          })}
        </div>
      )}

      {snap && !snap.claude.installed && (
        <div className="mb-4"><InlineAlert tone="warning">Lessons are written by Claude Code, which was not found. Install it and run <span className="font-mono">claude auth login</span> in a terminal.</InlineAlert></div>
      )}
      {error && <div className="mb-4"><InlineAlert tone="danger">{error}</InlineAlert></div>}

      {busy ? (
        <div className="flex items-center gap-3 rounded-xl border border-cx-border bg-cx-raised px-5 py-8 text-cx-muted" role="status">
          <Loader2 size={18} className="animate-spin" /> Claude is writing today's {activeTopic} lesson…
        </div>
      ) : current ? (
        <>
          <LessonView lesson={current} onMark={(l) => void mark(current, l)} />
          {current.date === today && activeTopic && (
            <div className="mt-4"><Button icon={RefreshCw} disabled={busy || !snap?.claude.installed} onClick={() => void generate(activeTopic, true)}>Another lesson on {activeTopic}</Button></div>
          )}
        </>
      ) : (
        <EmptyState icon={Sparkles} title={`No ${activeTopic} lesson yet today`} action={activeTopic ? <Button variant="primary" icon={Sparkles} disabled={!snap?.claude.installed} onClick={() => void generate(activeTopic)}>Write today's lesson</Button> : undefined}>
          {learn.autoGenerate ? 'It will be written automatically when you open this page with Claude available.' : 'Automatic lessons are off. Write one when you are ready.'}
        </EmptyState>
      )}

      {older.length > 0 && (
        <section aria-label="Earlier lessons" className="mt-8">
          <h2 className="cx-label mb-2">Earlier lessons</h2>
          <ul className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
            {older.map((l) => (
              <li key={l.id}>
                <button onClick={() => setOpenId(l.id)} className="no-drag flex w-full items-center gap-3 border-b border-cx-border/60 px-4 py-2.5 text-left last:border-0 hover:bg-cx-hover/50">
                  <span className="w-[88px] shrink-0 text-sm tabular-nums text-cx-faint">{l.date}</span>
                  <Chip>{l.topic}</Chip>
                  <span className="min-w-0 flex-1 truncate">{l.content.title}</span>
                  {l.learned && <Check size={14} className="shrink-0 text-cx-success" aria-label="Learned" />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
