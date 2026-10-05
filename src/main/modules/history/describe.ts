/**
 * Explains a shell command in plain English, locally and for free (no AI call,
 * nothing leaves the machine). Covers the tools developers run daily; anything
 * else gets an honest generic line rather than a guess.
 */

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/

/** Splits a command into words, honouring simple quotes. Good enough for classification, not for execution. */
export function words(command: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(command); m; m = re.exec(command)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** The first pipeline stage, as words, without leading `VAR=x` assignments or `sudo`/`time`/`env`. */
function head(command: string): string[] {
  const first = command.split(/\s*(?:\|\||&&|\||;)\s*/)[0] ?? ''
  let w = words(first)
  while (w.length > 0 && (ENV_ASSIGN.test(w[0]) || ['sudo', 'time', 'env', 'nohup', 'command', 'builtin'].includes(w[0]))) w = w.slice(1)
  return w
}

/** The program a command runs, e.g. `git`. Path prefixes are dropped. */
export function programOf(command: string): string {
  const w = head(command)
  return (w[0] ?? '').split('/').pop() ?? ''
}

const RISKY = [
  /(^|[\s;&|])sudo\s/,
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*|--recursive|--force)/,
  /\bgit\s+(push\s+.*(--force|-f\b)|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|restore\s)/,
  /\b(dd|mkfs|fdisk|diskutil\s+(erase|partition))\b/,
  /\b(chmod|chown)\s+-R/,
  /\b(kill|killall|pkill)\b/,
  /\bdrop\s+(table|database|schema)\b/i,
  /\b(truncate|shred|shutdown|reboot|halt)\b/,
  />\s*\/dev\/(sd|disk|nvme)/,
  /\|\s*(sudo\s+)?(ba|z)?sh\b/,
  /\bdocker\s+(system\s+prune|volume\s+rm|rm\s+-f)/
]

/** Deletes, forces, or runs as root. Re-running these asks first. */
export function isRisky(command: string): boolean {
  return RISKY.some((re) => re.test(command))
}

const ALWAYS_INTERACTIVE = new Set([
  'vim', 'vi', 'nvim', 'nano', 'emacs', 'micro', 'less', 'more', 'man', 'top', 'htop', 'btop', 'ssh', 'sftp', 'telnet', 'mosh',
  'tmux', 'screen', 'fzf', 'lazygit', 'gitui', 'k9s', 'irb', 'pry', 'ipython', 'psql', 'mysql', 'mongosh', 'redis-cli', 'sqlite3',
  'claude', 'codex', 'aider', 'ftp', 'watch', 'ncdu', 'tig'
])
const INTERACTIVE_WHEN_BARE = new Set(['python', 'python3', 'node', 'ruby', 'php', 'lua', 'bun', 'deno', 'irb', 'bash', 'zsh', 'fish', 'sh'])

/** Needs a real terminal (keyboard input, full-screen UI). Those open in Terminal.app instead of a log. */
export function isInteractive(command: string): boolean {
  if (/\s&\s*$/.test(command)) return false
  const w = head(command)
  const prog = (w[0] ?? '').split('/').pop() ?? ''
  if (ALWAYS_INTERACTIVE.has(prog)) return true
  if (INTERACTIVE_WHEN_BARE.has(prog) && w.slice(1).every((a) => a.startsWith('-') && !['-c', '-e', '-m', '-p'].includes(a))) return true
  if (prog === 'git' && w[1] === 'rebase' && w.includes('-i')) return true
  // `git commit` with no message opens an editor.
  if (prog === 'git' && w[1] === 'commit' && !w.some((a) => /^(-[a-zA-Z]*m|--message|--no-edit|-F|--file)/.test(a))) return true
  if (prog === 'docker' && ['run', 'exec'].includes(w[1] ?? '') && w.some((a) => /^-[a-zA-Z]*[it][a-zA-Z]*$/.test(a) || a === '--interactive' || a === '--tty')) return true
  return false
}

