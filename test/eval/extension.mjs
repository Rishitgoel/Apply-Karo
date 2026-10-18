import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { profile } from "../fixtures/autofill/corpus.mjs";
import { ROOT } from "./server.mjs";
import { browserOptions } from "./runtime.mjs";

// Uses the real extension, service worker, tabs messaging and isolated-world bundle.
// Popup UI is opened as an extension tab with active-tab lookup pinned to the form:
// native toolbar dismissal/focus semantics are not claimed by this harness.
export async function extensionScenarios({ chromium, origin, output }) {
  const userDataDir = await mkdtemp(join(tmpdir(), "resumefiler-phase0-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...browserOptions(), viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
  });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
  const workerUrl = new URL(worker.url());
  const extensionOrigin = `${workerUrl.protocol}//${workerUrl.host}`;
  const results = [];
  const settings = { autofillOnLoad: false, aiAutofillEnabled: false, autoUploadResume: false, trackApplications: false,
    fieldAiButtonEnabled: false, panelEnabled: true, skipSensitive: true, diagnosticsEnabled: true, showBadge: false,
    provider: "groq", groqApiKey: "synthetic-fixture-key", groqModel: "fixture-model" };
  async function seed(patch = {}) {
    await worker.evaluate(async (data) => { await chrome.storage.local.clear(); await chrome.storage.local.set(data); }, {
      profile, settings: { ...settings, ...(patch.settings || {}) }, learned: {}, corrections: {}, schemaVersion: 2,
      resumeMeta: { text: "Synthetic candidate: Avery Shah built internal tools at Example Labs.", textFileName: "" }, ...patch,
      ...(patch.settings ? { settings: { ...settings, ...patch.settings } } : {})
    });
    // All provider responses are local fakes. No request is sent to a model.
    await worker.evaluate(() => {
      globalThis.__requests = []; globalThis.__answer = "Avery Shah built internal tools at Example Labs."; globalThis.__delay = 0;
      globalThis.fetch = async (_url, opts) => {
        const body = JSON.parse(opts.body), prompt = body.messages?.[0]?.content || body.contents?.[0]?.parts?.[0]?.text || "";
        globalThis.__requests.push(prompt);
        if (globalThis.__delay) await new Promise((r) => setTimeout(r, globalThis.__delay));
        const indices = [...prompt.matchAll(/^(\d+): label=/gm)].map((m) => m[1]);
        const packet = prompt.includes("AUTOFILL_PACKET=") ? JSON.parse(prompt.split("AUTOFILL_PACKET=")[1]) : null;
        const answer = packet ? JSON.stringify({ decisions: packet.fields.map(f => ({ fieldId: f.fieldId, revision: f.revision, status: "draft", factId: null, memoryId: null,
          value: globalThis.__answer, optionIds: [], claims: [{ text: globalThis.__answer, evidenceId: packet.evidence.find(e => e.text.includes("Avery Shah built internal tools at Example Labs."))?.id || "unsupported",
            quote: "Avery Shah built internal tools at Example Labs." }] })) }) : indices.length ? JSON.stringify(Object.fromEntries(indices.map((i) => [i, { value: globalThis.__answer, confidence: .4,
          status: "draft", evidence: [{ source: "resume", quote: "Avery Shah built internal tools at Example Labs." }] }]))) : globalThis.__answer;
        return { ok: true, json: async () => ({ choices: [{ message: { content: answer } }] }) };
      };
    });
  }
  async function newForm(id) {
    const page = await context.newPage();
    const logs = [];
    page.on("console", (m) => { if (m.text().includes("Apply karo")) logs.push(m.text()); });
    const targetUrl=id.startsWith("/") ? origin + id : `${origin}/neutral/${id}`;
    try { await page.goto(targetUrl); }
    catch (error) {
      if(!error.message.includes(extensionOrigin + "/options.html"))throw error;
      // First installation may open its dashboard in the active fixture tab.
      // Complete onboarding navigation before measuring a cold form start.
      await page.waitForURL(extensionOrigin + "/options.html");
      await page.waitForLoadState("domcontentloaded");
      await page.goto(targetUrl);
    }
    await page.bringToFront();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, page.url());
    if (tabId === undefined) throw new Error(`Missing real tab ${id}`);
    return { page, tabId, url: page.url(), logs };
  }
  async function engine(form, name, args = []) {
    return worker.evaluate(async ({ tabId, name, args }) => {
      const [out] = await chrome.scripting.executeScript({ target: { tabId }, func: async (name, args) => {
        const e = window.__applyKaroEngine;
        if (name === "ready") return !!e;
        return await e[name](...args);
      }, args: [name, args] });
      return out.result;
    }, { tabId: form.tabId, name, args });
  }
  async function inject(form) {
    await worker.evaluate(async (tabId) => { await chrome.scripting.executeScript({ target: { tabId }, files: ["src/engine/bundle.js"] }); }, form.tabId);
    await form.page.getByRole("button", { name: "Apply karo", exact: true }).waitFor({ timeout: 10000 });
  }
  async function popup(form) {
    const p = await context.newPage();
    await p.addInitScript(({ tabId, url }) => {
      const original = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (opts) => opts.active ? Promise.resolve([{ id: tabId, url }]) : original(opts);
    }, { tabId: form.tabId, url: form.url });
    await p.goto(extensionOrigin + "/popup.html");
    // Await the actual module's top-level initialization, not static HTML visibility.
    await p.evaluate(() => import(chrome.runtime.getURL("popup.js")).then(() => true));
    await p.getByRole("button", { name: "Fill this page", exact: true }).waitFor();
    return p;
  }
  function check(id, finding, expected, actual, extra = {}) {
    const pass = JSON.stringify(expected) === JSON.stringify(actual);
    const result = { id, finding, expected, actual, status: pass ? "pass" : "failing_contract", ...extra };
    results.push(result); console.log(`extension ${result.status}: ${id}; actual=${JSON.stringify(actual)}${extra.footer ? "; footer=" + extra.footer : ""}`);
    writeFileSync(new URL("extension-progress.json", output), JSON.stringify({ results }, null, 2));
  }
  try {
    await seed();
    const cold = await newForm("cold"), coldPopup = await popup(cold);
    await coldPopup.getByRole("button", { name: "Fill this page", exact: true }).click();
    // An extension tab hides the target; a native action popup does not.
    await cold.page.bringToFront();
    await coldPopup.waitForFunction(() => document.querySelector("#fill-label").textContent === "Fill this page", { timeout: 15000 });
    const coldValue = await cold.page.getByLabel("First name", { exact: true }).inputValue();
    check("toolbar-cold-start", "F14", "Avery", coldValue, { footer: await coldPopup.locator("#footer-text").innerText() });
    await coldPopup.screenshot({ path: fileURLToPath(new URL("toolbar-cold.png", output)) });
    await coldPopup.close();
    await cold.page.bringToFront();
    await inject(cold);
    await cold.page.getByRole("button", { name: "Apply karo", exact: true }).click();
    await cold.page.getByRole("button", { name: /Fill this page/ }).click();
    await cold.page.waitForFunction(() => document.querySelector("#first").value === "Avery");
    check("on-page-after-cold-start", "F14", "Avery", await cold.page.getByLabel("First name", { exact: true }).inputValue());
    const diagnosticDriver = await context.newPage(); await diagnosticDriver.goto(extensionOrigin + "/privacy.html");
    const diagnosticResult = await diagnosticDriver.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_diagnostics", tabId }), cold.tabId);
    check("diagnostics-export-redacted", "Phase0", true, diagnosticResult.diagnosticEvents?.length > 0 && !/Avery|Shah|example\.invalid|first_name/.test(JSON.stringify(diagnosticResult.diagnosticEvents)), { events: diagnosticResult.diagnosticEvents?.length || 0 });
    await worker.evaluate(async () => { const { settings } = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: { ...settings, diagnosticsEnabled: false } }); });
    const disabledDiagnostics = await diagnosticDriver.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_diagnostics", tabId }), cold.tabId);
    check("diagnostics-opt-out-clears", "Phase0", 0, disabledDiagnostics.diagnosticEvents?.length);
    await diagnosticDriver.close();
    await cold.page.close();

    await seed();
    const warm = await newForm("warm"); await inject(warm);
    const warmPopup = await popup(warm);
    await warmPopup.getByRole("button", { name: "Fill this page", exact: true }).click();
    await warm.page.bringToFront();
    let warmTimedOut = false;
    try { await warmPopup.waitForFunction(() => document.querySelector("#fill-label").textContent === "Fill this page", null, { timeout: 8000 }); }
    catch { warmTimedOut = true; }
    check("toolbar-warm-start", "F14", { value: "Avery", completed: true }, { value: await warm.page.getByLabel("First name", { exact: true }).inputValue(), completed: !warmTimedOut }, { footer: await warmPopup.locator("#footer-text").innerText(), logs: warm.logs });
    await warmPopup.close();
    const reviewRows = await engine(warm, "reviewFields");
    check("review-lists-every-field", "Phase6", 2, reviewRows.length);
    check("review-verified-facts-have-sources", "Phase6", true, reviewRows.every(r => r.group === "Verified facts" && r.source && r.question));
    await warm.page.getByRole("button", { name: "Apply karo", exact: true }).click();
    await warm.page.getByRole("button", { name: "Review answers and missing fields", exact: true }).click();
    await warm.page.locator('[data-review-list] h3').first().waitFor();
    check("review-panel-renders-four-states", "Phase6", 4, await warm.page.locator('[data-review-list] h3').count());
    const firstRow = reviewRows.find(r => /first name/i.test(r.question));
    await engine(warm, "reviewAction", [firstRow, "focus"]);
    check("review-row-focuses-control", "Phase6", "first", await warm.page.evaluate(() => document.activeElement.id));
    await engine(warm, "reviewAction", [firstRow, "confirm", "Reviewed Avery", "application"]);
    check("review-confirmation-writes-value", "Phase6", "Reviewed Avery", await warm.page.locator("#first").inputValue());
    const reviewed = (await engine(warm, "reviewFields")).find(r => r.id === firstRow.id);
    check("review-confirmed-answer-state", "Phase6", "Verified facts", reviewed.group);
    await engine(warm, "reviewAction", [reviewed, "undo"]);
    check("review-source-undo-restores-control", "Phase6", "Avery", await warm.page.locator("#first").inputValue());
    check("review-actions-reject-other-owner", "Phase6", false, await engine(warm, "reviewAction", [{ ...reviewed, owner: "unrelated-frame" }, "focus"]));
    check("review-keeps-final-submission-manual", "Phase6", 0, await warm.page.evaluate(() => __submissions));
    await warm.page.close();

    for (const id of ["close", "delayed"]) {
      await seed();
      if (id === "delayed") await worker.evaluate(() => {
        globalThis.__originalExecute = chrome.scripting.executeScript.bind(chrome.scripting);
        chrome.scripting.executeScript = async (args) => {
          if (args.files?.includes("src/engine/bundle.js")) await new Promise((r) => setTimeout(r, 1200));
          return globalThis.__originalExecute(args);
        };
      });
      const form = await newForm(id), p = await popup(form);
      await p.getByRole("button", { name: "Fill this page", exact: true }).click();
      if (id === "close") await p.close();
      await form.page.bringToFront();
      await new Promise((r) => setTimeout(r, 3500));
      check(id === "close" ? "popup-closure-during-start" : "delayed-engine-start", "F14", "Avery", await form.page.locator("#first").inputValue());
      if (id === "delayed") {
        await p.close();
        await worker.evaluate(() => { chrome.scripting.executeScript = globalThis.__originalExecute; });
      }
      await form.page.close();
    }

    await seed();
    const repeat = await newForm("warm"); await inject(repeat);
    const repeatDriver = await context.newPage(); await repeatDriver.goto(extensionOrigin + "/privacy.html");
    await repeat.page.bringToFront();
    const repeated = await repeatDriver.evaluate(async (tabId) => Promise.all([1, 2].map(() => chrome.runtime.sendMessage({ type: "tab_action", tabId, action: "rf_fill" }))), repeat.tabId);
    check("repeated-starts-complete", "F14", "Avery", await repeat.page.locator("#first").inputValue(), { replies: repeated });
    await repeatDriver.close(); await repeat.page.close();

    await seed({ profile: { personal: {}, education: [], experience: [], customFields: {} }, settings: { aiAutofillEnabled: true } });
    await worker.evaluate(() => { globalThis.__answer = "Yes"; });
    const learning = await newForm("learning"); await inject(learning);
    await engine(learning, "run", [{ manual: true, useAI: true }]);
    const learned = await worker.evaluate(async () => { const { learned, profile } = await chrome.storage.local.get(["learned", "profile"]); return { learned, custom: profile.customFields }; });
    check("unknown-certification-zero-model-requests", "Phase4", 0, await worker.evaluate(() => globalThis.__requests.length));
    check("unconfirmed-ai-memory", "F3", false, [...Object.values(learned.learned || {}), ...Object.values(learned.custom || {})].includes("Yes"), { requests: await worker.evaluate(() => globalThis.__requests.length), value: await learning.page.locator("#answer").inputValue() });
    await learning.page.close();

    await seed({ settings: { aiAutofillEnabled: true } });
    await worker.evaluate(() => { globalThis.__answer = "Woman"; });
    const sensitive = await newForm("sensitive"); await inject(sensitive);
    await engine(sensitive, "run", [{ manual: true, useAI: true }]);
    check("sensitive-policy-all-sources", "F8", 0, await worker.evaluate(() => globalThis.__requests.length), { value: await sensitive.page.getByLabel("Gender", { exact: true }).inputValue(), note: "Skipped sensitive fields must not be sent to the provider." });
    await sensitive.page.close();

    await seed({ settings: { aiAutofillEnabled: true, fieldAiButtonEnabled: true } });
    const edited = await newForm("inline-edit"); await inject(edited);
    await worker.evaluate(() => { globalThis.__delay = 700; });
    const pending = worker.evaluate(async (tabId) => {
      const [out] = await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
        return await window.__applyKaroEngine.handleExclusiveFill({ el: document.querySelector("#answer"), kind: "textarea", label: "Describe a project you built.", rawLabel: "Describe a project you built." }, "");
      } }); return out.result;
    }, edited.tabId).catch((e) => ({ error: e.message }));
    // Wait for the actual provider fake to start before making a human-style edit.
    for (let i = 0; i < 50; i++) {
      if (await worker.evaluate(() => globalThis.__requests.length > 0)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await edited.page.getByLabel("Describe a project you built.", { exact: true }).fill("My edit while AI was generating.");
    await pending;
    check("inline-preserves-inflight-edit", "F7", "My edit while AI was generating.", await edited.page.locator("#answer").inputValue());
    await edited.page.close();

    await seed({ settings: { aiAutofillEnabled: true, fieldAiButtonEnabled: true } });
    const inline = await newForm("inline-edit"); await inject(inline);
    await worker.evaluate(() => { globalThis.__answer = "I built internal tools at Example Labs."; });
    const generated = await worker.evaluate(async (tabId) => {
      const [out] = await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
        const result = await window.__applyKaroEngine.handleExclusiveFill({ el: document.querySelector("#answer") }, "");
        window.__testInlineUndo = result.undo; return { ok: result.ok, answer: result.answer };
      } }); return out.result;
    }, inline.tabId);
    check("inline-supported-draft-written", "Phase1", "I built internal tools at Example Labs.", await inline.page.locator("#answer").inputValue(), { generated });
    check("inline-draft-review-state", "Phase6", "Drafts to review", (await engine(inline, "reviewFields")).find(r => r.answer === generated.answer)?.group);
    await inline.page.locator("#answer").fill("My later correction.");
    await worker.evaluate(async (tabId) => chrome.scripting.executeScript({ target: { tabId }, func: () => { try { window.__testInlineUndo(); } catch { return "kept-edit"; } } }), inline.tabId);
    check("inline-undo-preserves-later-edit", "Phase1", "My later correction.", await inline.page.locator("#answer").inputValue());
    await inline.page.close();

    await seed({ profile: { ...profile, customFields: {} }, learned: { "first name": "Legacy Avery" } });
    const legacy = await newForm("warm"); await inject(legacy);
    await engine(legacy, "run", [{ manual: true, useAI: false }]);
    check("legacy-memory-quarantined", "Phase1", "Avery", await legacy.page.locator("#first").inputValue());
    await legacy.page.close();
    const dashboard = await context.newPage(); await dashboard.goto(extensionOrigin + "/options.html");
    await dashboard.locator('[data-tab="tab-settings"]').click();
    await dashboard.getByRole("button", { name: "Confirm answer", exact: true }).click();
    const confirmed = await worker.evaluate(async () => (await chrome.storage.local.get("answerTrust")).answerTrust?.learned?.["first name"]?.source);
    check("legacy-explicit-confirmation", "Phase1", "user-confirmed", confirmed);
    await dashboard.close();
    const approved = await newForm("warm"); await inject(approved);
    await engine(approved, "run", [{ manual: true, useAI: false }]);
    check("confirmed-memory-reused", "Phase1", "Legacy Avery", await approved.page.locator("#first").inputValue());
    await approved.page.close();

    await seed();
    const embedded = await newForm("/apply/forms/iframe");
    const embeddedDriver = await context.newPage(); await embeddedDriver.goto(extensionOrigin + "/privacy.html");
    await embedded.page.bringToFront();
    const embeddedResult = await embeddedDriver.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_fill", tabId }), embedded.tabId);
    check("embedded-frame-start-ready", "Phase1", { value: "Avery", frames: 2 }, { value: await embedded.page.frameLocator("iframe").getByLabel("First name", { exact: true }).inputValue(), frames: embeddedResult.frames.length });
    const embeddedReview = await embeddedDriver.evaluate(async tabId => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_review", tabId }), embedded.tabId);
    check("review-aggregates-child-frame", "Phase6", true, embeddedReview.reviewRows.some(r => /first name/i.test(r.question) && r.answer === "Avery"));
    const embeddedFirst = embeddedReview.reviewRows.find(r => /first name/i.test(r.question));
    const focusedChild = await embeddedDriver.evaluate(async ({ tabId, row }) => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_review_action", tabId, row, reviewOperation: "focus" }), { tabId: embedded.tabId, row: embeddedFirst });
    check("review-action-routes-to-owning-frame", "Phase6", true, focusedChild.handled);
    await embeddedDriver.close(); await embedded.page.close();

    await seed();
    const broken = await newForm("warm"); await inject(broken);
    await worker.evaluate(async (tabId) => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      window.__originalStorageGet = chrome.storage.local.get;
      chrome.storage.local.get = () => { throw new Error("Synthetic context failure"); };
    } }), broken.tabId);
    const brokenDriver = await context.newPage(); await brokenDriver.goto(extensionOrigin + "/privacy.html");
    const brokenResult = await brokenDriver.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_fill", tabId }), broken.tabId);
    check("claimed-frame-exception-terminal", "Phase1", true, brokenResult.state === "needs_attention" && brokenResult.error.includes("Synthetic context failure"), { result: brokenResult });
    await worker.evaluate(async (tabId) => chrome.scripting.executeScript({ target: { tabId }, func: () => {
      chrome.storage.local.get = window.__originalStorageGet;
    } }), broken.tabId);
    await brokenDriver.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: "tab_action", action: "rf_fill", tabId }), broken.tabId);
    check("frame-exception-retry-clears-busy", "Phase1", "Avery", await broken.page.locator("#first").inputValue());
    await brokenDriver.close(); await broken.page.close();

    await seed({ settings: { fieldAiButtonEnabled: true } });
    const reused = await newForm("inline-reuse"); await inject(reused);
    await reused.page.evaluate(() => { document.querySelector("#question").textContent = "Describe your Java experience."; });
    await engine(reused, "run", [{ manual: true, useAI: false }]);
    await reused.page.getByRole("button", { name: "Fill with AI", exact: true }).click();
    const questionText = await reused.page.locator("#applykaro-field-root").locator(".pop-question").innerText();
    check("inline-question-refresh", "F6", true, questionText.includes("Java experience"), { questionText });
    await reused.page.close();

    await seed({ profile: { personal: {}, education: [], experience: [], customFields: {} }, settings: { aiAutofillEnabled: true } });
    const large = await newForm("large"); await inject(large);
    await engine(large, "run", [{ manual: true, useAI: true }]);
    check("all-81-fields-accounted-for", "F10", 81, await large.page.locator("textarea").evaluateAll((els) => els.filter((el) => el.value.trim()).length), { requests: await worker.evaluate(() => globalThis.__requests.length) });
    await large.page.close();

    await seed({ settings: { aiAutofillEnabled: true } });
    await worker.evaluate(() => { globalThis.__answer = "Yes"; });
    const declarations = await newForm("unknown-declarations"); await inject(declarations);
    await engine(declarations, "run", [{ manual: true, useAI: true }]);
    check("unknown-declarations-not-guessed", "Phase1", { license: "", citizenship: "", consent: false }, await declarations.page.evaluate(() => ({ license: document.querySelector("#license").value, citizenship: document.querySelector("#citizenship").value, consent: document.querySelector("#consent").checked })));
    await declarations.page.close();

    await seed({ settings: { aiAutofillEnabled: true }, job: { company: "Other Employer", role: "Other Role", text: "Unrelated captured job description with enough words to be recognizable." } });
    const jobDriver = await context.newPage(); await jobDriver.goto(extensionOrigin + "/privacy.html");
    await jobDriver.evaluate(() => chrome.runtime.sendMessage({ type: "ai_fill", fields: [{ label: "Why do you want to join this company?", kind: "textarea" }], profile: {}, jobContext: null }));
    check("job-context-bound-to-application", "F12", false, await worker.evaluate(() => globalThis.__requests.some((p) => p.includes("Other Employer"))), { requests: await worker.evaluate(() => globalThis.__requests.length), note: "Worker request with absent application context; no live page identity claim." });
    await jobDriver.close();

    await seed({ profile: { ...profile, personal: { ...profile.personal, country: "" } } });
    const custom = await newForm("custom-learning"); await inject(custom);
    await custom.page.getByRole("combobox").click();
    await custom.page.getByRole("option", { name: "Canada", exact: true }).click();
    await custom.page.waitForTimeout(400);
    await custom.page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    const memory = await worker.evaluate(async () => {
      return await new Promise((resolve, reject) => {
        const open = indexedDB.open("apply-karo-knowledge", 1); open.onerror = () => reject(open.error);
        open.onsuccess = () => { const db = open.result, request = db.transaction("knowledge").objectStore("knowledge").get("state"); request.onsuccess = () => { resolve(request.result?.answers || {}); db.close(); }; request.onerror = () => reject(request.error); };
      });
    });
    check("custom-widget-correction-learning", "F13", true, Object.values(memory).some(r => r.value === "Canada" && r.status === "approved" && r.provenance.source === "user-correction"));
    await custom.page.reload(); await inject(custom);
    await engine(custom, "run", [{ manual: true, useAI: false }]);
    check("custom-correction-reused-after-reload", "Phase6", "Canada", await custom.page.getByRole("combobox").textContent());
    await custom.page.evaluate(() => { document.querySelector('label').textContent = "Country of citizenship"; const el = document.querySelector('#answer'); el.textContent = "Select one"; delete el.dataset.selected; });
    await engine(custom, "run", [{ manual: true, useAI: false }]);
    check("correction-withheld-different-meaning", "Phase6", "Select one", await custom.page.getByRole("combobox").textContent());
    await custom.page.close();
    await seed({ profile: { ...profile, personal: { ...profile.personal, country: "" } } });
    const destroyed = await newForm("/phase2/destroyed-menu"); await inject(destroyed);
    await destroyed.page.getByRole("combobox").click(); await destroyed.page.getByRole("option", { name: "Canada", exact: true }).click();
    await destroyed.page.waitForTimeout(400); await destroyed.page.reload(); await inject(destroyed);
    await engine(destroyed, "run", [{ manual: true, useAI: false }]);
    check("destroyed-custom-menu-correction-reused", "Phase6", "Canada", await destroyed.page.getByRole("combobox").textContent());
    await destroyed.page.close();

    await seed({ profile: { ...profile, personal: { ...profile.personal, phone: "" } } });
    const reviewForm = await newForm("review-learning"); await inject(reviewForm);
    await engine(reviewForm, "run", [{ manual: true, useAI: false }]);
    const missing = await engine(reviewForm, "reviewFields");
    check("review-unresolved-field-accounting", "Phase6", 4, missing.length);
    check("review-policy-exclusion-explained", "Phase6", true, missing.some(r => /agree/i.test(r.question) && r.group === "Could not fill" && !!r.reason));
    await reviewForm.page.getByRole("button", { name: "Apply karo", exact: true }).click();
    await reviewForm.page.getByRole("button", { name: "Review answers and missing fields", exact: true }).click();
    await reviewForm.page.locator('[data-review-list] h3').first().waitFor();
    await reviewForm.page.getByLabel("Answer: Phone number", { exact: true }).first().fill("5550100123");
    await reviewForm.page.getByRole("button", { name: "Use for this application", exact: true }).first().click();
    await reviewForm.page.waitForFunction(() => document.querySelector('#phone1').value === '5550100123' && document.querySelector('#phone2').value === '5550100123');
    await reviewForm.page.getByRole("heading", { name: "Verified facts (2)", exact: true }).waitFor();
    check("missing-answer-collected-once-for-equivalent-fields", "Phase6", ["5550100123", "5550100123"], await reviewForm.page.locator('#phone1,#phone2').evaluateAll(els => els.map(el => el.value)));
    const reportDownload = reviewForm.page.waitForEvent("download");
    await reviewForm.page.getByRole("button", { name: "Export issue report", exact: true }).click();
    const download = await reportDownload, reportPath = await download.path();
    const { readFile } = await import("node:fs/promises"); const reportText = await readFile(reportPath, "utf8");
    check("review-report-redacts-by-default", "Phase6", true, !reportText.includes("5550100123") && !reportText.includes("Phone number") && !reportText.includes(reviewForm.url));
    await reviewForm.page.screenshot({ path: fileURLToPath(new URL("phase6-review.png", output)), fullPage: true });
    check("review-learning-zero-submissions", "Phase6", 0, await reviewForm.page.evaluate(() => __submissions));
    const memoryDashboard = await context.newPage(); await memoryDashboard.goto(extensionOrigin + "/options.html#tab-learned");
    await memoryDashboard.getByLabel("Search knowledge", { exact: true }).fill("Phone number");
    const knowledgePanel = memoryDashboard.locator("#knowledge-panel");
    await knowledgePanel.getByRole("button", { name: "Edit answer", exact: true }).first().click();
    await knowledgePanel.getByLabel("Edit saved answer", { exact: true }).fill("5550200123");
    await knowledgePanel.getByRole("button", { name: "Save reviewed answer", exact: true }).click();
    await knowledgePanel.getByLabel("Edit saved answer", { exact: true }).waitFor({ state: "detached" });
    await reviewForm.page.reload(); await inject(reviewForm); await engine(reviewForm, "run", [{ manual: true, useAI: false }]);
    check("memory-search-and-edit-reused", "Phase6", ["5550200123", "5550200123"], await reviewForm.page.locator('#phone1,#phone2').evaluateAll(els => els.map(el => el.value)));
    await knowledgePanel.getByRole("button", { name: "Delete", exact: true }).first().click();
    await knowledgePanel.getByRole("button", { name: "Undo deletion", exact: true }).click();
    await knowledgePanel.getByRole("button", { name: "Edit answer", exact: true }).first().waitFor();
    check("memory-delete-undo-restores-reviewed-answer", "Phase6", true, (await knowledgePanel.innerText()).includes("5550200123"));
    await memoryDashboard.close();
    await reviewForm.page.close();

    await seed();
    const dropped = await newForm("missing-frame"); await inject(dropped);
    await worker.evaluate(async (tabId) => { await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg) => msg.type === "rf_frame_result" ? Promise.resolve({ ok: true }) : send(msg);
    } }); }, dropped.tabId);
    const started = Date.now();
    const driver = await context.newPage(); await driver.goto(extensionOrigin + "/privacy.html");
    await dropped.page.bringToFront();
    const outcome = await Promise.race([
      driver.evaluate(async (tabId) => await chrome.runtime.sendMessage({ type: "tab_action", tabId, action: "rf_fill" }), dropped.tabId).catch((e) => ({ error: e.message })),
      new Promise((r) => setTimeout(() => r({ timeout: true }), 12000))
    ]);
    check("missing-frame-result-bounded", "F14", false, !!outcome.timeout, { elapsedMs: Date.now() - started, note: "Test deadline 12 seconds; production coordinator ceiling is 120 seconds. Result loss deliberately injected." });
    await dropped.page.close();
    await driver.close();
    await writeFile(new URL("extension.json", output), JSON.stringify({ evidenceKind: "real-extension-local-fixtures-mocked-provider", results, profileDirectory: userDataDir,
      limitations: ["Popup rendered as extension tab; activeTab lookup pinned to target form.", "All provider fetches intercepted in worker; no live provider claims.", "Fresh test profile retained for diagnosis; user browser profile untouched."] }, null, 2));
    return results;
  } finally { await context.close(); }
}
