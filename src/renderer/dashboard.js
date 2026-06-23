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

// ── Account picker modal refs ──────────────────────────────────────────────────

const accountModal   = document.getElementById('account-modal');
const modalBody      = document.getElementById('modal-body');
const modalLoading   = document.getElementById('modal-loading');
const modalSearch    = document.getElementById('modal-search');
const modalConfirm   = document.getElementById('modal-confirm');
const modalCancel    = document.getElementById('modal-cancel');
const modalCloseBtn  = document.getElementById('modal-close');
const accountSearch  = document.getElementById('account-search');

const btnCopyLogs      = document.getElementById('btn-copy-logs');
const btnRun           = document.getElementById('btn-run');
const btnWatch         = document.getElementById('btn-watch');
const btnStop          = document.getElementById('btn-stop');
const btnDeleteNonPerm = document.getElementById('btn-delete-non-perm');
const btnClear         = document.getElementById('btn-clear');
const btnTest          = document.getElementById('btn-test');
const btnSettings      = document.getElementById('btn-settings');

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

    btnRun.disabled           = busy;
    btnWatch.disabled         = busy && !watchMode; // allow Stop Watch click
    btnDeleteNonPerm.disabled = busy;
    btnStop.disabled          = !busy;

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

btnDeleteNonPerm.addEventListener('click', () => openAccountModal());

btnClear.addEventListener('click', () => {
    logPanel.innerHTML = '';
    logPanel.appendChild(logEmpty);
    lineCount = 0;
    logCount.textContent = '0 lines';
});

btnCopyLogs.addEventListener('click', () => {
    const rows = logPanel.querySelectorAll('.log-line');
    if (rows.length === 0) return;

    const text = [...rows].map(row => {
        const time = row.querySelector('.log-time')?.textContent ?? '';
        const msg  = row.querySelector('.log-text')?.textContent ?? '';
        return `${time}  ${msg}`;
    }).join('\n');

    navigator.clipboard.writeText(text).then(() => {
        btnCopyLogs.textContent = '✅ Copied';
        setTimeout(() => { btnCopyLogs.textContent = '📋 Copy'; }, 1500);
    }).catch(() => {
        btnCopyLogs.textContent = '❌ Failed';
        setTimeout(() => { btnCopyLogs.textContent = '📋 Copy'; }, 1500);
    });
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

// ── Account picker modal ──────────────────────────────────────────────────────

let allAccounts    = [];
let selectedEmail  = null;
let selectedUserId = null;

function openAccountModal() {
    selectedEmail  = null;
    selectedUserId = null;
    modalConfirm.disabled = true;
    accountSearch.value   = '';
    modalSearch.style.display = 'none';
    modalBody.innerHTML   = '';
    modalBody.appendChild(modalLoading);

    accountModal.classList.add('show');

    api.accountsFetch().then((res) => {
        if (!res.success) {
            showModalError(res.error || 'Could not load accounts.');
            return;
        }
        allAccounts = res.accounts || [];
        if (allAccounts.length === 0) {
            showModalEmpty();
        } else {
            if (allAccounts.length > 4) modalSearch.style.display = 'block';
            renderAccounts(allAccounts);
        }
    }).catch((err) => showModalError(err.message));
}

function closeAccountModal() {
    accountModal.classList.remove('show');
}

function showModalError(msg) {
    modalBody.innerHTML = `
        <div class="modal-state error-state">
          <span class="state-icon">❌</span>
          <span>${escapeHtml(msg)}</span>
        </div>`;
}

function showModalEmpty() {
    modalBody.innerHTML = `
        <div class="modal-state">
          <span class="state-icon">📭</span>
          <span>No user accounts found.<br>Add accounts in the Laravel admin panel first.</span>
        </div>`;
}

function renderAccounts(accounts) {
    modalBody.innerHTML = '';

    if (accounts.length === 0) {
        modalBody.innerHTML = `
            <div class="modal-state">
              <span class="state-icon">🔍</span>
              <span>No accounts match your search.</span>
            </div>`;
        return;
    }

    accounts.forEach((acct) => {
        const { id, email } = acct;
        const card = document.createElement('div');
        card.className = `account-card${selectedEmail === email ? ' selected' : ''}`;
        card.dataset.email  = email;
        card.dataset.userId = id;

        const nonPerm   = acct.non_permanent_count ?? 0;
        const total     = acct.total_templates_count ?? 0;
        const metaText  = nonPerm > 0
            ? `${nonPerm} non-permanent offer${nonPerm !== 1 ? 's' : ''} will be deleted · ${total} total`
            : `No non-permanent offers · ${total} total`;
        const metaClass = nonPerm > 0 ? 'meta-active' : 'meta-none';

        card.innerHTML = `
            <div class="account-avatar">👤</div>
            <div class="account-info">
              <div class="account-email" title="${escapeHtml(email)}">${escapeHtml(email)}</div>
              <div class="account-meta"><span class="${metaClass}">${escapeHtml(metaText)}</span></div>
            </div>
            <div class="account-radio"></div>`;

        card.addEventListener('click', () => selectAccount(email, id));
        modalBody.appendChild(card);
    });
}

function selectAccount(email, userId) {
    selectedEmail  = email;
    selectedUserId = userId;
    modalConfirm.disabled = false;

    modalBody.querySelectorAll('.account-card').forEach((card) => {
        card.classList.toggle('selected', card.dataset.email === email);
    });
}

// Search filter
accountSearch.addEventListener('input', () => {
    const q = accountSearch.value.toLowerCase().trim();
    const filtered = q ? allAccounts.filter((a) => a.email.toLowerCase().includes(q)) : allAccounts;
    renderAccounts(filtered);
    // Re-apply selection highlight after re-render
    if (selectedEmail) {
        const card = modalBody.querySelector(`[data-email="${CSS.escape(selectedEmail)}"]`);
        if (card) card.classList.add('selected');
        else { selectedEmail = null; selectedUserId = null; modalConfirm.disabled = true; }
    }
});

// Close actions
modalCloseBtn.addEventListener('click', closeAccountModal);
modalCancel.addEventListener('click', closeAccountModal);
accountModal.addEventListener('click', (e) => {
    if (e.target === accountModal) closeAccountModal();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && accountModal.classList.contains('show')) closeAccountModal();
});

// Confirm — delete non-permanent offers for the selected account
modalConfirm.addEventListener('click', async () => {
    if (!selectedEmail || !selectedUserId) return;

    closeAccountModal();

    const { success } = await api.deleterStartNonPermanent(selectedUserId, selectedEmail);
    if (!success) {
        appendLog('[app] ❌ Could not start non-permanent deleter — a process may already be running.');
    } else {
        appendLog(`[app] 🛡 Deleting non-permanent offers for ${selectedEmail}…`);
    }
});

// ── IPC listeners ─────────────────────────────────────────────────────────────

api.onLog(appendLog);
api.onStatusChange(applyStatus);
api.onRunComplete(applyRunStats);
api.onUpdateStatus(applyUpdateStatus);
api.onUpdateProgress(applyUpdateProgress);

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

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
