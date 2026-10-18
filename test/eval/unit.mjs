import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("../", import.meta.url));
let failed = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort()) {
  const result = spawnSync(process.execPath, [dir + name], { stdio: "inherit" });
  if (result.status !== 0) failed++;
}
if (failed) { console.error(`${failed} test scripts failed`); process.exitCode = 1; }
