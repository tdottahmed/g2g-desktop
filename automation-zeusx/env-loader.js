import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
if (existsSync(envPath)) {
    config({ path: envPath });
}
