import { delay, humanType, humanDelay } from "./index.js";
import { isLoggedIn } from "./cookie-auth.js";

// ─── Manual login (headed browser, user handles OTP/CAPTCHA) ─────────────────

export async function tryManualAuth(page, _context, { baseUrl, email, password }) {
    console.log("\n   ─────────────────────────────────────────────────");
    console.log("   🔐 MANUAL LOGIN REQUIRED");
    console.log("   ─────────────────────────────────────────────────");
    console.log(`   Account : ${email || "(no credentials configured)"}`);
    console.log("   Browser : Opening ZeusX login page now...\n");

    try {
        await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch {
        try {
            await page.goto(`${baseUrl}/login`, { waitUntil: "load", timeout: 30000 });
        } catch (err) {
            console.error("   ❌ Could not open login page:", err.message);
            return false;
        }
    }

    await delay(2000);

    // Already logged in after navigating to /login?
    if (!page.url().includes("/login")) {
        if (await isLoggedIn(page, baseUrl).catch(() => false)) {
            console.log("   ✅ Already logged in\n");
            return true;
        }
    }

    // Auto-fill credentials if provided
    if (email && password) {
        const filled = await fillCredentials(page, email, password);
        if (filled) {
            console.log("   ✅ Credentials auto-filled and submitted.");
        } else {
            console.log("   ⚠️  Auto-fill skipped — please fill in your credentials manually.");
        }
    } else {
        console.log("   ⚠️  No credentials configured — please log in manually in the browser.");
    }

    return await waitForLoginSuccess(page, baseUrl);
}

// ─── Credential auto-fill ─────────────────────────────────────────────────────

async function fillCredentials(page, email, password) {
    try {
        await page.waitForSelector(
            'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="Email" i]',
            { timeout: 12000 }
        );

        const emailInput = page.locator(
            'input[type="email"], input[name="email"], input[placeholder*="email" i]'
        ).first();
        await emailInput.click();
        await humanType(emailInput, email);
        await humanDelay(500, 900);

        const pwInput = page.locator(
            'input[type="password"], input[name="password"]'
        ).first();
        await pwInput.click();
        await humanType(pwInput, password);
        await humanDelay(500, 900);

        const submitBtn = page.locator('button[type="submit"]').first();
        if ((await submitBtn.count()) === 0) throw new Error("Submit button not found");
        await submitBtn.click();

        return true;
    } catch (err) {
        console.log(`   ⚠️  Auto-fill error: ${err.message}`);
        return false;
    }
}

// ─── Wait for login success ───────────────────────────────────────────────────

async function waitForLoginSuccess(page, baseUrl) {
    const TIMEOUT_MS   = 5 * 60 * 1000;
    const CHECK_EVERY  = 2000;
    const REMIND_EVERY = 30000;

    const deadline = Date.now() + TIMEOUT_MS;
    let lastReminder    = Date.now();
    let otpPromptShown  = false;
    let lastErrText     = "";

    console.log("   ──────────────────────────────────────────────────────");
    console.log("   ⏳ Waiting for login to complete in the browser...");
    console.log("      (timeout: 5 minutes)");
    console.log("   ──────────────────────────────────────────────────────\n");

    while (Date.now() < deadline) {
        const url = page.url();

        // Left the login page → check if actually authenticated
        if (!url.includes("/login") && !url.includes("/signin") && !url.includes("/sign-in")) {
            const loggedIn = await isLoggedIn(page, baseUrl).catch(() => false);
            if (loggedIn) {
                console.log("   ✅ Login successful!\n");
                return true;
            }
        }

        // OTP / verification code screen
        const otpLocator = page.locator(
            "input.otp-input, input[name*='otp' i], input[placeholder*='OTP' i], " +
            "input[placeholder*='code' i], input[placeholder*='verification' i]"
        );
        if ((await otpLocator.count()) > 0 && !otpPromptShown) {
            const remaining = Math.ceil((deadline - Date.now()) / 60000);
            console.log("   📱 OTP / verification code required!");
            console.log(`   👆 Enter the code in the browser. ${remaining} min remaining.\n`);
            otpPromptShown = true;
        }

        // Error messages
        const errLocator = page.locator(
            "[class*='error'], [class*='alert-danger'], .toast-error, " +
            "[role='alert']:visible"
        );
        if ((await errLocator.count()) > 0) {
            const errText = (await errLocator.first().innerText().catch(() => "")).trim();
            if (errText && errText !== lastErrText) {
                console.log(`   ❌ Error: ${errText}`);
                console.log("   👆 Fix the issue in the browser and try again.\n");
                lastErrText    = errText;
                otpPromptShown = false;
            }
        }

        if (Date.now() - lastReminder > REMIND_EVERY) {
            const mins = Math.ceil((deadline - Date.now()) / 60000);
            console.log(`   ⏳ Still waiting... ${mins} min left — complete login in the browser`);
            lastReminder = Date.now();
        }

        await delay(CHECK_EVERY);
    }

    console.log("   ❌ Login timed out after 5 minutes.\n");
    return false;
}
