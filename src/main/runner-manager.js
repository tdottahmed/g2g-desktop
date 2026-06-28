const { spawn } = require('child_process');
const path = require('path');
const { app, utilityProcess } = require('electron');

const STATUS = {
    IDLE:     'idle',
    RUNNING:  'running',
    WATCHING: 'watching',
    ERROR:    'error',
};

// ── Path helpers ──────────────────────────────────────────────────────────────

function getAutomationDir() {
    return app.isPackaged
        ? path.join(app.getAppPath(), 'automation-zeusx')
        : path.join(__dirname, '../../automation-zeusx');
}

function getCookiesDir() {
    return path.join(app.getPath('userData'), 'zeusx-cookies');
}

function getBrowsersDir() {
    return path.join(app.getPath('userData'), 'browsers');
}

// ── Env builder ───────────────────────────────────────────────────────────────

function buildEnv(config) {
    const base = {
        ...process.env,
        LARAVEL_API_URL:        config.LARAVEL_API_URL        || '',
        API_KEY:                config.API_KEY                || '',
        ZEUSX_BASE_URL:         config.ZEUSX_BASE_URL         || 'https://zeusx.com',
        ZEUSX_EMAIL:            config.ZEUSX_EMAIL            || '',
        ZEUSX_PASSWORD:         config.ZEUSX_PASSWORD         || '',
        CHROME_PATH:            config.CHROME_PATH            || '',
        CHROME_PROFILE_DIR:     config.CHROME_PROFILE_DIR     || '',
        CHROME_PROFILE_NAME:    config.CHROME_PROFILE_NAME    || '',
        CHROME_PROFILE_EMAIL:   config.CHROME_PROFILE_EMAIL   || '',
        HEADLESS:               config.HEADLESS ? 'true' : 'false',
        SLOW_MO:                String(config.SLOW_MO ?? 120),
        WATCH_INTERVAL_SECONDS: String(config.WATCH_INTERVAL_SECONDS ?? 60),
    };

    if (app.isPackaged) {
        return {
            ...base,
            ZEUSX_COOKIES_DIR:        getCookiesDir(),
            PLAYWRIGHT_BROWSERS_PATH: getBrowsersDir(),
        };
    }

    return base;
}

// ── Process management ────────────────────────────────────────────────────────

let currentProcess = null;
let currentStatus  = STATUS.IDLE;
let logCallback    = null;
let statusCallback = null;

function emitLog(line)     { if (logCallback)    logCallback(line); }
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
