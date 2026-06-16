/**
 * runner.js — Local Playwright runner for g2g.com offer automation.
 *
 * Fetches pending templates from the live Laravel API, posts them on g2g.com,
 * and reports per-template success/failure back to the API.
 *
 * Usage:
 *   node runner.js            — run once and exit
 *   node runner.js --watch    — poll on the interval defined by WATCH_INTERVAL_SECONDS
 *   node runner.js --status   — check API connectivity and exit
 *
 * Required environment variables (copy .env.example to .env and fill in):
 *   LARAVEL_API_URL, API_KEY, COOKIES_DIR
 */

import "./env-loader.js";
import path from "path";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { heartbeat, fetchPending, reportSuccess, reportFailed } from "./api-client.js";
import { ensureLoggedIn, saveAuthState } from "./utils/auth.js";
import { navigateToAccountsSection, clickContinueButton } from "./utils/sell.js";
import { fillOfferForm, submitFormAndAddNew, submitForm } from "./utils/form-filler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HEADLESS      = process.env.HEADLESS === "true";
const SLOW_MO       = parseInt(process.env.SLOW_MO ?? "120", 10);
const BASE_URL      = process.env.G2G_BASE_URL ?? "https://www.g2g.com";
const COOKIES_DIR   = path.resolve(process.env.COOKIES_DIR ?? path.join(__dirname, "cookies"));
mkdirSync(COOKIES_DIR, { recursive: true });
const WATCH_INTERVAL = parseInt(process.env.WATCH_INTERVAL_SECONDS ?? "60", 10);

const args = process.argv.slice(2);
const MODE = args.includes("--watch")  ? "watch"
           : args.includes("--status") ? "status"
           :                              "run";

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
    console.log("🤖 g2g Offer Automation Runner");
    console.log(`   Mode     : ${MODE}`);
    console.log(`   API URL  : ${process.env.LARAVEL_API_URL}`);
    console.log(`   Cookies  : ${COOKIES_DIR}`);
    console.log(`   Headless : ${HEADLESS}`);

    if (MODE === "status") {
        await checkStatus();
        return;
    }

    if (MODE === "watch") {
        console.log(`\n👀 Watch mode — polling every ${WATCH_INTERVAL}s\n`);
        while (true) {
            await runOnce();
            console.log(`\n⏳ Next run in ${WATCH_INTERVAL}s...`);
            await delay(WATCH_INTERVAL * 1000);
        }
    } else {
        await runOnce();
    }
}

async function checkStatus() {
    try {
        const result = await heartbeat();
        console.log("✅ API reachable:", result);
        process.exit(0);
    } catch (error) {
        console.error("❌ API unreachable:", error.message);
        process.exit(1);
    }
}

async function runOnce() {
    console.log(`\n[${new Date().toLocaleTimeString()}] Fetching pending templates...`);

    let data;
    try {
        data = await fetchPending();
    } catch (error) {
        console.error("❌ Failed to fetch pending templates:", error.message);
        return;
    }

    const { users = [] } = data;

    if (users.length === 0) {
        console.log("ℹ️  No pending templates right now.");
        return;
    }

    const totalTemplates = users.reduce((sum, u) => sum + u.templates.length, 0);
    console.log(`📋 Found ${totalTemplates} template(s) across ${users.length} user(s)`);

    for (const userGroup of users) {
        await processUserGroup(userGroup);
    }

    console.log("✅ Run complete.");
}

// ─── Per-user processing ──────────────────────────────────────────────────────

async function processUserGroup(userGroup) {
    const { email, password, templates } = userGroup;
    const emailPrefix = email.split("@")[0];
    const cookieFile  = path.join(COOKIES_DIR, `${emailPrefix}.json`);

    console.log(`\n👤 Processing user: ${email} (${templates.length} template(s))`);
    console.log(`   Cookie file: ${cookieFile}`);

    let browser = null;
    let context  = null;
    let page     = null;

    try {
        browser = await chromium.launch({
            headless: HEADLESS,
            slowMo: SLOW_MO,
            args: ["--start-maximized"],
        }).catch((err) => {
            if (err.message.includes("Executable doesn't exist")) {
                console.error("\n❌ Playwright browser not installed.");
                console.error("   Run this once to fix it:\n");
                console.error("     npx playwright install chromium\n");
                process.exit(1);
            }
            throw err;
        });
        context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
        page    = await context.newPage();

        // ── Auth ──
        const loggedIn = await ensureLoggedIn(page, context, {
            baseUrl:    BASE_URL,
            email,
            password,
            cookieFile,
        });

        if (!loggedIn) {
            console.error(`❌ Authentication failed for ${email}. Skipping all templates.`);
            for (const t of templates) {
                await reportFailed(t.template_id, "Authentication failed", { email }).catch(() => {});
            }
            return;
        }

        // ── Navigate to offer creation ──
        const navSuccess = await navigateToAccountsSection(page);
        if (!navSuccess) {
            console.error("❌ Failed to navigate to Accounts section");
            for (const t of templates) {
                await reportFailed(t.template_id, "Navigation to Accounts section failed").catch(() => {});
            }
            return;
        }

        const continueSuccess = await clickContinueButton(page);
        if (!continueSuccess) {
            console.error("❌ Failed to click Continue");
            for (const t of templates) {
                await reportFailed(t.template_id, "Failed to click Continue button").catch(() => {});
            }
            return;
        }

        // ── Post each template ──
        for (let i = 0; i < templates.length; i++) {
            const template = templates[i];
            const isLast   = i === templates.length - 1;

            console.log(`\n   🔄 [${i + 1}/${templates.length}] ${template.Title}`);

            const startedAt = Date.now();

            try {
                await fillOfferForm(page, template);

                if (!isLast) {
                    const ok = await submitFormAndAddNew(page);
                    if (!ok) {
                        await reportFailed(template.template_id, "submitFormAndAddNew failed — browser may be in unknown state", {
                            template_title: template.Title,
                        });
                        console.log("⚠️ Stopping this user's session after submit failure");
                        break;
                    }
                } else {
                    await submitForm(page);
                    await page.waitForTimeout(5000);
                }

                const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
                await reportSuccess(template.template_id, {
                    template_title: template.Title,
                    elapsed_seconds: elapsed,
                    runner_host: process.env.HOSTNAME ?? "local",
                });
                console.log(`   ✅ Reported success for template ${template.template_id} (${elapsed}s)`);
            } catch (error) {
                console.error(`   ❌ Template ${template.template_id} failed:`, error.message);
                await reportFailed(template.template_id, error.message, {
                    template_title: template.Title,
                    stack: error.stack,
                }).catch(() => {});
                console.log("⚠️ Stopping this user's session after unexpected error");
                break;
            }
        }

        // Persist any refreshed session tokens back to disk
        if (context) await saveAuthState(context, cookieFile).catch(() => {});
    } catch (error) {
        console.error(`❌ Fatal error for user ${email}:`, error.message);
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch((error) => {
    console.error("❌ Unhandled error:", error.message);
    process.exit(1);
});
