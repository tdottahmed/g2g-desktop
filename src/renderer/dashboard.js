const api = window.electronAPI;

const LOG_MAX = 500; // FIFO cap

let lineCount = 0;
let watchMode = false;

const logPanel     = document.getElementById('log-panel');
const logEmpty     = document.getElementById('log-empty');
const logCount     = document.getElementById('log-count');
const lastRun      = document.getElementById('last-run');
const runnerDot    = document.getElementById('runner-dot');
const runnerText   = document.getElementById('runner-status-text');
const apiDot       = document.getElementById('api-dot');
const apiText      = document.getElementById('api-status-text');
const runStats     = document.getElementById('run-stats');
const statOk       = document.getElementById('stat-ok');
const statErr      = document.getElementById('stat-err');
const appVersion   = document.getElementById('app-version');

const updateBanner  = document.getElementById('update-banner');
const updateBannerIcon = document.getElementById('update-banner-icon');
const updateBannerText = document.getElementById('update-banner-text');
const updateProgressBar = document.getElementById('update-progress-bar');
const btnUpdateAction   = document.getElementById('btn-update-action');
const btnUpdateDismiss  = document.getElementById('btn-update-dismiss');

const btnRun      = document.getElementById('btn-run');
const btnWatch    = document.getElementById('btn-watch');
const btnStop     = document.getElementById('btn-stop');
const btnDelete   = document.getElementById('btn-delete');
const btnClear    = document.getElementById('btn-clear');
const btnTest     = document.getElementById('btn-test');
const btnSettings = document.getElementById('btn-settings');

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
    // Remove placeholder
    if (logEmpty.parentNode) logEmpty.remove();

    // FIFO: drop oldest line when capped
    const rows = logPanel.querySelectorAll('.log-line');
    if (rows.length >= LOG_MAX) {
        rows[0].remove();
        lineCount--;
    }

    lineCount++;
    logCount.textContent = `${lineCount} line${lineCount !== 1 ? 's' : ''}`;

    const time = new Date().toLocaleTimeString('en-US', { hour12: false });

    const row = document.createElement('div');
    row.className = 'log-line';

    const ts = document.createElement('span');
    ts.className = 'log-time';
    ts.textContent = time;

    const txt = document.createElement('span');
    const cls = classify(line);
    txt.className = `log-text${cls ? ' ' + cls : ''}`;
    txt.textContent = line;

    row.appendChild(ts);
    row.appendChild(txt);
    logPanel.appendChild(row);

    logPanel.scrollTop = logPanel.scrollHeight;
}

// ── Status rendering ──────────────────────────────────────────────────────────

const dotClasses   = { idle: 'dot-idle', running: 'dot-running', watching: 'dot-watching', error: 'dot-error' };
const statusLabels = { idle: 'Idle', running: 'Running…', watching: 'Watching', error: 'Error' };

function applyStatus(status) {
    runnerDot.className = `status-dot ${dotClasses[status] ?? 'dot-idle'}`;
    runnerText.textContent = statusLabels[status] ?? status;

    const busy = status === 'running' || status === 'watching';
    watchMode  = status === 'watching';

    btnRun.disabled    = busy;
    btnWatch.disabled  = busy && !watchMode; // allow Stop Watch click
    btnDelete.disabled = busy;
    btnStop.disabled   = !busy;

    btnWatch.textContent = watchMode ? '⏹ Stop Watch' : '👁 Start Watch';
    btnWatch.className   = watchMode ? 'btn danger' : 'btn success';
}

// ── Run stats ─────────────────────────────────────────────────────────────────

function applyRunStats({ success, failed }) {
    statOk.textContent  = success;
    statErr.textContent = failed;
    runStats.style.display = 'flex';
    lastRun.textContent = new Date().toLocaleTimeString();
}

// ── Update banner ─────────────────────────────────────────────────────────────

let updateReadyToInstall = false;

function applyUpdateStatus({ state, version }) {
    if (state === 'available') {
        updateBannerIcon.textContent = '🆕';
        updateBannerText.textContent = `Version ${version} is available.`;
        btnUpdateAction.textContent  = 'Download';
        updateProgressBar.style.display = 'none';
        updateBanner.classList.add('show');
        updateReadyToInstall = false;
    } else if (state === 'downloaded') {
        updateBannerIcon.textContent = '⬇️';
        updateBannerText.textContent = `Version ${version} downloaded — restart to install.`;
        btnUpdateAction.textContent  = 'Install & Restart';
        updateProgressBar.style.display = 'none';
        updateBanner.classList.add('show');
        updateReadyToInstall = true;
    } else if (state === 'error') {
        updateBanner.classList.remove('show');
    } else if (state === 'not-available' || state === 'checking') {
        // no-op — don't show banner for these
    }
}

function applyUpdateProgress({ percent }) {
    updateBannerText.textContent = `Downloading update… ${percent}%`;
    updateProgressBar.style.display = 'block';
    updateProgressBar.style.width   = `${percent}%`;
    btnUpdateAction.disabled = true;
}

btnUpdateAction.addEventListener('click', async () => {
    if (updateReadyToInstall) {
        await api.updateInstall();
    } else {
        btnUpdateAction.disabled = true;
        btnUpdateAction.textContent = 'Downloading…';
        await api.updateDownload();
    }
});

btnUpdateDismiss.addEventListener('click', () => {
    updateBanner.classList.remove('show');
});

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
    apiDot.className    = 'status-dot dot-idle';
    apiText.textContent = 'Testing…';
    btnTest.disabled    = true;
    const res = await api.configTest();
    btnTest.disabled = false;
    if (res.success) {
        apiDot.className    = 'status-dot dot-connected';
        apiText.textContent = 'Connected';
        appendLog('[app] ✅ API connection OK');
    } else {
        apiDot.className    = 'status-dot dot-disconnected';
        apiText.textContent = 'Failed';
        appendLog(`[app] ❌ API error: ${res.error}`);
    }
});

// ── IPC listeners ─────────────────────────────────────────────────────────────

api.onLog(appendLog);
api.onStatusChange(applyStatus);
api.onRunComplete(applyRunStats);
api.onUpdateStatus(applyUpdateStatus);
api.onUpdateProgress(applyUpdateProgress);

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
    const [status, version] = await Promise.all([
        api.runnerStatus(),
        api.appVersion(),
    ]);
    applyStatus(status);
    if (version) appVersion.textContent = `v${version}`;
    btnTest.click();
})();
