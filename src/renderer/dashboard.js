const api = window.electronAPI;

let lineCount = 0;
let watchMode = false;

const logPanel   = document.getElementById('log-panel');
const logEmpty   = document.getElementById('log-empty');
const logCount   = document.getElementById('log-count');
const lastRun    = document.getElementById('last-run');
const runnerDot  = document.getElementById('runner-dot');
const runnerText = document.getElementById('runner-status-text');
const apiDot     = document.getElementById('api-dot');
const apiText    = document.getElementById('api-status-text');

const btnRun     = document.getElementById('btn-run');
const btnWatch   = document.getElementById('btn-watch');
const btnStop    = document.getElementById('btn-stop');
const btnDelete  = document.getElementById('btn-delete');
const btnClear   = document.getElementById('btn-clear');
const btnTest    = document.getElementById('btn-test');
const btnSettings= document.getElementById('btn-settings');

// ── Log rendering ─────────────────────────────────────────────────────────────

function classify(line) {
    const l = line.toLowerCase();
    if (l.startsWith('[err]') || l.includes('❌') || l.includes('error') || l.includes('failed')) return 'error';
    if (l.includes('✅') || l.includes('success')) return 'success';
    if (l.includes('⚠️') || l.includes('warning') || l.includes('warn')) return 'warn';
    if (l.startsWith('[app]')) return 'app';
    if (l.includes('ℹ️') || l.includes('📋') || l.includes('👤') || l.includes('🤖')) return 'info';
    return '';
}

function appendLog(line) {
    if (logEmpty.parentNode) logEmpty.remove();

    lineCount++;
    logCount.textContent = `${lineCount} line${lineCount !== 1 ? 's' : ''}`;

    const now  = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });

    const row      = document.createElement('div');
    row.className  = 'log-line';

    const ts       = document.createElement('span');
    ts.className   = 'log-time';
    ts.textContent = time;

    const txt      = document.createElement('span');
    const cls      = classify(line);
    txt.className  = `log-text${cls ? ' ' + cls : ''}`;
    txt.textContent = line;

    row.appendChild(ts);
    row.appendChild(txt);
    logPanel.appendChild(row);

    logPanel.scrollTop = logPanel.scrollHeight;

    if (line.includes('Run complete') || line.includes('run complete')) {
        lastRun.textContent = new Date().toLocaleTimeString();
    }
}

// ── Status rendering ──────────────────────────────────────────────────────────

const dotClasses = { idle: 'dot-idle', running: 'dot-running', watching: 'dot-watching', error: 'dot-error' };
const statusLabels = { idle: 'Idle', running: 'Running…', watching: 'Watching', error: 'Error' };

function applyStatus(status) {
    runnerDot.className = `status-dot ${dotClasses[status] ?? 'dot-idle'}`;
    runnerText.textContent = statusLabels[status] ?? status;

    const busy = status === 'running' || status === 'watching';
    watchMode  = status === 'watching';

    btnRun.disabled    = busy;
    btnWatch.disabled  = busy;
    btnDelete.disabled = busy;
    btnStop.disabled   = !busy;

    btnWatch.textContent = watchMode ? '👁 Stop Watch' : '👁 Start Watch';
}

// ── Buttons ───────────────────────────────────────────────────────────────────

btnRun.addEventListener('click', async () => {
    const { success } = await api.runnerStart('run');
    if (!success) appendLog('[app] Could not start runner — already running?');
});

btnWatch.addEventListener('click', async () => {
    if (watchMode) {
        await api.runnerStop();
    } else {
        const { success } = await api.runnerStart('watch');
        if (!success) appendLog('[app] Could not start watch mode.');
    }
});

btnStop.addEventListener('click', async () => {
    await api.runnerStop();
});

btnDelete.addEventListener('click', async () => {
    if (!confirm('Delete ALL live offers from g2g.com for all queued accounts?')) return;
    const { success } = await api.deleterStart('run');
    if (!success) appendLog('[app] Could not start deleter — runner may already be running.');
});

btnClear.addEventListener('click', () => {
    logPanel.innerHTML = '';
    logPanel.appendChild(logEmpty);
    lineCount = 0;
    logCount.textContent = '0 lines';
});

btnSettings.addEventListener('click', () => api.navigate('settings'));

btnTest.addEventListener('click', async () => {
    apiDot.className  = 'status-dot dot-idle';
    apiText.textContent = 'Testing…';
    btnTest.disabled = true;
    const res = await api.configTest();
    btnTest.disabled = false;
    if (res.success) {
        apiDot.className  = 'status-dot dot-connected';
        apiText.textContent = 'Connected';
        appendLog('[app] ✅ API connection OK');
    } else {
        apiDot.className  = 'status-dot dot-disconnected';
        apiText.textContent = 'Failed';
        appendLog(`[app] ❌ API error: ${res.error}`);
    }
});

// ── IPC listeners ─────────────────────────────────────────────────────────────

api.onLog(appendLog);
api.onStatusChange(applyStatus);

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
    const status = await api.runnerStatus();
    applyStatus(status);
    btnTest.click();  // auto-check connection on load
})();
