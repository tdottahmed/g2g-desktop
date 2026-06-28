/**
 * delete-offers.js — Delete all live Accounts offers for a g2g.com account.
 *
 * Standalone mode (manual):
 *   node delete-offers.js <email>
 *   node delete-offers.js <email> --dry-run
 *
 * API mode (driven by admin panel):
 *   node delete-offers.js --api           — run once against API queue
 *   node delete-offers.js --api --watch   — poll API every WATCH_INTERVAL_SECONDS
 *   node delete-offers.js --api --dry-run — same but don't actually delete
 *
 * Reads COOKIES_DIR, HEADLESS, SLOW_MO, G2G_BASE_URL (and LARAVEL_API_URL +
 * API_KEY for --api mode) from .env
 */

import "./env-loader.js";
import path from "path";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { ensureLoggedIn, saveAuthState } from "./utils/auth.js";
import {
    fetchPendingDeleteAll,
    reportDeleteAllComplete,
    reportDeleteAllFailed,
} from "./api-client.js";

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL       = process.env.G2G_BASE_URL ?? "https://www.g2g.com";
const HEADLESS       = process.env.HEADLESS === "true";
const SLOW_MO        = parseInt(process.env.SLOW_MO ?? "150", 10);
const COOKIES_DIR    = path.resolve(process.env.COOKIES_DIR ?? path.join(__dirname, "cookies"));
const WATCH_INTERVAL = parseInt(process.env.WATCH_INTERVAL_SECONDS ?? "60", 10);
mkdirSync(COOKIES_DIR, { recursive: true });

// Accounts category UUID on g2g.com
const ACCOUNTS_CAT_ID = "5830014a-b974-45c6-9672-b51e83112fb7";

// Tab selector variants — g2g.com sometimes changes which element carries the link
const TAB_SELECTORS = [
    `a[href*="cat_id=${ACCOUNTS_CAT_ID}"]`,
    `a:has-text('Accounts')`,
    `button:has-text('Accounts')`,
    `.q-tab:has-text('Accounts')`,
];

const args     = process.argv.slice(2);
const API_MODE = args.includes("--api");
const DRY_RUN  = args.includes("--dry-run");
const WATCH    = args.includes("--watch");
const email    = !API_MODE ? args.find((a) => !a.startsWith("--")) : null;

// ─── Timing helpers ────────────────────────────────────────────────────────────

function ts() {
    return new Date().toLocaleTimeString();
}

function elapsed(start) {
    return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
    if (API_MODE) {
        await runApiMode();
        return;
    }

    if (!email) {
        console.error("❌  Usage:");
        console.error("    node delete-offers.js <email> [--dry-run]");
        console.error("    node delete-offers.js --api [--watch] [--dry-run]");
        process.exit(1);
    }

    const emailPrefix = email.split("@")[0];
    const cookieFile  = path.join(COOKIES_DIR, `${emailPrefix}.json`);
    const password    = process.env[`G2G_PASS_${emailPrefix.toUpperCase()}`]
                     ?? process.env.G2G_PASSWORD
                     ?? "";

    console.log("🗑️  G2G Offer Deleter");
    console.log(`   Account  : ${email}`);
    console.log(`   Headless : ${HEADLESS}`);
    if (DRY_RUN) console.log("   Mode     : DRY RUN (nothing will be deleted)\n");

    const browser = await chromium.launch({
        headless: HEADLESS,
        slowMo: SLOW_MO,
        args: ["--start-maximized"],
    }).catch((err) => {
        if (err.message.includes("Executable doesn't exist")) {
            console.error("\n❌  Playwright browser not installed. Run:\n");
            console.error("      npx playwright install chromium\n");
            process.exit(1);
        }
        throw err;
    });

    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page    = await context.newPage();

    try {
        const loggedIn = await ensureLoggedIn(page, context, { baseUrl: BASE_URL, email, password, cookieFile });
        if (!loggedIn) {
            console.error("❌  Authentication failed. Exiting.");
            return;
        }

        const totalDeleted = await deleteAllOffers(page, []);

        if (DRY_RUN) {
            console.log("\n✅  Dry run complete — no offers were deleted.");
        } else {
            console.log(`\n✅  Done! Removed ${totalDeleted} offer(s) for ${email}`);
        }
    } catch (err) {
        console.error("\n❌  Fatal error:", err.message);
    } finally {
        await browser.close().catch(() => {});
    }
}

