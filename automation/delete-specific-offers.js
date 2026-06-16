/**
 * delete-specific-offers.js — Delete specific g2g.com offers by title.
 *
 * Fetches templates marked with `queue_delete = true` from the Laravel API,
 * finds each matching offer by title in the g2g.com offers list, selects it,
 * and deletes it. Reports success/failure back to the API so the queue_delete
 * flag is cleared automatically.
 *
 * Usage:
 *   node delete-specific-offers.js              — run once and exit
 *   node delete-specific-offers.js --watch       — poll every WATCH_INTERVAL_SECONDS
 *   node delete-specific-offers.js --status      — connectivity check only
 *   node delete-specific-offers.js --dry-run     — navigate and select but don't delete
 */

import "./env-loader.js";
import path from "path";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import {
    fetchPendingDeletions,
    reportDeleteSuccess,
    reportDeleteFailed,
    heartbeat,
} from "./api-client.js";
import { ensureLoggedIn, saveAuthState } from "./utils/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL    = process.env.G2G_BASE_URL ?? "https://www.g2g.com";
const HEADLESS    = process.env.HEADLESS === "true";
const SLOW_MO     = parseInt(process.env.SLOW_MO ?? "150", 10);
const COOKIES_DIR = path.resolve(process.env.COOKIES_DIR ?? path.join(__dirname, "cookies"));
const WATCH_INTERVAL = parseInt(process.env.WATCH_INTERVAL_SECONDS ?? "60", 10);
mkdirSync(COOKIES_DIR, { recursive: true });

const ACCOUNTS_CAT_ID = "5830014a-b974-45c6-9672-b51e83112fb7";

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MODE    = args.includes("--watch")  ? "watch"
              : args.includes("--status") ? "status"
              :                              "run";

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
    console.log("🗑️  g2g Specific Offer Deleter");
    console.log(`   Mode     : ${MODE}${DRY_RUN ? " (DRY RUN)" : ""}`);
    console.log(`   API URL  : ${process.env.LARAVEL_API_URL}`);
    console.log(`   Headless : ${HEADLESS}`);

    if (MODE === "status") {
        try {
            const result = await heartbeat();
            console.log("✅ API reachable:", result);
            process.exit(0);
        } catch (err) {
            console.error("❌ API unreachable:", err.message);
            process.exit(1);
        }
    }

    if (MODE === "watch") {
        console.log(`\n👀 Watch mode — polling every ${WATCH_INTERVAL}s\n`);
        while (true) {
            await runOnce();
            console.log(`\n⏳ Next check in ${WATCH_INTERVAL}s...`);
            await delay(WATCH_INTERVAL * 1000);
        }
    } else {
        await runOnce();
    }
}

async function runOnce() {
    console.log(`\n[${new Date().toLocaleTimeString()}] Fetching pending deletions...`);

    let data;
    try {
        data = await fetchPendingDeletions();
    } catch (err) {
        console.error("❌ Failed to fetch pending deletions:", err.message);
        return;
    }

    const { users = [] } = data;
    const totalTemplates  = users.reduce((s, u) => s + u.templates.length, 0);

    if (totalTemplates === 0) {
        console.log("ℹ️  No pending deletions.");
        return;
    }

    console.log(`📋 Found ${totalTemplates} deletion(s) across ${users.length} account(s)`);

    for (const userGroup of users) {
        await processUserGroup(userGroup);
    }

    console.log("\n✅ Run complete.");
}

// ─── Per-user processing ──────────────────────────────────────────────────────

