import type { ContributionKind, PluginInfo, PluginNotification, PluginsListResult, RenderContext, UiNode } from './plugins'
import type { GenerateLessonRequest, LearnSnapshot, Lesson } from './learn'
import type { Settings, SettingsPatch } from './settings-types'
import type {
  ActionContext,
  ActionDraft,
  ActionPreview,
  ActionResult,
  AddWorkspaceRequest,
  AgentsSnapshot,
  AgentTask,
  AppInfo,
  ContainerAction,
  ContainersSnapshot,
  DepsReport,
  GitPrResult,
  GitState,
  GitStashOp,
  HealthSnapshot,
  PortConflict,
  Schedule,
  ScheduleDraft,
  EnvSnapshot,
  ScriptConfig,
  NavigateTarget,
  RunRecord,
  HistoryRerunRequest,
  HistoryRerunResult,
  HistoryRule,
  HistorySnapshot,
  ProcessSnapshot,
  StopProcessRequest,
  StartTaskRequest,
  TaskCapabilities,
  CustomAction,
  AuditOptions,
  AuditPlan,
  AuditState,
  ChangesOverviewItem,
  ChangesState,
  FixProposal,
  DiscoveryPreview,
  ExternalApp,
  KillRequest,
  KillResult,
  LogSnapshot,
  PortSnapshot,
  RunInfo,
  RunOutputEvent,
  RunScriptRequest,
  ScriptDef,
  Workspace
} from './types'

export type Unsubscribe = () => void

/**
 * The full surface exposed to the renderer as `window.cairix`. The preload
 * script implements it; nothing else crosses the bridge. Methods that accept
 * paths or ids are re-validated in main, never trusted.
 */
