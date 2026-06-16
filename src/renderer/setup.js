const api = window.electronAPI;

const promptArea   = document.getElementById('prompt-area');
const progressArea = document.getElementById('progress-area');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-label-text');
const logBox       = document.getElementById('log-box');
const errorArea    = document.getElementById('error-area');
const successArea  = document.getElementById('success-area');
const btnInstall   = document.getElementById('btn-install');
const btnContinue  = document.getElementById('btn-continue');
const btnRetry     = document.getElementById('btn-retry');

// ── Log rendering ─────────────────────────────────────────────────────────────

function appendLog(line) {
    const el = document.createElement('div');
    el.className = 'log-line' +
        (line.includes('✅') || line.toLowerCase().includes('success') ? ' ok' : '') +
        (line.includes('❌') || line.toLowerCase().includes('error')   ? ' err' : '');
    el.textContent = line;
    logBox.appendChild(el);
    logBox.scrollTop = logBox.scrollHeight;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function parseProgress(line) {
    // Playwright logs lines like: "Downloading chromium ... 45%"
    const m = line.match(/(\d+)\s*%/);
    if (m) {
        const pct = parseInt(m[1], 10);
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = `${pct}%`;
        document.getElementById('progress-pct').textContent = `${pct}%`;
    }
}

// ── States ────────────────────────────────────────────────────────────────────

function showInstalling() {
    promptArea.style.display   = 'none';
    progressArea.style.display = 'block';
    logBox.style.display       = 'block';
    errorArea.style.display    = 'none';
    successArea.style.display  = 'none';
    btnContinue.style.display  = 'none';
    btnRetry.style.display     = 'none';
}

function showSuccess() {
    progressArea.style.display = 'none';
    successArea.style.display  = 'block';
    btnContinue.style.display  = 'block';
    btnRetry.style.display     = 'none';
    progressFill.classList.remove('indeterminate');
    progressFill.style.width = '100%';
}

function showError(msg) {
    progressArea.style.display = 'none';
    errorArea.style.display    = 'block';
    errorArea.textContent      = `❌ ${msg}`;
    btnContinue.style.display  = 'none';
    btnRetry.style.display     = 'block';
}

function showPrompt() {
    promptArea.style.display   = 'block';
    progressArea.style.display = 'none';
    logBox.style.display       = 'none';
    errorArea.style.display    = 'none';
    successArea.style.display  = 'none';
    btnContinue.style.display  = 'none';
    btnRetry.style.display     = 'none';
    logBox.innerHTML           = '';
    progressFill.classList.add('indeterminate');
    progressFill.style.width   = '0%';
    document.getElementById('progress-pct').textContent = '';
}

// ── Installation ──────────────────────────────────────────────────────────────

async function startInstall() {
    btnInstall.disabled = true;
    showInstalling();

    // Listen for streamed log lines
    api.onSetupLog((line) => {
        appendLog(line);
        parseProgress(line);
    });

    const result = await api.setupInstall();

    api.removeListeners('setup:log');

    if (result.success) {
        showSuccess();
    } else {
        showError('Installation failed. Check the log above for details.');
    }
}

// ── Button handlers ───────────────────────────────────────────────────────────

btnInstall.addEventListener('click', startInstall);

btnRetry.addEventListener('click', () => {
    btnInstall.disabled = false;
    showPrompt();
});

btnContinue.addEventListener('click', () => api.navigate('settings'));

// ── Auto-check on load ────────────────────────────────────────────────────────
// (In dev the setup page should never load. In packaged mode, if the user
//  somehow lands here but browser is already installed, skip to settings.)

(async () => {
    const { installed } = await api.setupCheck();
    if (installed) {
        api.navigate('settings');
    } else {
        showPrompt();
    }
})();
