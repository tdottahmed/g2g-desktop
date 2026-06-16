
import readline from 'readline';

export const delay = (ms) => new Promise((res) => setTimeout(res, ms));

export const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/**
 * Pause execution for a random amount of time to simulate human behavior.
 * @param {number} min Minimum delay in milliseconds (default 100)
 * @param {number} max Maximum delay in milliseconds (default 400)
 * @returns {Promise<void>}
 */
export function humanDelay(min = 100, max = 400) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Optional: Human-like typing function for inputs
 * @param {Locator} locator Playwright locator for the input field
 * @param {string} text Text to type
 * @param {number} minDelay Minimum delay between keystrokes
 * @param {number} maxDelay Maximum delay between keystrokes
 */
export async function humanType(locator, text, minDelay = 80, maxDelay = 150) {
    for (const char of text) {
        await locator.type(char, { delay: Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay });
        await humanDelay(minDelay / 2, maxDelay / 2); // small pause between keystrokes
    }
}

/**
 * Optional: Human-like scrolling
 * Scrolls down the page gradually with random delays
 * @param {Page} page Playwright page object
 * @param {number} step How many pixels to scroll each step
 */
export async function humanScroll(page, step = 200) {
    const height = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < height; y += step) {
        await page.evaluate(_y => window.scrollTo(0, _y), y);
        await humanDelay(150, 400);
    }
}
