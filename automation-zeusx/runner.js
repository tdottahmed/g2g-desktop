/**
 * runner.js — ZeusX automation runner.
 *
 * Modes:
 *   node runner.js --auth-test   — verify auth, then open create-offer for inspection
 *   node runner.js               — run once (offer posting — future)
 *   node runner.js --watch       — poll on WATCH_INTERVAL_SECONDS
 *   node runner.js --status      — check API connectivity and exit
 */

import "./env-loader.js";
import { chromium } from "playwright";
import { existsSync } from "fs";
import os from "os";
import { ensureLoggedIn } from "./utils/auth.js";
import { detectChromePath, detectChromeUserDataDir, findChromeProfile } from "./utils/browser-detect.js";
import { delay } from "./utils/index.js";

// ─── Config from env ──────────────────────────────────────────────────────────

const HEADLESS        = process.env.HEADLESS === "true";
const SLOW_MO         = parseInt(process.env.SLOW_MO ?? "120", 10);
const BASE_URL        = process.env.ZEUSX_BASE_URL ?? "https://zeusx.com";
const EMAIL           = process.env.ZEUSX_EMAIL ?? "";
const PASSWORD        = process.env.ZEUSX_PASSWORD ?? "";
const CHROME_PATH          = process.env.CHROME_PATH ?? "";
const CHROME_PROFILE       = process.env.CHROME_PROFILE_DIR ?? "";
const CHROME_PROFILE_NAME  = process.env.CHROME_PROFILE_NAME ?? "";
const CHROME_PROFILE_EMAIL = process.env.CHROME_PROFILE_EMAIL ?? "";
const WATCH_INTERVAL       = parseInt(process.env.WATCH_INTERVAL_SECONDS ?? "60", 10);

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

    if (MODE === "status") { await runStatus(); return; }
    if (MODE === "auth-test") { await runAuthTest(); return; }
    if (MODE === "watch")    { await runWatch();    return; }
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

        // Click the "Sell Item" button in the authenticated header
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

        // Keep browser open until runner is stopped
        console.log("\n   (browser stays open — press Stop in the dashboard to close)");
        await new Promise(() => {}); // wait indefinitely until killed

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
// Finds the Chrome profile matching CHROME_PROFILE_NAME / CHROME_PROFILE_EMAIL
// in the Chrome user data directory, then opens it via launchPersistentContext.
// If Chrome is already running with that profile, falls back to CDP.

async function launchBrowser() {
    let parsedChromePath = CHROME_PATH;
    if (parsedChromePath.startsWith('~')) parsedChromePath = parsedChromePath.replace(/^~/, os.homedir());
    if (parsedChromePath && !existsSync(parsedChromePath)) {
        console.log(`   ⚠️  Configured CHROME_PATH (${parsedChromePath}) does not exist. Falling back to auto-detect...`);
        parsedChromePath = "";
    }

    let parsedUserDataDir = CHROME_PROFILE;
    if (parsedUserDataDir.startsWith('~')) parsedUserDataDir = parsedUserDataDir.replace(/^~/, os.homedir());
    if (parsedUserDataDir && !existsSync(parsedUserDataDir)) {
        console.log(`   ⚠️  Configured CHROME_PROFILE_DIR (${parsedUserDataDir}) does not exist. Falling back to auto-detect...`);
        parsedUserDataDir = "";
    }

    const chromePath  = parsedChromePath || detectChromePath();
    const userDataDir = parsedUserDataDir || detectChromeUserDataDir();

    if (!chromePath)  throw new Error("Chrome binary not found. Set CHROME_PATH in settings.");
    if (!userDataDir) throw new Error("Chrome user data directory not found. Set CHROME_PROFILE_DIR in settings.");

    // Locate the profile directory by display name or signed-in email
    let profileDirName = findChromeProfile(userDataDir, {
        name:  CHROME_PROFILE_NAME,
        email: CHROME_PROFILE_EMAIL,
    });

    if (!profileDirName && !CHROME_PROFILE_NAME && !CHROME_PROFILE_EMAIL) {
        // Fallback to "Default" if no profile name or email was configured
        profileDirName = "Default";
    }

    if (!profileDirName) {
        const hint = CHROME_PROFILE_NAME || CHROME_PROFILE_EMAIL || "(not configured)";
        throw new Error(
            `Chrome profile not found for "${hint}". ` +
            "Check Settings → Chrome Profile Name / Email."
        );
    }

    console.log(`   🌐 Launching Chrome with profile "${profileDirName}"...`);
    console.log(`      Path    : ${chromePath}`);
    console.log(`      DataDir : ${userDataDir}`);
    console.log(`      Profile : ${profileDirName}\n`);

    try {
        const context = await chromium.launchPersistentContext(userDataDir, {
            executablePath: chromePath,
            headless: HEADLESS,
            slowMo: SLOW_MO,
            ignoreDefaultArgs: ["--enable-automation"],
            args: [
                `--profile-directory=${profileDirName}`,
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-blink-features=AutomationControlled",
            ],
        });

        // Hide webdriver from Cloudflare and other bot detectors
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });

        const page = context.pages()[0] ?? await context.newPage();
        console.log(`   ✅ Chrome launched (profile: ${profileDirName})\n`);

        return {
            context,
            page,
            closeAll: () => context.close().catch(() => {}),
        };
    } catch (err) {
        const inUse = err.message.includes("already in use") ||
                      err.message.includes("user data directory");

        if (inUse) {
            console.log("   ⚠️  Chrome is already running with this profile.");
            console.log("      → Connecting via CDP (port 9222)...\n");

            const cdp = await tryConnectCDP();
            if (cdp) return cdp;

            throw new Error(
                "Chrome is running but CDP is not available. " +
                `Launch Chrome with: google-chrome --remote-debugging-port=9222 --profile-directory=${profileDirName}`
            );
        }

        throw new Error(`Chrome launch failed: ${err.message}`);
    }
}

async function tryConnectCDP() {
    try {
        const browser  = await chromium.connectOverCDP("http://localhost:9222", { timeout: 3000 });
        const contexts = browser.contexts();
        const context  = contexts[0] ?? await browser.newContext();

        // Hide webdriver from Cloudflare and other bot detectors
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });

        const page     = context.pages()[0] ?? await context.newPage();
        console.log("   ✅ Connected to running Chrome via CDP\n");
        return {
            context,
            page,
            closeAll: () => browser.close().catch(() => {}),
        };
    } catch {
        return null;
    }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
});
