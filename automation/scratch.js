import { chromium } from "playwright";
import fs from "fs";
import { clickAccountsCategory, selectGameBrand, clickContinueButton } from "./utils/sell.js";

async function run() {
    console.log("Starting browser...");
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    
    // Load cookies
    const cookiePath = "automation/cookies/abdullah0199019.json";
    if (fs.existsSync(cookiePath)) {
        const state = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
        await context.addCookies(state.cookies);
        console.log("Loaded cookies");
    } else {
        console.log("No cookies found at", cookiePath);
        process.exit(1);
    }
    
    const page = await context.newPage();
    await page.goto("https://www.g2g.com/offers/sell", { waitUntil: "domcontentloaded" });
    console.log("On sell page.");
    
    await clickAccountsCategory(page);
    
    await page.waitForTimeout(2000);
    // Dismiss popup just in case
    await page.locator('.q-card:has-text("Protect Your Account") button:has-text("Understood")').click().catch(() => {});
    
    await selectGameBrand(page, "Mobile Legends");
    await page.waitForTimeout(2000);
    await clickContinueButton(page);
    
    await page.waitForTimeout(3000);
    
    const section = page.locator(".g-cu-form-card__section").nth(1);
    const html = await section.innerHTML();
    fs.writeFileSync("dom_dump.html", html);
    console.log("Saved dom_dump.html");
    
    await browser.close();
}

run().catch(console.error);
