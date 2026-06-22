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
    await fillPricingSection(page, template["Default price (unit)"], template["Minimum purchase quantity"]);
    await fillMediaGallery(page, template.mediaData || []);

    const isInstant = Number(template["Instant delivery"]) === 1;
    if (isInstant) {
        await selectInstantDelivery(page);
    } else {
        await selectManualDelivery(page);
        await page.waitForTimeout(1000);
        await setDeliveryHour(page, template["Delivery hour"]);
        await page.waitForTimeout(1000);
        await setDeliveryMinute(page, template["Delivery minute"]);
    }

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

    // Section index 0 = Service/type selector (pre-filled by navigation — skip).
    // Section index 1 = game-specific attributes (Levels, Details, etc.).
    const section = page.locator(".g-cu-form-card__section").nth(1);
    if ((await section.count()) === 0) {
        console.log("❌ Game details section not found on page");
        return;
    }

    // Each field is a col-12 wrapper that contains a label+input row.
    // The inner columns (col-md-4 label, col-md-8 input) also carry col-12,
    // so exclude any div that has a col-md-* class to land on field wrappers only.
    const fieldEls = section.locator(".col-12:not([class*='col-md'])");

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
    // Section index 2: Title & Description (after Service=0, Levels=1).
    const section = page.locator(".g-cu-form-card__section").nth(2);
    if ((await section.count()) === 0) {
        console.log("❌ Title/Description section not found");
        return;
    }

    // Go directly to input/textarea instead of field wrappers. The col-12
    // structure in this section can have nested col-12s that break index-based
    // selection. Title is always a single-line input; description is a textarea.
    if (title) {
        const titleInput = section.locator("input:not([type=hidden])").first();
        if ((await titleInput.count()) === 0) {
            console.log("❌ Title input not found");
        } else {
            await humanDelay(300, 600);
            await titleInput.click({ clickCount: 3 });
            await titleInput.fill(title);
            console.log(`✅ Filled Title: ${title}`);
            await page.waitForTimeout(500);
        }
    }

    if (description) {
        const descInput = section.locator("textarea").first();
        if ((await descInput.count()) === 0) {
            console.log("❌ Description textarea not found");
        } else {
            await humanDelay(300, 600);
            await descInput.click({ clickCount: 3 });
            await descInput.fill(description);
            console.log("✅ Filled Description");
            await page.waitForTimeout(500);
        }
    }
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

async function fillPricingSection(page, price, minQuantity) {
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

        if (minQuantity !== undefined && minQuantity !== null) {
            const minQtyInput = section.locator("input.q-field__native").nth(1);
            if ((await minQtyInput.count()) > 0) {
                await minQtyInput.fill("");
                await minQtyInput.type(String(minQuantity), { delay: 80 });
                console.log(`✅ Filled min quantity: ${minQuantity}`);
            }
        }

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
        const radio = await resolveDeliveryRadio(page, "Manual delivery", /manual/i);
        if (!radio) {
            console.log("❌ Manual delivery radio not found");
            return;
        }
        if ((await radio.getAttribute("aria-checked")) === "true") {
            console.log("✅ Manual delivery already selected");
        } else {
            await radio.click();
            console.log("✅ Selected Manual delivery");
            await page.waitForTimeout(1000);
        }
    } catch (error) {
        console.error("❌ Failed to select Manual delivery:", error.message);
    }
}

async function selectInstantDelivery(page) {
    try {
        const radio = await resolveDeliveryRadio(page, "Instant delivery", /instant/i);
        if (!radio) {
            console.log("❌ Instant delivery radio not found");
            return;
        }
        if ((await radio.getAttribute("aria-checked")) !== "true") {
            await radio.click();
            console.log("✅ Selected Instant delivery");
            await page.waitForTimeout(1000);
        }
    } catch (error) {
        console.error("❌ Failed to select Instant delivery:", error.message);
    }
}

/**
 * Find a delivery-type radio button. Tries aria-label first (exact match),
 * then falls back to role+text for cases where g2g changes label casing/wording.
 */
async function resolveDeliveryRadio(page, ariaLabel, textPattern) {
    let radio = page.locator(`div[role="radio"][aria-label="${ariaLabel}"]`);
    if ((await radio.count()) > 0) return radio.first();

    // Fallback: any role=radio whose visible text contains the keyword
    radio = page.locator('div[role="radio"]').filter({ hasText: textPattern });
    if ((await radio.count()) > 0) return radio.first();

    // Last resort: look inside the delivery section for a clickable label
    radio = page
        .locator('.g-cu-form-card__section')
        .filter({ hasText: textPattern })
        .locator('div[role="radio"]')
        .first();
    if ((await radio.count()) > 0) return radio;

    return null;
}

