/**
 * delete-specific-offers.js — Delete specific g2g.com offers by title.
 *
 * Standalone manual mode:
 *   node delete-specific-offers.js <email> <title> [<price>]
 *   node delete-specific-offers.js <email> --file offers.json
 *   node delete-specific-offers.js <email> --dry-run <title>
 *
 * API mode — fetch non-permanent offers for an account and delete them all:
 *   node delete-specific-offers.js --api --user-id=<id> <email>
 *   node delete-specific-offers.js --api --user-id=<id> <email> --dry-run
 *
 * offers.json format:
 *   [{ "title": "My Offer Title", "price": "4.99" }, ...]
 *
 * Reads COOKIES_DIR, HEADLESS, SLOW_MO, G2G_BASE_URL (and LARAVEL_API_URL +
 * API_KEY for --api mode) from .env
 */

import "./env-loader.js";
import path from "path";
import fs from "fs";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { ensureLoggedIn, saveAuthState } from "./utils/auth.js";
import { fetchNonPermanentOffers } from "./api-client.js";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL    = process.env.G2G_BASE_URL ?? "https://www.g2g.com";
const HEADLESS    = process.env.HEADLESS === "true";
const SLOW_MO     = parseInt(process.env.SLOW_MO ?? "150", 10);
const COOKIES_DIR = path.resolve(process.env.COOKIES_DIR ?? path.join(__dirname, "cookies"));
mkdirSync(COOKIES_DIR, { recursive: true });

const ACCOUNTS_CAT_ID = "5830014a-b974-45c6-9672-b51e83112fb7";

const TAB_SELECTORS = [
    `a[href*="cat_id=${ACCOUNTS_CAT_ID}"]`,
    `a:has-text('Accounts')`,
    `button:has-text('Accounts')`,
    `.q-tab:has-text('Accounts')`,
];

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const API_MODE = args.includes("--api");
const email    = args.find((a) => !a.startsWith("--"));

// --user-id=<N>
const userIdArg = args.find((a) => a.startsWith("--user-id="));
const userId    = userIdArg ? parseInt(userIdArg.replace("--user-id=", ""), 10) : null;

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
    if (API_MODE) {
        if (!userId || !email) {
            console.error("❌  API mode requires: --user-id=<id> <email>");
            process.exit(1);
        }
        await runApiMode();
        return;
    }

    if (!email) {
        console.error("Usage: node delete-specific-offers.js <email> <title> [<price>]");
        console.error("       node delete-specific-offers.js <email> --file offers.json");
        console.error("       node delete-specific-offers.js --api --user-id=<id> <email>");
        process.exit(1);
    }

    const targets = resolveTargets(args);
    if (targets.length === 0) {
        console.error("❌  No offer titles specified. Pass a title or --file <json>.");
        process.exit(1);
    }

    await runStandaloneMode(email, targets);
}

// ─── Standalone mode ──────────────────────────────────────────────────────────

async function runStandaloneMode(acctEmail, targets) {
    const emailPrefix = acctEmail.split("@")[0];
    const cookieFile  = path.join(COOKIES_DIR, `${emailPrefix}.json`);
    const password    = process.env[`G2G_PASS_${emailPrefix.toUpperCase()}`]
                     ?? process.env.G2G_PASSWORD
                     ?? "";

    console.log("🗑️  G2G Specific Offer Deleter (standalone)");
    console.log(`   Account  : ${acctEmail}`);
    console.log(`   Targets  : ${targets.length} offer(s)`);
    console.log(`   Headless : ${HEADLESS}`);
    if (DRY_RUN) console.log("   Mode     : DRY RUN\n");
    targets.forEach((t, i) => console.log(`   ${i + 1}. "${t.title}"${t.price ? ` @ ${t.price}` : ""}`));

    const { page, context, browser } = await launchBrowser();
    try {
        const loggedIn = await ensureLoggedIn(page, context, { baseUrl: BASE_URL, email: acctEmail, password, cookieFile });
        if (!loggedIn) { console.error("❌  Authentication failed."); return; }

        const { deleted, skipped } = await deleteOfferList(page, targets);
        await saveAuthState(context, cookieFile).catch(() => {});
        console.log(`\n✅  Done — deleted: ${deleted}, skipped/not found: ${skipped}`);
    } catch (err) {
        console.error("\n❌  Fatal error:", err.message);
    } finally {
        await browser.close().catch(() => {});
    }
}

// ─── API mode ─────────────────────────────────────────────────────────────────

