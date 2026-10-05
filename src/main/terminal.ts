import { execFile } from 'child_process'
import { spawnEnv } from './shell-env'

export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
const appleScriptEscape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** Runs one shell line in a new Terminal.app window. For things that need a real terminal. */
export async function runInTerminal(line: string): Promise<void> {
  const env = await spawnEnv()
  await new Promise<void>((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script "${appleScriptEscape(line)}"`],
      { env },
      (err) => (err ? reject(new Error('Could not open Terminal.')) : resolve())
    )
  })
}