const GIT: Record<string, string> = {
  status: 'Shows which files changed in the repository',
  add: 'Stages changes for the next commit',
  commit: 'Records staged changes as a commit',
  push: 'Uploads local commits to the remote repository',
  pull: 'Fetches and merges the latest remote changes',
  fetch: 'Downloads remote changes without merging them',
  checkout: 'Switches branch or restores files',
  switch: 'Switches to another branch',
  branch: 'Lists, creates or deletes branches',
  merge: 'Merges another branch into the current one',
  rebase: 'Replays commits on top of another base',
  log: 'Shows commit history',
  diff: 'Shows what changed between versions',
  stash: 'Sets uncommitted changes aside (or brings them back)',
  clone: 'Copies a repository to this machine',
  reset: 'Moves the branch pointer, possibly discarding changes',
  restore: 'Restores files to an earlier state',
  clean: 'Deletes untracked files',
  remote: 'Manages the remotes this repository talks to',
  tag: 'Lists or creates tags',
  show: 'Shows one commit or object',
  init: 'Creates a new repository here',
  'cherry-pick': 'Applies a specific commit onto the current branch',
  worktree: 'Manages extra working copies of this repository',
  blame: 'Shows who last changed each line of a file'
}

const PKG_SCRIPTS: Record<string, string> = {
  install: 'Installs the project’s dependencies', i: 'Installs the project’s dependencies', add: 'Adds a dependency to the project',
  remove: 'Removes a dependency from the project', uninstall: 'Removes a dependency from the project', update: 'Updates dependencies', up: 'Updates dependencies',
  init: 'Creates a new package.json', ci: 'Installs exactly what the lockfile says (clean install)', publish: 'Publishes the package to the registry',
  link: 'Links a local package for development', exec: 'Runs a locally installed tool', dlx: 'Downloads and runs a package once', create: 'Scaffolds a new project from a template'
}

const PROGRAMS: Record<string, string> = {
  ls: 'Lists files in a folder', cd: 'Changes the current folder', pwd: 'Prints the current folder', cat: 'Prints a file’s contents', less: 'Reads a file page by page',
  head: 'Shows the start of a file', tail: 'Shows the end of a file (or follows it live with -f)', grep: 'Searches text for a pattern', rg: 'Searches code quickly for a pattern',
  find: 'Finds files by name or property', fd: 'Finds files by name', cp: 'Copies files', mv: 'Moves or renames files', rm: 'Deletes files', mkdir: 'Creates a folder', touch: 'Creates an empty file or updates its timestamp',
  open: 'Opens a file, folder or app with macOS', code: 'Opens VS Code', cursor: 'Opens Cursor', vim: 'Edits a file in Vim', nvim: 'Edits a file in Neovim', nano: 'Edits a file in nano',
  curl: 'Makes an HTTP request', wget: 'Downloads a file', ssh: 'Opens a remote shell session', scp: 'Copies files over SSH', rsync: 'Syncs files between locations',
  brew: 'Manages software with Homebrew', make: 'Runs a Makefile target', cargo: 'Builds or runs a Rust project', go: 'Builds or runs a Go project', python: 'Runs Python', python3: 'Runs Python 3',
  node: 'Runs Node.js', tsx: 'Runs a TypeScript file', npx: 'Runs a package binary', pip: 'Manages Python packages', pip3: 'Manages Python packages', uv: 'Manages Python projects and packages', poetry: 'Manages a Python project',
  kubectl: 'Talks to a Kubernetes cluster', terraform: 'Plans or applies infrastructure as code', aws: 'Calls the AWS command line', gcloud: 'Calls the Google Cloud command line', vercel: 'Works with Vercel deployments', supabase: 'Works with Supabase',
  claude: 'Starts Claude Code', clear: 'Clears the terminal', exit: 'Closes the shell', history: 'Shows shell history', echo: 'Prints text', export: 'Sets an environment variable', source: 'Loads a shell script into this shell',
  kill: 'Sends a signal to a process', killall: 'Stops processes by name', lsof: 'Lists open files and ports', ps: 'Lists running processes', top: 'Shows live process usage', htop: 'Shows live process usage',
  tar: 'Creates or extracts archives', unzip: 'Extracts a zip archive', zip: 'Creates a zip archive', chmod: 'Changes file permissions', chown: 'Changes file ownership', ln: 'Creates a link', which: 'Shows where a command lives',
  tmux: 'Manages terminal sessions', jq: 'Filters and formats JSON', sed: 'Edits text with patterns', awk: 'Processes text by columns', sort: 'Sorts lines', wc: 'Counts lines, words or bytes', du: 'Shows disk usage', df: 'Shows free disk space',
  psql: 'Opens a PostgreSQL session', redis: 'Talks to Redis', 'redis-cli': 'Talks to Redis', gh: 'Works with GitHub from the terminal', docker: 'Manages containers', 'docker-compose': 'Manages multi-container apps'
}

