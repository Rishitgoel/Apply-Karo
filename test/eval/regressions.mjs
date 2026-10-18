import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fieldKey, normalizeKey } from "../../src/shared/rules.js";
import { readAnswers, analyzeFields } from "../../src/shared/ai.js";
import { labelFor } from "../../src/engine/scan.js";
import { negativePairs } from "../fixtures/autofill/corpus.mjs";

export async function contractRegressions() {
  const results = [];
  const check = async (id, finding, expected, action) => {
    let actual, error;
    try { actual = await action(); assert.deepEqual(actual, expected); }
    catch (e) { error = e.message; }
    results.push({ id, finding, expected, actual, status: error ? "failing_contract" : "pass" });
  };
  await check("missing-confidence", "F5", false, () => readAnswers('{"0":{"value":"Yes"}}', 1)[0].confidence === 1);
  const longPair = negativePairs.find((p) => p.difference === "skill");
  await check("long-question-identity", "F4", false, () => normalizeKey(longPair.a) === normalizeKey(longPair.b));
  await check("section-identity", "F4", false, () => fieldKey({ label: "City", section: "personal" }) === fieldKey({ label: "City", section: "education" }));
  const unicode = negativePairs.find((p) => p.difference === "unicode");
  await check("unicode-identity", "F4", false, () => normalizeKey(unicode.a) === normalizeKey(unicode.b));
  const refs = {
    q: { textContent: "Are you authorized to work", tagName: "SPAN", getAttribute: () => null },
    country: { textContent: "in the United States without sponsorship?", tagName: "SPAN", getAttribute: () => null }
  };
  const el = { getAttribute: (k) => k === "aria-labelledby" ? "q country" : null, getRootNode: () => ({ getElementById: (id) => refs[id] }) };
  await check("complete-question", "F1", "Are you authorized to work in the United States without sponsorship?", () => labelFor(el, new Map()));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"0":{"value":null,"confidence":0}}' }] } }] }) };
    };
    // The current API throws after forced retries; retain this as an observed failure.
    try { await analyzeFields({ provider: "gemini", geminiApiKey: "synthetic", geminiModel: "fixture-model" }, [{ label: "Current salary", kind: "text" }], {}, "", () => {}); } catch {}
    await check("unknown-fact-no-forced-retry", "F2", 1, () => calls);
  } finally { globalThis.fetch = originalFetch; }
  return results;
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const results = await contractRegressions();
  for (const r of results) console.log(`${r.status.toUpperCase()} ${r.id} (${r.finding}): expected=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}`);
  const count = results.filter((r) => r.status !== "pass").length;
  console.log(`${count} desired contracts currently fail; Phase 0 records them, later phases fix them.`);
  if (count) process.exitCode = 1;
}
