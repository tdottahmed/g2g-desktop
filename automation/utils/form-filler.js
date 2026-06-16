/**
 * Shared Playwright form-filling helpers for g2g.com offer creation.
 * Used by both post-offers.js (PHP-spawned mode) and runner.js (API mode).
 */

import formStructure from "../templates/offer.js";
import { humanDelay } from "./index.js";

export function getSelector(obj, index, defaultValue) {
    let selector = defaultValue;
    if (obj && obj.selector) {
        selector = obj.selector;
    }
    return selector.replace(":NUMBER:", index + 1);
}

/** Fill every field in the offer form for one template's data. */
export async function fillOfferForm(page, inputData) {
    console.log(`📝 Filling form for: ${inputData.Title}`);

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const { selector: cardSelector, items } = formStructure;

    for (const [cardIndex, cardObj] of items.entries()) {
        if (!cardObj) continue;

        const cardSel = getSelector(cardObj, cardIndex, cardSelector);
        const cardEl  = page.locator(cardSel).first();

        if ((await cardEl.count()) === 0) {
            console.log(`❌ Card not found: ${cardSel}`);
            continue;
        }

        const { items: sectionItems, selector: defaultSectionSelector } = cardObj.sections;

        for (const [sectionIndex, sectionObj] of sectionItems.entries()) {
            if (!sectionObj) continue;

            const sectionSel = getSelector(sectionObj, sectionIndex, defaultSectionSelector);
            const sectionEl  = cardEl.locator(sectionSel).first();

            if ((await sectionEl.count()) === 0) {
                console.log(`❌ Section not found: ${sectionSel}`);
                continue;
            }

            console.log(`Processing section: ${sectionObj.name}`);

            const { items: fieldItems, selector: defaultFieldSelector, type: defaultFieldType } = sectionObj.fields;

            for (const [fieldIndex, fieldObj] of fieldItems.entries()) {
                if (!fieldObj) continue;

                const label    = fieldObj.label;
                const fieldSel = getSelector(fieldObj, fieldIndex, defaultFieldSelector);
                const fieldEl  = sectionEl.locator(fieldSel).nth(fieldIndex);

                if ((await fieldEl.count()) === 0) {
                    console.log(`❌ Field not found: ${fieldSel}`);
                    continue;
                }

                const fieldType = fieldObj.type || defaultFieldType;
                if (!fieldType) {
                    console.log(`❌ Field type not specified: ${fieldSel}`);
                    continue;
                }

                const value = inputData[label];

                switch (fieldType) {
                    case "dropdown":
                        await selectDropdownOption(page, fieldEl, value);
                        await page.waitForTimeout(500);
                        break;
                    case "text":
                        await fillInput(page, fieldEl, value, label);
                        await page.waitForTimeout(500);
                        break;
                    default:
                        console.log(`❌ Unsupported field type: ${fieldType}`);
                }
            }
        }
    }

    await fillPricingSection(page, inputData["Default price (unit)"]);
    await fillMediaGallery(page, inputData.mediaData || []);
    await selectManualDelivery(page);
    await page.waitForTimeout(1000);
    await setDeliveryHour(page, inputData["Delivery hour"]);
    await page.waitForTimeout(1000);
    await setDeliveryMinute(page, inputData["Delivery minute"]);

    console.log(`✅ Form filled: ${inputData.Title}`);
}

/** Submit the current offer form and click 'Add new offer' → 'Continue' for the next one. */
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
        console.log("⚠️ Success dialog not detected, continuing...");
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