async function runApiMode() {
    const emailPrefix = email.split("@")[0];
    const cookieFile  = path.join(COOKIES_DIR, `${emailPrefix}.json`);
    const password    = process.env[`G2G_PASS_${emailPrefix.toUpperCase()}`]
                     ?? process.env.G2G_PASSWORD
                     ?? "";

    console.log("🛡️  G2G Delete Non-Permanent Offers (API mode)");
    console.log(`   Account  : ${email} (id: ${userId})`);
    console.log(`   Headless : ${HEADLESS}`);
    if (DRY_RUN) console.log("   Mode     : DRY RUN\n");

    // ── Fetch list from API ───────────────────────────────────────────────────
    console.log("\n📡  Fetching non-permanent offers from API...");
    let data;
    try {
        data = await fetchNonPermanentOffers(userId);
    } catch (err) {
        console.error("❌  Failed to fetch non-permanent offers:", err.message);
        process.exit(1);
    }

    const targets = data.offers ?? [];
    if (targets.length === 0) {
        console.log("ℹ️  No non-permanent offers found for this account — nothing to delete.");
        return;
    }

    console.log(`📋  Found ${targets.length} non-permanent offer(s) to delete:`);
    targets.slice(0, 20).forEach((t, i) =>
        console.log(`    ${i + 1}. "${t.title}"${t.price ? ` @ ${t.price}` : ""}`)
    );
    if (targets.length > 20) console.log(`    ... and ${targets.length - 20} more`);

    if (DRY_RUN) {
        console.log("\nℹ️  Dry run — would delete the above offers. Exiting.");
        return;
    }

    // ── Launch browser and delete ──────────────────────────────────────────────
    const { page, context, browser } = await launchBrowser();
    try {
        const loggedIn = await ensureLoggedIn(page, context, { baseUrl: BASE_URL, email, password, cookieFile });
        if (!loggedIn) {
            console.error(`❌  Auth failed for ${email}`);
            return;
        }

        const { deleted, skipped } = await deleteOfferList(page, targets);
        await saveAuthState(context, cookieFile).catch(() => {});

        console.log(`\n✅  Done — deleted: ${deleted} · skipped/not found: ${skipped}`);
    } catch (err) {
        console.error(`❌  Fatal error:`, err.message);
    } finally {
        await browser.close().catch(() => {});
    }
}

// ─── Core: batch-delete a list of offer targets ───────────────────────────────
//
// Strategy: navigate once per deletion pass. On each page of the table, select
// ALL rows that match a target title, then bulk-delete in one action. Repeat
// until a full pass through all pages finds nothing left to delete.
// For 300 offers at ~20/page this means ~15 navigations instead of 300.

async function deleteOfferList(page, targets) {
    if (targets.length === 0) return { deleted: 0, skipped: 0 };

    const prefixes = targets.map((t) => ({
        prefix: t.title.toLowerCase().trim().substring(0, 50),
        price:  t.price != null ? parseFloat(t.price) : null,
        title:  t.title,
    }));

    let totalDeleted = 0;

    for (let pass = 0; pass < 200; pass++) {
        console.log(`\n🔄  Pass ${pass + 1} — navigating to offers list...`);
        try {
            await page.goto(`${BASE_URL}/offers/list`, { waitUntil: "load", timeout: 45000 });
        } catch (err) {
            throw new Error(`Navigation failed: ${err.message}`);
        }

        if (!(await clickAccountsTab(page))) throw new Error("Could not click Accounts tab");

        let deletedThisPass = 0;

        // Walk through table pages; break inner loop after each deletion so we
        // re-navigate and get a fresh table state.
        for (let pg = 0; pg < 50; pg++) {
            if (!(await waitForTableRows(page))) break;

            const { selectedCount, selectedTitles } = await selectAllMatchingRows(page, prefixes);

            if (selectedCount === 0) {
                if (!(await clickNextPage(page))) break;
                await waitForTableRows(page);
                continue;
            }

            console.log(`   ✅  Selected ${selectedCount} offer(s):`);
            selectedTitles.forEach((t) => console.log(`      – "${t}"`));

            if (DRY_RUN) {
                console.log(`   ℹ️  Dry run — skipping deletion.`);
                totalDeleted += selectedCount;
                if (!(await clickNextPage(page))) break;
                await waitForTableRows(page);
                continue;
            }

            await page.waitForTimeout(300);

            if (!(await clickDeleteButton(page))) throw new Error("Delete button not found");
            if (!(await confirmDeletion(page)))    throw new Error("Confirm dialog failed");

            deletedThisPass += selectedCount;
            totalDeleted    += selectedCount;
            console.log(`   🗑️   Deleted ${selectedCount} offer(s)  (running total: ${totalDeleted})`);

            // Re-navigate next iteration for a clean table state
            break;
        }

        // Stop when a full pass found nothing to delete
        if (DRY_RUN || deletedThisPass === 0) break;
    }

    const skipped = Math.max(0, targets.length - totalDeleted);
    return { deleted: totalDeleted, skipped };
}

// ─── Select all rows on the current page that match any target prefix ─────────

