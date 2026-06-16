const api = window.electronAPI;

// ── Element refs ──────────────────────────────────────────────────────────────

const elApiUrl      = document.getElementById('api-url');
const elApiKey      = document.getElementById('api-key');
const elSlowMo      = document.getElementById('slow-mo');
const elInterval    = document.getElementById('watch-interval');
const elHeadless    = document.getElementById('headless');
const elStartWin    = document.getElementById('start-with-windows');
const elTestResult  = document.getElementById('test-result');
const elUnsavedDot  = document.getElementById('unsaved-dot');
const elBanner      = document.getElementById('first-run-banner');
const elBtnBack     = document.getElementById('btn-back');
const elBtnSave     = document.getElementById('btn-save');
const elBtnTest     = document.getElementById('btn-test');
const elBtnGo       = document.getElementById('btn-goto-dashboard');
const elBtnEye      = document.getElementById('btn-eye');

let isFirstRun = false;
let isDirty    = false;

// ── Dirty tracking ────────────────────────────────────────────────────────────

function markDirty() {
    isDirty = true;
    elUnsavedDot.classList.add('visible');
}

function markClean() {
    isDirty = false;
    elUnsavedDot.classList.remove('visible');
}

[elApiUrl, elApiKey, elSlowMo, elInterval].forEach((el) =>
    el.addEventListener('input', markDirty)
);
[elHeadless, elStartWin].forEach((el) =>
    el.addEventListener('change', markDirty)
);

// ── Validation ────────────────────────────────────────────────────────────────

function setFieldError(groupId, hasError) {
    document.getElementById(groupId).classList.toggle('has-error', hasError);
}

function clearErrors() {
    ['fg-api-url', 'fg-api-key'].forEach((id) =>
        document.getElementById(id).classList.remove('has-error', 'has-success')
    );
}

function validate() {
    clearErrors();
    let ok = true;

    if (!elApiUrl.value.trim()) {
        setFieldError('fg-api-url', true);
        ok = false;
    }
    if (!elApiKey.value.trim()) {
        setFieldError('fg-api-key', true);
        ok = false;
    }

    return ok;
}

// ── Collect form values ───────────────────────────────────────────────────────

function collectForm() {
    return {
        LARAVEL_API_URL:        elApiUrl.value.trim(),
        API_KEY:                elApiKey.value.trim(),
        SLOW_MO:                parseInt(elSlowMo.value, 10) || 120,
        WATCH_INTERVAL_SECONDS: parseInt(elInterval.value, 10) || 60,
        HEADLESS:               elHeadless.checked,
        startWithWindows:       elStartWin.checked,
    };
}

// ── Test-result box ───────────────────────────────────────────────────────────

function showTestResult(state, msg) {
    elTestResult.className = `${state}`;
    elTestResult.innerHTML = msg;
    // force display (CSS uses display:flex for ok/fail/testing, display:none otherwise)
}

function hideTestResult() {
    elTestResult.className = '';
    elTestResult.innerHTML = '';
}

// ── Load config on open ───────────────────────────────────────────────────────

(async () => {
    const cfg = await api.configGet();

    elApiUrl.value   = cfg.LARAVEL_API_URL || '';
    elApiKey.value   = cfg.API_KEY || '';
    elSlowMo.value   = cfg.SLOW_MO ?? 120;
    elInterval.value = cfg.WATCH_INTERVAL_SECONDS ?? 60;
    elHeadless.checked  = Boolean(cfg.HEADLESS);
    elStartWin.checked  = Boolean(cfg.startWithWindows);

    isFirstRun = !cfg.configured;

    if (isFirstRun) {
        elBanner.style.display = 'block';
        elBtnBack.style.display = 'none';
    }

    markClean(); // ensure dot is hidden after initial population
})();

// ── API key eye toggle ────────────────────────────────────────────────────────

elBtnEye.addEventListener('click', () => {
    const isHidden = elApiKey.type === 'password';
    elApiKey.type  = isHidden ? 'text' : 'password';
    elBtnEye.textContent = isHidden ? '🙈' : '👁';
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
        // Briefly flash the button green for returning users
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

    // Persist current form values before testing
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
        document.getElementById('fg-api-url').classList.add('has-success');
        document.getElementById('fg-api-key').classList.add('has-success');

        // Reveal "Go to Dashboard" after a successful test
        elBtnGo.style.display = 'inline-flex';

        if (isFirstRun) {
            isFirstRun = false;
            elBtnBack.style.display = '';  // reveal back button now
        }
    } else {
        showTestResult('fail', `❌ &nbsp;${escapeHtml(res.error)}`);
        document.getElementById('fg-api-url').classList.remove('has-success');
        document.getElementById('fg-api-key').classList.remove('has-success');
        elBtnGo.style.display = 'none';
    }
});

// ── Navigation ────────────────────────────────────────────────────────────────

elBtnGo.addEventListener('click', () => api.navigate('dashboard'));

elBtnBack.addEventListener('click', () => {
    if (isDirty) {
        if (!confirm('You have unsaved changes. Go back without saving?')) return;
    }
    api.navigate('dashboard');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
