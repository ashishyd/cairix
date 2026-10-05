import type { NotificationSettings } from '@shared/settings-types'
import type { AgentTask, AuditState, NavigateTarget, RunInfo } from '@shared/types'
import { auditNotice, crashLoopNotice, runNotice, taskNotice, watchLoopNotice, type Notice } from './rules'

export interface NotifierDeps {
  settings(): NotificationSettings
  /** True while one of Cairix's windows has focus. */
  appFocused(): boolean
  /** Shows the notification. Returns false when the OS can't. `onClick` fires when the user clicks it. */
  show(n: { title: string; body: string }, onClick: () => void): boolean
  navigate(target: NavigateTarget): void
  projectExists(id: string): boolean
  projectName(id: string): string
}

/** Decides whether a finished job should raise a macOS notification, and where a click goes. */
export class Notifier {
  constructor(private readonly deps: NotifierDeps) {}

  run(info: RunInfo): void {
    this.send(runNotice(info, this.deps.projectExists))
  }
  crashLoop(info: RunInfo, attempts: number): void {
    this.send(crashLoopNotice(info, attempts, this.deps.projectExists))
  }
  watchLoop(info: RunInfo): void {
    this.send(watchLoopNotice(info, this.deps.projectExists))
  }
  task(task: AgentTask): void {
    this.send(taskNotice(task))
  }
  audit(state: AuditState): void {
    this.send(auditNotice(state, this.deps.projectName(state.projectId)))
  }

  /** Always shows (so the user can check macOS permission), whatever the settings say. */
  test(): boolean {
    return this.deps.show({ title: 'Cairix notifications are on', body: 'You will see this when a script fails, or an agent task or audit finishes.' }, () => this.deps.navigate({ kind: 'machine', page: 'runs' }))
  }

  private send(notice: Notice | null): void {
    if (!notice) return
    const s = this.deps.settings()
    if (!s.enabled || !s[notice.kind]) return
    if (s.onlyInBackground && this.deps.appFocused()) return
    this.deps.show({ title: notice.title, body: notice.body }, () => this.deps.navigate(notice.target))
  }
}
