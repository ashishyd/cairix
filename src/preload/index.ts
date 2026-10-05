import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { CairixAPI, Unsubscribe } from '@shared/api'

// The preload runs in a sandbox: it may import 'electron' and our own bundled
// constants, nothing else. No zod, no node built-ins. Validation lives in main.

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: CairixAPI = {
  app: {
    info: call(IPC.appInfo),
    openExternal: call(IPC.appOpenExternal),
    showInFolder: call(IPC.appShowInFolder),
    openInApp: call(IPC.appOpenInApp),
    onOpenPalette: (cb) => on<void>(IPC.uiOpenPalette, () => cb())
  },
  settings: {
    get: call(IPC.settingsGet),
    set: call(IPC.settingsSet),
    onChange: (cb) => on(IPC.settingsChanged, cb)
  },
  projects: {
    list: call(IPC.projectsList),
    pickFolder: call(IPC.projectsPickFolder),
    preview: call(IPC.projectsPreview),
    add: call(IPC.projectsAdd),
    remove: call(IPC.projectsRemove),
    rescan: call(IPC.projectsRescan),
    setTrust: call(IPC.projectsSetTrust),
    onChange: (cb) => on(IPC.projectsChanged, cb)
  },
  scripts: {
    list: call(IPC.scriptsList),
    run: call(IPC.scriptsRun),
    stop: call(IPC.scriptsStop),
    openInTerminal: call(IPC.scriptsOpenInTerminal),
    runs: call(IPC.scriptsRuns),
    log: call(IPC.scriptsLog),
    onRunEvent: (cb) => on(IPC.scriptsRunEvent, cb),
    onOutput: (cb) => on(IPC.scriptsOutput, cb)
  },
  ports: {
    scan: call(IPC.portsScan),
    kill: call(IPC.portsKill),
    watch: call(IPC.portsWatch),
    onChange: (cb) => on(IPC.portsChanged, cb)
  },
  changes: {
    get: call(IPC.changesGet),
    review: call(IPC.changesReview),
    overview: call(IPC.changesOverview),
    dismiss: call(IPC.changesDismiss),
    fix: call(IPC.changesFix),
    apply: call(IPC.changesApply),
    undo: call(IPC.changesUndo)
  },
  audit: {
    plan: call(IPC.auditPlan),
    start: call(IPC.auditStart),
    status: call(IPC.auditStatus),
    cancel: call(IPC.auditCancel),
    fix: call(IPC.auditFix),
    dismiss: call(IPC.auditDismiss)
  },
  actions: {
    list: call(IPC.actionsList),
    save: call(IPC.actionsSave),
    delete: call(IPC.actionsDelete),
    preview: call(IPC.actionsPreview),
    run: call(IPC.actionsRun),
    onChange: (cb) => on(IPC.actionsChanged, cb)
  },
  tasks: {
    capabilities: call(IPC.tasksCapabilities),
    list: call(IPC.tasksList),
    start: call(IPC.tasksStart),
    cancel: call(IPC.tasksCancel),
    propose: call(IPC.tasksPropose),
    remove: call(IPC.tasksRemove)
  },
  plugins: {
    list: call(IPC.pluginsList),
    install: call(IPC.pluginsInstall),
    setEnabled: call(IPC.pluginsSetEnabled),
    uninstall: call(IPC.pluginsUninstall),
    render: call(IPC.pluginsRender),
    action: call(IPC.pluginsAction),
    runCommand: call(IPC.pluginsCommand),
    onChange: (cb) => on<void>(IPC.pluginsChanged, () => cb()),
    onNotify: (cb) => on(IPC.pluginsNotify, cb)
  },
  agents: {
    snapshot: call(IPC.agentsSnapshot)
  },
  processes: {
    scan: call(IPC.processesScan),
    stop: call(IPC.processesStop),
    watch: call(IPC.processesWatch),
    onChange: (cb) => on(IPC.processesChanged, cb)
  },
  history: {
    list: call(IPC.historyList),
    rerun: call(IPC.historyRerun),
    ignore: call(IPC.historyIgnore),
    unignore: call(IPC.historyUnignore),
    onChange: (cb) => on(IPC.historyChanged, cb)
  }
}

contextBridge.exposeInMainWorld('cairix', api)
