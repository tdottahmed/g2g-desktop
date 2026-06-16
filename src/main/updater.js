const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

// ── Config ────────────────────────────────────────────────────────────────────

autoUpdater.autoDownload         = false; // user must confirm
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease      = false;

// ── State ─────────────────────────────────────────────────────────────────────

let getWindow     = null;
let lastCheckTime = 0;
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // once per day

function send(channel, data) {
    const win = getWindow && getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// ── Updater events ────────────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
    send('update:status', { state: 'checking' });
});

autoUpdater.on('update-available', (info) => {
    send('update:status', { state: 'available', version: info.version, releaseNotes: info.releaseNotes });
});

autoUpdater.on('update-not-available', () => {
    send('update:status', { state: 'not-available', version: app.getVersion() });
});

autoUpdater.on('download-progress', ({ percent, transferred, total }) => {
    send('update:progress', { percent: Math.round(percent), transferred, total });
});

autoUpdater.on('update-downloaded', (info) => {
    send('update:status', { state: 'downloaded', version: info.version });
});

autoUpdater.on('error', (err) => {
    // Suppress "no published version" errors in dev or when publish isn't configured
    const msg = err.message || '';
    if (msg.includes('ENOTFOUND') || msg.includes('No published versions')) return;
    send('update:status', { state: 'error', error: msg });
});

// ── Public API ────────────────────────────────────────────────────────────────

function setGetWindow(fn) { getWindow = fn; }

function checkForUpdates(force = false) {
    if (!app.isPackaged && !force) return; // skip in dev unless forced

    const now = Date.now();
    if (!force && now - lastCheckTime < CHECK_INTERVAL) return;
    lastCheckTime = now;

    autoUpdater.checkForUpdates().catch(() => {});
}

function downloadUpdate() {
    autoUpdater.downloadUpdate().catch(() => {});
}

function installUpdate() {
    autoUpdater.quitAndInstall(false, true);
}

module.exports = { setGetWindow, checkForUpdates, downloadUpdate, installUpdate };
