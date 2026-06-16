/**
 * HTTP client for the Laravel automation API.
 * Reads LARAVEL_API_URL and API_KEY from environment.
 */

const BASE_URL = (process.env.LARAVEL_API_URL ?? "").replace(/\/$/, "");
const API_KEY  = process.env.API_KEY ?? "";

if (!BASE_URL || !API_KEY) {
    throw new Error(
        "LARAVEL_API_URL and API_KEY must be set in your .env file."
    );
}

async function request(method, path, body = null) {
    const url  = `${BASE_URL}/api${path}`;
    const opts = {
        method,
        headers: {
            "Content-Type": "application/json",
            "Accept":        "application/json",
            "X-Api-Key":     API_KEY,
        },
    };

    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${method} ${url} → ${res.status}: ${text}`);
    }

    return res.json();
}

/** Check connectivity and auth. */
export async function heartbeat() {
    return request("GET", "/automation/heartbeat");
}

/**
 * Fetch users and their templates that are ready to be posted now.
 * @returns {{ users: Array, schedule_interval_minutes: number, server_time: string }}
 */
export async function fetchPending() {
    return request("GET", "/automation/pending");
}

/**
 * Report a successful posting for one template.
 * @param {number} templateId
 * @param {object} details  - arbitrary execution metadata to store in logs
 */
export async function reportSuccess(templateId, details = {}) {
    return request("POST", `/automation/${templateId}/success`, { details });
}

/**
 * Report a failed posting for one template.
 * @param {number} templateId
 * @param {string} error
 * @param {object} details
 */
export async function reportFailed(templateId, error, details = {}) {
    return request("POST", `/automation/${templateId}/failed`, { error, details });
}

/**
 * Fetch users and their templates that are queued for deletion from g2g.com.
 * @returns {{ users: Array, server_time: string }}
 */
export async function fetchPendingDeletions() {
    return request("GET", "/automation/pending-deletions");
}

/**
 * Report that a specific offer was successfully deleted from g2g.com.
 * Clears queue_delete and deactivates the template in Laravel.
 * @param {number} templateId
 * @param {object} details
 */
export async function reportDeleteSuccess(templateId, details = {}) {
    return request("POST", `/automation/${templateId}/delete-success`, { details });
}

/**
 * Report that a specific offer deletion failed.
 * @param {number} templateId
 * @param {string} error
 * @param {object} details
 */
export async function reportDeleteFailed(templateId, error, details = {}) {
    return request("POST", `/automation/${templateId}/delete-failed`, { error, details });
}

/**
 * Fetch user accounts queued for delete-all (delete every live offer from g2g.com).
 * @returns {{ users: Array<{user_id, email, password}>, server_time: string }}
 */
export async function fetchPendingDeleteAll() {
    return request("GET", "/automation/pending-delete-all");
}

/**
 * Report that delete-all completed successfully for one account.
 * Clears the queue_delete_all flag in Laravel.
 * @param {number} userAccountId
 * @param {object} details
 */
export async function reportDeleteAllComplete(userAccountId, details = {}) {
    return request("POST", `/automation/user-accounts/${userAccountId}/delete-all-complete`, { details });
}

/**
 * Report that delete-all failed for one account.
 * @param {number} userAccountId
 * @param {string} error
 */
export async function reportDeleteAllFailed(userAccountId, error) {
    return request("POST", `/automation/user-accounts/${userAccountId}/delete-all-failed`, { error });
}