async function processUserGroup(userGroup) {
    const { email, password, templates } = userGroup;
    const emailPrefix = email.split("@")[0];
    const cookieFile  = path.join(COOKIES_DIR, `${emailPrefix}.json`);

    console.log(`\n👤 Processing: ${email} (${templates.length} deletion(s))`);

    let browser = null;
    let context  = null;

    try {
        browser = await chromium.launch({
            headless: HEADLESS,
            slowMo: SLOW_MO,
            args: ["--start-maximized"],
        }).catch((err) => {
            if (err.message.includes("Executable doesn't exist")) {
                console.error("\n❌ Playwright browser not installed. Run:\n");
                console.error("      npx playwright install chromium\n");
                process.exit(1);
            }
            throw err;
        });

        context    = await browser.newContext({ viewport: { width: 1600, height: 900 } });
        const page = await context.newPage();

        // ── Auth ─────────────────────────────────────────────────────────────
        const loggedIn = await ensureLoggedIn(page, context, {
            baseUrl: BASE_URL,
            email,
            password,
            cookieFile,
        });

        if (!loggedIn) {
            console.error(`❌ Auth failed for ${email}`);
            for (const t of templates) {
                await reportDeleteFailed(t.template_id, "Authentication failed", { email }).catch(() => {});
            }
            return;
        }

        // ── Delete each template's offer ──────────────────────────────────────
        for (const template of templates) {
            const { template_id, Title, price } = template;
            console.log(`\n   🔄 Deleting: "${Title}" @ ${price} (id=${template_id})`);

            try {
                const deleted = await deleteOfferByTitle(page, Title, price);

                if (deleted) {
                    await reportDeleteSuccess(template_id, {
                        template_title: Title,
                        runner_host: process.env.HOSTNAME ?? "local",
                        dry_run: DRY_RUN,
                    });
                    console.log(`   ✅ Reported delete-success for template ${template_id}`);
                } else {
                    // Offer not found on g2g — might already be gone
                    console.log(`   ⚠️  Offer not found on g2g (may already be deleted). Clearing queue.`);
                    await reportDeleteSuccess(template_id, {
                        template_title: Title,
                        note: "offer not found on g2g — assumed already deleted",
                    });
                }
            } catch (err) {
                console.error(`   ❌ Failed to delete "${Title}":`, err.message);
                await reportDeleteFailed(template_id, err.message, { template_title: Title }).catch(() => {});
            }
        }

        // Persist any refreshed session tokens back to disk
        await saveAuthState(context, cookieFile).catch(() => {});
    } catch (err) {
        console.error(`❌ Fatal error for ${email}:`, err.message);
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// ─── Core: find + delete a specific offer by title ───────────────────────────

/**
 * Navigate to the g2g offers list, find the row matching `title` and `price`,
 * select it, then delete it. Returns true if deleted (or not found), false on failure.
 */
async function deleteOfferByTitle(page, title, price) {
    // Navigate to offers list
    await page.goto(`${BASE_URL}/offers/list`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click the Accounts tab
    const tabClicked = await clickAccountsTab(page);
    if (!tabClicked) {
        throw new Error("Could not click Accounts tab");
    }
    await page.waitForTimeout(2000);

    // Wait for table to load
    const hasRows = await waitForTableRows(page);
    if (!hasRows) {
        console.log(`   ℹ️  No rows visible in table — offer may be gone already`);
        return true; // treated as "not found → already gone"
    }

    // Try to find and select the matching row across all visible pages
    let selected = false;
    let rounds   = 0;

    while (!selected && rounds < 10) {
        rounds++;
        selected = await selectRowByTitleAndPrice(page, title, price);

        if (selected) break;

        // Try next page if pagination exists
        const nextPage = await clickNextPage(page);
        if (!nextPage) break; // no more pages
        await page.waitForTimeout(2000);
    }

    if (!selected) {
        return false; // not found on g2g
    }

    if (DRY_RUN) {
        console.log(`   ℹ️  Dry run — would delete "${title}"`);
        return true;
    }

    // Click the delete button in the action bar
    const deleteClicked = await clickDeleteButton(page);
    if (!deleteClicked) throw new Error("Delete button not found after row selection");

    await page.waitForTimeout(1000);

    // Confirm the deletion dialog
    const confirmed = await confirmDeletion(page);
    if (!confirmed) throw new Error("Confirm dialog failed");

    await page.waitForTimeout(3000);
    console.log(`   🗑️  Deleted: "${title}"`);
    return true;
}

// ─── Step helpers ─────────────────────────────────────────────────────────────

async function clickAccountsTab(page) {
    // Wait for the page's tab bar to render (it's a Vue/Quasar SPA)
    try {
        await page.waitForSelector(
            `a[href*="cat_id=${ACCOUNTS_CAT_ID}"], a:has-text('Accounts'), button:has-text('Accounts')`,
            { state: "visible", timeout: 15000 }
        );
    } catch { /* fallthrough — attempt clicks anyway */ }

    const link = page.locator(`a[href*="cat_id=${ACCOUNTS_CAT_ID}"]`).first();
    if ((await link.count()) > 0) {
        await link.scrollIntoViewIfNeeded();
        await link.click();
        return true;
    }

    const fallback = page.locator("a:has-text('Accounts'), button:has-text('Accounts')").first();
    if ((await fallback.count()) > 0) {
        await fallback.scrollIntoViewIfNeeded();
        await fallback.click();
        return true;
    }

    return false;
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

/**
 * Scan visible table rows for one matching `title` + `price`.
 * Matches title against the .text-body1 cell (g2g truncates long titles in the DOM,
 * so we compare on the first 50 chars). Price is matched against the 5th column.
 * Clicks the row's checkbox. Returns true if found and selected.
 */
async function selectRowByTitleAndPrice(page, title, price) {
    // g2g truncates long titles in the DOM — use the first 50 chars as the key
    const titlePrefix  = title.toLowerCase().trim().substring(0, 50);
    const targetPrice  = price ? parseFloat(price) : null;

    const rows  = page.locator(".q-table tbody tr");
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);

        // ── Title match (2nd td, .text-body1 span) ───────────────────────────
        let rowTitle = "";
        try {
            rowTitle = (
                await row.locator("td:nth-child(2) .text-body1 span").first().innerText({ timeout: 3000 })
            ).toLowerCase().trim();
        } catch {
            // fallback: full row text
            try {
                rowTitle = (await row.innerText({ timeout: 3000 })).toLowerCase();
            } catch {
                continue;
            }
        }

        if (!rowTitle.includes(titlePrefix)) continue;

        // ── Price match (5th td) ──────────────────────────────────────────────
        if (targetPrice !== null) {
            let rowPriceText = "";
            try {
                rowPriceText = (
                    await row.locator("td:nth-child(5) span").last().innerText({ timeout: 2000 })
                ).trim();
            } catch { /* skip price check if cell not found */ }

            if (rowPriceText) {
                const rowPrice = parseFloat(rowPriceText);
                if (!isNaN(rowPrice) && Math.abs(rowPrice - targetPrice) > 0.01) continue;
            }
        }

        // ── Select the row ────────────────────────────────────────────────────
        const checkbox = row.locator("td div[role='checkbox'], td .q-checkbox").first();
        if ((await checkbox.count()) === 0) {
            await row.click({ force: true });
        } else {
            const checked = await checkbox.getAttribute("aria-checked").catch(() => "false");
            if (checked !== "true") {
                await checkbox.click({ force: true });
            }
        }

        await page.waitForTimeout(600);
        console.log(`   ✅ Found and selected: "${title}" @ ${price}`);
        return true;
    }

    return false;
}

async function clickNextPage(page) {
    try {
        const nextBtn = page.locator(
            "button[aria-label='Next page'], .q-table__bottom button[aria-label='Next']"
        ).first();

        if ((await nextBtn.count()) === 0) return false;

        const disabled = await nextBtn.getAttribute("disabled");
        if (disabled !== null) return false;

        await nextBtn.click({ force: true });
        await page.waitForTimeout(1500);
        return true;
    } catch {
        return false;
    }
}

async function clickDeleteButton(page) {
    try {
        await page.waitForSelector(
            "button.text-negative, button:has(.material-icons:text('delete'))",
            { state: "visible", timeout: 10000 }
        );

        const btn = page.locator(
            "button.text-negative, button:has(.material-icons:text('delete'))"
        ).first();

        await btn.scrollIntoViewIfNeeded();
        await btn.click({ force: true });
        console.log("   🖱️  Clicked delete button");
        return true;
    } catch (err) {
        console.log(`   ❌ Delete button error: ${err.message}`);
        return false;
    }
}

async function confirmDeletion(page) {
    try {
        const dialog = page.locator(".q-dialog__inner .q-card");
        await dialog.waitFor({ state: "visible", timeout: 10000 });

        const confirmBtn = dialog.locator("button:has-text('Confirm')").first();
        if ((await confirmBtn.count()) === 0) {
            console.log("   ❌ Confirm button not found");
            return false;
        }

        await confirmBtn.click({ force: true });
        console.log("   ✅ Confirmed deletion");

        await dialog.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
        return true;
    } catch (err) {
        console.log(`   ❌ Confirm dialog error: ${err.message}`);
        return false;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch((err) => {
    console.error("❌ Unhandled error:", err.message);
    process.exit(1);
});
