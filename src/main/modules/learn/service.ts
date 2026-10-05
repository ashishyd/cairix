import { randomUUID } from 'crypto'
import { cleanTopic, dayKey, LEVELS, type GenerateLessonRequest, type LearnSnapshot, type Lesson } from '@shared/learn'
import type { AgentCli } from '@shared/types'
import { CliError, runClaude, type CliResult, type RunClaudeOptions } from '../changes/ai'
import { buildPrompt, lessonArgs, parseLesson } from './lesson'
import type { LearnStore } from './store'

export interface LearnDeps {
  store: LearnStore
  detectClaude(): Promise<AgentCli>
  run?(o: RunClaudeOptions): Promise<CliResult>
  now?(): number
  onChange?(snapshot: LearnSnapshot): void
}

/** Writes one lesson per topic per day with the user's own Claude CLI, and remembers it. */
export class LearnService {
  private inflight = new Map<string, Promise<Lesson>>()
  constructor(private readonly deps: LearnDeps) {}

  async list(): Promise<LearnSnapshot> {
    return { lessons: this.deps.store.all(), claude: { installed: (await this.deps.detectClaude()).installed } }
  }

  async generate(req: GenerateLessonRequest): Promise<Lesson> {
    const topic = cleanTopic(req.topic)
    if (!topic) throw new Error('Choose a topic to learn first.')
    if (!LEVELS.includes(req.level)) throw new Error('Choose a difficulty level.')
    const date = dayKey(this.now())
    const existing = this.deps.store.forDay(date, topic)
    if (existing && !req.another) return existing
    // Two clicks (or the page opening twice) must not buy two lessons.
    const key = `${date}|${topic.toLowerCase()}|${req.another ? 'another' : 'first'}`
    const running = this.inflight.get(key)
    if (running) return running
    const p = this.write(topic, req.level, date).finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  async mark(id: string, learned: boolean): Promise<Lesson> {
    const l = this.deps.store.setLearned(id, learned)
    await this.notify()
    return l
  }

  async delete(id: string): Promise<void> {
    this.deps.store.delete(id)
    await this.notify()
  }

  private async write(topic: string, level: Lesson['level'], date: string): Promise<Lesson> {
    const cli = await this.deps.detectClaude()
    if (!cli.installed) throw new CliError('Claude Code was not found on your PATH. Install it and run `claude auth login`, then try again.', 'not-installed')
    const prompt = buildPrompt({ topic, level, date, recent: this.deps.store.recentTitles(topic) })
    const result = await (this.deps.run ?? runClaude)({ prompt, args: lessonArgs(), timeoutMs: 150_000 })
    const lesson: Lesson = { id: randomUUID(), date, topic, level, content: parseLesson(result), generatedAt: this.now(), costUsd: result.costUsd, learned: false }
    this.deps.store.add(lesson)
    await this.notify()
    return lesson
  }

  private async notify(): Promise<void> {
    this.deps.onChange?.(await this.list())
  }
  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}
