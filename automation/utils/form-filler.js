/**
 * Playwright form-filling helpers for g2g.com offer creation.
 * Supports all 6 games via GAME_FIELD_SPECS in templates/games.js.
 */

import { GAME_FIELD_SPECS } from "../templates/games.js";
import { humanDelay } from "./index.js";

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fill every field in the g2g.com offer form for one template. */
export async function fillOfferForm(page, template) {
    const game     = template.game || "clash_of_clans";
    const gameData = template.game_data || {};

    console.log(`📝 Filling form: "${template.Title}" [${game}]`);

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    await fillGameDetails(page, game, gameData);
    await fillTitleAndDescription(page, template.Title, template.Description);
    await fillPricingSection(page, template["Default price (unit)"]);
    await fillMediaGallery(page, template.mediaData || []);
    await selectManualDelivery(page);
    await page.waitForTimeout(1000);
    await setDeliveryHour(page, template["Delivery hour"]);
    await page.waitForTimeout(1000);
    await setDeliveryMinute(page, template["Delivery minute"]);

    console.log(`✅ Form filled: "${template.Title}"`);
}

/** Submit and click 'Add new offer' → 'Continue' to open a blank form for the next offer. */
export async function submitFormAndAddNew(page) {
    console.log("🚀 Submitting form...");
    await submitForm(page);

    const successDialog = page.locator(
        '.q-dialog__inner .q-card:has-text("Your offer has been published")'
    );
    try {
        await successDialog.waitFor({ state: "visible", timeout: 30000 });
        console.log("✅ Success dialog appeared");
    } catch {
        console.log("⚠️  Success dialog not detected, continuing...");
    }

    const addNewOfferBtn = page.locator('button:has-text("Add new offer")');
    try {
        await addNewOfferBtn.waitFor({ state: "visible", timeout: 15000 });
        await addNewOfferBtn.click();
        console.log("✅ Clicked 'Add new offer'");

        await page.waitForSelector('a:has-text("Continue")', { timeout: 20000 });
        await page.locator('a:has-text("Continue")').click();
        console.log("✅ Clicked Continue for next offer");
        return true;
    } catch {
        console.log("❌ 'Add new offer' flow failed");
        return false;
    }
}

/** Click the Publish button (final submit, no next-offer flow). */
export async function submitForm(page) {
    try {
        const publishBtn = page.locator('button:has-text("Publish")').first();
        if ((await publishBtn.count()) === 0) {
            console.log("❌ Publish button not found");
            return false;
        }
        await publishBtn.scrollIntoViewIfNeeded();
        await publishBtn.click({ force: true });
        await page.waitForTimeout(1000);
        console.log("✅ Publish clicked");
        return true;
    } catch (error) {
        console.error("❌ Failed to click Publish:", error.message);
        return false;
    }
}

// ─── Game-specific detail section ────────────────────────────────────────────

/**
 * Fill the game-specific attributes section (Section 2 on the g2g.com form —
 * "Levels" for CoC, "Details" for other games).
 *
 * Fields are located by their index within the section, in the order defined
 * in GAME_FIELD_SPECS. If g2g.com's actual field order differs, adjust the
 * spec in templates/games.js.
 */
async function fillGameDetails(page, game, gameData) {
    const specs = GAME_FIELD_SPECS[game];
    if (!specs) {
        console.log(`⚠️  No field spec for game "${game}" — skipping game details`);
        return;
    }

    // Section 1 (0-indexed = 0): game-specific attributes (Levels, Details, etc.)
    const section = page.locator(".g-cu-form-card__section").nth(0);
    if ((await section.count()) === 0) {
        console.log("❌ Game details section not found on page");
        return;
    }

    // Each field is a div.col-12 inside the div.row.q-col-gutter-lg wrapper.
    // Within each col-12: div:nth-child(1) = label col, div:nth-child(2) = input col.
    const fieldEls = section.locator("div.q-col-gutter-lg > div");

    for (let i = 0; i < specs.length; i++) {
        const { key, label, type } = specs[i];
        const value = gameData[key];

        if (value === undefined || value === null || value === "") {
            console.log(`⏭  Skipping ${label} (no value in game_data)`);
            continue;
        }

        const fieldEl = fieldEls.nth(i);
        if ((await fieldEl.count()) === 0) {
            console.log(`⚠️  Field "${label}" (index ${i}) not found — check GAME_FIELD_SPECS order`);
            continue;
        }

        if (type === "dropdown") {
            await selectDropdownOption(page, fieldEl, String(value));
        } else {
            await fillInputField(page, fieldEl, String(value), label);
        }
        await page.waitForTimeout(500);
    }
}

