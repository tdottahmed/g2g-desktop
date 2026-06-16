import fs from "fs";
import { delay } from "./index.js";

// ─── Cookie persistence ───────────────────────────────────────────────────────

export async function saveAuthState(context, authFile) {
    try {
        await context.storageState({ path: authFile });

        if (fs.existsSync(authFile)) {
            const state = JSON.parse(fs.readFileSync(authFile, "utf8"));
            const count = state.cookies?.length ?? 0;
            console.log(`   💾 Saved ${count} cookies → ${authFile}`);
            return true;
        }
        console.log("   ❌ Cookie file was not created");
        return false;
    } catch (error) {
        console.error("   ❌ Failed to save cookies:", error.message);
        return false;
    }
}

export async function loadAuthState(context, authFile) {
    try {
        if (!fs.existsSync(authFile)) {
            return false;
        }

        const state = JSON.parse(fs.readFileSync(authFile, "utf8"));

        await context.clearCookies();

        if (!state.cookies?.length) {
            return false;
        }

        await context.addCookies(state.cookies);

        if (state.origins?.length) {
            for (const origin of state.origins) {
                if (origin.localStorage?.length) {
                    await context.addInitScript((storage) => {
                        for (const item of storage) {
                            window.localStorage.setItem(item.name, item.value);
                        }
                    }, origin.localStorage);
                }
            }
        }

        console.log(`   🍪 Loaded ${state.cookies.length} cookies from ${authFile}`);
        return true;
    } catch (error) {
        console.error("   ❌ Failed to load cookies:", error.message);
        return false;
    }
}

// ─── Login status check ───────────────────────────────────────────────────────

export async function isLoggedIn(page, baseUrl) {
    try {
        await page.goto(`${baseUrl}/`, {
            waitUntil: "domcontentloaded",
            timeout: 20000,
        });

        const url = page.url();
        if (url.includes("/login") || url.includes("/sign-in")) return false;

        // Login link visible → not logged in
        if ((await page.locator('a[href*="login"], a[href*="sign-in"]').count()) > 0) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}

// ─── High-level auth wrapper (used by runner.js) ──────────────────────────────

/**
 * Ensures the browser session is authenticated.
 * 1. Loads cookies if they exist
 * 2. Checks if the session is still valid
 * 3. If not valid → opens login page, auto-fills credentials, waits for user
 *    to handle OTP / CAPTCHA in the visible browser
 * 4. Saves fresh cookies on success
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {{ baseUrl: string, email: string, password: string, cookieFile: string }} config
 * @returns {Promise<boolean>}
 */
export async function ensureLoggedIn(page, context, { baseUrl, email, password, cookieFile }) {
    // ── Step 1: try existing cookies ─────────────────────────────────────────
    const hasCookies = await loadAuthState(context, cookieFile);

    if (hasCookies) {
        process.stdout.write("   🔍 Checking session validity... ");
        const valid = await isLoggedIn(page, baseUrl);
        if (valid) {
            console.log("✅ Valid");
            return true;
        }
        console.log("⚠️  Expired or invalid");
        await context.clearCookies();
    } else {
        console.log("   ℹ️  No cookie file — fresh login needed");
    }

    // ── Step 2: perform login ────────────────────────────────────────────────
    const success = await performLogin(page, { baseUrl, email, password });

    if (!success) {
        return false;
    }

    // ── Step 3: save fresh cookies ───────────────────────────────────────────
    await saveAuthState(context, cookieFile);
    return true;
}

// ─── Login flow (internal) ────────────────────────────────────────────────────

async function performLogin(page, { baseUrl, email, password }) {
    console.log("\n   ─────────────────────────────────────────────────");
    console.log("   🔐 LOGIN REQUIRED");
    console.log("   ─────────────────────────────────────────────────");
    console.log(`   Account : ${email}`);
    console.log("   Browser : Opening login page now...\n");

    // Navigate to login page
    try {
        await page.goto(`${baseUrl}/login`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });
    } catch {
        try {
            await page.goto(`${baseUrl}/login`, {
                waitUntil: "load",
                timeout: 30000,
            });
        } catch (err) {
            console.error("   ❌ Could not open login page:", err.message);
            return false;
        }
    }

    await delay(2500);

    // Already redirected away from login? Check if logged in
    if (!page.url().includes("/login")) {
        if (await isLoggedIn(page, baseUrl).catch(() => false)) {
            console.log("   ✅ Already logged in\n");
            return true;
        }
    }

    // Auto-fill credentials
    const filled = await fillCredentials(page, email, password);
    if (filled) {
        console.log("   ✅ Credentials submitted — waiting for response...");
    } else {
        console.log("   ⚠️  Auto-fill failed or skipped.");
        console.log("   👆 Please manually enter your email and password in the browser.\n");
    }

    // Wait for the user to fully complete login (OTP, CAPTCHA, etc.)
    return await waitForLoginSuccess(page, baseUrl);
}

