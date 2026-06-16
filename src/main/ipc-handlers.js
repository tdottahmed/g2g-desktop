const { ipcMain, app } = require('electron');
const configStore = require('./config-store');
const runnerManager = require('./runner-manager');
const tray = require('./tray');

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
        const cfg = configStore.getAll();
        const args = mode === 'watch' ? ['--watch'] : mode === 'status' ? ['--status'] : [];
        const ok = runnerManager.start('runner.js', args, cfg);
        return { success: ok };
    });

    ipcMain.handle('runner:stop', () => {
        const ok = runnerManager.stop();
        return { success: ok };
    });

    ipcMain.handle('runner:status', () => runnerManager.getStatus());

    // ── Runner: delete all offers ─────────────────────────────────────────────

    ipcMain.handle('deleter:start', (_e, mode = 'run') => {
        const cfg = configStore.getAll();
        const args = ['--api'];
        if (mode === 'watch') args.push('--watch');
        const ok = runnerManager.start('delete-offers.js', args, cfg);
        return { success: ok };
    });

    // ── Navigation ────────────────────────────────────────────────────────────

    ipcMain.handle('navigate', (_e, page) => {
        const win = getWindow();
        if (!win) return;
        const file = page === 'settings' ? 'settings.html' : 'dashboard.html';
        win.loadFile(`${__dirname}/../renderer/${file}`);
    });

    // ── Wire runner output → renderer ─────────────────────────────────────────

    runnerManager.setLogCallback((line) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('log', line);
    });

    runnerManager.setStatusCallback((status) => {
        // Update renderer
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('status-change', status);
        // Update tray icon + menu
        tray.setStatus(status);
    });
}

module.exports = { registerIpcHandlers };
