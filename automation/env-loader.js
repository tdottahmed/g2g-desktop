import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), ".env") });
