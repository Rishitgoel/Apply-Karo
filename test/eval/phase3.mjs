import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ROOT, startServer } from "./server.mjs";
import { loadPlaywright, browserOptions } from "./runtime.mjs";
import { buildBundle } from "../../bundle.mjs";
buildBundle();
const server = await startServer(), { chromium } = loadPlaywright();
const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "resumefiler-phase3-")), { ...browserOptions(), args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`] });
const results = [];
const check = (id, actual, expected) => { const pass = JSON.stringify(actual) === JSON.stringify(expected); results.push({ id, actual, expected, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${JSON.stringify(actual)}`); };
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"), origin = worker.url().replace(/\/background\.js$/, "");
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ schemaVersion: 2, profile: { personal: { firstName: "Avery", city: "Palo Alto" }, customFields: {} }, learned: { title: "Legacy unsafe" },
      resumeMeta: { text: "Jordan built a project at Example Labs, improving internal workflows and reducing manual effort.", textFileName: "", fileName: "" }, settings: { autofillOnLoad: false, aiAutofillEnabled: false, autoUploadResume: false, trackApplications: false } });
    globalThis.fetch = () => { throw new Error("Live provider access forbidden"); };
  });
  const driver = await context.newPage(); await driver.goto(origin + "/privacy.html");
  const call = (action, payload = {}) => driver.evaluate(async ({ action, payload }) => chrome.runtime.sendMessage({ type: "knowledge", action, ...payload }), { action, payload });
  const snapshot = async () => { const r = await call("snapshot"); if (!r.ok) throw new Error(r.error); return r.result; };
  const first = await snapshot(); check("legacy-quarantined", first.legacy.title.status, "unverified"); check("migration-keeps-original", first.legacy.backup.learned.title, "Legacy unsafe");
  check("migration-repeatable", (await snapshot()).migrations.legacyV1, first.migrations.legacyV1);
  const updates = await Promise.all([call("profile", { changes: [{ path: "personal.email", value: "avery@example.invalid" }] }), call("profile", { changes: [{ path: "personal.phone", value: "+1 555 0100" }] })]);
  check("concurrent-profile-updates-commit", updates.every(r => r.ok), true);
  let state = await snapshot(); check("concurrent-profile-preserves-email", state.facts["profile:personal.email"].value, "avery@example.invalid"); check("concurrent-profile-preserves-phone", state.facts["profile:personal.phone"].value, "+1 555 0100");
  check("stale-profile-update-rejected", (await call("profile", { changes: [{ path: "personal.email", value: "wrong@example.invalid" }] })).ok, false);
  check("authorization-requires-country", (await call("setup", { values: { "authorization.authorized": "Yes" } })).ok, false);
  check("compensation-requires-units", (await call("setup", { values: { "compensation.amount": "100000" } })).ok, false);
  check("ask-once-saves", (await call("setup", { values: { "authorization.country": "India", "authorization.authorized": "Yes", "authorization.sponsorship": "No", "compensation.amount": "100000", "compensation.currency": "INR", "compensation.period": "month", "disclosure.preference": "skip" } })).ok, true);
  state = await snapshot(); check("authorization-country-scope", state.facts["setup:authorization.authorized:india"].scope, { type: "country", country: "india" });
  const text = "Jordan built a project at Example Labs, improving internal workflows and reducing manual effort.";
  const proposed = await call("propose", { profile: { personal: { firstName: "Jordan" }, skills: "internal workflows" }, resumeText: text });
  check("resume-proposes-not-writes", proposed.ok, true); check("resume-conflict-visible", proposed.result.facts[0].conflict, "Avery");
  check("existing-profile-preserved", await worker.evaluate(async () => (await chrome.storage.local.get("profile")).profile.personal.firstName), "Avery");
  const selected = proposed.result.facts.map(r => ({ id: r.id, revision: r.revision }));
  check("resume-explicit-confirmation", (await call("confirm-proposals", { records: selected })).ok, true);
  check("confirmed-profile-projection", await worker.evaluate(async () => (await chrome.storage.local.get("profile")).profile.personal.firstName), "Jordan");
  check("confirmed-record-provenance", (await snapshot()).facts["profile:personal.firstName"].provenance.source, "user-confirmed-resume");
  const changedProposal = await call("propose", { profile: { skills: "project" }, resumeText: text });
  await worker.evaluate(async () => chrome.storage.local.set({ resumeMeta: { text: "A replaced resume", textFileName: "", fileName: "" } }));
  check("changed-resume-rejects-confirmation", (await call("confirm-proposals", { records: changedProposal.result.facts.map(r => ({ id: r.id, revision: r.revision })) })).ok, false);
  check("stale-extraction-rejected", (await call("propose", { profile: {}, resumeText: text })).ok, false);
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const [index, page] of pages.entries()) {
    await page.goto(server.origin + "/phase2/scoped-correction?step=" + index);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, page.url());
    await driver.evaluate(async tabId => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_fill", tabId }), tabId);
  }
  await Promise.all([pages[0].locator("#collegecity").fill("College Town"), pages[1].locator("#homecity").fill("Home Town")]);
  await Promise.all(pages.map(page => page.locator("#first").focus()));
  for (let i = 0; i < 80; i++) { state = await snapshot(); if (Object.keys(state.answers).length >= 2) break; await driver.waitForTimeout(25); }
  check("concurrent-corrections-no-lost-update", Object.values(state.answers).map(r => r.value).sort(), ["College Town", "Home Town"]);
  check("answers-explicit-scope-and-provenance", Object.values(state.answers).every(r => r.scope.type === "application" && r.provenance.source === "user-correction" && !!r.question && !!r.context.entityId), true);
  await worker.evaluate(() => { const originalGet = chrome.storage.local.get.bind(chrome.storage.local); let once = true;
    chrome.storage.local.get = async keys => { if (Array.isArray(keys) && keys.includes("resumeFile") && once) { once = false; await new Promise(resolve => setTimeout(resolve, 200)); } return originalGet(keys); };
  });
  await pages[0].locator("#collegecity").fill("First rapid edit"); await pages[0].locator("#first").focus();
  await pages[0].locator("#collegecity").fill("Latest rapid edit"); await pages[0].locator("#first").focus();
  for (let i = 0; i < 80; i++) { state = await snapshot(); if (Object.values(state.answers).some(r => r.value === "Latest rapid edit")) break; await driver.waitForTimeout(25); }
  check("rapid-same-page-edits-preserve-latest", Object.values(state.answers).some(r => r.value === "Latest rapid edit"), true);
  const sample = Object.values(state.answers)[0];
  const deleted = await call("delete", { collection: "answers", id: sample.id, revision: sample.revision });
  check("delete-answer", (await snapshot()).answers[sample.id] === undefined, true);
  check("undo-answer", (await call("undo", { token: deleted.result })).ok, true);
  check("undo-restores-answer", (await snapshot()).answers[sample.id].value, sample.value);
  const exported = await call("export"); check("export-contains-records", Object.keys(exported.result.answers).length, 2);
  check("export-excludes-api-credentials", JSON.stringify(exported.result).includes("ApiKey"), false);
  const imported = await call("import", { data: exported.result }); check("import-succeeds", imported.ok, true);
  check("imported-approvals-quarantined", Object.values((await snapshot()).answers).filter(r => r.provenance.source === "backup-import").every(r => r.status === "unverified"), true);
  const importedAnswer = Object.values((await snapshot()).answers).find(r => r.status === "unverified" && r.value === sample.value);
  check("conflicting-import-approval-rejected", (await call("approve-answer", { id: importedAnswer.id, revision: importedAnswer.revision })).ok, false);
  const originalAnswer = (await snapshot()).answers[sample.id]; await call("delete", { collection: "answers", id: originalAnswer.id, revision: originalAnswer.revision });
  check("import-review-restores-approval", (await call("approve-answer", { id: importedAnswer.id, revision: importedAnswer.revision })).ok, true);
  const dashboard = await context.newPage(), errors = []; dashboard.on("pageerror", e => errors.push(e.message));
  await dashboard.goto(origin + "/options.html"); await dashboard.locator("#knowledge-panel").waitFor({ state: "attached" });
  await dashboard.locator('[data-tab="tab-learned"]').click(); await dashboard.getByRole("button", { name: "Ask once: common details" }).click();
  await dashboard.locator("#knowledge-panel input[data-path]").first().waitFor();
  check("ask-once-ui-controls", await dashboard.locator("#knowledge-panel input[data-path]").count(), 15);
  check("dashboard-load-no-errors", errors, []);
  await dashboard.screenshot({ path: fileURLToPath(new URL("./output/phase3-dashboard.png", import.meta.url)), fullPage: true });
  await dashboard.locator('[data-tab="tab-personal"]').click();
  await dashboard.locator("#personal-address").fill("Test Street"); await dashboard.locator("#personal-firstName").focus();
  for (let i = 0; i < 60; i++) { const address = await worker.evaluate(async () => (await chrome.storage.local.get("profile")).profile.personal.address); if (address === "Test Street") break; await driver.waitForTimeout(50); }
  check("dashboard-saves-previously-empty-field", await worker.evaluate(async () => (await chrome.storage.local.get("profile")).profile.personal.address), "Test Street");
  state = await snapshot(); const dependencies = state.dependencies;
  await call("profile", { changes: [{ path: "personal.firstName", before: "Jordan", value: "Updated" }] });
  const refreshed = await snapshot(); check("profile-change-invalidates-answer-dependencies", Object.values(refreshed.answers).filter(r => r.status === "approved").every(r => r.dependencies.profile !== refreshed.dependencies.profile), true);
  check("resume-change-invalidates-evidence", Object.values(refreshed.evidence).filter(r => r.provenance.source === "resume-extraction").every(r => r.dependencies.resume !== refreshed.dependencies.resume), true);
  await worker.evaluate(async () => chrome.storage.local.set({ job: { url: "https://jobs.example.invalid/new" } }));
  check("job-context-revision-changes", (await snapshot()).dependencies.job !== dependencies.job, true);
  for (const [name, question, expected] of [["country-fact-reuse", "Are you authorized to work in India?", "Yes"], ["cross-country-abstains", "Are you authorized to work in United States?", ""], ["compound-polarity-abstains", "Are you authorized to work in India without sponsorship?", ""]]) {
    const page = await context.newPage(); await page.goto(server.origin + "/phase2/scoped-correction?step=" + name);
    await page.evaluate(question => { document.body.innerHTML = '<form><label for="auth"></label><input id="auth" name="workAuthorization"></form>'; document.querySelector("label").textContent = question; }, question);
    const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, page.url());
    await driver.evaluate(async tabId => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_fill", tabId }), tabId);
    check(name, await page.locator("#auth").inputValue(), expected); await page.close();
  }
  await worker.evaluate(() => {
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local); let once = true;
    chrome.storage.local.set = async patch => { if (patch.profile && once) { once = false; throw new Error("Synthetic projection interruption"); } return originalSet(patch); };
  });
  check("projection-interruption-reported", (await call("profile", { changes: [{ path: "personal.city", before: "Palo Alto", value: "Recovered City" }] })).ok, false);
  await snapshot();
  check("pending-profile-projection-recovered", await worker.evaluate(async () => (await chrome.storage.local.get("profile")).profile.personal.city), "Recovered City");
  await worker.evaluate(() => {
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local); let once = true;
    chrome.storage.local.set = async patch => { if (patch.profile && once) { once = false; throw new Error("Synthetic projection conflict"); } return originalSet(patch); };
  });
  await call("profile", { changes: [{ path: "personal.city", before: "Recovered City", value: "Pending City" }] });
  await worker.evaluate(async () => { const { profile } = await chrome.storage.local.get("profile"); profile.personal.city = "Newer City"; await chrome.storage.local.set({ profile }); });
  const conflict = await snapshot(); check("projection-conflict-preserves-newer-profile", await worker.evaluate(async () => (await chrome.storage.local.get("profile")).profile.personal.city), "Newer City");
  check("projection-conflict-keeps-recoverable-values", conflict.legacy.recoveryProfile.profile.personal.city, "Pending City");
  const cdp = await context.newCDPSession(driver); await cdp.send("ServiceWorker.enable"); await cdp.send("ServiceWorker.stopAllWorkers");
  let restarted;
  for (let i = 0; i < 10; i++) { try { restarted = await snapshot(); break; } catch { await driver.waitForTimeout(100); } }
  check("knowledge-survives-worker-restart", Object.values(restarted.answers).filter(r => r.status === "approved").length, 2);
  check("migration-survives-worker-restart", restarted.legacy.backup.learned.title, "Legacy unsafe");
  const report = { measuredAt: new Date().toISOString(), browser: context.browser()?.version(), bundleHash: createHash("sha256").update(await readFile(join(ROOT, "src/engine/bundle.js"))).digest("hex"), evidenceKind: "unpacked-extension-real-indexeddb-synthetic-fixtures", results, passed: results.every(r => r.pass), limitations: ["No live model or ATS acceptance", "No human timing study", "General resolver and custom-widget learning remain later phases"] };
  await mkdir(new URL("./output/", import.meta.url), { recursive: true }); await writeFile(new URL("./output/phase3.json", import.meta.url), JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally { await context.close(); await server.close(); }