async function setDeliveryHour(page, hourValue) {
    try {
        // Try the specific .left selector first; fall back to first button in the container
        let dropdown = page.locator("div.g-select-text-input .left button").last();
        if ((await dropdown.count()) === 0) {
            dropdown = page.locator("div.g-select-text-input button").first();
        }
        if ((await dropdown.count()) === 0) {
            console.log("❌ Delivery hour dropdown button not found");
            return false;
        }

        await dropdown.click();
        await page.waitForTimeout(500);

        // Match by leading number: "0 hours", "0 hr", "0h", etc.
        const option = page
            .locator(".q-virtual-scroll__content .q-item__section")
            .filter({ hasText: new RegExp(`^\\s*${escapeRegex(String(hourValue))}\\b`) })
            .first();
        if ((await option.count()) === 0) {
            await page.keyboard.press("Escape").catch(() => {});
            console.log(`❌ Delivery hour option not found for value: ${hourValue}`);
            return false;
        }

        const chosenText = await option.innerText().then(t => t.trim()).catch(() => hourValue);
        await option.scrollIntoViewIfNeeded();
        await option.click({ force: true });
        console.log(`✅ Delivery hour: ${chosenText}`);
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
        // Try the specific .right selector first; fall back to last button in the container
        let dropdown = page.locator("div.g-select-text-input .right button").first();
        if ((await dropdown.count()) === 0) {
            dropdown = page.locator("div.g-select-text-input button").last();
        }
        if ((await dropdown.count()) === 0) {
            console.log("❌ Delivery minute dropdown button not found");
            return false;
        }

        await dropdown.click();
        await page.waitForTimeout(500);

        // Match by leading number: "30 mins", "30 min", "30m", etc.
        const option = page
            .locator(".q-virtual-scroll__content .q-item__section")
            .filter({ hasText: new RegExp(`^\\s*${escapeRegex(String(minValue))}\\b`) })
            .first();
        if ((await option.count()) === 0) {
            await page.keyboard.press("Escape").catch(() => {});
            console.log(`❌ Delivery minute option not found for value: ${minValue}`);
            return false;
        }

        const chosenText = await option.innerText().then(t => t.trim()).catch(() => minValue);
        await option.scrollIntoViewIfNeeded();
        await option.click({ force: true });
        console.log(`✅ Delivery minute: ${chosenText}`);
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
    // Label lives in the col-md-4 sub-column; button in the col-md-8 sub-column.
    // Both are descendants of fieldEl, so we can reach them directly.
    const label = await fieldEl.locator(".text-font-2nd").first()
        .innerText().then(t => t.trim()).catch(() => "?");

    const btn = fieldEl.locator(".g-btn-select").first();

    try {
        console.log(`🔽 Selecting ${label} = ${value}`);
        await humanDelay(300, 500);
        await btn.click({ force: true });
        await page.waitForTimeout(500);

        // The dropdown card renders inline inside fieldEl (not in a portal).
        const filterInput = fieldEl.locator('input[placeholder="Type to filter"]').first();
        if ((await filterInput.count()) === 0) {
            await ensureDropdownClosed(page, fieldEl, btn);
            console.log(`❌ Filter input not found for "${label}"`);
            return false;
        }

        await filterInput.fill(value);
        await page.waitForTimeout(700);

        // Prefer exact match; fall back to first visible option after filtering.
        // g2g may display "70+" or "95+" for API values stored as "70" or "95".
        const allOptions = fieldEl.locator(".q-item__section");
        const exactMatch = allOptions.filter({
            hasText: new RegExp(`^\\s*${escapeRegex(value)}\\s*$`),
        });

        const option = (await exactMatch.count()) > 0
            ? exactMatch.first()
            : allOptions.first();

        if ((await option.count()) === 0) {
            await ensureDropdownClosed(page, fieldEl, btn);
            console.log(`❌ No option found for "${value}" in "${label}" dropdown`);
            return false;
        }

        const chosenText = await option.innerText().then(t => t.trim()).catch(() => value);
        await option.click({ force: true });
        await page.waitForTimeout(600);
        console.log(`✅ Selected ${label}: ${chosenText}`);
        return true;
    } catch (error) {
        console.error(`❌ Dropdown "${label}":`, error.message);
        await ensureDropdownClosed(page, fieldEl, btn);
        return false;
    }
}

/**
 * Ensure a g2g inline dropdown is closed.
 * Pressing Escape alone is unreliable — if it fails, clicking the toggle button
 * a second time closes it. This prevents the open dropdown from blocking the
 * next field's button click.
 */
async function ensureDropdownClosed(page, fieldEl, btn) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
    if ((await fieldEl.locator('input[placeholder="Type to filter"]').count()) > 0) {
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
    }
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fillInputField(page, fieldEl, value, label = "field") {
    try {
        // .q-field__native is the wrapper <div>; the actual editable element is
        // the <input> or <textarea> inside it (or directly on the element in
        // some Quasar versions). Target it directly to avoid the fill() error.
        const input = fieldEl.locator("input:not([type=hidden]), textarea").first();
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
