const { ipcMain, app, shell } = require('electron');
const configStore   = require('./config-store');
const runnerManager = require('./runner-manager');
const tray          = require('./tray');
const notify        = require('./notifications');
const setup         = require('./setup');
const updater       = require('./updater');

// ── Log-parsing state (per run cycle) ────────────────────────────────────────

let runSuccess = 0;
let runFailed  = 0;

function parseLogLine(line, getWindow) {
    // Start of a fetch cycle → reset counters
    if (line.includes('Fetching pending templates')) {
        runSuccess = 0;
        runFailed  = 0;
        return;
    }

    // Individual template outcomes
    if (line.includes('Reported success for template')) { runSuccess++; return; }
    if (/Template \d+ failed:/i.test(line))             { runFailed++;  return; }

    // Run finished → fire summary notification + send stats to renderer
    if (line.includes('Run complete')) {
        notify.notifyRunComplete(runSuccess, runFailed);
        const win = getWindow();
        if (win && !win.isDestroyed()) {
            win.webContents.send('run:complete', { success: runSuccess, failed: runFailed });
        }
        return;
    }

    // Auth failure
    const authMatch = line.match(/Authentication failed for (\S+)/);
    if (authMatch) { notify.notifyAuthFailed(authMatch[1].replace(/\.$/, '')); return; }

    // API unreachable
    if (line.includes('Failed to fetch pending templates:')) {
        const detail = line.replace(/.*Failed to fetch pending templates:\s*/i, '').trim();
        notify.notifyApiError(detail || 'Could not reach the API');
        return;
    }

    // Playwright / Chromium not installed
    if (line.includes('Playwright browser not installed') || line.includes("Executable doesn't exist")) {
        notify.notifyPlaywrightMissing();
    }
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

function registerIpcHandlers(getWindow) {
    // ── App info ──────────────────────────────────────────────────────────────

    ipcMain.handle('app:version', () => app.getVersion());

    // ── Config ────────────────────────────────────────────────────────────────

    ipcMain.handle('config:get', () => configStore.getAll());

    ipcMain.handle('config:set', (_e, data) => {
        configStore.setAll({ ...data, configured: true });

        if (data.startWithWindows !== undefined) {
            app.setLoginItemSettings({
                openAtLogin: Boolean(data.startWithWindows),
                name: 'G2G Automation',
            });
        }

        return { success: true };
    });

    ipcMain.handle('config:test', async () => {
        const cfg = configStore.getAll();
        if (!cfg.LARAVEL_API_URL || !cfg.API_KEY) {
            return { success: false, error: 'API URL and API Key are required.' };
        }
        try {
            const url = `${cfg.LARAVEL_API_URL.replace(/\/$/, '')}/api/automation/heartbeat`;
            const res = await fetch(url, {
                headers: { 'X-Api-Key': cfg.API_KEY, Accept: 'application/json' },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            return { success: true, data: body };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Runner: post offers ───────────────────────────────────────────────────

    ipcMain.handle('runner:start', (_e, mode = 'run') => {
        const cfg  = configStore.getAll();
        const args = mode === 'watch' ? ['--watch'] : mode === 'status' ? ['--status'] : [];
        const ok   = runnerManager.start('runner.js', args, cfg);
        return { success: ok };
    });

    ipcMain.handle('runner:stop', () => {
        const ok = runnerManager.stop();
        return { success: ok };
    });

    ipcMain.handle('runner:status', () => runnerManager.getStatus());

    // ── Runner: delete ALL offers for a specific account (skips permanent) ──────

    ipcMain.handle('deleter:start', (_e, email) => {
        if (!email) return { success: false, error: 'No account selected.' };
        const cfg = configStore.getAll();
        const ok  = runnerManager.start('delete-offers.js', [email], cfg);
        return { success: ok };
    });

    // ── Runner: delete non-permanent offers via API list ─────────────────────

    ipcMain.handle('deleter:start-non-permanent', (_e, { userId, email }) => {
        if (!userId || !email) return { success: false, error: 'userId and email are required.' };
        const cfg  = configStore.getAll();
        const args = ['--api', `--user-id=${userId}`, email];
        const ok   = runnerManager.start('delete-specific-offers.js', args, cfg);
        return { success: ok };
    });

    // ── Fetch all user accounts from the Laravel API ──────────────────────────

    ipcMain.handle('accounts:fetch', async () => {
        const cfg = configStore.getAll();
        if (!cfg.LARAVEL_API_URL || !cfg.API_KEY) {
            return { success: false, error: 'API not configured.' };
        }
        try {
            const url = `${cfg.LARAVEL_API_URL.replace(/\/$/, '')}/api/automation/user-accounts`;
            const res = await fetch(url, {
                headers: { 'X-Api-Key': cfg.API_KEY, Accept: 'application/json' },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            return { success: true, accounts: body.accounts ?? [] };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ── Setup: browser installation ───────────────────────────────────────────

    ipcMain.handle('setup:check', () => ({
        installed:   setup.isBrowserInstalled(),
        browsersDir: setup.getBrowsersDir(),
    }));

    ipcMain.handle('setup:install', (event) =>
        new Promise((resolve) => {
            setup.installBrowser(
                (line) => event.sender.send('setup:log', line),
                (success) => resolve({ success })
            );
        })
    );

    // ── Auto-update ───────────────────────────────────────────────────────────

    ipcMain.handle('update:check', () => updater.checkForUpdates(true));
    ipcMain.handle('update:download', () => updater.downloadUpdate());
    ipcMain.handle('update:install', () => updater.installUpdate());
    ipcMain.handle('update:open-releases', () => {
        shell.openExternal('https://github.com/GITHUB_OWNER/g2g-automation-desktop/releases/latest');
    });

    // Forward updater events to the renderer and tray
    updater.setGetWindow(getWindow);

    // ── Navigation ────────────────────────────────────────────────────────────

    ipcMain.handle('navigate', (_e, page) => {
        const win = getWindow();
        if (!win) return;
        const allowed = ['dashboard', 'settings', 'setup'];
        const name = allowed.includes(page) ? page : 'dashboard';
        win.loadFile(`${__dirname}/../renderer/${name}.html`);
    });

    // ── Wire runner output → renderer + notification parser ───────────────────

    runnerManager.setLogCallback((line) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('log', line);
        parseLogLine(line, getWindow);
    });

    // ── Wire status changes → renderer + tray + watch notifications ───────────

    let prevStatus = 'idle';

    runnerManager.setStatusCallback((status) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('status-change', status);

        tray.setStatus(status);

        const cfg = configStore.getAll();
        if (status === 'watching' && prevStatus !== 'watching') {
            notify.notifyWatchStarted(cfg.WATCH_INTERVAL_SECONDS || 60);
        } else if (status === 'idle' && prevStatus === 'watching') {
            notify.notifyWatchStopped();
        }

        prevStatus = status;
    });

    // Mirror updater events to the tray so it stays in sync
    const { autoUpdater } = require('electron-updater');

    autoUpdater.on('checking-for-update', () => tray.setUpdateState('checking'));
    autoUpdater.on('update-available', (info) => tray.setUpdateState('available', info.version));
    autoUpdater.on('update-not-available', () => tray.setUpdateState(null));
    autoUpdater.on('update-downloaded', (info) => tray.setUpdateState('downloaded', info.version));
    autoUpdater.on('error', () => tray.setUpdateState(null));
}

module.exports = { registerIpcHandlers };
