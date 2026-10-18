import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
const root = process.cwd(), destination = resolve(root, "docs/evidence/phase6"), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const zip = readFileSync(resolve(root, "dist/apply-karo-2.1.0.zip")), entries = []; let offset = 0;
while (zip.readUInt32LE(offset) === 0x04034b50) {
  const method = zip.readUInt16LE(offset + 8), size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
  const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString(), start = offset + 30 + nameLength + extraLength;
  const bytes = method === 8 ? inflateRawSync(zip.subarray(start, start + size)) : zip.subarray(start, start + size);
  if (!bytes.equals(readFileSync(resolve(root, name)))) throw new Error("Package differs from source: " + name);
  entries.push(name); offset = start + size;
}
for (const name of ["src/engine/review.js", "src/knowledge/learning.js"]) if (!entries.includes(name)) throw new Error("Missing module: " + name);
const bundleSHA256 = hash(readFileSync(resolve(root, "src/engine/bundle.js")));
const load = name => JSON.parse(readFileSync(resolve(root, "test/eval/output", name + ".json")));
const knowledge = load("phase3"), resolver = load("phase4"), controls = load("phase5"), extension = load("phase6"), keka = load("reported-keka");
for (const gate of [knowledge, resolver, controls, extension, keka]) if (!gate.passed || gate.bundleHash !== bundleSHA256) throw new Error("Failed or stale browser gate");
if (!extension.results.some(r => r.finding === "F13" && r.status === "pass") || extension.results.some(r => r.status !== "pass")) throw new Error("Correction learning gate did not pass");
const unit = readFileSync(resolve(root, "test/eval/output/phase6-unit.txt"), "utf8");
if (/FAIL|test scripts failed/.test(unit) || !unit.includes("phase6: 50 assertions passed")) throw new Error("Unit checks failed or stale");
const unitChecks = [...unit.matchAll(/(\d+)\/\d+ passed|(\d+) assertions passed/g)].reduce((sum, match) => sum + Number(match[1] || match[2]), 0);
mkdirSync(destination, { recursive: true });
for (const [source, target] of [["phase3.json", "knowledge.json"], ["phase4.json", "resolver.json"], ["phase5.json", "controls.json"], ["phase6.json", "extension.json"], ["reported-keka.json", "select2-reconstruction.json"], ["phase6-unit.txt", "unit.txt"], ["phase6-review.png", "review.png"]]) copyFileSync(resolve(root, "test/eval/output", source), resolve(destination, target));
const report = { measuredAt: new Date().toISOString(), zipSHA256: hash(zip), bundleSHA256, everyPackagedFileMatchesSource: true, files: entries.length,
  unitChecks, reviewLearningUnitChecks: 50, extensionChecks: extension.results.length, knowledgeChecks: knowledge.results.length, resolverChecks: resolver.checks.length, controlChecks: controls.checks.length, kekaChecks: keka.results.length,
  customWidgetCorrectionGatePassed: true, humanUsabilityTrialComplete: false, liveATSAcceptanceComplete: false, timeSavingMeasured: false, entries };
writeFileSync(resolve(destination, "package.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, entries: undefined }, null, 2));
