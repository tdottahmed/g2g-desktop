const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Config
    configGet:  ()     => ipcRenderer.invoke('config:get'),
    configSet:  (data) => ipcRenderer.invoke('config:set', data),
    configTest: ()     => ipcRenderer.invoke('config:test'),

    // App info
    appVersion: () => ipcRenderer.invoke('app:version'),

    // Runner (post offers)
    runnerStart:  (mode) => ipcRenderer.invoke('runner:start', mode),
    runnerStop:   ()     => ipcRenderer.invoke('runner:stop'),
    runnerStatus: ()     => ipcRenderer.invoke('runner:status'),

    // Deleter: delete all offers for an account (skips permanent on g2g)
    deleterStart:            (email)           => ipcRenderer.invoke('deleter:start', email),
    // Deleter: delete only non-permanent offers (fetches list from API)
    deleterStartNonPermanent: (userId, email)  => ipcRenderer.invoke('deleter:start-non-permanent', { userId, email }),
    accountsFetch:           ()               => ipcRenderer.invoke('accounts:fetch'),

    // Auto-update
    updateCheck:       ()  => ipcRenderer.invoke('update:check'),
    updateDownload:    ()  => ipcRenderer.invoke('update:download'),
    updateInstall:     ()  => ipcRenderer.invoke('update:install'),
    updateOpenRelease: ()  => ipcRenderer.invoke('update:open-releases'),

    // Streaming events from main process
    onLog:            (cb) => ipcRenderer.on('log',           (_e, line)     => cb(line)),
    onStatusChange:   (cb) => ipcRenderer.on('status-change', (_e, status)   => cb(status)),
    onRunComplete:    (cb) => ipcRenderer.on('run:complete',  (_e, stats)    => cb(stats)),
    onUpdateStatus:   (cb) => ipcRenderer.on('update:status', (_e, payload)  => cb(payload)),
    onUpdateProgress: (cb) => ipcRenderer.on('update:progress',(_e, payload) => cb(payload)),
    removeListeners:  (channel) => ipcRenderer.removeAllListeners(channel),

    // Navigation
    navigate: (page) => ipcRenderer.invoke('navigate', page),

    // Setup (first-run browser installation)
    setupCheck:   () => ipcRenderer.invoke('setup:check'),
    setupInstall: () => ipcRenderer.invoke('setup:install'),
    onSetupLog:   (cb) => ipcRenderer.on('setup:log', (_e, line) => cb(line)),
});
