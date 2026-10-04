import type { ContributionKind, PluginInfo, PluginNotification, PluginsListResult, RenderContext, UiNode } from './plugins'
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
}
