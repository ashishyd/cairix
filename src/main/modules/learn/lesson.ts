import { z } from 'zod'
import { LEVEL_HINT, type LearnLevel, type LessonContent } from '@shared/learn'
import { CliError, type CliResult } from '../changes/ai'

/** The shape Claude is asked to answer in. (Validated again below: a schema is a request, not a guarantee.) */
export const LESSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    sections: { type: 'array', items: { type: 'object', properties: { heading: { type: 'string' }, body: { type: 'string' } }, required: ['heading', 'body'] } },
    example: { type: 'object', properties: { language: { type: 'string' }, code: { type: 'string' }, explanation: { type: 'string' } }, required: ['code'] },
    exercise: { type: 'string' },
    quiz: {
      type: 'array',
      items: {
        type: 'object',
        properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' }, explanation: { type: 'string' } },
        required: ['question', 'options', 'answer', 'explanation']
      }
    }
  },
  required: ['title', 'summary', 'keyPoints', 'sections', 'exercise', 'quiz']
} as const

export function lessonArgs(): string[] {
  return ['--model', 'sonnet', '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--max-budget-usd', '0.25', '--json-schema', JSON.stringify(LESSON_SCHEMA)]
}

export interface PromptInput {
  topic: string
  level: LearnLevel
  date: string
  /** Titles already taught on this topic, so a new day is a new idea. */
  recent: string[]
}

/** The marker lets test doubles recognise a lesson request. The topic is quoted and was stripped of quotes and newlines. */
export function buildPrompt({ topic, level, date, recent }: PromptInput): string {
  const covered = recent.length > 0 ? `Already covered (teach something different):\n${recent.map((t) => `- ${t}`).join('\n')}\n\n` : ''
  return `LESSON_REQUEST
You are writing today's short daily lesson for a software developer.

Topic: "${topic}"
Level: ${level}. ${LEVEL_HINT[level]}
Date: ${date}

${covered}Rules:
- Teach ONE focused idea that can be read in about five minutes.
- Be accurate. If something depends on a version or a platform, say so. Never invent functions, flags or APIs.
- Plain text only: no markdown headings and no HTML. Code belongs only in the "example" field.
- Keep the example small and runnable, with a short explanation of what it shows.
- Give a practical exercise the reader can try in a few minutes.
- Write 2 to 3 quiz questions with 3 or 4 options each and exactly one clearly correct answer ("answer" is the zero-based index of it).

Answer with the JSON object only.
`
}

const text = (max: number) => z.string().transform((s) => s.trim().slice(0, max))

const content = z.object({
  title: text(120).pipe(z.string().min(1)),
  summary: text(600).pipe(z.string().min(1)),
  keyPoints: z.array(text(240).pipe(z.string().min(1))).max(8).default([]),
  sections: z.array(z.object({ heading: text(100).pipe(z.string().min(1)), body: text(1800).pipe(z.string().min(1)) })).min(1).max(6),
  example: z.object({ language: text(30).optional(), code: text(2400).pipe(z.string().min(1)), explanation: text(600).optional() }).optional(),
  exercise: text(800).default(''),
  quiz: z.array(z.object({ question: text(300), options: z.array(text(200)).min(2).max(5), answer: z.number().int(), explanation: text(400).default('') })).max(5).default([])
})

/** Questions whose answer is not one of their options are dropped rather than shown wrong. */
export function parseLesson(result: CliResult): LessonContent {
  let raw: unknown = result.structured
  if (raw === undefined || raw === null) {
    // No structured output: the model may still have answered with JSON in its text.
    const m = result.text.match(/\{[\s\S]*\}/)
    try {
      raw = m ? JSON.parse(m[0]) : undefined
    } catch {
      raw = undefined
    }
  }
  const parsed = content.safeParse(raw)
  if (!parsed.success) throw new CliError('Claude’s answer was not a usable lesson. Try again.')
  const c = parsed.data
  return {
    ...c,
    quiz: c.quiz.filter((q) => q.question && q.answer >= 0 && q.answer < q.options.length && new Set(q.options).size === q.options.length)
  }
}