export interface CairixAPI {
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    showInFolder(path: string): Promise<void>
    openInApp(app: ExternalApp, path: string): Promise<void>
    onOpenPalette(cb: () => void): Unsubscribe
    /** A notification was clicked: go to what it was about. */
    onNavigate(cb: (target: NavigateTarget) => void): Unsubscribe
    /** Shows a sample notification so the user can check macOS allows them. Resolves to whether it was shown. */
    testNotification(): Promise<boolean>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: SettingsPatch): Promise<Settings>
    onChange(cb: (settings: Settings) => void): Unsubscribe
  }
  projects: {
    list(): Promise<Workspace[]>
    pickFolder(): Promise<string | null>
    preview(path: string): Promise<DiscoveryPreview>
    add(req: AddWorkspaceRequest): Promise<Workspace>
    remove(workspaceId: string): Promise<void>
    rescan(workspaceId: string): Promise<Workspace>
    setTrust(workspaceId: string, trusted: boolean): Promise<Workspace>
    onChange(cb: (workspaces: Workspace[]) => void): Unsubscribe
  }
  scripts: {
    list(projectId: string): Promise<ScriptDef[]>
    run(req: RunScriptRequest): Promise<RunInfo>
    stop(runId: string, force?: boolean): Promise<void>
    /** For interactive scripts: runs the script in Terminal.app instead of the log view. */
    openInTerminal(req: RunScriptRequest): Promise<void>
    runs(): Promise<RunInfo[]>
    log(runId: string): Promise<LogSnapshot>
    onRunEvent(cb: (run: RunInfo) => void): Unsubscribe
    onOutput(cb: (e: RunOutputEvent) => void): Unsubscribe
    /** Saved arguments, environment and watch setting per script id. */
    /** Ports the script is about to use that something already holds. Empty means clear to run. */
    checkPorts(scriptId: string, args?: string[]): Promise<PortConflict[]>
    /** Opens a file mentioned in a run's output (a stack trace) at its line in an editor. Main checks it is inside the project. */
    openFile(runId: string, file: string, line?: number, column?: number): Promise<void>
    configs(): Promise<Record<string, ScriptConfig>>
    setConfig(scriptId: string, config: ScriptConfig | null): Promise<Record<string, ScriptConfig>>
    onConfigsChange(cb: (configs: Record<string, ScriptConfig>) => void): Unsubscribe
  }
  ports: {
    scan(): Promise<PortSnapshot>
    kill(req: KillRequest): Promise<KillResult>
    /** Tell main whether the UI is visible so it can poll fast (2 s) or slow (10 s). */
    watch(visible: boolean): Promise<void>
    onChange(cb: (snapshot: PortSnapshot) => void): Unsubscribe
  }
  changes: {
    /** Cheap: git status + instant checks. Safe to poll. */
    get(projectId: string): Promise<ChangesState>
    /** Adds the AI pass (uses the user's local Claude CLI). */
    review(projectId: string): Promise<ChangesState>
    /** Projects with uncommitted work, across all trusted folders. */
    overview(): Promise<ChangesOverviewItem[]>
    dismiss(projectId: string, findingId: string): Promise<ChangesState>
    /** Prepares a fix in a throwaway copy and returns the diff. Nothing is changed yet. */
    fix(projectId: string, findingId: string): Promise<FixProposal>
    apply(proposalId: string): Promise<FixProposal>
    undo(proposalId: string): Promise<FixProposal>
  }
  audit: {
    plan(projectId: string, opts: AuditOptions): Promise<AuditPlan>
    start(projectId: string, opts: AuditOptions): Promise<AuditState>
    status(projectId: string): Promise<AuditState>
    cancel(projectId: string): Promise<AuditState>
    /** Prepares a fix (same preview/apply/undo flow as Changes: use changes.apply / changes.undo). */
    fix(projectId: string, findingId: string): Promise<FixProposal>
    dismiss(projectId: string, findingId: string): Promise<AuditState>
  }
  actions: {
    list(): Promise<CustomAction[]>
    /** Validates (variables allowed for the scope, quoting) and stores. Throws a readable message if invalid. */
    save(draft: ActionDraft): Promise<CustomAction>
    delete(id: string): Promise<void>
    preview(id: string, ctx: ActionContext): Promise<ActionPreview>
    run(id: string, ctx: ActionContext): Promise<ActionResult>
    onChange(cb: (actions: CustomAction[]) => void): Unsubscribe
  }
  tasks: {
    /** Which agent CLIs are installed. */
    capabilities(): Promise<TaskCapabilities>
    list(projectId: string): Promise<AgentTask[]>
    start(projectId: string, req: StartTaskRequest): Promise<AgentTask>
    cancel(taskId: string): Promise<AgentTask>
    /** For a finished edit-mode task: turns its result into a diff you can apply with changes.apply / changes.undo. */
    propose(taskId: string): Promise<FixProposal>
    remove(taskId: string): Promise<void>
  }
  plugins: {
    list(): Promise<PluginsListResult>
    /** Asks for a plugin folder, validates and copies it in. Returns null if cancelled. Not enabled until the user approves. */
    install(): Promise<PluginInfo | null>
    /** Enabling is where the user approves the plugin's permissions. */
    setEnabled(id: string, enabled: boolean): Promise<PluginInfo>
    uninstall(id: string): Promise<void>
    render(id: string, kind: ContributionKind, contribId: string, ctx: RenderContext): Promise<UiNode>
    action(id: string, kind: ContributionKind, contribId: string, action: string, payload: string | undefined, ctx: RenderContext): Promise<UiNode>
    runCommand(id: string, commandId: string): Promise<void>
    onChange(cb: () => void): Unsubscribe
    onNotify(cb: (n: PluginNotification) => void): Unsubscribe
  }
  agents: {
    /** Live, read-only view of local Claude Code and Cursor agents. */
    snapshot(): Promise<AgentsSnapshot>
  }
  processes: {
    scan(filter: 'dev' | 'all'): Promise<ProcessSnapshot>
    /** Stops a background process and everything it launched. Main re-derives the target from a fresh scan. */
    stop(req: StopProcessRequest): Promise<KillResult>
    /** Tell main whether the UI is visible so it only polls while someone is looking. */
    watch(visible: boolean, filter: 'dev' | 'all'): Promise<void>
    onChange(cb: (snapshot: ProcessSnapshot) => void): Unsubscribe
  }
  history: {
    list(): Promise<HistorySnapshot>
    /** Runs a remembered command again. The UI sends an id, never command text. */
    rerun(req: HistoryRerunRequest): Promise<HistoryRerunResult>
    /** Stops tracking, and forgets, one command or every command of a program. */
    ignore(rule: HistoryRule): Promise<HistorySnapshot>
    unignore(rule: HistoryRule): Promise<HistorySnapshot>
    /** Adds Cairix's hook line to ~/.zshrc so commands carry the folder they ran in. Idempotent. */
    installHook(): Promise<HistorySnapshot>
    removeHook(): Promise<HistorySnapshot>
    onChange(cb: (snapshot: HistorySnapshot) => void): Unsubscribe
  }
  runs: {
    /** Finished runs, newest first. Persisted across restarts. */
    list(): Promise<RunRecord[]>
    /** The last part of a run's output, with secrets masked. */
    tail(runId: string): Promise<string>
    clear(): Promise<void>
    onChange(cb: (records: RunRecord[]) => void): Unsubscribe
  }
  env: {
    /** Keys and metadata only. Values never come with the list. */
    list(projectId: string): Promise<EnvSnapshot>
    /** One value, on request (the user clicked the eye). */
    reveal(projectId: string, file: string, key: string): Promise<string>
    set(projectId: string, file: string, key: string, value: string): Promise<EnvSnapshot>
    remove(projectId: string, file: string, key: string): Promise<EnvSnapshot>
    /** Creates `.env` (or another local file) from a template. */
    create(projectId: string, file: string, template: string): Promise<EnvSnapshot>
    /** Appends the template's missing keys, empty, to a local file. */
    addMissing(projectId: string, file: string): Promise<EnvSnapshot>
  }
  git: {
    state(projectId: string): Promise<GitState>
    checkout(projectId: string, branch: string): Promise<GitState>
    createBranch(projectId: string, name: string): Promise<GitState>
    stash(projectId: string, op: GitStashOp, arg?: string): Promise<GitState>
    /** `all` stages every tracked change first (like commit -a). Nothing is committed with an empty message. */
    commit(projectId: string, message: string, all: boolean): Promise<GitState>
    /** Pushes the current branch only; never forces. Sets the upstream the first time. */
    push(projectId: string): Promise<GitState>
    /** Fast-forward only, so it can never create a surprise merge. */
    pull(projectId: string): Promise<GitState>
    fetch(projectId: string): Promise<GitState>
    /** The pull request for the current branch and its checks, when the GitHub CLI is available. */
    pr(projectId: string): Promise<GitPrResult>
  }
  containers: {
    list(): Promise<ContainersSnapshot>
    /** Main re-checks the id against the container list before acting. */
    action(id: string, action: ContainerAction): Promise<ContainersSnapshot>
    logs(id: string, tail?: number): Promise<string>
  }
  health: {
    /** Tool versions against what the project asks for, and the folders using the most disk. */
    scan(projectId: string): Promise<HealthSnapshot>
    /** Outdated and vulnerable dependencies. Uses the network, so only on request. */
    deps(projectId: string): Promise<DepsReport>
    /** Deletes one regenerable folder (node_modules, .next, ...) that git does not track. */
    clean(projectId: string, folder: string): Promise<HealthSnapshot>
  }
  schedules: {
    list(): Promise<Schedule[]>
    save(draft: ScheduleDraft): Promise<Schedule>
    delete(id: string): Promise<void>
    runNow(id: string): Promise<Schedule>
    onChange(cb: (schedules: Schedule[]) => void): Unsubscribe
  }
  learn: {
    list(): Promise<LearnSnapshot>
    /** Writes a lesson with the user's Claude CLI. Returns today's existing one unless `another` is set. */
    generate(req: GenerateLessonRequest): Promise<Lesson>
    mark(id: string, learned: boolean): Promise<Lesson>
    delete(id: string): Promise<void>
    onChange(cb: (snapshot: LearnSnapshot) => void): Unsubscribe
  }
}
