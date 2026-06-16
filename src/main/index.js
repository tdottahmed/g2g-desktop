const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const configStore = require('./config-store');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 960,
        height: 720,
        minWidth: 720,
        minHeight: 560,
        webPreferences: {
            preload: path.join(__dirname, '../renderer/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        title: 'G2G Automation',
        show: false,
        backgroundColor: '#0f1117',
    });

    const startPage = configStore.isConfigured() ? 'dashboard.html' : 'settings.html';
    mainWindow.loadFile(path.join(__dirname, '../renderer', startPage));

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
    registerIpcHandlers(() => mainWindow);
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (!mainWindow) createWindow();
});
