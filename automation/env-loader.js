import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";

// Only load .env if it exists — when running through the Electron desktop app,
// all required vars are injected by the main process instead.
const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
if (existsSync(envPath)) {
    config({ path: envPath });
}
