const api = window.electronAPI;

// ── Element refs ──────────────────────────────────────────────────────────────

const elZeusxEmail        = document.getElementById('zeusx-email');
const elZeusxPassword     = document.getElementById('zeusx-password');
const elChromeProfileName = document.getElementById('chrome-profile-name');
const elChromeProfileEmail= document.getElementById('chrome-profile-email');
const elChromePath        = document.getElementById('chrome-path');
const elChromeProfile     = document.getElementById('chrome-profile-dir');
const elApiUrl         = document.getElementById('api-url');
const elApiKey         = document.getElementById('api-key');
const elSlowMo         = document.getElementById('slow-mo');
const elInterval       = document.getElementById('watch-interval');
const elHeadless       = document.getElementById('headless');
const elStartWin       = document.getElementById('start-with-windows');
const elTestResult     = document.getElementById('test-result');
const elUnsavedDot     = document.getElementById('unsaved-dot');
const elBanner         = document.getElementById('first-run-banner');
const elBtnBack        = document.getElementById('btn-back');
const elBtnSave        = document.getElementById('btn-save');
const elBtnTest        = document.getElementById('btn-test');
const elBtnGo          = document.getElementById('btn-goto-dashboard');
const elBtnEyePassword = document.getElementById('btn-eye-password');
const elBtnEyeKey      = document.getElementById('btn-eye-key');
const elVersionLabel   = document.getElementById('app-version-label');
const elBtnCheckUpdate = document.getElementById('btn-check-update');
const elUpdateStatusBox= document.getElementById('update-status-box');

let isFirstRun = false;
let isDirty    = false;

// ── Dirty tracking ────────────────────────────────────────────────────────────

function markDirty() { isDirty = true;  elUnsavedDot.classList.add('visible'); }
function markClean() { isDirty = false; elUnsavedDot.classList.remove('visible'); }

[elZeusxEmail, elZeusxPassword, elChromeProfileName, elChromeProfileEmail,
 elChromePath, elChromeProfile, elApiUrl, elApiKey, elSlowMo, elInterval].forEach((el) =>
    el.addEventListener('input', markDirty)
);
[elHeadless, elStartWin].forEach((el) =>
    el.addEventListener('change', markDirty)
);

// ── Validation ────────────────────────────────────────────────────────────────

function setFieldError(groupId, hasError) {
    document.getElementById(groupId)?.classList.toggle('has-error', hasError);
}

function clearErrors() {
    ['fg-api-url', 'fg-api-key'].forEach((id) =>
        document.getElementById(id)?.classList.remove('has-error', 'has-success')
    );
}

function validate() {
    clearErrors();
    let ok = true;
    if (!elApiUrl.value.trim()) { setFieldError('fg-api-url', true); ok = false; }
    if (!elApiKey.value.trim()) { setFieldError('fg-api-key', true); ok = false; }
    return ok;
}

// ── Collect form ──────────────────────────────────────────────────────────────

function collectForm() {
    return {
        ZEUSX_EMAIL:            elZeusxEmail.value.trim(),
        ZEUSX_PASSWORD:         elZeusxPassword.value,
        CHROME_PROFILE_NAME:    elChromeProfileName.value.trim(),
        CHROME_PROFILE_EMAIL:   elChromeProfileEmail.value.trim(),
        CHROME_PATH:            elChromePath.value.trim(),
        CHROME_PROFILE_DIR:     elChromeProfile.value.trim(),
        LARAVEL_API_URL:        elApiUrl.value.trim(),
        API_KEY:                elApiKey.value.trim(),
        SLOW_MO:                parseInt(elSlowMo.value, 10)    || 120,
        WATCH_INTERVAL_SECONDS: parseInt(elInterval.value, 10)  || 60,
        HEADLESS:               elHeadless.checked,
        startWithWindows:       elStartWin.checked,
    };
}

// ── Test result box ───────────────────────────────────────────────────────────

function showTestResult(state, msg) { elTestResult.className = state; elTestResult.innerHTML = msg; }
function hideTestResult()           { elTestResult.className = '';    elTestResult.innerHTML = ''; }

// ── Update status ─────────────────────────────────────────────────────────────

function showUpdateStatus(text, bg, border, color) {
    elUpdateStatusBox.style.cssText = `display:block; background:${bg}; border:1px solid ${border}; color:${color};`;
    elUpdateStatusBox.textContent = text;
}

api.onUpdateStatus(({ state, version }) => {
    if (state === 'checking') {
        showUpdateStatus('Checking for updates…', '#1c0e35', '#5b21b6', '#c4b5fd');
        elBtnCheckUpdate.disabled = true;
    } else if (state === 'available') {
        showUpdateStatus(`Version ${version} is available! Go to Dashboard to download.`, '#052e16', '#166534', '#4ade80');
        elBtnCheckUpdate.disabled = false;
    } else if (state === 'not-available') {
        showUpdateStatus(`You're up to date (v${version}).`, '#0f172a', '#1e2535', '#64748b');
        elBtnCheckUpdate.disabled = false;
    } else if (state === 'downloaded') {
        showUpdateStatus(`Version ${version} downloaded. Restart to install.`, '#052e16', '#166534', '#4ade80');
        elBtnCheckUpdate.disabled = false;
    } else if (state === 'error') {
        showUpdateStatus('Update check failed. Check your internet connection.', '#2d0505', '#7f1d1d', '#f87171');
        elBtnCheckUpdate.disabled = false;
    }
});

