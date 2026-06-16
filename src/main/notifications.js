const { Notification } = require('electron');
const trayManager = require('./tray');

function isSupported() {
    return Notification.isSupported();
}

function show(title, body, { silent = false, urgency } = {}) {
    if (!isSupported()) return;
    try {
        const opts = { title, body, silent };
        // urgency is a Linux-only hint but harmless on other platforms
        if (urgency) opts.urgency = urgency;

        const n = new Notification(opts);

        // Clicking the notification focuses the dashboard
        n.on('click', () => trayManager.showWindow());

        n.show();
        return n;
    } catch {
        // Notifications are best-effort; never crash the app over one
    }
}

// ── Exported notification types ───────────────────────────────────────────────

function notifyRunComplete(successCount, failedCount) {
    if (successCount === 0 && failedCount === 0) return; // nothing posted — stay quiet

    if (failedCount === 0) {
        show(
            'G2G Automation',
            `✅ ${successCount} offer${successCount !== 1 ? 's' : ''} posted successfully`
        );
    } else if (successCount === 0) {
        show(
            'G2G Automation — Run Failed',
            `❌ ${failedCount} template${failedCount !== 1 ? 's' : ''} failed to post`,
            { urgency: 'critical' }
        );
    } else {
        show(
            'G2G Automation — Run Complete',
            `${successCount} posted · ${failedCount} failed`
        );
    }
}

function notifyAuthFailed(email) {
    show(
        'G2G Automation — Auth Error',
        `❌ Login failed for ${email}. Cookies may have expired.`,
        { urgency: 'critical' }
    );
}

function notifyApiError(detail) {
    show(
        'G2G Automation — Connection Error',
        `❌ ${detail || 'Could not reach the API'}`,
        { urgency: 'critical' }
    );
}

function notifyPlaywrightMissing() {
    show(
        'G2G Automation — Setup Required',
        '❌ Chromium browser is not installed. Run: npm run install:browsers',
        { urgency: 'critical' }
    );
}

function notifyWatchStarted(intervalSec) {
    show(
        'G2G Automation',
        `👁 Watch mode active — polling every ${intervalSec}s`,
        { silent: true }
    );
}

function notifyWatchStopped() {
    show('G2G Automation', '⏹ Watch mode stopped', { silent: true });
}

module.exports = {
    notifyRunComplete,
    notifyAuthFailed,
    notifyApiError,
    notifyPlaywrightMissing,
    notifyWatchStarted,
    notifyWatchStopped,
};