const DOCKER: Record<string, string> = {
  run: 'Starts a new container', ps: 'Lists containers', build: 'Builds an image', compose: 'Manages a multi-container app', exec: 'Runs a command inside a container', logs: 'Shows a container’s output',
  stop: 'Stops a container', rm: 'Deletes a container', images: 'Lists images', pull: 'Downloads an image', push: 'Uploads an image', system: 'Manages Docker’s disk usage', volume: 'Manages volumes', up: 'Starts the app’s containers', down: 'Stops and removes the app’s containers'
}

const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])

function pkg(prog: string, w: string[]): string {
  const sub = w[1]
  if (!sub) return `Runs ${prog}`
  if (sub === 'run' || sub === 'run-script') return w[2] ? `Runs the “${w[2]}” script from package.json` : 'Lists the scripts in package.json'
  if (sub === 'test' || sub === 't') return 'Runs the project’s tests'
  if (sub === 'start') return 'Starts the project'
  if (sub === 'build') return 'Builds the project'
  if (PKG_SCRIPTS[sub]) return PKG_SCRIPTS[sub]
  // pnpm/yarn/bun treat unknown words as script names: `pnpm dev`.
  return `Runs the “${sub}” script from package.json`
}

/** One plain-English sentence about the command. */
export function describeCommand(command: string): string {
  const w = head(command)
  if (w.length === 0) return 'Runs a shell command'
  const prog = (w[0] ?? '').split('/').pop() ?? ''
  const rest = command.includes('|') ? ' and pipes the result onward' : ''
  let base: string | undefined
  if (prog === 'git') base = (w[1] && GIT[w[1]]) || (w[1] ? `Runs git ${w[1]}` : 'Runs git')
  else if (PKG_MANAGERS.has(prog)) base = pkg(prog, w)
  else if (prog === 'docker' || prog === 'docker-compose') {
    const sub = prog === 'docker-compose' ? 'compose' : w[1]
    base = (sub && DOCKER[sub]) || (sub ? `Runs docker ${sub}` : 'Manages containers')
    if (sub === 'compose' && w[prog === 'docker' ? 2 : 1] && DOCKER[w[prog === 'docker' ? 2 : 1]]) base = DOCKER[w[prog === 'docker' ? 2 : 1]]
  } else if (prog === 'kubectl' && w[1]) base = `Runs kubectl ${w[1]} against the current cluster`
  else if (prog === 'brew' && w[1]) base = ({ install: 'Installs a package with Homebrew', update: 'Updates Homebrew’s package list', upgrade: 'Upgrades installed packages', uninstall: 'Removes a Homebrew package', list: 'Lists Homebrew packages', services: 'Manages background services' } as Record<string, string>)[w[1]] ?? 'Manages software with Homebrew'
  else if (prog === 'curl') base = /\s-X\s*(POST|PUT|PATCH|DELETE)/i.test(command) ? 'Sends a request that changes data on a server' : 'Makes an HTTP request'
  else base = PROGRAMS[prog]
  if (!base) base = `Runs ${prog || 'a command'}${w.length > 1 ? ` with ${w.length - 1} argument${w.length === 2 ? '' : 's'}` : ''}`
  const sudo = /(^|[\s;&|])sudo\s/.test(command) ? ' (as administrator)' : ''
  return base + sudo + rest
}
