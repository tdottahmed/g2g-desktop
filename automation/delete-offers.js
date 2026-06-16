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

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL    = process.env.G2G_BASE_URL ?? "https://www.g2g.com";
const HEADLESS    = process.env.HEADLESS === "true";
const SLOW_MO     = parseInt(process.env.SLOW_MO ?? "150", 10);
const COOKIES_DIR = path.resolve(process.env.COOKIES_DIR ?? path.join(__dirname, "cookies"));
const WATCH_INTERVAL = parseInt(process.env.WATCH_INTERVAL_SECONDS ?? "60", 10);
mkdirSync(COOKIES_DIR, { recursive: true });

// Accounts category UUID on g2g.com (used to find the correct tab link)
const ACCOUNTS_CAT_ID = "5830014a-b974-45c6-9672-b51e83112fb7";

const args    = process.argv.slice(2);
const API_MODE = args.includes("--api");
const DRY_RUN  = args.includes("--dry-run");
const WATCH    = args.includes("--watch");
const email    = !API_MODE ? args.find((a) => !a.startsWith("--")) : null;

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
    console.log(`   Cookies  : ${cookieFile}`);
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
        // ── Auth ──────────────────────────────────────────────────────────────
        const loggedIn = await ensureLoggedIn(page, context, {
            baseUrl: BASE_URL,
            email,
            password,
            cookieFile,
        });

        if (!loggedIn) {
            console.error("❌  Authentication failed. Exiting.");
            return;
        }

        // ── Delete loop ───────────────────────────────────────────────────────
        const totalDeleted = await deleteAllOffers(page);

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

// ─── Core deletion loop ───────────────────────────────────────────────────────

async function deleteAllOffers(page) {
    let totalDeleted = 0;
    let round = 0;
    let prevRemaining = -1;

    console.log("\n" + "─".repeat(55));

    while (true) {
        round++;
        console.log(`\n🔄  Round ${round}`);

        // ── Step 1: Navigate to offers list ──────────────────────────────────
        console.log("    🌐  Navigating to offers list...");
        await page.goto(`${BASE_URL}/offers/list`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });
        await page.waitForTimeout(3000);

        // ── Step 2: Click the Accounts (live) tab ─────────────────────────────
        const tabClicked = await clickAccountsTab(page);
        if (!tabClicked) {
            console.log("    ⚠️   Could not find Accounts tab — offers may already be gone.");
            break;
        }
        await page.waitForTimeout(2500);

        // ── Check remaining count ──────────────────────────────────────────────
        const remaining = await getRemainingCount(page);
        console.log(`    📊  Offers remaining: ${remaining}`);

        if (remaining === 0) {
            console.log("    ✅  No more offers to delete.");
            break;
        }

        // Guard: no progress between rounds (avoids infinite loop)
        if (remaining === prevRemaining) {
            console.log("    ⚠️   No progress since last round. Stopping.");
            break;
        }
        prevRemaining = remaining;

        if (DRY_RUN) {
            console.log(`    ℹ️   Dry run — would delete ${remaining} offer(s).`);
            break;
        }

        // ── Wait for table rows ───────────────────────────────────────────────
        const hasRows = await waitForTableRows(page);
        if (!hasRows) {
            console.log("    ⚠️   Table rows did not appear. Stopping.");
            break;
        }

        // ── Step 3: Select all ────────────────────────────────────────────────
        const selected = await clickSelectAll(page);
        if (!selected) {
            console.log("    ❌  Select-all failed. Stopping.");
            break;
        }
        await page.waitForTimeout(1000);

        // ── Step 4: Click delete button ───────────────────────────────────────
        const deleteClicked = await clickDeleteButton(page);
        if (!deleteClicked) {
            console.log("    ❌  Delete button not found. Stopping.");
            break;
        }
        await page.waitForTimeout(1000);

        // ── Step 5: Confirm deletion ──────────────────────────────────────────
        const confirmed = await confirmDeletion(page);
        if (!confirmed) {
            console.log("    ❌  Confirm dialog failed. Stopping.");
            break;
        }

        // Wait for the UI to process the deletion
        await page.waitForTimeout(3500);

        const after = await getRemainingCount(page).catch(() => 0);
        const deleted = remaining - after;
        totalDeleted += Math.max(deleted, 0);
        console.log(`    🗑️   Deleted ~${deleted} offer(s) this round (${after} remaining)`);

        if (after === 0) {
            console.log("    ✅  All offers deleted.");
            break;
        }
    }

    return totalDeleted;
}

