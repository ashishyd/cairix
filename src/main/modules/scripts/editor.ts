import { execFile } from 'child_process'
import { spawnEnv } from '../../shell-env'

export interface EditorAttempt {
  file: string
  args: string[]
}

/**
 * The commands to try, in order, to open a file at a line. `cursor` and `code`
 * understand `--goto file:line:col`; the last resort opens the file in the
 * system's default editor (no line). `CAIRIX_EDITOR_BIN` replaces all of this in tests.
 */
export function editorAttempts(path: string, line?: number, column?: number, override = process.env.CAIRIX_EDITOR_BIN): EditorAttempt[] {
  const target = line ? `${path}:${line}${column ? `:${column}` : ''}` : path
  if (override) return [{ file: override, args: ['--goto', target] }]
  return [
    { file: 'cursor', args: ['--goto', target] },
    { file: 'code', args: ['--goto', target] },
    { file: 'open', args: ['-t', path] }
  ]
}

/** Opens the file with the first editor that exists. Resolves to the command that worked. */
export async function openInEditor(path: string, line?: number, column?: number): Promise<string> {
  const env = await spawnEnv()
  let last: Error | null = null
  for (const a of editorAttempts(path, line, column)) {
    try {
      await new Promise<void>((resolve, reject) => execFile(a.file, a.args, { env, timeout: 10_000 }, (err) => (err ? reject(err) : resolve())))
      return a.file
    } catch (e) {
      last = e as Error
    }
  }
  throw new Error(`Could not open the file in an editor${last ? `: ${last.message.split('\n')[0]}` : ''}.`)
}
