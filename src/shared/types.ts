// ───────────────────────── Projects ─────────────────────────

export type ProjectKind = 'node' | 'python' | 'rust' | 'go' | 'compose' | 'make'
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export interface Project {
  /** Stable id: short hash of the absolute path. */
  id: string
  name: string
  path: string
  /** Path relative to the workspace root; '' for the root itself. */
  relPath: string
  kinds: ProjectKind[]
  packageManager?: PackageManager
  /** True when this folder declares workspaces (pnpm/npm/yarn/turbo/nx/lerna). */
  isMonorepoRoot: boolean
  /** Nearest enclosing project inside the same workspace, if any. */
  parentId: string | null
  hasGit: boolean
}

export interface Workspace {
  id: string
  name: string
  path: string
  addedAt: number
  /**
   * Untrusted workspaces can be browsed but cannot run scripts. Cloned repos
   * can ship hostile package.json scripts, so running code needs an explicit yes.
   */
  trusted: boolean
  /** Discovered project paths the user unchecked in the preview. Honoured on rescan. */
  excludedPaths: string[]
  projects: Project[]
}

export interface DiscoveryPreview {
  rootPath: string
  name: string
  projects: Project[]
  alreadyAdded: boolean
  /** True when the walk stopped early at the safety cap. */
  truncated: boolean
}

export interface AddWorkspaceRequest {
  path: string
  excludedPaths: string[]
  trusted: boolean
}

// ───────────────────────── Scripts ─────────────────────────

export type ScriptSource =
  | 'package.json'
  | 'pyproject'
  | 'manage.py'
  | 'makefile'
  | 'python-file'
  | 'compose'
  | 'toolchain'
export type ScriptCategory = 'dev' | 'build' | 'test' | 'lint' | 'db' | 'other'

/** What the UI sees. The actual spawn spec never crosses IPC: the renderer asks by id. */
export interface ScriptDef {
  id: string
  projectId: string
  name: string
  /** Human-readable command line, for display and tooltips only. */
  command: string
  source: ScriptSource
  category: ScriptCategory
  /** Likely interactive (prompts / REPL): offer "open in Terminal" instead of the log view. */
  needsTty: boolean
}

export type RunStatus = 'running' | 'stopping' | 'exited' | 'failed' | 'stopped'

export interface RunInfo {
  runId: string
  scriptId: string
  projectId: string
  projectName: string
  scriptName: string
  command: string
  pid: number
  startedAt: number
  endedAt?: number
  status: RunStatus
  exitCode?: number | null
  /** Listening ports owned by this run's process tree (filled in by the port scanner). */
  ports: number[]
  /** Set when logs mention EADDRINUSE: lets the UI offer "free the port and retry". */
  portConflict?: number
  /** Extra arguments the user passed, kept so an automatic restart runs the same thing. */
  args?: string[]
  /** How many times in a row Cairix restarted this script after a crash (0 or absent: started by you). */
  autoRestarts?: number
}

export interface RunScriptRequest {
  scriptId: string
  /** Extra arguments appended after the script, e.g. `--watch`. */
  args?: string[]
}

export interface RunOutputEvent {
  runId: string
  chunk: string
  /** Total characters the run had produced before this chunk. Lets a log view that attached mid-stream stitch exactly. */
  offset: number
}

/** A run's retained output (the oldest part may have been trimmed) and its true running length. */
export interface LogSnapshot {
  text: string
  length: number
}

// ───────────────────────── Ports ─────────────────────────

export type PortCategory = 'dev' | 'database' | 'system' | 'other'

export interface PortEntry {
  port: number
  /** Bind address as reported by lsof, e.g. `*`, `127.0.0.1`, `[::1]`. */
  address: string
  /** Reachable from other machines on the network (bound to `*` or a non-loopback address). */
  exposed: boolean
  pid: number
  ppid: number
  pgid: number
  /** Short process name from lsof/ps. */
  name: string
  /** Full command line (may be long). */
  cmdline: string
  user: string
  /** Resident memory of this process only, in KiB. */
  rssKb: number
  /**
   * Resident memory of the whole dev server: the listener, its descendants and
   * any wrapper processes above it (pnpm → node → next-server), in KiB.
   */
  treeRssKb: number
  /**
   * Root of the process tree counted in `treeRssKb`. Two ports served by one
   * dev server share a footprintPid, so totals must be deduplicated by it.
   */
  footprintPid: number
  cpu: number
  /** Seconds the process has been running. */
  uptimeSec: number
  cwd?: string
  projectId?: string
  projectName?: string
  /** `runId` when Cairix itself started this process tree. */
  runId?: string
  framework?: string
  category: PortCategory
  protected: boolean
  protectReason?: string
  /** Friendly hint for known surprises, e.g. macOS AirPlay Receiver on 5000/7000. */
  hint?: string
}