// ─── Core deletion loop ────────────────────────────────────────────────────────

/**
 * Delete all offers on the Accounts tab, optionally skipping permanent ones.
 * @param {import('playwright').Page} page
 * @param {string[]} permanentTitles  — titles of offers that must NOT be deleted
 */
async function deleteAllOffers(page, permanentTitles = []) {
    const hasPermanent = permanentTitles.length > 0;
    const permanentSet = new Set(
        permanentTitles.map((t) => t.toLowerCase().trim().substring(0, 50))
    );

    if (hasPermanent) {
        console.log(`\n    🛡️  Protected titles (${permanentTitles.length}):`);
        permanentTitles.forEach((t) => console.log(`          • ${t}`));
    }

    let totalDeleted  = 0;
    let round         = 0;
    let prevRemaining = -1;

    console.log("\n" + "─".repeat(60));

    while (true) {
        round++;
        const roundStart = Date.now();
        console.log(`\n🔄  Round ${round}  [${ts()}]`);

        // ── Step 1: Navigate ──────────────────────────────────────────────────
        const navOk = await navigateToOffersList(page);
        if (!navOk) {
            console.log("    ❌  Page failed to load. Stopping.");
            break;
        }

        // ── Step 2: Click the Accounts tab ───────────────────────────────────
        const tabClicked = await clickAccountsTab(page);
        if (!tabClicked) {
            console.log("    ⚠️   Accounts tab not found — all offers may already be gone.");
            break;
        }

        // ── Step 3: Wait for tab content and read count ───────────────────────
        const remaining = await waitForCountAndRead(page);
        console.log(`    📊  Offers remaining: ${remaining}`);

        if (remaining === 0) {
            console.log("    ✅  No more offers to delete.");
            break;
        }
        if (hasPermanent && remaining <= permanentTitles.length) {
            console.log(`    ✅  Remaining ${remaining} offer(s) are all permanent — done.`);
            break;
        }
        if (remaining === prevRemaining) {
            console.log("    ⚠️   No progress since last round. Stopping.");
            break;
        }
        prevRemaining = remaining;

        if (DRY_RUN) {
            console.log(`    ℹ️   Dry run — would delete up to ${remaining - permanentTitles.length} offer(s).`);
            break;
        }

        // ── Step 4: Wait for table rows ───────────────────────────────────────
        const hasRows = await waitForTableRows(page);
        if (!hasRows) {
            console.log("    ⚠️   Table rows did not appear. Stopping.");
            break;
        }

        // ── Step 5: Select rows ───────────────────────────────────────────────
        let selectedCount;
        if (hasPermanent) {
            selectedCount = await selectNonPermanentRows(page, permanentSet);
        } else {
            selectedCount = (await clickSelectAll(page)) ? -1 : 0;
        }

        if (selectedCount === 0) {
            console.log("    ⚠️   No rows selected — visible rows may all be permanent.");
            break;
        }

        // Small pause for Quasar to register the selection before the action bar appears
        await page.waitForTimeout(400);

        // ── Step 6: Click delete button ───────────────────────────────────────
        const deleteClicked = await clickDeleteButton(page);
        if (!deleteClicked) {
            console.log("    ❌  Delete button not found. Stopping.");
            break;
        }

        // ── Step 7: Confirm deletion ──────────────────────────────────────────
        const confirmed = await confirmDeletion(page);
        if (!confirmed) {
            console.log("    ❌  Confirm dialog failed. Stopping.");
            break;
        }

        // ── Step 8: Wait for deletion to process ──────────────────────────────
        const after = await waitForCountToChange(page, remaining);
        const deleted = Math.max(remaining - after, 0);
        totalDeleted += deleted;
        console.log(`    🗑️   Deleted ~${deleted} offer(s) this round (${after} remaining) [${elapsed(roundStart)}]`);

        if (after === 0 || (hasPermanent && after <= permanentTitles.length)) {
            console.log("    ✅  All deletable offers removed.");
            break;
        }
    }

    return totalDeleted;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

/**
 * Navigate to the offers list page and wait for the Quasar SPA to hydrate.
 * Returns true when the page is interactive, false on timeout.
 */
async function navigateToOffersList(page) {
    console.log("    🌐  Navigating to offers list...");
    const t0 = Date.now();

    try {
        await page.goto(`${BASE_URL}/offers/list`, {
            waitUntil: "load",
            timeout: 45000,
        });
    } catch (err) {
        console.log(`    ⚠️   Navigation error: ${err.message}`);
        return false;
    }

    // Wait for the Quasar tab bar to render (SPA hydration)
    try {
        await page.waitForSelector(
            TAB_SELECTORS.join(", "),
            { state: "attached", timeout: 25000 }
        );
        console.log(`    ✅  Page ready [${elapsed(t0)}]`);
        return true;
    } catch {
        console.log(`    ⚠️   Tab bar did not appear after 25s [${elapsed(t0)}]`);
        return false;
    }
}

// ─── Tab interaction ──────────────────────────────────────────────────────────

/**
 * Click the Accounts tab. Retries up to 3× with increasing back-off.
 */
async function clickAccountsTab(page) {
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`    🔍  Locating Accounts tab (attempt ${attempt}/${MAX_RETRIES})...`);

        // Wait for any of the known selectors to be visible
        const combinedSelector = TAB_SELECTORS.join(", ");
        try {
            await page.waitForSelector(combinedSelector, {
                state: "visible",
                timeout: 15000,
            });
        } catch {
            console.log(`    ⚠️   Accounts tab not visible yet (attempt ${attempt})`);
            if (attempt < MAX_RETRIES) {
                await page.waitForTimeout(2000 * attempt);
                // Reload page on second retry in case the SPA got stuck
                if (attempt === 2) await page.reload({ waitUntil: "load", timeout: 30000 }).catch(() => {});
            }
            continue;
        }

        // Prefer the cat_id link (exact match), fall back through the selector list
        for (const sel of TAB_SELECTORS) {
            const el = page.locator(sel).first();
            if ((await el.count()) === 0) continue;

            try {
                await el.scrollIntoViewIfNeeded();
                await el.click({ timeout: 5000 });
                console.log(`    ✅  Clicked Accounts tab`);
                return true;
            } catch (err) {
                console.log(`    ⚠️   Click failed on "${sel}": ${err.message}`);
            }
        }

        if (attempt < MAX_RETRIES) await page.waitForTimeout(1500 * attempt);
    }

    return false;
}

