const { Tray, Menu, nativeImage, app, shell } = require('electron');
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

let tray         = null;
let getWindow    = null;
let curStatus    = 'idle';
let updateState  = null; // null | 'checking' | 'available' | 'downloaded'
let updateVersion = '';

// ── Context menu builder ──────────────────────────────────────────────────────

function buildMenu() {
    const isRunning  = curStatus === 'running' || curStatus === 'watching';
    const isWatching = curStatus === 'watching';

    // Update menu item label and behaviour depends on current update state
    let updateItem;
    if (updateState === 'checking') {
        updateItem = { label: '🔄  Checking for updates…', enabled: false };
    } else if (updateState === 'available' || updateState === 'downloaded') {
        const label = updateState === 'downloaded'
            ? `⬇️  Install update ${updateVersion} (restart required)`
            : `🆕  Update ${updateVersion} available — click to download`;
        updateItem = {
            label,
            click: () => {
                if (updateState === 'downloaded') {
                    require('./updater').installUpdate();
                } else {
                    // Open GitHub releases page in default browser
                    const cfg = require('./config-store').getAll();
                    const owner = 'GITHUB_OWNER'; // replace with real owner if known
                    shell.openExternal(`https://github.com/${owner}/g2g-automation-desktop/releases/latest`);
                }
            },
        };
    } else {
        updateItem = {
            label: '🔄  Check for Updates',
            click: () => require('./updater').checkForUpdates(true),
        };
    }

    return Menu.buildFromTemplate([
        { label: `G2G Automation  v${app.getVersion()}`, enabled: false },
        { type: 'separator' },

        { label: 'Open Dashboard', click: showWindow },

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

        updateItem,

        { type: 'separator' },

        {
            label: 'Quit',
            click: () => { app.isQuitting = true; app.quit(); },
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

function setUpdateState(state, version = '') {
    updateState   = state;
    updateVersion = version;
    if (tray) tray.setContextMenu(buildMenu());
}

function statusLabel(s) {
    return { idle: 'Idle', running: 'Running…', watching: 'Watching', error: 'Error' }[s] ?? s;
}

function createTray(getWindowFn) {
    getWindow = getWindowFn;

    tray = new Tray(ICONS.idle);
    tray.setToolTip('G2G Automation — Idle');
    tray.setContextMenu(buildMenu());

    tray.on('click', showWindow);
    tray.on('double-click', showWindow);

    return tray;
}

function destroyTray() {
    if (tray) { tray.destroy(); tray = null; }
}

module.exports = { createTray, destroyTray, setStatus, setUpdateState, showWindow };
