import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type { ZodType } from 'zod'

/**
 * Reads a JSON file and validates it. A missing, unreadable or invalid file
 * yields `fallback()` rather than throwing, so a corrupt config can never stop
 * the app from starting.
 */
export function readJson<T>(file: string, schema: ZodType<T>, fallback: () => T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
    return parsed.success ? parsed.data : fallback()
  } catch {
    return fallback()
  }
}

/** Write-then-rename so a crash mid-write never leaves a half-written file. */
export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}