export interface PortSnapshot {
  at: number
  entries: PortEntry[]
  /** Memory of all `dev` + `database` servers combined, each footprint counted once. */
  devRssKb: number
  /** Scan duration in ms, handy for spotting a slow machine. */
  tookMs: number
  error?: string
}

export interface KillRequest {
  pid: number
  /** SIGKILL instead of SIGTERM. */
  force?: boolean
}

export interface KillResult {
  ok: boolean
  signal: 'SIGTERM' | 'SIGKILL'
  /** Pids that received the signal (the target plus its descendants). */
  signalled: number[]
  /** Pids still alive after the grace period. Non-empty means "offer force kill". */
  stillAlive: number[]
  error?: string
}

// ───────────────────────── Agents ─────────────────────────

export type AgentKind = 'claude' | 'cursor'

/**
 * One running local coding agent. Deliberately has no command line or
 * environment: agent processes carry credentials (Cursor workers get
 * `--api-key` on argv), and this view only needs to say *what* is running.
 */
export interface AgentSession {
  id: string
  kind: AgentKind
  pid: number
  title: string
  cwd: string
  projectId?: string
  projectName?: string
  /** Claude reports busy/idle. Cursor's background workers can't be introspected, so they're just `running`. */
  status: 'busy' | 'idle' | 'running'
  startedAt: number
  updatedAt?: number
  rssKb: number
  cpu: number
  /** Where it was launched from, e.g. `claude-desktop`, `cli`. */
  surface?: string
  version?: string
}

export interface AgentCli {
  installed: boolean
  version?: string
  /**
   * How the CLI is paid for. A subscription login (claude.ai) isn't billed per run: the CLI's
   * dollar figure is only an API-price equivalent and counts against plan limits instead.
   */
  billing?: 'subscription' | 'api'
}

export interface CursorPlan {
  title: string
  path: string
  modifiedAt: number
}

export interface AgentsSnapshot {
  at: number
  claude: AgentCli
  cursor: AgentCli & { appRunning: boolean; appRssKb: number }
  sessions: AgentSession[]
  /** Recent plans Cursor's agent wrote (~/.cursor/plans), newest first. */
  plans: CursorPlan[]
}

// ───────────────────────── Changes (pending git changes review) ─────────────────────────

export type Severity = 'error' | 'warning' | 'info'

export interface LearnLink {
  title: string
  url: string
  /** Site name shown next to the link, e.g. "OWASP", "MDN". */
  source: string
}

export interface Finding {
  /** Stable across runs (hash of file + rule + the offending line) so a dismissal sticks. */
  id: string
  severity: Severity
  category: string
  file: string
  line?: number
  title: string
  explanation: string
  origin: 'check' | 'ai'
  learn?: LearnLink
  /** True when Cairix can fix this instantly without an AI call. */
  quickFix: boolean
}

export interface ChangedFile {
  path: string
  /** Git status letter: M modified, A added, D deleted, R renamed, ? untracked. */
  status: string
  staged: boolean
  additions: number
  deletions: number
}

export interface ChangesState {
  projectId: string
  isRepo: boolean
  branch?: string
  files: ChangedFile[]
  /** Changes whenever the diff does; the UI uses it to know a review is current. */
  fingerprint: string
  findings: Finding[]
  /** Findings hidden by the user. */
  dismissedCount: number
  ai: { available: boolean; reviewed: boolean; reviewing: boolean; error?: string; costUsd?: number; at?: number }
  error?: string
}

/** One project's pending work, for the dashboard. Cheap: git + instant checks only, never the AI. */
export interface ChangesOverviewItem {
  projectId: string
  name: string
  branch?: string
  files: number
  errors: number
  warnings: number
}

export interface FixProposal {
  id: string
  findingId: string
  projectId: string
  /** Unified diff that would be applied to the working tree. */
  patch: string
  files: string[]
  by: 'quick-fix' | 'claude' | 'agent'
  costUsd?: number
  applied: boolean
}

// ───────────────────────── Audit (on-demand, whole project) ─────────────────────────

export const AUDIT_CATEGORIES = ['bugs', 'security', 'performance', 'accessibility', 'ux', 'maintainability'] as const
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]

export interface AuditOptions {
  categories: AuditCategory[]
}