async function selectAllMatchingRows(page, prefixes) {
    const rows  = page.locator(".q-table tbody tr");
    const count = await rows.count();
    if (count === 0) return { selectedCount: 0, selectedTitles: [] };

    const matchIndexes = [];
    const matchTitles  = [];

    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);

        let rowTitle = "";
        try {
            rowTitle = (
                await row.locator("td:nth-child(2) .text-body1 span").first().innerText({ timeout: 2000 })
            ).toLowerCase().trim();
        } catch {
            try { rowTitle = (await row.innerText({ timeout: 2000 })).toLowerCase().trim(); }
            catch { continue; }
        }

        const hit = prefixes.find((p) => rowTitle.includes(p.prefix));
        if (!hit) continue;

        if (hit.price !== null) {
            let priceText = "";
            try {
                priceText = (
                    await row.locator("td:nth-child(5) span").last().innerText({ timeout: 2000 })
                ).trim();
            } catch {}
            if (priceText) {
                const rp = parseFloat(priceText);
                if (!isNaN(rp) && Math.abs(rp - hit.price) > 0.01) continue;
            }
        }

        matchIndexes.push(i);
        matchTitles.push(hit.title);
    }

    if (matchIndexes.length === 0) return { selectedCount: 0, selectedTitles: [] };

    // All visible rows are targets → use header "select all" checkbox for speed
    if (matchIndexes.length === count) {
        const hdr = page.locator("thead .q-checkbox, thead [role='checkbox']").first();
        if ((await hdr.count()) > 0) {
            try {
                const checked = await hdr.getAttribute("aria-checked").catch(() => "false");
                if (checked !== "true") await hdr.click({ force: true });
                await page.waitForTimeout(200);
                return { selectedCount: count, selectedTitles: matchTitles };
            } catch { /* fall through to per-row selection */ }
        }
    }

    // Partial match — select only the matching rows
    let selectedCount = 0;
    for (const i of matchIndexes) {
        const row      = rows.nth(i);
        const checkbox = row.locator("td div[role='checkbox'], td .q-checkbox").first();
        try {
            if ((await checkbox.count()) === 0) {
                await row.click({ force: true });
            } else {
                const checked = await checkbox.getAttribute("aria-checked").catch(() => "false");
                if (checked !== "true") await checkbox.click({ force: true });
            }
            selectedCount++;
        } catch (err) {
            console.log(`   ⚠️   Could not select row: ${err.message}`);
        }
    }

    return { selectedCount, selectedTitles: matchTitles.slice(0, selectedCount) };
}

// ─── Step helpers ─────────────────────────────────────────────────────────────

async function clickAccountsTab(page) {
    const combinedSelector = TAB_SELECTORS.join(", ");

    // Wait for the Quasar SPA to render the tab bar (up to 25s)
    try {
        await page.waitForSelector(combinedSelector, { state: "visible", timeout: 25000 });
    } catch {
        console.log("   ⚠️   Tab bar did not appear within 25s");
        return false;
    }

    for (const sel of TAB_SELECTORS) {
        const el = page.locator(sel).first();
        if ((await el.count()) === 0) continue;
        try {
            await el.scrollIntoViewIfNeeded();
            await el.click({ timeout: 5000 });
            console.log("   ✅  Clicked Accounts tab");
            return true;
        } catch { /* try next selector */ }
    }

    return false;
}

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

async function clickNextPage(page) {
    try {
        const nextBtn = page.locator(
            "button[aria-label='Next page'], .q-table__bottom button[aria-label='Next']"
        ).first();

        if ((await nextBtn.count()) === 0) return false;
        const disabled = await nextBtn.getAttribute("disabled");
        if (disabled !== null) return false;

        await nextBtn.click({ force: true });
        await waitForTableRows(page);
        return true;
    } catch {
        return false;
    }
}

async function clickDeleteButton(page) {
    const SELECTORS = [
        "button.text-negative",
        "button:has(.material-icons:text('delete'))",
        "button:has-text('Delete')",
    ];
    try {
        await page.waitForSelector(SELECTORS.join(", "), { state: "visible", timeout: 12000 });
        const btn = page.locator(SELECTORS.join(", ")).first();
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ force: true });
        console.log("   🖱️   Clicked delete button");
        return true;
    } catch (err) {
        console.log(`   ❌  Delete button error: ${err.message}`);
        return false;
    }
}

async function confirmDeletion(page) {
    try {
        const dialog = page.locator(".q-dialog__inner .q-card");
        await dialog.waitFor({ state: "visible", timeout: 12000 });

        const confirmBtn = dialog.locator("button:has-text('Confirm')").first();
        if ((await confirmBtn.count()) === 0) {
            console.log("   ❌  Confirm button not found");
            return false;
        }

        await confirmBtn.click({ force: true });
        console.log("   ✅  Confirmed deletion");
        await dialog.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
        return true;
    } catch (err) {
        console.log(`   ❌  Confirm dialog error: ${err.message}`);
        return false;
    }
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

function resolveTargets(args) {
    const fileFlag = args.indexOf("--file");
    if (fileFlag !== -1 && args[fileFlag + 1]) {
        const raw = fs.readFileSync(args[fileFlag + 1], "utf8");
        return JSON.parse(raw);
    }

    const nonFlags = args.filter((a) => !a.startsWith("--") && a !== email);
    if (nonFlags.length === 0) return [];

    return [{ title: nonFlags[0], price: nonFlags[1] ?? null }];
}

async function launchBrowser() {
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
    return { browser, context, page };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch((err) => {
    console.error("❌  Unhandled error:", err.message);
    process.exit(1);
});
