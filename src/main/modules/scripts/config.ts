import { join } from 'path'
import { z } from 'zod'
import type { ScriptConfig } from '@shared/types'
import { readJson, writeJsonAtomic } from '../../json-store'

const MAX_ENV = 50

/** Names that load foreign code into a process. Never settable from the UI. */
const INJECTION_NAME = /^(DYLD_|LD_)/
const NODE_CODE_FLAGS = /(^|\s)(--require|-r|--import|--loader|--experimental-loader|--eval|-e)(\s|=|$)/

const config = z.object({
  args: z.string().max(1000),
  env: z.record(z.string(), z.string().max(4000)),
  watch: z.boolean()
})
const file = z.object({ version: z.literal(1), configs: z.record(z.string().max(300), config) })

const isEmpty = (c: ScriptConfig): boolean => c.args.trim() === '' && Object.keys(c.env).length === 0 && !c.watch

/** Checks a config the way main will use it. Throws a readable message. */
export function validateConfig(c: ScriptConfig): ScriptConfig {
  const parsed = config.parse(c)
  const names = Object.keys(parsed.env)
  if (names.length > MAX_ENV) throw new Error(`At most ${MAX_ENV} environment variables per script.`)
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`"${name}" is not a valid variable name.`)
    if (INJECTION_NAME.test(name)) throw new Error(`${name} loads other code into the process and cannot be set here.`)
    if (parsed.env[name].includes('\0')) throw new Error(`The value of ${name} contains an invalid character.`)
  }
  if (parsed.env.NODE_OPTIONS && NODE_CODE_FLAGS.test(parsed.env.NODE_OPTIONS)) throw new Error('NODE_OPTIONS cannot load or evaluate code here.')
  return { ...parsed, args: parsed.args.trim() }
}

/** Per-script defaults: arguments, extra environment, and restart-on-change. Saved across restarts. */
export class ScriptConfigStore {
  private configs: Record<string, ScriptConfig>
  private readonly path: string

  constructor(dir: string, private readonly onChange: (c: Record<string, ScriptConfig>) => void = () => undefined) {
    this.path = join(dir, 'script-configs.json')
    this.configs = readJson(this.path, file, () => ({ version: 1 as const, configs: {} })).configs
  }

  all(): Record<string, ScriptConfig> {
    return this.configs
  }
  get(scriptId: string): ScriptConfig | undefined {
    return this.configs[scriptId]
  }

  /** Saves a config; `null` (or one with nothing set) removes it. */
  set(scriptId: string, next: ScriptConfig | null): Record<string, ScriptConfig> {
    const copy = { ...this.configs }
    const valid = next ? validateConfig(next) : null
    if (!valid || isEmpty(valid)) delete copy[scriptId]
    else copy[scriptId] = valid
    this.configs = copy
    writeJsonAtomic(this.path, { version: 1, configs: this.configs })
    this.onChange(this.configs)
    return this.configs
  }
}