/** What an audit WOULD do, shown before anything is sent anywhere. */
export interface AuditPlan {
  isRepo: boolean
  /** Source files found vs files that fit the size budget and will be analysed. */
  totalFiles: number
  files: number
  bytes: number
  tokensEstimate: number
  /** Number of separate Claude requests. */
  requests: number
  /** Hard upper bound: every request is capped, so the audit cannot exceed this. */
  maxCostUsd: number
  aiAvailable: boolean
}

export interface AuditState {
  projectId: string
  phase: 'idle' | 'running' | 'done' | 'error' | 'cancelled'
  progress: { done: number; total: number }
  findings: Finding[]
  /** Findings from the free instant checks, included in `findings`. */
  instantCount: number
  startedAt?: number
  finishedAt?: number
  costUsd: number
  failedRequests: number
  error?: string
  filesAnalyzed: number
  /** Versus the previous completed audit of this project. */
  compared?: { newCount: number; fixedCount: number; at: number }
  dismissedCount: number
}

// ───────────────────────── Custom actions ─────────────────────────

export type ActionScope = 'project' | 'port' | 'finding'
export type ActionKind = 'shell' | 'url' | 'app'

/**
 * A user-defined action. `shell` runs a command, `url` opens a link, `app`
 * opens a path in a macOS app. Templates may use {variables}; which ones are
 * available depends on the scope (see actions/template.ts).
 */
export interface CustomAction {
  id: string
  name: string
  scope: ActionScope
  kind: ActionKind
  /** shell: the command. url: the URL. app: the path to open (default {project.path}). */
  template: string
  /** app: the application name, e.g. "Cursor" or "iTerm". */
  app?: string
  /** Ask before running, showing exactly what will happen. */
  confirm: boolean
}

export type ActionDraft = Omit<CustomAction, 'id'> & { id?: string }

/** What the action was invoked on. Main resolves ids to real values; the UI never sends paths or commands. */
export interface ActionContext {
  scope: ActionScope
  projectId?: string
  port?: number
  pid?: number
  file?: string
  line?: number
}

export interface ActionPreview {
  /** Human-readable description of what would happen, with variables filled in. */
  summary: string
  kind: ActionKind
  confirm: boolean
}

export interface ActionResult {
  /** Set for shell actions: the run whose log can be shown. */
  runId?: string
  message?: string
}

// ───────────────────────── Agent tasks (headless runs) ─────────────────────────

export type TaskAgent = 'claude' | 'cursor'
/** `read`: may only look at the code. `edit`: may change files, but only in a throwaway copy you review. */
export type TaskMode = 'read' | 'edit'
export type TaskStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface TaskEvent {
  kind: 'text' | 'tool' | 'info' | 'error'
  text: string
}

export interface AgentTask {
  id: string
  projectId: string
  agent: TaskAgent
  mode: TaskMode
  prompt: string
  status: TaskStatus
  startedAt: number
  endedAt?: number
  /** What the agent did, newest last (capped). */
  events: TaskEvent[]
  /** The agent's final answer. */
  result?: string
  /** Edit mode: what changed in the throwaway copy. The diff itself is fetched with `propose`. */
  changes?: { files: string[]; additions: number; deletions: number }
  costUsd?: number
  budgetUsd?: number
  error?: string
}

export interface StartTaskRequest {
  agent: TaskAgent
  mode: TaskMode
  prompt: string
  /** Claude only: hard spending cap for this run. */
  budgetUsd?: number
}

export interface TaskCapabilities {
  claude: boolean
  cursor: boolean
}

// ───────────────────────── App ─────────────────────────

export interface AppInfo {
  name: string
  version: string
  electron: string
  node: string
  platform: string
  userDataPath: string
}

export type ExternalApp = 'finder' | 'terminal' | 'vscode' | 'cursor'

// ───────────────────────── Processes ─────────────────────────

/** A background process (or the top of a process tree) owned by the current user. */
export interface ProcessEntry {
  pid: number
  /** Short, human name (framework or executable). */
  name: string
  /** Full command line, redacted. */
  cmdline: string
  rssKb: number
  /** Memory of this process and everything it launched, in KiB. */
  treeRssKb: number
  /** Number of processes in the tree, this one included. */
  procCount: number
  cpu: number
  uptimeSec: number
  /** Ports the tree is listening on. */
  ports: number[]
  cwd?: string
  /** `runId` when Cairix itself started this tree. */
  runId?: string
  framework?: string
  category: PortCategory
}