// ─── Count reading ─────────────────────────────────────────────────────────────

/**
 * After clicking the tab, wait for the count badge to stabilise then return it.
 * Falls back to 0 if the badge never appears (no offers).
 */
async function waitForCountAndRead(page) {
    const link = page.locator(`a[href*="cat_id=${ACCOUNTS_CAT_ID}"]`).first();

    // Wait up to 12s for the count "(N)" to appear inside the tab label
    try {
        await page.waitForFunction(
            (sel) => {
                const el = document.querySelector(sel);
                return el && /\(\d+\)/.test(el.textContent ?? "");
            },
            `a[href*="cat_id=${ACCOUNTS_CAT_ID}"]`,
            { timeout: 12000 }
        );
    } catch {
        // Count badge may not appear if there are zero offers — that's fine
    }

    try {
        if ((await link.count()) === 0) return 0;
        const text  = await link.innerText({ timeout: 5000 });
        const match = text.match(/\((\d+)\)/);
        return match ? parseInt(match[1], 10) : 0;
    } catch {
        return 0;
    }
}

/**
 * After confirming a deletion, poll the count badge until it drops below
 * `previousCount` or the timeout elapses, then return the new value.
 */
async function waitForCountToChange(page, previousCount) {
    const link = page.locator(`a[href*="cat_id=${ACCOUNTS_CAT_ID}"]`).first();

    try {
        await page.waitForFunction(
            ({ sel, prev }) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                const m = (el.textContent ?? "").match(/\((\d+)\)/);
                return m ? parseInt(m[1], 10) < prev : false;
            },
            { sel: `a[href*="cat_id=${ACCOUNTS_CAT_ID}"]`, prev: previousCount },
            { timeout: 20000 }
        );
    } catch {
        // Count didn't change within 20s — read whatever is there now
    }

    try {
        if ((await link.count()) === 0) return 0;
        const text  = await link.innerText({ timeout: 5000 });
        const match = text.match(/\((\d+)\)/);
        return match ? parseInt(match[1], 10) : 0;
    } catch {
        return 0;
    }
}

