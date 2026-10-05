import { join } from 'path'
import { z } from 'zod'
import { LEVELS, type Lesson } from '@shared/learn'
import { readJson, writeJsonAtomic } from '../../json-store'

const MAX_LESSONS = 150

const lesson = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  topic: z.string().max(80),
  level: z.enum(LEVELS),
  generatedAt: z.number(),
  costUsd: z.number().optional(),
  learned: z.boolean(),
  content: z.object({
    title: z.string(),
    summary: z.string(),
    keyPoints: z.array(z.string()),
    sections: z.array(z.object({ heading: z.string(), body: z.string() })),
    example: z.object({ language: z.string().optional(), code: z.string(), explanation: z.string().optional() }).optional(),
    exercise: z.string(),
    quiz: z.array(z.object({ question: z.string(), options: z.array(z.string()), answer: z.number(), explanation: z.string() }))
  })
})
const file = z.object({ version: z.literal(1), lessons: z.array(lesson) })

/** Lessons, newest first, kept across restarts. */
export class LearnStore {
  private lessons: Lesson[]
  private readonly path: string

  constructor(dir: string) {
    this.path = join(dir, 'learn.json')
    this.lessons = readJson(this.path, file, () => ({ version: 1 as const, lessons: [] })).lessons as Lesson[]
  }

  all(): Lesson[] {
    return this.lessons
  }
  get(id: string): Lesson | undefined {
    return this.lessons.find((l) => l.id === id)
  }
  /** The newest lesson written for this topic on this day. */
  forDay(date: string, topic: string): Lesson | undefined {
    return this.lessons.find((l) => l.date === date && l.topic.toLowerCase() === topic.toLowerCase())
  }
  /** Titles of recent lessons on a topic, newest first. */
  recentTitles(topic: string, n = 20): string[] {
    return this.lessons.filter((l) => l.topic.toLowerCase() === topic.toLowerCase()).slice(0, n).map((l) => l.content.title)
  }

  add(l: Lesson): void {
    this.lessons = [l, ...this.lessons].slice(0, MAX_LESSONS)
    this.persist()
  }
  setLearned(id: string, learned: boolean): Lesson {
    const l = this.get(id)
    if (!l) throw new Error('That lesson no longer exists.')
    l.learned = learned
    this.persist()
    return l
  }
  delete(id: string): void {
    this.lessons = this.lessons.filter((l) => l.id !== id)
    this.persist()
  }

  private persist(): void {
    writeJsonAtomic(this.path, { version: 1, lessons: this.lessons })
  }
}
