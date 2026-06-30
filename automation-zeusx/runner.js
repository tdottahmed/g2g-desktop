/**
 * runner.js — ZeusX automation runner.
 *
 * Modes:
 *   node runner.js --auth-test   — verify auth, then open create-offer for inspection
 *   node runner.js               — run once (offer posting — future)
 *   node runner.js --watch       — poll on WATCH_INTERVAL_SECONDS
 *   node runner.js --status      — check API connectivity and exit
 *
 * Browser profile is stored in ./browser-profile/ (Playwright bundled Chromium).
 * First run opens a visible browser — log in manually. Session persists from then on.
 */

import "./env-loader.js";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { ensureLoggedIn } from "./utils/auth.js";
import { delay } from "./utils/index.js";

// ─── Config from env ──────────────────────────────────────────────────────────

const HEADLESS         = process.env.HEADLESS === "true";
const SLOW_MO          = parseInt(process.env.SLOW_MO ?? "120", 10);
const BASE_URL         = process.env.ZEUSX_BASE_URL ?? "https://zeusx.com";
const EMAIL            = process.env.ZEUSX_EMAIL ?? "";
const PASSWORD         = process.env.ZEUSX_PASSWORD ?? "";
const WATCH_INTERVAL   = parseInt(process.env.WATCH_INTERVAL_SECONDS ?? "60", 10);

const PROFILE_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "browser-profile"
);

// ─── Mode ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const MODE = args.includes("--auth-test") ? "auth-test"
           : args.includes("--watch")     ? "watch"
           : args.includes("--status")    ? "status"
           :                                "run";

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
    console.log("⚡ ZeusX Automation Runner");
    console.log(`   Mode     : ${MODE}`);
    console.log(`   Base URL : ${BASE_URL}`);
    console.log(`   Headless : ${HEADLESS}`);
    console.log(`   Account  : ${EMAIL || "(not configured)"}\n`);

    if (MODE === "status")    { await runStatus();   return; }
    if (MODE === "auth-test") { await runAuthTest(); return; }
    if (MODE === "watch")     { await runWatch();    return; }
    await runOnce();
}

// ─── Status check ─────────────────────────────────────────────────────────────

async function runStatus() {
    const apiUrl = process.env.LARAVEL_API_URL;
    if (!apiUrl) { console.log("❌ LARAVEL_API_URL is not configured."); process.exit(1); }
    try {
        const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/automation/heartbeat`, {
            headers: { "X-Api-Key": process.env.API_KEY ?? "", Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log("✅ API connection OK");
        process.exit(0);
    } catch (err) {
        console.log(`❌ API unreachable: ${err.message}`);
        process.exit(1);
    }
}

// ─── Auth test ────────────────────────────────────────────────────────────────

async function runAuthTest() {
    console.log("🔐 Starting authentication test...\n");

    const { context, page, closeAll } = await launchBrowser();

    try {
        const ok = await ensureLoggedIn(page, context, {
            baseUrl:  BASE_URL,
            email:    EMAIL,
            password: PASSWORD,
        });

        if (!ok) {
            console.log("\n❌ Authentication failed.");
            process.exitCode = 1;
            return;
        }

        console.log("\n✅ Authentication successful!\n");

        console.log("📝 Clicking 'Sell Item' button...");
        try {
            const sellBtn = page
                .locator('.header_right-side__YvA9U button:has-text("Sell Item")')
                .first();

            await sellBtn.waitFor({ state: "visible", timeout: 10000 });
            await sellBtn.click();
            await delay(2000);

            const currentUrl = page.url();
            console.log(`   URL: ${currentUrl}`);

            if (/create.?offer|sell/i.test(currentUrl)) {
                console.log("✅ Create-offer page opened — browser ready for inspection.");
            } else if (/\/(login|signin)/i.test(currentUrl)) {
                console.log("⚠️  Redirected to login — session not active.");
            } else {
                console.log(`⚠️  Landed on unexpected URL: ${currentUrl}`);
            }
        } catch (err) {
            console.log(`⚠️  Could not click 'Sell Item': ${err.message}`);
        }

        console.log("\n   (browser stays open — press Stop in the dashboard to close)");
        await new Promise(() => {});

    } finally {
        await closeAll();
    }
}

// ─── Run once ─────────────────────────────────────────────────────────────────

async function runOnce() {
    const { context, page, closeAll } = await launchBrowser();

    try {
        const ok = await ensureLoggedIn(page, context, {
            baseUrl: BASE_URL, email: EMAIL, password: PASSWORD,
        });

        if (!ok) { console.log("❌ Authentication failed."); process.exitCode = 1; return; }

        console.log("✅ Authenticated. Offer posting not yet implemented.");
        console.log("Run complete");
    } finally {
        await closeAll();
    }
}

// ─── Watch mode ───────────────────────────────────────────────────────────────

async function runWatch() {
    console.log(`👁 Watch mode — polling every ${WATCH_INTERVAL}s\n`);
    while (true) {
        await runOnce();
        console.log(`\n⏳ Sleeping ${WATCH_INTERVAL}s...\n`);
        await delay(WATCH_INTERVAL * 1000);
    }
}

// ─── Browser factory ──────────────────────────────────────────────────────────
//
// Uses Playwright's bundled Chromium with a persistent profile in ./browser-profile/.
// Session is preserved between runs — first run opens visibly so the user can log in.

async function launchBrowser() {
    console.log(`   🌐 Launching Chromium (persistent profile)...`);
    console.log(`      Profile : ${PROFILE_DIR}\n`);

    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: HEADLESS,
        slowMo:   SLOW_MO,
        ignoreDefaultArgs: ["--enable-automation"],
        args: [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
        ],
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = context.pages()[0] ?? await context.newPage();
    console.log(`   ✅ Chromium launched\n`);

    return {
        context,
        page,
        closeAll: () => context.close().catch(() => {}),
    };
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
});
