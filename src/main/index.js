const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./ipc-handlers');
const configStore = require('./config-store');
const trayManager = require('./tray');
const setup       = require('./setup');

// ── Single-instance lock ──────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // A second instance was launched — focus the existing window instead
        trayManager.showWindow();
    });
}

// ── Window ────────────────────────────────────────────────────────────────────

let mainWindow = null;

function getStartPage() {
    // In packaged mode: browser must be installed before anything else
    if (app.isPackaged && !setup.isBrowserInstalled()) return 'setup.html';
    // First run: send to settings
    if (!configStore.isConfigured()) return 'settings.html';
    return 'dashboard.html';
}

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
        backgroundColor: '#0a0d14',
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer', getStartPage()));

    mainWindow.once('ready-to-show', () => mainWindow.show());

    // Close → hide to tray (unless app.isQuitting is set by tray Quit action)
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
    registerIpcHandlers(() => mainWindow);
    createWindow();
    trayManager.createTray(() => mainWindow);
});

// Prevent the app from quitting when all windows are closed (we live in the tray)
app.on('window-all-closed', () => {
    // intentionally blank — quit only via tray menu
});

app.on('before-quit', () => {
    app.isQuitting = true;
});

app.on('activate', () => {
    // macOS: re-create window on dock icon click if none exists
    if (!mainWindow) createWindow();
});