export interface ProcessSnapshot {
  at: number
  /** Which view this answers: dev tooling only, or all of the user's processes. */
  filter: 'dev' | 'all'
  entries: ProcessEntry[]
  /** Total processes owned by the user, before filtering. */
  total: number
  error?: string
}

export interface StopProcessRequest {
  pid: number
  force?: boolean
  /** The view the row was listed in, so main re-derives the same tree. */
  filter: 'dev' | 'all'
}

// ───────────────────────── Command history ─────────────────────────

/** One distinct command from the user's shell history, with how often it ran. */
export interface HistoryEntry {
  id: string
  command: string
  count: number
  firstSeen: number
  lastRun: number
  /** First word, e.g. `git`. */
  program: string
  /** Plain-English summary of what the command does. */
  description: string
  /** Deletes, forces, or runs as root: re-running asks first. */
  risky: boolean
  /** Needs a real terminal (editors, ssh, REPLs): re-runs in Terminal.app. */
  interactive: boolean
  /** Folders it was run in, most used first. Empty until the shell hook has seen it. */
  folders: Array<{ path: string; count: number }>
}

/** "Never track" rule: one exact command, or every command of one program. */
export interface HistoryRule {
  kind: 'command' | 'program'
  value: string
}

export interface HistorySnapshot {
  entries: HistoryEntry[]
  rules: HistoryRule[]
  /** History files Cairix reads, and whether each exists. */
  sources: Array<{ path: string; found: boolean }>
  /** False when the History module is switched off in Settings. */
  tracking: boolean
  /** The optional zsh hook that records which folder each command ran in. */
  hook: HistoryHookStatus
}

export interface HistoryHookStatus {
  /** Cairix's line is present in ~/.zshrc. */
  installed: boolean
  /** The hook has reported at least one command, so folders are being learned. */
  recording: boolean
  /** The file the line is added to, for display. */
  rcFile: string
  /** What gets added, shown before the user agrees. */
  snippet: string
}

export interface HistoryRerunRequest {
  id: string
  /** Run inside this project's folder instead of the home folder (must be a trusted folder). */
  projectId?: string
  /** One of the folders this command was seen in (checked by main; must be inside a trusted folder). */
  folder?: string
  /** The user confirmed a risky command. */
  confirmed?: boolean
}

export interface HistoryRerunResult {
  /** Present when the command runs inside Cairix (output is shown in a log). */
  runId?: string
  /** Present when it was handed to Terminal.app. */
  message?: string
}

// ───────────────────────── Run history ─────────────────────────

/** A finished script run, kept across restarts. */
export interface RunRecord {
  runId: string
  scriptId: string
  projectId: string
  projectName: string
  scriptName: string
  command: string
  startedAt: number
  endedAt: number
  durationMs: number
  status: Exclude<RunStatus, 'running' | 'stopping'>
  exitCode?: number | null
}

export interface RunsSnapshot {
  records: RunRecord[]
}

/** Where a notification click should land. */
export type NavigateTarget = { kind: 'project'; projectId: string; tab: string } | { kind: 'machine'; page: string }

// ───────────────────────── Environment files ─────────────────────────

export interface EnvVarInfo {
  key: string
  /** Value is empty: set in the template but not filled in here. */
  empty: boolean
  length: number
  /** The name suggests a secret (token, key, password...). */
  sensitive: boolean
  /** The value itself, only when it is short, harmless and not secret-looking (a port, a mode). */
  preview?: string
}

export interface EnvFileInfo {
  name: string
  /** `.env.example` style files are templates: safe to commit, no real values. */
  kind: 'local' | 'template'
  vars: EnvVarInfo[]
  /** null when the project is not a git repository. */
  gitignored: boolean | null
  /** A local file that git tracks: its secrets are in the repository history. */
  tracked: boolean
  /** Keys the template has that this file lacks or leaves empty. */
  missing: string[]
  /** Keys this file has that the template does not know about. */
  extra: string[]
  /** The template this was compared with. */
  template?: string
}

export interface EnvSnapshot {
  files: EnvFileInfo[]
  hasGit: boolean
}

// ───────────────────────── Per-script settings ─────────────────────────

export interface ScriptConfig {
  /** Default extra arguments, as typed. */
  args: string
  /** Environment variables added for this script only. */
  env: Record<string, string>
  /** Restart it when files in the project change. */
  watch: boolean
}

// ───────────────────────── Git ─────────────────────────

export interface GitBranch {
  name: string
  current: boolean
  upstream?: string
  ahead: number
  behind: number
  /** Relative time of the last commit, e.g. "3 days ago". */
  when?: string
  subject?: string
}

