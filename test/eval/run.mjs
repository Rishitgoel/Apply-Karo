import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { corpus, profile, negativePairs } from "../fixtures/autofill/corpus.mjs";
import { startServer } from "./server.mjs";
import { loadPlaywright, browserOptions } from "./runtime.mjs";
import { contractRegressions } from "./regressions.mjs";
import { extensionScenarios } from "./extension.mjs";
import { buildBundle } from "../../bundle.mjs";
import { readFile } from "node:fs/promises";

buildBundle(); // Always measure the current engine source, never a stale bundle.
const output = new URL("./output/", import.meta.url);
await mkdir(output, { recursive: true });
const server = await startServer();
const { chromium } = loadPlaywright();
const browser = await chromium.launch(browserOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// Prevent any fixture or imported module from accidentally using external services.
await page.route("**/*", (route) => route.request().url().startsWith(server.origin + "/") ? route.continue() : route.abort());
const forms = [];
try {
  for (const form of corpus) {
    await page.goto(`${server.origin}/apply/forms/${form.id}`);
    const frame = form.family === "frame" ? page.frames().find((f) => f.url().includes("/apply/inner/")) : page.mainFrame();
    if (!frame) throw new Error(`Missing fixture frame ${form.id}`);
    await frame.waitForFunction(() => window.__fixtureReady === true);
    const evaluated = await frame.evaluate(async ({ gold, profile, origin }) => {
      const { scan } = await import(origin + "/src/engine/scan.js");
      const { assign } = await import(origin + "/src/shared/rules.js");
      const { ruleValue } = await import(origin + "/src/engine/index.js");
      const { fillSync, fillAsync } = await import(origin + "/src/engine/fill.js");
      const root = document.querySelector("synthetic-form")?.shadowRoot || document;
      const fields = scan(root);
      const assigned = assign(fields, { skipSensitive: true, hasAnswerFor: (id) => !!ruleValue(id, profile) });
      const trials = new Map();
      const started = performance.now();
      const ordered = fields.map((_, i) => i).sort((a, b) => {
        const rank = (i) => /country/i.test(assigned.get(i)?.ruleId || "") ? 0 : /state|province/i.test(assigned.get(i)?.ruleId || "") ? 1 : 2;
        return rank(a) - rank(b);
      });
      for (const i of ordered) {
        const f = fields[i], id = f.el.getAttribute("data-gold-id");
        if (!id) continue;
        const hit = assigned.get(i), value = hit ? ruleValue(hit.ruleId, profile, hit.instance) : null;
        let reported = false;
        if (value !== null && value !== undefined && String(value).trim()) {
          const r = fillSync(f, value, hit.ruleId);
          reported = r === null ? await fillAsync(f, value, hit.ruleId) : r;
        }
        trials.set(id, { extracted: f.rawLabel, kind: f.kind, rule: hit?.ruleId || null, value: value ?? null, reported });
      }
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      while (window.__pendingValidations) await new Promise((resolve) => requestAnimationFrame(resolve));
      const rows = gold.map((q) => {
        const el = root.querySelector(`[data-gold-id="${q.id}"]`), trial = trials.get(q.id);
        // The fixture's app state is the oracle for custom widgets, not visible search text.
        const actual = el?.hasAttribute("data-combo") ? el.dataset.selected || "" : el?.value || "";
        const detected = !!trial;
        const questionCorrect = detected && String(trial.extracted).replace(/\s+/g, " ").trim() === q.question.replace(/\s+/g, " ").trim();
        const written = actual !== "";
        const correct = q.answer !== null && actual === q.answer;
        const stage = !detected ? "discovery" : !questionCorrect ? "question" : !trial.rule ? "mapping" : trial.value === null ? "missing_fact" : !written ? "write" : !correct ? "answer" : "verified";
        return { id: q.id, eligible: q.eligible, answerable: q.answerable, detected, questionCorrect, expectedRule: q.rule, ...trial, actual, written, correct,
          falseSuccess: !!trial?.reported && !written, stage };
      });
      return { rows, elapsedMs: Math.round(performance.now() - started), submissions: window.__submissions };
    }, { gold: form.questions, profile: form.id === "workday-repeated" ? { ...profile, experience: [...profile.experience, { company: "Earlier Example Labs", title: "Developer", location: "Boston" }] } : profile, origin: server.origin });
    forms.push({ id: form.id, family: form.family, split: form.split, ...evaluated });
    console.log(`${form.id}: detected ${evaluated.rows.filter((r) => r.detected).length}/25; correct ${evaluated.rows.filter((r) => r.correct).length}/22; false-success ${evaluated.rows.filter((r) => r.falseSuccess).length}`);
  }
  await writeFile(new URL("corpus.json", output), JSON.stringify({ version: 1, forms }, null, 2));
  const contracts = await contractRegressions();
  const extension = await extensionScenarios({ chromium, origin: server.origin, output });
  const summarize = (items) => {
    const rows = items.flatMap((f) => f.rows), n = (key) => rows.filter((r) => r[key]).length;
    const counts = { eligible: n("eligible"), answerable: n("answerable"), detected: n("detected"), fullQuestion: n("questionCorrect"), written: n("written"), correct: n("correct"), falseSuccess: n("falseSuccess") };
    return { ...counts, discoveryRecall: counts.eligible ? counts.detected / counts.eligible : null,
      questionFidelity: counts.detected ? counts.fullQuestion / counts.detected : null,
      automaticPrecision: counts.written ? counts.correct / counts.written : null,
      answerableCoverage: counts.answerable ? counts.correct / counts.answerable : null,
      stages: Object.fromEntries(["discovery", "question", "mapping", "missing_fact", "write", "answer", "verified"].map((s) => [s, rows.filter((r) => r.stage === s).length])) };
  };
  const report = { version: 1, measuredAt: new Date().toISOString(), evidenceKind: "synthetic-local-browser",
    browser: browser.version(), bundleHash: createHash("sha256").update(await readFile(new URL("../../src/engine/bundle.js", import.meta.url))).digest("hex"), corpusHash: createHash("sha256").update(JSON.stringify(corpus)).digest("hex"),
    formVariants: corpus.length, uniqueIntentRows: 25, negativePairs, aggregate: summarize(forms),
    tuning: summarize(forms.filter((f) => f.split === "tuning")), heldout: summarize(forms.filter((f) => f.split === "heldout")),
    families: Object.fromEntries([...new Set(forms.map((f) => f.family))].map((family) => [family, summarize(forms.filter((f) => f.family === family))])),
    contracts, extension, forms, limitations: ["Synthetic structural fixtures; no live ATS or live model acceptance.", "Corpus uses 25 authored intent rows across 20 templates; correlated observations.", "Corpus exercises scanner/rules/filler directly; extension entry points measured separately.", "No human timing trials; 90 percent target unmeasured."] };
  await writeFile(new URL("phase0.json", output), JSON.stringify(report, null, 2) + "\n");
  if (process.argv.includes("--phase2")) {
    const { phase2Controls } = await import("./phase2.mjs");
    const controls = await phase2Controls();
    const supportedHeldout = [...new Set(forms.filter((f) => f.split === "heldout").map((f) => f.family))]
      .map((family) => ({ family, ...summarize(forms.filter((f) => f.family === family && f.split === "heldout")) }));
    const scopedExtension = extension.filter((r) => r.finding !== "F13");
    report.phase2Gate = { controls, supportedHeldout,
      passed: controls.passed && contracts.every((r) => r.status === "pass") && scopedExtension.every((r) => r.status === "pass") &&
        supportedHeldout.every((f) => f.discoveryRecall >= .98 && f.questionFidelity >= .99) };
    report.fixtureHash = createHash("sha256").update(await readFile(new URL("../fixtures/autofill/corpus.mjs", import.meta.url))).digest("hex");
    await writeFile(new URL("phase2.json", output), JSON.stringify(report, null, 2) + "\n");
    console.log(`Phase 2 gate: ${report.phase2Gate.passed ? "PASS" : "FAIL"}; later-phase F13/overall accuracy/write-verification gates remain separate.`);
    if (!report.phase2Gate.passed) process.exitCode = 1;
  }
  if (process.argv.includes("--phase1")) {
    const scoped = { contracts: contracts.filter((r) => ["F2", "F5"].includes(r.finding)), extension: extension.filter((r) => !["F10", "F13"].includes(r.finding)) };
    report.phase1Gate = { ...scoped, passed: scoped.contracts.every((r) => r.status === "pass") && scoped.extension.every((r) => r.status === "pass") };
    await writeFile(new URL("phase1.json", output), JSON.stringify(report, null, 2) + "\n");
    console.log(`Phase 1 gate: ${report.phase1Gate.passed ? "PASS" : "FAIL"}; ${scoped.extension.length} browser cases, ${scoped.contracts.length} module contracts. Later-phase failures remain recorded.`);
    if (!report.phase1Gate.passed) process.exitCode = 1;
  }
  console.log(JSON.stringify({ aggregate: report.aggregate, contracts: contracts.filter((r) => r.status !== "pass").length, extension: extension.map((s) => ({ id: s.id, status: s.status })), report: new URL("phase0.json", output).pathname }, null, 2));
  if (process.argv.includes("--strict") && (contracts.some((r) => r.status !== "pass") || extension.some((r) => r.status === "failing_contract") || report.aggregate.answerableCoverage < .95 || report.aggregate.questionFidelity < .99 || report.aggregate.falseSuccess)) process.exitCode = 1;
  if (forms.some((f) => f.submissions !== 0)) throw new Error("A fixture was submitted unexpectedly");
} finally { await browser.close(); await server.close(); }