/** Click the Publish button (final submit). */
export async function submitForm(page) {
    try {
        console.log("🔧 Clicking Publish...");
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

// ─── Private helpers ──────────────────────────────────────────────────────────

async function selectDropdownOption(page, fieldEl, value) {
    const btn      = fieldEl.locator("div:nth-child(2) .g-btn-select").first();
    const labelEl  = fieldEl.locator("div:nth-child(1) .text-font-2nd");
    const labelText = (await labelEl.first().innerText()).trim();

    try {
        console.log(`Selecting ${labelText} = ${value}`);
        await humanDelay(300, 500);
        await btn.click({ force: true });

        const dropdownWrapper = btn.locator(
            " + div.relative-position > div:not(.g-input-error)"
        );
        if ((await dropdownWrapper.count()) === 0) {
            console.log(`❌ Dropdown wrapper not found for ${labelText}`);
            return false;
        }

        const filterInput = dropdownWrapper.locator('label input[placeholder="Type to filter"]');
        if ((await filterInput.count()) === 0) return false;

        await filterInput.first().fill(value);
        await page.waitForTimeout(700);

        const dropdownMenu = dropdownWrapper.locator("div:nth-child(2) .q-virtual-scroll__content");
        if ((await dropdownMenu.count()) === 0) return false;

        const option = dropdownMenu.locator(`.q-item .q-item__section:has-text("${value}")`);
        if ((await option.count()) === 0) {
            await page.keyboard.press("Escape").catch(() => {});
            return false;
        }

        const firstOption = option.first();
        const innerHTML   = await firstOption.innerHTML();
        if (!innerHTML.toLowerCase().includes(value.toLowerCase())) {
            await page.keyboard.press("Escape").catch(() => {});
            return false;
        }

        await firstOption.click({ force: true });
        await page.waitForTimeout(600);
        console.log(`✅ Selected ${labelText}: ${value}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to select ${labelText}:`, error.message);
        await page.keyboard.press("Escape").catch(() => {});
        return false;
    }
}

async function fillInput(page, fieldEl, value, label = "Input") {
    try {
        const input = fieldEl.locator(".q-field__native").first();
        if ((await input.count()) === 0) {
            console.log(`❌ Input not found: ${label}`);
            return false;
        }
        await humanDelay(800, 1500);
        await input.click({ clickCount: 3 });
        await input.fill(value);
        console.log(`✅ Filled ${label}: ${value}`);
        await page.waitForTimeout(500);
        return true;
    } catch (error) {
        console.error(`❌ Failed to fill ${label}:`, error.message);
        return false;
    }
}

async function fillPricingSection(page, price) {
    try {
        const pricingSection = page
            .locator(".g-cu-form-card__section:has-text('Pricing')")
            .first();

        if ((await pricingSection.count()) === 0) {
            console.log("❌ Pricing section not found");
            return false;
        }

        const priceInput = pricingSection.locator("input.q-field__native").first();
        if ((await priceInput.count()) === 0) {
            console.log("❌ Price input not found");
            return false;
        }

        await priceInput.fill("");
        await priceInput.type(price.toString(), { delay: 100 });
        console.log(`✅ Filled price: ${price}`);
        return true;
    } catch (error) {
        console.error("❌ Failed to fill price:", error.message);
        return false;
    }
}

async function fillMediaGallery(page, medias = []) {
    if (!medias.length) return;

    try {
        const mediaSection = page
            .locator(".g-cu-form-card__section:has-text('Media gallery')")
            .first();

        if ((await mediaSection.count()) === 0) {
            console.log("❌ Media gallery section not found");
            return false;
        }

        for (let i = 0; i < medias.length; i++) {
            const { title, Link } = medias[i];

            if (i > 0) {
                const addBtn = mediaSection.locator("button:has-text('Add media')").first();
                if ((await addBtn.count()) > 0) {
                    await addBtn.click();
                    await page.waitForTimeout(500);
                }
            }

            const titleInput = mediaSection.locator('input[placeholder="Media title"]').nth(i);
            if ((await titleInput.count()) > 0) {
                await titleInput.fill("");
                await titleInput.click();
                await page.evaluate(async (text) => navigator.clipboard.writeText(text), title);
                await page.keyboard.press("Control+V");
                console.log(`📋 Pasted media title: ${title}`);
            }

            const linkInput = mediaSection.locator('input[placeholder="https://"]').nth(i);
            if ((await linkInput.count()) > 0) {
                await linkInput.fill("");
                await linkInput.click();
                await page.evaluate(async (text) => navigator.clipboard.writeText(text), Link);
                await page.keyboard.press("Control+V");
                console.log(`📋 Pasted media link: ${Link}`);
            }

            await page.waitForTimeout(300);
        }
        return true;
    } catch (error) {
        console.error("❌ Failed to fill media gallery:", error.message);
        return false;
    }
}

async function selectManualDelivery(page) {
    try {
        const radio = page.locator('div[role="radio"][aria-label="Manual delivery"]');
        if ((await radio.count()) > 0) {
            const isChecked = await radio.getAttribute("aria-checked");
            if (isChecked !== "true") {
                await radio.click();
                console.log("✅ Selected Manual delivery");
                await page.waitForTimeout(1000);
            } else {
                console.log("ℹ️ Manual delivery already selected");
            }
        } else {
            console.log("❌ Manual delivery radio not found");
            return false;
        }
        return true;
    } catch (error) {
        console.error("❌ Failed to select Manual delivery:", error.message);
        return false;
    }
}

async function setDeliveryHour(page, hourValue) {
    try {
        const hourText   = hourValue == 1 || hourValue == 0 ? `${hourValue} hour` : `${hourValue} hours`;
        const hourDropdown = page.locator("div.g-select-text-input .left button").last();
        if ((await hourDropdown.count()) === 0) return false;

        await hourDropdown.click();
        await page.waitForTimeout(500);

        const option = page.locator(".q-virtual-scroll__content .q-item__section", { hasText: hourText }).first();
        if ((await option.count()) === 0) {
            await page.keyboard.press("Escape").catch(() => {});
            return false;
        }

        await option.scrollIntoViewIfNeeded();
        await option.click({ force: true });
        console.log(`✅ Delivery hour: ${hourText}`);
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
        const minText   = minValue == 0 ? "0 min" : `${minValue} mins`;
        const minDropdown = page.locator("div.g-select-text-input .right button").first();
        if ((await minDropdown.count()) === 0) return false;

        await minDropdown.click();
        await page.waitForTimeout(500);

        const option = page.locator(".q-virtual-scroll__content .q-item__section", { hasText: minText }).first();
        if ((await option.count()) === 0) {
            await page.keyboard.press("Escape").catch(() => {});
            return false;
        }

        await option.scrollIntoViewIfNeeded();
        await option.click({ force: true });
        console.log(`✅ Delivery minute: ${minText}`);
        await page.waitForTimeout(500);
        return true;
    } catch (error) {
        console.error("❌ Failed to set delivery minute:", error.message);
        await page.keyboard.press("Escape").catch(() => {});
        return false;
    }
}