// ─── Row helpers ──────────────────────────────────────────────────────────────

async function waitForTableRows(page) {
    try {
        await page.waitForSelector(".q-table tbody tr, table tbody tr", {
            state: "attached",
            timeout: 15000,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * Select every visible row whose title is NOT in permanentSet.
 */
async function selectNonPermanentRows(page, permanentSet) {
    const rows  = page.locator(".q-table tbody tr");
    const count = await rows.count();
    let selected = 0;

    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);

        let rowTitle = "";
        try {
            rowTitle = (
                await row.locator("td:nth-child(2) .text-body1 span").first().innerText({ timeout: 3000 })
            ).toLowerCase().trim().substring(0, 50);
        } catch {
            try {
                rowTitle = (await row.innerText({ timeout: 3000 })).toLowerCase().trim().substring(0, 50);
            } catch {
                continue;
            }
        }

        if (permanentSet.has(rowTitle)) {
            console.log(`    🛡️   Skipping permanent: "${rowTitle}"`);
            continue;
        }

        const checkbox = row.locator("td div[role='checkbox'], td .q-checkbox").first();
        try {
            if ((await checkbox.count()) > 0) {
                const checked = await checkbox.getAttribute("aria-checked").catch(() => "false");
                if (checked !== "true") await checkbox.click({ force: true });
            } else {
                await row.click({ force: true });
            }
            selected++;
            // Small gap between clicks so Quasar can register each selection
            await page.waitForTimeout(120);
        } catch (err) {
            console.log(`    ⚠️   Could not select row: ${err.message}`);
        }
    }

    if (selected > 0) console.log(`    ✅  Selected ${selected} deletable row(s)`);
    return selected;
}

async function clickSelectAll(page) {
    try {
        const checkbox = page.locator("th div[role='checkbox'], th .q-checkbox").first();
        await checkbox.waitFor({ state: "visible", timeout: 10000 });

        const checked = await checkbox.getAttribute("aria-checked");
        if (checked === "true") {
            console.log("    ℹ️   Select-all already checked");
            return true;
        }

        await checkbox.click({ force: true });

        // Wait for at least one row to become selected before returning
        await page.waitForFunction(
            () => document.querySelector("td div[aria-checked='true'], td .q-checkbox[aria-checked='true']") !== null,
            { timeout: 5000 }
        ).catch(() => {});

        console.log("    ✅  Selected all visible offers");
        return true;
    } catch (err) {
        console.log(`    ❌  Select-all error: ${err.message}`);
        return false;
    }
}

// ─── Delete / confirm ─────────────────────────────────────────────────────────

async function clickDeleteButton(page) {
    // The Quasar action bar appears at the bottom once rows are selected
    const SELECTORS = [
        "button.text-negative",
        "button:has(.material-icons:text('delete'))",
        "button:has-text('Delete')",
    ];

    try {
        await page.waitForSelector(SELECTORS.join(", "), {
            state: "visible",
            timeout: 12000,
        });

        const btn = page.locator(SELECTORS.join(", ")).first();
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ force: true });
        console.log("    🖱️   Clicked delete button");
        return true;
    } catch (err) {
        console.log(`    ❌  Delete button error: ${err.message}`);
        return false;
    }
}