export interface GitStash {
  index: number
  message: string
}

export interface GitCommitInfo {
  hash: string
  subject: string
  author: string
  when: string
}

export interface GitState {
  /** Current branch, or null on a detached HEAD. */
  branch: string | null
  /** Short hash when detached. */
  detached?: string
  upstream?: string
  ahead: number
  behind: number
  staged: number
  changed: number
  untracked: number
  conflicted: number
  hasCommits: boolean
  /** Name of the first remote, if any. */
  remote?: string
  branches: GitBranch[]
  stashes: GitStash[]
  recent: GitCommitInfo[]
}

export interface GitPullRequest {
  number: number
  title: string
  url: string
  state: string
  isDraft: boolean
  checks: { passed: number; failed: number; pending: number }
  review?: string
}

export interface GitPrResult {
  /** The GitHub CLI is installed and signed in. */
  available: boolean
  reason?: string
  pr?: GitPullRequest
}

export type GitStashOp = 'push' | 'pop' | 'drop'

// ───────────────────────── Containers ─────────────────────────

export interface ContainerInfo {
  id: string
  name: string
  image: string
  /** running, exited, paused, restarting, created, dead */
  state: string
  /** Human status, e.g. "Up 3 hours". */
  status: string
  ports: string
  composeProject?: string
  composeService?: string
  /** Folder the Compose file lives in, when Docker knows it. */
  workingDir?: string
  projectId?: string
  projectName?: string
}

export interface ContainersSnapshot {
  at: number
  /** Docker is installed and its daemon answers. */
  available: boolean
  reason?: string
  containers: ContainerInfo[]
}

export type ContainerAction = 'start' | 'stop' | 'restart'

// ───────────────────────── Project health ─────────────────────────

export interface ToolCheck {
  tool: string
  /** What the project asks for, e.g. "20" or ">=18". */
  wanted: string
  /** Where that requirement is written, e.g. ".nvmrc". */
  source: string
  /** What is installed, if it could be found. */
  actual?: string
  /** null when it could not be decided. */
  ok: boolean | null
  hint?: string
}

export interface DiskHog {
  /** Folder name inside the project, e.g. "node_modules". */
  name: string
  sizeKb: number
  /** What makes it again, e.g. "pnpm install". */
  regenerate: string
}

export interface HealthSnapshot {
  tools: ToolCheck[]
  hogs: DiskHog[]
  manager?: 'npm' | 'pnpm' | 'yarn' | 'bun'
}

export interface OutdatedDep {
  name: string
  current: string
  wanted: string
  latest: string
  type: string
  /** The latest version is a new major release. */
  major: boolean
}

export interface VulnSummary {
  total: number
  critical: number
  high: number
  moderate: number
  low: number
  top: Array<{ name: string; severity: string; title?: string }>
}

export interface DepsReport {
  manager: string
  outdated: OutdatedDep[]
  vulns?: VulnSummary
  /** Why the vulnerability check could not run (the outdated list may still be fine). */
  vulnError?: string
  error?: string
  ranAt: number
}

// ───────────────────────── Schedules ─────────────────────────

export type ScheduleTrigger =
  | { kind: 'every'; minutes: number }
  | { kind: 'daily'; /** "HH:MM", 24 h, local time */ time: string; /** 0 = Sunday ... 6 = Saturday; empty = every day */ days: number[] }
  | { kind: 'git-change'; projectId: string }

export type ScheduleTarget =
  | { kind: 'script'; scriptId: string; label: string }
  | { kind: 'task'; projectId: string; prompt: string; agent: TaskAgent }

export interface Schedule {
  id: string
  name: string
  enabled: boolean
  trigger: ScheduleTrigger
  target: ScheduleTarget
  lastRunAt?: number
  lastStatus?: 'started' | 'skipped' | 'failed'
  lastMessage?: string
  createdAt: number
  /** Filled in when listing: when it will next fire (time-based triggers). */
  nextRunAt?: number
}

export type ScheduleDraft = Omit<Schedule, 'id' | 'createdAt' | 'lastRunAt' | 'lastStatus' | 'lastMessage' | 'nextRunAt'> & { id?: string }

// ───────────────────────── Script helpers ─────────────────────────

/** A port a script is about to use that something else already holds. */
export interface PortConflict {
  port: number
  pid: number
  holder: string
  framework?: string
  projectName?: string
  protected: boolean
  hint?: string
  /** How we knew the script would use it, e.g. "--port 3000". */
  why: string
}
