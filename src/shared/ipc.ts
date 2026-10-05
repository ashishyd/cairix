/**
 * Every IPC channel in one place. The preload bridge and the main-process
 * handlers both import from here, so a typo is a compile error rather than a
 * silently dead button. Names are `<module>:<verb>`; events pushed from main
 * to the renderer end in `:changed` / `:event` / `:output`.
 */
export const IPC = {
  appInfo: 'app:info',
  appOpenExternal: 'app:openExternal',
  appShowInFolder: 'app:showInFolder',
  appOpenInApp: 'app:openInApp',
  uiOpenPalette: 'ui:openPalette',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',

  projectsList: 'projects:list',
  projectsPreview: 'projects:preview',
  projectsAdd: 'projects:add',
  projectsRemove: 'projects:remove',
  projectsRescan: 'projects:rescan',
  projectsSetTrust: 'projects:setTrust',
  projectsPickFolder: 'projects:pickFolder',
  projectsChanged: 'projects:changed',

  scriptsList: 'scripts:list',
  scriptsRun: 'scripts:run',
  scriptsStop: 'scripts:stop',
  scriptsOpenInTerminal: 'scripts:openInTerminal',
  scriptsRuns: 'scripts:runs',
  scriptsLog: 'scripts:log',
  scriptsRunEvent: 'scripts:runEvent',
  scriptsOutput: 'scripts:output',

  portsScan: 'ports:scan',
  portsKill: 'ports:kill',
  portsKillPort: 'ports:killPort',
  portsChanged: 'ports:changed',
  portsWatch: 'ports:watch',

  agentsSnapshot: 'agents:snapshot',

  processesScan: 'processes:scan',
  processesStop: 'processes:stop',
  processesWatch: 'processes:watch',
  processesChanged: 'processes:changed',

  historyList: 'history:list',
  historyRerun: 'history:rerun',
  historyIgnore: 'history:ignore',
  historyUnignore: 'history:unignore',
  historyChanged: 'history:changed',

  changesGet: 'changes:get',
  changesReview: 'changes:review',
  changesDismiss: 'changes:dismiss',
  changesFix: 'changes:fix',
  changesApply: 'changes:apply',
  changesUndo: 'changes:undo',
  changesOverview: 'changes:overview',

  auditPlan: 'audit:plan',
  auditStart: 'audit:start',
  auditStatus: 'audit:status',
  auditCancel: 'audit:cancel',
  auditFix: 'audit:fix',
  auditDismiss: 'audit:dismiss',

  actionsList: 'actions:list',
  actionsSave: 'actions:save',
  actionsDelete: 'actions:delete',
  actionsPreview: 'actions:preview',
  actionsRun: 'actions:run',
  actionsChanged: 'actions:changed',

  tasksList: 'tasks:list',
  tasksStart: 'tasks:start',
  tasksCancel: 'tasks:cancel',
  tasksPropose: 'tasks:propose',
  tasksRemove: 'tasks:remove',
  tasksCapabilities: 'tasks:capabilities',

  pluginsList: 'plugins:list',
  pluginsInstall: 'plugins:install',
  pluginsSetEnabled: 'plugins:setEnabled',
  pluginsUninstall: 'plugins:uninstall',
  pluginsRender: 'plugins:render',
  pluginsAction: 'plugins:action',
  pluginsCommand: 'plugins:command',
  pluginsChanged: 'plugins:changed',
  pluginsNotify: 'plugins:notify',

  /** Used only between a plugin's sandboxed window and main. */
  pluginRpc: 'plugin:rpc',
  pluginReply: 'plugin:reply',
  pluginInvoke: 'plugin:invoke'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
