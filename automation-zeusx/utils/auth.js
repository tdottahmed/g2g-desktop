import { isLoggedIn } from "./cookie-auth.js";
import { tryManualAuth } from "./manual-auth.js";

// ─── Auth coordinator ─────────────────────────────────────────────────────────
//
// Uses the "zeusx" Chrome profile exclusively — no cookie files.
//
//  1. Check if the profile already has an active ZeusX session
//  2. If not: open the login page and auto-fill credentials;
//             user handles OTP / CAPTCHA in the same Chrome window

export async function ensureLoggedIn(page, context, config) {
    const { baseUrl, email, password } = config;

    console.log("   [Auth] Checking Chrome profile session...");
    const loggedIn = await isLoggedIn(page, baseUrl);

    if (loggedIn) {
        console.log("   ✅ Active ZeusX session found in Chrome profile");
        return true;
    }

    console.log("   ⚠️  No active session — opening login page...");
    return await tryManualAuth(page, context, { baseUrl, email, password });
}