// ─── Step helpers ─────────────────────────────────────────────────────────────

async function clickAccountsTab(page) {
    // Try the specific cat_id link first
    const link = page.locator(`a[href*="cat_id=${ACCOUNTS_CAT_ID}"]`).first();

    if ((await link.count()) > 0) {
        await link.scrollIntoViewIfNeeded();
        await link.click();
        return true;
    }

    // Fallback: any visible link / button that says "Accounts"
    const fallback = page.locator("a:has-text('Accounts'), button:has-text('Accounts')").first();
    if ((await fallback.count()) > 0) {
        await fallback.scrollIntoViewIfNeeded();
        await fallback.click();
        return true;
    }

    return false;
}

async function getRemainingCount(page) {
    try {
        // Read the count from the active Accounts tab label, e.g. "Accounts (38)"
        const link = page.locator(`a[href*="cat_id=${ACCOUNTS_CAT_ID}"]`).first();
        if ((await link.count()) === 0) return 0;

        const text  = await link.innerText({ timeout: 5000 });
        const match = text.match(/\((\d+)\)/);
        return match ? parseInt(match[1], 10) : 0;
    } catch {
        return 0;
    }
}

async function waitForTableRows(page) {
    try {
        await page.waitForSelector(".q-table tbody tr, table tbody tr", {
            state: "attached",
            timeout: 12000,
        });
        return true;
    } catch {
        return false;
    }
}

async function clickSelectAll(page) {
    try {
        // The select-all is a Quasar q-checkbox in the <th> of the table header
        const checkbox = page.locator("th div[role='checkbox'], th .q-checkbox").first();
        await checkbox.waitFor({ state: "visible", timeout: 10000 });

        const checked = await checkbox.getAttribute("aria-checked");
        if (checked === "true") {
            console.log("    ℹ️   Checkbox already checked — all rows selected");
            return true;
        }

        await checkbox.click({ force: true });
        await page.waitForTimeout(600);
        console.log("    ✅  Selected all visible offers");
        return true;
    } catch (err) {
        console.log(`    ❌  Select-all error: ${err.message}`);
        return false;
    }
}

async function clickDeleteButton(page) {
    try {
        // The fixed bottom action bar appears after selection; delete button has text-negative class
        await page.waitForSelector(
            "button.text-negative, button:has(.material-icons:text('delete'))",
            { state: "visible", timeout: 10000 }
        );

        const btn = page.locator(
            "button.text-negative, button:has(.material-icons:text('delete'))"
        ).first();

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
        // Quasar dialog appears with a "Confirm" button
        const dialog = page.locator(".q-dialog__inner .q-card");
        await dialog.waitFor({ state: "visible", timeout: 10000 });

        const confirmBtn = dialog.locator("button:has-text('Confirm')").first();
        if ((await confirmBtn.count()) === 0) {
            console.log("    ❌  Confirm button not found in dialog");
            return false;
        }

        await confirmBtn.click({ force: true });
        console.log("    ✅  Confirmed — deletion in progress...");

        // Wait for dialog to close before next round
        await dialog.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
        return true;
    } catch (err) {
        console.log(`    ❌  Confirm dialog error: ${err.message}`);
        return false;
    }
}

// ─── API mode (driven by admin panel queue_delete_all flag) ──────────────────

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
    console.log(`\n[${new Date().toLocaleTimeString()}] Fetching pending delete-all accounts...`);

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
    const { user_id, email: acctEmail, password } = user;
    const emailPrefix = acctEmail.split("@")[0];
    const cookieFile  = path.join(COOKIES_DIR, `${emailPrefix}.json`);

    console.log(`\n👤 Processing: ${acctEmail}`);

    let browser = null;
    try {
        browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO, args: ["--start-maximized"] })
            .catch((err) => {
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

        const totalDeleted = await deleteAllOffers(page);

        if (DRY_RUN) {
            console.log(`\n   ℹ️  Dry run — no offers deleted.`);
        } else {
            console.log(`\n   ✅ Deleted ${totalDeleted} offer(s)`);
            await reportDeleteAllComplete(user_id, { deleted_count: totalDeleted, runner_host: process.env.HOSTNAME ?? "local" });
        }

        // Persist any refreshed session tokens back to disk
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
