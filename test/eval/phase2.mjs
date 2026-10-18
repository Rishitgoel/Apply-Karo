import { pathToFileURL } from "node:url";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, startServer } from "./server.mjs";
import { loadPlaywright, browserOptions } from "./runtime.mjs";
import { buildBundle } from "../../bundle.mjs";
import { profile } from "../fixtures/autofill/corpus.mjs";
export async function phase2Controls() {
buildBundle();
const server = await startServer(), { chromium } = loadPlaywright();
const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "resumefiler-phase2-")), {
  ...browserOptions(), args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
});
const results = [];
function check(id, actual, expected) { const pass = JSON.stringify(actual) === JSON.stringify(expected); results.push({ id, actual, expected, pass }); console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${JSON.stringify(actual)}`); }
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionOrigin = worker.url().replace(/\/background\.js$/, "");
  await worker.evaluate(async (profile) => chrome.storage.local.set({ profile, learned: {}, settings: {
    aiAutofillEnabled: false, autofillOnLoad: false, autoUploadResume: false, trackApplications: false, showBadge: false,
    panelEnabled: true, fieldAiButtonEnabled: true, skipSensitive: true, provider: "groq", groqApiKey: "synthetic-unused"
  }, schemaVersion: 2 }), profile);
  // A transport tripwire makes accidental provider access fail locally.
  await worker.evaluate(() => { globalThis.fetch = () => { throw new Error("Live provider access forbidden in Phase 2 fixtures"); }; });
  const driver = await context.newPage(); await driver.goto(extensionOrigin + "/privacy.html");
  async function pageFor(id) { const page = await context.newPage(); await page.goto(server.origin + "/phase2/" + id); return page; }
  async function tabId(page) { return worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id, page.url()); }
  async function fill(page) { return driver.evaluate(async (id) => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_fill", tabId: id }), await tabId(page)); }
  for (const id of ["button", "searchable", "delayed", "portal", "virtual", "ambiguous", "revert", "native-revert", "search-only", "hierarchical", "chips", "stale"]) {
    const page = await pageFor(id);
    const target = id === "hierarchical" ? "Engineering > Software" : id === "chips" ? ["React", "Python"] : "United States";
    const result = await page.evaluate(async ({ origin, target, id }) => {
      const { scan } = await import(origin + "/src/engine/scan.js"), { fillAsync } = await import(origin + "/src/engine/fill.js");
      const field = scan().find((f) => f.el.id === "trigger");
      if (id === "stale") document.querySelector("#question").textContent = "State";
      const ok = await fillAsync(field, target, id === "chips" ? "skills" : id === "hierarchical" ? null : "country");
      return { ok, selected: window.__selected || [], value: field.el.value || field.el.dataset.selected || "", outcome: field.controlOutcome };
    }, { origin: server.origin, target, id });
    const accepted = !["ambiguous", "revert", "native-revert", "search-only", "stale"].includes(id);
    check(`dropdown-${id}`, result.ok, accepted);
    if (accepted) check(`dropdown-${id}-canonical`, id === "chips" ? result.selected : result.selected.at(-1), id === "chips" ? ["React", "Python"] : id === "hierarchical" ? "Software" : "United States");
    else if (id === "search-only") { check("typed-search-is-not-selection", result.selected.length, 0); check("uncommitted-search-restored", result.value, ""); }
    await page.close();
  }
  const labels = await pageFor("labels");
  const extraction = await labels.evaluate(async (origin) => {
    const { scan } = await import(origin + "/src/engine/scan.js"); const fields = scan();
    const byId = (id) => fields.find((f) => f.el.id === id);
    const old = byId("city"), unchanged = scan().find((f) => f.el.id === "city");
    document.querySelector("legend").textContent = "Work experience";
    const changed = scan().find((f) => f.el.id === "city");
    return { full: byId("long").rawLabel.endsWith("Only Python, never Java."), multipart: byId("multi").rawLabel,
      description: byId("described").helperText, conflicting: byId("conflict").extraction.conflicting,
      stable: old.fieldId === unchanged.fieldId && old.formRevision === unchanged.formRevision,
      revision: changed.formRevision > old.formRevision, section: changed.section };
  }, server.origin);
  check("complete-long-question", extraction.full, true);
  check("ordered-multipart-question", extraction.multipart, "Are you authorized to work in India without sponsorship?");
  check("complete-description", extraction.description, "Are you authorized to work in India without sponsorship? Only use your confirmed jurisdiction-specific facts.");
  check("conflicting-labels-flagged", extraction.conflicting, true);
  check("descriptor-stable-without-change", extraction.stable, true);
  check("descriptor-revision-on-section-change", extraction.revision, true);
  check("fresh-section-after-dom-reuse", extraction.section, "experience");
  await worker.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["src/engine/bundle.js"] }), await tabId(labels));
  await labels.getByRole("button", { name: "Fill with AI", exact: true }).waitFor();
  await labels.getByRole("button", { name: "Fill with AI", exact: true }).click();
  labels.once("dialog", (dialog) => dialog.accept("Describe only your confirmed Python project experience."));
  await labels.getByRole("button", { name: "Correct detected question", exact: true }).click();
  await labels.locator("#applykaro-field-root").locator(".pop-question").filter({ hasText: "Describe only your confirmed Python project experience." }).waitFor();
  await labels.locator("#applykaro-field-root").locator(".pop-question summary").click();
  await labels.locator("#applykaro-field-root").locator(".pop-question").getByText("Describe only your confirmed Python project experience.", { exact: true }).waitFor();
  const fixes = await worker.evaluate(async () => (await chrome.storage.local.get("questionFixes")).questionFixes);
  check("question-correction-scoped-to-template", Object.keys(fixes), [server.origin + "/phase2/labels"]);
  await labels.close();
  const correction = await pageFor("scoped-correction");
  await driver.evaluate(async (id) => chrome.runtime.sendMessage({ type: "prepare_engine", tabId: id }), await tabId(correction));
  await correction.locator("#collegecity").fill("College Town"); await correction.locator("#first").focus();
  await correction.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  let learned;
  for (let i = 0; i < 100; i++) {
    const snapshot = await driver.evaluate(async () => (await chrome.runtime.sendMessage({ type: "knowledge", action: "snapshot" })).result);
    learned = Object.values(snapshot.answers || {});
    if (learned.some(r => r.value === "College Town")) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  check("native-correction-keeps-contextual-key", learned.find(r => r.context.section === "education" && r.context.entityId === "education:0" && r.question === "City")?.value, "College Town");
  await correction.close();
  const correctedAgain = await pageFor("scoped-correction"); await fill(correctedAgain);
  check("scoped-correction-reused", await correctedAgain.locator("#collegecity").inputValue(), "College Town");
  check("scoped-correction-does-not-cross-section", await correctedAgain.locator("#homecity").inputValue(), "Palo Alto");
  await correctedAgain.close();
  const conditional = await pageFor("conditional"); await fill(conditional);
  check("conditional-child-rescanned", await conditional.locator("#state").inputValue(), "California"); await conditional.close();
  const related = await pageFor("related-frames"), frameResult = await fill(related);
  check("related-frame-inventory", frameResult.frames.length, 3);
  for (let i = 0; i < 2; i++) check(`related-frame-${i}-filled`, await related.frameLocator("iframe").nth(i).locator("#first").inputValue(), "Avery");
  await related.close();
  const closed = await pageFor("closed"), closedResult = await fill(closed);
  check("uninspectable-component-reported", closedResult.error.includes("cannot be inspected"), true); await closed.close();
  const positive = await pageFor("unfamiliar");
  await positive.getByRole("button", { name: "Apply karo", exact: true }).waitFor();
  check("unfamiliar-employment-form-detected", true, true); await positive.close();
  for (const id of ["checkout", "login", "search"]) {
    const page = await pageFor(id); await page.waitForTimeout(500);
    check(`negative-${id}-not-detected`, await page.getByRole("button", { name: "Apply karo", exact: true }).count(), 0); await page.close();
  }
  await mkdir(new URL("./output/", import.meta.url), { recursive: true });
  await writeFile(new URL("./output/phase2-controls.json", import.meta.url), JSON.stringify({ measuredAt: new Date().toISOString(), results,
    evidenceKind: "real-browser-and-unpacked-extension-synthetic-fixtures", limitations: ["AI disabled and transport blocked.", "No live Workday tenant or native toolbar interaction."] }, null, 2));
  return { results, passed: results.every((r) => r.pass) };
} finally { await context.close(); await server.close(); }

}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const report = await phase2Controls(); if (!report.passed) process.exitCode = 1;
}
