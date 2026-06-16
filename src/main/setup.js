const { app }    = require('electron');
const { spawn }  = require('child_process');
const { existsSync } = require('fs');
const path       = require('path');

// ── Paths ─────────────────────────────────────────────────────────────────────

function getBrowsersDir() {
    return path.join(app.getPath('userData'), 'browsers');
}

// playwright/cli.js resolves correctly in both dev and packaged (asar:false)
// builds keep the same relative layout: app/src/main → app/node_modules/playwright
function getPlaywrightCli() {
    return path.join(__dirname, '../../node_modules/playwright/cli.js');
}

// ── Browser detection ─────────────────────────────────────────────────────────

function isBrowserInstalled() {
    if (!app.isPackaged) return true; // dev: assume postinstall already ran

    const prevPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    try {
        process.env.PLAYWRIGHT_BROWSERS_PATH = getBrowsersDir();
        const { chromium } = require('playwright');
        const exePath = chromium.executablePath();
        return existsSync(exePath);
    } catch {
        return false;
    } finally {
        if (prevPath === undefined) {
            delete process.env.PLAYWRIGHT_BROWSERS_PATH;
        } else {
            process.env.PLAYWRIGHT_BROWSERS_PATH = prevPath;
        }
    }
}

// ── Browser installation ──────────────────────────────────────────────────────

/**
 * Installs Chromium into userData/browsers via the Playwright CLI.
 * @param {(line: string) => void} onLog  — called for each stdout/stderr line
 * @param {(success: boolean) => void} onDone — called when the process exits
 * @returns {ChildProcess}
 */
function installBrowser(onLog, onDone) {
    const browsersDir  = getBrowsersDir();
    const playwrightCli = getPlaywrightCli();

    const proc = spawn(
        process.execPath,               // Electron binary (also a Node.js runtime)
        [playwrightCli, 'install', 'chromium'],
        {
            env: {
                ...process.env,
                PLAYWRIGHT_BROWSERS_PATH: browsersDir,
                ELECTRON_RUN_AS_NODE: '1', // run Electron as a plain Node.js process
            },
        }
    );

    const handleChunk = (chunk) =>
        chunk.toString().split('\n').filter(Boolean).forEach(onLog);

    proc.stdout.on('data', handleChunk);
    proc.stderr.on('data', handleChunk);

    proc.on('exit', (code) => onDone(code === 0));
    proc.on('error', (err) => { onLog(`[err] ${err.message}`); onDone(false); });

    return proc;
}

module.exports = { isBrowserInstalled, installBrowser, getBrowsersDir };