// ─── Title & Description ──────────────────────────────────────────────────────

async function fillTitleAndDescription(page, title, description) {
    // Section 2 (0-indexed = 1): Title & Description text inputs
    const section = page.locator(".g-cu-form-card__section").nth(1);
    if ((await section.count()) === 0) {
        console.log("❌ Title/Description section not found");
        return;
    }

    const fields = section.locator("div.q-col-gutter-lg > div");

    if (title) {
        await fillInputField(page, fields.nth(0), title, "Title");
        await page.waitForTimeout(500);
    }
    if (description) {
        await fillInputField(page, fields.nth(1), description, "Description");
        await page.waitForTimeout(500);
    }
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

async function fillPricingSection(page, price) {
    try {
        const section = page
            .locator(".g-cu-form-card__section:has-text('Pricing')")
            .first();
        if ((await section.count()) === 0) {
            console.log("❌ Pricing section not found");
            return false;
        }

        const input = section.locator("input.q-field__native").first();
        if ((await input.count()) === 0) {
            console.log("❌ Price input not found");
            return false;
        }

        await input.fill("");
        await input.type(String(price), { delay: 80 });
        console.log(`✅ Filled price: ${price}`);
        return true;
    } catch (error) {
        console.error("❌ Failed to fill price:", error.message);
        return false;
    }
}

// ─── Media gallery ────────────────────────────────────────────────────────────

async function fillMediaGallery(page, medias = []) {
    if (!medias.length) return;

    try {
        const section = page
            .locator(".g-cu-form-card__section:has-text('Media gallery')")
            .first();
        if ((await section.count()) === 0) {
            console.log("❌ Media gallery section not found");
            return false;
        }

        for (let i = 0; i < medias.length; i++) {
            const { title, Link } = medias[i];

            if (i > 0) {
                const addBtn = section.locator("button:has-text('Add media')").first();
                if ((await addBtn.count()) > 0) {
                    await addBtn.click();
                    await page.waitForTimeout(500);
                }
            }

            const titleInput = section.locator('input[placeholder="Media title"]').nth(i);
            if ((await titleInput.count()) > 0) {
                await titleInput.fill("");
                await titleInput.click();
                await pasteText(page, title);
                console.log(`📋 Media title: ${title}`);
            }

            const linkInput = section.locator('input[placeholder="https://"]').nth(i);
            if ((await linkInput.count()) > 0) {
                await linkInput.fill("");
                await linkInput.click();
                await pasteText(page, Link);
                console.log(`📋 Media link: ${Link}`);
            }

            await page.waitForTimeout(300);
        }
        return true;
    } catch (error) {
        console.error("❌ Failed to fill media gallery:", error.message);
        return false;
    }
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

async function selectManualDelivery(page) {
    try {
        const radio = page.locator('div[role="radio"][aria-label="Manual delivery"]');
        if ((await radio.count()) > 0) {
            if ((await radio.getAttribute("aria-checked")) !== "true") {
                await radio.click();
                console.log("✅ Selected Manual delivery");
                await page.waitForTimeout(1000);
            }
        } else {
            console.log("❌ Manual delivery radio not found");
        }
    } catch (error) {
        console.error("❌ Failed to select Manual delivery:", error.message);
    }
}

async function setDeliveryHour(page, hourValue) {
    try {
        const text    = Number(hourValue) === 1 ? "1 hour" : `${hourValue} hours`;
        const dropdown = page.locator("div.g-select-text-input .left button").last();
        if ((await dropdown.count()) === 0) return false;

        await dropdown.click();
        await page.waitForTimeout(500);

        const option = page
            .locator(".q-virtual-scroll__content .q-item__section", { hasText: text })
            .first();
        if ((await option.count()) === 0) {
            await page.keyboard.press("Escape").catch(() => {});
            return false;
        }

        await option.scrollIntoViewIfNeeded();
        await option.click({ force: true });
        console.log(`✅ Delivery hour: ${text}`);
        await page.waitForTimeout(500);
        return true;
    } catch (error) {
        console.error("❌ Failed to set delivery hour:", error.message);
        await page.keyboard.press("Escape").catch(() => {});
        return false;
    }
}

async function setDeliveryMinute(page, minValue) {
    try {
        const text    = Number(minValue) === 0 ? "0 min" : `${minValue} mins`;
        const dropdown = page.locator("div.g-select-text-input .right button").first();
        if ((await dropdown.count()) === 0) return false;

        await dropdown.click();
        await page.waitForTimeout(500);

        const option = page
            .locator(".q-virtual-scroll__content .q-item__section", { hasText: text })
            .first();
        if ((await option.count()) === 0) {
            await page.keyboard.press("Escape").catch(() => {});
            return false;
        }

        await option.scrollIntoViewIfNeeded();
        await option.click({ force: true });
        console.log(`✅ Delivery minute: ${text}`);
        await page.waitForTimeout(500);
        return true;
    } catch (error) {
        console.error("❌ Failed to set delivery minute:", error.message);
        await page.keyboard.press("Escape").catch(() => {});
        return false;
    }
}

// ─── Low-level field helpers ──────────────────────────────────────────────────

async function selectDropdownOption(page, fieldEl, value) {
    const btn     = fieldEl.locator("div:nth-child(2) .g-btn-select").first();
    const labelEl = fieldEl.locator("div:nth-child(1) .text-font-2nd");
    const label   = await labelEl.first().innerText().then(t => t.trim()).catch(() => "?");

    try {
        console.log(`🔽 Selecting ${label} = ${value}`);
        await humanDelay(300, 500);
        await btn.click({ force: true });

        const wrapper = btn.locator(" + div.relative-position > div:not(.g-input-error)");
        if ((await wrapper.count()) === 0) {
            console.log(`❌ Dropdown wrapper not found for "${label}"`);
            return false;
        }

        const filterInput = wrapper.locator('label input[placeholder="Type to filter"]');
        if ((await filterInput.count()) === 0) return false;

        await filterInput.first().fill(value);
        await page.waitForTimeout(700);

        const menu   = wrapper.locator("div:nth-child(2) .q-virtual-scroll__content");
        const option = menu.locator(`.q-item .q-item__section:has-text("${value}")`).first();

        if ((await option.count()) === 0) {
            await page.keyboard.press("Escape").catch(() => {});
            console.log(`❌ Option "${value}" not found in "${label}" dropdown`);
            return false;
        }

        await option.click({ force: true });
        await page.waitForTimeout(600);
        console.log(`✅ Selected ${label}: ${value}`);
        return true;
    } catch (error) {
        console.error(`❌ Dropdown "${label}":`, error.message);
        await page.keyboard.press("Escape").catch(() => {});
        return false;
    }
}

async function fillInputField(page, fieldEl, value, label = "field") {
    try {
        const input = fieldEl.locator(".q-field__native").first();
        if ((await input.count()) === 0) {
            console.log(`❌ Input not found: ${label}`);
            return false;
        }
        await humanDelay(300, 600);
        await input.click({ clickCount: 3 });
        await input.fill(value);
        console.log(`✅ Filled ${label}: ${value}`);
        await page.waitForTimeout(300);
        return true;
    } catch (error) {
        console.error(`❌ Failed to fill ${label}:`, error.message);
        return false;
    }
}

async function pasteText(page, text) {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.keyboard.press("Control+V");
}
