import { join } from 'path'
import { z } from 'zod'
import { readJson, writeJsonAtomic } from '../../json-store'
import { MAX_ROUTER_CHARS } from './ai'

const file = z.object({ version: z.literal(1), router: z.string().max(MAX_ROUTER_CHARS), savedAt: z.number() })

/** The router details the user gave once. Text only; images are never kept. */
export class RouterStore {
  private readonly path: string
  private router: string

  constructor(dir: string) {
    this.path = join(dir, 'wifi-router.json')
    this.router = readJson(this.path, file, () => ({ version: 1 as const, router: '', savedAt: 0 })).router
  }

  get(): string | undefined {
    return this.router || undefined
  }

  set(router: string): void {
    this.router = router
    writeJsonAtomic(this.path, { version: 1, router, savedAt: Date.now() })
  }
}
