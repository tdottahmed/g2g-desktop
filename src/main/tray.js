const { Tray, Menu, nativeImage, app } = require('electron');
const { STATUS_ICONS } = require('./icon-generator');
const runnerManager = require('./runner-manager');

// ── Pre-build nativeImage icons from PNG buffers ──────────────────────────────

const ICONS = {};
for (const [key, buf] of Object.entries(STATUS_ICONS)) {
    const img = nativeImage.createFromBuffer(buf);
    img.setTemplateImage(false);
    ICONS[key] = img;
}

// ── State ─────────────────────────────────────────────────────────────────────

let tray        = null;
let getWindow   = null;
let curStatus   = 'idle';

// ── Context menu builder ──────────────────────────────────────────────────────

function buildMenu() {
    const isRunning  = curStatus === 'running' || curStatus === 'watching';
    const isWatching = curStatus === 'watching';

    return Menu.buildFromTemplate([
        { label: 'G2G Automation', enabled: false },
        { type: 'separator' },

        {
            label: 'Open Dashboard',
            click: showWindow,
        },

        { type: 'separator' },

        {
            label: '▶  Run Once',
            enabled: !isRunning,
            click: () => {
                const cfg = require('./config-store').getAll();
                runnerManager.start('runner.js', [], cfg);
                showWindow();
            },
        },
        {
            label: isWatching ? '⏹  Stop Watch' : '👁  Start Watch',
            click: () => {
                if (isWatching) {
                    runnerManager.stop();
                } else {
                    const cfg = require('./config-store').getAll();
                    runnerManager.start('runner.js', ['--watch'], cfg);
                    showWindow();
                }
            },
        },
        {
            label: '⏹  Stop',
            enabled: isRunning,
            click: () => runnerManager.stop(),
        },

        { type: 'separator' },

        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            },
        },
    ]);
}

// ── Public API ────────────────────────────────────────────────────────────────

function showWindow() {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function setStatus(status) {
    curStatus = status;
    if (!tray) return;
    tray.setImage(ICONS[status] ?? ICONS.idle);
    tray.setToolTip(`G2G Automation — ${statusLabel(status)}`);
    tray.setContextMenu(buildMenu());
}

function statusLabel(s) {
    return { idle: 'Idle', running: 'Running…', watching: 'Watching', error: 'Error' }[s] ?? s;
}

function createTray(getWindowFn) {
    getWindow = getWindowFn;

    tray = new Tray(ICONS.idle);
    tray.setToolTip('G2G Automation — Idle');
    tray.setContextMenu(buildMenu());

    // Left-click on tray icon → show / toggle window
    tray.on('click', showWindow);

    // Double-click on Windows also shows window
    tray.on('double-click', showWindow);

    return tray;
}

function destroyTray() {
    if (tray) { tray.destroy(); tray = null; }
}

module.exports = { createTray, destroyTray, setStatus, showWindow };
