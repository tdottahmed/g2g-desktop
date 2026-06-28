import { chromium } from "playwright";
import { detectChromePath, detectChromeUserDataDir } from "./browser-detect.js";
import { isLoggedIn, saveCookies } from "./cookie-auth.js";
import { delay } from "./index.js";

// ─── Tier 2: Chrome profile auth ─────────────────────────────────────────────
//
// Tries two paths in order:
//   a) Connect to an already-running Chrome via CDP (port 9222)
//   b) Launch system Chrome with the user's profile directory
//
// If either path finds a valid ZeusX session, cookies are extracted and saved
// to the cookie file so Tier 1 can use them on the next run.

export async function tryProfileAuth(config, cookieFile, baseUrl) {
    const chromePath  = config.CHROME_PATH  || detectChromePath();
    const profileDir  = config.CHROME_PROFILE_DIR || detectChromeUserDataDir();

    console.log("\n   ─────────────────────────────────────────────────");
    console.log("   🌐 TIER 2: Chrome Profile Auth");
    console.log(`   Chrome   : ${chromePath ?? "not found"}`);
    console.log(`   Profile  : ${profileDir ?? "not found"}`);
    console.log("   ─────────────────────────────────────────────────");

    // a) Try CDP connection to already-running Chrome
    const cdpOk = await tryViaCDP(cookieFile, baseUrl);
    if (cdpOk) return true;

    // b) Try launching Chrome with the user's profile
    if (!chromePath) {
        console.log("   ⚠️  Chrome binary not found. Skipping profile auth.");
        return false;
    }
    if (!profileDir) {
        console.log("   ⚠️  Chrome profile directory not found. Skipping profile auth.");
        return false;
    }

    return await tryViaPersistentContext(chromePath, profileDir, cookieFile, baseUrl);
}

// ── a) CDP approach ───────────────────────────────────────────────────────────

async function tryViaCDP(cookieFile, baseUrl) {
    try {
        const browser = await chromium.connectOverCDP("http://localhost:9222", { timeout: 3000 });
        const contexts = browser.contexts();

        if (!contexts.length) {
            await browser.close();
            return false;
        }

        const context = contexts[0];
        const page    = context.pages()[0] ?? await context.newPage();

        console.log("   🔌 Connected to running Chrome via CDP");

        const loggedIn = await isLoggedIn(page, baseUrl);
        if (loggedIn) {
            console.log("   ✅ Active ZeusX session found via CDP");
            await saveCookies(context, cookieFile);
            await browser.close();
            return true;
        }

        console.log("   ⚠️  No active ZeusX session in running Chrome");
        await browser.close();
        return false;
    } catch {
        // Chrome not running with CDP — this is the normal case
        return false;
    }
}

// ── b) Persistent context (launch Chrome with user's profile) ─────────────────

async function tryViaPersistentContext(chromePath, profileDir, cookieFile, baseUrl) {
    console.log("   🚀 Launching Chrome with user profile...");

    let context;
    try {
        context = await chromium.launchPersistentContext(profileDir, {
            executablePath: chromePath,
            headless: false,
            args: ["--profile-directory=Default", "--no-first-run", "--no-default-browser-check"],
            slowMo: 100,
            timeout: 30000,
        });
    } catch (err) {
        if (err.message.includes("already in use") || err.message.includes("user data directory")) {
            console.log("   ⚠️  Chrome is already running with this profile.");
            console.log("   💡 Close Chrome and try again, or launch Chrome with:");
            console.log("      google-chrome --remote-debugging-port=9222");
            return false;
        }
        console.log(`   ❌ Could not launch Chrome: ${err.message}`);
        return false;
    }

    try {
        const page = context.pages()[0] ?? await context.newPage();

        await delay(1500);

        const loggedIn = await isLoggedIn(page, baseUrl);
        if (loggedIn) {
            console.log("   ✅ Active ZeusX session found in Chrome profile");
            await saveCookies(context, cookieFile);
            return true;
        }

        console.log("   ⚠️  No active ZeusX session in Chrome profile");
        console.log("   👆 Please log into ZeusX in the Chrome window that just opened.");
        console.log("   ⏳ Waiting up to 5 minutes for manual login...\n");

        // Wait for user to login in the opened Chrome window
        const TIMEOUT  = 5 * 60 * 1000;
        const deadline = Date.now() + TIMEOUT;

        while (Date.now() < deadline) {
            await delay(3000);
            if (await isLoggedIn(page, baseUrl).catch(() => false)) {
                console.log("   ✅ Login detected in Chrome profile");
                await saveCookies(context, cookieFile);
                return true;
            }
        }

        console.log("   ❌ Login timed out in Chrome profile window.");
        return false;
    } finally {
        await context.close().catch(() => {});
    }
}
