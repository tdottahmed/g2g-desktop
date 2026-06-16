const { spawn } = require('child_process');
const path = require('path');
const { app } = require('electron');

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
        LARAVEL_API_URL:         config.LARAVEL_API_URL || '',
        API_KEY:                 config.API_KEY || '',
        HEADLESS:                config.HEADLESS ? 'true' : 'false',
        SLOW_MO:                 String(config.SLOW_MO ?? 120),
        WATCH_INTERVAL_SECONDS:  String(config.WATCH_INTERVAL_SECONDS ?? 60),
        G2G_BASE_URL:            config.G2G_BASE_URL || 'https://www.g2g.com',
        COOKIES_DIR:             getCookiesDir(),
        PLAYWRIGHT_BROWSERS_PATH: getBrowsersDir(),
    };

    if (app.isPackaged) {
        // Run Electron binary as a plain Node.js runtime.
        // With asar:false, node_modules live at resources/app/node_modules.
        return {
            ...base,
            ELECTRON_RUN_AS_NODE: '1',
            NODE_PATH: path.join(process.resourcesPath, 'app', 'node_modules'),
        };
    }

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

function start(scriptName = 'runner.js', args = [], config = {}) {
    if (currentProcess) {
        emitLog('[app] Runner is already running. Stop it first.');
        return false;
    }

    const automationDir = getAutomationDir();
    // In packaged mode use Electron binary (ELECTRON_RUN_AS_NODE=1); in dev use system node.
    const nodeBin = app.isPackaged ? process.execPath : 'node';

    currentProcess = spawn(nodeBin, [scriptName, ...args], {
        cwd: automationDir,
        env: buildEnv(config),
        shell: false,
    });

    const mode = args.includes('--watch') ? STATUS.WATCHING : STATUS.RUNNING;
    setStatus(mode);
    emitLog(`[app] Started ${scriptName} ${args.join(' ')} (PID: ${currentProcess.pid})`);

    currentProcess.stdout.on('data', (chunk) => {
        chunk.toString().split('\n').filter(Boolean).forEach(emitLog);
    });

    currentProcess.stderr.on('data', (chunk) => {
        chunk.toString().split('\n').filter(Boolean).forEach((l) => emitLog(`[err] ${l}`));
    });

    currentProcess.on('exit', (code, signal) => {
        emitLog(`[app] Process exited (code: ${code ?? 'null'}, signal: ${signal ?? 'none'})`);
        currentProcess = null;
        setStatus(code === 0 ? STATUS.IDLE : STATUS.ERROR);
    });

    currentProcess.on('error', (err) => {
        emitLog(`[app] Failed to spawn process: ${err.message}`);
        currentProcess = null;
        setStatus(STATUS.ERROR);
    });

    return true;
}

function stop() {
    if (!currentProcess) { emitLog('[app] Nothing is running.'); return false; }
    currentProcess.kill('SIGTERM');
    emitLog('[app] Sent stop signal...');
    return true;
}

function getStatus()  { return currentStatus; }
function isRunning()  { return currentProcess !== null; }

function setLogCallback(fn)    { logCallback = fn; }
function setStatusCallback(fn) { statusCallback = fn; }

module.exports = { start, stop, getStatus, isRunning, setLogCallback, setStatusCallback, STATUS };
