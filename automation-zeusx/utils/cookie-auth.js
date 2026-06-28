import fs from "fs";
import { delay } from "./index.js";

// ─── Save / Load ──────────────────────────────────────────────────────────────

export async function saveCookies(context, cookieFile) {
    try {
        await context.storageState({ path: cookieFile });
        const state = JSON.parse(fs.readFileSync(cookieFile, "utf8"));
        console.log(`   💾 Saved ${state.cookies?.length ?? 0} cookies → ${cookieFile}`);
        return true;
    } catch (err) {
        console.error("   ❌ Failed to save cookies:", err.message);
        return false;
    }
}

export async function loadCookies(context, cookieFile) {
    try {
        if (!fs.existsSync(cookieFile)) return false;

        const state = JSON.parse(fs.readFileSync(cookieFile, "utf8"));
        if (!state.cookies?.length) return false;

        await context.clearCookies();
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

        console.log(`   🍪 Loaded ${state.cookies.length} cookies from ${cookieFile}`);
        return true;
    } catch (err) {
        console.error("   ❌ Failed to load cookies:", err.message);
        return false;
    }
}

// ─── Session check ────────────────────────────────────────────────────────────
//
// Checks for the authenticated header element (div.header_right-side__YvA9U)
// which contains the "Sell Item" button and user avatar — only present when logged in.

export async function isLoggedIn(page, baseUrl) {
    try {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await delay(1500);

        const url = page.url();
        if (/\/(login|signin|sign-in|auth\/login)/i.test(url)) return false;

        return await page
            .locator("div.header_right-side__YvA9U")
            .first()
            .isVisible({ timeout: 5000 })
            .catch(() => false);
    } catch {
        return false;
    }
}

// ─── Tier 1: Cookie auth ──────────────────────────────────────────────────────

export async function tryCookieAuth(page, context, cookieFile, baseUrl) {
    const hasCookies = await loadCookies(context, cookieFile);
    if (!hasCookies) {
        console.log("   ℹ️  No cookie file found.");
        return false;
    }

    process.stdout.write("   🔍 Validating saved session... ");
    const valid = await isLoggedIn(page, baseUrl);

    if (valid) {
        console.log("✅ Valid");
        return true;
    }

    console.log("⚠️  Session expired or invalid");
    await context.clearCookies();
    return false;
}
