export const delay = (ms) => new Promise((res) => setTimeout(res, ms));

export function humanDelay(min = 100, max = 400) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function humanType(locator, text, minDelay = 80, maxDelay = 150) {
    for (const char of text) {
        await locator.type(char, { delay: Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay });
        await humanDelay(minDelay / 2, maxDelay / 2);
    }
}
