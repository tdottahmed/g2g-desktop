async function selectDropdownOption(page, fieldEl, value) {
    const btn = fieldEl.locator("div:nth-child(2) .g-btn-select").first();
    const labelEl = fieldEl.locator("div:nth-child(1) .text-font-2nd");
    const labelText = (await labelEl.first().innerText()).trim();
    try {
        console.log(`Selecting ${labelText} = ${value}`);
        await humanDelay(800, 1500); // 👈 Now delay works!
        await btn.click({ force: true });
        console.log(`🖱️ Clicked ${labelText} dropdown button`);
        await page.waitForTimeout(800);

        // Locate wrapper relative to this button
        const dropdownWrapper = btn.locator(
            " + div.relative-position > div:not(.g-input-error)"
        );
        if ((await dropdownWrapper.count()) === 0) {
            console.log(`❌ Could not find ${labelText} dropdown wrapper`);
            return false;
        }

        // Filter input
        const filterInput = dropdownWrapper.locator(
            'label input[placeholder="Type to filter"]'
        );
        if ((await filterInput.count()) === 0) return false;

        await filterInput.first().fill(value);
        await page.waitForTimeout(500);

        // Dropdown menu
        const dropdownMenu = dropdownWrapper.locator(
            "div:nth-child(2) .q-virtual-scroll__content"
        );
        if ((await dropdownMenu.count()) === 0) return false;

        const option = dropdownMenu.locator(
            `.q-item .q-item__section:has-text("${value}")`
        );
        if ((await option.count()) === 0) {
            await page.keyboard.press("Escape").catch(() => {});
            return false;
        }

        const firstOption = option.first();
        const innerHTML = await firstOption.innerHTML();
        if (!innerHTML.toLowerCase().includes(value.toLowerCase())) {
            await page.keyboard.press("Escape").catch(() => {});
            return false;
        }

        await firstOption.click({ force: true });
        await page.waitForTimeout(500);
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
            console.log(`❌ Could not find ${label} input`);
            return false;
        }

        await humanDelay(800, 1500); // optional delay

        // Clear any existing value
        await input.fill("");
        // Focus the input
        await input.click();

        // Write to clipboard
        await page.evaluate(async (text) => {
            await navigator.clipboard.writeText(text);
        }, value);

        // Paste using keyboard shortcut
        await page.keyboard.press("Control+V"); // On macOS use "Meta+V"

        console.log(`📋 Pasted into ${label} input: ${value}`);
        await page.waitForTimeout(500);

        return true;
    } catch (error) {
        console.error(`❌ Failed to fill input ${label}:`, error.message);
        return false;
    }
}

/**
 * Fill Pricing section manually (only price input)
 * @param {import('playwright').Page} page
 * @param {string|number} price - e.g., "150.00"
 */
async function fillPricingSection(page, price) {
    try {
        const pricingSection = page
            .locator(".g-cu-form-card__section:has-text('Pricing')")
            .first();

        if ((await pricingSection.count()) === 0) {
            console.log("❌ Could not find Pricing section");
            return false;
        }

        const priceInput = pricingSection
            .locator("input.q-field__native")
            .first();
        if ((await priceInput.count()) === 0) {
            console.log("❌ Could not find Default price input");
            return false;
        }

        await priceInput.fill("");
        await priceInput.type(price.toString(), { delay: 100 });
        console.log(`🖱️ Filled Default price (unit) with: ${price}`);

        return true;
    } catch (error) {
        console.error("❌ Failed to fill Pricing section:", error.message);
        return false;
    }
}

/**
 * Fill Media Gallery
 * @param {import('playwright').Page} page
 * @param {Array<{title: string, Link: string}>} medias
 */
async function fillMediaGallery(page, medias = []) {
    if (!medias.length) return;

    try {
        const mediaSection = page
            .locator(".g-cu-form-card__section:has-text('Media gallery')")
            .first();

        if ((await mediaSection.count()) === 0) {
            console.log("❌ Could not find Media gallery section");
            return false;
        }

        // Loop through each media item in JSON
        for (let i = 0; i < medias.length; i++) {
            const { title, Link } = medias[i];

            // Click 'Add media' button if not first item
            if (i > 0) {
                const addBtn = mediaSection
                    .locator("button:has-text('Add media')")
                    .first();
                if ((await addBtn.count()) > 0) {
                    await addBtn.click();
                    await page.waitForTimeout(500); // wait for new input to render
                }
            }

            // --- Fill Media Title ---
            const titleInput = mediaSection
                .locator(`input[placeholder="Media title"]`)
                .nth(i);
            if ((await titleInput.count()) > 0) {
                await titleInput.fill(""); // clear first
                await titleInput.click();

                // Copy to clipboard
                await page.evaluate(async (text) => {
                    await navigator.clipboard.writeText(text);
                }, title);

                // Paste
                await page.keyboard.press("Control+V"); // or "Meta+V" on macOS
                console.log(`📋 Pasted media title: ${title}`);
            } else {
                console.log(
                    `❌ Could not find media title input for item ${i}`
                );
            }

            // --- Fill Link ---
            const linkInput = mediaSection
                .locator(`input[placeholder="https://"]`)
                .nth(i);
            if ((await linkInput.count()) > 0) {
                await linkInput.fill(""); // clear first
                await linkInput.click();

                await page.evaluate(async (text) => {
                    await navigator.clipboard.writeText(text);
                }, Link);

                await page.keyboard.press("Control+V"); // or "Meta+V" on macOS
                console.log(`📋 Pasted media link: ${Link}`);
            } else {
                console.log(`❌ Could not find media link input for item ${i}`);
            }

            await page.waitForTimeout(300); // small delay for stability
        }

        return true;
    } catch (error) {
        console.error("❌ Failed to fill Media gallery:", error.message);
        return false;
    }
}
