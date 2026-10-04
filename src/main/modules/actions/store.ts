import { randomUUID } from 'crypto'
import { join } from 'path'
import { z } from 'zod'
import type { ActionDraft, CustomAction } from '@shared/types'
import { readJson, writeJsonAtomic } from '../../json-store'
import { APP_NAME } from './exec'
import { validateTemplate } from './template'

const action = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  scope: z.enum(['project', 'port', 'finding']),
  kind: z.enum(['shell', 'url', 'app']),
  template: z.string().max(2000),
  app: z.string().max(60).optional(),
  confirm: z.boolean()
})
const file = z.object({ version: z.literal(1), actions: z.array(action) })

export const draftSchema = action.partial({ id: true })

export class ActionStore {
  private actions: CustomAction[]
  constructor(private readonly path: string, private readonly onChange: (a: CustomAction[]) => void = () => undefined) {
    this.actions = readJson(join(path, 'actions.json'), file, () => ({ version: 1 as const, actions: [] })).actions
  }

  list(): CustomAction[] {
    return this.actions
  }
  get(id: string): CustomAction | undefined {
    return this.actions.find((a) => a.id === id)
  }

  save(draft: ActionDraft): CustomAction {
    const d = draftSchema.parse(draft)
    d.name = d.name.trim()
    if (!d.name) throw new Error('Give the action a name.')
    // An "app" action with no path means "the project folder".
    const template = d.kind === 'app' && !d.template.trim() ? '{project.path}' : d.template
    const problem = validateTemplate(template, d.scope, d.kind)
    if (problem) throw new Error(problem)
    if (d.kind === 'app' && (!d.app || !APP_NAME.test(d.app))) throw new Error('Enter the application name, for example Cursor or iTerm.')
    if (d.kind === 'url' && !/^https?:\/\//.test(template)) throw new Error('A link action must start with https:// or http://localhost.')
    const saved: CustomAction = { ...d, template, app: d.kind === 'app' ? d.app : undefined, id: d.id ?? randomUUID() }
    if (d.id && !this.get(d.id)) throw new Error('That action no longer exists.')
    this.actions = d.id ? this.actions.map((a) => (a.id === d.id ? saved : a)) : [...this.actions, saved]
    this.persist()
    return saved
  }

  delete(id: string): void {
    this.actions = this.actions.filter((a) => a.id !== id)
    this.persist()
  }

  private persist(): void {
    writeJsonAtomic(join(this.path, 'actions.json'), { version: 1, actions: this.actions })
    this.onChange(this.actions)
  }
}
