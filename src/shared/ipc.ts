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
  scriptsCheckPorts: 'scripts:checkPorts',
  scriptsOpenFile: 'scripts:openFile',
  scriptsConfigs: 'scripts:configs',
  scriptsSetConfig: 'scripts:setConfig',
  scriptsConfigsChanged: 'scripts:configsChanged',
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

  runsList: 'runs:list',
  runsTail: 'runs:tail',
  runsClear: 'runs:clear',
  runsChanged: 'runs:changed',

  notifyTest: 'notify:test',
  uiNavigate: 'ui:navigate',

  historyList: 'history:list',
  historyRerun: 'history:rerun',
  historyIgnore: 'history:ignore',
  historyUnignore: 'history:unignore',
  historyChanged: 'history:changed',
  historyHookInstall: 'history:hookInstall',
  historyHookRemove: 'history:hookRemove',

  gitState: 'git:state',
  gitCheckout: 'git:checkout',
  gitCreateBranch: 'git:createBranch',
  gitStash: 'git:stash',
  gitCommit: 'git:commit',
  gitPush: 'git:push',
  gitPull: 'git:pull',
  gitFetch: 'git:fetch',
  gitPr: 'git:pr',

  containersList: 'containers:list',
  containersAction: 'containers:action',
  containersLogs: 'containers:logs',

  healthScan: 'health:scan',
  healthDeps: 'health:deps',
  healthClean: 'health:clean',

  schedulesList: 'schedules:list',
  schedulesSave: 'schedules:save',
  schedulesDelete: 'schedules:delete',
  schedulesRunNow: 'schedules:runNow',
  schedulesChanged: 'schedules:changed',

  learnList: 'learn:list',
  learnGenerate: 'learn:generate',
  learnMark: 'learn:mark',
  learnDelete: 'learn:delete',
  learnChanged: 'learn:changed',

  envList: 'env:list',
  envReveal: 'env:reveal',
  envSet: 'env:set',
  envRemove: 'env:remove',
  envCreate: 'env:create',
  envAddMissing: 'env:addMissing',

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