elBtnCheckUpdate.addEventListener('click', async () => {
    elBtnCheckUpdate.disabled = true;
    showUpdateStatus('Checking for updates…', '#1c0e35', '#5b21b6', '#c4b5fd');
    await api.updateCheck();
});

// ── Load config ───────────────────────────────────────────────────────────────

(async () => {
    const [cfg, version] = await Promise.all([api.configGet(), api.appVersion()]);

    elZeusxEmail.value         = cfg.ZEUSX_EMAIL          || '';
    elZeusxPassword.value      = cfg.ZEUSX_PASSWORD        || '';
    elChromeProfileName.value  = cfg.CHROME_PROFILE_NAME   || '';
    elChromeProfileEmail.value = cfg.CHROME_PROFILE_EMAIL  || '';
    elChromePath.value         = cfg.CHROME_PATH           || '';
    elChromeProfile.value      = cfg.CHROME_PROFILE_DIR    || '';
    elApiUrl.value        = cfg.LARAVEL_API_URL || '';
    elApiKey.value        = cfg.API_KEY         || '';
    elSlowMo.value        = cfg.SLOW_MO        ?? 120;
    elInterval.value      = cfg.WATCH_INTERVAL_SECONDS ?? 60;
    elHeadless.checked    = Boolean(cfg.HEADLESS);
    elStartWin.checked    = Boolean(cfg.startWithWindows);

    if (version) elVersionLabel.textContent = `Version ${version}`;

    isFirstRun = !cfg.configured;
    if (isFirstRun) {
        elBanner.style.display  = 'block';
        elBtnBack.style.display = 'none';
    }

    markClean();
})();

// ── Eye toggles ───────────────────────────────────────────────────────────────

elBtnEyePassword.addEventListener('click', () => {
    const hidden = elZeusxPassword.type === 'password';
    elZeusxPassword.type = hidden ? 'text' : 'password';
    elBtnEyePassword.textContent = hidden ? '🙈' : '👁';
    elZeusxPassword.focus();
});

elBtnEyeKey.addEventListener('click', () => {
    const hidden = elApiKey.type === 'password';
    elApiKey.type = hidden ? 'text' : 'password';
    elBtnEyeKey.textContent = hidden ? '🙈' : '👁';
    elApiKey.focus();
});

// ── Save ──────────────────────────────────────────────────────────────────────

elBtnSave.addEventListener('click', async () => {
    if (!validate()) return;

    elBtnSave.disabled = true;
    elBtnSave.textContent = 'Saving…';

    await api.configSet(collectForm());

    elBtnSave.disabled = false;
    elBtnSave.textContent = '💾 Save';
    markClean();

    if (!isFirstRun) {
        elBtnSave.classList.add('success');
        elBtnSave.textContent = '✅ Saved';
        setTimeout(() => {
            elBtnSave.classList.remove('success');
            elBtnSave.textContent = '💾 Save';
        }, 2000);
    }
});

// ── Test Connection ───────────────────────────────────────────────────────────

elBtnTest.addEventListener('click', async () => {
    if (!validate()) return;

    await api.configSet(collectForm());
    markClean();

    elBtnTest.disabled = true;
    elBtnTest.textContent = '⏳ Testing…';
    showTestResult('testing', '⏳ &nbsp;Connecting to server…');
    elBtnGo.style.display = 'none';

    const res = await api.configTest();
    elBtnTest.disabled = false;
    elBtnTest.textContent = '🔌 Test Connection';

    if (res.success) {
        showTestResult('ok', '✅ &nbsp;Connected successfully to your Laravel server.');
        document.getElementById('fg-api-url')?.classList.add('has-success');
        document.getElementById('fg-api-key')?.classList.add('has-success');
        elBtnGo.style.display = 'inline-flex';

        if (isFirstRun) {
            isFirstRun = false;
            elBtnBack.style.display = '';
        }
    } else {
        showTestResult('fail', `❌ &nbsp;${escapeHtml(res.error)}`);
        document.getElementById('fg-api-url')?.classList.remove('has-success');
        document.getElementById('fg-api-key')?.classList.remove('has-success');
        elBtnGo.style.display = 'none';
    }
});

// ── Navigation ────────────────────────────────────────────────────────────────

elBtnGo.addEventListener('click', () => api.navigate('dashboard'));

elBtnBack.addEventListener('click', () => {
    if (isDirty && !confirm('You have unsaved changes. Go back without saving?')) return;
    api.navigate('dashboard');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
