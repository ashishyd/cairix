/** Daily learning: what can be studied, how a lesson is shaped, and the date/streak rules. Pure, so they are tested. */

export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const
export type LearnLevel = (typeof LEVELS)[number]

export const LEVEL_LABEL: Record<LearnLevel, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
export const LEVEL_HINT: Record<LearnLevel, string> = {
  beginner: 'New to it: plain words, small steps, no assumptions.',
  intermediate: 'You use it already: patterns, trade-offs and common mistakes.',
  advanced: 'Deep dives: internals, edge cases and design decisions.'
}

export interface TopicGroup {
  title: string
  topics: string[]
}

/** Suggested topics. Anything else can be typed in as a custom topic. */
export const TOPIC_GROUPS: TopicGroup[] = [
  { title: 'Languages', topics: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'SQL', 'Shell scripting', 'Regular expressions'] },
  { title: 'Tools', topics: ['Git', 'Docker', 'Terminal & command line', 'Vim', 'Debugging', 'Package managers'] },
  { title: 'Web', topics: ['React', 'Node.js', 'CSS & layout', 'HTTP & APIs', 'Web security', 'Accessibility', 'Testing'] },
  { title: 'Computer science', topics: ['Algorithms & data structures', 'System design', 'Databases & indexing', 'Networking basics', 'Performance', 'Clean code & refactoring'] }
]
export const MAX_TOPICS = 12
export const MAX_TOPIC_LENGTH = 60

export interface LearnSettings {
  topics: string[]
  level: LearnLevel
  /** Write today's lesson when the page opens and there is none yet. */
  autoGenerate: boolean
}

export const DEFAULT_LEARN: LearnSettings = { topics: [], level: 'beginner', autoGenerate: true }

export interface QuizQuestion {
  question: string
  options: string[]
  /** Index into `options`. */
  answer: number
  explanation: string
}

export interface LessonContent {
  title: string
  summary: string
  keyPoints: string[]
  sections: Array<{ heading: string; body: string }>
  example?: { language?: string; code: string; explanation?: string }
  exercise: string
  quiz: QuizQuestion[]
}

export interface Lesson {
  id: string
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  topic: string
  level: LearnLevel
  content: LessonContent
  generatedAt: number
  costUsd?: number
  learned: boolean
}

export interface LearnSnapshot {
  lessons: Lesson[]
  /** Is the Claude CLI there and signed in? (Lessons are written by it.) */
  claude: { installed: boolean }
}

export interface GenerateLessonRequest {
  topic: string
  level: LearnLevel
  /** Write another lesson even though today's already exists (it avoids repeating earlier titles). */
  another?: boolean
}

/** Local `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const DAY_MS = 86_400_000

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

/** Today's topic: the list is walked one topic per day, so every chosen topic comes round in turn. */
export function topicOfTheDay(topics: string[], key: string): string | undefined {
  if (topics.length === 0) return undefined
  return topics[((dayNumber(key) % topics.length) + topics.length) % topics.length]
}

/**
 * Consecutive days, ending today (or yesterday, so the streak is not lost
 * before you have had a chance to study today), on which at least one lesson
 * was marked as learned.
 */
export function learnedStreak(lessons: Array<Pick<Lesson, 'date' | 'learned'>>, today: string): number {
  const days = new Set(lessons.filter((l) => l.learned).map((l) => dayNumber(l.date)))
  let n = dayNumber(today)
  if (!days.has(n)) n -= 1
  let streak = 0
  while (days.has(n)) {
    streak++
    n--
  }
  return streak
}

/** A topic as the user typed it, made safe to keep and to put in a prompt. */
export function cleanTopic(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/["`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC_LENGTH)
}
