import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * Variables that describe *Cairix's own* runtime and must not leak into the
 * user's scripts. When Cairix is started with `pnpm dev`, children would
 * otherwise inherit `ELECTRON_RENDERER_URL` (so another electron-vite app
 * started from Cairix would load Cairix's page), `npm_*`/`PNPM_*` (confusing
 * nested package-manager runs) and a development NODE_ENV (which `next build`
 * and friends complain about).
 */
const LEAKY_ENV = /^(npm_|PNPM_|ELECTRON_|INIT_CWD$|NODE$|NODE_ENV$|NODE_OPTIONS$|VITE_DEV)/

export function cleanChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) if (!LEAKY_ENV.test(k)) out[k] = v
  return out
}

/**
 * A GUI app launched from the Dock or Finder inherits a minimal environment
 * from launchd: no nvm, Homebrew, ~/.local/bin, JAVA_HOME, PYENV_ROOT... so
 * `pnpm`, `claude` or `python3` "can't be found" even though they work in
 * Terminal. Ask the user's login shell for its real environment once and
 * reuse it for every spawn, so scripts behave exactly as they do in Terminal.
 * (The idea comes from Vaultic's ai-cli.ts, which only did PATH.)
 *
 * The shell is started from a *cleaned* copy of our env so the answer reflects
 * the user's dotfiles, not Cairix's own variables. These values go only to
 * processes the user asked us to start, never to the renderer or any log.
 * Interactive shells can print noise first (nvm banners, prompt frameworks),
 * so the payload is wrapped in markers.
 */
const START = '__CX_ENV_START__'
const END = '__CX_ENV_END__'

let loginEnv: Promise<Record<string, string> | null> | undefined

export function getLoginEnv(): Promise<Record<string, string> | null> {
  loginEnv ??= (async () => {
    const shell = process.env.SHELL || '/bin/zsh'
    try {
      const { stdout } = await execFileAsync(shell, ['-lic', `printf %s ${START}; env -0; printf %s ${END}`], {
        timeout: 10_000,
        maxBuffer: 4 * 1024 * 1024,
        env: cleanChildEnv(process.env)
      })
      const m = stdout.match(new RegExp(`${START}([\\s\\S]*?)${END}`))
      if (!m) return null
      const env: Record<string, string> = {}
      for (const entry of m[1].split('\0')) {
        const eq = entry.indexOf('=')
        if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1)
      }
      return Object.keys(env).length > 0 ? env : null
    } catch {
      return null
    }
  })()
  return loginEnv
}

export async function getResolvedPath(): Promise<string | null> {
  return (await getLoginEnv())?.PATH ?? null
}

/**
 * The environment for a process Cairix starts on the user's behalf: the
 * cleaned runtime env, overlaid with the login-shell env (the user's shell is
 * the source of truth), with PATH merged so nothing is lost. `extra` wins.
 */
export async function spawnEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
  const shell = (await getLoginEnv()) ?? {}
  const base = { ...cleanChildEnv(process.env), ...shell, ...extra }
  const parts = [...(shell.PATH ?? '').split(':'), ...(process.env.PATH ?? '').split(':')].filter(Boolean)
  if (parts.length > 0 && extra.PATH === undefined) base.PATH = [...new Set(parts)].join(':')
  return base
}