async function confirmDeletion(page) {
    try {
        // Wait for the Quasar confirm dialog
        const dialog = page.locator(".q-dialog__inner .q-card");
        await dialog.waitFor({ state: "visible", timeout: 12000 });

        const confirmBtn = dialog.locator("button:has-text('Confirm')").first();
        if ((await confirmBtn.count()) === 0) {
            console.log("    ❌  Confirm button not found in dialog");
            return false;
        }

        await confirmBtn.click({ force: true });
        console.log("    ✅  Confirmed — waiting for deletion to complete...");

        // Wait for the dialog to close (deletion is processing)
        await dialog.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
        return true;
    } catch (err) {
        console.log(`    ❌  Confirm dialog error: ${err.message}`);
        return false;
    }
}

// ─── API mode ─────────────────────────────────────────────────────────────────

async function runApiMode() {
    console.log("🗑️  G2G Delete-All Runner (API mode)");
    console.log(`   API URL  : ${process.env.LARAVEL_API_URL}`);
    console.log(`   Headless : ${HEADLESS}`);
    if (DRY_RUN) console.log("   Mode     : DRY RUN");

    if (WATCH) {
        console.log(`\n👀 Watch mode — polling every ${WATCH_INTERVAL}s\n`);
        while (true) {
            await runApiOnce();
            console.log(`\n⏳ Next check in ${WATCH_INTERVAL}s...`);
            await new Promise((r) => setTimeout(r, WATCH_INTERVAL * 1000));
        }
    } else {
        await runApiOnce();
    }
}

async function runApiOnce() {
    console.log(`\n[${ts()}] Fetching pending delete-all accounts...`);

    let data;
    try {
        data = await fetchPendingDeleteAll();
    } catch (err) {
        console.error("❌ Failed to fetch pending delete-all:", err.message);
        return;
    }

    const { users = [] } = data;
    if (users.length === 0) {
        console.log("ℹ️  No accounts queued for delete-all.");
        return;
    }

    console.log(`📋 Found ${users.length} account(s) to delete-all`);

    for (const user of users) {
        await runApiUserDelete(user);
    }

    console.log("\n✅ Run complete.");
}

async function runApiUserDelete(user) {
    const { user_id, email: acctEmail, password, permanent_titles: permanentTitles = [], queue_delete_game: deleteGame = null } = user;
    const emailPrefix = acctEmail.split("@")[0];
    const cookieFile  = path.join(COOKIES_DIR, `${emailPrefix}.json`);

    console.log(`\n👤 Processing: ${acctEmail}`);
    if (deleteGame) {
        console.log(`   🎮  Game filter: ${deleteGame} (only this game's non-permanent offers will be deleted)`);
    }
    if (permanentTitles.length > 0) {
        console.log(`   🛡️  ${permanentTitles.length} offer(s) will be skipped (permanent + other games)`);
    }

    let browser = null;
    try {
        browser = await chromium.launch({
            headless: HEADLESS,
            slowMo: SLOW_MO,
            args: ["--start-maximized"],
        }).catch((err) => {
            if (err.message.includes("Executable doesn't exist")) {
                console.error("\n❌ Playwright not installed. Run: npx playwright install chromium");
                process.exit(1);
            }
            throw err;
        });

        const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
        const page    = await context.newPage();

        const loggedIn = await ensureLoggedIn(page, context, {
            baseUrl: BASE_URL, email: acctEmail, password, cookieFile,
        });

        if (!loggedIn) {
            console.error(`❌ Auth failed for ${acctEmail}`);
            await reportDeleteAllFailed(user_id, "Authentication failed").catch(() => {});
            return;
        }

        const totalDeleted = await deleteAllOffers(page, permanentTitles);

        if (DRY_RUN) {
            console.log(`\n   ℹ️  Dry run — no offers deleted.`);
        } else {
            console.log(`\n   ✅ Deleted ${totalDeleted} offer(s)`);
            await reportDeleteAllComplete(user_id, {
                deleted_count:   totalDeleted,
                permanent_count: permanentTitles.length,
                runner_host:     process.env.HOSTNAME ?? "local",
            });
        }

        await saveAuthState(context, cookieFile).catch(() => {});
    } catch (err) {
        console.error(`❌ Fatal error for ${acctEmail}:`, err.message);
        await reportDeleteAllFailed(user_id, err.message).catch(() => {});
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
    console.error("❌  Unhandled error:", err.message);
    process.exit(1);
});