async function fillCredentials(page, email, password) {
    try {
        // Wait for the login form
        await page.waitForSelector(
            'input[type="email"], input[name="email"], input[data-attr="username-input"], input[placeholder*="email" i]',
            { timeout: 15000 }
        );

        // Fill email
        const emailInput = page.locator(
            'input[type="email"], input[name="email"], input[data-attr="username-input"]'
        ).first();
        await emailInput.click();
        await emailInput.fill(email);
        await delay(700);

        // Fill password
        const pwInput = page.locator(
            'input[type="password"], input[name="password"], input[placeholder*="password" i]'
        ).first();
        await pwInput.click();
        await pwInput.fill(password);
        await delay(700);

        // Submit
        const submitBtn = page.locator('button[type="submit"]').first();
        if ((await submitBtn.count()) === 0) {
            throw new Error("Submit button not found");
        }
        await submitBtn.click();
        return true;
    } catch (err) {
        console.log(`   ⚠️  Auto-fill error: ${err.message}`);
        return false;
    }
}

async function waitForLoginSuccess(page, baseUrl) {
    const TIMEOUT_MS  = 5 * 60 * 1000; // 5 minutes
    const CHECK_EVERY = 2000;           // poll every 2 s
    const REMIND_EVERY = 30000;         // console reminder every 30 s

    const deadline = Date.now() + TIMEOUT_MS;
    let lastReminder = Date.now();
    let otpPromptShown = false;
    let errorMessageShown = "";

    console.log("   ──────────────────────────────────────────────────────");
    console.log("   ⏳ Waiting for login to complete in the browser...");
    console.log("      (timeout: 5 minutes)");
    console.log("   ──────────────────────────────────────────────────────\n");

    while (Date.now() < deadline) {
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        const url = page.url();

        // ── Success: left the login page ──────────────────────────────────
        if (!url.includes("/login") && !url.includes("/sign-in")) {
            const loggedIn = await isLoggedIn(page, baseUrl).catch(() => false);
            if (loggedIn) {
                console.log("   ✅ Login successful!\n");
                return true;
            }
        }

        // ── OTP / verification code screen ────────────────────────────────
        const otpLocator = page.locator(
            "input.otp-input, " +
            "input[name*='otp' i], " +
            "input[placeholder*='OTP' i], " +
            "input[placeholder*='verification' i], " +
            "input[placeholder*='Enter code' i], " +
            "input[placeholder*='Security code' i]"
        );
        if ((await otpLocator.count()) > 0 && !otpPromptShown) {
            const mins = Math.ceil(remaining / 60);
            console.log("   📱 OTP / verification code required!");
            console.log("   👆 Check your email or phone and enter the code in the browser.");
            console.log(`   ⏱️  You have ${mins} minute${mins !== 1 ? "s" : ""} to complete this.\n`);
            otpPromptShown = true;
        }

        // ── Login error messages ───────────────────────────────────────────
        const errLocator = page.locator(
            ".g-error-message, .g-alert-error, " +
            "[class*='error-msg'], [class*='login-error'], " +
            ".alert-danger, .toast-error, " +
            "div[class*='toast'][class*='negative']"
        );
        if ((await errLocator.count()) > 0) {
            const errText = (await errLocator.first().innerText().catch(() => "")).trim();
            if (errText && errText !== errorMessageShown) {
                console.log(`   ❌ Error: ${errText}`);
                console.log("   👆 Please fix it in the browser and try again.\n");
                errorMessageShown = errText;
                otpPromptShown = false; // reset so messages can re-fire if needed
            }
        }

        // ── Periodic reminder ─────────────────────────────────────────────
        if (Date.now() - lastReminder > REMIND_EVERY) {
            const mins = Math.ceil(remaining / 60);
            console.log(`   ⏳ Still waiting... ${mins} min left — complete login in the browser`);
            lastReminder = Date.now();
        }

        await delay(CHECK_EVERY);
    }

    console.log("   ❌ Login timed out after 5 minutes.\n");
    return false;
}

// ─── Legacy export (used by post-offers.js) ───────────────────────────────────

export async function loginWithOTP(page, baseUrl, email, password) {
    return performLogin(page, { baseUrl, email, password });
}

export async function clearProblematicStorage(page) {
    try {
        await page.evaluate(() => {
            localStorage.clear();
            sessionStorage.clear();
        });
        const cookies = await page.context().cookies();
        for (const cookie of cookies.filter(
            (c) => c.name.includes("track") || c.name.includes("session") || c.name.includes("auth")
        )) {
            await page.context().clearCookies({ name: cookie.name, domain: cookie.domain });
        }
        return true;
    } catch {
        return false;
    }
}
