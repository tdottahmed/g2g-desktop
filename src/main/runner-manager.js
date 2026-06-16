const { spawn } = require('child_process');
const path = require('path');
const { app, utilityProcess } = require('electron');

const STATUS = {
    IDLE: 'idle',
    RUNNING: 'running',
    WATCHING: 'watching',
    ERROR: 'error',
};

// ── Path helpers ──────────────────────────────────────────────────────────────

function getAutomationDir() {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'automation')
        : path.join(__dirname, '../../automation');
}

function getCookiesDir() {
    return path.join(app.getPath('userData'), 'cookies');
}

function getBrowsersDir() {
    return path.join(app.getPath('userData'), 'browsers');
}

// ── Spawn env builder ─────────────────────────────────────────────────────────

function buildEnv(config) {
    const base = {
        ...process.env,
        LARAVEL_API_URL:        config.LARAVEL_API_URL || '',
        API_KEY:                config.API_KEY || '',
        HEADLESS:               config.HEADLESS ? 'true' : 'false',
        SLOW_MO:                String(config.SLOW_MO ?? 120),
        WATCH_INTERVAL_SECONDS: String(config.WATCH_INTERVAL_SECONDS ?? 60),
        G2G_BASE_URL:           config.G2G_BASE_URL || 'https://www.g2g.com',
    };

    if (app.isPackaged) {
        // Packaged: use userData for cookies and browsers (automation dir is read-only).
        return {
            ...base,
            NODE_PATH:                path.join(process.resourcesPath, 'app', 'node_modules'),
            COOKIES_DIR:              getCookiesDir(),
            PLAYWRIGHT_BROWSERS_PATH: getBrowsersDir(),
        };
    }

    // Dev: leave COOKIES_DIR and PLAYWRIGHT_BROWSERS_PATH unset so runner.js
    // uses its own defaults — automation/cookies/ and ~/.cache/ms-playwright.
    // Place cookie files in automation/cookies/<email-prefix>.json.
    return base;
}

// ── Process management ────────────────────────────────────────────────────────

let currentProcess = null;
let currentStatus  = STATUS.IDLE;
let logCallback    = null;
let statusCallback = null;

function emitLog(line) { if (logCallback) logCallback(line); }

function setStatus(status) {
    currentStatus = status;
    if (statusCallback) statusCallback(status);
}

function attachProcessEvents(proc, scriptName, args) {
    const mode = args.includes('--watch') ? STATUS.WATCHING : STATUS.RUNNING;
    setStatus(mode);
    emitLog(`[app] Started ${scriptName} ${args.join(' ')} (PID: ${proc.pid})`);

    proc.stdout.on('data', (chunk) => {
        chunk.toString().split('\n').filter(Boolean).forEach(emitLog);
    });
    proc.stderr.on('data', (chunk) => {
        chunk.toString().split('\n').filter(Boolean).forEach((l) => emitLog(`[err] ${l}`));
    });
    proc.on('exit', (code) => {
        emitLog(`[app] Process exited (code: ${code ?? 'null'})`);
        currentProcess = null;
        setStatus(code === 0 ? STATUS.IDLE : STATUS.ERROR);
    });
}

function start(scriptName = 'runner.js', args = [], config = {}) {
    if (currentProcess) {
        emitLog('[app] Runner is already running. Stop it first.');
        return false;
    }

    const automationDir = getAutomationDir();
    const env = buildEnv(config);

    if (app.isPackaged) {
        // utilityProcess.fork() runs Node scripts directly — no need to spawn
        // the Electron binary with ELECTRON_RUN_AS_NODE, which breaks on Windows
        // when the binary lives in a temp directory (portable builds).
        const scriptPath = path.join(automationDir, scriptName);
        currentProcess = utilityProcess.fork(scriptPath, args, {
            cwd: automationDir,
            env,
            stdio: 'pipe',
        });
        attachProcessEvents(currentProcess, scriptName, args);
    } else {
        const proc = spawn('node', [scriptName, ...args], {
            cwd: automationDir,
            env,
            shell: false,
        });
        currentProcess = proc;
        attachProcessEvents(proc, scriptName, args);
        proc.on('error', (err) => {
            emitLog(`[app] Failed to spawn process: ${err.message}`);
            currentProcess = null;
            setStatus(STATUS.ERROR);
        });
    }

    return true;
}

function stop() {
    if (!currentProcess) { emitLog('[app] Nothing is running.'); return false; }
    currentProcess.kill();
    emitLog('[app] Sent stop signal...');
    return true;
}

function getStatus()  { return currentStatus; }
function isRunning()  { return currentProcess !== null; }

function setLogCallback(fn)    { logCallback = fn; }
function setStatusCallback(fn) { statusCallback = fn; }

module.exports = { start, stop, getStatus, isRunning, setLogCallback, setStatusCallback, STATUS };
