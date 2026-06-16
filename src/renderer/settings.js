const api = window.electronAPI;

const toast    = document.getElementById('toast');
const btnSave  = document.getElementById('btn-save');
const btnTest  = document.getElementById('btn-test');
const btnBack  = document.getElementById('btn-back');

function showToast(msg, type = 'success') {
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    toast.style.display = 'inline-block';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ── Load saved config ─────────────────────────────────────────────────────────

(async () => {
    const cfg = await api.configGet();
    document.getElementById('api-url').value           = cfg.LARAVEL_API_URL || '';
    document.getElementById('api-key').value           = cfg.API_KEY || '';
    document.getElementById('slow-mo').value           = cfg.SLOW_MO ?? 120;
    document.getElementById('watch-interval').value    = cfg.WATCH_INTERVAL_SECONDS ?? 60;
    document.getElementById('headless').checked        = Boolean(cfg.HEADLESS);
    document.getElementById('start-with-windows').checked = Boolean(cfg.startWithWindows);
})();

// ── Save ──────────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
    const data = {
        LARAVEL_API_URL: document.getElementById('api-url').value.trim(),
        API_KEY: document.getElementById('api-key').value.trim(),
        SLOW_MO: parseInt(document.getElementById('slow-mo').value, 10) || 120,
        WATCH_INTERVAL_SECONDS: parseInt(document.getElementById('watch-interval').value, 10) || 60,
        HEADLESS: document.getElementById('headless').checked,
        startWithWindows: document.getElementById('start-with-windows').checked,
    };

    if (!data.LARAVEL_API_URL || !data.API_KEY) {
        showToast('API URL and API Key are required.', 'error');
        return;
    }

    await api.configSet(data);
    showToast('✅ Settings saved.');
});

// ── Test connection ───────────────────────────────────────────────────────────

btnTest.addEventListener('click', async () => {
    // Save first so the test uses the current form values
    const data = {
        LARAVEL_API_URL: document.getElementById('api-url').value.trim(),
        API_KEY: document.getElementById('api-key').value.trim(),
        SLOW_MO: parseInt(document.getElementById('slow-mo').value, 10) || 120,
        WATCH_INTERVAL_SECONDS: parseInt(document.getElementById('watch-interval').value, 10) || 60,
        HEADLESS: document.getElementById('headless').checked,
        startWithWindows: document.getElementById('start-with-windows').checked,
    };
    await api.configSet(data);

    btnTest.disabled = true;
    btnTest.textContent = 'Testing…';
    const res = await api.configTest();
    btnTest.disabled = false;
    btnTest.textContent = 'Test Connection';

    if (res.success) {
        showToast('✅ Connection successful!');
    } else {
        showToast(`❌ ${res.error}`, 'error');
    }
});

// ── Back ──────────────────────────────────────────────────────────────────────

btnBack.addEventListener('click', () => api.navigate('dashboard'));
