// Actual worker termination in a fresh extension profile. No AI request is made.
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, startServer } from "./server.mjs";
import { loadPlaywright, browserOptions } from "./runtime.mjs";
import { profile } from "../fixtures/autofill/corpus.mjs";

const server = await startServer();
const { chromium } = loadPlaywright();
const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "resumefiler-lifecycle-")), {
  ...browserOptions(), args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
});
const results = [];
try {
  let worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const origin = new URL(worker.url()).origin;
  // chrome-extension URLs have an opaque URL.origin in Node.
  const extensionOrigin = origin === "null" ? worker.url().replace(/\/background\.js$/, "") : origin;
  await worker.evaluate(async (profile) => chrome.storage.local.set({ profile, learned: {}, settings: {
    aiAutofillEnabled: false, autofillOnLoad: false, autoUploadResume: false, trackApplications: false,
    showBadge: false, panelEnabled: true, skipSensitive: true
  }, schemaVersion: 2 }), profile);
  const form = await context.newPage(); await form.goto(server.origin + "/neutral/warm");
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id, form.url());
  const driver = await context.newPage(); await driver.goto(extensionOrigin + "/privacy.html");
  await driver.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: "tab_action", tabId, action: "rf_fill" }), tabId);
  const cdp = await context.newCDPSession(driver);
  let stopped = false;
  cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
    if (versions.some((v) => v.scriptURL === worker.url() && v.runningStatus === "stopped")) stopped = true;
  });
  await cdp.send("ServiceWorker.enable");
  async function restartWith(patch) {
    await worker.evaluate(async ({ tabId, patch }) => {
      const { fillJobs } = await chrome.storage.session.get("fillJobs");
      const job = fillJobs.findLast((j) => j.tabId === tabId);
      Object.assign(job, { state: "filling", deadline: Date.now() + 10000, error: "" }, patch);
      await chrome.storage.session.set({ fillJobs });
    }, { tabId, patch });
    stopped = false;
    await cdp.send("ServiceWorker.stopAllWorkers");
    let job;
    for (let i = 0; i < 100; i++) {
      job = (await driver.evaluate(async (tabId) => chrome.runtime.sendMessage({ type: "fill_job_status", tabId }), tabId)).job;
      if (["completed", "needs_attention", "interrupted", "failed"].includes(job?.state)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    worker = context.serviceWorkers().find((w) => w.url().startsWith(extensionOrigin)) || await context.waitForEvent("serviceworker");
    return { stopped, state: job?.state, error: job?.error, value: await form.locator("#first").inputValue() };
  }
  // Simulate termination after content completion but before persisted completion.
  const recovered = await restartWith({});
  results.push({ id: "worker-restart-observes-cached-result", ...recovered,
    pass: recovered.stopped && recovered.state === "completed" && recovered.value === "Avery" });
  // Lost content acknowledgement must not replay the fill over a subsequent edit.
  await form.locator("#first").fill("My reviewed edit");
  const unknown = await restartWith({ runId: "synthetic-unknown-run" });
  results.push({ id: "worker-restart-unknown-run-no-replay", ...unknown,
    pass: unknown.stopped && unknown.state === "interrupted" && unknown.value === "My reviewed edit" });
  await mkdir(new URL("./output/", import.meta.url), { recursive: true });
  await writeFile(new URL("./output/lifecycle.json", import.meta.url), JSON.stringify({ results, limitations: ["Synthetic local form; AI disabled. Worker stopped via Chromium DevTools."] }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.pass)) process.exitCode = 1;
} finally { await context.close(); await server.close(); }
