const { ipcMain, app } = require('electron');
const configStore   = require('./config-store');
const runnerManager = require('./runner-manager');
const tray          = require('./tray');
const notify        = require('./notifications');
const setup         = require('./setup');

// ── Log-parsing state (per run cycle) ────────────────────────────────────────

let runSuccess = 0;
let runFailed  = 0;

function parseLogLine(line) {
    // Start of a fetch cycle → reset counters
    if (line.includes('Fetching pending templates')) {
        runSuccess = 0;
        runFailed  = 0;
        return;
    }

    // Individual template outcomes
    if (line.includes('Reported success for template')) { runSuccess++; return; }
    if (/Template \d+ failed:/i.test(line))             { runFailed++;  return; }

    // Run finished → fire summary notification
    if (line.includes('Run complete')) {
        notify.notifyRunComplete(runSuccess, runFailed);
        return;
    }

    // Auth failure (stderr — comes in as "[err] ❌ Authentication failed for …")
    // Use \S+ and strip trailing period so "user@example.com." becomes "user@example.com"
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

    // ── Runner: delete all offers ─────────────────────────────────────────────

    ipcMain.handle('deleter:start', (_e, mode = 'run') => {
        const cfg  = configStore.getAll();
        const args = ['--api'];
        if (mode === 'watch') args.push('--watch');
        const ok = runnerManager.start('delete-offers.js', args, cfg);
        return { success: ok };
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
        // Forward to renderer
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('log', line);

        // Parse for notification triggers
        parseLogLine(line);
    });

    // ── Wire status changes → renderer + tray + watch notifications ───────────

    let prevStatus = 'idle';

    runnerManager.setStatusCallback((status) => {
        // Update renderer
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('status-change', status);

        // Update tray icon + context menu
        tray.setStatus(status);

        // Watch-mode lifecycle notifications (silent — informational only)
        const cfg = configStore.getAll();
        if (status === 'watching' && prevStatus !== 'watching') {
            notify.notifyWatchStarted(cfg.WATCH_INTERVAL_SECONDS || 60);
        } else if (status === 'idle' && prevStatus === 'watching') {
            notify.notifyWatchStopped();
        }

        prevStatus = status;
    });
}

module.exports = { registerIpcHandlers };
