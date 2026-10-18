import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { startServer } from "./server.mjs";
import { loadPlaywright } from "./runtime.mjs";
import { extensionScenarios } from "./extension.mjs";
import { buildBundle } from "../../bundle.mjs";
buildBundle();
const server = await startServer(), { chromium } = loadPlaywright(), output = new URL("./output/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  const results = await extensionScenarios({ chromium, origin: server.origin, output });
  const bundleHash = createHash("sha256").update(await readFile(new URL("../../src/engine/bundle.js", import.meta.url))).digest("hex");
  const passed = results.every(r => r.status === "pass");
  await writeFile(new URL("phase6.json", output), JSON.stringify({ results, passed, bundleHash, evidenceKind: "real-extension-local-fixtures-mocked-provider", limitations: ["No live provider or human usability trial.", "Native toolbar dismissal simulated by extension tab."] }, null, 2));
  if (!passed) process.exitCode = 1;
} finally { await server.close(); }
