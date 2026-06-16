const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Config
    configGet: () => ipcRenderer.invoke('config:get'),
    configSet: (data) => ipcRenderer.invoke('config:set', data),
    configTest: () => ipcRenderer.invoke('config:test'),

    // Runner (post offers)
    runnerStart: (mode) => ipcRenderer.invoke('runner:start', mode),
    runnerStop: () => ipcRenderer.invoke('runner:stop'),
    runnerStatus: () => ipcRenderer.invoke('runner:status'),

    // Deleter (delete-all)
    deleterStart: (mode) => ipcRenderer.invoke('deleter:start', mode),

    // Streaming events from main process
    onLog: (callback) => ipcRenderer.on('log', (_e, line) => callback(line)),
    onStatusChange: (callback) => ipcRenderer.on('status-change', (_e, status) => callback(status)),
    removeListeners: (channel) => ipcRenderer.removeAllListeners(channel),

    // Navigation
    navigate: (page) => ipcRenderer.invoke('navigate', page),
});
