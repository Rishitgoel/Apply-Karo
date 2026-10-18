import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require("playwright"); } catch (localError) {
    const path = process.env.PLAYWRIGHT_MODULE_DIR || join(process.env.USERPROFILE || "", ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
    if (!existsSync(path)) throw new Error("Playwright unavailable. Run npm ci or set PLAYWRIGHT_MODULE_DIR.", { cause: localError });
    return createRequire(pathToFileURL(join(path, "package.json")))(path);
  }
}
export function browserOptions() {
  return { headless: true, ...(process.env.AUTOFILL_BROWSER_PATH ? { executablePath: process.env.AUTOFILL_BROWSER_PATH } : { channel: process.env.AUTOFILL_BROWSER_CHANNEL || "msedge" }) };
}
