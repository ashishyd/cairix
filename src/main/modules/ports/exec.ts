import { execFile } from 'child_process'
import type { RunCommand } from './scanner'

/**
 * Runs a read-only system command with a hard timeout and returns stdout.
 * `lsof` exits 1 when it finds nothing (no listeners), which is a normal
 * answer, not a failure, so a non-zero exit with usable stdout (or none) is
 * returned as-is; only a missing binary or a timeout throws.
 */
export const runCommand: RunCommand = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 8000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout) => {
        if (!err) return resolve(stdout)
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: string | number }
        if (e.code === 'ENOENT') return reject(new Error(`${file} was not found on this system.`))
        if (e.killed) return reject(new Error(`${file} timed out.`))
        resolve(stdout ?? '')
      }
    )
  })
