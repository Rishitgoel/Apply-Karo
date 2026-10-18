// GENERATED FILE — DO NOT EDIT.
//
// Built from src/engine/index.js and its imports by `node bundle.mjs`.
// Edit the sources under src/engine/ and src/shared/, then rebuild.
//
// This is a classic script on purpose: chrome.scripting.executeScript() cannot
// run ES modules, and executeScript is how the engine gets onto the page —
// nothing here is web-accessible, so no site can probe for the extension.
(() => {
  "use strict";

  // boot() is async and nothing here awaits it, so a failed start would leave
  // no trace but an unhandled rejection. Say so instead — this is the failure
  // that makes every button in the popup report "Couldn't reach the page".
  const __start = (engine) => Promise.resolve(engine.boot())
    .catch((err) => console.error("Apply karo: engine failed to start —", err));

  // Injected once per frame, but the service worker is asked to inject on both
  // automatic detection and an explicit "Fill this page". A second run must not
  // build a second module registry: that would mean a second message listener,
  // a second MutationObserver and a second panel. The isolated world is shared
  // with the content script, so this flag survives between injections.
  if (window.__applyKaroEngine) { __start(window.__applyKaroEngine); return; }

  const __m = {};
  const __c = {};
  const __req = (id) => {
    if (__c[id]) return __c[id];
    const x = (__c[id] = {});
    __m[id](x, __req);
    return x;
  };

__m["src/engine/index.js"] = (__x, __req) => {
const { beginWrite, writeVerified, uploadVerified } = __req("src/engine/controls/adapter.js");
const { guardUndo, accepts } = __req("src/engine/verify.js");
const { validationState, readControl } = __req("src/engine/controls/read.js");
const { isExtensionAction, realClick } = __req("src/engine/controls/native.js");
const { dependencyPriority, trackDependencies } = __req("src/engine/dependencies.js");
const { bindEntities, addMissingRepeats } = __req("src/engine/repeats.js");
const { resolveFields, resolveOne } = __req("src/resolver/resolve.js");
const { ruleCandidate } = __req("src/resolver/validate.js");
// Apply karo — engine entry point.
//
// Loaded lazily by src/detect.js via dynamic import, so none of this code is
// fetched, parsed or executed on pages that are not job applications.

const { loadContext, loadResumeFile, resolvePath, recordApplication, isSiteDisabled, setSiteDisabled, saveSettings, priorApplicationsFor, loadHistory, loadJob, setJob, extensionAlive, STALE_MESSAGE } = __req("src/shared/schema.js");
// Reading a posting is in shared/posting.js rather than here, because the page
// holding the job description is the listing page — which has no form on it, so
// the engine is never injected there. The toolbar has to be able to read one
// without this module existing at all.
const { postingFromPage, pageIdentity, MIN_JD_CHARS } = __req("src/shared/posting.js");
const { assign, RULE_BY_ID, COVER_LETTER_HINTS, pickResumeTargets, fieldKey, normalizeKey } = __req("src/shared/rules.js");
const { splitPhone, parseTimeframe } = __req("src/shared/values.js");
const { scan, surfaceInventory, invalidateShadowCache, labelOf, helperTextFor, rawControls, whyDropped, isComboboxFilled, COMBO_PLACEHOLDER_RE, isGenericLabel } = __req("src/engine/scan.js");
const { setValue, fire, isFocused } = __req("src/engine/fill.js");
const { runSteps: stepThrough } = __req("src/engine/steps.js");
const { initFieldOverlays, updateFieldOverlays, destroyFieldOverlays, isParagraphTarget } = __req("src/engine/inline.js");
const { answerPolicy } = __req("src/shared/answer-policy.js");
const { captureRevision, JOB_LABELS, isRunningJob } = __req("src/engine/session.js");
const { processQueue } = __req("src/engine/discovery/queue.js");
const { configureQuestionFixes, locatorFor } = __req("src/engine/discovery/labels.js");
const { createDiagnostics, extractionSignal } = __req("src/engine/diagnostics.js");
const { knowledge } = __req("src/knowledge/client.js");
const { questionContext, scopedAnswerIdentity } = __req("src/knowledge/retrieve.js");
const { answerText, reusableQuestion } = __req("src/knowledge/learning.js");
const { reviewRow } = __req("src/engine/review.js");
const { releasePolicy } = __req("src/shared/release.js");

const reviewDecisions = new Map();
const reviewOwner = `${globalThis.location?.href || ""}#${Math.random()}`;
const memoryUndos = new Map();
const unseenReviewControls = new Map();
function retainDecision(field, decision) { reviewDecisions.set(field.fieldId, { revision: field.formRevision, decision, field, dependencies: JSON.stringify(ctx?.knowledge?.dependencies || {}) }); }
function reviewFields() {
  const fields = bindEntities(scan(), ctx.profile, ctx.knowledge), mappings = assign(fields, { canMap: ruleCandidate, skipSensitive: ctx.settings.skipSensitive, hasAnswerFor: () => true });
  const rows = fields.map((field, i) => {
    const stored = reviewDecisions.get(field.fieldId);
    const sourceChanged = stored && stored.dependencies !== JSON.stringify(ctx.knowledge?.dependencies || {});
    const openedChoices = stored && field.kind === "combobox" && stored.field.optionsComplete === false && !stored.field.options?.length &&
      stored.field.verification?.status === "verified" && ["questionFull", "sectionTitle", "helperText", "entityId", "instance"].every(key => stored.field[key] === field[key]) && accepts(field, stored.decision.value);
    const decision = stored?.revision === field.formRevision || openedChoices ? sourceChanged ? { ...stored.decision, status: "draft", reason: "Source facts changed; review the existing value" } : stored.decision : resolveOne(describeField(field), { profile: ctx.profile, settings: ctx.settings, knowledge: ctx.knowledge, url: location.href, mapping: mappings.get(i) });
    if (decision && accepts(field, decision.value)) field.verification = stored.field.verification;
    const row = reviewRow(field, decision, answerText(field, readControl(field)), validationState(field), looksEmpty(field));
    return { ...row, editable: row.editable && answerPolicy(field, ctx.settings).allowed, owner: reviewOwner };
  });
  unseenReviewControls.clear();
  for (const [i, el] of surveyEmpty().unseen.entries()) {
    const id = `unseen-${i}`; unseenReviewControls.set(id, el);
    rows.push({ id, revision: 0, owner: reviewOwner, question: labelOf(el) || "Unrecognized field", group: "Could not fill", answer: "", source: "No supported control descriptor", transformations: [], reason: whyDropped(el) || "Unsupported control", required: !!el.required, editable: false });
  }
  return rows;
}
async function reviewAction(row, action, value, scope = "application") {
  if (row.owner !== reviewOwner) return false;
  if (!["focus"].includes(action) && busy) throw new Error("Wait for filling to finish before changing reviewed answers.");
  const unseen = unseenReviewControls.get(row.id);
  if (unseen && action === "focus" && unseen.isConnected && (labelOf(unseen) || "Unrecognized field") === row.question) { unseen.scrollIntoView({ block: "center" }); unseen.focus?.(); return true; }
  const field = bindEntities(scan(), ctx.profile, ctx.knowledge).find(f => f.fieldId === row.id && f.formRevision === row.revision);
  if (!field) throw new Error("The question changed. Refresh the review list.");
  if (action === "focus") { field.el.scrollIntoView({ block: "center" }); field.el.focus?.(); field.el.style.outline = "3px solid #f59e0b"; return true; }
  if (action === "undo") {
    const token = memoryUndos.get(field.fieldId), restore = sourceUndos.get(field.fieldId);
    if (!restore && !token) throw new Error("Nothing to undo for this field.");
    if (restore && !restore()) throw new Error("A later edit was kept; this field cannot be undone.");
    if (token) { await knowledge("undo-answer", { token }); ctx.knowledge = await knowledge("snapshot"); memoryUndos.delete(field.fieldId); }
    sourceUndos.delete(field.fieldId); reviewDecisions.delete(field.fieldId); return true;
  }
  if (action === "mapping-repair") { const prior = wrote.get(field.el); if (!prior) throw new Error("No rule mapping to repair for this field."); demote(prior.key, prior.ruleId); await persist(); return true; }
  if (!answerPolicy(field, ctx.settings).allowed || field.skip || field.kind === "file") throw new Error("This control needs manual review.");
  const current = answerText(field, readControl(field));
  if (row.answer !== current) throw new Error("The answer changed. Refresh before confirming.");
  if (!String(value).trim()) throw new Error("Enter an answer first.");
  if (scope === "similar" && !reusableQuestion(row.question)) throw new Error("This question needs application-specific review. Use it for this application.");
  if (current !== value) {
    if (!releasePolicy(ctx.settings).enabled) throw new Error(releasePolicy(ctx.settings).reason);
    const restore = snapshot(field);
    busy = true;
    try { const ok = await writeVerified(field, value); if (!ok) { restore.dispose(); throw new Error("The control refused this answer."); } restore.arm(); undoStack.push(restore); sourceUndos.set(field.fieldId, restore); }
    finally { busy = false; }
  }
  await learn(field, value, scope, true);
  field.verification = { status: "verified", reason: "User reviewed value" };
  retainDecision(field, { status: "resolved", source: "User reviewed answer", value, reason: "Confirmed by you" });
  return true;
}
const sourceUndos = new Map();

const IS_TOP = typeof window !== "undefined" ? window === window.top : true;
const OWN_UI = "#applykaro-root, #applykaro-field-root";
const CONTROL_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "FORM", "FIELDSET"]);
const diagnostics = createDiagnostics();
const diagnosticFrame = IS_TOP ? "top" : "child";
function diagnose(field, stage, outcome, reason) {
  if (!diagnostics.enabled) return;
  diagnostics.record({ field, stage, outcome, reason, source: extractionSignal(field), frame: diagnosticFrame });
}

let ctx = null;
let panel = null;             // lazily imported UI module
let observer = null;
let quietRuns = 0;
let ranOnce = false;
let busy = false;
let siteDisabled = false;

// Controls that the user has manually edited, typed in, or uploaded files to.
// Never overwritten by any automatic or manual autofill pass.
const userModifiedElements = new WeakSet();
const userModifiedKeys = new Set();
let userUploadedFile = false;

// Everything the last fill touched, newest run only, so it can be taken back.
let undoStack = [];

// ─────────────────────────────────────────────────────────────────────────────
// Highlighting
// ─────────────────────────────────────────────────────────────────────────────

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.id = "applykaro-styles";
  s.textContent = `
    .rf-hit{outline:2px solid #22c55e!important;outline-offset:1px!important;
      transition:outline-color .8s ease-out!important}
    .rf-hit-fade{outline-color:transparent!important}
    .rf-guess{outline:2px solid #f59e0b!important;outline-offset:1px!important}
  `;
  (document.head || document.documentElement).appendChild(s);
}

function highlight(el, guess) {
  if (!ctx?.settings.highlightFills) return;
  ensureStyles();
  el.classList.add(guess ? "rf-guess" : "rf-hit");
  if (!guess) {
    setTimeout(() => el.classList.add("rf-hit-fade"), 1400);
    setTimeout(() => el.classList.remove("rf-hit", "rf-hit-fade"), 2400);
  }
}

function clearHighlights() {
  for (const el of document.querySelectorAll(".rf-hit,.rf-guess,.rf-hit-fade,.rf-missed")) {
    el.classList.remove("rf-hit", "rf-guess", "rf-hit-fade", "rf-missed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Undo
//
// Autofill's worst failure is not a blank box, it is a confident wrong answer
// written over something you had already typed. We never overwrite a non-empty
// field, but a fill can still land somewhere you did not want it — so every
// value we write records how to put the control back exactly as it was.
// ─────────────────────────────────────────────────────────────────────────────

/** Capture every control a field owns, before anything is written to it. */
function snapshot(field) {
  const initialRead=readControl(field);
  const els = new Set();
  if (field.el) els.add(field.el);
  if (field.nativeSelect) els.add(field.nativeSelect);
  for (const p of field.parts || []) if (p.field?.el) els.add(p.field.el);
  for (const o of field.options || []) if (o.el) els.add(o.el);

  const saved = [...els].map((el) => ({
    el,
    value: typeof el.value === "string" ? el.value : null,
    checked: typeof el.checked === "boolean" ? el.checked : null,
    ariaChecked: el.getAttribute ? el.getAttribute("aria-checked") : null,
    ariaSelected: el.getAttribute ? el.getAttribute("aria-selected") : null,
    text: el.isContentEditable ? el.textContent : null,
    files: el.type === "file"
  }));

  return guardUndo(field, () => {
    if(field.kind==="combobox" && !field.nativeSelect && !field.el.hasAttribute("list") && !["both","inline"].includes(field.el.getAttribute("aria-autocomplete"))) {
      if(initialRead.length)return false;
      const box=field.el.closest('[data-automation-id="formField"],.select__control,[data-control],.field') || field.el.parentElement;
      const clear=box?.querySelector('button[data-automation-id="clearSelection"],button[aria-label="Clear selection"],.select__clear-indicator,[data-clear-selection]');
      if(!clear || clear.type==="submit")return false;
      realClick(clear);return readControl(field).length===0;
    }
    for (const s of saved) {
      try {
        if (s.text !== null) s.el.textContent = s.text;
        if (s.files) { s.el.value = ""; }
        else if (s.value !== null) setValue(s.el, s.value);
        if (s.checked !== null) s.el.checked = s.checked;
        if (s.ariaChecked !== null) s.el.setAttribute("aria-checked", s.ariaChecked);
        else if (s.el.hasAttribute?.("aria-checked")) s.el.removeAttribute("aria-checked");
        if (s.ariaSelected !== null) s.el.setAttribute("aria-selected", s.ariaSelected);
        else if (s.el.hasAttribute?.("aria-selected")) s.el.removeAttribute("aria-selected");
        fire(s.el, "input");
        fire(s.el, "change");
      } catch { /* a control that resists being reset is not worth aborting for */ }
    }
  });
}

/** Put the page back the way the last fill found it. */
function undoFill() {
  const n = undoStack.length;
  if (!n) return 0;
  let restored = 0;
  busy = true;                       // do not learn from our own restore events
  try {
    // Newest first: a later fill may have been layered onto an earlier one.
    for (let i = n - 1; i >= 0; i--) if (undoStack[i]()) restored++;
    undoStack.forEach(r=>r.dispose?.());
    clearHighlights();
  } finally {
    busy = false;
  }
  undoStack = [];
  wrote = new WeakMap();
  // The undo emptied the file inputs too, so the next fill must be free to
  // attach the resume again rather than treating them as already done. The
  // dropdowns it reset are in the same position.
  attached = new WeakSet();
  widgetTried = new WeakSet();
  setBadge(0);
  return restored;
}

const canUndo = () => undoStack.length > 0;

// ─────────────────────────────────────────────────────────────────────────────
// Value resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Custom fields are stored under whatever key created them: the dashboard and
 * the learning loop both lowercase the visible label ("salary expectation"),
 * while rule paths name them in camelCase ("salaryExpectation"). Try the
 * spellings that map onto each other rather than silently missing the answer.
 */
function customLookup(custom, key) {
  if (!custom) return null;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const variants = [key, key.toLowerCase(), spaced, spaced.replace(/ /g, "_")];
  for (const variant of variants) {
    const v = custom[variant];
    if (v !== undefined && String(v).trim() !== "") return String(v);
  }
  const targetNorms = new Set(variants.map((v) => v.toLowerCase().replace(/[^a-z0-9]+/g, "")));
  for (const [k, v] of Object.entries(custom)) {
    if (v === undefined || String(v).trim() === "") continue;
    const normK = k.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (targetNorms.has(normK)) return String(v);
  }
  return null;
}

/**
 * @param instance which repeat of a block this field sits in — an indexable
 *   rule reads `education[2].school` for the third education card rather than
 *   always reading entry zero.
 */
function ruleValue(ruleId, profile, instance = 0) {
  const rule = RULE_BY_ID.get(ruleId);
  if (!rule) return null;

  // Derived rather than stored: the dialling code lives inside personal.phone.
  if (ruleId === "phoneCountryCode") {
    return splitPhone(profile.personal?.phone).code || null;
  }

  let v = null;
  if (rule.path.startsWith("customFields.")) {
    v = customLookup(profile.customFields, rule.path.slice("customFields.".length));
  } else {
    const path = rule.indexable && instance ? rule.path.replace("[0]", `[${instance}]`) : rule.path;
    v = resolvePath(profile, path);
  }

  // Experience fallbacks: derive from timeframe or position
  if (!v && rule.section === "experience") {
    const exp = profile.experience?.[instance] || (instance === 0 ? profile.experience?.[0] : null);
    if (exp) {
      if (ruleId === "experienceStartDate" && exp.timeframe) {
        v = parseTimeframe(exp.timeframe).start || null;
      } else if (ruleId === "experienceEndDate" && exp.timeframe) {
        const end = parseTimeframe(exp.timeframe).end;
        v = (end && !/present|current|now/i.test(end)) ? end : null;
      } else if (ruleId === "currentJob") {
        if (exp.current !== undefined) v = exp.current ? "Yes" : "No";
        else if (exp.timeframe && /present|current|now/i.test(exp.timeframe)) v = "Yes";
        else if (exp.timeframe) v = "No";
        else if (!exp.endDate && exp.startDate) v = "Yes";
        else if (exp.endDate) v = "No";
        else if (instance === 0) v = "Yes";
        else v = "No";
      }
    }
  }

  // Fallbacks describe entry zero only; a missing third school is just missing.
  // Custom declarations and preferences require a confirmed answer, never a
  // default Yes/No, inferred citizenship, consent or guessed availability.
  if (!v && rule.fallback && !instance && !rule.path.startsWith("customFields.")) v = rule.fallback(profile, instance);
  return v;
}

/**
 * Exact-label lookups the user has taught us, which outrank every rule.
 *
 * Two spellings are tried. `fieldKey` is what `learn()` writes under, and the
 * raw label covers entries typed straight into the dashboard as well as
 * anything an older build stored before the two agreed.
 */
// ─────────────────────────────────────────────────────────────────────────────
// The fill pass
// ─────────────────────────────────────────────────────────────────────────────

// Runs are serialised rather than dropped.
//
// `busy` used to make a second caller return `{filled:0,total:0}` immediately,
// and the observer fires on every React render — so pressing "Fill this page"
// while an automatic pass happened to be mid-flight reported "No form fields
// found on this page" about a form the extension was filling in at that moment.
// An automatic pass still stands down (the one already running covers it); a
// manual one waits its turn and then does the work it was asked for.
let queued = 0;
let chain = Promise.resolve();

/**
 * @param {object} opts
 *   manual  — user-initiated: overwrite nothing, but do run the async widgets
 *   useAI   — allow the Gemini pass for fields no rule could resolve
 * @returns {Promise<{filled:number, total:number, empty:number, unmatched:Array,
 *   aiError:string}>}
 */
// The extension was reloaded, updated or switched off while this page stayed
// open, leaving this script talking to a runtime that no longer exists.
let stale = false;

/**
 * Stand down if we have been orphaned.
 *
 * Nothing here can recover — the storage this frame reads from and the worker
 * it asks for AI answers are both gone, and only a page reload brings them
 * back. What it can do is stop: release the observer instead of running a pass
 * per mutation that ends in an uncaught rejection, and say the one sentence
 * that fixes it. Before this, an unpacked reload turned every open application
 * into a panel whose buttons did nothing and a console full of "Extension
 * context invalidated" with no hint that refreshing was the answer.
 */
function orphaned() {
  if (stale) return true;
  if (extensionAlive()) return false;
  stale = true;
  stopWatching();
  console.warn(`Apply karo: ${STALE_MESSAGE}`);
  return true;
}

function run(opts = {}) {
  if (orphaned()) return Promise.resolve({ filled: 0, total: 0, unmatched: [], aiError: STALE_MESSAGE });
  if (queued && !opts.manual) return Promise.resolve({ filled: 0, total: 0, unmatched: [], skipped: true });
  queued++;
  const result = chain.then(() => runOnce(opts));
  chain = result.then(() => {}, () => {}).then(() => { queued--; });
  return result;
}

async function runOnce(opts = {}) {
  // `chain` serialises every caller, so this should be unreachable. It is worth
  // keeping and worth logging: it is the one path that returns "no fields on
  // this page" about a page full of them, and it did so silently.
  if (busy) {
    console.warn("Apply karo: a pass was already running — this one did nothing");
    return { filled: 0, total: 0, unmatched: [] };
  }
  busy = true;

  let dependencyWatch = null;
  try {
    const t0 = performance.now();
    ctx = await loadContext();
    if (!releasePolicy(ctx.settings).enabled) {
      const fields = scan(); fields.forEach(f => retainDecision(f, { status: "deferred", reason: releasePolicy(ctx.settings).reason }));
      return { filled: 0, total: fields.length, deferred: fields.length, empty: fields.filter(looksEmpty).length, aiError: releasePolicy(ctx.settings).reason, ms: performance.now() - t0 };
    }
    const callerCancelled = opts.isCancelled;
    opts = { ...opts, isCancelled: () => !releasePolicy(ctx.settings).enabled || !!callerCancelled?.() };
    configureQuestionFixes(ctx.questionFixes);
    diagnostics.configure(ctx?.settings.diagnosticsEnabled);
    diagnostics.begin(diagnosticFrame);

    // Someone pressed the button, so start from a fresh view of the page.
    //
    // The shadow-root list is cached across scans and only dropped when the
    // observer happens to notice a node that carries controls. A component that
    // attaches its shadow root first and fills it afterwards produces no such
    // notification, so every field inside it stays invisible for the life of the
    // page — the filler skips them and the review then agrees there is nothing
    // there. One document walk on an explicit click is a cheap price for not
    // silently owning that failure.
    if (opts.manual) invalidateShadowCache();

    const profile = ctx.profile;
    if (opts.manual) { const repeats = await addMissingRepeats(document, profile, opts); undoStack.push(...repeats.undo); }
    const fields = bindEntities(scan(), profile);
    // Which frame, said once and reused. Both log lines need it: an application
    // on an embedded board runs in two or three frames at once and every line
    // looks alike, so "0/1 fields" gives no clue whether the frame holding the
    // form took part at all.
    const where = IS_TOP ? "top frame" : `frame ${location.host}`;
    for (const field of fields) diagnose(field, "discovery", "discovered", "scan");
    if (!fields.length) return { filled: 0, total: 0, unmatched: [] };

    // Say that this frame has started, not only what it eventually did.
    //
    // A manual pass opens every queued menu before it reports anything, and on
    // a form with a dozen comboboxes that is ten or fifteen seconds of complete
    // silence from the frame that matters — during which the only line in the
    // console is the top frame's instant, useless "0/1 fields". That reads as
    // the form's frame having ignored the click, and it is the reason the same
    // button gets pressed three more times.
    if (opts.manual) {
      console.debug(`Apply karo [${where}]: filling — ${fields.length} fields to work through…`);
    }

    const custom = profile.customFields || {};

    // Anything the user already typed or modified is off-limits, always.
    const activeEl = document.activeElement;
    for (const f of fields) {
      if (!answerPolicy(f, ctx.settings).allowed && f.kind !== "file") { f.skip = true; continue; }
      const isUserElModified = (f.el && userModifiedElements.has(f.el)) ||
        (f.parts || []).some((p) => p.field?.el && userModifiedElements.has(p.field.el)) ||
        (f.options || []).some((o) => o.el && userModifiedElements.has(o.el));
      const key = fieldKey(f) || normalizeKey(f.label || f.name || f.id);
      const isUserKeyModified = key ? userModifiedKeys.has(key) : false;
      const isUserModified = isUserElModified || isUserKeyModified;

      const isActive = !opts.manual && activeEl && (
        f.el === activeEl ||
        (f.parts || []).some((p) => p.field?.el === activeEl) ||
        (f.options || []).some((o) => o.el === activeEl)
      );
      if (f.filled || isUserModified || isActive) {
        f.skip = true;
        diagnose(f, "rules", "deferred", isUserModified ? "user_modified" : isActive ? "focused" : "existing_value");
      }
    }

    const assigned = assign(fields, {
      canMap: ruleCandidate,
      skipSensitive: ctx.settings.skipSensitive,
      hasAnswerFor: (ruleId) => !!ruleValue(ruleId, profile),
      isDemoted: (field, ruleId) => (ctx.corrections[fieldKey(field)] || []).includes(ruleId)
    });

    const resolutionContext = { profile, settings: ctx.settings, knowledge: ctx.knowledge || {}, url: location.href,
      legacy: { ...profile.customFields, ...ctx.learned } };
    const decisions = resolveFields(fields.map(describeField), { ...resolutionContext, mappings: assigned });
    fields.forEach((field, i) => retainDecision(field, decisions[i]));

    // If the form has a separate dialling-code box, the number box must not also
    // carry the code — "+91 +919996007259" fails validation on most forms.
    const hasCodeField = decisions.some(d => d.status === "resolved" && d.intent === "phoneCountryCode");

    // ── Pass 1: everything synchronous, in one go ──
    // v1 awaited each field individually, so a 30-field form serialised into
    // several seconds of visible stutter. These all land in a single frame.
    const asyncQueue = [], verificationQueue = [];
    dependencyWatch = trackDependencies();
    const unmatched = [];
    let filled = 0;

    // ruleId travels with the value so the option matcher can bridge vocabulary:
    // your "B.Tech" onto the dropdown's "Bachelor's Degree", your "No" onto its
    // "No, I do not require sponsorship".
    // fillSync never throws — one unfillable control skips itself rather than
    // aborting the remaining fields. See its contract in fill.js.
    // A rule found an answer and the control refused it: a dropdown whose
    // wording nothing in the profile scores against, a radio group asking
    // something the stored value does not express. That is not a filled field
    // and it is not a field with no answer — it is a field the AI should be
    // given a go at, and until now it was neither counted nor offered to it.
    // These are the "option fields it left blank" that no later pass ever
    // revisited, because only fields with no rule at all reached `unmatched`.
    const rejected = (field) => {
      if (field.skip || field.kind === "file" || !looksEmpty(field)) return;
      if (!unmatched.includes(field)) unmatched.push(field);
    };

    const apply = (i, value, guess, ruleId) => {
      const field = fields[i];
      diagnose(field, "rules", "answer_ready", ruleId ? "rule" : "memory");
      const restore = snapshot(field);
      if (opts.isCancelled?.() || !answerPolicy(field, ctx.settings).allowed) return;
      if (["combobox", "select"].includes(field.kind)) { asyncQueue.push({ field, value, guess, ruleId }); return; }
      const write = beginWrite(field, value, ruleId, opts);
      restore.arm();
      verificationQueue.push(write.completion.then(ok => {
        diagnose(field, "verify", ok ? "write_reported" : "write_rejected", field.verification?.reason || "not_attempted");
        if (ok) { restore.arm(); filled++; undoStack.push(restore); highlight(field.el, guess); remember(field,value,ruleId); }
        else { restore.dispose(); rejected(field); }
      }));
    };

    const ordered = fields.map((_,i)=>i).sort((a,b)=>dependencyPriority(fields[a],assigned.get(a)?.ruleId)-dependencyPriority(fields[b],assigned.get(b)?.ruleId));
    for (const i of ordered) {
      const field = fields[i], resolved = decisions[i], hit = assigned.get(i);
      if (resolved.status !== "resolved") {
        diagnose(field, "resolver", resolved.status, resolved.reason);
        if (!field.skip && field.kind !== "file") unmatched.push(field);
        continue;
      }
      let value = resolved.value;
      if (resolved.intent === "phone" && hasCodeField) value = splitPhone(value).national || value;
      apply(i, value, false, hit?.ruleId);
    }

    await Promise.all(verificationQueue);

    // ── Pass 2: widgets that need to open a menu and wait ──
    const deadline = performance.now() +
      (opts.manual ? MANUAL_WIDGET_BUDGET_MS : AUTO_WIDGET_BUDGET_MS);
    const priority = (j) => dependencyPriority(j.field,j.ruleId);
    asyncQueue.sort((a, b) => priority(a) - priority(b));
    const widgetJobs = widgetTurn(asyncQueue, opts);
    let widgetsProcessed = 0;
    for (const job of widgetJobs) {
      // Out of time for this pass. What is left keeps its place in the queue
      // for the next one rather than being written off as already tried.
      if (opts.isCancelled?.()) break;
      if (performance.now() > deadline) { diagnose(job.field, "widgets", "deferred", "budget"); break; }
      widgetsProcessed++;
      opts.onStage?.(`Filling dropdown ${widgetsProcessed} of ${widgetJobs.length}…`);
      if (!opts.manual) widgetTried.add(job.field.el);

      if (!job.field.el.isConnected || userModifiedElements.has(job.field.el) || isFocused(job.field.el)) continue;
      const restore = snapshot(job.field);
      const pending = writeVerified(job.field, job.value, job.ruleId, opts);
      restore.arm();
      const ok = await pending;
      diagnose(job.field, "widgets", ok ? "write_reported" : "write_rejected", ok ? "not_empty" : "control_refused");
      if (ok) {
        restore.arm();
        filled++;
        undoStack.push(restore);
        highlight(job.field.el, job.guess);
        remember(job.field, job.value, job.ruleId);
      } else {
        // A menu we opened and could not answer from. Same reasoning as a
        // refused synchronous fill: hand it to the AI rather than leaving a
        // blank dropdown nothing will look at again.
        restore.dispose();
        rejected(job.field);
      }
    }

    // Parent selections can reveal or replace children. Resolve fresh descriptors
    // in bounded passes; never reuse an answer against a removed DOM node.
    if (opts.manual) for (let pass = 0; pass < 3 && !opts.isCancelled?.() && performance.now() <= deadline; pass++) {
      const regions=dependencyWatch.take();
      const next = bindEntities(regions.flatMap(region=>scan(region)),profile).filter((f) => !f.skip && !f.filled && !userModifiedElements.has(f.el) && !isFocused(f.el) &&
        answerPolicy(f, ctx.settings).allowed && !fields.some((old) => old.el === f.el && old.formRevision === f.formRevision));
      if (!next.length) break;
      const hits = assign(next, { canMap: ruleCandidate, skipSensitive: ctx.settings.skipSensitive, hasAnswerFor: (id) => !!ruleValue(id, profile) });
      for (let i = 0; i < next.length; i++) {
        if (opts.isCancelled?.() || performance.now() > deadline) break;
        const field = next[i];
        const old = fields.findIndex((f) => f.el === field.el);
        if (old === -1) fields.push(field); else fields[old] = field;
        const hit = hits.get(i), resolved = resolveOne(describeField(field), { ...resolutionContext, mapping: hit });
        retainDecision(field, resolved);
        const value = resolved.status === "resolved" ? resolved.value : null;
        if (value === null) { unmatched.push(field); continue; }
        const restore = snapshot(field), pending = writeVerified(field, value, hit?.ruleId, opts);
        restore.arm();
        const ok = await pending;
        if (ok) { restore.arm(); filled++; undoStack.push(restore); highlight(field.el, false); remember(field, value, hit?.ruleId); }
        else { restore.dispose(); rejected(field); }
      }
    }
    dependencyWatch.dispose();

    // ── Pass 3: resume upload ──
    if (!opts.isCancelled?.()) filled += await attachFiles(fields, !!opts.manual);

    // Say which pass this was, not just what it did. The automatic pass fills
    // from the stored profile alone and never spends a model call, so a line
    // reading "14/26" after a page load is the expected outcome and not a
    // half-finished job — but read on its own it looks exactly like one, and
    // the twelve fields it leaves are the twelve an explicit Fill exists to
    // answer.
    const current = new Map(bindEntities(scan(),profile).map((f) => [f.el, f]));
    const unique = new Map(unmatched.map((f) => [f.el, current.get(f.el)]));
    unmatched.splice(0, unmatched.length, ...[...unique.values()].filter((f) => f && !f.filled && !f.skip));
    const ms = Math.round(performance.now() - t0);
    const left = fields.length - filled;

    // The automatic pass fills from the profile alone — it never spends a model
    // call — so the fields it leaves are the ones an explicit Fill exists to
    // answer, not ones it failed at.
    const how = opts.useAI
      ? (unmatched.length ? `manual pass — asking AI about ${unmatched.length} next` : "manual pass")
      : (left > 0 ? `automatic pass, rules only — ${left} left for AI, press Fill this page` : "automatic pass, rules only");

    console.debug(`Apply karo [${where}]: ${filled}/${fields.length} fields in ${ms}ms — ${how}`);

    // ── Pass 4: optional AI for the leftovers ──
    let aiError = "", drafts = 0, deferred = widgetJobs.length - widgetsProcessed;
    if (opts.useAI && unmatched.length) {
      if (!ctx.settings.aiAutofillEnabled) {
        aiError = `${unmatched.length} field(s) still need an answer. AI autofill is switched off in the dashboard.`;
      } else {
        // Parsing the resume and answering in batches can take half a minute; say
        // so, or a stalled-looking button reads as a hang.
        opts.onStage?.(`Rules filled ${filled}. Asking AI about ${unmatched.length} more…`);
        const ai = await aiPass(unmatched, opts);
        for(const field of ai.fields || []) { const index=fields.findIndex(f=>f.el===field.el);if(index===-1)fields.push(field);else if(field.proposedWrite)fields[index]=field; }
        filled += ai.filled;
        aiError = ai.error;
        drafts = ai.drafts || 0;
        deferred += ai.deferred || 0;
      }
    }

    ranOnce = true;
    updateFieldOverlays(fields);
    if (filled > 0) {
      setBadge(filled);
      logApplication(filled, fields.length);
    }
    // What is genuinely still blank, read off the page as it now stands. The
    // panel used to infer this from `filled === 0` and told the user "nothing
    // left to fill here" while twenty fields sat empty behind it.
    // Only for a run someone is waiting on. This is a second full scan, and the
    // automatic pass fires on every mutation burst — nobody reads the number
    // there, so nobody should pay for it.
    opts.onStage?.("Checking fields…");
    for (const field of fields) if (field.verification?.status === "verified" && field.proposedWrite &&
      (!field.el.isConnected || !accepts(field,field.proposedWrite.value,field.proposedWrite.ruleId) || validationState(field)==="failed")) {
      field.verification={...field.verification,status:"rejected",reason:"final_readback_changed"};
      filled=Math.max(0,filled-1);
    }
    const widgetWarnings = fields.filter((f) => f.controlOutcome?.status === "ambiguous")
      .map((f) => `${f.rawLabel || "Dropdown"}: choose between ${f.controlOutcome.choices.join(" / ")}.`);
    if (widgetWarnings.length) aiError = [aiError, ...widgetWarnings].filter(Boolean).join(" ");
    const rejectedCount=fields.filter(f=>["rejected","deferred"].includes(f.verification?.status)).length;
    if(rejectedCount)aiError=[aiError,`${rejectedCount} field(s) could not be verified. Review rejected values or later edits before submitting.`].filter(Boolean).join(" ");
    const survey = opts.manual ? surveyEmpty() : null;
    if (diagnostics.enabled) for (const field of fields) {
      const empty = looksEmpty(field);
      diagnose(field, "review", empty ? "deferred" : "observed_nonempty", empty ? "remaining_empty" : "not_empty");
    }
    return {
      filled,
      drafts,
      verificationRejected: rejectedCount,
      deferred,
      total: fields.length,
      empty: survey ? survey.targets.length : 0,
      // Fields the filler could not see are not fields it declined to answer,
      // and the difference is the whole story when someone is looking at a form
      // that is still half blank. It gets reported without being asked for.
      unseen: survey ? survey.unseen.length : 0,
      unmatched,
      aiError,
      ms
    };
  } finally {
    diagnostics.record({ stage: "run", reason: "run_end", frame: diagnosticFrame });
    dependencyWatch?.dispose();
    busy = false;
  }
}

/**
 * Does this field still hold nothing?
 *
 * Deliberately reads the live control rather than the descriptor's `filled`,
 * which was computed before the pass wrote anything. Every kind of control is
 * checked the way that control states an answer — `.checked` for a native box,
 * `aria-checked` for a role-based one, text for a contenteditable — because a
 * `.value` read alone reports every ARIA widget on the page as empty.
 */
function looksEmpty(field) {
  const els = [
    field.el,
    ...(field.options || []).map((o) => o.el),
    ...(field.parts || []).map((p) => p.field?.el)
  ].filter(Boolean);

  for (const el of els) {
    if (typeof el.checked === "boolean" && el.checked) return false;
    if (el.getAttribute?.("aria-checked") === "true") return false;
    if (el.getAttribute?.("aria-selected") === "true") return false;
    if (el.files?.length) return false;
    if (el.tagName === "SELECT") {
      const opt = el.options?.[el.selectedIndex];
      const isPlaceholder = !opt || !el.value || COMBO_PLACEHOLDER_RE.test(opt.text || "") || /^(--\s*)?(select|choose|please select)/i.test(opt.text || "");
      if (el.selectedIndex >= 0 && !isPlaceholder && !!el.value) return false;
      continue;
    }
    if (field.kind === "combobox" && isComboboxFilled(el)) return false;
    if ((typeof el.value === "string" || typeof el.value === "number") && String(el.value).trim() && !COMBO_PLACEHOLDER_RE.test(String(el.value).trim())) return false;
    if (el.isContentEditable && (el.textContent || "").trim()) return false;
  }
  return true;
}

/** Fields still empty in this frame. File inputs are counted separately. */
function countEmpty() {
  const survey = surveyEmpty();
  return survey.targets.length;
}

/**
 * Everything still empty in this frame, counted from both directions.
 *
 * The scanner's own view, plus a sweep that owes it nothing — see `rawControls`
 * in scan.js for why the second one has to exist. Both the fill and the review
 * go through here, so the two can no longer disagree about what is left, and
 * neither can report a form as complete on the strength of a scan that missed
 * half of it.
 *
 * @returns {{targets: Array<{el:Element, required:boolean}>, unseen: Element[]}}
 */
function surveyEmpty() {
  const targets = [];
  const chosen = new Set();
  const known = new Set();

  const add = (el, required) => {
    if (!el || chosen.has(el)) return;
    if (!el.offsetParent && !el.getClientRects?.().length) return;
    chosen.add(el);
    targets.push({ el, required });
  };

  for (const f of scan()) {
    if (f.el) known.add(f.el);
    for (const o of f.options || []) if (o.el) known.add(o.el);
    for (const p of f.parts || []) if (p.field?.el) known.add(p.field.el);

    // A missing resume is reported by the upload path, which knows whether one
    // is even stored; counting it here would double up.
    if (f.filled || f.kind === "file") continue;
    if (f.el?.closest?.(OWN_UI)) continue;
    add(outlineTarget(f), isRequired(f));
  }

  const unseen = [];
  for (const el of rawControls()) {
    if (known.has(el) || el.closest?.(OWN_UI)) continue;
    if (!isFillableControl(el) || !isEmptyControl(el)) continue;
    const r = el.getBoundingClientRect?.();
    if (!r || r.width <= 1 || r.height <= 1) continue;

    unseen.push(el);
    add(el, !!el.required || el.getAttribute?.("aria-required") === "true");
  }

  if (unseen.length) describeUnseen(unseen);
  return { targets, unseen };
}

/**
 * Name the fields the filler cannot see, and why.
 *
 * `console.warn` rather than `console.debug` on purpose: Chrome hides debug
 * messages unless the console is switched to Verbose, and a diagnostic nobody
 * can see is the same as no diagnostic. Once per pass, never in a loop.
 */
function describeUnseen(unseen) {
  console.warn(
    `Apply karo: ${unseen.length} empty field(s) this frame's filler never saw —`,
    unseen.map((el) => ({
      label: labelOf(el) || el.name || el.id || "(unlabelled)",
      tag: el.tagName.toLowerCase(),
      type: el.type || el.getAttribute("role") || "",
      name: el.name || el.id || "",
      droppedBecause: whyDropped(el) || "kept by the scanner, but grouped into another field"
    }))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu-driven widgets
//
// A combobox cannot be filled inside a frame. It has to be clicked open,
// filtered, and waited on, which is why these are queued out of pass 1 — and
// why the automatic pass used to drop the queue on the floor, leaving every
// dropdown on the form blank until you pressed the button yourself.
//
// They run automatically now. What makes that bearable is not doing it quietly,
// it is the two rules below: never under your cursor, and never twice on a
// control that has already had its turn.
// ─────────────────────────────────────────────────────────────────────────────

/** How long one automatic pass may spend opening menus. */
const AUTO_WIDGET_BUDGET_MS = 6000;

/**
 * The same ceiling for a pass you asked for, only far higher.
 *
 * It used to be no ceiling at all — you pressed the button, so the time was
 * yours to spend. But a widget that never opens costs 1.5s to give up on, and
 * the AI pass does not start until every one of them has had its turn, so a
 * form with a dozen unresponsive menus spent twenty seconds looking like a
 * frame that had ignored the click. Worse, that whole time is inside the
 * coordinator's window: the tab's other frames are waiting on it. Twelve
 * seconds is enough for every menu on a real form and short enough that the
 * fill is visibly underway.
 */
const MANUAL_WIDGET_BUDGET_MS = 30000;

// Controls the automatic pass has already opened. A dropdown it could not
// answer would otherwise be reopened on every rescan — and the observer
// rescans on every React render, which turns one silent failure into a menu
// that flickers open for the rest of the session.
let widgetTried = new WeakSet();

/** How long after a keystroke the page still counts as yours. */
const HUMAN_IDLE_MS = 2500;

let lastHumanEdit = 0;

// Registered as the module loads rather than from boot(), because this is a
// record of what the user has been doing and it is only useful if it has been
// running the whole time — a flag that starts recording at the moment we want
// to read it always says "idle".
//
// `isTrusted` is the whole mechanism: it is false on every event we dispatch
// ourselves and cannot be forged from script, so our own fills can never look
// like a person typing.
if (typeof document !== "undefined") {
  for (const type of ["keydown", "input", "pointerdown"]) {
    document.addEventListener(type, (e) => {
      if (e.isTrusted && !e.target?.closest?.(OWN_UI)) lastHumanEdit = Date.now();
    }, true);
  }

  // Track elements manually edited or uploaded to by the user
  for (const type of ["input", "change", "drop"]) {
    document.addEventListener(type, (e) => {
      if (e.isTrusted && !isExtensionAction() && e.target && !e.target.closest?.(OWN_UI)) {
        userModifiedElements.add(e.target);
        const control = e.target.closest?.("input, select, textarea, [role=combobox], [role=radiogroup], [role=radio], [role=checkbox], [contenteditable]");
        if (control) {
          userModifiedElements.add(control);
          const k = normalizeKey(labelOf(control) || control.name || control.id);
          if (k) userModifiedKeys.add(k);
        }
        if (e.type === "drop" || (control && control.type === "file")) {
          userUploadedFile = true;
          const fileInput = e.target.closest?.('[class*=upload],[class*=drop],[class*=attach]')?.querySelector?.('input[type=file]') || e.target.querySelector?.('input[type=file]');
          if (fileInput) userModifiedElements.add(fileInput);
        }
      }
    }, true);
  }
}

/** Are you in the middle of filling something in yourself? */
function userIsBusy() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) {
    el = el.shadowRoot.activeElement;
  }
  if (!el || el === document.body || el.closest?.(OWN_UI)) return false;

  const tag = el.tagName;
  const inControl = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || !!el.isContentEditable;
  if (!inControl) return false;

  // Focus on its own does not mean a person is there. Opening a combobox leaves
  // focus sitting in it, so reading focus alone would let one automatic fill
  // stand every later one down for the rest of the session.
  return Date.now() - lastHumanEdit < HUMAN_IDLE_MS;
}

/**
 * Which queued widgets this pass gets to fill.
 *
 * A manual run takes the lot, retries included: you pressed the button, so the
 * time is yours to spend and a second press is exactly how you ask for another
 * attempt at the one that failed.
 */
function widgetTurn(queue, opts) {
  if (!queue.length) return [];
  if (opts.manual) return queue;

  // Opening a menu takes focus. Doing that mid-sentence is worse than leaving
  // the field to the next pass, which is seconds away.
  if (userIsBusy()) return [];

  return queue.filter((job) => !widgetTried.has(job.field.el));
}

// ─────────────────────────────────────────────────────────────────────────────
// Application log
//
// Filling a form is the moment you know an application exists, so recording it
// here means the tracker in the dashboard needs no separate bookkeeping from
// the user. Nothing leaves the device.
// ─────────────────────────────────────────────────────────────────────────────

// `pageIdentity` — the employer and role, as far as the page states them — is
// imported from shared/posting.js. It sits beside the description reader because
// both answer the same question about the same page, and because the toolbar has
// to be able to ask it about a page the engine was never loaded onto.

let loggedThisPage = false;

function logApplication(filled, total) {
  if (!IS_TOP || !ctx?.settings.trackApplications) return;
  // One row per page. Later fills on the same page update it, they do not stack.
  const first = !loggedThisPage;
  loggedThisPage = true;
  recordApplication({
    ...pageIdentity(),
    url: location.href.split("#")[0].slice(0, 500),
    ts: Date.now(),
    filled,
    total
  }).catch((err) => console.debug("Apply karo: could not log this fill —", err.message));
  if (first) console.debug("Apply karo: logged this page to the application tracker");
}

function setBadge(count) {
  if (!IS_TOP || !ctx?.settings.showBadge) return;
  chrome.runtime.sendMessage({ type: "set_badge", count }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// The posting
//
// A letter written against the actual posting is worth having; one written from
// the profile alone is not. The catch is that the posting is usually not on the
// page you are standing on: you read it on the listing, pressed "Apply now", and
// the form you landed on repeats the company boilerplate at best. Reading the
// page underneath you — all this used to do — therefore answered "couldn't find
// a job description on this page" at exactly the moment the feature was wanted.
//
// So the description is stored, one slot, in schema.js, and everything here
// falls back to it. The model call lives in the service worker, which writes its
// result into that same slot: nothing in this module holds the answer, which is
// what lets the toolbar ask for a letter about a posting whose tab is long
// closed, and stops the panel and the popup ever disagreeing about which job is
// being applied to.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a posting the user captured by hand outranks the page under them. */
const PIN_MS = 12 * 3600 * 1000;

/**
 * Settle which posting this page's actions run against, and store it.
 *
 * The page wins when it genuinely holds a description — that is the most
 * specific thing available, and it keeps the one-page case free of any setup.
 * It does not win over a posting the user captured by hand in the last half day:
 * that capture is an explicit statement of which job this is, and an application
 * form's "About us" section quietly replacing the description captured two
 * clicks earlier is the failure this exists to prevent.
 *
 * @returns {Promise<{source:"page"|"saved", company:string, role:string}>}
 */
async function settlePosting() {
  const saved = await loadJob();
  const savedUsable = String(saved.text || "").length >= MIN_JD_CHARS;
  const pinned = savedUsable && saved.source !== "page" && Date.now() - saved.ts < PIN_MS;

  const here = postingFromPage();
  if (here.text.length >= MIN_JD_CHARS && !(pinned && saved.url !== here.url)) {
    // Re-reading the very page it was captured on keeps the capture's standing.
    // Downgrading it to "page" here would unpin the posting, and the next form
    // with an "About us" section on it would then be free to replace it — which
    // is the thing pinning exists to stop.
    const same = savedUsable && saved.url === here.url;
    const job = await setJob({ ...here, source: same ? saved.source : "page" });
    return { source: "page", company: job.company, role: job.role };
  }

  if (savedUsable) return { source: "saved", company: saved.company, role: saved.role };

  throw new Error(
    "No job description on this page. Open the posting, press Capture in the toolbar, then come back."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Job matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare the profile and resume against this posting.
 *
 * Explicit action only, never on the automatic path: it costs a model call and
 * reads the whole page, neither of which should happen because you opened a tab.
 * The worker records the result against the application too, so the dashboard
 * can sort by it later.
 *
 * @returns {Promise<object>} the normalized match, carrying `via` — which
 *   posting it actually ran against, so the panel can say so.
 */
async function matchThisJob(onStage) {
  const via = await settlePosting();
  onStage?.(via.source === "saved" ? "Using the posting you captured…" : "Reading the posting…");

  const resp = await chrome.runtime.sendMessage({ type: "job_match" }).catch(() => null);
  if (!resp?.ok) throw new Error(resp?.error || "The model did not reply.");
  return { ...resp.match, via };
}

/**
 * Have you been here before? Purely local, so the panel can warn without
 * spending anything.
 * @returns {Promise<{company:string, rows:Array}|null>}
 */
async function priorApplications() {
  if (!ctx?.settings.trackApplications) return null;
  const identity = pageIdentity();
  const rows = priorApplicationsFor(await loadHistory(), {
    company: identity.company,
    url: location.href.split("#")[0].slice(0, 500)
  });
  return rows.length ? { company: identity.company, rows } : null;
}

/**
 * Put a letter into this page's cover-letter box, if it has one.
 *
 * Only a box that is genuinely for a cover letter, and only while it is empty:
 * overwriting one you had already written would be worse than making you paste
 * it yourself. Split out from `writeCoverLetter` because the toolbar drafts
 * letters against a posting captured elsewhere, and then needs exactly this half
 * — the text already exists and only has to land somewhere.
 *
 * @returns {boolean} whether it landed
 */
async function placeLetter(text) {
  ctx = await loadContext(); if (!releasePolicy(ctx.settings).enabled) throw new Error(releasePolicy(ctx.settings).reason);
  const body = String(text || "").trim();
  if (!body) return false;

  const target = scan().find((f) => {
    if (f.kind !== "textarea" || f.filled) return false;
    return COVER_LETTER_HINTS.test(`${f.label} ${f.name} ${f.id}`);
  });
  if (!target) return false;

  const restore = snapshot(target);
  busy = true;
  try {
    const pending = writeVerified(target, body);
    restore.arm();
    if (!await pending) { restore.dispose(); return false; }
    restore.arm();
    undoStack.push(restore);
    highlight(target.el, true);
    target.el.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  } finally {
    busy = false;
  }
}

/**
 * Draft a cover letter for this posting and put it in the page's box if there
 * is one.
 * @returns {Promise<{text:string, placed:boolean, via:object}>}
 */
async function writeCoverLetter(onStage) {
  const via = await settlePosting();
  onStage?.(via.source === "saved" ? "Using the posting you captured…" : "Reading the posting…");

  // The worker builds the letter on the stored comparison when there is one, so
  // it leads with what this employer asked for and never claims a requirement
  // the comparison found no evidence for.
  const resp = await chrome.runtime.sendMessage({ type: "job_letter" }).catch(() => null);
  if (!resp?.ok) throw new Error(resp?.error || "The model did not reply.");

  const text = String(resp.text || "").trim();
  if (!text) throw new Error("The model returned an empty letter.");
  return { text, placed: await placeLetter(text), via };
}

/** What the popup shows about the page before you press anything. */
function pageStatus() {
  const fields = scan();
  const empty = fields.filter((f) => !f.filled && f.kind !== "file").length;
  return {
    ok: true,
    host: location.hostname.replace(/^www\./, ""),
    total: fields.length,
    empty,
    hasResumeUpload: fields.some((f) => f.kind === "file"),
    canUndo: undoStack.length > 0,
    disabled: siteDisabled
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resume upload
//
// Which box gets the resume is decided by pickResumeTargets() in rules.js, away
// from the DOM and under test. This half owns only the side effects: fetching
// the stored PDF, injecting it, and not doing either twice.
// ─────────────────────────────────────────────────────────────────────────────

// Elements this page has already been given the resume. A site that reads
// `input.files` into its own state and then clears the input would otherwise be
// handed the file again on every rescan — and sites that upload on `change`
// would end up with the same resume attached three or four times.
let attached = new WeakSet();

let noResumeWarned = false;

async function attachFiles(fields, isManual = false) {
  if (ctx.settings.autoUploadResume === false) return 0;
  if (userUploadedFile) return 0;
  if (!isManual && ranOnce) return 0;

  const fileName = ctx.resumeMeta.fileName || "resume.pdf";
  const targets = pickResumeTargets(fields, fileName).filter(
    (f) => !attached.has(f.el) && !f.filled && !userModifiedElements.has(f.el)
  );
  if (!targets.length) return 0;

  // The base64 blob is fetched only now — it never enters memory on a page that
  // has no file input, which is the overwhelming majority of pages.
  const dataUrl = await loadResumeFile();
  if (!dataUrl) {
    // Silence here reads as "the extension ignored the upload box". Say it once,
    // and let the panel's setup list carry the same message where it is visible.
    if (!noResumeWarned) {
      noResumeWarned = true;
      console.info("Apply karo: this form wants a resume, but none is stored — add one in the dashboard.");
    }
    return 0;
  }

  let n = 0;
  for (const f of targets) {
    const restore = snapshot(f), pending = uploadVerified(f, dataUrl, fileName);
    restore.arm();
    if (await pending) {
      retainDecision(f, { status: "resolved", source: "Stored resume upload", value: readControl(f)[0], reason: "Attachment accepted locally; review before submitting" });
      restore.arm();
      undoStack.push(restore);
      attached.add(f.el);
      n++;
      // Highlight the widget, not the input: the input itself is invisible on
      // every real ATS, so an outline on it would show the user nothing.
      highlight(uploadWidget(f.el), false);
    }
  }
  return n;
}

/** The visible control standing in for a hidden file input. */
function uploadWidget(el) {
  const r = el.getBoundingClientRect?.();
  if (r && r.width > 1 && r.height > 1) return el;
  return el.closest("label,[class*=drop],[class*=drag],[class*=upload],[class*=attach]") || el.parentElement || el;
}

async function aiPass(unmatched, opts = {}) {
  const eligible = unmatched.filter((f) => answerPolicy(f, ctx.settings).allowed && f.kind !== "file");
  opts = { ...opts, runId: crypto.randomUUID() };
  const queue = await processQueue(eligible, (batch) => aiChunk(batch, opts), {
    shouldStop: () => opts.isCancelled?.(),
    onProgress: (remaining) => opts.onStage?.(`AI: ${remaining} fields remaining…`)
  });
  const errors = [...new Set(queue.results.map((r) => r.error).filter(Boolean))];
  if (queue.remaining.length) errors.push(`${queue.remaining.length} fields deferred. Review this pass, then click Fill to continue.`);
  return { filled: queue.results.reduce((n, r) => n + r.filled, 0), drafts: queue.results.reduce((n, r) => n + (r.drafts || 0), 0),
    fields: queue.results.flatMap(r=>r.fields || []), deferred: queue.remaining.length, error: errors.join(" ").slice(0, 1000) };
}

async function aiChunk(unmatched, opts = {}) {
  // Keep the field objects in a parallel array. The model answers by index into
  // what we sent it, so indexing back into `unmatched` would be off by however
  // many entries the filter removed — and would write values into the wrong
  // boxes.
  // A field with no <label> still has a name, a placeholder or an adjacent
  // heading — dropping those left a chunk of every form unanswered. Anything
  // with a usable hint goes to the model; only truly anonymous boxes are cut.
  const candidates = unmatched.filter((f) => {
    if (!answerPolicy(f, ctx.settings).allowed) return false;
    if (f.kind === "file") return false;                    // handled separately
    if (f.type === "password") return false;                // never ours to fill
    return !!(f.rawLabel || f.name || f.placeholder || f.options?.length);
  });

  let pageJob = null;
  try {
    const ident = pageIdentity();
    const posting = postingFromPage();
    if (ident.company || ident.role || (posting.text && posting.text.length >= 100)) {
      pageJob = {
        company: ident.company || "",
        role: ident.role || "",
        text: (posting.text || "").slice(0, 3000)
      };
    }
  } catch {}

  const descriptors = candidates.map(describeField);
  if (!descriptors.length) return { filled: 0, error: "" };

  // The API key stays in the service worker, and so does the resume: the worker
  // sources it itself rather than trusting whatever the page had cached.
  const revisions = candidates.map((f) => captureRevision(f, f.rawLabel || f.label));
  const cancelTimer = setInterval(() => {
    if (opts.isCancelled?.()) chrome.runtime.sendMessage({ type: "cancel_resolution", runId: opts.runId }).catch(() => {});
  }, 100);
  const resp = await chrome.runtime.sendMessage({
    type: "ai_fill",
    fields: descriptors,
    profile: ctx.profile,
    jobContext: pageJob, runId: opts.runId
  }).catch((err) => ({ ok: false, error: err?.message || "The extension's background worker did not reply." })).finally(() => clearInterval(cancelTimer));

  const currentFields = new Map(scan().map((f) => [f.el, f]));
  const validRevisions = candidates.map((f, i) => revisions[i].valid(labelOf(f.el)) && currentFields.get(f.el)?.formRevision === f.formRevision);
  revisions.forEach((r) => r.dispose());

  // Whatever went wrong travels back to the caller. Swallowing it here is the
  // single reason a spent API quota surfaced as a silently half-filled form:
  // the AI answered nothing, `run` reported only the rules' count, and pressing
  // Fill a second time said "Nothing left to fill here" about a page with
  // twenty empty boxes on it.
  if (!resp?.ok) {
    const why = resp?.error || "The AI request failed.";
    console.warn("Apply karo: AI pass failed —", why);
    return { filled: 0, error: why, quota: !!resp?.quota };
  }
  if (!resp.answers) return { filled: 0, error: resp.error || "The model returned no answers.", quota: !!resp.quota };

  let n = 0, drafts = 0;
  const verifications = [];
  let refused = 0;     // answered by the model, rejected by the control
  const answered = new Set();
  const assigned = assign(candidates, {
    skipSensitive: false,
    hasAnswerFor: () => true
  });

  for (const entry of resp.decisions || []) {
    const i = candidates.findIndex(f => f.fieldId === entry.fieldId && f.formRevision === entry.revision);
    const field = candidates[i];
    if (field) retainDecision(field, entry);
    if (opts.isCancelled?.()) break;
    if (!field || !entry || !validRevisions[i] || !answerPolicy(field, ctx.settings).allowed) continue;
    if (!["resolved", "draft"].includes(entry.status)) continue;
    let value = entry.value;
    const confidence = typeof entry === "object" ? entry.confidence : null;
    if (value === null || value === undefined || String(value).trim() === "") continue;
    answered.add(i);

    const hit = assigned.get(i);
    const ruleId = hit?.ruleId || null;

    if (field.options?.length && field.kind !== "checkbox") {
      const options = describeField(field).options;
      if ((!entry.optionIds || !entry.optionIds.length) && typeof value === "string") {
        const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
        const vNorm = norm(value);
        const hit = options.find((o) => norm(o.label) === vNorm || norm(o.value) === vNorm || (vNorm.length >= 2 && (norm(o.label).includes(vNorm) || vNorm.includes(norm(o.label)))));
        if (hit) {
          entry.optionIds = [hit.optionId];
          entry.value = value = hit.label;
        }
      }
      const values=Array.isArray(value)?value:[value];
      if (entry.optionIds?.length !== values.length) continue;
      if(entry.optionIds.some((id,i)=>options.find(o=>o.optionId===id)?.label!==values[i]))continue;
    }

    // Guard against overwriting fields modified while AI was in flight
    if (!looksEmpty(field)) continue;
    if (userModifiedElements.has(field.el) || (field.el && isFocused(field.el))) continue;
    const key = fieldKey(field) || normalizeKey(field.label || field.name || field.id);
    if (key && userModifiedKeys.has(key)) continue;

    const restore = snapshot(field);
    diagnose(field, "ai", "answer_ready", "source_unverified");
    const pending = writeVerified(field, value, ruleId, opts);
    restore.arm();
    const finish = async () => {
    const ok = await pending;
    diagnose(field, "ai", ok ? "write_reported" : "write_rejected", ok ? "not_empty" : "control_refused");
    if (ok) {
      restore.arm();
      n++;
      if (entry.status === "draft") drafts++;
      undoStack.push(restore);
      highlight(field.el, entry.status === "draft" || confidence === null || confidence < 0.7);
      remember(field, value, ruleId);
      // Generated answers remain unapproved drafts; never promote them to memory.
    } else {
      restore.dispose();
      // The model answered and the control would not take it: a dropdown whose
      // wording nothing scores against, a combobox whose menu never opened, a
      // number box handed a date. Counted, because a silent drop here is
      // indistinguishable from the model having skipped the field — and the two
      // have completely different fixes.
      refused++;
      console.debug(`Apply karo: "${field.rawLabel || field.name || field.kind}" refused the AI's answer`);
    }
    };
    if (["combobox","select"].includes(field.kind)) await finish();
    else verifications.push(finish());
  }
  await Promise.all(verifications);
  if (n) await persistLearned();

  // A partial answer set — some batches landed, one ran out of quota — carries
  // both halves: the fields it filled, and the reason the rest are still blank.
  let error = resp.error || (opts.isCancelled?.()?"Fill was interrupted. Your later edits were kept.":"");
  const unanswered = candidates.length - answered.size;
  if (!error && !n && candidates.length) {
    error = "Confirmed facts or supporting evidence are missing for these fields. Review them before submitting.";
  }
  // Say which half fell short. "The model left 6 blank" and "6 controls refused
  // what it said" look identical on the page and are not the same problem: the
  // first is a model or quota question, the second is a widget this extension
  // cannot drive. The panel prints its own "filled N, M still empty" line ahead
  // of this, so this only adds the reason.
  if (!error && (unanswered || refused)) {
    const parts = [];
    if (unanswered) parts.push(`${unanswered} need confirmed facts or clearer questions`);
    if (refused) parts.push(`${refused} were answered but refused by the page`);
    error = `Of the ${candidates.length} fields the AI was asked, ${parts.join(" and ")}.`;
  }
  return { filled: n, drafts, error, quota: !!resp.quota, fields: candidates };
}

/**
 * Handle exclusive AI fill for a single paragraph/long-form field.
 */
function describeField(f) {
  return { fieldId: f.fieldId, revision: f.formRevision, questionFull: f.questionFull || f.rawLabel || f.label,
    phonePart: f.phonePart,
    multiple: !!f.el?.multiple || f.el?.getAttribute("aria-multiselectable") === "true",
    label: f.rawLabel || f.label, name: f.name, type: f.type, kind: f.kind, helperText: f.helperText || "",
    section: f.section || "", sectionTitle: f.sectionTitle || "", instance: f.instance, entityId: f.entityId,
    extraction: f.extraction, optionsComplete: f.optionsComplete, filled: f.filled, skip: f.skip,
    maxLength: f.el?.maxLength > 0 ? f.el.maxLength : null, applicationContext: JSON.stringify(pageIdentity()),
    options: (f.options || []).map((o,i) => ({ label: o.label, value: o.value, optionId: o.optionId || f.fieldId + ":option:" + i })) };
}

async function handleExclusiveFill(field, customInstruction) {
  ctx = await loadContext();
  if (!releasePolicy(ctx.settings).enabled) throw new Error(releasePolicy(ctx.settings).reason);
  if (busy || queued) throw new Error("Wait for the current fill to finish.");
  const fresh = scan().find((f) => f.el === field.el);
  if (!fresh || !fresh.el?.isConnected) throw new Error("This field changed. Open its AI button again.");
  field = fresh;
  const policy = answerPolicy(field, ctx.settings);
  if (!policy.allowed) throw new Error("This field is excluded by your answer settings.");
  if (!ctx.settings.aiAutofillEnabled) throw new Error("AI autofill is switched off in the dashboard.");
  const question = field.rawLabel || field.label;
  const url = location.href;
  const revision = captureRevision(field, question);
  const descriptor = describeField(field);
  let response;
  try {
    const ident = pageIdentity(), posting = postingFromPage();
    response = await chrome.runtime.sendMessage({ type: "ai_exclusive_field", field: descriptor,
      customInstruction: customInstruction || "", jobContext: { ...ident, text: posting.text?.slice(0, 3000) || "" } });
    if (location.href !== url || !revision.valid(labelOf(field.el)) || scan().find((f) => f.el === field.el)?.formRevision !== field.formRevision) throw new Error("The question or your text changed while AI was working. Your edit was kept.");
  } finally { revision.dispose(); }
  if (!answerPolicy(field, ctx.settings).allowed) throw new Error("This field is now excluded by your settings.");
  if (!response?.ok || !response.answer) throw new Error(response?.error || "A confirmed fact is missing. No answer was filled.");
  retainDecision(field, response.decision || { status: response.status || "draft", value: response.answer, source: "AI draft", reason: "Review before confirming" });
  const restore = snapshot(field);
  busy = true;
  try {
    const pending = writeVerified(field, response.answer);
    restore.arm();
    const ok = await pending;
    if (!ok) { restore.dispose(); throw new Error("The field refused the answer."); }
    restore.arm();
    const undoRevision = captureRevision(field, question);
    const guardedUndo = () => {
      const valid = undoRevision.valid(labelOf(field.el)); undoRevision.dispose();
      if (!valid) return false;
      return restore();
    };
    undoStack.push(guardedUndo);
    sourceUndos.set(field.fieldId, guardedUndo);
    highlight(field.el, true);
    return { ok: true, answer: response.answer, undo: () => {
      if (!guardedUndo()) throw new Error("Your later edit was kept; this answer can no longer be undone.");
      const i = undoStack.indexOf(guardedUndo); if (i !== -1) undoStack.splice(i, 1);
    } };
  } finally { busy = false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Learning loop
// ─────────────────────────────────────────────────────────────────────────────

let pendingLearning = new Set();
let learningQueue = Promise.resolve();

/**
 * Remember an answer against a question.
 *
 * The key is normalised here, in the one place every caller passes through, so
 * that whatever a caller happens to hold — a raw label, a name attribute, a
 * `fieldKey` — lands in the same slot `taughtValue()` reads from. Previously
 * each write path used its own spelling and none of them matched the lookup,
 * so nothing learned from a manual edit was ever reused.
 */
function learn(field, value, scope = "application", strict = false) {
  if (!value || value.length > 50000) return;
  const descriptor = { questionFull: field.questionFull, rawLabel: field.rawLabel, section: field.section, sectionTitle: field.sectionTitle,
    applicationContext: JSON.stringify(pageIdentity()),
    entityId: field.entityId, instance: field.instance, options: field.options?.map(o => ({ label: o.label, value: o.value })), extraction: field.extraction };
  const task = learningQueue.then(async () => {
    const id = scopedAnswerIdentity(questionContext(descriptor, location.href), scope);
    const expectedRevision = ctx.knowledge?.answers?.[id]?.revision || 0;
    const saved = await knowledge("answer", { field: descriptor, value, scope, expectedRevision });
    memoryUndos.set(field.fieldId, saved.undoToken);
    ctx.knowledge = await knowledge("snapshot");
  })
    .catch(error => { panel?.setError?.(error.message); console.warn("Apply karo: could not remember correction", error.message); if (strict) throw error; });
  learningQueue = task;
  pendingLearning.add(task); task.then(() => pendingLearning.delete(task), () => pendingLearning.delete(task));
  return task;
}

async function persistLearned() {
  await Promise.all([...pendingLearning]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Correction feedback
//
// Remembering the *value* you typed was already handled. This also remembers
// which rule produced a value you then replaced, and demotes that pairing next
// time — so a rule that keeps landing on the wrong box stops winning it.
// ─────────────────────────────────────────────────────────────────────────────

let wrote = new WeakMap();     // element -> { ruleId, value, key }

function remember(field, value, ruleId) {
  const restore = undoStack.at(-1); if (restore) sourceUndos.set(field.fieldId, restore);
  if (!ruleId) return;
  wrote.set(field.el, { ruleId, value: String(value), key: fieldKey(field) });
}

let correctionsDirty = false;

function demote(key, ruleId) {
  if (!key || !ruleId) return;
  const list = ctx.corrections[key] || (ctx.corrections[key] = []);
  if (list.includes(ruleId)) return;
  list.push(ruleId);
  correctionsDirty = true;
  console.debug(`Apply karo: demoted "${ruleId}" for "${key}"`);
}

/**
 * Watch for values you type by hand and remember them.
 * One delegated listener; the label is only resolved on a control that actually
 * changed, never on every keystroke.
 */
function watchEdits() {
  const capture = (e) => {
    if (e.isTrusted !== true || isExtensionAction() || e.target?.closest?.(OWN_UI)) return;
    const target = e.target;
    const fields = bindEntities(scan(), ctx.profile);
    const option = target?.closest?.('[role="option"],[role="menuitem"],.select2-results__option');
    const menu = option?.closest?.('[role="listbox"],[role="menu"],.select2-results');
    const field = fields.find(f => f.el === target || f.nativeSelect === target || f.options?.some(o => o.el === target) ||
      (option && (f.el.getAttribute('aria-controls') || f.el.getAttribute('aria-owns') || '').split(/\s+/).some(id => menu?.id === id || menu?.contains(document.getElementById(id)))));
    if (!field || !answerPolicy(field, ctx.settings).allowed || field.kind === "file" || field.skip) return;
    const original = field.formRevision;
    setTimeout(async () => {
      const fresh = bindEntities(scan(), ctx.profile).find(f => f.el === field.el && (f.formRevision === original || option && f.questionFull === field.questionFull && f.section === field.section && f.entityId === field.entityId && f.helperText === field.helperText));
      if (!fresh) return;
      const optionLabel = option?.textContent?.trim();
      const clean = optionLabel && accepts(fresh, optionLabel) ? optionLabel : answerText(fresh, readControl(fresh));
      if (!clean || validationState(fresh) === "failed") return;
      userModifiedElements.add(fresh.el);
      diagnose(fresh, "review", "edited", "user_modified");
      await learn(fresh, clean);
      retainDecision(fresh, { status: "resolved", source: "User correction", value: clean, reason: "Entered by you" });
      wrote.delete(fresh.el);
    }, option ? 150 : 0);
  };
  document.addEventListener("change", capture, true);
  document.addEventListener("pointerdown", e => { if (e.target?.closest?.('[role="option"],[role="menuitem"],.select2-results__option')) capture(e); }, true);
  document.addEventListener("keyup", e => { if (["Enter", " "].includes(e.key) && e.target?.matches?.('[role="combobox"],[role="listbox"]')) capture(e); }, true);
  document.addEventListener("keydown", e => { if (["Enter", " "].includes(e.key) && e.target?.closest?.('[role="option"],[role="menuitem"]')) capture(e); }, true);

  // Persist on submit and when the tab goes away — never on every edit.
  document.addEventListener("submit", persist, true);
  window.addEventListener("pagehide", () => { persist(); }, { once: true });
}

async function persist() {
  // Submit and pagehide both fire on a page that has outlived the extension,
  // and a storage write from there rejects into nothing. Nobody is watching a
  // page that is going away, so this is the one place to fail silently.
  if (orphaned()) return;
  await persistLearned();
  if (!correctionsDirty) return;
  correctionsDirty = false;
  await knowledge("demote", { changes: ctx.corrections });
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-step forms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fill this step, advance, repeat. Explicit user action only.
 * The navigation guards live in ./steps.js so they can be tested on their own.
 */
async function runSteps(max = 8) {
  ctx = await loadContext(); if (!releasePolicy(ctx.settings).enabled) throw new Error(releasePolicy(ctx.settings).reason);
  const result = await stepThrough(
    async () => {
      const r = await run({ manual: true, useAI: true });
      invalidateShadowCache();
      return r;
    },
    { max }
  );
  await persist();
  return result;
}


// ─────────────────────────────────────────────────────────────────────────────
// Dynamic form watching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * v1 rescanned whenever *any* node was added, which on a React page means
 * permanently. This only wakes up when the added nodes actually contain form
 * controls, then coalesces into a single idle-time rescan, and shuts itself off
 * once the page stops producing new fields.
 */
function hasNewControls(records) {
  for (const r of records) {
    const added = r.addedNodes;
    for (let i = 0; i < added.length; i++) {
      const n = added[i];
      if (n.nodeType !== 1) continue;
      if (n.closest?.(OWN_UI)) continue;
      if (CONTROL_TAGS.has(n.tagName)) return true;
      if (n.shadowRoot) return true;
      if (n.querySelector?.("input,select,textarea")) return true;
    }
  }
  return false;
}

const idle = typeof window !== "undefined" && window.requestIdleCallback ? window.requestIdleCallback.bind(window) : ((fn) => setTimeout(fn, 200));

function watchForms() {
  let scheduled = false;

  observer = new MutationObserver((records) => {
    const added = hasNewControls(records);
    const changed = records.some((r) => {
      const node = r.target.nodeType === 3 ? r.target.parentElement : r.target;
      if (node?.closest?.(OWN_UI) || node?.getRootNode?.()?.host?.closest?.(OWN_UI)) return false;
      return r.type === "attributes" || (r.type === "characterData" && node?.matches?.("label,legend,[id],[role=heading]")) ||
        (r.type === "childList" && node?.matches?.("label,legend,[id],[role=heading]"));
    });
    if (!added && !changed) return;
    invalidateShadowCache();
    if (scheduled) return;
    scheduled = true;
    idle(async () => {
      scheduled = false;
      updateFieldOverlays(scan());
      if (!added || !ctx.settings.autofillOnLoad) return;
      if (userIsBusy()) return;
      const before = ranOnce;
      const res = await run({ manual: false, useAI: false });
      if (res.filled > 0) {
        quietRuns = 0;
        panel?.setCount(res.filled);
      } else if (before) {
        // Nothing new to do. After a few consecutive empty passes the page has
        // clearly settled, so stop watching entirely rather than idling forever.
        if (++quietRuns >= 6) stopWatching();
      }
    }, { timeout: 2000 });
  });

  const config = { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["aria-label", "aria-labelledby", "aria-describedby", "name", "id", "hidden", "disabled", "aria-required"] };
  observer.observe(document.documentElement, config);
  for (const root of new Set(scan().map((f) => f.el.getRootNode?.()))) if (root && root !== document) observer.observe(root, config);
}

function stopWatching() {
  observer?.disconnect();
  observer = null;
  console.debug("Apply karo: page settled, observer released");
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel + shortcuts
// ─────────────────────────────────────────────────────────────────────────────

async function ensurePanel() {
  if (panel || !IS_TOP || siteDisabled || ctx?.settings.panelEnabled === false) return panel;
  const mod = await Promise.resolve(__req("src/engine/panel.js"));
  panel = mod.mount({
    // The panel sits in the top frame, but on an embedded board — Greenhouse and
    // Lever inside a company careers page — the form it is offering to fill is
    // in a subframe. Every one of these covers the whole tab for that reason.
    onFill: (onStage) => fillWholeTab(onStage),
    onFillSteps: async () => {
      const mine = await runSteps();
      const rest = await inOtherFrames("rf_steps");
      return {
        ...mine,
        filled: mine.filled + (rest.filled || 0),
        steps: mine.steps + (rest.steps || 0),
        trail: [...mine.trail, ...(rest.trail || [])]
      };
    },
    onUndo: async () => undoFill() + ((await inOtherFrames("rf_undo")).restored || 0),
    onHighlight: async () => {
      const mine = highlightEmpty();
      const rest = await inOtherFrames("rf_highlight");
      return {
        count: mine.count + (rest.empty || 0),
        required: mine.required + (rest.required || 0),
        unseen: mine.unseen + (rest.unseen || 0)
      };
    },
    onReview: async () => { ctx = await loadContext(); return [...reviewFields(), ...((await inOtherFrames("rf_review")).reviewRows || [])]; },
    onReviewAction: async (row, action, value, scope) => {
      if (row.owner === reviewOwner) return reviewAction(row, action, value, scope);
      const result = await inOtherFrames("rf_review_action", { row, reviewOperation: action, value, scope });
      if (!result.handled) throw new Error(result.error || "The frame changed. Refresh review.");
      return true;
    },
    onCoverLetter: (onStage) => writeCoverLetter(onStage),
    onMatch: (onStage) => matchThisJob(onStage),
    onPriorApplications: () => priorApplications(),
    onDisableSite: async () => {
      setSiteDisabled(ctx.settings, location.hostname, true);
      await saveSettings(ctx.settings);
      siteDisabled = true;
      stopWatching();
      destroyFieldOverlays();
      panel?.destroy();
      panel = null;
    },
    onMove: async (pos) => {
      ctx.settings.panelPos = pos;
      await saveSettings(ctx.settings);
    },
    canUndo,
    getContext: () => ctx,
    reload: async () => { ctx = await loadContext(); }
  });
  return panel;
}

// The Alt+Shift+F shortcut is registered in the manifest under `commands` and
// dispatched from the service worker, NOT with a keydown listener here.
//
// A listener in this file can only fire once the engine has loaded, which means
// only after detection passed — so on exactly the pages where you would reach
// for a manual shortcut (a careers page on an unlisted host, a Google Form that
// missed the text heuristic) the key was dead, while the popup and this file
// both advertised it as working anywhere.
//
// Routing through `chrome.commands` costs no new permission: invoking an
// extension by its keyboard shortcut is one of the gestures that grants
// `activeTab`, the same grant a toolbar click gives the popup.

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Whole-tab actions, from this frame's side
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Take part in a coordinated run, or stand down.
 *
 * `skipTop` is how the on-page panel avoids doing its own frame twice: it fills
 * locally first so it can show progress as it goes, then asks for the rest of
 * the tab. Returns false when this frame should ignore the message entirely.
 */
function claim(msg) {
  if (msg.skipTop && IS_TOP) return false;
  if (msg.runId) chrome.runtime.sendMessage({ type: "rf_frame_ack", runId: msg.runId }).catch(() => {});
  return true;
}

/** Hand this frame's outcome back to the coordinator. */
function report(runId, result) {
  if (!runId) return;
  chrome.runtime
    .sendMessage({ type: "rf_frame_result", runId, result: { ...result, isTop: IS_TOP } })
    .catch(() => {});
}

/** Ask the service worker to run `action` in every OTHER frame of this tab. */
async function inOtherFrames(action, extra = {}) {
  const r = await chrome.runtime
    .sendMessage({ type: "tab_action", action, skipTop: true, ...extra })
    .catch(() => null);
  return r?.ok ? r : {};
}

/**
 * Fill this frame, then the rest of the tab.
 *
 * The local half runs directly rather than through the coordinator so the panel
 * can keep reporting stages ("Asking AI about 6 more…") as it goes — a callback
 * cannot cross a message boundary.
 */
async function fillWholeTab(onStage) {
  const start = await chrome.runtime.sendMessage({ type: "start_fill" });
  if (!start?.ok) throw new Error(start?.error || "Could not start filling.");
  while (true) {
    const { job } = await chrome.runtime.sendMessage({ type: "fill_job_status", runId: start.runId });
    if (!job) throw new Error("Fill status is unavailable. Review the form before retrying.");
    onStage?.(job.detail || JOB_LABELS[job.state] || "Working…");
    if (!isRunningJob(job)) return { ...job, aiError: job.error || "", ok: job.state !== "failed" && job.state !== "interrupted" };
    await new Promise((r) => setTimeout(r, 300));
  }
}

const contentJobs = new Map();
function jobStatus(id) {
  const j = contentJobs.get(id); return j ? { state: j.state, result: j.result } : { state: "unknown" };
}

async function correctQuestion(field, question) {
  const locator = locatorFor(field.el);
  if (!locator) throw new Error("This field has no stable locator; its question cannot be saved safely.");
  if (scan().filter((f) => locatorFor(f.el) === locator).length !== 1) throw new Error("This locator is shared by several fields. A page-wide correction would be ambiguous.");
  const original = field.labelCandidates?.find((c) => c.source !== "user-corrected" && !c.generic)?.text || field.rawLabel;
  const result = await chrome.runtime.sendMessage({ type: "save_question_fix", locator, original, question });
  if (!result?.ok) throw new Error(result?.error || "The question could not be saved.");
  ctx = await loadContext(); configureQuestionFixes(ctx.questionFixes);
  const fresh = scan().find((f) => f.el === field.el);
  updateFieldOverlays(scan());
  return fresh;
}
function inventory() { return surfaceInventory(); }
async function ready() {
  const started = Date.now();
  while (!listening) {
    if (Date.now() - started > 8000) throw new Error("The form engine did not become ready.");
    await new Promise((r) => setTimeout(r, 25));
  }
  return true;
}

let booted = false;
let listening = false;

/**
 * Resolve once this tab has actually been laid out.
 *
 * The scanner discards a control whose bounding box is zero, which is the only
 * reliable way to spot a zero-size honeypot. In a tab that has never been
 * painted — a job link opened in the background, a session restored on startup
 * — every box is zero, so that guard throws away the entire form and the
 * automatic pass reports nothing to fill. Waiting costs nothing on a visible
 * page: `visibilityState` is already "visible" and this is one frame.
 */
function whenRendered() {
  if (document.visibilityState !== "hidden") {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", on);
      requestAnimationFrame(() => resolve());
    };
    document.addEventListener("visibilitychange", on);
  });
}

async function boot() {
  // The module is cached, but the popup's force-load path can call boot() again
  // on a page that already started normally — without this we would stack a
  // second message listener, a second observer and a second panel.
  if (booted) return;
  booted = true;
  try {
    await bootOnce();
  } catch (err) {
    // A boot that threw before it could listen must not latch the flag. It used
    // to: `booted` was set before the first await, so a rejected loadContext()
    // meant every later "Fill this page" force-load returned instantly and did
    // nothing — no listener was ever registered, and the popup reported
    // "Couldn't reach the page" for the rest of that page's life with no way
    // back short of a reload. Clearing it makes the retry that popup.js already
    // performs mean something.
    //
    // Only before it could listen, though. A failure further on — the panel
    // import, the first automatic pass — leaves a frame that answers messages
    // perfectly well, and un-latching there would stack a second listener,
    // observer and panel on the next force-load.
    if (!listening) booted = false;
    throw err;
  }
}

async function bootOnce() {
  ctx = await loadContext();
  // Opt-out must clear observations in already-open pages immediately.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    ctx.settings.release = changes.settings.newValue?.release;
    ctx.settings.diagnosticsEnabled = changes.settings.newValue?.diagnosticsEnabled === true;
    diagnostics.configure(ctx.settings.diagnosticsEnabled);
  });
  siteDisabled = isSiteDisabled(ctx.settings, location.hostname);

  // The popup and the panel both talk to the engine through here. Only the top
  // frame answers, so a page with six iframes still produces one reply.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // A whole-tab action is coordinated by the service worker: this frame says
    // it is taking part, does the work, then reports separately. Nothing travels
    // back down `sendResponse`, because only one frame's reply would survive it
    // — see the note in background.js. Dropping the old `IS_TOP` gate is the
    // point: on an embedded Greenhouse or Lever board every field lives in a
    // subframe, and gating on the top frame meant the frame holding the
    // application was the one frame never allowed to answer.
    const runId = msg?.runId;

    switch (msg?.type) {
      case "rf_fill":
      case "rf_steps": {
        if (claim(msg) === false) return false;
        const id = msg.jobId || runId;
        let task = contentJobs.get(id);
        if (!task) {
          task = { state: "running", result: null };
          contentJobs.set(id, task);
          let currentStage = "detecting";
          let currentDetail = "";
          const progress = (state, detail = currentDetail) => {
            currentStage = state;
            currentDetail = detail;
            return chrome.runtime.sendMessage({ type: "rf_frame_progress", runId, jobId: msg.jobId, state, detail }).catch(() => {});
          };
          const heartbeat = setInterval(() => progress(currentStage), 2000);
          task.promise = (async () => {
            try {
              await progress("detecting");
              const r = msg.type === "rf_steps" ? await runSteps() : await run({ manual: true, useAI: true, isCancelled: () => task.cancelled || (msg.deadline && Date.now() > msg.deadline),
                onStage: (text) => progress(/AI/.test(text) ? "waiting_ai" : /Checking/.test(text) ? "verifying" : "filling", text) });
              panel?.setCount(r.filled);
              return { ok: true, filled: r.filled, drafts: r.drafts || 0, deferred: r.deferred || 0, total: r.total, empty: r.empty || 0, unseen: r.unseen || 0, aiError: r.aiError || "" };
            } catch (err) { return { ok: false, error: err?.message || String(err) }; }
            finally { clearInterval(heartbeat); }
          })().then((result) => { task.state = "done"; task.result = result; return result; });
          if (contentJobs.size > 30) { const old = [...contentJobs].find(([key, value]) => key !== id && value.state === "done"); if (old) contentJobs.delete(old[0]); }
        }
        task.promise.then((result) => report(runId, result));
        return false;
      }
      case "rf_cancel_job":
        if (contentJobs.has(msg.jobId)) contentJobs.get(msg.jobId).cancelled = true;
        return false;
      case "rf_job_progress":
        return false;
      case "rf_ready":
        sendResponse({ ok: listening, state: listening ? "ready" : "accepted" });
        return false;

      case "rf_undo":
        if (claim(msg) === false) return false;
        report(runId, { ok: true, restored: undoFill() });
        return false;

      case "rf_highlight": {
        if (claim(msg) === false) return false;
        const { count, required, unseen } = highlightEmpty();
        report(runId, { ok: true, empty: count, required, unseen });
        return false;
      }

      case "rf_review":
        if (claim(msg) === false) return false;
        loadContext().then(next => { ctx = next; report(runId, { reviewRows: reviewFields() }); }).catch(error => report(runId, { error: error.message })); return false;
      case "rf_review_action":
        if (claim(msg) === false) return false;
        reviewAction(msg.row, msg.reviewOperation, msg.value, msg.scope).then(handled => report(runId, { handled })).catch(error => report(runId, { error: error.message })); return false;
      case "rf_open_review":
        if (IS_TOP) ensurePanel().then(p => p?.openReview?.());
        if (claim(msg) !== false) report(runId, { ok: true }); return false;
      case "rf_status":
        if (claim(msg) === false) return false;
        report(runId, pageStatus());
        return false;

      case "rf_diagnostics": {
        if (claim(msg) === false) return false;
        const data = diagnostics.snapshot();
        report(runId, { diagnosticEvents: data.events, diagnosticDropped: data.dropped, diagnosticsEnabled: data.enabled });
        return false;
      }

      // A letter the toolbar drafted, on its way into the form. It arrives as a
      // whole-tab action for the same reason a fill does: on an embedded board
      // the cover-letter box is in a subframe, and the frame that has it is not
      // the frame the popup is looking at.
      case "rf_place_letter":
        if (claim(msg) === false) return false;
        placeLetter(msg.text).then(placed => report(runId, { ok: true, placed: placed ? 1 : 0 })).catch(err => report(runId, { ok: false, error: err.message }));
        return false;

      // The tab filled `n` fields across all its frames. Only the top frame can
      // log that: the tracker is keyed by the page you were looking at, and an
      // embedded board's frame would file the row under greenhouse.io rather
      // than under the employer whose careers page you were actually on. Without
      // this, an application filled entirely inside an iframe was never tracked
      // at all — the frame that did the work is not allowed to name the page.
      case "rf_log_fill":
        if (IS_TOP) logApplication(msg.filled, msg.total);
        return false;

      case "rf_settings_changed":
        // A toggle in the popup should take effect without a reload.
        loadContext().then((next) => {
          ctx = next;
          diagnostics.configure(ctx.settings.diagnosticsEnabled);
          siteDisabled = isSiteDisabled(ctx.settings, location.hostname);
          if (siteDisabled || ctx.settings.panelEnabled === false) {
            panel?.destroy();
            panel = null;
          } else if (IS_TOP) {
            ensurePanel();
          }
          if (siteDisabled || ctx.settings.fieldAiButtonEnabled === false) {
            destroyFieldOverlays();
          } else {
            updateFieldOverlays(scan());
          }
        });
        return false;

      default:
        return;
    }
  });

  listening = true;

  watchEdits();

  // A site the user has switched off gets nothing: no panel, no automatic fill,
  // no observer. An explicit "Fill this page" from the toolbar still works,
  // because that is an unambiguous instruction rather than a standing default.
  if (siteDisabled) {
    console.debug("Apply karo: this site is switched off in settings");
    return;
  }

  configureQuestionFixes(ctx.questionFixes);
  initFieldOverlays({ getContext: () => ctx, onExclusiveFill: handleExclusiveFill, onCorrectQuestion: correctQuestion });
  updateFieldOverlays(scan());

  if (IS_TOP) await ensurePanel();

  if (ctx.settings.autofillOnLoad) {
    await whenRendered();
    const res = await run({ manual: false, useAI: false });
    panel?.setCount(res.filled);
  }

  watchForms();
}

/**
 * Outline everything still empty. Shared by the panel and the popup so both
 * report the same number.
 *
 * This runs off `scan()` rather than its own `querySelectorAll`, and that is the
 * whole point of it. The old loop walked `input,select,textarea` and then
 * skipped radios, checkboxes and read-only controls outright — so the three
 * things most likely to be the reason a submit is rejected were the three it
 * could never show you. An unticked "I certify this is accurate", an unanswered
 * work-authorization radio group and a required dropdown built as a `<div>` all
 * reported the form as complete.
 *
 * The scanner already knows about every one of those, already knows which are
 * filled, and already understands shadow roots — so asking it is both more
 * correct and less code.
 */
function highlightEmpty() {
  document.querySelectorAll(".rf-missed").forEach((n) => n.classList.remove("rf-missed"));

  let style = document.getElementById("applykaro-missed");
  if (!style) {
    style = document.createElement("style");
    style.id = "applykaro-missed";
    style.textContent =
      ".rf-missed{outline:2px dashed #e0483f!important;outline-offset:2px!important;" +
      "border-radius:3px!important;animation:rf-missed-in .25s ease-out}" +
      "@keyframes rf-missed-in{from{outline-color:transparent}}";
    (document.head || document.documentElement).appendChild(style);
  }

  // Both halves of the count come from surveyEmpty, which the fill also uses —
  // so "3 still empty" on the Fill button and "3 outlined in red" here can never
  // be two different threes.
  const { targets, unseen } = surveyEmpty();

  const marked = [];
  let first = null;
  let required = 0;

  for (const { el, required: isReq } of targets) {
    el.classList.add("rf-missed");
    marked.push(el);
    if (isReq) { required++; first = first || el; }
  }
  first = first || marked[0] || null;

  first?.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(() => {
    for (const el of marked) el.classList.remove("rf-missed");
  }, 6000);
  return { count: marked.length, required, unseen: unseen.length };
}

/** Is this a control a person is expected to put something into? */
function isFillableControl(el) {
  if (el.disabled || el.readOnly) return false;
  if (el.getAttribute?.("aria-disabled") === "true") return false;
  const t = (el.type || "").toLowerCase();
  // A file input is reported by the upload path, not here, and the rest are
  // buttons wearing an <input> tag.
  return !["hidden", "submit", "button", "reset", "image", "file"].includes(t);
}

/**
 * Does this one control hold nothing?
 *
 * Radios are answered as a group: an unchecked "No" beside a checked "Yes" is a
 * complete answer, and flagging it would bury the genuinely empty fields in
 * noise — which is how a review stops being read.
 */
function isEmptyControl(el) {
  const t = (el.type || "").toLowerCase();

  if (t === "radio") {
    const scope = el.getRootNode?.() || document;
    if (el.name) {
      try {
        if (scope.querySelector(`input[name="${CSS.escape(el.name)}"]:checked`)) return false;
      } catch { /* a name CSS.escape cannot express falls through to .checked */ }
    }
    return !el.checked;
  }
  if (t === "checkbox") return !el.checked;
  if (el.tagName === "SELECT") {
    if (el.selectedIndex < 0) return true;
    const opt = el.options[el.selectedIndex];
    if (!opt || !el.value) return true;
    const txt = (opt.text || "").trim();
    return COMBO_PLACEHOLDER_RE.test(txt) || /^(--\s*)?(select|choose|please select)/i.test(txt);
  }

  const role = (el.getAttribute?.("role") || "").toLowerCase();
  if (role === "combobox" || el.tagName === "BUTTON" || el.matches?.('[aria-haspopup="listbox"],[data-automation-id*="prompt"]')) {
    return !isComboboxFilled(el);
  }

  if (role === "radio" || role === "checkbox" || role === "switch" || role === "option") {
    return el.getAttribute("aria-checked") !== "true" && el.getAttribute("aria-selected") !== "true";
  }
  // A radiogroup or listbox container states its answer through its children.
  if (role === "radiogroup" || role === "listbox") {
    return !el.querySelector?.('[aria-checked="true"],[aria-selected="true"]');
  }

  if (typeof el.value === "string" || typeof el.value === "number") return !String(el.value).trim();
  if (el.isContentEditable) return !(el.textContent || "").trim();
  return false;
}

/** Does the page itself say this field must be answered? */
function isRequired(field) {
  const els = [field.el, ...(field.options || []).map((o) => o.el)].filter(Boolean);
  for (const el of els) {
    if (el.required) return true;
    const aria = el.getAttribute?.("aria-required");
    if (aria === "true") return true;
  }
  return false;
}

/** The element an outline should actually be drawn on. */
function outlineTarget(field) {
  const el = field.el;
  if (!el) return null;
  const r = el.getBoundingClientRect?.();
  if (r && r.width > 1 && r.height > 1) return el;
  // Zero-size or visually replaced: outline whatever the user can see instead.
  if (field.kind === "file") return uploadWidget(el);
  const opt = (field.options || []).map((o) => o.el).find((n) => {
    const b = n?.getBoundingClientRect?.();
    return b && b.width > 1 && b.height > 1;
  });
  return opt || el.closest("label,fieldset,[role=radiogroup],[role=group]") || el.parentElement || el;
}

Object.assign(__x, { reviewFields, reviewAction, undoFill, canUndo, ruleValue, run, widgetTurn, matchThisJob, priorApplications, placeLetter, writeCoverLetter, pageStatus, handleExclusiveFill, runSteps, jobStatus, correctQuestion, inventory, ready, boot, highlightEmpty });
};

__m["src/engine/controls/adapter.js"] = (__x, __req) => {
const { fillSync, fillAsync, fillFile, labelOfControl, setValue, fire } = __req("src/engine/controls/native.js");
const { readControl } = __req("src/engine/controls/read.js");
const { rankChoices } = __req("src/engine/controls/workday.js");
const { verificationTicket, verify, guardUndo } = __req("src/engine/verify.js");
function controlAdapter(field) {
  const freeText=field.kind==="combobox" && (field.el.hasAttribute("list") || ["both","inline"].includes(field.el.getAttribute("aria-autocomplete")));
  return { read:()=>readControl(field), resolveOptions:(value,ruleId)=>({ ...rankChoices(field.options || [],value,ruleId), complete:field.optionsComplete!==false }),
    write:(value,ruleId)=>fillSync(freeText?{...field,kind:"text"}:field,value,ruleId), writeAsync:async(value,ruleId)=>{
      if(field.nativeSelect) {const selected=rankChoices(field.options||[],value,ruleId).choice;if(!selected || field.nativeSelect.disabled || !field.writeGuard?.())return false;
        setValue(field.nativeSelect,selected.value);fire(field.nativeSelect,'input');fire(field.nativeSelect,'change');return true;}
      return await fillAsync(field,value,ruleId);
    },
    verify:(value,ruleId,ticket,opts)=>verify(field,value,ruleId,ticket,opts), undo:restore=>guardUndo(field,restore) };
}
function beginWrite(field, value, ruleId, options={}) {
  const adapter=controlAdapter(field),ticket=verificationTicket(field,labelOfControl);
  const grouped=["radiogroup","checkboxgroup","dategroup"].includes(field.kind);
  const legend=field.el.closest("fieldset")?.querySelector("legend")?.textContent.trim();
  const staleSection=legend && field.sectionTitle && legend!==field.sectionTitle && legend!==field.rawLabel;
  const staleOptions=field.kind==="select" && (field.options || []).some(o=>o.el && (o.el.value!==o.value || o.el.text.trim()!==o.label));
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s\r\n*.:;,-]+/g, " ").trim();
  const currentLabel = labelOfControl(field.el);
  const staleLabel = !grouped && field.rawLabel && currentLabel && (norm(currentLabel) !== norm(field.rawLabel) && !norm(currentLabel).includes(norm(field.rawLabel)) && !norm(field.rawLabel).includes(norm(currentLabel)));
  if(options.isCancelled?.() || !ticket.valid() || staleSection || staleOptions || staleLabel || field.el.disabled || field.el.readOnly && field.kind!=="combobox") {ticket.dispose();field.verification={status:"deferred",writeAttempted:false,domAccepted:false,validation:"not_checked",reason:"stale_descriptor"};return {attempted:false, immediate:false, completion:Promise.resolve(false)};}
  const immediate=ticket.writing(()=>adapter.write(value,ruleId));
  field.proposedWrite={value,ruleId};
  field.writeGuard=()=>ticket.valid()&&!options.isCancelled?.();
  field.cleanupGuard=()=>ticket.valid();
  const completion=(async()=>{
    try {
      const wrote=immediate===null?await adapter.writeAsync(value,ruleId):immediate;
      if(!wrote){field.verification={status:"rejected",writeAttempted:true,domAccepted:false,validation:"not_checked",reason:"control_refused"};return false;}
      field.verification=await adapter.verify(value,ruleId,ticket,options);
      field.controlOutcome={...field.controlOutcome,...field.verification};
      return field.verification.status==="verified";
    } finally {delete field.writeGuard;delete field.cleanupGuard;ticket.dispose();}
  })();
  return {attempted:true,immediate,completion};
}
async function writeVerified(field,value,ruleId,options){return await beginWrite(field,value,ruleId,options).completion;}
async function uploadVerified(field,dataUrl,name,options={}) {
  const ticket=verificationTicket(field,labelOfControl);
  try {
    const before=readControl(field);
    const norm = (s) => String(s || "").toLowerCase().replace(/[\s\r\n*.:;,-]+/g, " ").trim();
    const currentLabel = labelOfControl(field.el);
    const staleLabel = field.rawLabel && currentLabel && (norm(currentLabel) !== norm(field.rawLabel) && !norm(currentLabel).includes(norm(field.rawLabel)) && !norm(field.rawLabel).includes(norm(currentLabel)));
    if(before.length || options.isCancelled?.() || !ticket.valid() || staleLabel)return false;
    const ok=await fillFile(field.el,dataUrl,name,()=>ticket.valid()&&!options.isCancelled?.());
    if(!ok)return false;
    const file=field.el.files[0];
    field.proposedWrite={value:{name:file.name,size:file.size},ruleId:null};
    field.verification=await verify(field,{name:file.name,size:file.size},null,ticket,options);
    const box=field.el.closest('[data-automation-id="formField"],[data-upload],.dropzone') || field.el.parentElement;
    const states=box?[box,...box.querySelectorAll('[data-upload-state="error"],[aria-busy="true"],[role="alert"]')]:[];
    if(states.some(el=>el.getAttribute('data-upload-state')==='error' || el.getAttribute('aria-busy')==='true' || el.getAttribute('role')==='alert' && el.getClientRects().length && el.textContent.trim()))field.verification={...field.verification,status:"deferred",reason:"upload_pending_or_error"};
    return field.verification.status==="verified";
  } finally {ticket.dispose();}
}

Object.assign(__x, { controlAdapter, beginWrite, writeVerified, uploadVerified });
};

__m["src/engine/controls/native.js"] = (__x, __req) => {
// Apply karo — value injection.
//
// Two things make a fill actually "take" on a modern ATS:
//
//  1. Writing through the *native* property setter. React installs its own
//     setter on the element instance, so `el.value = x` updates the DOM but
//     leaves React's internal value tracker in sync — meaning React sees no
//     change and reverts the field on the next render. Calling the prototype
//     setter and then clearing the tracker is what makes it stick.
//  2. Dispatching the full event sequence a real user produces. Frameworks
//     variously listen for pointerdown, mousedown, click, input, change and
//     blur; sending only `input` + `change` misses custom widgets entirely.

const { semanticScore, asBool, parseDate, formatDate, datePartValue, monthName } = __req("src/shared/values.js");
const { RULE_BY_ID } = __req("src/shared/rules.js");
const { fillWorkday, rankChoices } = __req("src/engine/controls/workday.js");
const { labelOf } = __req("src/engine/scan.js");

const TRACKER = "_valueTracker";
let actionDepth = 0;
function isExtensionAction() { return actionDepth > 0; }

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

function nativeSetter(el) {
  const win = el.ownerDocument?.defaultView || window;
  const tag = (el.tagName || "").toUpperCase();
  const proto =
    tag === "TEXTAREA" ? (win.HTMLTextAreaElement || HTMLTextAreaElement).prototype :
    tag === "SELECT" ? (win.HTMLSelectElement || HTMLSelectElement).prototype :
    (win.HTMLInputElement || HTMLInputElement).prototype;
  return Object.getOwnPropertyDescriptor(proto, "value")?.set;
}

function setValue(el, value) {
  const set = nativeSetter(el);
  // React's value tracker caches the last value it wrote. Reset it first, or a
  // programmatic write that happens to equal the tracked value is swallowed.
  if (el[TRACKER]) {
    try { el[TRACKER].setValue(""); } catch { /* not React, or shape changed */ }
  }
  if (set) set.call(el, value);
  else el.value = value;
}

function fire(el, type, init) {
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true, ...init }));
}

function fireInput(el) {
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText" }));
}

/** The pointer/mouse sequence a real click produces. */
function realClick(el) {
  if ((el.tagName === "BUTTON" || el.tagName === "INPUT") && el.type === "submit") return false;
  const doc=el.ownerDocument;
  const preventSubmit=e=>{if(actionDepth>0)e.preventDefault();};
  doc?.addEventListener("submit",preventSubmit,true);
  actionDepth++;
  try {
  const opts = { bubbles: true, composed: true, cancelable: true, view: window };
  try { el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse" })); } catch {}
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  try { el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse" })); } catch {}
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  try { el.click(); } catch {}
  } finally { actionDepth--;doc?.removeEventListener("submit",preventSubmit,true); }
}

/**
 * Is `el` the focused element, aware of shadow boundaries?
 *
 * `document.activeElement` stops at the shadow host and never descends into an
 * open shadow root, so a control focused inside one always read as unfocused
 * here. `el.getRootNode()` returns that shadow root directly when `el` lives
 * inside one — and a ShadowRoot exposes its own `activeElement` per spec — so
 * asking the root `el` actually belongs to covers both cases.
 */
function isFocused(el) {
  const root = el.getRootNode ? el.getRootNode() : document;
  return (root.activeElement || document.activeElement) === el;
}

/**
 * Tell the page the user has finished with this control.
 *
 * A large share of application forms do their validation on blur, not on input:
 * the required-field asterisk stays red, the "please enter a valid email"
 * message never clears, and on the stricter frameworks the value is not copied
 * into form state at all until focus leaves. Writing a value and never leaving
 * therefore produces a field that looks filled and submits empty.
 *
 * Note what this does *not* do: it never calls `el.blur()` or moves real focus.
 * The automatic pass runs while the user may well be typing somewhere else on
 * the page, and yanking the caret out from under them would be a far worse bug
 * than the one this fixes. React (17+) binds onBlur to the bubbling `focusout`
 * event and handlers registered directly on the element receive a dispatched
 * `blur`, so both are reached without touching the focus ring.
 *
 * `wasFocused` is `isFocused(el)` captured by the caller *before* any of our
 * own `focus()`/`realClick()` calls could have moved focus onto `el` — reading
 * `document.activeElement` here instead, after our own fill already focused
 * the control to write into it, meant this always saw "focused" and never
 * actually blurred anything it had just filled.
 */
function commit(el, wasFocused) {
  // If the user genuinely had this control focused before we touched it,
  // saying they left it would be a lie the page acts on — validation fires
  // mid-typing.
  if (wasFocused) return;
  try {
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false, composed: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  } catch { /* a control that refuses focus events is not worth aborting for */ }
}

function key(el, k, code = k) {
  const init = { key: k, code, bubbles: true, composed: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}

/** Resolve when `probe()` returns truthy, or null on timeout. Observer-driven. */
function waitFor(probe, timeoutMs = 1200) {
  const immediate = probe();
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      obs.disconnect();
      clearTimeout(timer);
      resolve(v);
    };
    const obs = new MutationObserver(() => {
      const v = probe();
      if (v) finish(v);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Text matching for options
// ─────────────────────────────────────────────────────────────────────────────

const YES = /^(yes|y|true|i am|i do)\b/i;
const NO = /^(no|n|false|i am not|i do not|i don't)\b/i;

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function levenshtein(a, b) {
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  let prev = new Array(al + 1), curr = new Array(al + 1);
  for (let j = 0; j <= al; j++) prev[j] = j;
  for (let i = 1; i <= bl; i++) {
    curr[0] = i;
    const bc = b[i - 1];
    for (let j = 1; j <= al; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (bc === a[j - 1] ? 0 : 1));
    }
    const t = prev; prev = curr; curr = t;
  }
  return prev[al];
}

/** 0..1 similarity between an option's text and the value we want. */
function optionScore(optText, target) {
  const o = norm(optText), t = norm(target);
  if (!o || !t) return 0;
  if (o === t) return 1;

  // Yes/no semantics — the single most common shape in application forms.
  if (YES.test(t) && YES.test(o)) return 0.97;
  if (NO.test(t) && NO.test(o)) return 0.97;
  if ((YES.test(t) && NO.test(o)) || (NO.test(t) && YES.test(o))) return 0;

  if (o.startsWith(t) || t.startsWith(o)) return 0.9;
  if (o.includes(t) || t.includes(o)) return 0.8;

  // Word token overlap
  const oWords = new Set(o.split(" ").filter((w) => w.length > 2));
  const tWords = new Set(t.split(" ").filter((w) => w.length > 2));
  if (oWords.size && tWords.size) {
    let intersection = 0;
    for (const w of tWords) if (oWords.has(w)) intersection++;
    const overlap = intersection / Math.min(oWords.size, tWords.size);
    if (overlap >= 0.75) return 0.82;
    if (overlap >= 0.5) return 0.65;
  }

  // Acronyms: "DTU" for "Delhi Technological University".
  const words = t.split(" ").filter(Boolean);
  if (words.length > 1) {
    const initials = words.map((w) => w[0]).join("");
    if (o === initials || o.includes(initials)) return 0.85;
  }

  const dist = levenshtein(o, t);
  const max = Math.max(o.length, t.length);
  const sim = 1 - dist / max;
  return sim > 0.72 ? sim * 0.75 : 0;
}

/**
 * Pick the option that best expresses `value` in this control's own vocabulary.
 *
 * `ruleId` is what lets "B.Tech" find "Bachelor's Degree", and "No" find
 * "No, I do not require sponsorship" — string similarity alone scores both of
 * those near zero, which is how a dropdown silently stays empty while the same
 * question filled fine as a text box on the previous site.
 */
function bestOption(options, value, minScore = 0.5, ruleId = null) {
  let best = null, bestScore = minScore;
  for (const opt of options) {
    const s = Math.max(
      optionScore(opt.label, value),
      optionScore(opt.value, value),
      semanticScore(ruleId, opt.label, opt.value, value)
    );
    if (s > bestScore) { best = opt; bestScore = s; }
  }
  return best;
}

/**
 * Which of these options expresses `value`, or null.
 *
 * Exported so callers holding a free-text answer — the AI pass especially — can
 * turn it into a choice before it reaches a control that only accepts choices.
 */
function matchOption(options, value, ruleId = null) {
  if (!options?.length) return null;
  return bestOption(options, String(value), 0.5, ruleId);
}

/** Last-resort catch-alls so a required dropdown is not left empty. */
function fallbackOption(options) {
  for (const o of options) {
    if (/^(other|prefer not|decline|i don'?t wish|not listed|unlisted)/i.test(o.label)) return o;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-kind fillers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input types that hold only their own shape of value.
 *
 * Writing anything else into one of these does not throw and does not warn us:
 * the browser sets `.value` to the empty string, logs a violation to the console
 * that nobody reads, and carries on. `text`, `email`, `tel` and `url` are
 * deliberately absent — they accept any string and report invalidity separately.
 */
const CONSTRAINED = new Set([
  "number", "range", "date", "month", "week", "time", "datetime-local", "color"
]);

function fillText(el, value) {
  const wasFocused = isFocused(el);
  const before = typeof el.value === "string" ? el.value : "";

  try {
    el.dispatchEvent(new FocusEvent("focus", { bubbles: false, composed: true }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
  } catch {}

  setValue(el, value);

  // Did the control actually take it? This is the difference between a field
  // that is filled and one that merely had something written at it. A date
  // landing on a number box — "05/2027" into a graduation-year spinner — was
  // reported as a successful fill while the box sat empty, so nothing ever went
  // back for it and the count said the form was more complete than it was.
  if (String(value).trim() && el.value === "" && CONSTRAINED.has((el.type || "").toLowerCase())) {
    if (before !== "") setValue(el, before);
    return false;
  }

  fireInput(el);
  fire(el, "change");
  commit(el, wasFocused);
  return true;
}

function fillContentEditable(el, value) {
  const wasFocused = isFocused(el);
  el.textContent = value;
  fireInput(el);
  fire(el, "change");
  commit(el, wasFocused);
  return true;
}

function fillSelect(el, value, options, ruleId) {
  const opts = options?.length
    ? options
    : Array.from(el.options).map((o) => ({ el: o, label: o.text.trim(), value: o.value }));

  const pick = bestOption(opts, value, 0.5, ruleId) || fallbackOption(opts);
  if (!pick) return false;

  const wasFocused = isFocused(el);
  setValue(el, pick.value);
  // Some frameworks track selectedIndex rather than value.
  if (el.value !== pick.value && pick.el) pick.el.selected = true;
  fireInput(el);
  fire(el, "change");
  commit(el, wasFocused);
  return true;
}

/** Checked state for native and ARIA controls alike. */
function isChecked(el) {
  if (typeof el.checked === "boolean") return el.checked;
  return el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true";
}

function fillChoiceGroup(el, value, options, ruleId) {
  const pick = bestOption(options, value, 0.5, ruleId) || fallbackOption(options);
  if (!pick) return false;

  const target = pick.el;
  if (isChecked(target)) return true;   // re-clicking a styled toggle would undo it

  // An ARIA control has no `.checked` to set — clicking is the only way in, and
  // success has to be read back off the attribute the widget updates.
  if (typeof target.checked !== "boolean") {
    realClick(target);
    if (!isChecked(target)) {
      const container = target.closest?.(".docssharedWizToggleLabeledContainer, [data-value]");
      if (container && container !== target) realClick(container);
    }
    // Some widgets only commit on keyboard activation.
    if (!isChecked(target)) { key(target, " ", "Space"); }
    return isChecked(target);
  }

  // Prefer clicking the visible proxy: on Greenhouse/Workday the native input
  // is opacity:0 and the framework's handler lives on the label.
  const root = target.getRootNode ? target.getRootNode() : document;
  const proxy = target.closest?.("label") ||
    (target.id && root.querySelector ? root.querySelector(`label[for="${CSS.escape(target.id)}"]`) : null);
  if (proxy && proxy !== target) {
    realClick(proxy);
    if (target.checked) { fire(target, "change"); return true; }
  }

  realClick(target);
  fire(target, "change");
  return target.checked;
}

/**
 * An ARIA switch: a yes/no control with no `.checked` to assign.
 *
 * Clicking is the only way in, and — as with an ARIA radio — success has to be
 * read back off the attribute the widget maintains. Assigning `el.checked` on a
 * `<div>` succeeds silently by creating a property nobody reads, which is
 * exactly how a control reports itself filled while the page holds no answer.
 */
function fillSwitch(el, value) {
  const want = asBool(value);
  if (want === null) return false;
  if (isChecked(el) === want) return false;        // already there; nothing written

  const wasFocused = isFocused(el);
  realClick(el);
  // Some toggles only commit on keyboard activation.
  if (isChecked(el) !== want) key(el, " ", "Space");
  commit(el, wasFocused);
  return isChecked(el) === want;
}

function fillCheckbox(el, value) {
  // asBool understands the long-form phrasings ("I do not wish to answer",
  // "I certify that…"), which a bare /^yes/ test reads wrongly in both
  // directions.
  const want = asBool(value);

  // An answer we cannot read as yes or no is not a reason to *untick* the box.
  // `?? false` meant every unrecognised value cleared it, so a consent checkbox
  // answered with something unexpected came out worse than untouched.
  if (want === null) return false;

  // The explicit decision is already represented; the verifier checks it.
  if (el.checked === want) return true;

  const wasFocused = isFocused(el);
  const proxy = el.closest("label");
  if (proxy && proxy !== el) realClick(proxy);
  else realClick(el);
  fire(el, "change");
  commit(el, wasFocused);
  return el.checked === want;
}

/** The options an open menu is currently showing. */
function visibleOptions(listbox) {
  const items = Array.from(
    listbox.querySelectorAll('[role="option"],li,[data-automation-id="promptOption"]')
  ).filter((n) => n.offsetParent !== null || n.getClientRects().length);

  return items.map((n) => {
    const label = (n.getAttribute?.("aria-label") || n.getAttribute?.("data-value") || n.textContent || "").trim();
    const value = n.getAttribute?.("data-value") || (n.textContent || "").trim() || label;
    return { el: n, label, value };
  }).filter((o) => o.label);
}

/**
 * Does this widget accept words of your own, or only ones it offers?
 *
 * `aria-autocomplete="list"` — and the absence of the attribute altogether —
 * both mean the value has to come from the list; only "both"/"inline" complete
 * text you are free to invent, and `<input list>` is a suggestion box over a
 * plain text field.
 */
function acceptsFreeText(el) {
  const auto = (el.getAttribute("aria-autocomplete") || "").toLowerCase();
  if (auto === "both" || auto === "inline") return true;
  return el.hasAttribute("list");
}

/** Put a combobox back to the text it held before we typed a filter into it. */
function untype(el, before) {
  try {
    if (el.isContentEditable) el.textContent = before;
    else if (typeof el.value === "string") setValue(el, before);
    fireInput(el);
    fire(el, "change");
  } catch { /* a widget that resists being reset is not worth aborting for */ }
}

/**
 * Custom combobox: a text input or button that opens a listbox.
 * Workday, Ashby and most design systems build them this way and they are
 * invisible to a plain `value =` write.
 *
 * Typing into one is a way of *filtering* its options, not of answering it. That
 * distinction is the whole of this function: the text we type is scaffolding,
 * and if it does not end in one of the widget's own options being selected it
 * has to come back out. Left in, it reads as a filled field — a Yes/No dropdown
 * showing the word "Yes" that the site has no selection for and rejects on
 * submit, which is worse than the blank it replaced.
 */
async function fillCombobox(field, value, ruleId) {
  const el = field.el;
  if (el.ownerDocument && (el.getAttribute("role") === "combobox" || el.getAttribute("data-automation-id")?.includes("prompt"))) {
    return fillWorkday(field, value, ruleId, { click: realClick, setValue, input: fireInput, key, question: labelOf });
  }
  const typeable = el.tagName === "INPUT" || el.isContentEditable;
  const before = el.isContentEditable ? (el.textContent || "")
               : (typeof el.value === "string" ? el.value : "");

  // Options the scanner could already see — a listbox rendered but hidden, an
  // `aria-owns` list, a <datalist>. When these exist the control is a closed
  // choice list, whether or not the menu opens for us.
  const known = field.options?.length ? field.options : null;

  realClick(el);

  let listbox = await waitFor(() => findListbox(el), 1000);
  let open = listbox ? visibleOptions(listbox) : [];
  let pool = open.length ? open : (known || []);

  if (pool.length) {
    const pick = bestOption(pool, value, 0.55, ruleId);
    const rendered = pick?.el && (pick.el.offsetParent !== null || pick.el.getClientRects().length);
    if (rendered) {
      pick.el.scrollIntoView({ block: "nearest" });
      realClick(pick.el);
      fire(el, "change");
      return true;
    }
  }

  // If not matched in visible options and typeable, type to filter
  if (typeable) {
    const candidate = bestOption(known || [], value, 0.55, ruleId)?.label || value;
    const query = candidate.length > 40 ? candidate.slice(0, 30).trim() : candidate;
    setValue(el, query);
    fireInput(el);
    key(el, "ArrowDown");

    if (!listbox) listbox = await waitFor(() => findListbox(el), 1200);
    // If the listbox is open, typing filters or loads options asynchronously.
    // Wait for matching options (or newly rendered options) to appear in the listbox.
    if (listbox) {
      const matched = await waitFor(() => {
        const opts = visibleOptions(listbox);
        return (bestOption(opts, value, 0.55, ruleId) || opts.length > open.length) ? opts : null;
      }, 1000);
      open = matched || visibleOptions(listbox);
      pool = open.length ? open : (known || []);
    } else {
      open = [];
      pool = known || [];
    }
  }

  if (pool.length) {
    const pick = bestOption(pool, value, 0.55, ruleId);
    const rendered = pick?.el && (pick.el.offsetParent !== null || pick.el.getClientRects().length);

    if (rendered) {
      pick.el.scrollIntoView({ block: "nearest" });
      realClick(pick.el);
      fire(el, "change");
      return true;
    }

    // The right option exists but is not on screen — a listbox held hidden, a
    // <datalist>. There is nothing to click, but its wording is what the widget
    // matches against, so type that instead of ours.
    if (pick && typeable) {
      setValue(el, pick.label || pick.value);
      fireInput(el);
      key(el, "ArrowDown");
      key(el, "Enter");
      fire(el, "change");
      return true;
    }

    if (!pick) {
      if (acceptsFreeText(el)) {
        fire(el, "change");
        return true;
      }
      // We can see everything this control offers and none of it is the answer.
      // Leave it as we found it and report the miss, so the panel counts it as
      // still needing a human rather than claiming it is done.
      if (typeable) untype(el, before);
      key(el, "Escape");
      return false;
    }
  }

  // Nothing readable — a virtualised or lazily-loaded list with no clickable
  // node. Commit through the keyboard, which is how those widgets take a choice,
  // and believe it only if the menu we opened actually closed on a value, or the
  // widget rewrote our text into its own. Anything else and the "value" here is
  // just the characters we typed, sitting in a control that never accepted them.
  if (typeable) {
    key(el, "ArrowDown");
    key(el, "Enter");
    fire(el, "change");

    const now = String(el.value ?? el.textContent ?? "").trim();
    const closed = (listbox && (!listbox.isConnected || !listbox.getClientRects().length)) ||
                   el.getAttribute("aria-expanded") === "false";
    if ((listbox && now && (closed || now !== String(value).trim())) || acceptsFreeText(el)) {
      return true;
    }
    if (now && now === String(value).trim() && !el.getAttribute("aria-autocomplete")?.includes("list")) {
      return true;
    }

    untype(el, before);
    key(el, "Escape");
    return false;
  }

  key(el, "Escape");
  return false;
}

function findListbox(el) {
  const root = el.getRootNode?.() || document;
  const controls = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
  if (controls) {
    for (const id of String(controls).trim().split(/\s+/)) {
      if (!id) continue;
      const byId = root.getElementById?.(id) || document.getElementById?.(id);
      if (byId && byId !== el && byId.getClientRects().length) return byId;
    }
  }
  const active = el.getAttribute("aria-activedescendant");
  if (active) {
    const node = root.getElementById?.(active) || document.getElementById?.(active);
    const lb = node?.closest('[role="listbox"],ul,[role="menu"]');
    if (lb && lb !== el) return lb;
  }
  // Any listbox currently on screen in either shadow root or document.
  const scopes = root !== document && root.querySelectorAll ? [root, document] : [document];
  for (const s of scopes) {
    if (!s?.querySelectorAll) continue;
    // Check for popup overlays that are specifically designed for dropdowns
    for (const lb of s.querySelectorAll('.exportSelectPopup, [class*="SelectPopup" i], [class*="paperselectPopup" i], .select__menu, [data-automation-id="promptOptions"]')) {
      if (lb !== el && !lb.contains(el) && lb.getClientRects().length) return lb;
    }
    // Check for any visible [role="option"] on screen that is NOT inside el itself
    const visibleOpts = Array.from(s.querySelectorAll('[role="option"]')).filter(
      (opt) => opt.getClientRects().length && opt !== el && !el.contains(opt)
    );
    if (visibleOpts.length) {
      const container = visibleOpts[0].closest('[role="listbox"],[role="menu"],.exportSelectPopup,[class*="SelectPopup" i]') || visibleOpts[0].parentElement;
      if (container && container !== el) return container;
    }
    // General listbox/menu on screen, excluding el itself and non-popup triggers
    for (const lb of s.querySelectorAll('[role="listbox"],[role="menu"]')) {
      if (lb !== el && !lb.contains(el) && lb.getClientRects().length) {
        if (lb.querySelector('[role="option"],li,[data-automation-id="promptOption"]')) {
          return lb;
        }
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One stored value ("May 2027") into whatever date control the page uses.
 * A native date input demands YYYY-MM-DD and silently rejects anything else,
 * which is why writing the raw string leaves these blank.
 */
function fillDate(el, value, kind) {
  const parts = parseDate(value);
  if (!parts) return fillText(el, value);          // unparseable — pass through

  const hint = el.getAttribute("placeholder") || el.getAttribute("data-format") || "";
  const type = (el.type || "").toLowerCase();

  // The control's own type decides the shape, not the descriptor's. A date rule
  // that lands somewhere the scanner typed as ordinary text still has to look at
  // what it actually landed on: `<input type="number">` is the common one, and
  // "05/2027" written into a graduation-year spinner is refused by the browser
  // and dropped on the floor.
  let out;
  if (type === "month") out = formatDate(parts, "month", "");
  else if (type === "date") out = formatDate(parts, "date", "");
  else if (type === "number" || type === "range") {
    out = numericDatePart(el, parts);
    if (!out) return false;                        // no single number expresses it
  } else {
    out = formatDate(parts, kind === "date" ? "date" : "text", hint);
  }

  const wasFocused = isFocused(el);
  setValue(el, out);
  fireInput(el);
  fire(el, "change");
  commit(el, wasFocused);
  return !!el.value;
}

/**
 * The one number a numeric box wants out of a date.
 *
 * Nearly always the year — "Graduation year", "Year of birth" — but the field
 * says which if you look at it. `min`/`max` are the most reliable statement of
 * it and cost nothing to read: a box capped at 12 is asking for a month however
 * it happens to be labelled.
 */
function numericDatePart(el, parts) {
  const max = Number(el.getAttribute("max"));
  if (Number.isFinite(max) && max > 0) {
    if (max <= 12) return parts.month ? String(parts.month) : "";
    if (max <= 31) return parts.day ? String(parts.day) : "";
  }

  const hay = `${el.getAttribute("aria-label") || ""} ${el.name || ""} ${el.id || ""} ${el.getAttribute("placeholder") || ""}`
    .toLowerCase();
  if (/\b(month|mm)\b/.test(hay)) return parts.month ? String(parts.month) : "";
  if (/\b(day|dd)\b/.test(hay)) return parts.day ? String(parts.day) : "";

  return parts.year ? String(parts.year) : "";
}

/** Split month / day / year controls, filled part by part. */
function fillDateGroup(field, value) {
  const parts = parseDate(value);
  if (!parts) return false;

  let any = false;
  for (const { part, field: sub } of field.parts) {
    const el = sub.el;
    const raw = datePartValue(parts, part);
    if (!raw) continue;

    if (sub.kind === "select") {
      // Month dropdowns are variously "May", "MAY", "05", "5" — offer all three
      // spellings and let the option matcher take whichever scores best.
      const candidates = part === "month"
        ? [monthName(parts.month), monthName(parts.month, "short"), String(parts.month).padStart(2, "0"), raw]
        : [raw, raw.padStart(2, "0")];

      let done = false;
      for (const c of candidates) {
        if (c && fillSelect(el, c, sub.options, null)) { done = true; break; }
      }
      if (done) any = true;
    } else {
      const wasFocused = isFocused(el);
      setValue(el, raw);
      fireInput(el);
      fire(el, "change");
      commit(el, wasFocused);
      any = true;
    }
  }
  return any;
}

/**
 * Inject a file into a real <input type=file> via DataTransfer.
 *
 * `el.files = …` is the only assignment a page cannot distinguish from a real
 * pick, and it is why this works at all: the File constructor gives us a genuine
 * file object, and the input reports it exactly as it would one chosen from the
 * disk dialog.
 */
async function fillFile(el, dataUrl, fileName, valid = () => true) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], fileName || "resume.pdf", {
      type: blob.type || "application/pdf",
      lastModified: Date.now()
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    if (!el.isConnected || !valid() || el.files?.length) return false;
    el.files = dt.files;

    // An input can refuse the assignment (a stale node, a sandboxed frame). If
    // it did, saying "attached" would be a lie the user only discovers when the
    // form rejects their submission.
    if (!el.files || el.files.length === 0) return false;

    fire(el, "input");
    fire(el, "change");

    // Drag-and-drop zones often ignore the change event on the hidden input and
    // listen on their wrapper instead. react-dropzone and its imitators — which
    // is most of them — track the drag as a sequence and read `types` on the
    // way in, so a lone `drop` with no `dragenter`/`dragover` before it is
    // discarded by the very libraries this is here for.
    const zone = el.closest("[class*=drop],[class*=drag],[data-testid*=drop]");
    if (zone && zone !== el) {
      for (const type of ["dragenter", "dragover", "drop"]) {
        zone.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, composed: true, dataTransfer: dt
        }));
      }
    }
    return true;
  } catch (err) {
    console.warn("Apply karo: file injection failed —", err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fill one descriptor. Returns true if the value landed.
 *
 * Synchronous for every ordinary control; only comboboxes await, which is why
 * the orchestrator can fill an entire form in one frame and then handle the few
 * async widgets separately.
 */
function dispatchFill(field, v, ruleId, isDateRule) {
  const { el, kind } = field;

  // A role-based text control has no `.value`; the native setter would throw or
  // silently no-op. contenteditable is the only way text goes in.
  if (kind === "text" && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
    return fillContentEditable(el, v);
  }

  switch (kind) {
    case "select":        return el.ownerDocument ? null : fillSelect(el, v, field.options, ruleId);
    case "radiogroup":
    case "checkboxgroup": return fillChoiceGroup(el, v, field.options, ruleId);
    case "checkbox":      return fillCheckbox(el, v);
    case "switch":        return fillSwitch(el, v);
    case "dategroup":     return fillDateGroup(field, v);
    case "date":          return fillDate(el, v, "date");
    case "textarea":      return el.isContentEditable ? fillContentEditable(el, v) : fillText(el, v);
    case "combobox":      return null;   // needs the async path
    case "file":          return null;   // needs the async path
    // A date rule landing on a plain text box still needs formatting: the site
    // may want MM/YYYY where the profile stores "May 2027".
    default:              return isDateRule ? fillDate(el, v, "text") : fillText(el, v);
  }
}

/**
 * Fill one field. Returns true (done), false (couldn't), or null (needs the
 * async path).
 *
 * Never throws. A page can hand us a control that behaves in ways no amount of
 * feature-detection anticipates; when that happens the right outcome is one
 * skipped field, not an aborted form. Before this guard a single throw left
 * every later field untouched, which reads as "it filled nothing at all".
 */
function fillSync(field, value, ruleId = null) {
  const isDateRule = ruleId ? !!RULE_BY_ID.get(ruleId)?.isDate : false;
  try {
    if ((field.kind === "checkboxgroup" || field.kind === "select" && field.el.multiple) && Array.isArray(value)) {
      const picks=value.map(v=>rankChoices(field.options || [],v,ruleId).choice);
      if(picks.some(p=>!p))return false;
      for(const option of field.options || []) {
        const want=picks.some(p=>p.el===option.el);
        if(field.kind==="select")option.el.selected=want;
        else if(isChecked(option.el)!==want)realClick(option.el);
      }
      fire(field.el,"input");fire(field.el,"change");commit(field.el,isFocused(field.el));return true;
    }
    return dispatchFill(field, String(value), ruleId, isDateRule);
  } catch (err) {
    console.warn(`Apply karo: skipped "${field.rawLabel || field.name || field.kind}" —`, err.message);
    return false;
  }
}

async function fillAsync(field, value, ruleId = null) {
  try {
    if (field.kind === "select") {
      if (field.rawLabel && labelOf(field.el) !== field.rawLabel) { field.controlOutcome = { status: "unresolved", reason: "question_changed" }; return false; }
      const ranked = rankChoices(field.options || [], value, ruleId);
      if (!ranked.choice) { field.controlOutcome = { status: ranked.ambiguous ? "ambiguous" : "unresolved", reason: "no_supported_option", choices: ranked.candidates.map((o) => o.label) }; return false; }
      const pick = ranked.choice, el = field.el;
      if (!fillSelect(el, pick.value, [pick], ruleId)) return false;
      await new Promise((r) => setTimeout(r, 300));
      const accepted = el.isConnected && el.value === pick.value && el.getAttribute("aria-invalid") !== "true";
      field.controlOutcome = { status: accepted ? "verified" : "rejected", reason: accepted ? "selected_value" : "selection_not_persistent" };
      return accepted;
    }
    if (field.kind === "combobox") return await fillCombobox(field, Array.isArray(value) ? value : String(value), ruleId);
  } catch (err) {
    console.warn(`Apply karo: skipped "${field.rawLabel || field.name}" —`, err.message);
  }
  return false;
}

const labelOfControl = labelOf;

Object.assign(__x, { isExtensionAction, setValue, fire, realClick, isFocused, commit, key, optionScore, matchOption, fillCombobox, fillFile, fillSync, fillAsync, labelOfControl });
};

__m["src/shared/values.js"] = (__x, __req) => {
// Apply karo — value vocabulary bridging.
//
// The same question appears as a text box on one site and a dropdown on the
// next. Adapting the *control* is easy (see fill.js). The harder half is that a
// dropdown does not accept your words — it accepts its own.
//
// Your profile says "B.Tech". Greenhouse offers "Bachelor's Degree". Workday
// offers "Bachelor of Technology". Lever asks the same thing as free text, where
// "B.Tech" is exactly right. Plain string similarity scores "B.Tech" against
// "Bachelor's Degree" at roughly zero, so the dropdown silently stays empty.
//
// This module maps both sides onto a canonical class so they can meet in the
// middle, and understands the numeric ranges that experience dropdowns use.

// ─────────────────────────────────────────────────────────────────────────────
// Yes / no
//
// Negatives are tested first and must be, because application forms phrase
// refusals as "I do not require sponsorship" — which starts with "I do" and
// would otherwise read as agreement.
// ─────────────────────────────────────────────────────────────────────────────

const NO_RE = /^(no\b|n\b|false|nope|i am not|i'm not|i do not|i don'?t|i have not|i haven'?t|i will not|i disagree|i decline|not\b|never|decline|disagree|neither|unchecked)/i;

// Agreement phrasings belong here, not just in the option matcher. A required
// "I certify the information above is accurate" checkbox is answered with the
// word "agree" or "accept" far more often than with "yes", and every one of
// those used to read as *unrecognised* — which meant the box was left unticked
// and the form was rejected on submit for a reason nothing on screen explained.
const YES_RE = /^(yes\b|y\b|true|yep|yeah|ok\b|okay\b|i am\b|i'm\b|i do\b|i have\b|i will\b|i can\b|i agree|i accept|i consent|i certify|i acknowledg|i confirm|i understand|i authoriz|agree|accept|consent|certif|acknowledg|confirm|authoriz|eligible|legally|checked)/i;

function asBool(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (NO_RE.test(t)) return false;
  if (YES_RE.test(t)) return true;
  if (/^1$/.test(t)) return true;
  if (/^0$/.test(t)) return false;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical classes
// ─────────────────────────────────────────────────────────────────────────────

const CLASSES = {
  degree: {
    doctorate: ["phd", "ph d", "doctor", "doctorate", "doctoral", "dphil"],
    master: ["master", "masters", "m tech", "mtech", "m s", "ms", "msc", "m sc", "mba", "m e", "me", "mca", "postgraduate", "post graduate", "pg"],
    bachelor: ["bachelor", "bachelors", "b tech", "btech", "b e", "be", "b s", "bs", "bsc", "b sc", "b a", "ba", "bca", "bba", "undergraduate", "under graduate", "ug", "engineering degree"],
    associate: ["associate", "diploma", "a s", "a a"],
    highschool: ["high school", "secondary", "hsc", "12th", "ged", "matriculation"]
  },
  gender: {
    male: ["male", "man", "m"],
    female: ["female", "woman", "f"],
    nonbinary: ["non binary", "nonbinary", "genderqueer", "other"],
    // Apostrophes are stripped by norm(), so "I don't wish to answer" arrives as
    // "i don t wish to answer" — the opt-out phrasings must be listed post-norm.
    declined: ["decline", "prefer not", "not disclose", "not wish", "do not wish",
               "don t wish", "dont wish", "wish to answer", "not answer", "choose not"]
  },
  veteranStatus: {
    no: ["not a protected veteran", "not a veteran", "i am not a", "no"],
    yes: ["identify as one or more", "i am a", "protected veteran", "yes"],
    declined: ["decline", "prefer not", "not wish", "choose not"]
  },
  disabilityStatus: {
    no: ["no, i do not", "do not have", "no"],
    yes: ["yes, i have", "i have a disability", "yes"],
    declined: ["decline", "prefer not", "not wish", "do not want"]
  },
  visaStatus: {
    citizen: ["citizen", "permanent resident", "green card", "national"],
    authorized: ["authorized", "authorised", "work permit", "opt", "cpt", "h1b", "ead", "no sponsorship"],
    sponsorship: ["require sponsorship", "need sponsorship", "will require", "sponsorship required"]
  },
  authorizedToWork: {
    yes: ["yes", "i am authorized", "legally authorized", "authorized to work", "eligible to work", "have the legal right", "citizen", "permanent resident", "no sponsorship required"],
    no: ["no", "not authorized", "not eligible", "cannot work", "require sponsorship"]
  },
  sponsorship: {
    no: ["no", "do not require", "will not require", "no sponsorship", "do not need", "not now or in the future"],
    yes: ["yes", "require sponsorship", "will require", "need sponsorship", "require visa sponsorship", "sponsorship now or in the future"]
  },
  willingToRelocate: {
    yes: ["yes", "willing", "open to relocation", "relocate", "willing to relocate"],
    no: ["no", "not willing", "cannot relocate", "no relocation"]
  },
  legalAge: {
    yes: ["yes", "18 or older", "over 18", "at least 18", "legal age to work", "18 years of age or older"],
    no: ["no", "under 18", "not 18"]
  },
  formerEmployee: {
    no: ["no", "never", "not previously employed", "have not worked here"],
    yes: ["yes", "previously employed", "former employee", "have worked here"]
  },
  relativeEmployed: {
    no: ["no", "none", "no relatives"],
    yes: ["yes", "relative employed", "have relatives"]
  },
  phoneType: {
    mobile: ["mobile", "cell", "cellular", "smart phone", "cell phone"],
    home: ["home", "landline", "residential"],
    work: ["work", "office", "business"]
  },
  workLocationPreference: {
    remote: ["remote", "work from home", "wfh", "virtual", "telecommute"],
    hybrid: ["hybrid", "flexible", "partially remote"],
    onsite: ["onsite", "on site", "in office", "office", "in person", "workplace"]
  },
  pronouns: {
    he: ["he him", "he him his", "he/him", "he/him/his"],
    she: ["she her", "she her hers", "she/her", "she/her/hers"],
    they: ["they them", "they them theirs", "they/them", "they/them/theirs"],
    declined: ["prefer not", "decline", "do not wish", "choose not"]
  },
  salutation: {
    mr: ["mr", "mr.", "mister"],
    ms: ["ms", "ms.", "miss"],
    mrs: ["mrs", "mrs."],
    dr: ["dr", "dr.", "doctor"],
    mx: ["mx", "mx."]
  },
  noticePeriod: {
    immediate: ["immediately", "immediate", "none", "0", "0 days", "available immediately", "no notice"],
    twoWeeks: ["2 weeks", "two weeks", "14 days", "2 to 4 weeks"],
    oneMonth: ["1 month", "one month", "30 days", "4 weeks", "1 to 2 months"],
    twoMonths: ["2 months", "two months", "60 days", "8 weeks"],
    threeMonths: ["3 months", "three months", "90 days", "3+ months", "more than 2 months"]
  },
  consent: {
    yes: ["yes", "i agree", "agree", "i accept", "accept", "i consent", "consent", "i certify", "certify", "i acknowledge", "acknowledge", "i understand", "i confirm"],
    no: ["no", "disagree", "decline", "do not consent"]
  },
  backgroundCheck: {
    yes: ["yes", "willing", "consent", "i agree", "agree", "willing to undergo"],
    no: ["no", "unwilling", "not willing", "decline"]
  },
  travelPreference: {
    yes: ["yes", "willing", "open to travel", "willing to travel"],
    no: ["no", "not willing", "cannot travel", "no travel"]
  },
  driversLicense: {
    yes: ["yes", "valid driver's license", "have license", "licensed"],
    no: ["no", "no license", "do not have"]
  },
  securityClearance: {
    no: ["no", "none", "no clearance", "do not possess"],
    yes: ["yes", "active clearance", "secret", "top secret", "ts/sci", "confidential"]
  },
  nonCompete: {
    no: ["no", "not bound", "none", "i am not subject", "not subject", "i do not have", "no, i am not", "not applicable"],
    yes: ["yes", "subject to", "i am bound", "have a non compete", "yes, i am"]
  },
  reliableTransportation: {
    yes: ["yes", "i do", "reliable transportation", "have transportation", "yes, i have", "access to reliable"],
    no: ["no", "i do not", "no transportation", "no, i do not"]
  },
  governmentOfficial: {
    no: ["no", "neither", "not a government official", "none", "i am not", "no, i am not"],
    yes: ["yes", "i am a government official", "yes, i am"]
  },
  hispanicLatino: {
    yes: ["yes", "hispanic", "latino", "hispanic or latino", "yes, hispanic or latino", "yes, i am hispanic or latino"],
    no: ["no", "not hispanic", "not latino", "not hispanic or latino", "no, not hispanic or latino", "no, i am not hispanic or latino"],
    declined: ["decline", "prefer not", "do not wish", "choose not to answer"]
  },
  race: {
    hispanic: ["hispanic", "latino", "latina", "chicano", "spanish origin"],
    asian: ["asian", "asian american", "indian", "chinese", "filipino", "japanese", "korean", "vietnamese"],
    black: ["black", "african american"],
    white: ["white", "caucasian", "european"],
    native: ["american indian", "alaska native", "indigenous", "native american"],
    pacific: ["native hawaiian", "pacific islander"],
    twoOrMore: ["two or more", "multiracial", "two or more races"],
    declined: ["decline", "prefer not", "do not wish", "choose not"]
  },
  employmentType: {
    fulltime: ["full time", "full-time", "regular", "permanent", "direct hire"],
    parttime: ["part time", "part-time"],
    contract: ["contract", "contractor", "temporary", "temp", "consultant", "c2c", "w2"],
    internship: ["intern", "internship", "co-op", "trainee", "student"]
  },
  currentJob: {
    yes: ["yes", "current", "currently work here", "present", "i currently work here", "yes, current employer"],
    no: ["no", "former", "past", "no longer work here", "not current", "no, past employer"]
  },
  criminalRecord: {
    no: ["no", "never", "no criminal record", "have not been convicted", "no felonies", "i have never been convicted"],
    yes: ["yes", "have been convicted", "yes, i have a criminal record", "felony conviction"]
  }
};

const norm = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Map a phrase onto a canonical class for the given rule, or null.
 * Longer keywords are tested first so "master" cannot be claimed by a stray
 * substring of a longer, more specific term.
 */
function classify(ruleId, text) {
  const table = CLASSES[ruleId];
  if (!table) return null;
  const t = norm(text);
  if (!t) return null;

  let best = null;
  let bestLen = 0;
  for (const [cls, keywords] of Object.entries(table)) {
    for (const kw of keywords) {
      const k = norm(kw);
      if (!k || k.length <= bestLen) continue;
      // Word-boundary containment, so "be" does not match "before".
      if (t === k || t.startsWith(k + " ") || t.endsWith(" " + k) || t.includes(" " + k + " ")) {
        best = cls;
        bestLen = k.length;
      }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Numeric ranges
//
// Experience dropdowns are almost always buckets: "0-2 years", "3-5 years",
// "Less than 1 year", "10+ years". A stored value of "2" has to land in the
// right bucket, which string similarity cannot do.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Does the option text describe a range containing `n`?
 *
 * Note this deliberately does NOT use norm(): the range syntax lives entirely in
 * the punctuation. Stripping it turns "3-5 years" into "3 5 years" and "10+
 * years" into "10 years", so every bucket silently collapses to an exact match.
 */
function rangeContains(optionText, n) {
  const t = String(optionText || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || !Number.isFinite(n)) return false;

  const between = t.match(/(\d+)\s*(?:to|-|–|—)\s*(\d+)/);
  if (between) return n >= +between[1] && n <= +between[2];

  const plus = t.match(/(\d+)\s*(?:\+|or more|and above|and over|or greater)/);
  if (plus) return n >= +plus[1];

  const under = t.match(/(?:less than|under|fewer than|below)\s*(\d+)/);
  if (under) return n < +under[1];

  const exact = t.match(/^(\d+)\s*(?:years?|yrs?)?$/);
  if (exact) return n === +exact[1];

  if (/^(none|no experience|fresher|entry level)$/.test(t)) return n === 0;
  return false;
}

/** First number in a string, or null. */
function numberIn(text) {
  const m = String(text || "").match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/**
 * Bonus similarity for an option, on top of plain text matching.
 * Returns 0..1, or 0 when this module has nothing to add.
 */
function semanticScore(ruleId, optionLabel, optionValue, target) {
  // 1. Canonical class agreement — the "B.Tech" vs "Bachelor's Degree" case.
  if (ruleId) {
    const wantClass = classify(ruleId, target);
    if (wantClass) {
      if (classify(ruleId, optionLabel) === wantClass) return 0.95;
      if (optionValue && classify(ruleId, optionValue) === wantClass) return 0.93;
    }
  } else {
    // Try matching across all classes when ruleId is unknown (e.g. from AI)
    for (const rId of Object.keys(CLASSES)) {
      const wantClass = classify(rId, target);
      if (wantClass) {
        if (classify(rId, optionLabel) === wantClass) return 0.95;
        if (optionValue && classify(rId, optionValue) === wantClass) return 0.93;
      }
    }
  }

  // 2. Yes/no agreement, however verbosely the option phrases it.
  const wantBool = asBool(target);
  if (wantBool !== null) {
    const gotBool = asBool(optionLabel) ?? (optionValue ? asBool(optionValue) : null);
    if (gotBool !== null) return gotBool === wantBool ? 0.94 : 0;
  }

  // 3. Numeric bucketing for experience-style dropdowns.
  if (ruleId === "yearsOfExperience" || (!ruleId && rangeContains(optionLabel, numberIn(target) ?? -1))) {
    const n = numberIn(target);
    if (n !== null && rangeContains(optionLabel, n)) return 0.92;
  }

  // 4. Dialling-code dropdowns render the same code half a dozen ways:
  //    "+91", "91", "India (+91)", "IN +91". Compare digits, not text.
  if (ruleId === "phoneCountryCode" || (!ruleId && /^\+?\d{1,4}$/.test(String(target).trim()))) {
    const want = String(target).replace(/\D/g, "");
    if (want && want.length <= 4) {
      for (const src of [optionValue, optionLabel]) {
        if (!src) continue;
        const codes = String(src).match(/\+\s*(\d{1,4})/) || String(src).match(/^\s*(\d{1,4})\s*$/);
        if (codes && codes[1] === want) return 0.96;
      }
    }
  }

  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone numbers
// ─────────────────────────────────────────────────────────────────────────────

// Enough of the ITU list to disambiguate a code that is not followed by a
// separator. Ordered longest-first so "+441" cannot be read as "+4".
const DIAL_CODES = [
  "1", "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44",
  "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61",
  "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95",
  "98", "212", "213", "216", "218", "220", "233", "234", "251", "254", "255", "256", "260",
  "263", "351", "352", "353", "354", "355", "358", "359", "370", "371", "372", "380", "381",
  "385", "386", "420", "421", "852", "853", "855", "856", "880", "886", "962", "963", "964",
  "965", "966", "968", "970", "971", "972", "973", "974", "975", "976", "977", "994", "995", "998"
].sort((a, b) => b.length - a.length);

/**
 * Split "+91 9996007259" into its dialling code and national number.
 *
 * A separator after the code makes this unambiguous; without one, fall back to
 * the ITU prefix list, because "+123456..." could be +1, +12 or +123.
 */
function splitPhone(raw) {
  const t = String(raw || "").trim();
  if (!t) return { code: "", national: "" };

  const sep = t.match(/^\+\s*(\d{1,4})[\s\-.()]+(.*)$/);
  if (sep) return { code: `+${sep[1]}`, national: sep[2].replace(/\D/g, "") };

  const plain = t.match(/^\+\s*(\d+)$/);
  if (plain) {
    const digits = plain[1];
    for (const code of DIAL_CODES) {
      if (digits.startsWith(code) && digits.length > code.length) {
        return { code: `+${code}`, national: digits.slice(code.length) };
      }
    }
    return { code: "", national: digits };
  }

  return { code: "", national: t.replace(/\D/g, "") };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["january","february","march","april","may","june",
                     "july","august","september","october","november","december"];
const MONTH_INDEX = {};
MONTH_NAMES.forEach((m, i) => { MONTH_INDEX[m.slice(0, 3)] = i + 1; });

/** "May 2027", "2027-05", "05/2027", "2027" → { year, month, day }. */
function parseDate(text) {
  const t = String(text || "").trim();
  if (!t || /^(present|current|ongoing|now)$/i.test(t)) return null;

  let m = t.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
  if (m) return { year: +m[1], month: +m[2], day: m[3] ? +m[3] : null };

  // Day-first must be tried before bare month-year: "12 June 2025" also
  // contains "June 2025", so the looser pattern would swallow it and drop the 12.
  m = t.match(/^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i);
  if (m) {
    const mo = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
    if (mo) return { year: +m[3], month: mo, day: +m[1] };
  }

  m = t.match(/([a-z]{3,9})\.?,?\s+(\d{1,2})?,?\s*(\d{4})/i);
  if (m) {
    const mo = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
    if (mo) return { year: +m[3], month: mo, day: m[2] ? +m[2] : null };
  }

  // Ambiguous slash forms. Treat a value > 12 in the first slot as a day.
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    let year = +m[3];
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return a > 12 ? { year, month: b, day: a } : { year, month: a, day: b };
  }

  m = t.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) return { year: +m[2], month: +m[1], day: null };

  m = t.match(/\b(19|20)(\d{2})\b/);
  if (m) return { year: +(m[1] + m[2]), month: null, day: null };

  return null;
}

const pad = (n) => String(n).padStart(2, "0");

function monthName(n, style = "long") {
  const name = MONTH_NAMES[n - 1];
  if (!name) return "";
  const cap = name[0].toUpperCase() + name.slice(1);
  return style === "short" ? cap.slice(0, 3) : cap;
}

/**
 * Render a parsed date for a specific control.
 * `hint` is a placeholder or format attribute when the page offers one.
 */
function formatDate(parts, kind, hint = "") {
  if (!parts) return "";
  const { year, month, day } = parts;

  if (kind === "date") return `${year}-${pad(month || 1)}-${pad(day || 1)}`;
  if (kind === "month") return `${year}-${pad(month || 1)}`;

  const h = String(hint).toLowerCase();
  if (/yyyy[-/]mm[-/]dd/.test(h)) return `${year}-${pad(month || 1)}-${pad(day || 1)}`;
  if (/dd[-/]mm[-/]yyyy/.test(h)) return `${pad(day || 1)}/${pad(month || 1)}/${year}`;
  if (/mm[-/]dd[-/]yyyy/.test(h)) return `${pad(month || 1)}/${pad(day || 1)}/${year}`;
  if (/mm[-/]yyyy/.test(h)) return `${pad(month || 1)}/${year}`;
  if (/^yyyy$/.test(h.trim())) return String(year);

  if (month && day) return `${pad(month)}/${pad(day)}/${year}`;
  if (month) return `${pad(month)}/${year}`;
  return String(year);
}

/** Value for one part of a split month/day/year control. */
function datePartValue(parts, part) {
  if (!parts) return "";
  if (part === "year") return parts.year ? String(parts.year) : "";
  if (part === "day") return parts.day ? String(parts.day) : "1";
  if (part === "month") return parts.month ? String(parts.month) : "";
  return "";
}

/** Parse a timeframe like "Jan 2022 - Present" or "2020 - 2023" into start and end parts. */
function parseTimeframe(text) {
  const t = String(text || "").trim();
  if (!t) return { start: null, end: null };
  const parts = t.split(/\s*(?:[-–—]|\bto\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { start: parts[0], end: parts[1] };
  }
  if (parts.length === 1) {
    return { start: parts[0], end: null };
  }
  return { start: null, end: null };
}

Object.assign(__x, { asBool, classify, rangeContains, numberIn, semanticScore, splitPhone, parseDate, monthName, formatDate, datePartValue, parseTimeframe });
};

__m["src/shared/rules.js"] = (__x, __req) => {
const { canonicalQuestion, contextualKey } = __req("src/shared/field-identity.js");
// Apply karo — field definitions and the scoring matcher.
//
// v1 matched with `label.includes(keyword)` and took the first rule that hit,
// locking that rule out for the rest of the form. One bad early guess therefore
// blocked the field that actually deserved it — the single biggest source of
// "it didn't detect my fields".
//
// Here every (field, rule) pair gets a score from several independent signals,
// and assignment happens globally: best pairs claim their slots first. A generic
// rule can no longer steal a field from a specific one, because the specific
// rule simply scores higher on it.

// ─────────────────────────────────────────────────────────────────────────────
// Signal weights
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  ATS: 98,          // known ATS attribute — as close to certain as it gets
  AUTOCOMPLETE: 96, // the spec-defined token; browsers rely on it, so should we
  NAME_EXACT: 88,   // name/id tokens are exactly the rule's pattern
  LABEL_EXACT: 84,
  NAME_SEQ: 70,     // rule's pattern appears as a contiguous token run
  INPUT_TYPE: 62,   // type="email" / type="tel"
  LABEL_PHRASE: 36, // + specificity bonus, see scoreLabel()
  PLACEHOLDER: 30,
  SECTION_BONUS: 12,
  SECTION_PENALTY: -28
};

const MIN_SCORE = 36;

// ─────────────────────────────────────────────────────────────────────────────
// Field rules
// ─────────────────────────────────────────────────────────────────────────────
// autocomplete : standard tokens (https://html.spec.whatwg.org/#autofill)
// names        : token sequences matched against tokenized name/id
// keywords     : phrases matched against the visible label
// negatives    : any hit here disqualifies the rule for that field outright
// section      : "education" | "experience" — boosts/penalises by context
// multi        : rule may claim more than one field (e.g. two email boxes)

const RULES = [
  // ─── Name ───
  {
    id: "firstName",
    autocomplete: ["given-name"],
    names: [["first", "name"], ["fname"], ["given", "name"], ["forename"], ["first"]],
    keywords: ["first name", "given name", "forename", "legal first name"],
    negatives: ["last", "middle", "family", "surname", "company", "school", "reference"],
    path: "personal.firstName",
    fallback: (p) => (p.personal?.fullName || "").trim().split(/\s+/)[0] || null
  },
  {
    id: "lastName",
    autocomplete: ["family-name"],
    names: [["last", "name"], ["lname"], ["family", "name"], ["surname"], ["last"]],
    keywords: ["last name", "family name", "surname", "legal last name"],
    negatives: ["first", "given", "middle", "company", "school", "reference"],
    path: "personal.lastName",
    fallback: (p) => {
      const parts = (p.personal?.fullName || "").trim().split(/\s+/);
      return parts.length > 1 ? parts.slice(1).join(" ") : null;
    }
  },
  {
    id: "middleName",
    autocomplete: ["additional-name"],
    names: [["middle", "name"], ["mname"], ["middle", "initial"]],
    keywords: ["middle name", "middle initial"],
    path: "personal.middleName"
  },
  {
    id: "preferredName",
    names: [["preferred", "name"], ["nickname"], ["chosen", "name"], ["preferred", "first", "name"]],
    keywords: ["preferred name", "chosen name", "nickname", "preferred first name", "goes by"],
    negatives: ["legal first name", "last name", "surname"],
    path: "personal.preferredName",
    fallback: (p) => p.personal?.firstName || null
  },
  {
    id: "fullName",
    autocomplete: ["name"],
    names: [["full", "name"], ["name"], ["candidate", "name"], ["applicant", "name"], ["legal", "name"]],
    keywords: ["full name", "your name", "legal name", "candidate name", "applicant name", "name"],
    negatives: [
      "first", "last", "middle", "user", "company", "employer", "school",
      "university", "reference", "organization", "business", "file", "job",
      "position", "title", "manager", "supervisor", "contact name"
    ],
    path: "personal.fullName",
    fallback: (p) => {
      const n = `${p.personal?.firstName || ""} ${p.personal?.lastName || ""}`.trim();
      return n || null;
    }
  },

  // ─── Contact ───
  {
    id: "email",
    autocomplete: ["email"],
    names: [["email"], ["e", "mail"], ["email", "address"]],
    keywords: ["email", "e-mail", "email address"],
    negatives: ["confirm", "verify", "re-enter", "reference", "manager", "supervisor"],
    inputType: "email",
    path: "personal.email",
    multi: true
  },
  {
    id: "emailConfirm",
    names: [["confirm", "email"], ["email", "confirm"], ["email", "confirmation"], ["re", "enter", "email"]],
    keywords: ["confirm email", "re-enter email", "verify email", "email confirmation", "confirm your email"],
    path: "personal.email"
  },
  {
    id: "phone",
    autocomplete: ["tel", "tel-national"],
    names: [["phone"], ["mobile"], ["telephone"], ["tel"], ["phone", "number"], ["cell"]],
    keywords: ["phone", "mobile", "telephone", "cell", "phone number", "contact number"],
    negatives: ["country code", "dial code", "extension", "ext", "reference", "emergency", "type"],
    inputType: "tel",
    path: "personal.phone",
    multi: true
  },
  {
    id: "phoneCountryCode",
    autocomplete: ["tel-country-code"],
    names: [["country", "code"], ["dial", "code"], ["phone", "code"], ["isd", "code"], ["tel", "country", "code"]],
    keywords: ["country code", "dialing code", "dialling code", "dial code", "isd code", "phone code"],
    negatives: ["country of", "country/region", "citizenship"],
    // Derived from personal.phone at fill time — see splitPhone().
    path: "personal.phoneCountryCode",
    multi: true
  },

  // ─── Links ───
  {
    id: "linkedin",
    names: [["linkedin"], ["linkedin", "url"], ["urls", "linkedin"], ["linked", "in"]],
    keywords: ["linkedin", "linkedin profile", "linkedin url"],
    path: "personal.linkedin",
    multi: true
  },
  {
    id: "github",
    names: [["github"], ["github", "url"], ["urls", "github"], ["git", "hub"]],
    keywords: ["github", "github profile", "github url"],
    path: "personal.github",
    multi: true
  },
  {
    id: "website",
    autocomplete: ["url"],
    names: [["website"], ["portfolio"], ["personal", "website"], ["urls", "portfolio"], ["blog"], ["url"]],
    keywords: ["portfolio", "website", "personal website", "personal site", "blog", "web page", "other url"],
    negatives: ["company", "employer", "linkedin", "github", "school", "university"],
    path: "personal.website",
    fallback: (p) => p.personal?.portfolio || null,
    multi: true
  },

  // ─── Address ───
  {
    id: "addressLine1",
    autocomplete: ["address-line1", "street-address"],
    names: [["address"], ["address", "line", "1"], ["street"], ["street", "address"], ["addressline1"]],
    keywords: ["address", "street address", "address line 1", "home address"],
    negatives: ["email", "e-mail", "ip", "web", "url", "line 2", "company", "employer"],
    path: "personal.address"
  },
  {
    id: "addressLine2",
    autocomplete: ["address-line2"],
    names: [["address", "line", "2"], ["address", "2"], ["apt"], ["suite"], ["unit"], ["building"], ["addressline2"]],
    keywords: ["address line 2", "address 2", "apt", "suite", "unit", "building", "apartment"],
    negatives: ["address line 1", "street address"],
    path: "personal.addressLine2",
    fallback: (p) => p.customFields?.addressLine2 || null
  },
  {
    id: "city",
    autocomplete: ["address-level2"],
    names: [["city"], ["town"], ["address", "city"], ["locality"]],
    keywords: ["city", "town", "city/town"],
    negatives: ["company", "employer", "school", "university"],
    path: "personal.city",
    fallback: (p) => (p.personal?.location || "").split(",")[0].trim() || null
  },
  {
    id: "state",
    autocomplete: ["address-level1"],
    names: [["state"], ["province"], ["region"], ["state", "province"]],
    keywords: ["state", "province", "region", "state/province"],
    negatives: ["united states", "employer", "school"],
    path: "personal.state"
  },
  {
    id: "postalCode",
    autocomplete: ["postal-code"],
    names: [["zip"], ["postal", "code"], ["zipcode"], ["postcode"], ["postal"]],
    keywords: ["zip", "postal code", "zip code", "postcode"],
    path: "personal.postalCode"
  },
  {
    id: "country",
    autocomplete: ["country", "country-name"],
    names: [["country"], ["country", "region"], ["nation"]],
    keywords: ["country", "country/region", "nationality"],
    negatives: ["code", "phone"],
    path: "personal.country"
  },
  {
    id: "location",
    names: [["location"], ["current", "location"], ["residence"], ["based"]],
    keywords: ["location", "current location", "where are you located", "where are you based", "current city"],
    negatives: ["company", "employer", "school", "university", "job", "office", "preferred", "willing"],
    path: "personal.location"
  },

  // ─── Work authorization ───
  {
    id: "authorizedToWork",
    names: [["work", "authorization"], ["authorized"], ["eligibility"], ["legal", "right"], ["work", "auth"]],
    keywords: [
      "authorized to work", "work authorization", "legally authorized", "eligible to work",
      "legal right to work", "employment eligibility", "right to work", "authorised to work",
      "are you legally authorized", "are you authorized", "work authorization status"
    ],
    path: "personal.authorizedToWork",
    multi: true
  },
  {
    id: "sponsorship",
    names: [["sponsorship"], ["visa", "sponsorship"], ["require", "sponsorship"], ["need", "sponsorship"]],
    keywords: [
      "sponsorship", "visa sponsorship", "require sponsorship", "need sponsorship",
      "immigration sponsorship", "will you now or in the future require",
      "require visa sponsorship", "visa sponsorship requirement", "do you require sponsorship"
    ],
    path: "personal.sponsorshipRequired",
    multi: true
  },
  {
    id: "visaStatus",
    names: [["visa", "status"], ["immigration", "status"], ["citizenship", "status"], ["work", "permit"]],
    keywords: ["visa status", "immigration status", "citizenship status", "work permit", "employment authorization"],
    path: "personal.visaStatus",
    multi: true
  },

  // ─── Education ───
  {
    id: "university",
    names: [["school"], ["university"], ["college"], ["institution"], ["school", "name"]],
    keywords: ["university", "school", "college", "institution", "school name", "university name", "alma mater"],
    negatives: ["high school", "secondary", "company", "employer"],
    section: "education",
    path: "education[0].school"
  },
  {
    id: "degree",
    names: [["degree"], ["degree", "type"], ["education", "level"], ["qualification"]],
    keywords: [
      "degree", "degree type", "level of education", "education level", "highest degree",
      "highest level of education", "degree level", "qualification"
    ],
    section: "education",
    path: "education[0].degree"
  },
  {
    id: "fieldOfStudy",
    names: [["major"], ["field", "of", "study"], ["discipline"], ["specialization"], ["specialisation"], ["concentration"]],
    keywords: ["major", "field of study", "area of study", "discipline", "concentration", "specialization", "specialisation"],
    section: "education",
    path: "education[0].fieldOfStudy"
  },
  {
    id: "gpa",
    names: [["gpa"], ["cgpa"], ["grade", "point"], ["cumulative", "gpa"]],
    keywords: ["gpa", "grade point", "cgpa", "cumulative gpa", "academic score"],
    section: "education",
    path: "education[0].gpa"
  },
  {
    id: "graduationDate",
    names: [["graduation", "date"], ["graduation", "year"], ["expected", "graduation"], ["completion", "date"], ["end", "date"]],
    keywords: ["graduation date", "expected graduation", "graduation year", "completion date", "end date", "to"],
    negatives: ["work", "job", "employment", "company", "start"],
    section: "education",
    isDate: true,
    path: "education[0].endDate"
  },
  {
    id: "educationStartDate",
    names: [["start", "date"], ["from"], ["attended", "from"]],
    keywords: ["start date", "from", "attended from", "date started"],
    negatives: ["work", "job", "employment", "company", "available", "earliest"],
    section: "education",
    isDate: true,
    path: "education[0].startDate"
  },

  // ─── Experience ───
  {
    id: "company",
    names: [["company"], ["employer"], ["organization"], ["org"], ["company", "name"], ["current", "employer"]],
    keywords: ["company", "employer", "organization", "company name", "current employer", "most recent employer"],
    negatives: ["school", "university", "college", "reference", "why", "about"],
    section: "experience",
    path: "experience[0].company"
  },
  {
    id: "jobTitle",
    names: [["job", "title"], ["title"], ["position"], ["role"], ["designation"], ["current", "title"]],
    keywords: ["job title", "title", "position", "role", "current title", "current position", "designation"],
    negatives: ["degree", "school", "university", "name", "job posting", "applying", "desired", "requisition", "salutation", "prefix", "honorific", "mr", "mrs", "ms"],
    section: "experience",
    indexable: true,
    path: "experience[0].title"
  },
  {
    id: "experienceLocation",
    names: [["company", "location"], ["job", "location"], ["employer", "location"], ["work", "location"]],
    keywords: ["company location", "employer location", "job location", "work location", "office location"],
    negatives: ["school", "university", "college", "home", "current location", "residence"],
    section: "experience",
    indexable: true,
    path: "experience[0].location"
  },
  {
    id: "experienceStartDate",
    names: [["start", "date"], ["from"], ["date", "started"], ["from", "date"], ["start", "month"], ["start", "year"]],
    keywords: ["start date", "from", "date started", "employment start", "start month", "start year"],
    negatives: ["school", "university", "education", "available", "earliest", "notice", "to", "end"],
    section: "experience",
    isDate: true,
    indexable: true,
    path: "experience[0].startDate"
  },
  {
    id: "experienceEndDate",
    names: [["end", "date"], ["to"], ["date", "ended"], ["to", "date"], ["end", "month"], ["end", "year"], ["completion", "date"]],
    keywords: ["end date", "to", "date ended", "employment end", "end month", "end year", "until"],
    negatives: ["school", "university", "education", "graduation", "from", "start"],
    section: "experience",
    isDate: true,
    indexable: true,
    path: "experience[0].endDate"
  },
  {
    id: "currentJob",
    names: [["current"], ["current", "job"], ["currently", "work"], ["present"], ["current", "role"]],
    keywords: [
      "i currently work here", "currently work here", "current employer", "current job",
      "current role", "present employer", "i currently work in this role", "is this your current job"
    ],
    section: "experience",
    indexable: true,
    path: "experience[0].current"
  },
  {
    id: "experienceDescription",
    names: [["description"], ["responsibilities"], ["duties"], ["summary"], ["role", "description"], ["work", "summary"]],
    keywords: [
      "description", "responsibilities", "role description", "summary of duties",
      "work description", "key responsibilities", "duties", "job description"
    ],
    negatives: ["company", "employer", "school", "project", "education"],
    section: "experience",
    indexable: true,
    path: "experience[0].description"
  },

  // ─── Free text ───
  {
    id: "summary",
    names: [["summary"], ["bio"], ["about"], ["objective"], ["headline"], ["personal", "statement"]],
    keywords: [
      "summary", "bio", "about you", "about yourself", "professional summary",
      "personal statement", "objective", "tell us about yourself", "headline", "introduction"
    ],
    path: "summary"
  },
  {
    id: "skills",
    names: [["skills"], ["technical", "skills"], ["competencies"], ["technologies"]],
    keywords: ["skills", "technical skills", "key skills", "competencies", "technologies", "proficiencies"],
    path: "skills"
  },

  // ─── Common application questions ───
  {
    id: "salaryExpectation",
    names: [["salary"], ["expected", "salary"], ["compensation"], ["desired", "salary"], ["expected", "ctc"]],
    keywords: [
      "salary", "expected salary", "salary expectation", "desired salary",
      "compensation", "pay expectation", "expected ctc"
    ],
    path: "customFields.salaryExpectation"
  },
  {
    id: "startDate",
    autocomplete: [],
    names: [["start", "date"], ["availability"], ["earliest", "start"], ["available", "date"]],
    keywords: [
      "start date", "earliest start", "available to start", "availability",
      "when can you start"
    ],
    negatives: ["school", "university", "education", "employment start", "previous", "notice period", "notice"],
    path: "customFields.startDate"
  },
  {
    id: "yearsOfExperience",
    names: [["years", "experience"], ["years", "of", "experience"], ["total", "experience"], ["experience", "years"]],
    keywords: ["years of experience", "total experience", "how many years", "years experience"],
    path: "customFields.yearsOfExperience"
  },
  {
    id: "referral",
    names: [["referral"], ["referred", "by"], ["source"], ["how", "did", "you", "hear"]],
    keywords: [
      "referral", "referred by", "how did you hear", "hear about us", "how did you find",
      "how did you hear about this opportunity", "job board", "source"
    ],
    path: "customFields.referral"
  },
  {
    id: "pronouns",
    names: [["pronouns"], ["preferred", "pronouns"]],
    keywords: ["pronouns", "preferred pronouns"],
    path: "customFields.pronouns"
  },
  {
    id: "phoneType",
    names: [["phone", "type"], ["phone", "device", "type"], ["device", "type"]],
    keywords: ["phone type", "phone device type", "device type", "type of phone"],
    path: "customFields.phoneType",
    fallback: () => "Mobile"
  },
  {
    id: "willingToRelocate",
    names: [["relocate"], ["willing", "relocate"], ["relocation"], ["open", "relocation"]],
    keywords: ["willing to relocate", "relocate", "relocation", "open to relocation", "are you willing to relocate"],
    path: "customFields.willingToRelocate",
    fallback: () => "Yes"
  },
  {
    id: "workLocationPreference",
    names: [["workplace", "type"], ["remote"], ["hybrid"], ["work", "location"], ["work", "model"]],
    keywords: ["workplace preference", "work location preference", "remote/hybrid", "work model", "work arrangement"],
    path: "customFields.workLocationPreference"
  },
  {
    id: "legalAge",
    names: [["legal", "age"], ["18", "older"], ["over", "18"], ["age", "18"]],
    keywords: ["are you 18", "18 years of age or older", "18 or older", "at least 18", "legal age to work", "are you at least 18"],
    path: "customFields.legalAge",
    fallback: () => "Yes"
  },
  {
    id: "formerEmployee",
    names: [["former", "employee"], ["previously", "employed"], ["worked", "before"], ["prior", "employee"]],
    keywords: ["previously employed", "former employee", "have you worked here", "worked for us before", "have you ever worked for", "prior employee"],
    path: "customFields.formerEmployee",
    fallback: () => "No"
  },
  {
    id: "relativeEmployed",
    names: [["relatives"], ["family", "employed"], ["conflict", "interest"]],
    keywords: ["relatives", "family member", "any relatives", "family employed", "conflict of interest"],
    path: "customFields.relativeEmployed",
    fallback: () => "No"
  },
  {
    id: "noticePeriod",
    names: [["notice", "period"], ["days", "notice"], ["how", "soon", "start"]],
    keywords: ["notice period", "days notice", "how much notice", "official notice period", "how soon can you start"],
    path: "customFields.noticePeriod",
    fallback: (p) => p.customFields?.noticePeriod || p.customFields?.startDate || "Immediately"
  },
  {
    id: "twitter",
    names: [["twitter"], ["twitter", "url"], ["x", "profile"], ["x", "com"]],
    keywords: ["twitter", "twitter profile", "twitter url", "x profile"],
    path: "personal.twitter",
    fallback: (p) => p.customFields?.twitter || null,
    multi: true
  },
  {
    id: "citizenship",
    names: [["citizenship"], ["country", "citizenship"], ["primary", "citizenship"]],
    keywords: ["citizenship", "country of citizenship", "primary citizenship", "citizen of"],
    path: "customFields.citizenship",
    fallback: (p) => p.personal?.country || null
  },
  {
    id: "currentSalary",
    names: [["current", "salary"], ["current", "ctc"], ["current", "compensation"]],
    keywords: ["current salary", "current ctc", "current compensation", "present salary"],
    path: "customFields.currentSalary"
  },
  {
    id: "salutation",
    names: [["salutation"], ["prefix"], ["title"], ["honorific"]],
    keywords: ["salutation", "prefix", "personal title", "honorific", "mr/ms/mrs"],
    negatives: ["job", "position", "current", "company", "degree", "school", "posting", "role"],
    path: "customFields.salutation",
    fallback: () => "Mr."
  },
  {
    id: "consent",
    names: [["consent"], ["certify"], ["terms"], ["privacy"], ["acknowledgment"], ["declaration"], ["agreement"], ["attestation"]],
    keywords: [
      "i certify", "i agree", "consent", "terms and conditions", "privacy policy", "data privacy",
      "acknowledge and agree", "i acknowledge", "certify that the information", "accurate and complete",
      "terms of use", "declaration", "attestation", "applicant statement", "electronic signature agreement"
    ],
    path: "customFields.consent",
    fallback: () => "Yes"
  },
  {
    id: "backgroundCheck",
    names: [["background", "check"], ["background", "screening"], ["screening", "consent"], ["drug", "test"], ["drug", "screening"]],
    keywords: [
      "background check", "background screening", "willing to undergo a background check",
      "pre-employment background check", "drug screening", "drug test", "background investigation"
    ],
    path: "customFields.backgroundCheck",
    fallback: () => "Yes"
  },
  {
    id: "travelPreference",
    names: [["travel"], ["willing", "travel"], ["travel", "percentage"], ["travel", "requirement"]],
    keywords: [
      "willing to travel", "travel requirement", "travel percentage", "travel willingness", "open to travel"
    ],
    path: "customFields.travelPreference",
    fallback: () => "Yes"
  },
  {
    id: "driversLicense",
    names: [["driver", "license"], ["drivers", "license"], ["driving", "license"]],
    keywords: ["driver's license", "drivers license", "valid driver's license", "driving license"],
    path: "customFields.driversLicense",
    fallback: () => "Yes"
  },
  {
    id: "securityClearance",
    names: [["security", "clearance"], ["clearance"], ["clearance", "level"]],
    keywords: ["security clearance", "clearance level", "active security clearance", "possess a security clearance"],
    path: "customFields.securityClearance",
    fallback: () => "No"
  },
  {
    id: "signature",
    names: [["signature"], ["electronic", "signature"], ["applicant", "signature"], ["sign", "name"], ["e", "signature"], ["digital", "signature"]],
    keywords: [
      "electronic signature", "signature", "applicant signature", "sign your name",
      "type your full legal name", "type your full name", "type your name",
      "typed signature", "digital signature", "please sign", "signature of applicant"
    ],
    negatives: ["date", "time", "day", "month", "year"],
    path: "personal.fullName",
    fallback: (p) => (p.personal?.fullName || `${p.personal?.firstName || ""} ${p.personal?.lastName || ""}`.trim()) || null
  },
  {
    id: "signatureDate",
    names: [["signature", "date"], ["date", "signed"], ["today", "date"], ["current", "date"], ["agreement", "date"]],
    keywords: ["signature date", "date signed", "date of signature", "today's date", "todays date", "current date"],
    path: "customFields.signatureDate",
    fallback: () => new Date().toISOString().split("T")[0],
    isDate: true
  },
  {
    id: "nonCompete",
    names: [["non", "compete"], ["restrictive", "covenant"], ["non", "disclosure", "agreement"], ["noncompete"]],
    keywords: [
      "non-compete", "non compete", "restrictive covenant", "non-compete agreement",
      "subject to a non-compete", "bound by any non-compete", "restrictive covenants"
    ],
    path: "customFields.nonCompete",
    fallback: () => "No"
  },
  {
    id: "governmentOfficial",
    names: [["government", "official"], ["public", "official"], ["politically", "exposed"]],
    keywords: ["government official", "public official", "are you a government official", "related to a government official"],
    path: "customFields.governmentOfficial",
    fallback: () => "No"
  },
  {
    id: "reliableTransportation",
    names: [["transportation"], ["reliable", "transportation"], ["valid", "transportation"]],
    keywords: ["reliable transportation", "access to reliable transportation", "reliable means of transportation"],
    path: "customFields.reliableTransportation",
    fallback: () => "Yes"
  },
  {
    id: "criminalRecord",
    names: [["felony"], ["criminal", "conviction"], ["convicted"]],
    keywords: ["convicted of a felony", "criminal conviction", "have you ever been convicted", "felony conviction"],
    path: "customFields.criminalRecord",
    fallback: () => "No"
  },
  {
    id: "suffix",
    names: [["suffix"], ["name", "suffix"]],
    keywords: ["suffix", "name suffix", "generation suffix", "jr/sr"],
    negatives: ["first", "last", "middle"],
    path: "personal.suffix",
    fallback: (p) => p.customFields?.suffix || null
  },
  {
    id: "county",
    names: [["county"], ["district"], ["parish"]],
    keywords: ["county", "parish"],
    negatives: ["country"],
    path: "customFields.county"
  },

  // ─── Sensitive / EEO ───
  // Only filled when you have explicitly stored an answer; see isSensitive().
  {
    id: "gender",
    autocomplete: ["sex"],
    names: [["gender"], ["sex"], ["gender", "identity"]],
    keywords: ["gender", "sex", "gender identity"],
    path: "customFields.gender",
    sensitive: true
  },
  {
    id: "ethnicity",
    names: [["race"], ["ethnicity"], ["ethnic", "background"], ["racial"]],
    keywords: ["race", "ethnicity", "ethnic background", "race/ethnicity"],
    path: "customFields.ethnicity",
    sensitive: true
  },
  {
    id: "hispanicLatino",
    names: [["hispanic"], ["latino"], ["hispanic", "latino"]],
    keywords: ["are you hispanic or latino", "hispanic or latino", "hispanic/latino", "hispanic origin"],
    path: "customFields.hispanicLatino",
    sensitive: true
  },
  {
    id: "veteranStatus",
    names: [["veteran"], ["veteran", "status"], ["military"]],
    keywords: ["veteran", "veteran status", "protected veteran", "military service"],
    path: "customFields.veteranStatus",
    sensitive: true
  },
  {
    id: "disabilityStatus",
    names: [["disability"], ["disability", "status"]],
    keywords: ["disability", "disability status", "disabled"],
    path: "customFields.disabilityStatus",
    sensitive: true
  }
];

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

// A rule whose path carries an index can be satisfied once per repeated block —
// three education cards on a form are three legitimate "School" fields, not one
// correct field and two impostors.
for (const r of RULES) r.indexable = /\[0\]/.test(r.path || "");

/**
 * Stable identity for a field across sites, used by the correction feedback
 * loop. Deliberately excludes the host: correcting "Location" on one board
 * should inform the same question on the next.
 */
function fieldKey(field) {
  return contextualKey(field);
}

/**
 * The normalisation behind every key this extension stores a value under.
 *
 * Exported because the learned map and the correction log have to agree on it:
 * a value remembered under one spelling of a question and looked up under
 * another is a value that is never reused. "E-mail address *" and "E-mail
 * Address" are the same question and must produce the same key.
 */
function normalizeKey(s) {
  return canonicalQuestion(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// ATS adapters
//
// These platforms use stable, documented attributes. A direct hit here is worth
// more than any amount of label guessing, and it is a single dictionary lookup.
// ─────────────────────────────────────────────────────────────────────────────

const ATS_BY_NAME = {
  // Greenhouse
  "job_application[first_name]": "firstName",
  "job_application[last_name]": "lastName",
  "job_application[preferred_name]": "preferredName",
  "job_application[email]": "email",
  "job_application[phone]": "phone",
  "job_application[location]": "location",
  "job_application[address_line_2]": "addressLine2",
  "job_application[urls][LinkedIn]": "linkedin",
  "job_application[urls][GitHub]": "github",
  "job_application[urls][Portfolio]": "website",
  "job_application[urls][Website]": "website",
  "job_application[urls][Twitter]": "twitter",
  "job_application[urls][Other]": "website",
  "job_application[gender]": "gender",
  "job_application[race]": "ethnicity",
  "job_application[veteran_status]": "veteranStatus",
  "job_application[disability_status]": "disabilityStatus",
  first_name: "firstName",
  last_name: "lastName",

  // Lever
  name: "fullName",
  email: "email",
  phone: "phone",
  org: "company",
  "urls[LinkedIn]": "linkedin",
  "urls[Github]": "github",
  "urls[GitHub]": "github",
  "urls[Portfolio]": "website",
  "urls[Twitter]": "twitter",
  "urls[Other]": "website",
  comments: "summary",
  additional_information: "summary",

  // Workable
  firstname: "firstName",
  lastname: "lastName",
  headline: "summary",

  // SmartRecruiters / generic camelCase
  firstName: "firstName",
  lastName: "lastName",
  phoneNumber: "phone",
  emailAddress: "email",
  title: "salutation",
  salutation: "salutation",
  consent: "consent",
  terms: "consent",
  background_check: "backgroundCheck",
  "job_application[signature]": "signature",
  "job_application[e_signature]": "signature",
  "job_application[signature_date]": "signatureDate",
  "job_application[date]": "signatureDate",
  signature: "signature",
  e_signature: "signature",
  electronic_signature: "signature",
  signature_date: "signatureDate",
  non_compete: "nonCompete",
  hispanic_latino: "hispanicLatino",
  "job_application[job_title]": "jobTitle",
  "job_application[company_name]": "company",
  reliable_transportation: "reliableTransportation"
};

const ATS_BY_ID = {
  // Greenhouse
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  phone: "phone",
  signature: "signature",
  electronic_signature: "signature",
  e_signature: "signature",

  // Ashby
  _systemfield_name: "fullName",
  _systemfield_preferred_name: "preferredName",
  _systemfield_email: "email",
  _systemfield_phone: "phone",
  _systemfield_company: "company",
  _systemfield_title: "jobTitle",
  _systemfield_location: "location",
  _systemfield_address: "addressLine1",
  _systemfield_city: "city",
  _systemfield_postal_code: "postalCode",
  _systemfield_country: "country",
  _systemfield_linkedin: "linkedin",
  _systemfield_github: "github",
  _systemfield_portfolio: "website",
  _systemfield_website: "website",

  // Taleo / iCIMS
  quickApplyFirstName: "firstName",
  quickApplyLastName: "lastName",
  quickApplyEmail: "email"
};

// Workday — data-automation-id
const ATS_BY_AUTOMATION_ID = {
  legalNameSection_title: "salutation",
  legalNameSection_firstName: "firstName",
  legalNameSection_lastName: "lastName",
  legalNameSection_middleName: "middleName",
  legalNameSection_preferredName: "preferredName",
  legalNameSection_suffix: "suffix",
  email: "email",
  "phone-number": "phone",
  phoneNumber: "phone",
  phoneDeviceType: "phoneType",
  "phone-device-type": "phoneType",
  addressSection_addressLine1: "addressLine1",
  addressSection_addressLine2: "addressLine2",
  addressSection_city: "city",
  addressSection_countryRegion: "country",
  addressSection_postalCode: "postalCode",
  addressSection_county: "county",
  addressSection_regionSubdivision1: "state",
  "source--source": "referral",
  formField_sourcePrompt: "referral",
  yearsOfExperience: "yearsOfExperience",
  workAuthorization: "authorizedToWork",
  legallyAuthorized: "authorizedToWork",
  candidateWorkAuthorization: "authorizedToWork",
  visaSponsorship: "sponsorship",
  requireSponsorship: "sponsorship",
  immigrationSponsorship: "sponsorship",
  citizenshipStatus: "citizenship",
  school: "university",
  degree: "degree",
  fieldOfStudy: "fieldOfStudy",
  gpa: "gpa",
  company: "company",
  jobTitle: "jobTitle",
  startDate: "startDate",
  jobHistoryItem_company: "company",
  jobHistoryItem_title: "jobTitle",
  jobHistoryItem_jobTitle: "jobTitle",
  jobHistoryItem_location: "experienceLocation",
  jobHistoryItem_startDate: "experienceStartDate",
  jobHistoryItem_endDate: "experienceEndDate",
  jobHistoryItem_currentlyWorkHere: "currentJob",
  jobHistoryItem_roleDescription: "experienceDescription",
  jobHistory_company: "company",
  jobHistory_title: "jobTitle",
  jobHistory_location: "experienceLocation",
  jobHistory_startDate: "experienceStartDate",
  jobHistory_endDate: "experienceEndDate",
  jobHistory_currentlyWorkHere: "currentJob",
  jobHistory_roleDescription: "experienceDescription",
  educationItem_school: "university",
  educationItem_degree: "degree",
  educationItem_fieldOfStudy: "fieldOfStudy",
  educationItem_startDate: "educationStartDate",
  educationItem_endDate: "graduationDate",
  educationItem_gpa: "gpa",
  education_school: "university",
  education_degree: "degree",
  education_fieldOfStudy: "fieldOfStudy",
  education_startDate: "educationStartDate",
  education_endDate: "graduationDate",
  education_gpa: "gpa",
  noticePeriod: "noticePeriod",
  willingToRelocate: "willingToRelocate",
  backgroundCheck: "backgroundCheck",
  termsAndConditions: "consent",
  electronicSignature: "signature",
  candidateSignature: "signature",
  signature_name: "signature",
  signature: "signature",
  dateSigned: "signatureDate",
  date_signed: "signatureDate",
  nonCompeteAgreement: "nonCompete",
  restrictiveCovenant: "nonCompete",
  governmentOfficial: "governmentOfficial",
  reliableTransportation: "reliableTransportation",
  hispanicLatino: "hispanicLatino",
  hispanicOrLatino: "hispanicLatino"
};

/** File inputs that should receive the resume. */
const RESUME_HINTS = /resume|c\.?v\.?\b|curriculum\s*vitae/i;
const COVER_LETTER_HINTS = /cover\s*letter|motivation\s*letter/i;

/** Uploads that are emphatically not a resume, however the page words them. */
const NOT_RESUME_UPLOAD = /photo|head\s*shot|headshot|avatar|profile\s*(picture|image)|logo|passport|visa\s*copy|id\s*(card|proof)|certificate|transcript|portfolio\s*image|signature/i;

/** Section headings that mean "this block is not about you". */
const FOREIGN_SECTION = /\breference|emergency\s*contact|guardian|next\s*of\s*kin|previous\s*employer|referee/i;

// ─────────────────────────────────────────────────────────────────────────────
// Resume upload targeting
//
// Kept here, away from the DOM, because deciding *which* upload box gets the
// resume is the part that goes wrong — and the part worth testing. The scanner
// hands over descriptors; this decides, and index.js only does the injecting.
// ─────────────────────────────────────────────────────────────────────────────

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text"
};

/**
 * Would this input take our file, going by its own `accept` list?
 *
 * A photo upload declaring `accept="image/*"` sits on plenty of application
 * forms. Assigning a PDF to it "succeeds" — nothing validates a scripted
 * assignment — and the site then rejects the submission with an error the user
 * has to work out for themselves. Reading `accept` first avoids that entirely.
 */
function acceptAllows(accept, fileName = "resume.pdf") {
  const list = String(accept || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;                       // no restriction stated

  const dot = String(fileName).lastIndexOf(".");
  const ext = dot > -1 ? String(fileName).slice(dot).toLowerCase() : "";
  const mime = MIME_BY_EXT[ext] || "";

  return list.some((a) => {
    if (a === "*" || a === "*/*") return true;
    if (a.startsWith(".")) return a === ext;
    if (a.endsWith("/*")) return !!mime && mime.startsWith(a.slice(0, -1));
    return !!mime && a === mime;
  });
}

/**
 * Choose the upload boxes that should receive the resume.
 *
 * @param {Array} fields   scanner descriptors, any kind — non-file ones are ignored
 * @param {string} fileName  the stored resume's name, for the `accept` check
 * @returns {Array} the descriptors to fill, in page order
 *
 * The rules, in order of how much they are trusted:
 *
 *  1. A box that says "resume" or "CV" is the resume box, even if the page also
 *     has others. Every explicit one is filled — Workday asks twice on some
 *     tenants, once on the upload step and again on the review step.
 *  2. Otherwise, a lone remaining upload on an application form is the resume in
 *     practice. This is the case that matters most in the wild: the real
 *     <input type=file> behind a styled "Attach" button routinely carries no
 *     label, no name and no id worth reading.
 *  3. With several unlabelled boxes and nothing to tell them apart, fill none.
 *     Putting a resume into the box meant for a portfolio or a photo is worse
 *     than leaving one click for the user.
 */
function pickResumeTargets(fields, fileName = "resume.pdf") {
  const candidates = [];

  for (const f of fields) {
    if (!f || f.kind !== "file" || f.filled) continue;

    const hay = `${f.rawLabel || f.label || ""} ${f.name || ""} ${f.id || ""} ` +
                `${f.uploadContext || ""} ${f.className || ""}`;

    const isResume = RESUME_HINTS.test(hay);
    // A cover-letter box is claimed by the letter writer, not by us — unless the
    // page words it as one control for both ("Resume / Cover letter").
    if (!isResume && COVER_LETTER_HINTS.test(hay)) continue;
    if (!isResume && NOT_RESUME_UPLOAD.test(hay)) continue;
    if (!acceptAllows(f.accept, fileName)) continue;

    candidates.push({ field: f, isResume });
  }

  const explicit = candidates.filter((c) => c.isResume);
  if (explicit.length) return explicit.map((c) => c.field);
  return candidates.length === 1 ? [candidates[0].field] : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

/** "job_application[first_name]" / "firstName" -> ["first","name"] */
function tokenize(s) {
  return String(s || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does `seq` appear as a contiguous run inside `tokens`? */
function hasSeq(tokens, seq) {
  if (seq.length > tokens.length) return false;
  outer: for (let i = 0; i <= tokens.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (tokens[i + j] !== seq[j]) continue outer;
    }
    return true;
  }
  return false;
}

function scoreLabel(rule, label) {
  if (!label) return 0;
  let best = 0;
  for (const kw of rule.keywords || []) {
    if (label === kw) return S.LABEL_EXACT;
    if (label.includes(kw)) {
      // Longer, more specific phrases are stronger evidence than single words:
      // "expected graduation date" beating a bare "date" is the whole point.
      const words = kw.split(/\s+/).length;
      best = Math.max(best, S.LABEL_PHRASE + Math.min(words * 8, 24));
    }
  }
  return best;
}

/**
 * Score one field against one rule. Returns 0 when the rule is disqualified.
 *
 * `field` is the descriptor produced by the scanner:
 *   { label, name, id, type, placeholder, autocomplete, automationId,
 *     nameTokens, section }
 */
function scoreField(rule, field) {
  const label = field.label || "";

  // Hard disqualifiers — checked against label *and* attribute tokens so that
  // name="confirm_email" is rejected for the plain email rule even when the
  // visible label is just "Email".
  if (rule.negatives) {
    const hay = `${label} ${field.name} ${field.id}`.toLowerCase();
    for (const neg of rule.negatives) {
      if (hay.includes(neg)) return 0;
    }
  }

  let score = 0;

  // 1. ATS attribute — decisive.
  if (field.atsField) {
    return field.atsField === rule.id ? S.ATS : 0;
  }

  // 2. autocomplete attribute — the spec's own answer to this exact problem.
  if (field.autocomplete && rule.autocomplete?.length) {
    // Handles section/shipping prefixes: "shipping address-level2".
    const tokens = field.autocomplete.toLowerCase().split(/\s+/);
    for (const ac of rule.autocomplete) {
      if (tokens.includes(ac)) return S.AUTOCOMPLETE;
    }
  }

  // 3. name / id token patterns.
  const nt = field.nameTokens;
  if (nt && nt.length && rule.names) {
    const joined = nt.join(" ");
    for (const seq of rule.names) {
      const pat = seq.join(" ");
      if (joined === pat) { score = Math.max(score, S.NAME_EXACT); break; }
      if (hasSeq(nt, seq)) score = Math.max(score, S.NAME_SEQ);
    }
  }

  // 4. Visible label.
  score = Math.max(score, scoreLabel(rule, label));

  // 5. Input type.
  if (rule.inputType && field.type === rule.inputType) {
    score = Math.max(score, S.INPUT_TYPE);
  }

  // 6. Placeholder — weakest signal, only if nothing better landed.
  if (score === 0 && field.placeholder && rule.keywords) {
    const ph = field.placeholder.toLowerCase();
    for (const kw of rule.keywords) {
      if (ph.includes(kw)) { score = S.PLACEHOLDER; break; }
    }
  }

  if (score === 0) return 0;

  // 7. Section context. A "School" input under an "Employment" heading is
  //    almost certainly not your university.
  if (rule.section && field.section) {
    score += field.section === rule.section ? S.SECTION_BONUS : S.SECTION_PENALTY;
  }

  return score;
}

/**
 * Penalty applied to a (field, rule) pair the user has previously overridden.
 *
 * Sized so that only spec-grade evidence survives a correction: an ATS attribute
 * (98) or an `autocomplete` token (96) still clears MIN_SCORE afterwards, while
 * a name match (88) or a label match (84) does not. Correcting a field should
 * settle it, but not against the one signal the page states outright.
 */
const DEMOTION = 60;

/**
 * Globally assign rules to fields.
 *
 * Every (field, rule) pair above MIN_SCORE is ranked, then claimed greedily.
 * Each field takes at most one rule; ties break toward the earlier field so
 * forms fill top-down.
 *
 * Slot accounting is per repeated block. A plain rule holds one slot for the
 * whole form; an indexable rule holds one slot per `field.instance`, so a form
 * with three education cards fills all three rather than only the first.
 *
 * @param opts.skipSensitive  withhold EEO rules unless an answer is stored
 * @param opts.hasAnswerFor   (ruleId) => boolean
 * @param opts.isDemoted      (field, ruleId) => boolean, from past corrections
 *
 * Returns Map<fieldIndex, { ruleId, score, instance }>.
 */
function assign(fields, opts = {}) {
  const pairs = [];

  for (let fi = 0; fi < fields.length; fi++) {
    const field = fields[fi];
    if (field.skip) continue;

      for (const rule of RULES) {
        if (opts.canMap && !opts.canMap(field, rule)) continue;
      if (rule.sensitive && opts.skipSensitive && !opts.hasAnswerFor?.(rule.id)) continue;

      let score = scoreField(rule, field);
      if (score < MIN_SCORE) continue;

      // You corrected this pairing before. Demote rather than forbid, so a
      // strong signal (an ATS attribute) can still win where a weak label
      // match no longer can.
      if (opts.isDemoted?.(field, rule.id)) {
        score -= DEMOTION;
        if (score < MIN_SCORE) continue;
      }

      pairs.push({ fi, ruleId: rule.id, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score || a.fi - b.fi);

  const out = new Map();
  const usedSlots = new Set();

  for (const p of pairs) {
    if (out.has(p.fi)) continue;
    const rule = RULE_BY_ID.get(p.ruleId);
    const field = fields[p.fi];
    const instance = field.instance || 0;
    // Scoped by repeat group as well as index: two independent repeaters on one
    // page each count from zero, and must not consume each other's slots.
    const slot = rule.indexable ? `${p.ruleId}#${field.repeatGroup || 0}:${instance}` : p.ruleId;

    if (!rule.multi && usedSlots.has(slot)) continue;
    out.set(p.fi, { ruleId: p.ruleId, score: p.score, instance });
    usedSlots.add(slot);
  }

  return out;
}

Object.assign(__x, { MIN_SCORE, RULES, RULE_BY_ID, fieldKey, normalizeKey, ATS_BY_NAME, ATS_BY_ID, ATS_BY_AUTOMATION_ID, RESUME_HINTS, COVER_LETTER_HINTS, FOREIGN_SECTION, acceptAllows, pickResumeTargets, tokenize, scoreField, DEMOTION, assign });
};

__m["src/shared/field-identity.js"] = (__x, __req) => {
function canonicalQuestion(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
}
function scopeForQuestion(url) {
  const u = new URL(url);
  const identifiers = [...u.searchParams].filter(([key]) => /^(job|jobid|requisition|requisitionid|reqid|applicationid|gh_jid)$/i.test(key)).sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(identifiers).toString();
  return u.origin + u.pathname + (query ? "?" + query : "");
}
function contextualKey(field) {
  const question = canonicalQuestion(field.questionFull || field.rawLabel || field.label || field.name || field.id);
  if (!question) return "";
  return "q2:" + JSON.stringify([question, canonicalQuestion(field.sectionTitle || field.section || ""), field.instance || 0]);
}

Object.assign(__x, { canonicalQuestion, scopeForQuestion, contextualKey });
};

__m["src/engine/controls/workday.js"] = (__x, __req) => {
const { semanticScore } = __req("src/shared/values.js");

const norm = (v) => String(v ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (el) => el?.isConnected && el.getClientRects().length > 0;
const placeholder = /^(select( one)?|choose( one)?|search|please select|loading|select options?)\s*[.…]*$/i;
const MENU = '[role="listbox"],[role="menu"],[data-automation-id="promptOptions"],.select__menu';
const countryVocabulary = [
  ["united states", "united states of america", "usa", "us", "united states us"],
  ["united kingdom", "uk", "gb"], ["india", "in"], ["canada", "ca"], ["australia", "au"]
];
function vocabularyScore(ruleId, label, value, target) {
  if (!/country/i.test(ruleId || "")) return 0;
  const aliases = countryVocabulary.find((terms) => terms.includes(norm(target)));
  return aliases && [label, value].some((v) => aliases.includes(norm(v))) ? .95 : 0;
}

function rankChoices(options, value, ruleId) {
  const target = norm(value);
  const ranked = options.filter((o) => !o.el?.disabled && o.el?.getAttribute?.("aria-disabled") !== "true")
    .map((o) => ({ ...o, score: norm(o.label) === target || norm(o.value) === target ? 1 : Math.max(vocabularyScore(ruleId, o.label, o.value, value), semanticScore(ruleId, o.label, o.value, String(value))) }))
    .filter((o) => o.score >= .9).sort((a, b) => b.score - a.score);
  const first = ranked[0], second = ranked.find((o) => norm(o.label) !== norm(first?.label) || norm(o.value) !== norm(first?.value));
  const ambiguous = !!first && !!second && !(first.score === 1 && second.score < 1) && first.score - second.score < .06;
  return { choice: first && !ambiguous ? first : null, ambiguous, candidates: ranked.slice(0, 3) };
}

function ownedMenu(el, previous = new Set()) {
  const root = el.getRootNode();
  const scopes = root === el.ownerDocument ? [root] : [root, el.ownerDocument];
  const ids = (el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "").split(/\s+/).filter(Boolean);
  if (ids.length) {
    const owned = ids.map((id) => root.getElementById?.(id) || el.ownerDocument.getElementById(id)).filter(visible);
    return owned.length === 1 ? owned[0] : null;
  }
  const linked = scopes.flatMap((s) => [...s.querySelectorAll(MENU)]).filter((m) => visible(m) && m !== el && !m.contains(el));
  const named = linked.filter((m) => el.id && (m.getAttribute("aria-labelledby") || "").split(/\s+/).includes(el.id));
  if (named.length === 1) return named[0];
  const newlyOpened = linked.filter((m) => !previous.has(m));
  return newlyOpened.length === 1 ? newlyOpened[0] : null;
}
function readChoices(menu) {
  return [...menu.querySelectorAll('[role="option"],[data-automation-id="promptOption"],li[role="menuitem"]')]
    .filter(visible).map((el) => ({ el, label: (el.getAttribute("aria-label") || el.textContent || "").trim(),
      value: el.getAttribute("data-value") || el.getAttribute("value") || (el.textContent || "").trim() }))
    .filter((o) => o.label && !placeholder.test(o.label));
}
function region(el) {
  const box = el.closest('[data-automation-id="formField"],.select__control,[data-control],.field') || el.parentElement;
  const controls = box ? new Set(box.querySelectorAll('input:not([type="hidden"]),select,textarea,[role="combobox"]')) : new Set();
  return controls.size > 1 ? null : box;
}
function selectedValues(el, option = null) {
  const box = region(el);
  const values = [el.getAttribute("data-selected"), el.getAttribute("data-selected-value")];
  if (el.tagName === "BUTTON") values.push(el.textContent);
  values.push(el.getAttribute("aria-valuetext"));
  for (const node of el.querySelectorAll('[aria-selected="true"]')) values.push(node.getAttribute("data-value") || node.textContent);
  if (box) for (const node of box.querySelectorAll('input[type="hidden"],.select__single-value,.select__multi-value__label,[data-automation-id="selectedItem"],[data-chip]')) {
    values.push(node.value || node.textContent);
  }
  if (option?.el?.getAttribute("aria-selected") === "true") values.push(option.label);
  return [...new Set(values.map(norm).filter((v) => v && !placeholder.test(v)))];
}

// The caller supplies DOM primitives; provider and storage code never enters an adapter.
async function fillWorkday(field, value, ruleId, ops) {
  const el = field.el, doc = el.ownerDocument;
  const targets = Array.isArray(value) ? value : [value];
  const committed = [];
  const initialQuestion = ops.question(el);
  if (field.rawLabel && initialQuestion !== field.rawLabel) { field.controlOutcome = { status: "unresolved", reason: "question_changed" }; return false; }
  let edited = false;
  const onEdit = (e) => { if (e.isTrusted) edited = true; };
  el.addEventListener("input", onEdit); el.addEventListener("change", onEdit);
  const valid = () => el.isConnected && !edited && ops.question(el) === initialQuestion && (!field.writeGuard || field.writeGuard());
  try {
    for (const target of targets) {
      if (!valid()) return false;
      if (selectedValues(el).includes(norm(target))) { committed.push(norm(target)); continue; }
      const path = String(target).split(/\s*>\s*/);
      let level = 0;
      const before = el.value || "";
      const scopes = el.getRootNode() === doc ? [doc] : [el.getRootNode(), doc];
      const previous = new Set(scopes.flatMap((s) => [...s.querySelectorAll(MENU)]).filter(visible));
      const deadline = Date.now() + 3500;
      ops.click(el);
      let menu, selected = null, searches = false, scrolls = 0;
      let lastSignature = "";
      while (Date.now() < deadline && valid()) {
        menu = ownedMenu(el, previous);
        if (!menu) { await pause(50); continue; }
        const choices = readChoices(menu);
        const ranked = rankChoices(choices, path[level], ruleId);
        if (ranked.ambiguous) {
          field.controlOutcome = { status: "ambiguous", choices: ranked.candidates.map((o) => o.label) };
          break;
        }
        if (ranked.choice) {
          if (level < path.length - 1) { ops.click(ranked.choice.el); level++; searches = false; lastSignature = ""; await pause(80); continue; }
          selected = ranked.choice; break;
        }
        const search = el.tagName === "INPUT" && !el.readOnly ? el : menu.querySelector('input[type="search"],input[role="textbox"],input[data-automation-id*="search" i]');
        if (search && !searches) {
          ops.setValue(search, path[level]); ops.input(search); searches = true;
          await pause(80); continue;
        }
        const signature = choices.map((o) => o.label).join("\n");
        if (choices.length && menu.scrollHeight > menu.clientHeight + 1 && scrolls < 14 && signature !== lastSignature) {
          lastSignature = signature;
          // Setting scrollTop already emits a native scroll event. A second
          // synthetic event advances virtualized lists twice and skips rows.
          menu.scrollTop += Math.max(48, menu.clientHeight * .8); scrolls++;
          await pause(80); continue;
        }
        // Still loading options? Wait through the bounded window, not just until a menu exists.
        if (choices.length && menu.getAttribute("aria-busy") !== "true" && !/loading/i.test(menu.textContent)) break;
        await pause(50);
      }
      if (!selected || !valid()) {
        if ((valid() || field.cleanupGuard?.()) && el.tagName === "INPUT") { ops.setValue(el, before); ops.input(el); }
        ops.key(el, "Escape");
        field.controlOutcome ||= { status: "unresolved", reason: menu ? "no_supported_option" : "menu_unreachable" };
        return false;
      }
      selected.el.scrollIntoView({ block: "nearest" });
      ops.click(selected.el);
      const hasSelection = () => {
        const values = selectedValues(el, selected);
        return valid() && (values.includes(norm(selected.label)) || values.includes(norm(selected.value)));
      };
      // Search text and menu closure alone are not proof that the app accepted a choice.
      await pause(120);
      const first = hasSelection(); await pause(180);
      if (!first || !hasSelection()) {
        if (valid() && el.tagName === "INPUT") { ops.setValue(el, before); ops.input(el); ops.key(el, "Escape"); }
        field.controlOutcome = { status: "rejected", reason: "selection_not_persistent" };
        return false;
      }
      field.controlOutcome = { status: "verified", value: selected.label };
      committed.push(norm(selected.label));
    }
    if (Array.isArray(value) && !committed.every((v) => selectedValues(el).includes(v))) {
      field.controlOutcome = { status: "rejected", reason: "partial_multiselection" }; return false;
    }
    return true;
  } finally { el.removeEventListener("input", onEdit); el.removeEventListener("change", onEdit); }
}

Object.assign(__x, { rankChoices, ownedMenu, readChoices, selectedValues, fillWorkday });
};

__m["src/engine/scan.js"] = (__x, __req) => {
// Apply karo — DOM scanner.
//
// Performance notes, since this is where v1 spent nearly all of its time:
//
//  * Shadow roots are discovered ONCE and cached. v1 called
//    `querySelectorAll("*")` — materialising every element in the document —
//    on every single scan, and scans ran on every mutation burst.
//  * Labels are read with `textContent`, never `innerText`. `innerText` is
//    layout-dependent; reading it forces a reflow and it is roughly two orders
//    of magnitude slower.
//  * `label[for]` is resolved through a Map built once per scan instead of one
//    `querySelector` per field.
//  * Layout-reading calls are confined to `isVisible`, and the scan performs no
//    DOM writes at all, so the browser computes layout once and every later
//    read is served from the clean tree.

const { tokenize, ATS_BY_NAME, ATS_BY_ID, ATS_BY_AUTOMATION_ID, FOREIGN_SECTION } = __req("src/shared/rules.js");

const { fullText, resolveLabels } = __req("src/engine/discovery/labels.js");
const { describe } = __req("src/engine/discovery/descriptor.js");
const { selectedValues } = __req("src/engine/controls/workday.js");

const FIELD_SELECTOR = [
  "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image])",
  "select",
  "textarea",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="combobox"]',
  '[role="textbox"]',
  // ARIA-only controls. Google Forms, Material, and most design systems build
  // choices out of <div role="radio"> rather than <input type=radio>; without
  // these the scanner sees a page of plain text and reports nothing to fill.
  '[role="radiogroup"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="listbox"]',
  // A styled yes/no toggle. Consent and "are you willing to relocate" questions
  // ship as one of these on plenty of modern forms, and without the role they
  // read as decorative markup — the question is simply not on the page.
  '[role="switch"]',
  '[role="spinbutton"]',
  'button[aria-haspopup="listbox"]',
  'button[aria-haspopup="menu"]',
  'button[data-automation-id*="prompt"]'
].join(",");

/** An ARIA control that stands in for a native one. */
const ARIA_ROLE = {
  radio: "radio",
  checkbox: "checkbox",
  // A switch is a single boolean control, not a set of choices, so it gets its
  // own kind rather than being folded into `checkbox`. Folded in, it was swept
  // up by the choice-grouping branch below and became a one-option
  // "checkboxgroup" whose question was read off the enclosing fieldset — so
  // "Are you willing to relocate?" arrived at the matcher as the name of
  // whatever section the toggle happened to sit in.
  switch: "switch",
  listbox: "combobox",
  combobox: "combobox",
  textbox: "text",
  spinbutton: "text"
};

const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,legend,[role=heading]";
const HONEYPOT = /honey-?pot|bot-?field|leave-?blank|no-?fill|do-?not-?fill|winnie|comment-?field/i;

const OWN_UI = "#applykaro-root, #applykaro-field-root";

// ─────────────────────────────────────────────────────────────────────────────
// Shadow DOM host cache
// ─────────────────────────────────────────────────────────────────────────────

let shadowRoots = null;      // ShadowRoot[]
let shadowDirty = true;      // set by the observer when nodes are added

function invalidateShadowCache() {
  shadowDirty = true;
}

function surfaceInventory() {
  const roots = getRoots();
  return { openShadowRoots: roots.length - 1,
    frames: [...document.querySelectorAll("iframe")].map((f) => f.hasAttribute("srcdoc") ? "about:srcdoc" : f.src || "about:blank"),
    uninspectableHosts: [...document.querySelectorAll("*")].filter((el) => !el.closest(OWN_UI) && /(?:form|input|select|application)/i.test(el.localName || "") &&
      el.localName?.includes("-") && !el.shadowRoot && !el.querySelector(FIELD_SELECTOR)).length };
}

function collectShadowRoots() {
  const roots = [];
  const walk = (root, depth) => {
    if (depth > 6) return;                       // pathological nesting guard
    let all;
    try { all = root.querySelectorAll("*"); } catch { return; }
    for (let i = 0; i < all.length; i++) {
      if (all[i].closest?.(OWN_UI)) continue;
      const sr = all[i].shadowRoot;
      if (sr) { roots.push(sr); walk(sr, depth + 1); }
    }
  };
  walk(document, 0);
  return roots;
}

function getRoots() {
  if (shadowDirty || shadowRoots === null) {
    shadowRoots = collectShadowRoots();
    shadowDirty = false;
  }
  return shadowRoots.length ? [document, ...shadowRoots] : [document];
}

// ─────────────────────────────────────────────────────────────────────────────
// Text extraction
// ─────────────────────────────────────────────────────────────────────────────

const SKIP_TAGS = new Set([
  "INPUT", "SELECT", "TEXTAREA", "OPTION", "BUTTON", "SCRIPT", "STYLE", "SVG", "svg"
]);

/**
 * Visible-ish text of an element using textContent only.
 *
 * Form controls are skipped so that a <label> wrapping a <select> does not
 * return every option's text concatenated — which is exactly what a naive
 * textContent read produces, and a subtle way to poison label matching.
 */
function textOf(el) { return fullText(el); }

function normalize(s) {
  return String(s || "").replace(/[\s ]+/g, " ").replace(/[*:•]+\s*$/, "").trim();
}

const attrOf = (el, name) => el.getAttribute?.(name) || "";

/**
 * The words a human would associate with a file input.
 *
 * `labelFor` finds nothing on most upload controls, because the input is hidden
 * and unlabelled — the visible wording sits on the button or drop zone wrapping
 * it, and `textOf` deliberately skips <button>, which is right for form labels
 * and wrong here. So walk up collecting the naming attributes on the way
 * (Greenhouse's `#resume_fieldset`, Workday's `data-automation-id`) and stop at
 * the first wrapper that has words of its own.
 *
 * Stopping there matters as much as starting: the first element with text is the
 * widget, and everything above it is the form. Climbing past it drags in the
 * neighbours — a "Profile photo" box two rows up made an ordinary upload read as
 * a photo field, and the resume was then skipped on a form that wanted one.
 */
function uploadContextFor(el) {
  const bits = [];
  let node = el.parentElement;

  for (let depth = 0; depth < 4 && node && node.tagName !== "BODY"; depth++) {
    bits.push(node.id || "", attrOf(node, "class"), attrOf(node, "data-testid"),
              attrOf(node, "data-automation-id"), attrOf(node, "aria-label"));

    // Capped, because a wrapper that holds the whole form describes the form,
    // not this control — in which case keep climbing for a naming attribute.
    const text = normalize(node.textContent || "");
    if (text && text.length <= 200) { bits.push(text); break; }

    node = node.parentElement;
  }

  return normalize(bits.join(" ")).slice(0, 300);
}

// ─────────────────────────────────────────────────────────────────────────────
// Label resolution
// ─────────────────────────────────────────────────────────────────────────────

function buildLabelMap(roots) {
  const map = new Map();
  map.roots = new Map();
  for (const root of roots) {
    let labels;
    try { labels = root.querySelectorAll("label[for]"); } catch { continue; }
    const scoped = new Map(); map.roots.set(root, scoped);
    for (const l of labels) {
      const key = l.getAttribute("for");
      if (!key) continue;
      if (!scoped.has(key)) scoped.set(key, []);
      scoped.get(key).push(l);
      if (!map.has(key)) map.set(key, l);
    }
  }
  return map;
}

const GENERIC_LABEL_RE = /^(your\s*answer|your\s*response|my\s*answer|answer(\s*here)?|short\s*answer(\s*text)?|long\s*answer(\s*text)?|(enter|type|write|fill\s*in)\s*(your\s*)?(answer|response|text)?(\s*here)?|text\s*area|text\s*box|input|text|response|required(\s*field)?|optional|question(\s*text)?|votre\s*r[eé]ponse|tu\s*respuesta|sua\s*resposta|ihre\s*antwort|la\s*tua\s*risposta)$/i;

function isGenericLabel(s) {
  if (!s) return true;
  const str = String(s).trim();
  if (str.length < 2) return true;
  return GENERIC_LABEL_RE.test(str);
}

function isFormControl(node) {
  if (!node || node.nodeType !== 1) return false;
  const tag = (node.tagName || "").toUpperCase();
  if (tag === "INPUT") {
    return (node.type || node.getAttribute?.("type") || "").toLowerCase() !== "hidden";
  }
  if (tag === "SELECT" || tag === "TEXTAREA") return true;
  const role = (node.getAttribute?.("role") || "").toLowerCase();
  if (["textbox", "combobox", "radiogroup", "checkbox", "radio", "listbox", "switch"].includes(role)) {
    return true;
  }
  try {
    const all = node.querySelectorAll?.("input, select, textarea, [role=textbox], [role=combobox], [role=radiogroup]");
    if (all && all.length) {
      for (const ctrl of all) {
        if (ctrl.tagName === "INPUT" && (ctrl.type || ctrl.getAttribute?.("type") || "").toLowerCase() === "hidden") {
          continue;
        }
        return true;
      }
    }
  } catch {}
  return false;
}

function labelFor(el, labelMap) {
  if (!el) return "";
  return resolveLabels(el, labelMap, fallbackLabelFor, isGenericLabel).question;
}

function fallbackLabelFor(el, labelMap) {
  if (!el) return "";
  if(el.matches?.('.select2-selection')) { const backing=el.closest('.select2-container')?.previousElementSibling;if(backing?.tagName==='SELECT')return /phone.*\.countryCode$/i.test(backing.name)?'Mobile Phone country code':fallbackLabelFor(backing,labelMap); }

  // 1. aria-label — cheapest and usually authoritative unless it's a generic placeholder like "Your answer".
  const aria = el.getAttribute?.("aria-label");
  if (aria && aria.trim() && !isGenericLabel(aria)) return normalize(aria);

  // 2. <label for="...">
  if (el.id && labelMap) {
    const l = labelMap.get(el.id);
    if (l) {
      const t = textOf(l);
      if (t && !isGenericLabel(t)) return t;
    }
  }

  // 4. Dedicated Google Forms & Single-Question Item Container
  // In Google Forms, each question item sits in [role="listitem"] / .geS5n / .Qr7Oae,
  // and the question text is in [role="heading"], .M7eMe, or .HoN3Ob.
  const qItem = el.closest?.(
    '[role="listitem"], .geS5n, .Qr7Oae, [data-item-id], .freebirdFormviewerViewItemsItemItem, [class*="freebirdFormviewer" i]'
  );
  if (qItem) {
    const qHeading = qItem.querySelector?.(
      '[role="heading"], .M7eMe, .HoN3Ob, [class*="header" i] [role="heading"], ' +
      '.freebirdFormviewerComponentsQuestionBaseTitle, [class*="questionTitle" i], [class*="question-title" i]'
    );
    if (qHeading && qHeading !== el && !qHeading.contains(el) && !isFormControl(qHeading)) {
      const ht = normalize(textOf(qHeading, 250));
      if (ht && !isGenericLabel(ht)) return ht;
    }
  }

  // 5. Wrapping <label>.
  const wrap = el.closest?.("label");
  if (wrap) {
    const t = textOf(wrap);
    if (t && !isGenericLabel(t)) return t;
  }

  // 6. Preceding sibling text in the same immediate container
  let sib = el.previousElementSibling;
  for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
    // CRITICAL: If sibling is or contains another form control, STOP!
    // Walking past another control reaches the previous field's label!
    if (isFormControl(sib)) break;
    if (SKIP_TAGS.has(sib.tagName)) continue;
    const t = textOf(sib, 150);
    if (t && t.length >= 2 && !isGenericLabel(t)) return t;
  }

  // 7. Climbing Ancestor Containers (Scoped strictly to this field's container)
  let curr = el;
  for (let depth = 0; depth < 5 && curr && curr !== document.body && curr !== document.documentElement; depth++) {
    const parent = curr.parentElement;
    if (!parent) break;

    // Count fillable controls in parent to avoid leaking across multi-field sections
    let controlCount = 0;
    try {
      const ctrls = parent.querySelectorAll("input, select, textarea, [role=textbox], [role=combobox]");
      for (const c of ctrls) {
        if (c.tagName === "INPUT" && (c.type || c.getAttribute?.("type") || "").toLowerCase() === "hidden") continue;
        controlCount++;
      }
    } catch {}

    // A. Check for explicit label or heading inside parent that sits above curr
    // ONLY do this if parent holds ONLY this control!
    // If parent holds multiple controls, querying parent.querySelector will return the FIRST field's label!
    if (controlCount <= 1) {
      const directLabel = parent.querySelector?.(
        ":scope > label, :scope > legend, :scope > [class*='label' i], " +
        ":scope > [class*='title' i], :scope > [class*='question' i], " +
        ":scope > [role='heading'], :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6"
      );
      if (directLabel && directLabel !== curr && !directLabel.contains(el) && !isFormControl(directLabel)) {
        const t = textOf(directLabel, 200);
        if (t && t.length >= 2 && !isGenericLabel(t)) return t;
      }
    }

    // B. Preceding sibling of curr inside parent (e.g. <div class="header"> above <div class="body">)
    let ps = curr.previousElementSibling;
    for (let i = 0; ps && i < 2; i++, ps = ps.previousElementSibling) {
      // CRITICAL: If ps contains another form control, it is the PREVIOUS question/field!
      // Never read text from a container that holds other form controls!
      if (isFormControl(ps)) break;

      if (ps.tagName === "LABEL" || ps.matches?.(HEADING_SELECTOR) || !SKIP_TAGS.has(ps.tagName)) {
        const t = textOf(ps, 200);
        if (t && t.length >= 2 && !isGenericLabel(t)) return t;
      }
    }

    // C. If parent only holds this field, check for nested heading/title in a wrapper (e.g. parent.header)
    if (controlCount <= 1) {
      const nestedHeading = parent.querySelector?.(
        '[role="heading"], h1, h2, h3, h4, h5, h6, legend, ' +
        '[class*="question" i], [class*="title" i], [class*="label" i], .M7eMe, .HoN3Ob'
      );
      if (nestedHeading && nestedHeading !== curr && !nestedHeading.contains(el) && !isFormControl(nestedHeading)) {
        const t = textOf(nestedHeading, 200);
        if (t && t.length >= 2 && !isGenericLabel(t)) return t;
      }

      // D. Parent's own text if short and single control
      const pt = textOf(parent, 150);
      if (pt && pt.length >= 2 && pt.length < 150 && !isGenericLabel(pt)) {
        return pt;
      }
    }

    // Stop climbing if parent holds multiple controls and is a form/fieldset or has >= 2 controls
    if (controlCount > 1 && (parent.tagName === "FORM" || parent.tagName === "FIELDSET" || controlCount >= 2)) {
      break;
    }

    curr = parent;
  }

  // 8. Attributes as a last resort.
  const ph = el.getAttribute?.("placeholder");
  if (ph && ph.trim() && !isGenericLabel(ph)) return normalize(ph);
  const title = el.getAttribute?.("title");
  if (title && title.trim() && !isGenericLabel(title)) return normalize(title);

  return "";
}

/**
 * Detailed helper text, description, instructions or subtext for a control.
 * E.g. aria-describedby references, .help-text, .form-text, .description elements.
 */
function helperTextFor(el) {
  if (!el) return "";
  const bits = [];

  // 1. aria-describedby (may list multiple IDs)
  const describedBy = el.getAttribute?.("aria-describedby");
  if (describedBy) {
    const root = el.getRootNode?.() || document;
    for (const id of describedBy.trim().split(/\s+/)) {
      if (!id) continue;
      const ref = root.getElementById?.(id) || document.getElementById?.(id);
      if (ref && !ref.matches?.("input, select, textarea, button")) {
        const t = normalize(textOf(ref, 200));
        if (t && !/^(this field is required|required field|invalid format|please fill out this field)$/i.test(t)) {
          bits.push(t);
        }
      }
    }
  }

  // 2. Surrounding container helper / hint / description elements
  let curr = el.parentElement;
  for (let depth = 0; depth < 3 && curr && curr !== document.body && bits.length < 2; depth++) {
    let cCount = 0;
    try { cCount = curr.querySelectorAll("input:not([type=hidden]), select, textarea, [role=textbox]").length; } catch {}
    if (cCount > 1 && depth > 0) break;

    const hintNodes = curr.querySelectorAll?.(
      ':scope > [class*="help" i], :scope > [class*="hint" i], :scope > [class*="desc" i], ' +
      ':scope > [class*="subtext" i], :scope > [class*="instruction" i], :scope > [class*="guidance" i], ' +
      ':scope > small, :scope > p.description, :scope > [data-automation-id*="helpText" i], :scope > .e2CuFe'
    );
    if (hintNodes && hintNodes.length) {
      for (const h of hintNodes) {
        if (h === el || h.contains(el) || isFormControl(h)) continue;
        const ht = normalize(textOf(h, 200));
        if (ht && ht.length >= 4 && !bits.includes(ht) &&
            !/^(this field is required|required field|invalid format)$/i.test(ht)) {
          bits.push(ht);
          if (bits.length >= 2) break;
        }
      }
    }
    curr = curr.parentElement;
  }

  return [...new Set(bits)].join(" ");
}

/**
 * The visible label of one control, resolved exactly as `scan()` resolves it.
 *
 * `scan()` prebuilds a `label[for]` map because it answers this for hundreds of
 * fields in a pass; this is the one-off version, for the edit watcher, which
 * needs the same answer for the single control that just changed. Both go
 * through `labelFor`, deliberately: a value learned from a manual edit is
 * stored under the label the scanner will later look it up by, and the two
 * drifting apart is exactly what made those values unfindable.
 */
function labelOf(el) {
  if (!el) return "";
  const map = new Map();
  if (el.id) {
    const root = el.getRootNode?.() || document;
    let l = null;
    try {
      const sel = `label[for="${CSS.escape(el.id)}"]`;
      l = root.querySelector?.(sel) || document.querySelector(sel);
    } catch { /* an id CSS.escape cannot express is simply not looked up */ }
    if (l) map.set(el.id, l);
  }
  return labelFor(el, map);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section context
// ─────────────────────────────────────────────────────────────────────────────

let sectionCache = new WeakMap();

/**
 * Nearest heading above the field, classified.
 * Returns { kind: "education"|"experience"|null, foreign: boolean }.
 */
function sectionFor(el) {
  // A question heading inside a field is not its section. Prefer an explicit
  // enclosing legend before considering nearby visual headings.
  const enclosing = el.closest?.("fieldset"), legend = enclosing?.querySelector?.(":scope > legend");
  if (legend) {
    const text = textOf(legend, 100), low = text.toLowerCase();
    if (text) return { kind: /employment application|application for employment/.test(low) ? null
      : /educat|school|universit|college|academic|degree/.test(low) ? "education"
      : /experien|employ|work history|position|previous role/.test(low) ? "experience" : null,
      foreign: FOREIGN_SECTION.test(low), text };
  }
  let node = el.parentElement;
  for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
    const cached = sectionCache.get(node);
    if (cached) return cached;

    let heading = "";

    if (node.tagName === "FIELDSET") {
      const lg = node.querySelector(":scope > legend");
      if (lg) heading = textOf(lg, 100);
    }
    if (!heading) {
      const aria = node.getAttribute("aria-label");
      if (aria && node.getAttribute("role")) heading = normalize(aria);
    }
    if (!heading) {
      // A heading that appears earlier in this container.
      let sib = node.previousElementSibling;
      for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
        if (sib.matches?.(HEADING_SELECTOR)) { heading = textOf(sib, 100); break; }
      }
    }
    if (!heading) {
      const h = node.querySelector?.(`:scope > ${HEADING_SELECTOR.split(",").join(", :scope > ")}`);
      if (h) heading = textOf(h, 100);
    }

    if (heading) {
      const low = heading.toLowerCase();
      const info = {
        kind: /employment application|application for employment/.test(low) ? null
            : /educat|school|universit|college|academic|degree/.test(low) ? "education"
            : /experien|employ|work history|position|previous role/.test(low) ? "experience"
            : null,
        foreign: FOREIGN_SECTION.test(low),
        text: heading
      };
      sectionCache.set(node, info);
      return info;
    }
  }
  return { kind: null, foreign: false, text: "" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Repeated blocks
//
// Forms that ask for several schools or jobs render one identical card per
// entry. Without an instance number every card looks like the same field to the
// matcher, so only the first ever gets filled.
// ─────────────────────────────────────────────────────────────────────────────

const sigCache = new WeakMap();
const groupIds = new WeakMap();
let nextGroupId = 1;

/**
 * Signature of a candidate repeat block.
 *
 * Tag and class alone are not enough: every `<fieldset>` on a form shares those,
 * which made ordinary sibling sections look like a three-deep repeat and sent
 * fields off to read `education[3]`. What actually distinguishes a repeat is
 * that the blocks hold the *same fields*, so the control names go in too, with
 * digits collapsed so `school-1` and `school-2` still agree.
 */
function repeatSignature(el) {
  const hit = sigCache.get(el);
  if (hit !== undefined) return hit;

  const cls = typeof el.className === "string" ? el.className.replace(/\d+/g, "#") : "";
  const names = [];
  let controls;
  try { controls = el.querySelectorAll("input,select,textarea"); } catch { controls = []; }
  for (const c of controls) {
    names.push((c.name || c.id || c.type || "").replace(/\d+/g, "#"));
    if (names.length >= 12) break;
  }
  names.sort();

  const sig = `${el.tagName}|${cls}|${names.join(",")}`;
  sigCache.set(el, sig);
  return sig;
}

/**
 * Which repeat of which block this field belongs to.
 *
 * Returns { group, index }. `group` distinguishes independent repeaters on one
 * page so that two education sections each index from zero rather than fighting
 * over the same slots.
 *
 * Explicit indices in the attributes win — `educations[1][school]` and
 * `education.1.school` are unambiguous repeater syntax. Bare `_1_` is not
 * (`address_line_1`), so it is not treated as one.
 */
function instanceOf(el) {
  const attrs = `${el.name || ""} ${el.id || ""} ${el.getAttribute("data-automation-id") || ""}`;
  const explicit = attrs.match(/\[(\d+)\]/) || attrs.match(/\.(\d+)\./);
  let node = el.parentElement;

  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) break;

    const declared = node.getAttribute?.("data-repeat-group");
    if (declared) {
      const repeats = [...parent.children].filter((c) => c.getAttribute?.("data-repeat-group") === declared);
      if (repeats.length > 1) return { group: declared, index: explicit ? +explicit[1] : repeats.indexOf(node) };
    }

    const kids = parent.children;
    if (kids.length < 2 || kids.length > 50) continue;

    const sig = repeatSignature(node);
    if (sig.endsWith("|")) continue;                 // block holds no controls

    let index = -1;
    let count = 0;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i];
      if (repeatSignature(child) !== sig) continue;
      if (child === node) index = count;
      count++;
    }

    if (count > 1 && index >= 0) {
      let group = groupIds.get(parent);
      if (group === undefined) { group = nextGroupId++; groupIds.set(parent, group); }

      // Prefer an index the markup states outright; fall back to DOM position.
      return { group, index: explicit ? +explicit[1] : index };
    }
  }

  return { group: 0, index: explicit ? +explicit[1] : 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Split date controls
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_RE = /\b(month|mm)\b/;
const DAY_RE = /\b(day|dd)\b/;
const YEAR_RE = /\b(year|yyyy|yy)\b/;

function datePartOf(f) {
  if (f.kind === "date" || f.kind === "file" || f.kind === "textarea") return null;
  const hay = `${f.label} ${f.name} ${f.id} ${f.placeholder}`.toLowerCase();
  if (MONTH_RE.test(hay)) return "month";
  if (DAY_RE.test(hay)) return "day";
  if (YEAR_RE.test(hay)) return "year";
  return null;
}

/**
 * Merge adjacent month / day / year controls into one descriptor.
 *
 * They are laid out next to each other in every implementation of this pattern,
 * so a consecutive run is a reliable and cheap grouping signal. Left ungrouped,
 * each part matches on its own weak label and gets a whole date written into it.
 */
function groupDateParts(fields) {
  const out = [];
  let i = 0;

  while (i < fields.length) {
    const part = datePartOf(fields[i]);
    if (!part) { out.push(fields[i]); i++; continue; }

    const run = [{ part, field: fields[i] }];
    const seen = new Set([part]);
    let j = i + 1;
    while (j < fields.length) {
      const p = datePartOf(fields[j]);
      if (!p || seen.has(p)) break;
      if (fields[j].instance !== fields[i].instance) break;
      run.push({ part: p, field: fields[j] });
      seen.add(p);
      j++;
    }

    if (run.length >= 2) {
      const first = fields[i];
      const question = groupQuestion(first.el) || first.rawLabel || "";
      out.push({
        ...first,
        kind: "dategroup",
        label: question.toLowerCase(),
        rawLabel: question,
        // Re-tokenize from the question: the individual parts are named
        // "month"/"year", which say nothing about which date is being asked for.
        nameTokens: tokenize(`${question} ${first.name}`),
        parts: run,
        options: null,
        filled: run.every((r) => r.field.filled)
      });
      i = j;
    } else {
      out.push(fields[i]);
      i++;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visibility / fillability
// ─────────────────────────────────────────────────────────────────────────────

function isVisible(el, type) {
  if (el.disabled) return false;
  // An ARIA control has no `.disabled`; this attribute is the only statement it
  // makes. Writing into one is writing into a control the page has switched off.
  if (el.getAttribute?.("aria-disabled") === "true") return false;

  // A file input is almost never visible in its own right. Every ATS renders a
  // styled button or drop zone and hides the real control behind it —
  // display:none on Greenhouse, a 1x1 box on Workday, opacity:0 under a label on
  // Lever and Ashby — yet it stays the only element that can receive a file.
  // Judging it by the same rules as a text box discarded it on essentially every
  // real application, which is why the resume was almost never attached.
  if (type === "file") return el.isConnected !== false;

  // NOTE: `readOnly` is deliberately NOT a rejection. A read-only box is one we
  // must not write to, but it is still a field on the form — date pickers and
  // "click to choose" widgets are read-only text inputs on a great many sites,
  // and dropping them here made them invisible to the field count and to
  // "highlight what's still empty" as well as to the filler. scan() marks them
  // instead, which withholds them from the fill and keeps them on the books.

  const proxied = type === "radio" || type === "checkbox" || type === "switch" || el.tagName === "SELECT";

  if (typeof el.checkVisibility === "function") {
    // Radios and checkboxes on Greenhouse / Workday / Lever are deliberately
    // rendered at opacity:0 behind a styled proxy, yet they remain the real
    // fill target — so they only get the display:none test.
    const ok = proxied
      ? el.checkVisibility({ contentVisibilityAuto: true })
      : el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
    if (!ok) return false;
  }

  if (!proxied) {
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 10, height: 10 };
    if (r && (r.width <= 1 || r.height <= 1)) return false;   // zero-size honeypot
  }
  return true;
}

function isHoneypot(el) {
  const hay = `${el.name || ""} ${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`;
  if (HONEYPOT.test(hay)) return true;
  if (el.getAttribute("autocomplete") === "off" && el.tabIndex === -1) {
    const r = el.getBoundingClientRect?.();
    const zeroSize = r ? (r.width <= 1 || r.height <= 1) : false;
    const noLabel = !el.getAttribute("placeholder") && !el.getAttribute("aria-label");
    if (zeroSize && noLabel) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this text input the visible half of a dropdown?
 *
 * A <datalist> is deliberately not one: that is a suggestion list over a field
 * you are free to type anything into, and the text you type is the answer.
 */
function isComboInput(el) {
  const role = (el.getAttribute("role") || "").toLowerCase();
  if (role === "combobox" || role === "listbox") return true;
  if (el.hasAttribute("list")) return false;
  const popup = (el.getAttribute("aria-haspopup") || "").toLowerCase();
  return popup === "listbox" || popup === "menu";
}

function kindOf(el) {
  const tag = el.tagName;
  if (tag === "SELECT") return "select";
  if (tag === "TEXTAREA") return "textarea";
  if (tag === "BUTTON") {
    if (isComboInput(el) || el.getAttribute("data-automation-id")?.includes("prompt")) return "combobox";
  }
  if (tag === "INPUT") {
    const t = (el.type || "text").toLowerCase();
    if (t === "file") return "file";
    if (t === "radio") return "radio";
    if (t === "checkbox") return "checkbox";
    if (t === "date" || t === "month") return "date";
    // The tag alone does not settle this. Workday, Ashby, Greenhouse and most
    // design systems build a dropdown as <input role=combobox> over a listbox,
    // and reading it as an ordinary text box is exactly how an answer gets
    // typed into it in words instead of chosen from the menu it owns — the box
    // then shows "Yes" while the site holds no selection at all.
    if ((t === "text" || t === "search") && isComboInput(el)) return "combobox";
    return "text";
  }

  const role = (el.getAttribute("role") || "").toLowerCase();
  if (role === "radiogroup") return "radiogroup";
  if (ARIA_ROLE[role]) return ARIA_ROLE[role];
  if (el.isContentEditable) return "textarea";
  return "text";
}

/** True for a role-based stand-in rather than a native form control. */
function isAria(el) {
  return el.tagName !== "INPUT" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA";
}

/**
 * Options belonging to an ARIA group container.
 * A `[role=radiogroup]` is matched by the selector but owns no `.options` of
 * its own — filling one used to throw, taking the whole run down with it.
 */
function ariaOptionsFor(container, labelMap) {
  const owned = container.getAttribute("aria-owns");
  let nodes = [];
  if (owned) {
    const root = container.getRootNode?.() || document;
    nodes = owned.split(/\s+/)
      .map((id) => root.getElementById?.(id) || document.getElementById(id))
      .filter(Boolean);
  }
  if (!nodes.length) {
    try {
      nodes = Array.from(container.querySelectorAll('[role="radio"],[role="checkbox"],[role="option"]'));
    } catch { nodes = []; }
  }
  return nodes.map((n) => {
    const label = optionLabelFor(n, labelMap);
    const value = n.getAttribute?.("data-value") || n.getAttribute?.("value") || n.value || label || "";
    return { el: n, label, value };
  }).filter((o) => o.label);
}

/**
 * The choices a combobox offers without being opened.
 *
 * Most design-system comboboxes render their menu only on click, and for those
 * this finds nothing — which is correct; the filler reads them from the open
 * menu. But plenty put the listbox in the DOM up front (hidden, or referenced by
 * `aria-owns` from elsewhere on the page) or back a text input with a
 * <datalist>, and there the choices are knowable now.
 *
 * Knowing them is what stops a Yes/No dropdown being answered in words it never
 * offered: a descriptor with no options is described to the model as a free-text
 * box, and it answers one the way it answers any other — with a sentence.
 */
function comboboxOptions(el) {
  const root = el.getRootNode?.() || document;
  const byId = (id) => root.getElementById?.(id) || document.getElementById(id);

  const containers = [];
  for (const attr of ["aria-controls", "aria-owns"]) {
    const v = el.getAttribute(attr);
    if (!v) continue;
    for (const id of v.split(/\s+/)) {
      const n = byId(id);
      if (n) containers.push(n);
    }
  }
  const list = el.tagName === "INPUT" ? el.getAttribute("list") : "";
  if (list) {
    const dl = byId(list);
    if (dl) containers.push(dl);
  }
  // A `[role=listbox]` is its own option holder.
  if (!containers.length && (el.getAttribute("role") || "").toLowerCase() === "listbox") {
    containers.push(el);
  }

  const out = [];
  const seen = new Set();
  for (const c of containers) {
    let nodes;
    try { nodes = c.querySelectorAll('[role="option"],option,li'); } catch { continue; }
    for (const n of nodes) {
      if (seen.has(n) || out.length >= 200) continue;
      seen.add(n);
      // A <datalist> option carries its words in `value`, not in its text.
      const label = normalize(
        n.getAttribute("aria-label") || n.getAttribute("label") ||
        textOf(n, 80) || n.getAttribute("value") || ""
      );
      if (label) {
        out.push({ el: n, label, value: n.getAttribute("data-value") || n.getAttribute("value") || "" });
      }
    }
  }
  return out.length ? out : null;
}

/**
 * The container a set of ARIA radios belongs to.
 *
 * An explicit group wrapper is the answer when there is one. When there is not,
 * climb until an ancestor holds more than one of them: options wrapped in a div
 * each would otherwise become a field of their own, and a Yes/No question would
 * read as two separate questions named "Yes" and "No" — each of which the model
 * then answers on its own terms.
 */
function ariaGroupBox(el, role) {
  const explicit = el.closest('[role="radiogroup"],[role="group"],fieldset');
  if (explicit) return explicit;

  let node = el.parentElement;
  for (let depth = 0; node && depth < 5 && node.tagName !== "BODY"; depth++, node = node.parentElement) {
    let n = 0;
    try { n = node.querySelectorAll(`[role="${role}"]`).length; } catch { /* keep climbing */ }
    if (n > 1) return node;
  }
  return el.parentElement;
}

/** Checked state of an ARIA control, which has no `.checked` property. */
function ariaChecked(el) {
  const v = el.getAttribute("aria-checked") || el.getAttribute("aria-selected");
  return v === "true";
}

function atsFieldFor(el) {
  const auto = el.getAttribute("data-automation-id");
  if (auto && ATS_BY_AUTOMATION_ID[auto]) return ATS_BY_AUTOMATION_ID[auto];
  if (el.name && ATS_BY_NAME[el.name]) return ATS_BY_NAME[el.name];
  if (el.id && ATS_BY_ID[el.id]) return ATS_BY_ID[el.id];
  return null;
}

/** Label for a choice control — the text of the option, not the question. */
function optionLabelFor(el, labelMap) {
  const ariaLabel = el.getAttribute?.("aria-label");
  if (ariaLabel) {
    const t = normalize(ariaLabel);
    if (t) return t;
  }

  const by = el.getAttribute?.("aria-labelledby");
  if (by) {
    const root = el.getRootNode?.() || document;
    let parts = "";
    for (const id of by.trim().split(/\s+/)) {
      if (!id) continue;
      const ref = root.getElementById?.(id) || document.getElementById?.(id);
      if (ref) parts += " " + textOf(ref, 80);
    }
    const t = normalize(parts);
    if (t) return t;
  }

  if (el.id && labelMap?.has?.(el.id)) {
    const t = textOf(labelMap.get(el.id), 80);
    if (t) return t;
  }
  const wrap = el.closest?.("label, .docssharedWizToggleLabeledContainer, [data-value]");
  if (wrap) {
    const t = textOf(wrap, 80);
    if (t) return t;
  }
  const next = el.nextElementSibling;
  if (next && !SKIP_TAGS.has(next.tagName)) {
    const t = textOf(next, 80);
    if (t) return t;
  }
  const selfText = textOf(el, 80);
  if (selfText) return selfText;

  return normalize(el.getAttribute?.("data-value") || el.value || "");
}

/**
 * The question a radio group is answering — i.e. the label of the group, not of
 * any single option. v1 matched each radio against its own "Yes"/"No" text,
 * which carries no information about what is being asked; this is why work
 * authorization questions were routinely missed.
 */
function groupQuestion(el) {
  // The group's own ARIA label comes first, and the ordering is the point. A
  // fieldset legend names whatever section the group sits in — "Additional
  // information", "Required and unanswered" — while an aria-label on the group
  // itself is the question being asked. Checking the legend first meant every
  // ARIA radio group inside a fieldset was matched against the section heading,
  // so two different questions in one section looked identical to the matcher.
  const rg = el.closest?.('[role="radiogroup"],[role="group"]');
  if (rg) {
    const aria = rg.getAttribute("aria-label");
    if (aria && !isGenericLabel(aria)) return normalize(aria);
    // `aria-labelledby` is a *list* of ids. Passing the raw attribute to
    // getElementById finds nothing the moment a page names two elements —
    // "legend-1 hint-1" is not an id — and the question then fell through to the
    // section heading, which on a form is usually the name of the whole section.
    const by = rg.getAttribute("aria-labelledby");
    if (by) {
      const root = rg.getRootNode?.() || document;
      const ids = by.trim().split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const ref = root.getElementById?.(id) || document.getElementById?.(id);
        if (ref && (ref.getAttribute?.("role") === "heading" || /^H[1-6]$/i.test(ref.tagName) || /heading|title|question/i.test(ref.className || ""))) {
          const ht = normalize(textOf(ref, 150));
          if (ht && !isGenericLabel(ht)) return ht;
        }
      }
      if (ids.length > 1) {
        const firstRef = root.getElementById?.(ids[0]) || document.getElementById?.(ids[0]);
        if (firstRef) {
          const ft = normalize(textOf(firstRef, 150));
          if (ft && ft.length >= 2 && !isGenericLabel(ft)) return ft;
        }
      }
      let parts = "";
      for (const id of ids) {
        const ref = root.getElementById?.(id) || document.getElementById?.(id);
        if (ref) parts += " " + textOf(ref, 120);
      }
      const t = normalize(parts);
      if (t && !isGenericLabel(t)) return t;
    }
  }

  // Google Forms question container
  const gFormItem = el.closest?.('[role="listitem"], .geS5n, .Qr7Oae, [data-item-id], .freebirdFormviewerViewItemsItemItem');
  if (gFormItem) {
    const qHeading = gFormItem.querySelector?.('[role="heading"], .M7eMe, .HoN3Ob, .freebirdFormviewerComponentsQuestionBaseTitle');
    if (qHeading && !qHeading.contains(el) && !isFormControl(qHeading)) {
      const ht = normalize(textOf(qHeading, 250));
      if (ht && !isGenericLabel(ht)) return ht;
    }
  }

  // Then the enclosing fieldset's legend. For native radios — which carry no
  // ARIA of their own — this is the question, and it stays the main path.
  const fs = el.closest?.("fieldset");
  if (fs) {
    const lg = fs.querySelector?.(":scope > legend");
    if (lg) {
      const t = textOf(lg, 200);
      if (t && !isGenericLabel(t)) return t;
    }
  }

  // Question container wrapper label or heading before falling back to section heading.
  let node = el.parentElement;
  for (let depth = 0; node && depth < 5 && node !== document.body; depth++, node = node.parentElement) {
    if (node.tagName === "FIELDSET") break;
    const qLabel = node.querySelector?.(":scope > label, :scope > [class*='label' i], :scope > [class*='question' i], :scope > [class*='title' i]");
    if (qLabel && !qLabel.contains(el) && !isFormControl(qLabel)) {
      const t = textOf(qLabel, 200);
      if (t && t.length < 200 && !isGenericLabel(t)) return t;
    }
    const heading = node.querySelector?.('[role="heading"]');
    if (heading && !heading.contains(el) && !heading.querySelector?.('[role="radio"],[role="checkbox"]') && !isFormControl(heading)) {
      const t = textOf(heading, 200);
      if (t && t.length < 200 && !isGenericLabel(t)) return t;
    }
    let sib = node.previousElementSibling;
    for (let i = 0; sib && i < 2; i++, sib = sib.previousElementSibling) {
      if (isFormControl(sib)) break;
      if (sib.matches?.(HEADING_SELECTOR) || sib.tagName === "LABEL" || /label|question|title/i.test(sib.className || "")) {
        const t = textOf(sib, 200);
        if (t && t.length < 200 && !isGenericLabel(t)) return t;
      }
    }
  }

  // Fall back to the nearest heading-ish text above the group container.
  const sec = sectionFor(el);
  return sec.text || "";
}

const COMBO_PLACEHOLDER_RE = /^[\s\u00a0-]*(\b(select(\s+(one|an?\s+option))?|choose(\s+(one|an?\s+option))?|please\s+select|none|search|type\s+to\s+search)\b)?[\s\u00a0-]*$/i;

function isComboboxFilled(el) {
  if (el.ownerDocument && el.getRootNode && !el.hasAttribute("list")) return selectedValues(el).length > 0;
  const vt = el.getAttribute?.("aria-valuetext") || el.getAttribute?.("aria-valuenow");
  if (vt && !COMBO_PLACEHOLDER_RE.test(vt)) return true;

  if (el.value && el.value.trim() && !COMBO_PLACEHOLDER_RE.test(el.value.trim())) return true;

  if (el.tagName === "BUTTON" || isAria(el)) {
    const text = normalize(el.textContent || "");
    if (text && !COMBO_PLACEHOLDER_RE.test(text)) return true;
  }

  let parent = el.parentElement;
  for (let d = 0; d < 3 && parent && parent !== document.body; d++, parent = parent.parentElement) {
    const selectedItem = parent.querySelector?.(
      '[class*="singleValue" i],' +
      '[class*="single-value" i],' +
      '[class*="selectedItem" i],' +
      '[class*="selected-item" i],' +
      '[data-automation-id*="selectedItem"],' +
      '[data-automation-id*="activeChip"],' +
      '[class*="chip" i],' +
      '[class*="pill" i]'
    );
    if (selectedItem) {
      const st = normalize(selectedItem.textContent || "");
      if (st && !COMBO_PLACEHOLDER_RE.test(st)) return true;
    }
  }

  return false;
}

/** Check if an existing file upload is detected on or around this file input. */
function hasExistingUpload(el) {
  if (el.files && el.files.length > 0) return true;
  let node = el.parentElement;
  const docBody = globalThis.document?.body;
  for (let depth = 0; node && depth < 4 && (!docBody || node !== docBody); depth++, node = node.parentElement) {
    // If this container holds multiple file inputs, it is a shared section or whole form,
    // not this specific control's upload wrapper. Stop climbing to avoid cross-field false positives.
    if (node.querySelectorAll?.('input[type="file"]').length > 1) break;

    if (node.querySelector?.(
      '[data-automation-id*="file-upload-item"],' +
      '[data-automation-id*="uploadedFile"],' +
      '[data-automation-id*="delete-file"],' +
      '[class*="uploaded" i],' +
      '[class*="fileName" i],' +
      '[class*="file-name" i],' +
      '[class*="file_name" i],' +
      '[class*="fileItem" i],' +
      '[class*="file-item" i],' +
      '[class*="attachment" i],' +
      '[id*="resume_filename"],' +
      '[data-automation-id*="file"] button,' +
      '[class*="file" i] button,' +
      '[class*="upload" i] button,' +
      '[class*="attach" i] button,' +
      'button[aria-label*="remove file" i],button[aria-label*="delete file" i],button[aria-label*="delete upload" i],button[aria-label*="remove attachment" i],button[aria-label*="delete attachment" i],button[aria-label*="remove resume" i],button[aria-label*="delete resume" i],' +
      'button[title*="remove file" i],button[title*="delete file" i],button[title*="remove attachment" i],button[title*="delete attachment" i],button[title*="remove resume" i],button[title*="delete resume" i]'
    )) return true;
    const text = node.textContent || "";
    if (/[\w-]{2,}\.(?:pdf|docx?|odt|rtf|txt)\b/i.test(text) && !/accepted|supported|max\s*\d+|format/i.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Scan the frame and return field descriptors.
 *
 * Radios and checkboxes sharing a name become a single "radiogroup" descriptor
 * carrying its options, so the matcher sees the question rather than the answers.
 */
function scan(customRoot = null) {
  sectionCache = new WeakMap(); // SPA labels/sections must be recomputed for each scan.
  const roots = customRoot ? [customRoot] : getRoots();
  const labelMap = buildLabelMap(roots);

  const raw = [];
  for (const root of roots) {
    let found;
    try { found = root.querySelectorAll(FIELD_SELECTOR); } catch { continue; }
    for (const el of found) raw.push(el);
  }

  const fields = [];
  const groups = new Map();          // group key -> descriptor index
  const ariaGroupKeys = new Map();   // container element -> synthetic group key
  const seen = new Set();

  for (const el of raw) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (el.closest?.(OWN_UI)) continue;
    if(el.matches?.('.select2-selection__rendered[aria-readonly="true"]'))continue;

    const kind = kindOf(el);
    if (!isVisible(el, kind)) continue;
    if (kind !== "radio" && kind !== "checkbox" && isHoneypot(el)) continue;

    // ── An ARIA group container carries its own options ──
    if (kind === "radiogroup") {
      const question = groupQuestion(el) || labelFor(el, labelMap);
      const sec = sectionFor(el);
      const rep = instanceOf(el);
      const options = ariaOptionsFor(el, labelMap);
      if (!options.length) continue;              // nothing fillable inside
      for (const o of options) seen.add(o.el);    // don't re-emit them individually
      fields.push({
        el, kind: "radiogroup",
        label: (question || "").toLowerCase(), rawLabel: question,
        helperText: helperTextFor(el),
        sectionTitle: sec.text || "",
        name: el.getAttribute("name") || "", id: el.id || "",
        type: "radio", placeholder: "", autocomplete: "",
        nameTokens: tokenize(`${question} ${el.id || ""}`),
        atsField: atsFieldFor(el),
        section: sec.kind, instance: rep.index, repeatGroup: rep.group,
        skip: sec.foreign,
        options,
        filled: options.some((o) => ariaChecked(o.el))
      });
      continue;
    }

    // ── Choice controls collapse into one descriptor per group ──
    // Native radios group by `name`. ARIA radios have no name, so they group by
    // their nearest container instead — otherwise every option becomes its own
    // field and the matcher sees "Yes"/"No" instead of the question.
    const aria = isAria(el);
    const groupable = kind === "radio" || (kind === "checkbox" && (aria || el.name));

    if (groupable) {
      let key;
      if (aria) {
        const box = ariaGroupBox(el, kind);
        if (!ariaGroupKeys.has(box)) ariaGroupKeys.set(box, `aria${ariaGroupKeys.size}`);
        key = `${kind}:${ariaGroupKeys.get(box)}`;
      } else {
        key = `${kind}:${el.name || el.id}`;
      }

      let idx = groups.get(key);
      if (idx === undefined) {
        const question = groupQuestion(el) || labelFor(el, labelMap);
        const sec = sectionFor(el);
        const rep = instanceOf(el);
        idx = fields.length;
        fields.push({
          el,
          kind: kind === "radio" ? "radiogroup" : "checkboxgroup",
          label: (question || "").toLowerCase(),
          rawLabel: question,
          helperText: helperTextFor(el),
          sectionTitle: sec.text || "",
          name: el.name || "",
          id: el.id || "",
          type: kind,
          placeholder: "",
          autocomplete: "",
          nameTokens: tokenize(`${el.name || ""} ${el.id || ""} ${aria ? question : ""}`),
          atsField: atsFieldFor(el),
          section: sec.kind,
          instance: rep.index,
          repeatGroup: rep.group,
          skip: sec.foreign,
          options: [],
          filled: false
        });
        groups.set(key, idx);
      }
      const d = fields[idx];
      const optLabel = optionLabelFor(el, labelMap);
      const optVal = el.getAttribute("data-value") || el.getAttribute("value") || el.value || optLabel || "";
      d.options.push({
        el,
        label: optLabel,
        value: optVal
      });
      if (aria ? ariaChecked(el) : el.checked) d.filled = true;
      continue;
    }

    // ── Everything else ──
    const label = labelFor(el, labelMap);
    const sec = sectionFor(el);
    const rep = instanceOf(el);
    const name = el.name || "";
    const id = el.id || "";

    const d = {
      el,
      kind,
      label: label.toLowerCase(),
      rawLabel: label,
      helperText: helperTextFor(el),
      sectionTitle: sec.text || "",
      name,
      id,
      type: (el.type || "").toLowerCase(),
      placeholder: el.getAttribute("placeholder") || "",
      autocomplete: el.getAttribute("autocomplete") || "",
      nameTokens: tokenize(`${name} ${id} ${el.getAttribute("data-automation-id") || ""}`),
      atsField: atsFieldFor(el),
      section: sec.kind,
      instance: rep.index,
      repeatGroup: rep.group,
      skip: sec.foreign,
      options: null,
      filled: false
    };

    // Read-only, and not the visible half of a dropdown: the page is telling us
    // this value is not typed in. Counted and reviewable, never written to.
    if (el.readOnly && kind !== "combobox") {
      d.readOnly = true;
      d.skip = true;
    }

    if (kind === "select") {
      d.options = Array.from(el.options)
        .map((o) => ({ el: o, label: normalize(o.text), value: o.value }))
        .filter((o) => o.label && !COMBO_PLACEHOLDER_RE.test(o.label) && !/^(--\s*)?(select|choose|please select)/i.test(o.label));
      const selectedOpt = el.options[el.selectedIndex];
      const isPlaceholder = selectedOpt && (COMBO_PLACEHOLDER_RE.test(selectedOpt.text || "") || /^(--\s*)?(select|choose|please select)/i.test(selectedOpt.text || ""));
      d.filled = el.selectedIndex >= 0 && !isPlaceholder && !!el.value;
    } else if (kind === "checkbox") {
      d.filled = isAria(el) ? ariaChecked(el) : el.checked;
      d.options = [{ el, label: optionLabelFor(el, labelMap), value: el.value || "" }];
    } else if (kind === "switch") {
      // Its state is the answer, and it offers no options to choose between —
      // describing it with any would invite the model to reply with the toggle's
      // own wording instead of yes or no.
      d.filled = ariaChecked(el);
      d.options = null;
    } else if (kind === "file") {
      d.filled = !!(el.files && el.files.length > 0) || hasExistingUpload(el);
      d.accept = el.getAttribute("accept") || "";
      // A hidden input carries none of the words a human reads. "Attach resume"
      // lives on the button, "Drop your CV here" on the zone — so the wrapper is
      // where the descriptor has to get its meaning from.
      d.uploadContext = uploadContextFor(el);
      d.className = typeof el.className === "string" ? el.className : "";
    } else if (kind === "combobox") {
      d.filled = isComboboxFilled(el);
    } else if (isAria(el)) {
      // An ARIA textbox/combobox holds its value as text, not in `.value`.
      d.filled = !!(el.textContent?.trim() || el.value?.trim());
    } else {
      d.filled = !!(el.value && el.value.trim());
    }

    // Left to the end so the `filled` rules above stay exactly as they were —
    // this only adds what the control offers, when that is readable up front.
    if (kind === "combobox") d.options = comboboxOptions(el);
    if(kind==='combobox' && el.matches('.select2-selection')) {
      const backing=el.closest('.select2-container')?.previousElementSibling;
      if(backing?.tagName==='SELECT' && !backing.multiple) {
        d.nativeSelect=backing;d.name=backing.name;d.id=backing.id;d.nameTokens=tokenize(backing.name+' '+backing.id);
        d.options=[...backing.options].filter(o=>o.value).map(o=>({el:o,label:normalize(o.text),value:o.value}));
        d.filled=!!backing.value;
        if(/phone.*\.countryCode$/i.test(backing.name)) {d.phonePart='code';d.atsField='phoneCountryCode';}
      }
    }

    fields.push(d);
  }

  const descriptors=groupDateParts(fields).map((field) => describe(field, resolveLabels(field.el, labelMap, fallbackLabelFor, isGenericLabel)));
  for(const code of descriptors.filter(f=>f.nativeSelect && f.phonePart==='code')) {
    const prefix=code.nativeSelect.name.replace(/\.countryCode$/i,'');
    const number=descriptors.filter(f=>f.name===prefix+'.number' && code.nativeSelect.parentElement.parentElement.contains(f.el));
    if(number.length===1)number[0].phonePart='national';
  }
  // Some forms use one Mobile Phone label for both a dial-code select and
  // its number input. Identify the pair from local controls and code choices.
  for(const code of descriptors.filter(f=>f.kind==="select" && /phone|mobile|telephone/i.test(f.rawLabel))) {
    if(!code.options?.length || !code.options.every(o=>/^\+?\d{1,4}$/.test(o.value.trim())) || !code.options.some(o=>/\+\d{1,4}/.test(o.label)))continue;
    const box=code.el.parentElement;
    const numbers=descriptors.filter(f=>f!==code && box.contains(f.el) && ["text","tel"].includes(f.type) && /phone|mobile|telephone/i.test(f.rawLabel));
    if(numbers.length!==1 || box.querySelectorAll('select,input:not([type="hidden"])').length!==2)continue;
    code.phonePart="code";code.atsField="phoneCountryCode";
    numbers[0].phonePart="national";
  }
  return descriptors;
}

/**
 * Every control this frame holds, before any of `scan()`'s judgement is applied.
 *
 * This exists for the "what's still empty" check, and the point of it is that it
 * shares none of `scan()`'s reasoning. A review built on `scan()` can only ever
 * agree with it: a field the scanner drops — because a wrapper measured zero,
 * because a name matched the honeypot pattern, because the shadow-root cache was
 * stale when it ran — is a field the review then reports as complete. That is
 * the worst failure this extension has, because it is the one that tells you a
 * form is ready to submit when two required boxes are empty.
 *
 * The shadow cache is dropped first for the same reason: a review that trusts a
 * cache built during the fill inherits whatever that cache had already missed.
 */
function rawControls() {
  invalidateShadowCache();

  const out = [];
  for (const root of getRoots()) {
    let found;
    try { found = root.querySelectorAll(FIELD_SELECTOR); } catch { continue; }
    for (const el of found) out.push(el);
  }
  return out;
}

/**
 * Why `scan()` would refuse this control, or "" if it would keep it.
 *
 * Diagnostic only, and deliberately written as the same sequence of tests in the
 * same order: when the review turns up a field the filler never saw, this is
 * what says which rule threw it away, in one console line, instead of leaving it
 * to be guessed at from the outside.
 */
function whyDropped(el) {
  if (el.closest?.(OWN_UI)) return "belongs to our own panel";
  const kind = kindOf(el);
  if (el.disabled) return "disabled";
  if (el.getAttribute?.("aria-disabled") === "true") return "aria-disabled";
  if (!isVisible(el, kind)) {
    const r = el.getBoundingClientRect?.();
    return `judged invisible (${r ? `${Math.round(r.width)}x${Math.round(r.height)}px` : "no box"})`;
  }
  if (kind !== "radio" && kind !== "checkbox" && isHoneypot(el)) return "matched the honeypot test";
  return "";
}

/** Cheap probe used by the sentinel: does this frame hold a real form? */
function countFillable() {
  let n = 0;
  const els = document.querySelectorAll("input,select,textarea");
  for (const el of els) {
    const t = (el.type || "text").toLowerCase();
    if (t === "hidden" || t === "submit" || t === "button" || el.disabled) continue;
    n++;
  }
  return n;
}

Object.assign(__x, { invalidateShadowCache, surfaceInventory, GENERIC_LABEL_RE, isGenericLabel, labelFor, helperTextFor, labelOf, optionLabelFor, COMBO_PLACEHOLDER_RE, isComboboxFilled, hasExistingUpload, scan, rawControls, whyDropped, countFillable });
};

__m["src/engine/discovery/labels.js"] = (__x, __req) => {
// Question text is semantic input. Display shortening belongs in the UI.
const { scopeForQuestion } = __req("src/shared/field-identity.js");
function cleanText(value) {
  return String(value || "").replace(/[\s\u00a0]+/g, " ").replace(/[*:•]+\s*$/, "").trim();
}
const skip = new Set(["INPUT", "SELECT", "TEXTAREA", "OPTION", "BUTTON", "SCRIPT", "STYLE", "SVG"]);
let questionFixes = {};
function configureQuestionFixes(records) { questionFixes = records || {}; }
function locatorFor(el) {
  return el.id ? `id:${el.id}` : el.name ? `name:${el.name}` : el.getAttribute?.("data-automation-id") ? `automation:${el.getAttribute("data-automation-id")}` : "";
}
function questionScope(url) { return scopeForQuestion(url); }
function fullText(el) {
  if (!el) return "";
  if (!el.firstChild) return cleanText(el.textContent);
  const parts = [];
  const walk = (node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) parts.push(child.nodeValue);
      else if (child.nodeType === 1 && !skip.has(String(child.tagName).toUpperCase()) && !["option", "listbox", "combobox", "menu", "menuitem", "button", "radio", "checkbox", "textbox", "switch"].includes(child.getAttribute?.("role")) && child.getAttribute?.("aria-hidden") !== "true") walk(child);
    }
  };
  walk(el);
  return cleanText(parts.join(""));
}
function references(el, attribute) {
  const root = el.getRootNode?.() || globalThis.document;
  const seen = new Set();
  return String(el.getAttribute?.(attribute) || "").trim().split(/\s+/).filter((id) => id && !seen.has(id) && seen.add(id))
    .map((id) => ({ id, text: fullText(root?.getElementById?.(id)) })).filter((r) => r.text);
}
function labelCandidates(el, map, generic) {
  const candidates = [];
  const add = (source, text) => { text = cleanText(text); if (text) candidates.push({ source, text, generic: generic(text) }); };
  // Select2 labels its trigger with the selected value, not the question.
  if(!el.matches?.('.select2-selection'))add("aria-labelledby", references(el, "aria-labelledby").map((r) => r.text).join(" "));
  add("aria-label", el.getAttribute?.("aria-label"));
  const labels = el.labels ? [...el.labels] : [];
  const mapped = map?.roots?.get(el.getRootNode?.())?.get(el.id) || map?.get(el.id);
  if (!labels.length && mapped) labels.push(...(Array.isArray(mapped) ? mapped : [mapped]));
  if (labels.length) add("label", [...new Set(labels.map(fullText).filter(Boolean))].join(" "));
  const wrap = el.closest?.("label");
  if (wrap && !labels.includes(wrap)) add("wrapping-label", fullText(wrap));
  const item = el.closest?.('[role="listitem"],.field,[data-automation-id="formField"]');
  const heading = item?.querySelector?.('[role="heading"],.question-title,.M7eMe,.HoN3Ob');
  if (heading && heading !== el && !heading.contains?.(el)) add("visible-heading", fullText(heading));
  return candidates;
}
function resolveLabels(el, map, fallback, generic) {
  const candidates = labelCandidates(el, map, generic);
  const primary = candidates.find((c) => !c.generic);
  const fallbackText = !primary ? fallback(el, map) : "";
  if (fallbackText) candidates.push({ source: "visible-context", text: fallbackText, generic: generic(fallbackText) });
  const question = primary?.text || fallbackText || "";
  const comparable = (s) => cleanText(s).toLocaleLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
  const conflict = candidates.filter((c) => !c.generic).some((c) => {
    const a = comparable(c.text), b = comparable(question);
    return a && b && a !== b && !a.includes(b) && !b.includes(a);
  });
  const scope = globalThis.location?.href ? questionScope(location.href) : "";
  const fix = questionFixes[scope]?.[locatorFor(el)];
  if (fix?.original === question && fix.question) return { question: fix.question,
    candidates: [...candidates, { source: "user-corrected", text: fix.question, generic: false }], ambiguous: false, conflicting: false, truncated: false };
  return { question, candidates, ambiguous: conflict || !question || generic(question), conflicting: conflict, truncated: false };
}

Object.assign(__x, { cleanText, configureQuestionFixes, locatorFor, questionScope, fullText, references, labelCandidates, resolveLabels });
};

__m["src/engine/discovery/descriptor.js"] = (__x, __req) => {
const identities = new WeakMap();
let sequence = 0;
function describe(field, labels) {
  const question = labels.candidates.some((c) => c.source === "user-corrected") ? labels.question : field.rawLabel || labels.question;
  const fingerprint = JSON.stringify([question, field.helperText, field.sectionTitle, field.instance, field.kind,
    (field.options || []).map((o) => [o.label, o.value])]);
  let identity = identities.get(field.el);
  if (!identity) { identity = { fieldId: `field-${++sequence}`, fingerprint, revision: 1 }; identities.set(field.el, identity); }
  else if (identity.fingerprint !== fingerprint) { identity.fingerprint = fingerprint; identity.revision++; }
  return { ...field, rawLabel: question, label: question.toLowerCase(), fieldId: identity.fieldId, formRevision: identity.revision, questionFull: question,
    accessibleName: labels.question, labelCandidates: labels.candidates,
    visiblePrompt: labels.candidates.find((c) => ["label", "wrapping-label", "visible-heading", "visible-context"].includes(c.source))?.text || "",
    extraction: { ambiguous: labels.ambiguous, conflicting: labels.conflicting, truncated: labels.truncated, sources: labels.candidates.map((c) => c.source) },
    sectionPath: field.sectionTitle ? [field.sectionTitle] : [],
    entityId: `${field.section || "personal"}:${field.instance || 0}`,
    required: !!field.el.required || field.el.getAttribute?.("aria-required") === "true",
    optionsComplete: !!field.nativeSelect || !["combobox"].includes(field.kind),
    constraints: { maxLength: field.el.maxLength > 0 ? field.el.maxLength : null, min: field.el.min || null, max: field.el.max || null, pattern: field.el.pattern || null }
  };
}

Object.assign(__x, { describe });
};

__m["src/engine/controls/read.js"] = (__x, __req) => {
const { selectedValues } = __req("src/engine/controls/workday.js");
const checked = el => typeof el?.checked === "boolean" ? el.checked : el?.getAttribute?.("aria-checked") === "true" || el?.getAttribute?.("aria-selected") === "true";
function controls(field) { return [...new Set([field.el, field.nativeSelect, ...(field.parts || []).map(p => p.field?.el), ...(field.kind === "combobox" ? [] : field.options || []).map(o => o.el)].filter(Boolean))]; }
function readControl(field) {
  const el = field.el;
  if (field.kind === "file") return [...el.files || []].map(f => ({ name: f.name, size: f.size, type: f.type }));
  if (["checkbox", "switch"].includes(field.kind)) return checked(el);
  if (["radiogroup", "checkboxgroup"].includes(field.kind)) return (field.options || []).filter(o => checked(o.el)).map(o => o.value || o.label);
  if (field.kind === "dategroup") return (field.parts || []).map(p => [p.part, readControl(p.field)]);
  if (field.kind === "combobox") {
    if(field.nativeSelect) {
      const text=field.nativeSelect.selectedOptions[0]?.text.trim(),rendered=el.querySelector('.select2-selection__rendered')?.textContent.trim();
      return field.nativeSelect.value && text===rendered ? [text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()] : [];
    }
    if(el.hasAttribute("list") || ["both","inline"].includes(el.getAttribute("aria-autocomplete"))) return el.value ? [String(el.value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()] : [];
    return selectedValues(el);
  }
  if (field.kind === "select" && el.multiple) return [...el.selectedOptions].map(o => o.value);
  return el.isContentEditable ? el.textContent || "" : String(el.value ?? el.textContent ?? "");
}
function validationState(field) {
  const els = controls(field), invalid = els.some(el => el.getAttribute?.("aria-invalid") === "true" || el.validity?.valid === false);
  const ids = els.flatMap(el => (el.getAttribute?.("aria-errormessage") || "").split(/\s+/).filter(Boolean));
  const error = ids.some(id => { const el = field.el.getRootNode().getElementById?.(id) || field.el.ownerDocument.getElementById(id); return el?.getClientRects().length && el.textContent?.trim(); });
  return invalid || error ? "failed" : els.some(el => el.validity || el.hasAttribute?.("aria-invalid") || el.hasAttribute?.("aria-errormessage")) ? "passed" : "not_exposed";
}

Object.assign(__x, { checked, controls, readControl, validationState });
};

__m["src/engine/verify.js"] = (__x, __req) => {
const { readControl, controls, validationState } = __req("src/engine/controls/read.js");
const { rankChoices } = __req("src/engine/controls/workday.js");
const { asBool, parseDate, datePartValue, monthName } = __req("src/shared/values.js");
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const norm = v => String(v ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
function accepts(field, value, ruleId) {
  const actual = readControl(field), targets = Array.isArray(value) ? value : [value];
  if (["checkbox", "switch"].includes(field.kind)) return actual === asBool(value);
  if (["select", "radiogroup", "checkboxgroup"].includes(field.kind)) {
    const desired = targets.map(v => rankChoices(field.options || [], v, ruleId).choice);
    if (desired.some(v => !v)) return false;
    const want = desired.map(o => String(o.value || o.label));
    return Array.isArray(actual) ? same([...actual].sort(),want.sort()) : actual === want[0];
  }
  if (field.kind === "combobox") return targets.every(v => actual.includes(norm(v))) || targets.length === 1 && actual.includes(norm(field.controlOutcome?.value)) && !!field.controlOutcome?.value;
  if (field.kind === "dategroup") {
    const date = parseDate(value); if (!date) return false;
    return field.parts.every(p => { const raw=readControl(p.field), part=datePartValue(date,p.part); return Number(raw) === Number(part) || p.part === "month" && p.field.el.tagName === "SELECT" && norm(p.field.el.selectedOptions[0]?.text).slice(0,3) === norm(monthName(date.month)).slice(0,3); });
  }
  if (field.kind === "file") return actual.length === 1 && actual[0].name === value.name && actual[0].size === value.size;
  if (field.kind === "date" || ruleId && /Date$/.test(ruleId)) {
    const expected=parseDate(value), observed=parseDate(actual); return !!expected && !!observed && expected.year === observed.year && (!expected.month || expected.month === observed.month) && (!expected.day || expected.day === observed.day);
  }
  if(ruleId==="phone" || field.type==="tel") {
    const da = String(actual).replace(/\D/g,""), dv = String(value).replace(/\D/g,"");
    return (da === dv || (da.length >= 7 && dv.length >= 7 && (da.endsWith(dv) || dv.endsWith(da)))) && /\d/.test(dv);
  }
  if(field.type==="number")return Number.isFinite(Number(value))&&actual!==""&&Number(actual)===Number(value);
  const aNorm = String(actual).replace(/\r\n/g,"\n"), vNorm = String(value).replace(/\r\n/g,"\n");
  return aNorm === vNorm || aNorm.trim() === vNorm.trim();
}
function verificationTicket(field, questionOf) {
  const question=questionOf(field.el), elements=controls(field), initial=readControl(field);
  const context=()=>{const box=field.el.closest('fieldset,[data-automation-id="workExperienceItem"],[data-automation-id="educationItem"]');return JSON.stringify([box?.querySelector('legend,h2,h3,h4')?.textContent||"",elements.map(el=>[el.name,el.type,el.disabled,el.readOnly,el.maxLength,el.min,el.max,el.pattern,el.getAttribute?.("aria-label"),el.getAttribute?.("aria-describedby"),(el.getAttribute?.("aria-describedby")||"").split(/\s+/).map(id=>el.getRootNode().getElementById?.(id)?.textContent||"")]),field.kind==="select"?[...field.el.options].map(o=>[o.value,o.text,o.disabled]):null]);};
  const signature=context();
  let edited=false, writing=false;
  const edit=e=>{if(e.isTrusted && !writing) edited=true;};
  elements.forEach(el=>{el.addEventListener("input",edit);el.addEventListener("change",edit);});
  return { initial, get edited(){return edited;}, valid:()=>!edited && elements.every(el=>el.isConnected) && questionOf(field.el)===question && context()===signature,
    writing:fn=>{writing=true;try{return fn();}finally{writing=false;}}, dispose:()=>elements.forEach(el=>{el.removeEventListener("input",edit);el.removeEventListener("change",edit);}) };
}
async function verify(field, value, ruleId, ticket, { settleMs=450, isCancelled=()=>false }={}) {
  const deadline=Date.now()+settleMs;
  let persistent=true;
  do {
    if(isCancelled() || !ticket.valid()) return { status:"deferred", writeAttempted:true, domAccepted:false, validation:"not_checked", reason:isCancelled()?"cancelled":ticket.edited?"user_edit":"stale_descriptor" };
    persistent &&= accepts(field,value,ruleId);
    await new Promise(r=>setTimeout(r,Math.min(50,Math.max(1,deadline-Date.now()))));
  } while(Date.now()<deadline);
  const validation=validationState(field), domAccepted=persistent && accepts(field,value,ruleId);
  return { status:domAccepted && validation!=="failed"?"verified":"rejected",writeAttempted:true,domAccepted,validation,
    reason:!domAccepted?"value_not_persistent":validation==="failed"?"validation_failed":"canonical_value_persistent" };
}
function guardUndo(field, restore) {
  let expected, edited=false, armed=false;
  const elements=controls(field), edit=e=>{if(armed && e.isTrusted) edited=true;};
  const dispose=()=>{armed=false;elements.forEach(el=>{el.removeEventListener("input",edit);el.removeEventListener("change",edit);});};
  const undo=()=>{if(!armed || edited || elements.some(el=>!el.isConnected) || !same(readControl(field),expected)){dispose();return false;}const restored=restore();dispose();return restored!==false;};
  undo.arm=()=>{expected=structuredClone(readControl(field));armed=true;elements.forEach(el=>{el.addEventListener("input",edit);el.addEventListener("change",edit);});};
  undo.dispose=dispose;return undo;
}

Object.assign(__x, { accepts, verificationTicket, verify, guardUndo });
};

__m["src/engine/dependencies.js"] = (__x, __req) => {
// Observe only changed form regions; control writes and UI decorations do not
// require another whole-page search.
const UI="#applykaro-root,#applykaro-field-root";
function dependencyPriority(field, ruleId="") {
  if (/country/i.test(ruleId)) return 0;
  if (/university|school/i.test(ruleId)) return 1;
  if (["checkbox","switch"].includes(field.kind)) return 2;
  if (/state|province|degree/i.test(ruleId)) return 3;
  return 4;
}
function trackDependencies(root=document) {
  const regions=new Set();
  const observer=new MutationObserver(records=>{
    for(const record of records) {
      const target=record.target.nodeType===1?record.target:record.target.parentElement;
      if(!target || target.closest?.(UI))continue;
      const added=[...record.addedNodes].filter(n=>n.nodeType===1 && !n.matches?.(UI) && !n.closest?.(UI));
      if(record.type==="childList" && added.some(n=>n.matches?.('input,select,textarea,[role="combobox"]') || n.querySelector?.('input,select,textarea,[role="combobox"]'))) regions.add(target);
      if(record.type==="attributes" && ["disabled","hidden","aria-hidden"].includes(record.attributeName))regions.add(target.parentElement||target);
    }
  });
  observer.observe(root.documentElement||root,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled","hidden","aria-hidden"]});
  return { take:()=>{const out=[...regions].filter(n=>n.isConnected);regions.clear();return out.filter(n=>!out.some(other=>other!==n&&other.contains(n)));},dispose:()=>observer.disconnect() };
}

Object.assign(__x, { dependencyPriority, trackDependencies });
};

__m["src/engine/repeats.js"] = (__x, __req) => {
const { realClick, isExtensionAction } = __req("src/engine/controls/native.js");
const bindings=new WeakMap();
const BLOCK='[data-repeat-group],[data-automation-id="workExperienceItem"],[data-automation-id="educationItem"],[data-repeat-item]';
const CONTROLS='input,select,textarea,[role="combobox"]';
function bindEntities(fields,profile) {
  const groups=new Map();
  for(const field of fields) {
    if(!["experience","education"].includes(field.section))continue;
    const block=field.el.closest(BLOCK);if(!block)continue;
    if(!groups.has(block))groups.set(block,[]);groups.get(block).push(field);
  }
  for(const [block,group] of groups) {
    const section=group[0].section,rows=profile[section]||[], anchor=group.find(f=>section==="experience"?/^(employer|company( name)?)$/i.test(f.rawLabel):/^(school( name)?|university|institution)$/i.test(f.rawLabel));
    const value=String(anchor?.el.value||anchor?.el.getAttribute("data-selected")||"").trim().toLowerCase();
    const secondary=group.find(f=>section==="experience"?/^(job title|position|title)$/i.test(f.rawLabel):/^(degree|degree level)$/i.test(f.rawLabel));
    const secondaryValue=String(secondary?.el.value||"").trim().toLowerCase();
    const identity=row=>JSON.stringify(section==="experience"?[row.company,row.title||row.position,row.startDate,row.endDate]:[row.school,row.degree,row.fieldOfStudy,row.startDate,row.endDate]);
    const matches=value?rows.map((r,i)=>({i,r})).filter(({r})=>String(section==="experience"?r.company:r.school).trim().toLowerCase()===value && (!secondaryValue||String(section==="experience"?r.title||r.position:r.degree).trim().toLowerCase()===secondaryValue)):[];
    let binding=bindings.get(block);
    if(value && matches.length!==1){group.forEach(f=>{f.skip=true;f.entityConflict=true;});continue;}
    if(matches.length===1)binding={section,index:matches[0].i,identity:identity(matches[0].r)};
    else if(binding) {
      const current=rows.map((r,i)=>({i,r})).filter(({r})=>identity(r)===binding.identity);
      if(current.length!==1){group.forEach(f=>{f.skip=true;f.entityConflict=true;});continue;}
      binding={...binding,index:current[0].i};
    } else if(rows[group[0].instance||0])binding={section,index:group[0].instance||0,identity:identity(rows[group[0].instance||0])};
    else {group.forEach(f=>{f.skip=true;f.entityConflict=true;});continue;}
    if(binding.section!==section || !rows[binding.index]){group.forEach(f=>{f.skip=true;f.entityConflict=true;});continue;}
    bindings.set(block,binding);group.forEach(f=>{f.instance=binding.index;f.entityId=`${section}:${binding.index}`;});
  }
  return fields;
}
async function addMissingRepeats(root,profile,{isCancelled=()=>false,maxAdds=5}={}) {
  const undo=[],added=[];
  for(const [section,buttonId,containerId,itemId,label] of [["experience","addWorkExperience","workExperience","workExperienceItem",/^add (another )?(work experience|employment|job)$/i],["education","addEducation","education","educationItem",/^add (another )?(education|school)$/i]]) {
    const buttons=[...root.querySelectorAll(`button[data-automation-id="${buttonId}"]`)].filter(b=>b.type==="button"&&!b.disabled&&b.getClientRects().length&&label.test((b.getAttribute("aria-label")||b.textContent).trim()));
    if(buttons.length!==1)continue;
    const button=buttons[0], container=button.closest(`[data-automation-id="${containerId}"]`);if(!container)continue;
    const existingRemove=container.querySelector(`button[data-automation-id="${section==="experience"?"deleteWorkExperience":"deleteEducation"}"][type="button"]`);
    if(!existingRemove)continue;
    let count=container.querySelectorAll(`[data-automation-id="${itemId}"]`).length;
    while(count>0 && count<(profile[section]||[]).length && added.length<maxAdds && !isCancelled()) {
      const previous=new Set(container.querySelectorAll(`[data-automation-id="${itemId}"]`));realClick(button);
      const deadline=Date.now()+1000;let blocks=[];
      do{await new Promise(r=>setTimeout(r,50));blocks=[...container.querySelectorAll(`[data-automation-id="${itemId}"]`)];}while(blocks.length===count&&Date.now()<deadline&&!isCancelled());
      const fresh=blocks.filter(b=>!previous.has(b));if(blocks.length!==count+1 || fresh.length!==1)break;
      const block=fresh[0], remove=[...block.querySelectorAll('button[data-automation-id="deleteWorkExperience"],button[data-automation-id="deleteEducation"]')].filter(b=>b.type==="button" && /^(remove|delete)( (work experience|employment|job|education|school))?$/i.test(b.textContent.trim()));
      if(remove.length!==1)break;
      let edited=false;const mark=e=>{if(e.isTrusted&&!isExtensionAction())edited=true;};block.addEventListener("input",mark);block.addEventListener("change",mark);
      const restore=()=>{if(edited || !block.isConnected || [...block.querySelectorAll(CONTROLS)].some(el=>el.value || el.checked || el.getAttribute("data-selected")))return false;realClick(remove[0]);restore.dispose();return true;};
      restore.dispose=()=>{block.removeEventListener("input",mark);block.removeEventListener("change",mark);};undo.push(restore);added.push(block);count++;
    }
  }
  return {added,undo};
}

Object.assign(__x, { bindEntities, addMissingRepeats });
};

__m["src/resolver/resolve.js"] = (__x, __req) => {
const { prepareField, formatFact, typedSetup } = __req("src/resolver/format.js");
const { eligible, sourceForRule } = __req("src/resolver/validate.js");
const { exactAnswer, questionContext, scopedAuthorization } = __req("src/knowledge/retrieve.js");
const { canonicalQuestion } = __req("src/shared/field-identity.js");
const PROMPT_VERSION = "resolver-v1";
function decision(field, status, reason, extra = {}) { return { fieldId: field.fieldId, revision: field.revision, status, value: null, reason, evidenceIds: [], optionIds: [], transformations: [], ...extra }; }
function resolveOne(rawField, { profile = {}, settings = {}, knowledge = {}, url = "https://invalid.local/", mapping = null, legacy = {} } = {}) {
  const field = prepareField(rawField), policy = eligible(field, settings);
  if (policy) return decision(field, policy.status, policy.reason);
  let memory = null;
  try { memory = exactAnswer({ answers: {}, dependencies: {}, ...knowledge }, questionContext(field, url)); } catch { return decision(field, "blocked", "invalid_application_scope"); }
  if (memory) {
    const formatted = formatFact(field, memory.value, mapping?.ruleId);
    return formatted.value ? decision(field, "resolved", "approved_memory", { ...formatted, source: "approved_memory", evidenceIds: [memory.id], intent: mapping?.ruleId || "approved_answer" }) : decision(field, "needs_user", formatted.reason);
  }
  // Reviewed contact compatibility only; other legacy labels have no scope.
  if (!/education|experience/.test(field.section || "") && /^(first name|given name|last name|family name|full name|email( address)?|e mail( address)?|phone( number)?|telephone)$/.test(canonicalQuestion(field.questionFull))) {
    const contact = legacy[canonicalQuestion(field.questionFull)];
    if (contact) { const formatted = formatFact(field, contact, mapping?.ruleId); if (formatted.value) return decision(field, "resolved", "reviewed_contact", { ...formatted, source: "reviewed_contact", evidenceIds: [`legacy-contact:${canonicalQuestion(field.questionFull)}`], intent: mapping?.ruleId }); }
  }
  const typed = typedSetup(field, knowledge);
  if (typed) { const formatted = formatFact(field, typed.value, typed.intent); if (formatted.value) return decision(field, "resolved", "confirmed_typed_fact", { ...formatted, source: "fact", intent: typed.intent, evidenceIds: typed.facts.map(f => f.id) }); }
  if (["authorizedToWork", "sponsorship"].includes(mapping?.ruleId)) {
    if (/future|\b(and|or)\b|authori[sz].*sponsor|sponsor.*authori[sz]/i.test(field.questionFull)) return decision(field, "needs_user", "compound_or_temporal_authorization");
    const intent = mapping.ruleId === "sponsorship" ? "authorization.sponsorship" : "authorization.authorized", value = scopedAuthorization(knowledge, field, intent);
    if (value) { const formatted = formatFact(field, value, mapping.ruleId); if (formatted.value) return decision(field, "resolved", "confirmed_country_fact", { ...formatted, source: "fact", intent, evidenceIds: Object.values(knowledge.facts || {}).filter(f => f.intent === intent && f.status === "confirmed").map(f => f.id) }); }
    return decision(field, "needs_user", "missing_scoped_authorization");
  }
  const fact = sourceForRule(field, mapping, profile);
  if (fact) {
    const formatted = formatFact(field, fact.value, fact.intent);
    if (formatted.value) return decision(field, "resolved", "compatible_profile_fact", { ...formatted, source: fact.provenance.source, intent: fact.intent, evidenceIds: [fact.id], provenance: fact.provenance });
    return decision(field, "needs_user", formatted.reason, { intent: fact.intent });
  }
  return decision(field, "needs_user", "missing_compatible_fact");
}
function resolveFields(fields, context = {}) {
  const ids = new Set();
  return fields.map((field, i) => { if (ids.has(field.fieldId)) throw new Error("Duplicate field identity."); ids.add(field.fieldId);
    return resolveOne(field, { ...context, mapping: context.mappings?.get(i) || null }); });
}

Object.assign(__x, { PROMPT_VERSION, decision, resolveOne, resolveFields });
};

__m["src/resolver/format.js"] = (__x, __req) => {
const { canonicalQuestion } = __req("src/shared/field-identity.js");
const { rankChoices } = __req("src/engine/controls/workday.js");
const { splitPhone } = __req("src/shared/values.js");
function prepareField(field) {
  const fieldId = field.fieldId;
  return { ...field, questionFull: field.questionFull || field.rawLabel || field.label || "", revision: field.revision || field.formRevision || 1,
    options: (field.options || []).map((option, i) => ({ optionId: typeof option === "object" && option.optionId || `${fieldId}:option:${i}`,
      label: typeof option === "string" ? option : option.label || option.value || "", value: typeof option === "string" ? option : option.value ?? option.label ?? "" })) };
}
function formatFact(field, value, ruleId) {
  if ((field.kind === "checkboxgroup" || field.multiple) && field.options?.length) {
    const values=Array.isArray(value)?value:ruleId==="skills"?String(value).split(/[,;\n]+/).map(v=>v.trim()).filter(Boolean):[String(value)];
    const choices=values.map(v=>rankChoices(field.options,v,ruleId).choice);
    if(choices.some(c=>!c))return {reason:"ambiguous_options"};
    return {value:choices.map(c=>c.label),optionIds:choices.map(c=>c.optionId),transformations:[]};
  }
  let text = String(value ?? "").trim();
  const transformations = [];
  if(ruleId==="phone" && field.phonePart==="national") {text=splitPhone(text).national;transformations.push("separate_dial_code");}
  if (["linkedin", "github", "website", "portfolio"].includes(ruleId)) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) { text = "https://" + text.replace(/^\/\//, ""); transformations.push("add_https_scheme"); }
    try {
      const url = new URL(text);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".") || /\s/.test(text)) return { reason: "invalid_profile_url" };
    } catch { return { reason: "invalid_profile_url" }; }
  }
  if (!text) return { reason: "missing_fact" };
  const limit = field.constraints?.maxLength || field.maxLength;
  if (limit && text.length > limit) return { reason: "fact_exceeds_length" };
  if (field.options?.length && field.kind !== "checkbox") {
    const ranked = rankChoices(field.options, text, ruleId);
    if (!ranked.choice) return { reason: ranked.reason || "ambiguous_options" };
    return { value: ranked.choice.label, optionIds: [ranked.choice.optionId], optionsComplete: field.optionsComplete !== false, transformations: text === ranked.choice.label ? [] : ["curated_option_mapping"] };
  }
  return { value: text, optionIds: [], transformations };
}
function typedSetup(field, state, now = Date.now()) {
  const q = canonicalQuestion(field.questionFull), facts = Object.values(state?.facts || {}).filter(f => f.status === "confirmed" && (!f.refreshAfter || f.refreshAfter > now));
  const fact = intent => { const found = facts.filter(f => f.intent === intent); return found.length === 1 ? found[0] : null; };
  if (/\b(not|without|unless|except|future)\b/.test(q)) return null;
  if (/^(can|are|is|do|does|will|have|would)\b/.test(q)) return null;
  if (/notice/.test(q)) {
    const f = fact("availability.noticeDays");
    if (f && !/weeks?|months?|years?/.test(q)) return { value: field.type === "number" || /\bdays\b/.test(q) ? String(f.value) : `${f.value} days`, facts: [f], intent: "noticePeriod" };
  }
  if (/available.*start|availability|earliest.*start/.test(q) && !/school|education|employment|experience|job history/.test(field.section || "")) { const f = fact("availability.startDate"); if (f && /^\d{4}-\d{2}-\d{2}$/.test(f.value)) return { value: f.value, facts: [f], intent: "startDate" }; }
  if (/expected|desired|expectation/.test(q) && /salary|compensation|pay/.test(q) && !/current|previous|minimum|maximum|range|bonus|equity|gross|net|total/.test(q)) {
    const amount = fact("compensation.amount"), currency = fact("compensation.currency"), period = fact("compensation.period");
    const currencies = [...q.matchAll(/\b(usd|inr|eur|gbp|cad|aud)\b/g)].map(m => m[1]);
    const periods = /annual|year/.test(q) ? ["year"] : /month/.test(q) ? ["month"] : /hour/.test(q) ? ["hour"] : [];
    if (amount && currency && period && currencies.length === 1 && currencies[0] === canonicalQuestion(currency.value) && periods.length === 1 && periods[0] === period.value)
      return { value: String(amount.value), facts: [amount, currency, period], intent: "expectedSalary" };
  }
  return null;
}

Object.assign(__x, { prepareField, formatFact, typedSetup });
};

__m["src/resolver/validate.js"] = (__x, __req) => {
const { canonicalQuestion } = __req("src/shared/field-identity.js");
const { answerPolicy, valueAt } = __req("src/shared/answer-policy.js");
const { RULE_BY_ID } = __req("src/shared/rules.js");
const { splitPhone } = __req("src/shared/values.js");
const patterns = {
  firstName: /first name|given name/, lastName: /last name|family name|surname/, fullName: /full name|legal name|your name|^name$/,
  middleName: /middle name/, preferredName: /preferred name/, email: /email|e mail/, phone: /phone|telephone|mobile/, phoneCountryCode: /dial|calling|country code/,
  city: /city|residence/, location: /^(current |home |residential )?location$|^where are you (located|based)$/, state: /state|province|region/, country: /country/, postalCode: /postal|zip/,
  addressLine1: /street|address/, addressLine2: /address.*2|apartment|suite/, linkedin: /linkedin/, github: /github/, website: /website|personal site/, portfolio: /portfolio/,
  university: /school|university|institution|college/, degree: /degree|qualification/, fieldOfStudy: /major|field of study|discipline|speciali[sz]ation/, gpa: /gpa|grade point/,
  company: /employer|company|organization/, jobTitle: /job title|position|title/, experienceLocation: /location|city/, graduationDate: /graduat|end date/,
  educationStartDate: /start|from|begin/, educationEndDate: /end|to|graduat/, experienceStartDate: /start|from|begin/, experienceEndDate: /end|to|finish/,
  currentJob: /current|present|still.*work/, summary: /summary|about yourself/, skills: /skills|technolog/
};
function compatibleIntent(field, ruleId) {
  const rule = RULE_BY_ID.get(ruleId), q = canonicalQuestion(field.questionFull || field.rawLabel || field.label);
  if (!rule || !(patterns[ruleId]?.test(q) || ruleId==="phoneCountryCode" && field.phonePart==="code")) return false;
  if (rule.path.startsWith("personal.") && ["education", "experience"].includes(field.section)) return false;
  if (ruleId !== "currentJob" && /^(do|does|can|is|are|will|have|would)\b/.test(q)) return false;
  if (!["summary", "skills"].includes(ruleId) && /\b(describe|explain|why|initials)\b|how (long|many|did|does|do)|tell.*about/.test(q)) return false;
  const context = canonicalQuestion([q, field.helperText, field.sectionTitle].filter(Boolean).join(" "));
  if (/\b(emergency|reference|referee|manager|supervisor|parent|spouse|recruiter|citizenship|nationality)\b/.test(context)) return false;
  if (/\b(not|without|except|unless)\b/.test(field.helperText || "")) return false;
  if (ruleId === "firstName" && /middle|preferred|family|surname|last/.test(q)) return false;
  if (ruleId === "country" && /\bcode\b/.test(q)) return false;
  if (ruleId === "university" && /\b(city|location|address|email|phone|percentage|gpa|degree|major)\b/.test(q)) return false;
  if (ruleId === "fieldOfStudy" && /\b(achievements?|accomplishments?|percentage|gpa|employer|company)\b/.test(q)) return false;
  if (answerPolicy({ ...field, rawLabel: q }, {}).critical && !/^(education|experience)(Start|End)Date$/.test(ruleId)) return false;
  if (/\b(emergency|reference|referee|manager|supervisor|parent|spouse|recruiter|birth|citizenship|nationality|preferred country|relocat|willing|desired|expected)\b/.test(q)) return false;
  const exampleOnly = ruleId === "fieldOfStudy" && /^speciali[sz]ation\s*\(primary speciali[sz]ation ex[: ]/i.test(field.questionFull || field.rawLabel || "");
  if (/\b(and|or)\b/.test(q) && !exampleOnly && !/state or province|country or region|city or town/.test(q)) return false;
  if (field.extraction?.conflicting || field.extraction?.truncated || field.extraction?.ambiguous) return false;
  if (/\b(not|without|except|excluding|unless|previous|former|future)\b/.test(q)) return false;
  if (/first name/.test(q) && /last name|family name/.test(q)) return false;
  const explicitEducation = ruleId === "university" ? /^(college|school|university|institution)( name)?$/.test(q) : ["degree", "fieldOfStudy", "gpa"].includes(ruleId);
  if (rule.section && ["education", "experience"].includes(rule.section) && !String(field.section || "").toLowerCase().includes(rule.section) && !(rule.section === "education" && !field.section && explicitEducation)) return false;
  if (!rule.section && ["education", "experience"].includes(field.section) && /^(city|location|state|country|addressLine1|addressLine2)$/.test(ruleId)) return false;
  if (rule.path.startsWith("personal.") && /\b(school|university|employer|company|organization)\b/.test(q)) return false;
  if (["summary", "skills"].includes(ruleId) && !/^(summary|professional summary|about yourself|tell us about yourself|skills|technical skills|technologies)$/.test(q)) return false;
  if (["city", "state", "country", "addressLine1", "addressLine2"].includes(ruleId) && /school|university|employer|company/.test(q)) return false;
  return true;
}
function ruleCandidate(field, rule) { return ["authorizedToWork", "sponsorship"].includes(rule.id) || compatibleIntent(field, rule.id); }
function sourceForRule(field, mapping, profile) {
  const rule = RULE_BY_ID.get(mapping?.ruleId);
  if (!rule || !compatibleIntent(field, mapping.ruleId) || rule.path.startsWith("customFields.")) return null;
  const instance = field.instance || mapping.instance || 0;
  if (!Number.isInteger(instance) || instance < 0) return null;
  if (rule.section === "education" && !field.section && (profile.education || []).length !== 1) return null;
  if (mapping.ruleId === "university" && /high school|secondary|10th|12th/i.test(field.questionFull)) return null;
  if (rule.section === "experience" && mapping.ruleId !== "currentJob" && /\b(current|present)\b/i.test(field.questionFull) && profile.experience?.[instance]?.current !== true) return null;
  const path = /^(education|experience)\[0\]/.test(rule.path) ? rule.path.replace("[0]", `[${instance}]`) : rule.path;
  const raw = valueAt(profile, path);
  if (mapping.ruleId === "location" && !raw && profile.personal?.city) return { id: "derived:location", value: [profile.personal.city, profile.personal.state, profile.personal.country].filter(Boolean).join(", "), intent: "location", provenance: { source: "derived", paths: ["personal.city", "personal.state", "personal.country"] } };
  if (mapping.ruleId === "currentJob" && typeof raw === "boolean") return { id: `profile:${path}`, value: raw ? "Yes" : "No", intent: mapping.ruleId, provenance: { source: "profile", path, quote: String(raw) } };
  if (rule.isDate && typeof raw === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(raw) && /\byear\b/.test(field.questionFull) && !/month|day/.test(field.questionFull)) return { id: `profile:${path}:year`, value: raw.slice(0,4), intent: mapping.ruleId, provenance: { source: "derived", path, quote: raw } };
  if (mapping.ruleId === "phoneCountryCode" && !raw) {
    const value = splitPhone(profile.personal?.phone || "").code;
    if (value) return { id: "derived:phoneCountryCode", value, intent: mapping.ruleId, provenance: { source: "derived", paths: ["personal.phone"] } };
  }
  if (raw !== undefined && raw !== null && String(raw).trim()) return { id: `profile:${path}`, value: raw, intent: mapping.ruleId,
    provenance: { source: "profile", path, quote: String(raw) }, entityId: field.entityId, path };
  // Explicit, evidence-preserving derivations only; no general rule fallbacks.
  if (mapping.ruleId === "fullName" && profile.personal?.firstName && profile.personal?.lastName) return { id: "derived:fullName", value: [profile.personal.firstName, profile.personal.middleName, profile.personal.lastName].filter(Boolean).join(" "), intent: "fullName", provenance: { source: "derived", paths: ["personal.firstName", "personal.middleName", "personal.lastName"] } };
  return null;
}
function groundedClaims(entry, evidence, profile = {}) {
  if (!Array.isArray(entry.claims) || !entry.claims.length || entry.claims.length > 12) return null;
  const fullName = String(profile.personal?.fullName || [profile.personal?.firstName, profile.personal?.lastName].filter(Boolean).join(" ")).trim();
  const claims = [];
  for (const claim of entry.claims) {
    const source = evidence.find(e => e.id === claim.evidenceId);
    if (!source || typeof claim.text !== "string" || typeof claim.quote !== "string" || claim.quote.length < 12 || !source.text.includes(claim.quote)) return null;
    const normalized = text => (fullName ? text.replaceAll(fullName, "I") : text).trim().replace(/\s+/g, " ");
    if (normalized(claim.text) !== normalized(claim.quote)) return null;
    claims.push(claim.text.trim());
  }
  const value = claims.join(" ");
  if (entry.value !== value) return null;
  return { value, evidenceIds: [...new Set(entry.claims.map(c => c.evidenceId))], claims: entry.claims };
}
function proseTarget(field) {
  return ["textarea","richtext"].includes(field.kind) || field.kind==="text" && (!field.type || field.type==="text") && /^achievements?$/.test(canonicalQuestion(field.questionFull || field.rawLabel || field.label));
}
function eligible(field, settings) {
  const policy = answerPolicy({ ...field, rawLabel: field.questionFull }, settings);
  if (!policy.allowed) return { status: "blocked", reason: policy.reason };
  if (field.skip || field.filled || field.currentValue) return { status: "deferred", reason: "existing_or_user_value" };
  if (!field.fieldId || !field.questionFull || field.extraction?.truncated || field.extraction?.ambiguous) return { status: "needs_user", reason: "ambiguous_question" };
  return null;
}

Object.assign(__x, { compatibleIntent, ruleCandidate, sourceForRule, groundedClaims, proseTarget, eligible });
};

__m["src/shared/answer-policy.js"] = (__x, __req) => {
// Shared policy for rule, memory, bulk and inline answers. Confidence is not evidence.
const SENSITIVE = /\b(gender|sex|pronouns?|race|ethnic\w*|veteran|disabil\w*|religio\w*|sexual orientation|marital)\b/i;
const CRITICAL = /authori[sz]|sponsor|visa|citizen|salary|compensation|notice|availability|start date|certificat|licen[cs]|criminal|convict|consent|agree|declar|attest/i;
function answerPolicy(field = {}, settings = {}) {
  if (field.extraction?.conflicting) return { allowed: false, reason: "conflicting_question" };
  const question = [field.rawLabel || field.label, field.name, field.helperText].filter(Boolean).join(" ");
  if (field.type === "password" || field.kind === "file") return { allowed: false, reason: "unsupported" };
  if (settings.skipSensitive !== false && SENSITIVE.test(question)) return { allowed: false, reason: "sensitive" };
  return { allowed: true, critical: CRITICAL.test(question), prose: field.kind === "textarea" || field.kind === "richtext" };
}
function confidenceOf(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}
function valueAt(profile, path) {
  if (typeof path !== "string" || !/^(personal|education|experience|customFields|summary|skills)(\[\d+\]|\.[a-zA-Z0-9_]+)*$/.test(path)) return undefined;
  return path.replace(/\[(\d+)\]/g, ".$1").split(".").reduce((v, k) => v && Object.hasOwn(v, k) ? v[k] : undefined, profile);
}
const INTENTS = [
  [/first name|given name/i, /personal\.firstName$/], [/last name|family name/i, /personal\.lastName$/],
  [/full name|legal name/i, /personal\.fullName$/], [/email/i, /personal\.email$/], [/phone|telephone/i, /personal\.phone$/],
  [/postal|zip code/i, /personal\.postalCode$/], [/country/i, /personal\.country$/], [/state|province/i, /personal\.state$/],
  [/city|residence/i, /personal\.city$/], [/street|address line 1/i, /personal\.address$/],
  [/sponsor/i, /personal\.sponsorshipRequired$/], [/authori[sz]/i, /personal\.authorizedToWork$/],
  [/linkedin/i, /personal\.linkedin$/], [/github/i, /personal\.github$/], [/website/i, /personal\.website$/],
  [/university|school/i, /education\[\d+\]\.school$/], [/degree/i, /education\[\d+\]\.degree$/],
  [/major|field of study/i, /education\[\d+\]\.fieldOfStudy$/], [/gpa/i, /education\[\d+\]\.gpa$/],
  [/employer|company name/i, /experience\[\d+\]\.company$/], [/job title|position/i, /experience\[\d+\]\.(title|position)$/]
];
const canonical = (s) => String(s).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function compatibleFact(field, evidence, profile) {
  const question = field.rawLabel || field.label || "";
  const hit = INTENTS.find(([pattern]) => pattern.test(question));
  if (hit) {
    if (evidence.source !== "profile" || !hit[1].test(evidence.path)) return false;
    if (/authori[sz]|sponsor/i.test(question)) {
      const country = profile.personal?.country;
      if (!country || !question.toLowerCase().includes(country.toLowerCase())) return false;
      if (/without|not require|do not|don't|no sponsorship/i.test(question)) return false;
    }
    return true;
  }
  return evidence.source === "profile" && evidence.path?.startsWith("customFields.") && canonical(evidence.path.slice(13)) === canonical(question);
}
function validateAnswer(entry, field, { settings = {}, profile = {}, resumeText = "" } = {}) {
  const policy = answerPolicy(field, settings);
  if (!policy.allowed) return { status: "blocked", value: null, reason: policy.reason };
  if (!entry || entry.value == null || !String(entry.value).trim()) return { status: "missing_fact", value: null, reason: "missing_fact" };
  const value = String(entry.value).trim();
  const evidence = (Array.isArray(entry.evidence) ? entry.evidence : []).filter((e) => {
    if (e?.source === "profile") return typeof e.quote === "string" && String(valueAt(profile, e.path) ?? "") === e.quote && !!e.quote.trim();
    return e?.source === "resume" && typeof e.quote === "string" && e.quote.trim().length >= 12 && resumeText.includes(e.quote);
  });
  if (!evidence.length) return { status: "missing_fact", value: null, reason: "unsupported_answer" };
  // A prose draft is still unapproved and must be visibly reviewed. It cannot
  // invent declarations, eligibility, compensation or other missing facts.
  const draft = entry.status === "draft" && policy.prose && !policy.critical;
  const fact = entry.status === "grounded" && evidence.some((e) => e.quote === value && compatibleFact(field, e, profile));
  if (!draft && !fact) return { status: "missing_fact", value: null, reason: "unsupported_transformation" };
  if (field.options?.length && !field.options.some((o) => String(typeof o === "string" ? o : o.label || o.value) === value)) return { status: "ambiguous", value: null, reason: "invalid_option" };
  return { value, status: draft ? "draft" : "grounded", evidence, confidence: confidenceOf(entry.confidence), reason: "supported" };
}

Object.assign(__x, { answerPolicy, confidenceOf, valueAt, validateAnswer });
};

__m["src/knowledge/retrieve.js"] = (__x, __req) => {
const { canonicalQuestion, scopeForQuestion } = __req("src/shared/field-identity.js");
const { reusableQuestion } = __req("src/knowledge/learning.js");
function questionContext(field, url) {
  return { question: field.questionFull || field.rawLabel || field.label || "", section: canonicalQuestion(field.sectionTitle || field.section || ""),
    entityId: field.entityId || `${field.section || "personal"}:${field.instance || 0}`, application: scopeForQuestion(url),
    country: canonicalQuestion(field.country || ""), company: canonicalQuestion(field.company || ""), polarity: canonicalQuestion(field.polarity || ""),
    applicationContext: String(field.applicationContext || ""),
    units: canonicalQuestion(field.units || ""), options: (field.options || []).map(o => canonicalQuestion(o.label || o.value)).sort() };
}
function answerIdentity(context) { return "answer:" + JSON.stringify([canonicalQuestion(context.question), context.section, context.entityId, context.application, context.country, context.company, context.polarity, context.units, context.options, context.applicationContext]); }
function scopedAnswerIdentity(context, scope) { return scope === "similar" ? "personal:" + answerIdentity({ ...context, application: "", company: "", applicationContext: "" }) : answerIdentity(context); }
function currentRecord(record, dependencies, now = Date.now()) {
  return record.status === "approved" && (!record.expiresAt || record.expiresAt > now) &&
    Object.entries(record.dependencies || {}).every(([key, value]) => value === dependencies[key]);
}
function candidates(state, context, { limit = 8, now = Date.now() } = {}) {
  const q = canonicalQuestion(context.question), tokens = new Set(q.split(" "));
  return Object.values(state.answers).filter((r) => currentRecord(r, state.dependencies, now) &&
    (r.scope?.type === "application" && r.scope.application === context.application && r.context.applicationContext === context.applicationContext && r.context.company === context.company ||
     r.scope?.type === "personal-question" && reusableQuestion(q) && canonicalQuestion(r.question) === q) &&
    r.context.section === context.section && r.context.entityId === context.entityId &&
    ["country", "polarity", "units"].every(k => r.context[k] === context[k]) && JSON.stringify(r.context.options) === JSON.stringify(context.options))
    .map((r) => { const other = canonicalQuestion(r.question), shared = other.split(" ").filter(t => tokens.has(t)).length;
      return { ...r, exact: other === q, score: other === q ? 1 : shared / Math.max(tokens.size, other.split(" ").length) }; })
    .filter(r => r.score > .25 && (r.exact || !/authori[sz]|sponsor|visa|citizen|salary|compensation|notice|availability|consent|agree|criminal|convict|certificat|licen[cs]|\bnot\b|\bwithout\b/i.test(q + " " + r.question)))
    .sort((a, b) => b.score - a.score).slice(0, limit);
}
function exactAnswer(state, context) { const found = candidates(state, context).filter(r => r.exact), local = found.filter(r => r.scope.type === "application"); return local.length ? local.length === 1 ? local[0] : null : found.length === 1 ? found[0] : null; }
function scopedAuthorization(state, field, intent, now = Date.now()) {
  const question = canonicalQuestion(field.questionFull || field.rawLabel || field.label);
  const temporalContext = canonicalQuestion([question, field.helperText, field.sectionTitle].filter(Boolean).join(" "));
  if (["education", "experience"].includes(field.section) || field.entityId && !/^personal(?::0)?$/.test(field.entityId) ||
      /\b(emergency|reference|referee|manager|supervisor|parent|spouse|recruiter|employer|company)\b/.test(temporalContext)) return null;
  if (/\b(ever|did|previous|formerly|former|past|historical|last year|before|since|future|next year)\b|\b(?:19|20)\d{2}\b/.test(temporalContext)) return null;
  if (/\b(without|not|never|unless|except)\b/.test(question)) return null;
  const countries = [["india", /\bindia\b/], ["united states", /\b(united states|usa|u s a|u s)\b/], ["united kingdom", /\b(united kingdom|uk|u k)\b/], ["canada", /\bcanada\b/], ["australia", /\baustralia\b/]];
  const match = countries.filter(([, pattern]) => pattern.test(question)); if (match.length !== 1) return null;
  const aliases = new Map([["usa", "united states"], ["us", "united states"], ["uk", "united kingdom"]]);
  const found = Object.values(state?.facts || {}).filter(r => r.status === "confirmed" && r.intent === intent && r.scope?.type === "country" &&
    (!r.entityId || /^personal(?::0)?$/.test(r.entityId)) &&
    (aliases.get(r.scope.country) || r.scope.country) === match[0][0] && (!r.refreshAfter || r.refreshAfter > now));
  return found.length === 1 ? found[0].value : null;
}

Object.assign(__x, { questionContext, answerIdentity, scopedAnswerIdentity, currentRecord, candidates, exactAnswer, scopedAuthorization });
};

__m["src/knowledge/learning.js"] = (__x, __req) => {
const { canonicalQuestion } = __req("src/shared/field-identity.js");
// Wider reuse is deliberately limited to reviewed, literal, personal questions.
function reusableQuestion(question) {
  return /^(first name|last name|full name|email|email address|phone|phone number|mobile phone|mobile number|current location|city|country|linkedin profile|linkedin url|portfolio url|github url)$/.test(canonicalQuestion(question));
}
function correctionKind(previous, value, repair = false) {
  if (repair) return "mapping-repair";
  return previous && String(previous.value) !== String(value) ? "answer-replacement" : "user-answer";
}
function answerText(field, value) {
  if (field.kind === "file") return (value || []).map(file => file.name).join(", ");
  if (field.kind === "dategroup" && Array.isArray(value)) { const parts = Object.fromEntries(value); return [parts.year, parts.month, parts.day].filter(v => v !== undefined).map((v, i) => i ? String(v).padStart(2, "0") : String(v)).join("-"); }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(v => field.options?.find(o => [o.value, canonicalQuestion(o.label)].includes(v))?.label || v).join(", ");
  return String(value ?? "").trim();
}

Object.assign(__x, { reusableQuestion, correctionKind, answerText });
};

__m["src/shared/schema.js"] = (__x, __req) => {
// Apply karo — profile schema + storage access.
const { knowledge } = __req("src/knowledge/client.js");
const { DEFAULT_RELEASE } = __req("src/shared/release.js");
//
// Storage is deliberately split across keys so that readers only pay for what
// they need. In v1 everything (including the base64 PDF, ~105 KB) lived under a
// single blob that `loadAll()` pulled into every frame of every page. Here the
// resume binary sits alone under `resumeFile` and is fetched on demand — only
// once a page actually turns out to have a file input.
//
//   profile         — personal / education / experience / skills / customFields
//   learned         — label -> value pairs harvested from manual edits
//   settings        — behaviour toggles + provider config
//   resumeMeta      — { fileName, fileSize, text }   (small, safe to load)
//   resumeFile      — { base64 }                     (large, load on demand)
//   history         — application log                (grows; load on demand)
//   letters         — saved cover letters            (grows; load on demand)

// An empty template, deliberately.
//
// Every value here is typed verbatim into real job applications, so shipping a
// populated profile means a fresh install applies to jobs as whoever the build
// was seeded from. The dashboard opens on first install and *Fill profile from
// resume* populates this from your own PDF in one step, which is the path that
// should fill it — not a default nobody chose.
//
// A stored profile always wins over these (see withDefaults), so this also
// supplies the keys a saved profile happens to be missing.
const DEFAULT_PROFILE = {
  personal: {
    firstName: "",
    lastName: "",
    middleName: "",
    fullName: "",
    preferredName: "",
    email: "",
    phone: "",
    website: "",
    linkedin: "",
    github: "",
    portfolio: "",
    twitter: "",
    address: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    location: "",
    // Left blank on purpose. A wrong answer to a work-authorization question is
    // a misrepresentation on an application, so these are yours to state.
    visaStatus: "",
    authorizedToWork: "",
    sponsorshipRequired: ""
  },
  // Empty rather than one blank card: the dashboard's Add buttons create these,
  // and a blank entry would otherwise be saved back as a real one.
  education: [],
  experience: [],
  summary: "",
  skills: "",
  // Answers to questions boards ask repeatedly — pronouns, notice period,
  // expected salary. Left empty because every one of them is a personal fact
  // that only you can state; the extension fills these in as it learns them.
  customFields: {}
};

const DEFAULT_SETTINGS = {
  release: DEFAULT_RELEASE,
  // Fill automatically once a job-application page is detected. Rules only —
  // the AI pass never fires without an explicit user action.
  autofillOnLoad: true,
  // Allow the Gemini pass to attempt fields the rule engine could not resolve.
  aiAutofillEnabled: true,
  // Attach the stored resume to a form's upload box as part of a fill. Only
  // boxes that ask for a resume, or a lone upload on an application form — see
  // pickResumeTargets in shared/rules.js.
  autoUploadResume: true,
  // Highlight filled fields briefly so you can see what changed.
  highlightFills: true,
  // Never touch these categories automatically (EEO questions etc.).
  skipSensitive: true,
  // Which provider answers unknown fields. Keys and model names are kept per
  // provider, so switching back and forth does not lose either.
  provider: "gemini",
  geminiApiKey: "",
  // Must stay equal to PROVIDERS.gemini.models[0] in shared/ai.js, which is what
  // resolveProvider falls back to when nothing is stored. Gemini 2.0 Flash is
  // the fast, stable GA model for document and form filling.
  geminiModel: "gemini-3.8-flash",
  groqApiKey: "",
  groqModel: "llama-3.3-70b-versatile",

  // "system" | "light" | "dark". Resolved by src/shared/theme.js.
  theme: "system",
  // Show the launcher button in the corner of application pages.
  panelEnabled: true,
  // Where the user dragged it to, as { right, bottom } in px. Null = default.
  panelPos: null,
  // Log every page filled, so the dashboard can act as an application tracker.
  trackApplications: true,
  // Days of silence after which an applied/interviewing role is worth chasing.
  followUpDays: 14,
  // Put the number of fields filled on the toolbar icon.
  showBadge: true,
  // Show an exclusive "Fill with AI" button on fields demanding paragraph answers.
  fieldAiButtonEnabled: true,
  // Optional default custom instructions when generating paragraph answers.
  defaultCustomInstruction: "",
  // Local redacted stage diagnostics. Off by default; no labels or answers retained.
  diagnosticsEnabled: false,
  // Hostnames the extension leaves completely alone.
  disabledSites: []
};

// `textFileName` is the PDF the text was read from, or "" when it was typed or
// pasted by hand.
//
// Without it there is no way to tell resume text that describes the current file
// from text left over by the one it replaced — and "any text will do" is what let
// a swapped resume keep being answered from the old one. It also gives the
// dashboard something true to say about whether the setup is actually working,
// which a character count on its own cannot.
const DEFAULT_RESUME_META = { fileName: "", fileSize: "", text: "", textFileName: "" };

/**
 * Is the stored resume text about the resume that is stored now?
 *
 * Hand-pasted text ("" — no file claimed) is always current: the user typed it
 * for whatever is in the slot, and silently discarding it to re-read a PDF would
 * throw away the only copy on a provider that cannot read PDFs at all.
 */
function resumeTextIsCurrent(meta = {}) {
  if (!String(meta.text || "").trim()) return false;
  if (!meta.textFileName) return true;
  return meta.textFileName === meta.fileName;
}

const KEYS = ["profile", "learned", "settings", "resumeMeta", "corrections", "answerTrust", "questionFixes"];

/**
 * Is the extension this page was injected by still there?
 *
 * Reloading an unpacked extension, updating it, or switching it off leaves the
 * content script already injected into every open tab running against a dead
 * `chrome.runtime`. Every storage read and every message from that orphan then
 * rejects with "Extension context invalidated" — asynchronously, out of
 * whatever the user just clicked, as an uncaught promise nobody sees but the
 * console. The panel goes quiet, the buttons keep looking enabled, and the only
 * cure (reload the page) is the one thing nothing on screen suggests.
 *
 * `chrome.runtime.id` is the tell: it is undefined exactly when the port behind
 * these APIs has gone. Reading it can itself throw on some Chrome versions,
 * hence the try.
 */
function extensionAlive() {
  try {
    return !!chrome?.runtime?.id;
  } catch {
    return false;
  }
}

/** Is this error that page-outlived-the-extension failure, rather than a bug? */
function isContextGone(err) {
  return /context invalidated|extension context/i.test(err?.message || "") || !extensionAlive();
}

const STALE_MESSAGE =
  "Apply karo was reloaded or updated while this page was open. Refresh the page to use it again.";

function area() {
  return chrome.storage.local;
}

/** Deep-merge stored values over defaults so new keys appear for old installs. */
function withDefaults(stored, defaults) {
  if (!stored || typeof stored !== "object") return structuredClone(defaults);
  const out = structuredClone(defaults);
  for (const [k, v] of Object.entries(stored)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = { ...out[k], ...v };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Everything a content script needs, minus the resume binary.
 * One storage round-trip; ~2-6 KB rather than ~110 KB.
 */
async function loadContext({ includeUnverified = false } = {}) {
  const knowledgeState = typeof document !== "undefined" && chrome.runtime?.sendMessage && chrome.runtime?.id
    ? await knowledge("snapshot") : null;
  const raw = await area().get(KEYS);
  const resumeMeta = withDefaults(raw.resumeMeta, DEFAULT_RESUME_META);

  // An install from before `textFileName` existed has none in storage, and
  // `withDefaults` fills the gap with the default "" — indistinguishable from
  // text genuinely typed by hand, which `resumeTextIsCurrent` treats as
  // permanently current. Before this field existed, `text` only ever got into
  // storage by reading the file named in `fileName`, so that is the honest
  // reading of an old record: tie it to that file rather than to none, so a
  // later replacement is correctly seen as stale instead of trusted forever.
  if (raw.resumeMeta && !("textFileName" in raw.resumeMeta) && resumeMeta.fileName) {
    resumeMeta.textFileName = resumeMeta.fileName;
  }

  const trusted = (values, records) => Object.fromEntries(Object.entries(values || {}).filter(([key, value]) => records?.[key]?.source === "user-confirmed" && records[key].value === value));
  const profile = withDefaults(raw.profile, DEFAULT_PROFILE);
  const legacyUnverified = {
    learned: Object.fromEntries(Object.entries(raw.learned || {}).filter(([k, v]) => raw.answerTrust?.learned?.[k]?.value !== v || raw.answerTrust?.learned?.[k]?.source !== "user-confirmed")),
    customFields: Object.fromEntries(Object.entries(profile.customFields || {}).filter(([k, v]) => raw.answerTrust?.customFields?.[k]?.value !== v || raw.answerTrust?.customFields?.[k]?.source !== "user-confirmed"))
  };
  if (!includeUnverified) profile.customFields = trusted(profile.customFields, raw.answerTrust?.customFields);
  const settings = withDefaults(raw.settings, DEFAULT_SETTINGS);
  const disclosure = Object.values(knowledgeState?.facts || {}).find(r => r.status === "confirmed" && r.intent === "disclosure.preference");
  if (disclosure && ["skip", "ask"].includes(disclosure.value)) settings.skipSensitive = true;
  return {
    knowledge: knowledgeState,
    profile,
    learned: includeUnverified ? raw.learned || {} : trusted(raw.learned, raw.answerTrust?.learned),
    legacyUnverified,
    answerTrust: raw.answerTrust || { version: 1, learned: {}, customFields: {} },
    questionFixes: raw.questionFixes || {},
    settings,
    resumeMeta,
    // { "<field key>": ["ruleId", …] } — pairings you have overridden.
    corrections: raw.corrections || {}
  };
}

async function saveCorrections(corrections) {
  await area().set({ corrections });
}

/** The base64 data URL of the resume. Only call this when a file input exists. */
async function loadResumeFile() {
  const raw = await area().get("resumeFile");
  return (raw.resumeFile && raw.resumeFile.base64) || "";
}

async function saveResumeFile(base64) {
  await area().set({ resumeFile: { base64: base64 || "" } });
}

async function save(patch) {
  await area().set(patch);
}

let answerWrite = Promise.resolve();
function serializeAnswers(action) {
  const task = answerWrite.catch(() => {}).then(action); answerWrite = task; return task;
}
async function saveAnswerMap(kind, values, { confirmed = false, replace = false } = {}, profile = null) {
  return serializeAnswers(async () => {
    const raw = await area().get(["profile", "learned", "answerTrust"]);
    const old = kind === "learned" ? raw.learned || {} : raw.profile?.customFields || {};
    const trust = raw.answerTrust || { version: 1, learned: {}, customFields: {} };
    trust[kind] ||= {};
    if (confirmed) for (const [key, value] of Object.entries(values || {})) {
      // Saving unrelated profile edits must not approve unchanged legacy guesses.
      if (old[key] !== value) trust[kind][key] = { value, source: "user-confirmed", confirmedAt: Date.now() };
    }
    const merged = replace ? values : { ...old, ...values };
    const patch = kind === "learned" ? { learned: merged } : { profile: { ...profile, customFields: merged } };
    await area().set({ ...patch, answerTrust: trust });
  });
}
async function saveProfile(profile, options = {}) {
  await saveAnswerMap("customFields", profile.customFields || {}, options, profile);
}
async function saveSettings(settings) {
  // Ordinary preference writers may hold an old settings snapshot. Only the
  // dedicated release controls change rollout state; stale UI cannot unpause it.
  const { settings: current = {} } = await area().get("settings");
  await area().set({ settings: { ...settings, release: Object.hasOwn(current, "release") ? current.release : DEFAULT_RELEASE } });
}
async function saveLearned(learned, options = {}) { await saveAnswerMap("learned", learned, options); }
async function confirmSavedAnswer(kind, key, value) {
  if (!["learned", "customFields"].includes(kind)) throw new Error("Invalid saved answer kind.");
  return serializeAnswers(async () => {
    const raw = await area().get(["profile", "learned", "answerTrust"]);
    const values = kind === "learned" ? raw.learned || {} : raw.profile?.customFields || {};
    if (values[key] !== value) throw new Error("This answer changed. Refresh and review it again.");
    const trust = raw.answerTrust || { version: 1, learned: {}, customFields: {} };
    trust[kind] ||= {}; trust[kind][key] = { value, source: "user-confirmed", confirmedAt: Date.now() };
    await area().set({ answerTrust: trust });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Application history
//
// Kept out of loadContext deliberately: it only grows, and every frame of every
// application page would otherwise pay to load a list it never reads. The engine
// touches it once, after a fill that actually did something.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_HISTORY = 400;

const APPLICATION_STATUS = [
  { value: "saved", label: "Filled" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" }
];

async function loadHistory() {
  const raw = await area().get("history");
  return Array.isArray(raw.history) ? raw.history : [];
}

async function saveHistory(history) {
  await area().set({ history: history.slice(0, MAX_HISTORY) });
}

/**
 * Record a fill, newest first.
 *
 * Re-filling the same URL updates the existing row rather than adding another —
 * a multi-step Workday application would otherwise show up as six separate
 * "applications", and pressing Fill twice on one page as two.
 */
async function recordApplication(entry) {
  const history = await loadHistory();
  const existing = history.findIndex((h) => h.url === entry.url);

  if (existing !== -1) {
    const prev = history[existing];
    history.splice(existing, 1);
    history.unshift({
      ...prev,
      ...entry,
      // Keep whatever the user set by hand; only the machine-written parts move.
      status: prev.status,
      note: prev.note || "",
      filled: Math.max(prev.filled || 0, entry.filled || 0),
      firstSeen: prev.firstSeen || prev.ts,
      ts: entry.ts
    });
  } else {
    history.unshift({ status: "saved", note: "", firstSeen: entry.ts, ...entry });
  }

  await saveHistory(history);
  return history;
}

/**
 * Attach a job-match result to the row for `url`, creating the row if the page
 * has not been filled yet — you often compare yourself against a posting before
 * deciding to apply, and that comparison is worth keeping either way.
 */
async function recordMatch(url, match, identity = {}) {
  const history = await loadHistory();
  const i = history.findIndex((h) => h.url === url);
  const stamped = { ...match, ts: match?.ts ?? Date.now() };

  if (i !== -1) {
    history[i] = { ...history[i], match: stamped };
  } else {
    history.unshift({
      status: "saved", note: "", filled: 0, total: 0,
      firstSeen: stamped.ts, ts: stamped.ts,
      ...identity, url, match: stamped
    });
  }

  await saveHistory(history);
  return history;
}

// Statuses that mean "waiting to hear back". A rejection is not waiting, and a
// row you have not actually submitted yet is not waiting either.
const AWAITING = new Set(["applied", "interview"]);

/**
 * Applications you have not heard about in a while.
 *
 * Entirely local — no model, no network. The timestamp is already recorded, so
 * "applied 18 days ago, still applied" is a lookup, and it is the single most
 * useful thing a tracker can tell you that a spreadsheet will not.
 */
function staleApplications(history = [], days = 14, now = Date.now()) {
  const cutoff = days * 86400000;
  return history
    .filter((h) => AWAITING.has(h.status) && now - (h.ts || 0) >= cutoff)
    .map((h) => ({ ...h, daysSince: Math.floor((now - (h.ts || 0)) / 86400000) }))
    .sort((a, b) => b.daysSince - a.daysSince);
}

/**
 * Earlier applications to the same employer, excluding this exact posting.
 *
 * Applying twice to one company is common and not always wrong — two different
 * roles is fine, the same role twice is a mistake. Returning the rows and
 * letting the caller say what they are beats guessing which case it is.
 */
function priorApplicationsFor(history = [], { company, url } = {}) {
  const key = String(company || "").trim().toLowerCase();
  if (!key) return [];
  return history.filter((h) =>
    h.url !== url && String(h.company || "").trim().toLowerCase() === key);
}

// ─────────────────────────────────────────────────────────────────────────────
// The posting you are working on
//
// One slot, not a list. A job description is read on the listing page and needed
// two pages later on the form, so it has to outlive the tab it was read from —
// but you only ever apply to one job at a time, and a list would turn a
// one-press feature into a picker.
//
// `match` and `letter` live in here rather than beside the run that produced
// them because the popup is a window that closes the moment you look away. The
// service worker writes the result here when it lands, so re-opening the popup
// shows the letter that was drafted while it was shut.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_JOB = {
  text: "",
  // "capture" — read off a page you pressed Capture on.
  // "manual"  — pasted in by hand.
  // "page"    — picked up automatically from the page a match or letter ran on.
  source: "",
  company: "", role: "", title: "", url: "", host: "",
  ts: 0,
  match: null,
  letter: "", letterTs: 0,
  // "match" | "letter" while the service worker is working, so a popup opened
  // mid-run says so instead of looking empty.
  running: "", runningSince: 0,
  error: ""
};

async function loadJob() {
  const raw = await area().get("job");
  return withDefaults(raw.job, DEFAULT_JOB);
}

async function saveJob(job) {
  await area().set({ job: { ...job, text: String(job.text || "").slice(0, 9000) } });
}

/** Change part of the stored posting without disturbing the rest. */
async function patchJob(patch) {
  const next = { ...(await loadJob()), ...patch };
  await saveJob(next);
  return next;
}

/**
 * Replace the stored posting with one just read from a page.
 *
 * A match and a letter belong to the posting they were made for, so they only
 * survive when this is the same posting arriving again — re-capturing the page
 * you already captured should not throw away the letter you just paid for, and
 * capturing a different job must never leave the last job's letter behind it.
 */
async function setJob(posting) {
  const prev = await loadJob();
  const same = !!prev.url && prev.url === posting.url;
  const next = {
    ...DEFAULT_JOB,
    ...posting,
    ts: Date.now(),
    match: same ? prev.match : null,
    letter: same ? prev.letter : "",
    letterTs: same ? prev.letterTs : 0
  };
  await saveJob(next);
  return next;
}

async function clearJob() {
  await area().remove("job");
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved cover letters
// ─────────────────────────────────────────────────────────────────────────────

async function loadLetters() {
  const raw = await area().get("letters");
  return Array.isArray(raw.letters) ? raw.letters : [];
}

async function saveLetters(letters) {
  await area().set({ letters: letters.slice(0, 60) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-site rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A URL that is safe to put in an href, or "".
 *
 * Escaping the string stops it breaking out of the attribute; it does nothing
 * about the *scheme*, and `javascript:alert(1)` needs no quotes or angle
 * brackets to survive it. An anchor carrying that in the dashboard runs script
 * in the extension's own origin, with access to everything in
 * `chrome.storage.local` — the profile, the resume, the API keys.
 *
 * The tracker's URLs come from pages a content script ran on, which are always
 * http(s), so this is not reachable from ordinary use. It is reachable through
 * Settings → Import: a backup file is plain JSON from wherever the user got it,
 * and nothing about receiving one implies it was written by this extension.
 */
function safeHttpUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") ? s : "";
  } catch {
    return "";                       // not a URL at all
  }
}

/** Normalise a hostname so "www.x.com" and "X.com" cannot both be stored. */
function normalizeHost(host) {
  return String(host || "").trim().toLowerCase().replace(/^www\./, "");
}

function isSiteDisabled(settings, host) {
  const h = normalizeHost(host);
  if (!h) return false;
  return (settings.disabledSites || []).some((d) => h === d || h.endsWith(`.${d}`));
}

/** Returns the new list; the caller decides when to persist. */
function setSiteDisabled(settings, host, disabled) {
  const h = normalizeHost(host);
  const list = (settings.disabledSites || []).filter((d) => d !== h);
  if (disabled && h) list.push(h);
  settings.disabledSites = list.sort();
  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile completeness
//
// Drives the dashboard ring and the popup's setup nudge. A single definition so
// the two surfaces cannot disagree about whether the profile is "done".
// ─────────────────────────────────────────────────────────────────────────────

function completeness(profile = {}, resumeMeta = {}, settings = {}) {
  const p = profile.personal || {};
  const has = (v) => !!String(v ?? "").trim();

  const items = [
    { key: "name",     label: "Name and email",        tab: "tab-personal",  done: has(p.firstName) && has(p.email), weight: 2 },
    { key: "contact",  label: "Phone number",          tab: "tab-personal",  done: has(p.phone),      weight: 1 },
    { key: "address",  label: "Structured address",    tab: "tab-personal",  done: has(p.city) && has(p.country), weight: 1,
      hint: "Workday and iCIMS ask for city, state and country as separate boxes." },
    { key: "work",     label: "Work authorisation",    tab: "tab-personal",  done: has(p.authorizedToWork), weight: 1 },
    { key: "edu",      label: "At least one school",   tab: "tab-education", done: (profile.education || []).length > 0, weight: 2 },
    { key: "skills",   label: "Skills list",           tab: "tab-education", done: has(profile.skills), weight: 1 },
    { key: "exp",      label: "Work experience",       tab: "tab-experience", done: (profile.experience || []).length > 0, weight: 2 },
    { key: "summary",  label: "Professional summary",  tab: "tab-experience", done: has(profile.summary), weight: 1 },
    { key: "links",    label: "LinkedIn or GitHub",    tab: "tab-links",     done: has(p.linkedin) || has(p.github), weight: 1 },
    { key: "resume",   label: "Resume PDF uploaded",   tab: "tab-resume",    done: has(resumeMeta.fileName), weight: 3,
      hint: "Without it, file-upload fields are skipped." },
    { key: "text",     label: "Resume text extracted", tab: "tab-resume",    done: has(resumeMeta.text), weight: 1,
      hint: "The AI answers open questions from this." },
    { key: "ai",       label: "AI provider connected", tab: "tab-resume",
      done: has(settings.provider === "groq" ? settings.groqApiKey : settings.geminiApiKey), weight: 1,
      hint: "Optional. Lets the extension answer questions no rule covers." }
  ];

  const total = items.reduce((n, i) => n + i.weight, 0);
  const got = items.reduce((n, i) => n + (i.done ? i.weight : 0), 0);
  return { percent: Math.round((got / total) * 100), items, done: got, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup
// ─────────────────────────────────────────────────────────────────────────────

const BACKUP_KEYS = ["profile", "learned", "settings", "resumeMeta", "corrections", "history", "letters"];

/**
 * Everything except the resume binary, which would multiply the file size by
 * thirty for something the user already has on disk.
 *
 * @param {boolean} includeKeys — API keys are credentials; off unless asked for.
 */
async function exportAll({ includeKeys = false } = {}) {
  const raw = await area().get(BACKUP_KEYS);
  const settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  if (!includeKeys) {
    settings.geminiApiKey = "";
    settings.groqApiKey = "";
  }
  return {
    knowledge: typeof document !== "undefined" && chrome.runtime?.id ? await knowledge("export") : undefined,
    _format: "applykaro-backup",
    _version: 2,
    exportedAt: new Date().toISOString(),
    profile: raw.profile || DEFAULT_PROFILE,
    learned: raw.learned || {},
    settings,
    resumeMeta: raw.resumeMeta || DEFAULT_RESUME_META,
    corrections: raw.corrections || {},
    history: raw.history || [],
    letters: raw.letters || []
  };
}

/**
 * Restore a backup. Merges rather than replaces, so importing a profile onto a
 * device that already has a resume does not wipe the resume.
 */
async function importAll(data) {
  // "resumefiler-backup" is the pre-rename tag; files exported before the app
  // became Apply karo still carry it and must keep restoring.
  const known = ["applykaro-backup", "resumefiler-backup"];
  if (!data || !known.includes(data._format)) {
    throw new Error("That file is not an Apply karo backup.");
  }
  const current = await area().get(BACKUP_KEYS);
  const patch = {};

  if (data.profile) patch.profile = withDefaults(data.profile, DEFAULT_PROFILE);
  if (data.learned) patch.learned = { ...(current.learned || {}), ...data.learned };
  if (data.corrections) patch.corrections = { ...(current.corrections || {}), ...data.corrections };
  if (data.settings) {
    const merged = withDefaults(data.settings, withDefaults(current.settings, DEFAULT_SETTINGS));
    // An export with the keys stripped must not blank the keys already here.
    if (!data.settings.geminiApiKey) merged.geminiApiKey = current.settings?.geminiApiKey || "";
    if (!data.settings.groqApiKey) merged.groqApiKey = current.settings?.groqApiKey || "";
    patch.settings = merged;
  }
  if (data.resumeMeta) {
    patch.resumeMeta = {
      ...withDefaults(data.resumeMeta, DEFAULT_RESUME_META),
      // The binary is not in the backup, so the filename must not claim one is.
      fileName: current.resumeMeta?.fileName || "",
      fileSize: current.resumeMeta?.fileSize || ""
    };
  }
  if (Array.isArray(data.history)) {
    const seen = new Set((current.history || []).map((h) => h.url));
    // Rewrite every incoming URL through the scheme check rather than only
    // escaping it at render time. A backup is plain JSON from wherever the user
    // got it, and this is the boundary where it stops being someone else's data
    // — sanitising here means a row cannot sit in storage waiting for the one
    // place that forgot to sanitise on the way out.
    patch.history = [...(current.history || []),
                     ...data.history.filter((h) => h && !seen.has(h.url))
                                    .map((h) => ({ ...h, url: safeHttpUrl(h.url) }))]
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, MAX_HISTORY);
  }
  if (Array.isArray(data.letters)) patch.letters = [...data.letters, ...(current.letters || [])].slice(0, 60);

  await area().set(patch);
  if (data.knowledge && typeof document !== "undefined" && chrome.runtime?.id) await knowledge("import", { data: data.knowledge });
  return Object.keys(patch);
}

/** Wipe everything this extension has stored, including the resume. */
async function resetAll() {
  if (typeof document !== "undefined" && chrome.runtime?.id) await knowledge("clear");
  await area().clear();
  await area().set({ schemaVersion: 2 });
}

/** Rough bytes in use, for the settings page. */
async function storageUsage() {
  try {
    return await area().getBytesInUse(null);
  } catch {
    return 0;
  }
}

/**
 * Migrate a v1 install in place.
 *
 * v1 stored `resume: { fileName, fileSize, base64, text }` and
 * `learnedMappings: {}`. Split the binary out and rename the map. Idempotent —
 * safe to run on every service-worker start.
 */
async function migrateFromV1() {
  const raw = await area().get(["resume", "learnedMappings", "settings", "schemaVersion"]);
  if (raw.schemaVersion >= 2) return false;

  const patch = { schemaVersion: 2 };

  if (raw.resume && typeof raw.resume === "object") {
    patch.resumeMeta = {
      fileName: raw.resume.fileName || "",
      fileSize: raw.resume.fileSize || "",
      text: raw.resume.text || ""
    };
    if (raw.resume.base64) patch.resumeFile = { base64: raw.resume.base64 };
  }

  if (raw.learnedMappings && typeof raw.learnedMappings === "object") {
    patch.learned = raw.learnedMappings;
  }

  // Preserve explicit model selections; health checks explain retired models.
  await area().set(patch);
  await area().remove(["resume", "learnedMappings"]);
  return true;
}

/** Resolve "personal.email" / "education[0].school" against a profile. */
/**
 * Copy `incoming` over `base`, skipping anything the source left empty.
 *
 * Empty means "the source does not say", not "clear this". The resume extractor
 * is asked to return "" for any fact a resume does not state — and a resume
 * states neither a street address nor an answer to a work-authorization
 * question — so a plain spread wrote those blanks straight over values typed by
 * hand. Populated lists still replace wholesale: education and experience come
 * back as the complete ordered set, not as a patch.
 */
function overlayFilled(base, incoming) {
  const out = { ...base };
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}

function resolvePath(obj, path) {
  if (!path || !obj) return null;
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return null;
    const arr = part.match(/^(\w+)\[(\d+)\]$/);
    if (arr) {
      const list = cur[arr[1]];
      if (!Array.isArray(list)) return null;
      cur = list[Number(arr[2])];
    } else {
      cur = cur[part];
    }
  }
  if (cur === null || cur === undefined) return null;
  const s = String(cur).trim();
  return s === "" ? null : s;
}

Object.assign(__x, { DEFAULT_PROFILE, DEFAULT_SETTINGS, DEFAULT_RESUME_META, resumeTextIsCurrent, extensionAlive, isContextGone, STALE_MESSAGE, loadContext, saveCorrections, loadResumeFile, saveResumeFile, save, saveProfile, saveSettings, saveLearned, confirmSavedAnswer, MAX_HISTORY, APPLICATION_STATUS, loadHistory, saveHistory, recordApplication, recordMatch, staleApplications, priorApplicationsFor, DEFAULT_JOB, loadJob, saveJob, patchJob, setJob, clearJob, loadLetters, saveLetters, safeHttpUrl, normalizeHost, isSiteDisabled, setSiteDisabled, completeness, exportAll, importAll, resetAll, storageUsage, migrateFromV1, overlayFilled, resolvePath });
};

__m["src/knowledge/client.js"] = (__x, __req) => {
async function knowledge(action, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type: "knowledge", action, ...payload });
  if (!result?.ok) throw new Error(result?.error || "Knowledge storage is unavailable. Refresh and retry.");
  return result.result;
}

Object.assign(__x, { knowledge });
};

__m["src/shared/release.js"] = (__x, __req) => {
const RELEASE_VERSION = "verified-autofill-v1";
const DEFAULT_RELEASE = { version: RELEASE_VERSION, stage: "stable", percentage: 100, cohort: 0, descriptor: true, resolver: true, adapter: true };
function releasePolicy(settings = {}) {
  const raw = settings.release || {}, policy = { ...DEFAULT_RELEASE, ...raw };
  const valid = policy.version === RELEASE_VERSION && ["stable", "pilot", "paused"].includes(policy.stage) &&
    Number.isInteger(policy.percentage) && policy.percentage >= 0 && policy.percentage <= 100 && Number.isInteger(policy.cohort) && policy.cohort >= 0 && policy.cohort < 100 &&
    ["descriptor", "resolver", "adapter"].every(key => typeof policy[key] === "boolean");
  const enabled = valid && policy.stage !== "paused" && ["descriptor", "resolver", "adapter"].every(key => policy[key]) && (policy.stage !== "pilot" || policy.cohort < policy.percentage);
  return { ...policy, enabled, reason: enabled ? "enabled" : "Automatic filling is paused by the release controls. Review, copy answers or update knowledge manually; no legacy autofill fallback is used." };
}

Object.assign(__x, { RELEASE_VERSION, DEFAULT_RELEASE, releasePolicy });
};

__m["src/shared/posting.js"] = (__x, __req) => {
// Apply karo — reading a posting off a page.
//
// A job description is almost never on the page you apply from. You read the
// posting on the listing page, press "Apply now", and the form you land on
// repeats the company boilerplate at best. The listing page has no form on it,
// so detection never loads the engine there — which left the one page holding
// the description as the one page nothing could read it from.
//
// So this lives outside the engine, and `postingFromPage` is written to survive
// being handed to chrome.scripting.executeScript({ func }). That is the only way
// onto a page the engine has no business being injected into, and it comes with
// one hard rule:
//
//   `postingFromPage` MUST NOT reference anything outside its own body.
//
// executeScript serialises the function and nothing else — a module-level
// constant it closed over would simply be undefined on the other side, and the
// failure would be a silent empty result rather than an error. Everything it
// needs is therefore declared inside it, and the smaller helpers below are
// written in terms of it rather than the other way round.

/** Enough of a posting to be worth sending. Shared by the match and the letter. */
const MIN_JD_CHARS = 200;

/**
 * The posting on this page: its text, and who it is from.
 *
 * @param {Document} [doc]
 * @param {{text?: boolean}} [opts]  text:false skips the expensive extraction
 *   for callers that only want the company and role.
 * @returns {{host:string, company:string, role:string, title:string,
 *            text:string, url:string}}
 */
function postingFromPage(doc = document, opts = {}) {
  const wantText = opts.text !== false;
  const loc = doc.defaultView?.location || location;

  // ── Who this posting is from ───────────────────────────────────────────────
  const host = loc.hostname.replace(/^www\./, "");
  const siteName =
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content")?.trim() || "";
  const company = siteName ||
    // Greenhouse and Lever both put the employer in the boilerplate host.
    (host.match(/^(?:job-boards|boards|jobs|careers|apply)\.(.+)$/)?.[1] || host).split(".")[0];

  const title = (doc.title || "").trim();
  const heading = doc.querySelector("h1")?.textContent?.trim() || "";
  // A heading is usually the role; a <title> is usually "Role at Company | Board".
  const role = (heading || title.split(/\s+[|–—]\s+/)[0] || "").slice(0, 120);

  const identity = {
    host,
    company: company.charAt(0).toUpperCase() + company.slice(1),
    role,
    title: title.slice(0, 160),
    url: loc.href.split("#")[0].slice(0, 500)
  };
  if (!wantText) return { ...identity, text: "" };

  // ── The posting itself ─────────────────────────────────────────────────────
  //
  // Containers that hold the description, most specific first. `main` and
  // `article` exist on plenty of ATS pages that also wrap the form, so they are
  // the fallback rather than the answer.
  const containers = [
    "[class*=job-description]", "[class*=jobDescription]", "[data-testid*=description]",
    "[data-automation-id*=jobPostingDescription]", "#job-details", "[class*=posting-content]",
    "[class*=job-post]", "[class*=jobPost]", "article", "main"
  ];

  let scope = null;
  for (const sel of containers) {
    const el = doc.querySelector(sel);
    if (el && (el.textContent || "").trim().length > 200) { scope = el; break; }
  }
  if (!scope) scope = doc.body;
  if (!scope) return { ...identity, text: "" };

  // The form is the trap here. On an ATS the fields sit inside the same `main`
  // as the description, and their labels — "Work authorization", "Years of
  // experience" — read to a model exactly like stated requirements, so the
  // comparison ends up scoring the candidate against the form it is about to
  // fill in. Cloning the container and cutting the controls out first is what
  // keeps the two apart.
  let text;
  try {
    const copy = scope.cloneNode(true);
    copy.querySelectorAll(
      "form,input,select,textarea,button,label,fieldset,legend,nav,header,footer,script,style," +
      '[role="navigation"],[role="banner"],[role="contentinfo"],[id*=applykaro]'
    ).forEach((n) => n.remove());
    // innerText is unavailable on a detached node, so read textContent and
    // rebuild the paragraph breaks the model needs to see structure.
    text = copy.textContent || "";
  } catch {
    text = scope.innerText || scope.textContent || "";
  }

  return {
    ...identity,
    text: text
      .replace(/[ \t ]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 9000)
  };
}

/** Just the description text. */
function jobDescriptionFromPage(doc = document) {
  return postingFromPage(doc).text;
}

/** Just the employer and role, for the application tracker. */
function pageIdentity(doc = document) {
  const { host, company, role, title } = postingFromPage(doc, { text: false });
  return { host, company, role, title };
}

Object.assign(__x, { MIN_JD_CHARS, postingFromPage, jobDescriptionFromPage, pageIdentity });
};

__m["src/engine/fill.js"] = (__x, __req) => {
// Compatibility exports for control primitives and verified adapters.
const { setValue: nativeSet, fire: nativeFire, realClick: nativeClick, isFocused: nativeFocus, commit: nativeCommit, key: nativeKey, optionScore: nativeScore, matchOption: nativeMatch, fillCombobox: nativeCombo, fillFile: nativeFile, fillSync: nativeSync, fillAsync: nativeAsync } = __req("src/engine/controls/native.js");
const setValue = nativeSet;
const fire = nativeFire;
const realClick = nativeClick;
const isFocused = nativeFocus;
const commit = nativeCommit;
const key = nativeKey;
const optionScore = nativeScore;
const matchOption = nativeMatch;
const fillCombobox = nativeCombo;
const fillFile = nativeFile;
const fillSync = nativeSync;
const fillAsync = nativeAsync;

Object.assign(__x, { setValue, fire, realClick, isFocused, commit, key, optionScore, matchOption, fillCombobox, fillFile, fillSync, fillAsync });
};

__m["src/engine/steps.js"] = (__x, __req) => {
// Apply karo — multi-step form navigation.
//
// This is the only part of the extension that acts on your behalf beyond typing
// into boxes, so the guards matter more than the mechanics. Three of them stand
// between this and an application being sent before you have read it:
//
//   1. A control whose text looks like a final submit is never clicked, even if
//      it also matches an advance pattern.
//   2. If a required field is still empty it stops rather than advancing — the
//      case where an accidental submit would do real damage.
//   3. A hard step cap, and it stops the moment the page fails to change.
//
// Kept separate from index.js so the guards are testable without booting the
// whole engine against a live chrome.* environment.

const { realClick } = __req("src/engine/fill.js");
const { hasExistingUpload, isComboboxFilled, COMBO_PLACEHOLDER_RE } = __req("src/engine/scan.js");

const ADVANCE_RE = /\b(next|continue|proceed|save and continue|save & continue|next step|go to)\b/i;
const SUBMIT_RE = /\b(submit|apply now|send application|finish|complete application|agree and|accept and|confirm and)\b/i;

const CONTROL_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "FORM", "FIELDSET"]);

function buttonText(el) {
  return (el.getAttribute("aria-label") || el.value || el.textContent || "").replace(/\s+/g, " ").trim();
}

/** True for anything that might finalise the application. */
function isSubmitLike(text) {
  return SUBMIT_RE.test(text);
}

const STEP_MARKERS =
  '[aria-current="step"],[role="progressbar"],[class*="stepper"],[class*="step-indicator"],' +
  '[class*="progress-bar"],[data-automation-id*="progressBar"],[class*="wizard"]';

/**
 * Does the page actually present itself as a multi-step flow?
 *
 * Step evidence is available for review. A submit-typed Next still requires
 * manual action because its handler can finalize an application.
 */
function hasStepIndicator(root = document) {
  if (root.querySelector?.(STEP_MARKERS)) return true;
  // textContent, not innerText — innerText forces a reflow.
  const text = (root.body || root).textContent?.slice(0, 4000) || "";
  return /\bstep\s*\d+\s*(of|\/)\s*\d+/i.test(text);
}

/**
 * The control that moves to the next step, or null.
 *
 * @returns {{el,text}|{blocked:string}|null}
 *   `blocked` means a plausible Next was found but deliberately not clicked, so
 *   the caller can say why rather than reporting a dead end.
 */
function findAdvanceButton(root = document, ownUi = "#applykaro-root") {
  const candidates = root.querySelectorAll(
    'button,[role="button"],input[type="submit"],input[type="button"],a[class*="btn"]'
  );
  let blocked = null;

  for (const el of candidates) {
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
    if (el.closest?.(ownUi)) continue;
    if (!el.getClientRects().length) continue;

    const text = buttonText(el);
    if (!text || text.length > 40) continue;
    if (isSubmitLike(text)) continue;              // guard 1 — never, under any label
    if (!ADVANCE_RE.test(text)) continue;

    // Submit-typed controls require manual action even on a wizard.
    const submits = el.type === "submit" || (el.tagName === "BUTTON" && el.type !== "button" && el.form);
    if (submits) {
      blocked = `"${text}" can submit the form — review and click it yourself.`;
      continue;
    }

    return { el, text };
  }

  return blocked ? { blocked } : null;
}

/** Required controls the page still considers empty. */
function requiredEmpty(root = document, ownUi = "#applykaro-root") {
  const out = [];
  for (const el of root.querySelectorAll('input,select,textarea,[aria-invalid="true"]')) {
    if (el.disabled || el.type === "hidden" || el.closest?.(ownUi) || el.getClientRects && !el.getClientRects().length) continue;
    if (el.validity?.valid === false || el.getAttribute?.("aria-invalid") === "true") out.push(el);
  }
  for (const el of root.querySelectorAll('[required],[aria-required="true"]')) {
    const t = (el.type || "").toLowerCase();
    if (el.disabled || t === "hidden") continue;
    if (el.closest?.(ownUi)) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;

    if (t === "radio" || t === "checkbox") {
      if (el.name) {
        const scope = el.getRootNode?.() || document;
        if (scope.querySelector(`input[name="${CSS.escape(el.name)}"]:checked`)) continue;
      } else if (el.checked) continue;
      out.push(el);
    } else if (t === "file") {
      if (!el.files?.length && !hasExistingUpload(el)) out.push(el);
    } else if (el.tagName === "SELECT") {
      const opt = el.options?.[el.selectedIndex];
      const isPlaceholder = !opt || !el.value || COMBO_PLACEHOLDER_RE.test(opt.text || "") || /^(--\s*)?(select|choose|please select)/i.test(opt.text || "");
      if (el.selectedIndex < 0 || isPlaceholder || !el.value) out.push(el);
    } else {
      const role = (el.getAttribute?.("role") || "").toLowerCase();
      if (role === "radio" || role === "checkbox" || role === "switch" || role === "option") {
        if (el.getAttribute("aria-checked") !== "true" && el.getAttribute("aria-selected") !== "true") out.push(el);
      } else if (role === "radiogroup" || role === "listbox") {
        if (!el.querySelector?.('[aria-checked="true"],[aria-selected="true"]')) out.push(el);
      } else if (role === "combobox" || el.tagName === "BUTTON" || el.matches?.('[aria-haspopup="listbox"],[data-automation-id*="prompt"]')) {
        if (!isComboboxFilled(el)) out.push(el);
      } else if (!String(el.value != null && el.value !== "" ? el.value : (el.textContent || "")).trim()) {
        out.push(el);
      }
    }
  }
  return [...new Set(out)];
}

/** Resolve once the page swaps in different controls, or false on timeout. */
function waitForAdvance(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; obs.disconnect(); clearTimeout(t); resolve(v); };
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of [...r.addedNodes, ...r.removedNodes]) {
          if (n.nodeType !== 1) continue;
          if (CONTROL_TAGS.has(n.tagName) || n.querySelector?.("input,select,textarea")) return finish(true);
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const t = setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Fill this step, advance, repeat.
 *
 * @param fillStep  async () => { filled, total } — fills whatever is on screen
 * @param opts.max  hard cap on steps (guard 3)
 * @param opts.onAdvance  hook used by tests to settle synchronous wizards
 * @returns {Promise<{filled:number, steps:number, trail:string[]}>}
 */
async function runSteps(fillStep, opts = {}) {
  const max = opts.max ?? 8;
  const trail = [];
  let filled = 0;
  let steps = 0;

  for (let i = 0; i < max; i++) {
    if (opts.isCancelled?.()) { trail.push("Stopped — fill interrupted."); break; }
    const res = await fillStep();
    filled += res.filled;
    trail.push(`Step ${i + 1}: filled ${res.filled} of ${res.total}`);

    if (res.verificationRejected || opts.isCancelled?.()) { trail.push("Stopped — review rejected or interrupted fields."); break; }
    const missing = requiredEmpty();
    if (missing.length) {                          // guard 2
      trail.push(`Stopped — ${missing.length} required field(s) still empty.`);
      missing[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
      break;
    }

    const btn = findAdvanceButton();
    if (!btn) { trail.push("Stopped — no Next button. This looks like the last step."); break; }
    if (btn.blocked) { trail.push(`Stopped — ${btn.blocked}`); break; }

    trail.push(`Clicked "${btn.text}"`);

    // Start observing before the click: a wizard that swaps its step
    // synchronously would otherwise finish mutating before we start watching.
    const watch = opts.onAdvance ? null : waitForAdvance();
    realClick(btn.el);
    steps++;

    const advanced = opts.onAdvance ? await opts.onAdvance() : await watch;
    if (!advanced) {
      trail.push("Stopped — the page did not change.");
      break;
    }
    await new Promise((r) => setTimeout(r, opts.settleMs ?? 350));
  }

  trail.push("Review the form, then submit it yourself — this never does.");
  return { filled, steps, trail };
}

Object.assign(__x, { buttonText, isSubmitLike, hasStepIndicator, findAdvanceButton, requiredEmpty, waitForAdvance, runSteps });
};

__m["src/engine/inline.js"] = (__x, __req) => {
// Apply karo — inline field AI triggers.
//
// Mounts a dedicated "Fill with AI" button on every field that demands
// paragraph answers (e.g. textareas, cover letters, challenge descriptions,
// rich textboxes). Clicking the button sends an exclusive request for that
// specific field and allows optional custom instructions.

const { ICONS } = __req("src/shared/icons.js");
const { resolveTheme } = __req("src/shared/theme.js");
const { labelOf, isGenericLabel } = __req("src/engine/scan.js");

const ROOT_ID = "applykaro-field-root";
const FONT_FAMILY = "Apply karo Inter";

function ensureFont() {
  try {
    if (!self.FontFace || !document.fonts) return;
    for (const f of document.fonts) if (f.family === FONT_FAMILY) return;
    const url = chrome.runtime.getURL("fonts/InterVariable.woff2");
    const face = new FontFace(FONT_FAMILY, `url("${url}")`, { weight: "100 900", display: "swap" });
    face.load().then((loaded) => document.fonts.add(loaded)).catch(() => {});
  } catch { /* system fallback */ }
}

const CSS = `
:host{all:initial}
*{box-sizing:border-box;
  font-family:"${FONT_FAMILY}",InterVariable,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-optical-sizing:auto}

.rf-field-wrap{position:fixed;z-index:2147483640;pointer-events:none}

.rf-field-btn{pointer-events:auto;display:inline-flex;align-items:center;gap:5px;
  height:24px;padding:0 8px;border-radius:6px;cursor:pointer;
  background:var(--surface);color:var(--brand-text);
  border:1px solid var(--border-strong);
  box-shadow:0 1px 3px rgba(16,20,30,.08),0 1px 2px rgba(16,20,30,.04);
  font-size:11px;font-weight:600;letter-spacing:-.01em;
  opacity:0.88;transition:all .14s cubic-bezier(.2,.7,.3,1);user-select:none}
.rf-field-btn:hover{opacity:1;background:var(--brand-bg);color:#fff;border-color:transparent;
  box-shadow:0 2px 8px rgba(79,70,229,.35);transform:translateY(-1px)}
.rf-field-btn:hover svg{color:#fff}
.rf-field-btn svg{width:12px;height:12px;color:var(--brand-text);flex:none}

.rf-popover{pointer-events:auto;position:fixed;width:320px;border-radius:12px;
  background:var(--surface);color:var(--text);border:1px solid var(--border);
  box-shadow:0 4px 6px -1px rgba(16,20,30,.1),0 16px 36px -4px rgba(16,20,30,.22);
  padding:13px;z-index:2147483645;animation:rf-pop .16s cubic-bezier(.2,.8,.3,1)}
@keyframes rf-pop{from{opacity:0;transform:translateY(6px) scale(.97)}}

.pop-head{display:flex;align-items:center;gap:7px;margin-bottom:8px}
.pop-brand{width:22px;height:22px;border-radius:6px;background:var(--logo-bg);
  color:#fff;display:grid;place-items:center;flex:none}
.pop-brand svg{width:12px;height:12px}
.pop-title{font-size:12.5px;font-weight:650;letter-spacing:-.01em;color:var(--text);flex:1}
.pop-close{width:20px;height:20px;border:none;background:none;cursor:pointer;
  color:var(--muted);border-radius:4px;display:grid;place-items:center;padding:0}
.pop-close:hover{background:var(--bg-inset);color:var(--text)}
.pop-close svg{width:13px;height:13px}

.pop-question{font-size:11px;line-height:1.4;color:var(--muted);background:var(--bg-inset);
  padding:6px 8px;border-radius:6px;margin-bottom:9px;word-break:break-word}
.pop-question strong{color:var(--text);font-weight:600}

.pop-label{display:block;font-size:11px;font-weight:600;color:var(--text);margin-bottom:4px}
.pop-sub{font-weight:normal;color:var(--faint)}

.pop-textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:52px;max-height:120px;
  padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);
  color:var(--text);font-size:11.5px;line-height:1.4;outline:none;margin-bottom:6px;
  font-family:inherit;transition:border-color .12s}
.pop-textarea:focus{border-color:#6366f1}

.pop-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:9px}
.pop-chip{font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid var(--border);
  background:var(--bg-inset);color:var(--muted);cursor:pointer;transition:background .12s,color .12s}
.pop-chip:hover{background:var(--border);color:var(--text)}

.pop-meta{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--faint);margin-bottom:10px}
.pop-meta svg{width:11px;height:11px;flex:none}

.pop-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.pop-btn{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:6px;
  font-size:11.5px;font-weight:550;cursor:pointer;border:1px solid var(--border);
  background:var(--surface);color:var(--text);transition:background .12s}
.pop-btn:hover:not(:disabled){background:var(--bg-inset)}
.pop-btn.primary{background:var(--brand);border-color:transparent;color:#fff;
  box-shadow:0 1px 3px rgba(79,70,229,.35)}
.pop-btn.primary:hover:not(:disabled){filter:brightness(1.08)}
.pop-btn.primary svg{color:#fff}
.pop-btn:disabled{opacity:.5;cursor:default}

.pop-status{margin-top:9px;padding:7px 8px;border-radius:6px;font-size:11px;line-height:1.45;
  background:var(--bg-inset);color:var(--muted)}
.pop-status.good{background:var(--ok-soft);color:var(--ok)}
.pop-status.warn{background:var(--warn-soft);color:var(--warn)}
.pop-status.bad{background:var(--bad-soft);color:var(--bad)}
.pop-preview{margin-top:6px;max-height:90px;overflow-y:auto;white-space:pre-wrap;
  font-size:10.5px;line-height:1.4;padding:5px;border-radius:4px;background:var(--surface);
  border:1px solid var(--border);color:var(--text)}

.spin{width:11px;height:11px;border:2px solid currentColor;border-right-color:transparent;
  border-radius:50%;animation:sp .65s linear infinite;display:inline-block;flex:none}
@keyframes sp{to{transform:rotate(360deg)}}

:host,:host([data-theme="light"]){
  --surface:#fff;--bg-inset:#f1f3f7;--border:#e2e5ec;--border-strong:#cbd0da;
  --text:#12151b;--muted:#586070;--faint:#838b99;
  --brand:linear-gradient(135deg,#6366f1,#7c3aed);
  --brand-bg:#4f46e5;--brand-text:#4f46e5;
  --logo-bg:#000;
  --ok:#0f7b46;--ok-soft:#e6f5ed;
  --warn:#92650a;--warn-soft:#fcf3e2;
  --bad:#c0273a;--bad-soft:#fdecef}
:host([data-theme="dark"]){
  --surface:#16191f;--bg-inset:#232833;--border:#2c323c;--border-strong:#3f4653;
  --text:#e8ebf0;--muted:#99a1b0;--faint:#7c8492;
  --brand:linear-gradient(135deg,#4f46e5,#7c3aed);
  --brand-bg:#4f46e5;--brand-text:#818cf8;
  --logo-bg:#000;
  --ok:#48d488;--ok-soft:#10251a;
  --warn:#e0a63f;--warn-soft:#2a2213;
  --bad:#f8737f;--bad-soft:#2c171b}
`;

const OPEN_ENDED_RE = /\b(why\b|describe\b|explain\b|tell us\b|statement\b|accomplish\b|challenge\b|experience with\b|cover letter\b|additional\b|motivation\b|what makes you\b|qualification\b|summary\b|background\b|pitch\b|essay\b)/i;
const SIMPLE_ENTITY_RE = /^(first\s*name|last\s*name|full\s*name|name|email|phone|city|state|zip|postal|country|website|linkedin|github|portfolio|salary|date|gpa|major|degree|school|university|company|title)\b/i;

/**
 * Does this field demand an open-ended or paragraph answer?
 */
function isParagraphTarget(field) {
  if (!field || !field.el) return false;
  const el = field.el;
  if (el.disabled || el.readOnly) return false;
  if (el.getAttribute?.("aria-disabled") === "true") return false;
  if (["file", "date", "select", "radiogroup", "checkboxgroup", "checkbox", "switch", "combobox"].includes(field.kind)) {
    return false;
  }
  const tag = el.tagName;
  if (tag === "TEXTAREA" || field.kind === "textarea" || field.kind === "richtext") return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute?.("role") === "textbox" && el.getAttribute?.("aria-multiline") === "true") return true;
  if (tag === "INPUT") {
    const t = (el.type || "text").toLowerCase();
    if (t !== "text" && t !== "search") return false;
    if (el.maxLength && el.maxLength >= 150) return true;
    let raw = field.rawLabel || field.label || "";
    if (!raw || isGenericLabel(raw)) {
      const fresh = labelOf(el);
      if (fresh && !isGenericLabel(fresh)) {
        raw = fresh;
        field.rawLabel = fresh;
        field.label = fresh.toLowerCase();
      }
    }
    const label = `${raw} ${field.name || ""} ${field.placeholder || ""}`.trim();
    if (label && OPEN_ENDED_RE.test(label) && !SIMPLE_ENTITY_RE.test(label)) return true;
  }
  return false;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const truncate = (s, max = 80) => {
  const str = String(s || "").trim();
  return str.length > max ? `${str.slice(0, max)}…` : str;
};

let containerHost = null;
let containerShadow = null;
let overlays = new Map(); // el -> { wrap, btn, field, popover }
let activePopover = null;
let activeFieldEl = null;
let getContextFn = null;
let onExclusiveFillFn = null;
let onCorrectQuestionFn = null;
let updateScheduled = false;

function ensureContainer() {
  if (containerHost && containerHost.isConnected) return containerShadow;
  containerHost = document.getElementById(ROOT_ID);
  if (!containerHost) {
    containerHost = document.createElement("div");
    containerHost.id = ROOT_ID;
    containerHost.style.position = "fixed";
    containerHost.style.top = "0";
    containerHost.style.left = "0";
    containerHost.style.width = "0";
    containerHost.style.height = "0";
    containerHost.style.pointerEvents = "none";
    containerHost.style.zIndex = "2147483640";
    const parent = document.body || document.documentElement;
    if (parent) parent.appendChild(containerHost);
  }
  if (!containerShadow) {
    containerShadow = containerHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    containerShadow.appendChild(style);
  }
  ensureFont();
  return containerShadow;
}

function updateTheme() {
  if (!containerHost) return;
  const ctx = getContextFn?.();
  containerHost.setAttribute("data-theme", resolveTheme(ctx?.settings?.theme));
}

function closeActivePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
    activeFieldEl = null;
  }
}

/**
 * Position button in viewport-relative fixed coordinates.
 */
function updateButtonPosition(entry) {
  const { wrap, btn, field } = entry;
  const el = field.el;
  if (!el || !el.isConnected) {
    wrap.style.display = "none";
    return;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 50 || rect.height < 15 || (!rect.width && !rect.height)) {
    wrap.style.display = "none";
    return;
  }
  // If element is scrolled completely out of viewport
  if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "block";
  const btnWidth = btn.offsetWidth || 95;
  const isTall = rect.height >= 48;

  let top, left;
  if (isTall) {
    top = rect.top + 6;
    left = rect.right - btnWidth - 8;
  } else {
    top = rect.top - 27;
    left = rect.right - btnWidth;
    if (top < 5) top = rect.top + 2;
  }

  wrap.style.top = `${Math.round(top)}px`;
  wrap.style.left = `${Math.round(left)}px`;
}

function scheduleUpdatePositions() {
  if (updateScheduled) return;
  updateScheduled = true;
  requestAnimationFrame(() => {
    updateScheduled = false;
    for (const entry of overlays.values()) {
      updateButtonPosition(entry);
    }
  });
}

function createFieldOverlay(field) {
  const shadow = ensureContainer();
  const wrap = document.createElement("div");
  wrap.className = "rf-field-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rf-field-btn";
  btn.title = "Draft a tailored answer with AI for this field";
  btn.innerHTML = `${ICONS.sparkle}<span>Fill with AI</span>`;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const current = overlays.get(field.el)?.field;
    if (current) {
      const label = labelOf(current.el);
      openPopover({ ...current, rawLabel: label || current.rawLabel, label: (label || current.label).toLowerCase() }, btn, wrap);
    }
  });

  wrap.appendChild(btn);
  shadow.appendChild(wrap);

  const entry = { wrap, btn, field };
  overlays.set(field.el, entry);
  updateButtonPosition(entry);

  if (window.ResizeObserver) {
    try {
      const ro = new window.ResizeObserver(() => scheduleUpdatePositions());
      ro.observe(field.el);
      entry.ro = ro;
    } catch {}
  }
}

function openPopover(field, btn, wrap) {
  if (activePopover && activeFieldEl === field.el) {
    closeActivePopover();
    return;
  }
  closeActivePopover();

  activeFieldEl = field.el;
  const shadow = ensureContainer();
  const ctx = getContextFn?.();
  const settings = ctx?.settings || {};
  const resumeMeta = ctx?.resumeMeta || {};
  const hasKey = settings.provider === "groq" ? !!settings.groqApiKey : !!settings.geminiApiKey;

  let label = field.rawLabel || field.label || "";
  if (!label || isGenericLabel(label)) {
    const fresh = labelOf(field.el);
    if (fresh && !isGenericLabel(fresh)) {
      label = fresh;
      field.rawLabel = fresh;
      field.label = fresh.toLowerCase();
    } else {
      label = (field.placeholder && !isGenericLabel(field.placeholder))
        ? field.placeholder
        : (field.name || "Question");
    }
  }

  const defaultInstruction = settings.defaultCustomInstruction || "";
  const resumeInfo = resumeMeta.fileName ? `Resume: ${resumeMeta.fileName}` : "No resume file";

  const pop = document.createElement("div");
  pop.className = "rf-popover";
  pop.dataset.forEl = String(field.id || field.name || label);

  pop.innerHTML = `
    <div class="pop-head">
      <div class="pop-brand">${ICONS.sparkle}</div>
      <div class="pop-title">Fill with AI</div>
      <button type="button" class="pop-close" title="Close">${ICONS.x}</button>
    </div>
    <div class="pop-question">
      <strong>Question:</strong> ${esc(truncate(label, 90))}
      ${field.el?.maxLength > 0 ? `<span class="pop-sub"> (max ${field.el.maxLength} chars)</span>` : ""}
      <details><summary>View full question</summary><span>${esc(label)}</span></details>
      <button type="button" class="pop-chip pop-correct-question">Correct detected question</button>
    </div>
    <label class="pop-label">
      Custom instruction <span class="pop-sub">(optional)</span>
    </label>
    <textarea class="pop-textarea" placeholder="e.g. Focus on my React & TypeScript experience, keep under 100 words, highlight leadership...">${esc(defaultInstruction)}</textarea>
    <div class="pop-chips">
      <button type="button" class="pop-chip" data-chip="Keep it concise, under 100 words.">Concise (&lt;100w)</button>
      <button type="button" class="pop-chip" data-chip="Emphasize leadership and team collaboration.">Leadership</button>
      <button type="button" class="pop-chip" data-chip="Focus on concrete technical architecture and tools.">Technical</button>
      <button type="button" class="pop-chip" data-chip="Highlight problem solving and project impact.">Impact</button>
    </div>
    <div class="pop-meta">${ICONS.doc}<span>${esc(resumeInfo)}</span></div>
    <div class="pop-actions">
      <button type="button" class="pop-btn pop-cancel">Cancel</button>
      <button type="button" class="pop-btn primary pop-submit">${ICONS.sparkle}<span>Generate &amp; Fill</span></button>
    </div>
    <div class="pop-status" hidden></div>
  `;

  // Position popover relative to viewport
  const btnRect = btn.getBoundingClientRect();
  const popWidth = 320;
  let popTop = btnRect.bottom + 6;
  let popLeft = btnRect.right - popWidth;
  if (popTop + 300 > window.innerHeight && btnRect.top - 300 > 0) {
    popTop = btnRect.top - 300;
  }
  popLeft = Math.max(10, Math.min(popLeft, window.innerWidth - popWidth - 10));

  pop.style.top = `${Math.round(popTop)}px`;
  pop.style.left = `${Math.round(popLeft)}px`;

  shadow.appendChild(pop);
  activePopover = pop;

  const textarea = pop.querySelector(".pop-textarea");
  const submitBtn = pop.querySelector(".pop-submit");
  const cancelBtn = pop.querySelector(".pop-cancel");
  const closeBtn = pop.querySelector(".pop-close");
  const statusBox = pop.querySelector(".pop-status");
  const chips = pop.querySelectorAll(".pop-chip");

  pop.querySelector(".pop-correct-question")?.addEventListener("click", async () => {
    if (submitBtn.disabled) return;
    const question = window.prompt("Correct the question for this field on this page:", label);
    if (!question?.trim()) return;
    try {
      const fresh = await onCorrectQuestionFn?.(field, question.trim());
      if (!fresh) throw new Error("This field could not be refreshed.");
      closeActivePopover(); openPopover(fresh, btn, wrap);
    } catch (err) { statusBox.hidden = false; statusBox.className = "pop-status warn"; statusBox.textContent = err.message; }
  });

  chips.forEach((c) => {
    if (!c.dataset.chip) return;
    c.addEventListener("click", () => {
      const phrase = c.dataset.chip || "";
      if (!textarea.value.includes(phrase)) {
        textarea.value = (textarea.value.trim() ? `${textarea.value.trim()} ${phrase}` : phrase).trim();
      }
      textarea.focus();
    });
  });

  closeBtn.addEventListener("click", closeActivePopover);
  cancelBtn.addEventListener("click", closeActivePopover);

  let lastUndo = null;

  const doGenerate = async (instruction) => {
    if (!hasKey) {
      statusBox.hidden = false;
      statusBox.className = "pop-status warn";
      statusBox.innerHTML = `No API key set. <button class="pop-btn" style="margin-top:5px;font-size:10.5px">Open Dashboard</button>`;
      statusBox.querySelector("button")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "open_options" });
      });
      return;
    }

    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spin"></span><span>Generating…</span>`;
    statusBox.hidden = false;
    statusBox.className = "pop-status";
    statusBox.textContent = "Consulting resume and writing tailored answer…";

    try {
      const res = await onExclusiveFillFn?.(field, instruction);
      if (!res?.ok) {
        throw new Error(res?.error || "Model returned no answer.");
      }
      lastUndo = res.undo;

      statusBox.className = "pop-status good";
      statusBox.innerHTML = `
        <strong>Draft filled — review before submitting</strong>
        <div class="pop-preview">${esc(res.answer)}</div>
        <div style="margin-top:6px;font-size:10.5px;color:var(--muted);font-weight:600">Refine answer:</div>
        <div class="pop-chips" style="margin-top:3px;margin-bottom:6px">
          <button type="button" class="pop-chip" data-refine="Make it shorter, strictly under 75 words.">Shorter (&lt;75w)</button>
          <button type="button" class="pop-chip" data-refine="Expand with more detail and concrete achievements.">Expand</button>
          <button type="button" class="pop-chip" data-refine="Emphasize measurable metrics and numbers.">Metrics</button>
          <button type="button" class="pop-chip" data-refine="Focus on technical architecture and tools.">Technical</button>
        </div>
        <div class="pop-actions" style="margin-top:7px">
          <button type="button" class="pop-btn pop-undo-btn">${ICONS.undo}Undo</button>
          <button type="button" class="pop-btn pop-regen-btn">${ICONS.sparkle}Regenerate</button>
          <button type="button" class="pop-btn primary pop-done-btn">Done</button>
        </div>
      `;

      submitBtn.style.display = "none";
      cancelBtn.style.display = "none";

      statusBox.querySelector(".pop-done-btn")?.addEventListener("click", closeActivePopover);

      statusBox.querySelectorAll("[data-refine]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const refine = btn.dataset.refine;
          textarea.value = refine;
          doGenerate(refine);
        });
      });

      statusBox.querySelector(".pop-undo-btn")?.addEventListener("click", () => {
        try { lastUndo?.(); }
        catch (err) {
          statusBox.className = "pop-status warn";
          statusBox.textContent = err.message || "Your later edit was kept. Review the field before trying again.";
          return;
        }
        statusBox.className = "pop-status warn";
        statusBox.innerHTML = `Restored previous text. <button class="pop-btn pop-regen-btn" style="margin-left:6px">${ICONS.sparkle}Draft new</button>`;
        statusBox.querySelector(".pop-regen-btn")?.addEventListener("click", () => {
          submitBtn.style.display = "inline-flex";
          cancelBtn.style.display = "inline-flex";
          submitBtn.disabled = false;
          cancelBtn.disabled = false;
          submitBtn.innerHTML = `${ICONS.sparkle}<span>Generate &amp; Fill</span>`;
          statusBox.hidden = true;
          textarea.focus();
        });
      });

      statusBox.querySelector(".pop-regen-btn")?.addEventListener("click", () => {
        doGenerate(textarea.value.trim());
      });
    } catch (err) {
      statusBox.className = "pop-status bad";
      statusBox.textContent = `Error: ${err.message}`;
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      submitBtn.style.display = "inline-flex";
      cancelBtn.style.display = "inline-flex";
      submitBtn.innerHTML = `${ICONS.sparkle}<span>Retry</span>`;
    }
  };

  submitBtn.addEventListener("click", () => doGenerate(textarea.value.trim()));

  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      doGenerate(textarea.value.trim());
    }
  });

  textarea.focus();
}

/**
 * Initialize field overlays with caller hooks.
 */
function initFieldOverlays({ getContext, onExclusiveFill, onCorrectQuestion }) {
  getContextFn = getContext;
  onExclusiveFillFn = onExclusiveFill;
  onCorrectQuestionFn = onCorrectQuestion;

  ensureContainer();
  updateTheme();

  window.addEventListener("scroll", scheduleUpdatePositions, true);
  window.addEventListener("resize", scheduleUpdatePositions, true);
  document.addEventListener("focusin", scheduleUpdatePositions, true);

  // Click outside to dismiss active popover
  document.addEventListener("pointerdown", (e) => {
    if (!activePopover) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (containerHost && path.includes(containerHost)) return;
    closeActivePopover();
  }, true);
}

/**
 * Update field overlays to match scanned fields.
 */
function updateFieldOverlays(fields) {
  const ctx = getContextFn?.();
  if (ctx?.settings?.fieldAiButtonEnabled === false) {
    destroyFieldOverlays();
    return;
  }

  ensureContainer();
  updateTheme();

  const paragraphs = (fields || []).filter(isParagraphTarget);
  const currentEls = new Set(paragraphs.map((f) => f.el));

  // Remove stale overlays
  for (const [el, entry] of overlays.entries()) {
    if (!currentEls.has(el) || !el.isConnected) {
      entry.ro?.disconnect();
      entry.wrap.remove();
      overlays.delete(el);
    }
  }

  // Create or refresh overlays
  for (const f of paragraphs) {
    if (!overlays.has(f.el)) {
      createFieldOverlay(f);
    } else {
      const entry = overlays.get(f.el);
      entry.field = f;
      updateButtonPosition(entry);
    }
  }
}

/**
 * Remove all field overlays and clean up.
 */
function destroyFieldOverlays() {
  closeActivePopover();
  for (const entry of overlays.values()) {
    entry.ro?.disconnect();
    entry.wrap.remove();
  }
  overlays.clear();
  if (containerHost) {
    containerHost.remove();
    containerHost = null;
    containerShadow = null;
  }
}

Object.assign(__x, { isParagraphTarget, initFieldOverlays, updateFieldOverlays, destroyFieldOverlays });
};

__m["src/shared/icons.js"] = (__x, __req) => {
// Apply karo — icon set.
//
// One 16x16 grid, one stroke weight, one set of joins. Defining them once means
// the popup, the dashboard and the on-page panel cannot drift into three
// slightly different visual languages, which is what a per-page copy-paste of
// Material paths had produced.

const wrap = (body, extra = "") =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

/* The bolt does double duty: it is the wordmark and it is the generic "fast"
   icon. One definition rather than two literals, so a tweak to the shape cannot
   leave the logo and the icon drawing slightly different bolts. */
const BOLT = `<path d="M8.5 1.5 3 9h4l-.5 5.5L13 7H9l-.5-5.5Z"/>`;

const ICONS = {
  /** The wordmark: a bolt, drawn white on the black tile. */
  brand: wrap(BOLT),

  bolt:      wrap(BOLT),
  steps:     wrap(`<path d="M2 12.5h3v-3h3v-3h3v-3h3"/>`),
  search:    wrap(`<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 4 4"/>`),
  undo:      wrap(`<path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H6"/><path d="m5 3.5-2.5 3 2.5 3"/>`),
  user:      wrap(`<circle cx="8" cy="5.3" r="2.6"/><path d="M2.8 13.7a5.2 5.2 0 0 1 10.4 0"/>`),
  cap:       wrap(`<path d="M1.5 5.8 8 2.5l6.5 3.3L8 9.1Z"/><path d="M4 7.4v3.4c0 1 1.8 1.9 4 1.9s4-.9 4-1.9V7.4"/>`),
  briefcase: wrap(`<rect x="1.8" y="4.8" width="12.4" height="8.4" rx="1.3"/>
    <path d="M5.6 4.8V3.6a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.2"/><path d="M1.8 8.4h12.4"/>`),
  link:      wrap(`<path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1"/>
    <path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1"/>`),
  doc:       wrap(`<path d="M9 1.6H4.3a1.3 1.3 0 0 0-1.3 1.3v10.2a1.3 1.3 0 0 0 1.3 1.3h7.4a1.3 1.3 0 0 0 1.3-1.3V5.6Z"/>
    <path d="M9 1.6v4h4"/><path d="M5.8 8.8h4.4M5.8 11.2h2.8"/>`),
  pen:       wrap(`<path d="M11.2 2.3a1.7 1.7 0 0 1 2.5 2.4L5.6 12.8l-3.2.8.8-3.2Z"/><path d="m10.2 3.3 2.5 2.5"/>`),
  list:      wrap(`<path d="M5.6 4h8.4M5.6 8h8.4M5.6 12h8.4"/><path d="M2.4 4h.01M2.4 8h.01M2.4 12h.01"/>`),
  brain:     wrap(`<circle cx="8" cy="8" r="6.2"/><path d="M8 5v3.6M8 11h.01"/>`),
  sliders:   wrap(`<path d="M2.2 4.6h11.6M2.2 11.4h11.6"/><circle cx="6" cy="4.6" r="1.7"/><circle cx="10.4" cy="11.4" r="1.7"/>`),
  chart:     wrap(`<path d="M2.2 13.2h11.6"/><path d="M4.4 13.2V8.4M7.6 13.2V4.6M10.8 13.2v-3"/>`),
  check:     wrap(`<path d="m3 8.4 3.2 3.2L13 4.8"/>`),
  x:         wrap(`<path d="m4.4 4.4 7.2 7.2m0-7.2-7.2 7.2"/>`),
  plus:      wrap(`<path d="M8 3.2v9.6M3.2 8h9.6"/>`),
  trash:     wrap(`<path d="M2.8 4.4h10.4"/><path d="M6.2 4.4V3.2a1 1 0 0 1 1-1h1.6a1 1 0 0 1 1 1v1.2"/>
    <path d="M12 4.4v8.2a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 12.6V4.4"/>`),
  upload:    wrap(`<path d="M8 10.6V2.8"/><path d="m4.8 6 3.2-3.2L11.2 6"/><path d="M2.6 10.4v1.8a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4v-1.8"/>`),
  download:  wrap(`<path d="M8 2.8v7.8"/><path d="m4.8 7.4 3.2 3.2 3.2-3.2"/><path d="M2.6 10.4v1.8a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4v-1.8"/>`),
  copy:      wrap(`<rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.3"/><path d="M10.6 5.4V3.7a1.3 1.3 0 0 0-1.3-1.3H3.7a1.3 1.3 0 0 0-1.3 1.3v5.6a1.3 1.3 0 0 0 1.3 1.3h1.7"/>`),
  sun:       wrap(`<circle cx="8" cy="8" r="3"/><path d="M8 1.4v1.4M8 13.2v1.4M1.4 8h1.4M13.2 8h1.4M3.3 3.3l1 1M11.7 11.7l1 1M12.7 3.3l-1 1M4.3 11.7l-1 1"/>`),
  moon:      wrap(`<path d="M13.2 9.4A5.6 5.6 0 0 1 6.6 2.8a5.8 5.8 0 1 0 6.6 6.6Z"/>`),
  monitor:   wrap(`<rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.3"/><path d="M5.6 14h4.8M8 11.2V14"/>`),
  shield:    wrap(`<path d="M8 1.8 3 3.8v4.1c0 3 2.1 5.3 5 6.3 2.9-1 5-3.3 5-6.3V3.8Z"/><path d="m6 8 1.5 1.5L10.2 6.6"/>`),
  clock:     wrap(`<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.3 1.4"/>`),
  globe:     wrap(`<circle cx="8" cy="8" r="6"/><path d="M2.2 8h11.6"/><path d="M8 2a9.5 9.5 0 0 1 0 12 9.5 9.5 0 0 1 0-12Z"/>`),
  alert:     wrap(`<circle cx="8" cy="8" r="6"/><path d="M8 5v3.4M8 10.8h.01"/>`),
  info:      wrap(`<circle cx="8" cy="8" r="6"/><path d="M8 7.4V11M8 5.2h.01"/>`),
  external:  wrap(`<path d="M9.4 2.6h4v4"/><path d="m13.4 2.6-6 6"/><path d="M11.6 9.2v3.1a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V5.6a1.2 1.2 0 0 1 1.2-1.2h3.1"/>`),
  chevron:   wrap(`<path d="m6 3.6 4.4 4.4L6 12.4"/>`),
  eye:       wrap(`<path d="M1.4 8S3.8 3.6 8 3.6 14.6 8 14.6 8 12.2 12.4 8 12.4 1.4 8 1.4 8Z"/><circle cx="8" cy="8" r="2"/>`),
  eyeOff:    wrap(`<path d="M6.3 3.9A6.3 6.3 0 0 1 8 3.7c4.2 0 6.6 4.3 6.6 4.3a12 12 0 0 1-2.1 2.7"/>
    <path d="M4.2 5.1A12 12 0 0 0 1.4 8s2.4 4.3 6.6 4.3a6.2 6.2 0 0 0 2.4-.5"/><path d="m2.4 2.4 11.2 11.2"/>`),
  power:     wrap(`<path d="M8 2.4v5.2"/><path d="M11.6 4.5a5 5 0 1 1-7.2 0"/>`),
  sparkle:   wrap(`<path d="M8 2.2 9.3 6 13 7.3 9.3 8.6 8 12.4 6.7 8.6 3 7.3 6.7 6Z"/><path d="M12.6 11.2v2.4M11.4 12.4h2.4"/>`),
  target:    wrap(`<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.6"/>`),
  archive:   wrap(`<rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3.2 6v6.4a1.2 1.2 0 0 0 1.2 1.2h7.2a1.2 1.2 0 0 0 1.2-1.2V6"/><path d="M6.6 9h2.8"/>`),
  mail:      wrap(`<rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.4"/><path d="m2.4 4.6 5.6 4 5.6-4"/>`),
  bug:       wrap(`<rect x="5" y="4.8" width="6" height="8" rx="3"/>
    <path d="M6.2 5.2a1.8 1.8 0 0 1 3.6 0"/><path d="M5 7.4H2.6M5 10.6H2.8M11 7.4h2.4M11 10.6h2.2"/>`)
};

/** Convenience for building markup strings. */
const icon = (name, cls = "") =>
  cls ? ICONS[name].replace("<svg ", `<svg class="${cls}" `) : ICONS[name];

Object.assign(__x, { ICONS, icon });
};

__m["src/shared/theme.js"] = (__x, __req) => {
// Apply karo — theme resolution.
//
// The stored preference is one of "system" | "light" | "dark". Everything that
// paints reads the *resolved* value off `<html data-theme>`, so the CSS only
// ever has to know about two palettes rather than three states.
//
// styles.css also carries a `prefers-color-scheme` block for `:root:not([data-theme])`,
// which covers the frame or two before this module runs — without it a dark-mode
// user gets a white flash on every popup open.

const THEMES = ["system", "light", "dark"];

const mql = () =>
  (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null);

/** "light" | "dark" — what a preference actually means right now. */
function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return mql()?.matches ? "dark" : "light";
}

/**
 * Paint a preference onto a document (or a shadow host, for the on-page panel).
 * Returns the resolved theme so callers can label a toggle without re-deriving it.
 */
function applyTheme(pref, root) {
  const resolved = resolveTheme(pref);
  const target = root || document.documentElement;
  target.dataset.theme = resolved;
  if (target.style) target.style.colorScheme = resolved;
  return resolved;
}

/**
 * Keep `pref` painted, following the OS while it is "system".
 * Returns a function that stops watching.
 */
function watchTheme(getPref, root, onChange) {
  const m = mql();
  if (!m) return () => {};
  const handler = () => {
    if (getPref() !== "system") return;
    onChange?.(applyTheme("system", root));
  };
  m.addEventListener?.("change", handler);
  return () => m.removeEventListener?.("change", handler);
}

Object.assign(__x, { THEMES, resolveTheme, applyTheme, watchTheme });
};

__m["src/engine/session.js"] = (__x, __req) => {
// Revisions are local to the document. Never write or undo over a later edit.
function captureRevision(field, question) {
  const el = field.el;
  let revision = 0;
  const changed = () => { revision++; };
  el.addEventListener("input", changed);
  el.addEventListener("change", changed);
  const value = () => String(el.value ?? el.textContent ?? "");
  const initial = value();
  return {
    valid: (currentQuestion) => el.isConnected && revision === 0 && value() === initial && currentQuestion === question,
    dispose: () => { el.removeEventListener("input", changed); el.removeEventListener("change", changed); }
  };
}
const TERMINAL_STATES = ["completed", "needs_attention", "failed", "interrupted"];
function isRunningJob(job) { return !!job && !TERMINAL_STATES.includes(job.state); }
const JOB_LABELS = { preparing: "Preparing page…", detecting: "Detecting fields…", filling: "Filling…", waiting_ai: "Waiting for AI…", verifying: "Checking fields…", completed: "Completed — review before submitting.", needs_attention: "Needs attention", failed: "Fill failed", interrupted: "Fill interrupted — review before retrying." };

Object.assign(__x, { captureRevision, TERMINAL_STATES, isRunningJob, JOB_LABELS });
};

__m["src/engine/discovery/queue.js"] = (__x, __req) => {
// Unprocessed fields remain explicit and are eligible on the next manual pass.
async function processQueue(fields, process, { batchSize = 16, shouldStop = () => false, onProgress = () => {} } = {}) {
  const results = [];
  let cursor = 0;
  while (cursor < fields.length && !shouldStop()) {
    onProgress(fields.length - cursor);
    const batch = fields.slice(cursor, cursor + batchSize);
    const result = await process(batch);
    results.push(result); cursor += batch.length;
    if (result.quota) break;
  }
  return { results, remaining: fields.slice(cursor), processed: cursor };
}

Object.assign(__x, { processQueue });
};

__m["src/engine/diagnostics.js"] = (__x, __req) => {
// Opt-in, frame-local diagnostics. Never retain labels, values, selectors or URLs.
// A successful write attempt is not called verified: readback belongs to the verifier.
const OUTCOMES = Object.freeze([
  "discovered", "deferred", "unsupported", "ambiguous", "missing_fact",
  "answer_ready", "write_attempted", "write_reported", "write_rejected",
  "observed_nonempty", "verified", "edited", "reviewed"
]);
const STAGES = new Set(["discovery", "rules", "widgets", "ai", "review", "run", "verify", "resolver"]);
const REASONS = new Set([
  "scan", "existing_value", "user_modified", "focused", "no_rule", "no_value",
  "widget_pending", "budget", "rule", "memory", "ai", "control_refused",
  "source_unverified", "not_empty", "remaining_empty", "run_start", "run_end", "canonical_value_persistent", "value_not_persistent", "validation_failed", "stale_descriptor", "cancelled", "user_edit", "not_attempted"
]);
const KINDS = new Set(["text", "textarea", "select", "combobox", "radiogroup",
  "checkboxgroup", "checkbox", "switch", "date", "dategroup", "file", "richtext"]);
const SIGNALS = new Set(["aria-label", "aria-labelledby", "label", "placeholder", "name", "context"]);

function createDiagnostics({ clock = () => performance.now(), limit = 400 } = {}) {
  let enabled = false, events = [], dropped = 0, sequence = 0, runId = 0, start = 0;
  let identities = new WeakMap();
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 2000) : 400;
  function configure(on) {
    enabled = on === true;
    if (!enabled) { events = []; dropped = 0; identities = new WeakMap(); sequence = 0; }
  }
  function fieldId(field) {
    const el = field?.el;
    if (!enabled || !el || typeof el !== "object") return 0;
    if (!identities.has(el)) identities.set(el, ++sequence);
    return identities.get(el);
  }
  function record({ field, stage, outcome, reason, source, frame = "top" } = {}) {
    if (!enabled || !STAGES.has(stage) || (outcome && !OUTCOMES.includes(outcome))) return;
    const event = {
      runId, fieldId: fieldId(field), frame: frame === "child" ? "child" : "top",
      stage, outcome: outcome || null, reason: REASONS.has(reason) ? reason : null,
      kind: KINDS.has(field?.kind) ? field.kind : null,
      extractionSource: SIGNALS.has(source) ? source : null,
      ms: Math.max(0, Math.round(clock() - start))
    };
    events.push(event);
    if (events.length > cap) { events.shift(); dropped++; }
  }
  function begin(frame) {
    if (!enabled) return;
    runId++; start = clock();
    record({ stage: "run", reason: "run_start", frame });
  }
  function snapshot() {
    return { version: 1, enabled, dropped, events: events.map((e) => ({ ...e })) };
  }
  return { get enabled() { return enabled; }, configure, begin, record, snapshot };
}

// Candidate signal only, not a claim about which branch labelFor actually selected.
function extractionSignal(field) {
  const el = field?.el;
  if (el?.getAttribute?.("aria-labelledby")) return "aria-labelledby";
  if (el?.getAttribute?.("aria-label")) return "aria-label";
  if (el?.labels?.length || el?.closest?.("label")) return "label";
  if (field?.rawLabel) return "context";
  if (field?.placeholder) return "placeholder";
  return field?.name ? "name" : null;
}

Object.assign(__x, { OUTCOMES, createDiagnostics, extractionSignal });
};

__m["src/engine/review.js"] = (__x, __req) => {
const REVIEW_GROUPS = ["Verified facts", "Drafts to review", "Missing facts", "Could not fill"];
function reviewRow(field, decision, value, validation, empty) {
  const verified = field.verification?.status === "verified" && validation !== "failed";
  const group = validation === "failed" || field.verification?.status === "rejected" || decision?.status === "blocked" || decision?.status === "deferred" || field.skip
    ? "Could not fill" : decision?.status === "draft" ? "Drafts to review" : verified && decision?.status === "resolved" ? "Verified facts" : empty ? "Missing facts" : "Drafts to review";
  return { id: field.fieldId, revision: field.formRevision, question: field.questionFull || field.rawLabel || field.label || "Unlabeled field", group,
    answer: value, source: decision?.source || (empty ? "No confirmed source" : "Existing or manually entered value"),
    transformations: decision?.transformations || [], reason: field.verification?.reason || decision?.reason || (empty ? "A confirmed answer is needed" : "Review this value"),
    required: !!field.required, editable: !field.skip && field.kind !== "file", missingKey: JSON.stringify([field.questionFull || field.rawLabel, field.section, field.sectionTitle, field.helperText, field.entityId,
      field.kind, field.type, field.phonePart, field.country, field.company, field.polarity, field.units, field.constraints, field.options?.map(o => o.label)]) };
}
function redactReview(rows, includeAnswers = false, includeQuestions = false) {
  return rows.map(({ id, revision, group, answer, question, source, transformations, reason, required }) => ({ id, revision, group, required,
    question: includeQuestions ? question : "[redacted]", answer: includeAnswers ? answer : "[redacted]", source, transformations, reason }));
}

Object.assign(__x, { REVIEW_GROUPS, reviewRow, redactReview });
};

__m["src/engine/panel.js"] = (__x, __req) => {
// Apply karo — on-page panel.
//
// Imported only in the top frame, only on pages that passed detection. Rendered
// into a shadow root with `all: initial` so the host page's CSS cannot reach in
// and nothing here leaks out.
//
// Visual intent: read as part of the browser, not as an ad. Neutral surface,
// one accent, hairline borders, system type, real icons. It sits on top of
// someone's job application, so it should be quiet — collapsed to a small pill
// until you ask it for something, and draggable out of the way when a site puts
// its own controls in the same corner.

const { ICONS } = __req("src/shared/icons.js");
const { resolveTheme } = __req("src/shared/theme.js");
const { feedbackMailto } = __req("src/shared/contact.js");
const { extensionAlive, isContextGone, STALE_MESSAGE } = __req("src/shared/schema.js");

const HOST_ID = "applykaro-root";

/* The bundled typeface, matched to the popup and the dashboard.
 *
 * Chrome ignores @font-face rules declared inside a shadow root, so the face has
 * to be registered on the host document instead. The family name is namespaced
 * so it can never collide with — or be picked up by — the page's own styles;
 * only the markup below asks for it. If anything here fails the stack falls back
 * to system type, which is what the panel used before. */
const FONT_FAMILY = "Apply karo Inter";

function ensureFont() {
  try {
    if (!self.FontFace || !document.fonts) return;
    for (const f of document.fonts) if (f.family === FONT_FAMILY) return;
    const url = chrome.runtime.getURL("fonts/InterVariable.woff2");
    const face = new FontFace(FONT_FAMILY, `url("${url}")`, { weight: "100 900", display: "swap" });
    face.load().then((loaded) => document.fonts.add(loaded)).catch(() => {});
  } catch { /* system stack it is */ }
}

const CSS = `
:host{all:initial}
*{box-sizing:border-box;
  font-family:"${FONT_FAMILY}",InterVariable,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-optical-sizing:auto;font-feature-settings:"liga" 1,"calt" 1,"cv05" 1}

.wrap{position:fixed;z-index:2147483646;
  display:flex;flex-direction:column;align-items:flex-end;gap:9px}

/* Launcher */
.fab{position:relative;display:flex;align-items:center;gap:7px;
  height:36px;padding:0 12px 0 10px;border-radius:10px;cursor:pointer;
  background:var(--surface);color:var(--text);
  border:1px solid var(--border);
  box-shadow:0 1px 2px rgba(16,20,30,.08),0 6px 18px rgba(16,20,30,.12);
  font-size:12.5px;font-weight:550;letter-spacing:-.01em;
  transition:transform .16s cubic-bezier(.2,.7,.3,1),box-shadow .16s,background .13s,border-color .13s}
.fab:hover{background:var(--bg-inset);border-color:var(--border-strong);transform:translateY(-1px);
  box-shadow:0 2px 4px rgba(16,20,30,.09),0 10px 24px rgba(16,20,30,.16)}
.fab:active{transform:translateY(0)}
.fab .badge{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;
  background:var(--logo-bg);box-shadow:inset 0 0 0 1px var(--logo-ring);color:#fff;flex:none}
.fab .badge svg{width:13px;height:13px}
.count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;
  background:var(--ok-soft);color:var(--ok);
  font-size:10.5px;font-weight:650;line-height:18px;text-align:center;display:none}
.count.on{display:block}
.grip{width:9px;height:16px;margin-left:1px;cursor:grab;flex:none;
  background-image:radial-gradient(circle,var(--faint) 1px,transparent 1px);
  background-size:4px 4px;opacity:.55}
.grip:active{cursor:grabbing}
.fab:hover .grip{opacity:.9}

/* Card */
.card{width:290px;border-radius:14px;overflow:hidden;display:none;
  background:var(--surface);border:1px solid var(--border);
  box-shadow:0 1px 3px rgba(16,20,30,.08),0 18px 44px rgba(16,20,30,.20);
  transform-origin:bottom right}
.card.open{display:block;animation:pop .18s cubic-bezier(.2,.8,.3,1)}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.97)}}

.head{display:flex;align-items:center;gap:8px;padding:11px 12px 10px}
.head .badge{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;
  background:var(--logo-bg);box-shadow:inset 0 0 0 1px var(--logo-ring);color:#fff;flex:none}
.head .badge svg{width:14px;height:14px}
.name{font-size:12.5px;font-weight:650;letter-spacing:-.02em;color:var(--text);flex:1;line-height:1.2}
.host{font-size:10px;color:var(--faint);font-weight:400;display:block;margin-top:1px}
.x{width:22px;height:22px;border:none;background:none;cursor:pointer;
  color:var(--muted);border-radius:5px;display:grid;place-items:center;padding:0}
.x svg{width:14px;height:14px}
.x:hover{background:var(--bg-inset);color:var(--text)}

.body{padding:0 12px 12px}

.status{display:flex;align-items:flex-start;gap:7px;
  font-size:11px;color:var(--muted);line-height:1.45;
  margin:0 0 10px;padding:8px 9px;border-radius:8px;
  background:var(--bg-inset)}
.status svg{width:13px;height:13px;flex:none;margin-top:.5px;color:var(--muted)}
.status.good{background:var(--ok-soft);color:var(--ok)}
.status.good svg{color:var(--ok)}
.status.warn{background:var(--warn-soft);color:var(--warn)}
.status.warn svg{color:var(--warn)}
.status.bad{background:var(--bad-soft);color:var(--bad)}
.status.bad svg{color:var(--bad)}
.spin{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;
  border-radius:50%;animation:sp .65s linear infinite;flex:none;margin-top:.5px}
@keyframes sp{to{transform:rotate(360deg)}}

button.act{display:flex;align-items:center;gap:8px;width:100%;
  padding:8px 10px;margin-bottom:4px;border-radius:8px;cursor:pointer;
  font-size:12px;font-weight:550;text-align:left;letter-spacing:-.01em;
  border:1px solid var(--border);background:var(--surface);color:var(--text);
  transition:background .12s,border-color .12s,transform .1s}
button.act:hover:not(:disabled){background:var(--bg-inset);border-color:var(--border-strong)}
button.act:active:not(:disabled){transform:translateY(1px)}
button.act:disabled{opacity:.45;cursor:default}
button.act svg{width:14px;height:14px;flex:none;color:var(--muted)}
button.act .kb{margin-left:auto;font-size:9.5px;padding:1px 4px;border-radius:4px;
  border:1px solid var(--border);color:var(--faint);font-family:ui-monospace,Menlo,Consolas,monospace}
button.act.primary{background:var(--brand);border-color:transparent;color:#fff;
  box-shadow:0 1px 3px rgba(79,70,229,.35)}
button.act.primary:hover:not(:disabled){filter:brightness(1.08);border-color:transparent}
button.act.primary svg{color:#fff}
button.act.primary .kb{border-color:rgba(255,255,255,.35);color:rgba(255,255,255,.85)}

.split{display:flex;gap:4px;margin-bottom:4px}
.split button.act{margin-bottom:0}

.more{max-height:0;overflow:hidden;transition:max-height .22s cubic-bezier(.2,.7,.3,1)}
.more.open{max-height:180px}

.trail{font:10.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  white-space:pre-wrap;margin:8px 0 0;padding:8px 9px;border-radius:8px;
  background:var(--bg-inset);color:var(--muted);max-height:120px;overflow:auto}

/* You have applied to this employer before. */
.dupe{margin-top:8px;padding:7px 9px;border-radius:8px;font-size:10.5px;
  line-height:1.5;background:var(--warn-soft);color:var(--warn)}

/* Match result. The score is a headline, the two lists are the substance. */
.match{margin-top:8px;padding:9px;border-radius:8px;
  background:var(--bg-inset);max-height:230px;overflow:auto}
.match .top{display:flex;align-items:center;gap:9px;margin-bottom:7px}
.match .score{font-size:19px;font-weight:650;letter-spacing:-.02em;line-height:1}
.match .score.strong{color:var(--ok)}
.match .score.fair{color:var(--warn)}
.match .score.weak{color:var(--danger,#c0392b)}
.match .sum{flex:1;font-size:10.5px;line-height:1.5;color:var(--muted)}
.match h4{margin:8px 0 3px;font-size:9.5px;font-weight:650;letter-spacing:.05em;
  text-transform:uppercase;color:var(--faint)}
.match ul{margin:0;padding:0;list-style:none}
.match li{font-size:10.5px;line-height:1.5;color:var(--text);
  padding-left:13px;position:relative;margin-bottom:2px}
.match li::before{position:absolute;left:0;top:0}
.match li.yes::before{content:"✓";color:var(--ok)}
.match li.no::before{content:"•";color:var(--warn)}
.match li.blocking::before{content:"!";color:var(--danger,#c0392b);font-weight:700}
.match li em{font-style:normal;color:var(--faint)}

.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;
  margin-top:9px;padding-top:9px;border-top:1px solid var(--border);
  font-size:10px;color:var(--faint)}
.linkbtn{border:none;background:none;padding:0;cursor:pointer;
  font:inherit;font-size:10px;color:var(--faint);text-decoration:underline;
  text-underline-offset:2px}
.linkbtn:hover{color:var(--muted)}
.by{margin-top:6px;text-align:center;font-size:9.5px;color:var(--faint)}
.by strong{font-weight:600;color:var(--muted)}
.by .dot{opacity:.5;margin:0 4px}
.by a{color:var(--faint);text-decoration:underline;text-underline-offset:2px;
  text-decoration-color:var(--border-strong)}
.by a:hover{color:var(--muted);text-decoration-color:currentColor}
kbd{font:inherit;font-size:9.5px;padding:1px 5px;border-radius:4px;
  border:1px solid var(--border);background:var(--bg-inset);color:var(--muted);
  font-family:ui-monospace,Menlo,Consolas,monospace}

/* Tokens, light and dark.
   --brand has white text on it; --accent-ish roles are drawn on the surface.
   One token cannot satisfy both in dark mode without failing contrast. */
:host,:host([data-theme="light"]){
  --surface:#fff;--bg-inset:#f1f3f7;--border:#e2e5ec;--border-strong:#cbd0da;
  --text:#12151b;--muted:#586070;--faint:#838b99;
  --brand:linear-gradient(135deg,#6366f1,#7c3aed);
  --logo-bg:#000;--logo-ring:transparent;
  --ok:#0f7b46;--ok-soft:#e6f5ed;
  --warn:#92650a;--warn-soft:#fcf3e2;
  --bad:#c0273a;--bad-soft:#fdecef}
:host([data-theme="dark"]){
  --surface:#16191f;--bg-inset:#232833;--border:#2c323c;--border-strong:#3f4653;
  --text:#e8ebf0;--muted:#99a1b0;--faint:#7c8492;
  --brand:linear-gradient(135deg,#4f46e5,#7c3aed);
  --logo-bg:#000;--logo-ring:rgba(255,255,255,.16);
  --ok:#48d488;--ok-soft:#10251a;
  --warn:#e0a63f;--warn-soft:#2a2213;
  --bad:#f8737f;--bad-soft:#2c171b}
:host([data-theme="dark"]) .fab{box-shadow:0 1px 2px rgba(0,0,0,.45),0 6px 18px rgba(0,0,0,.4)}
:host([data-theme="dark"]) .fab:hover{box-shadow:0 2px 4px rgba(0,0,0,.5),0 10px 24px rgba(0,0,0,.5)}
:host([data-theme="dark"]) .card{box-shadow:0 1px 3px rgba(0,0,0,.5),0 18px 44px rgba(0,0,0,.6)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const DEFAULT_POS = { right: 16, bottom: 16 };

function mount({
  onFill, onFillSteps, onUndo, onHighlight, onReview, onReviewAction, onCoverLetter, onMatch,
  onPriorApplications, onDisableSite, onMove, canUndo, getContext, reload
}) {
  if (document.getElementById(HOST_ID)) return null;

  ensureFont();

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = CSS;

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <div class="card" role="dialog" aria-label="Apply karo">
      <div class="head">
        <span class="badge">${ICONS.brand}</span>
        <span class="name">Apply karo<span class="host" data-host></span></span>
        <button class="x" data-close aria-label="Close">${ICONS.x}</button>
      </div>
      <div class="body">
        <p class="status" data-status>${ICONS.info}<span data-status-text>Ready</span></p>

        <button class="act primary" data-fill>${ICONS.bolt}Fill this page<span class="kb">⌥⇧F</span></button>
        <div class="split">
          <button class="act" data-steps title="Fill each step and click Next. Never submits.">
            ${ICONS.steps}Steps</button>
          <button class="act" data-undo title="Put every field this filled back the way it was">
            ${ICONS.undo}Undo</button>
        </div>
        <button class="act" data-review>${ICONS.search}Review answers and missing fields</button>
        <button class="act" data-match>${ICONS.target}Match me against this job</button>
        <button class="act" data-letter>${ICONS.sparkle}Draft a cover letter</button>

        <div class="dupe" data-dupe hidden></div>
        <div class="match" data-match-out hidden></div>

        <div class="more" data-more>
          <button class="act" data-options>${ICONS.user}Edit profile</button>
          <button class="act" data-off>${ICONS.power}Turn off on this site</button>
        </div>

        <pre class="trail" data-trail hidden></pre>

        <div class="foot">
          <span>Never submits for you</span>
          <button class="linkbtn" data-toggle-more>More</button>
        </div>
        <div class="by">Made by <strong>Rishit Goel</strong><span class="dot">·</span><a
          data-feedback href="#" target="_blank" rel="noopener noreferrer" title="Email me a bug, an error or an idea">Report a bug</a></div>
      </div>
    </div>
    <button class="fab" data-toggle aria-label="Apply karo">
      <span class="badge">${ICONS.brand}</span><span>Fill</span>
      <span class="count" data-count></span>
      <span class="grip" data-grip title="Drag to move"></span>
    </button>
  `;

  shadow.append(style, wrap);
  (document.body || document.documentElement).appendChild(host);

  const $ = (sel) => shadow.querySelector(sel);
  const card = $(".card");
  const count = $("[data-count]");
  const statusBox = $("[data-status]");
  const statusText = $("[data-status-text]");
  const fillBtn = $("[data-fill]");
  const stepsBtn = $("[data-steps]");
  const undoBtn = $("[data-undo]");
  const letterBtn = $("[data-letter]");
  const matchBtn = $("[data-match]");
  const matchOut = $("[data-match-out]");
  const dupe = $("[data-dupe]");
  const trail = $("[data-trail]");
  const more = $("[data-more]");
  const review = document.createElement("div"); review.hidden = true; review.dataset.reviewList = "";
  review.style.cssText = "max-height:55vh;overflow:auto;padding:12px;overflow-wrap:anywhere";
  $(".body").appendChild(review);
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const actionButton = (label, action) => {
    const b = node("button", label); b.type = "button"; b.className = "act";
    b.addEventListener("click", async () => { b.disabled = true; try { await action(); } catch (e) { setStatus(e.message, "bad"); } finally { b.disabled = false; } }); return b;
  };
  async function openReview() {
    card.classList.add("open");
    review.hidden = false; review.replaceChildren();
    const rows = await onReview();
    setStatus(`${rows.filter(r => r.group === "Verified facts").length} verified · ${rows.filter(r => r.group === "Drafts to review").length} drafts · ${rows.filter(r => r.group === "Missing facts").length} missing · ${rows.filter(r => r.group === "Could not fill").length} could not fill.`, "");
    const selected = [];
    review.append(node("p", "Review answers, then submit the application yourself."));
    review.append(actionButton("Set common facts once", () => chrome.runtime.sendMessage({ type: "open_options", tab: "tab-learned" })));
    const includeAnswers = document.createElement("input"), includeQuestions = document.createElement("input"); includeAnswers.type = includeQuestions.type = "checkbox";
    const answerLabel = node("label", " Include answers in issue report "); answerLabel.prepend(includeAnswers);
    const questionLabel = node("label", " Include question text "); questionLabel.prepend(includeQuestions);
    review.append(answerLabel, questionLabel, actionButton("Export issue report", async () => {
      const { redactReview } = await Promise.resolve(__req("src/engine/review.js"));
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, fields: redactReview(rows, includeAnswers.checked, includeQuestions.checked) }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "apply-karo-review.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    for (const group of ["Verified facts", "Drafts to review", "Missing facts", "Could not fill"]) {
      const entries = rows.filter(r => r.group === group); review.append(node("h3", `${group} (${entries.length})`));
      for (const row of entries) {
        const box = node("div", ""); box.style.cssText = "border-top:1px solid #8885;padding:8px 0";
        box.append(actionButton(row.question + (row.required ? " *" : ""), () => onReviewAction(row, "focus")),
          node("p", `Source: ${typeof row.source === "string" ? row.source : JSON.stringify(row.source)}`),
          node("p", `${String(row.reason || "").replace(/_/g, " ")}${row.transformations.length ? " · " + row.transformations.join(", ").replace(/_/g, " ") : ""}`));
        const input = document.createElement("textarea"); input.value = row.answer || ""; input.setAttribute("aria-label", `Answer: ${row.question}`); input.style.cssText = "width:100%;box-sizing:border-box;min-height:50px";
        input.disabled = !row.editable; box.append(input);
        if (row.editable) {
          const pick = document.createElement("input"); pick.type = "checkbox"; const label = node("label", " Reviewed; include in batch confirmation"); label.prepend(pick); box.append(label); selected.push({ row, input, pick });
          const apply = async scope => {
            const dependents = group === "Missing facts" ? rows.filter(r => r.editable && r.group === "Missing facts" && r.missingKey === row.missingKey) : [row];
            for (const dependent of dependents) await onReviewAction(dependent, "confirm", input.value, scope);
            await openReview();
          };
          box.append(actionButton("Use for this application", () => apply("application")), actionButton("Remember for similar questions", () => apply("similar")), actionButton("Wrong field mapping", async () => { await onReviewAction(row, "mapping-repair"); setStatus("Mapping marked incorrect. Review and replace the answer.", "warn"); }), actionButton("Undo this field", async () => { await onReviewAction(row, "undo"); await openReview(); }));
        }
        review.append(box);
      }
    }
    review.append(actionButton("Confirm selected answers", async () => {
      const choices = selected.filter(c => c.pick.checked); if (!choices.length) throw new Error("Select the answers you have reviewed.");
      for (const c of choices) await onReviewAction(c.row, "confirm", c.input.value, "application"); await openReview();
    }), actionButton("Refresh review", openReview));
  }

  $("[data-host]").textContent = location.hostname.replace(/^www\./, "");

  /* A bug report from here is worth far more with the page it happened on
     attached — that is the whole reason the link lives in the panel and not
     only in the dashboard. */
  const fbLink = $("[data-feedback]");
  fbLink.href = feedbackMailto("bug", { Site: location.host });
  fbLink.target = "_blank";
  fbLink.rel = "noopener noreferrer";

  // ── Theme ────────────────────────────────────────────────────────────────
  const paint = () => {
    host.setAttribute("data-theme", resolveTheme(getContext()?.settings?.theme));
  };
  paint();
  matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", paint);

  // ── Position ─────────────────────────────────────────────────────────────
  const place = (pos) => {
    const p = pos || DEFAULT_POS;
    wrap.style.right = `${p.right}px`;
    wrap.style.bottom = `${p.bottom}px`;
  };
  place(getContext()?.settings?.panelPos);

  // Some sites pin their own chat bubble bottom-right. Dragging the grip moves
  // ours instead of making the user choose between the two.
  (function draggable() {
    const grip = $("[data-grip]");
    let start = null;

    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = wrap.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, right: innerWidth - r.right, bottom: innerHeight - r.bottom };
      grip.setPointerCapture(e.pointerId);
    });

    grip.addEventListener("pointermove", (e) => {
      if (!start) return;
      const right = Math.max(4, Math.min(innerWidth - 80, start.right - (e.clientX - start.x)));
      const bottom = Math.max(4, Math.min(innerHeight - 60, start.bottom - (e.clientY - start.y)));
      place({ right: Math.round(right), bottom: Math.round(bottom) });
    });

    const end = () => {
      if (!start) return;
      start = null;
      onMove?.({
        right: parseInt(wrap.style.right, 10) || DEFAULT_POS.right,
        bottom: parseInt(wrap.style.bottom, 10) || DEFAULT_POS.bottom
      });
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    // A drag that ends on the grip must not also read as a click on the pill.
    grip.addEventListener("click", (e) => e.stopPropagation());
  })();

  // ── Status line ──────────────────────────────────────────────────────────
  function setStatus(text, tone = "", busy = false) {
    statusBox.className = `status ${tone}`;
    statusBox.firstChild.replaceWith(
      busy ? spinNode() : iconNode(tone === "bad" ? "alert" : tone === "warn" ? "alert" : tone === "good" ? "check" : "info")
    );
    statusText.textContent = text;
  }

  function iconNode(name) {
    const t = document.createElement("template");
    t.innerHTML = ICONS[name];
    return t.content.firstElementChild;
  }
  function spinNode() {
    const s = document.createElement("span");
    s.className = "spin";
    return s;
  }

  const setOpen = (open) => {
    card.classList.toggle("open", open);
    if (open) { refreshStatus(); checkPrior(); }
  };

  $("[data-toggle]").addEventListener("click", () => setOpen(!card.classList.contains("open")));
  $("[data-close]").addEventListener("click", () => setOpen(false));
  shadow.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });

  $("[data-toggle-more]").addEventListener("click", (e) => {
    const open = more.classList.toggle("open");
    e.target.textContent = open ? "Less" : "More";
  });

  const busyButtons = [fillBtn, stepsBtn, letterBtn, matchBtn, undoBtn];
  const lock = (on) => busyButtons.forEach((b) => { b.disabled = on; });

  /**
   * Has this page outlived the extension that put the panel on it?
   *
   * Reloading an unpacked build — which is what you do after every edit — cuts
   * every open tab off from storage and from the service worker. The panel is
   * still on screen and its buttons still look live, but nothing behind them
   * exists: the fill reaches no worker, the status read rejects, and the only
   * clue was an uncaught "Extension context invalidated" in the console. So
   * every action asks first, and the answer is a sentence that says what to do
   * rather than a stack trace.
   */
  function alive() {
    if (extensionAlive()) return true;
    lock(true);
    setStatus(STALE_MESSAGE, "warn");
    return false;
  }

  /** The same message, for an action that was already in flight when it died. */
  const failure = (err) => (isContextGone(err) ? STALE_MESSAGE : err.message);

  /**
   * What to say after a fill, as [text, tone].
   *
   * The old version had one branch for "filled nothing" and it read "Nothing
   * left to fill here." That sentence was only ever true by accident: a fill
   * ends with nothing filled far more often because the AI could not answer —
   * a spent API quota, a key that was never added, the feature switched off —
   * than because the form is complete. Reporting a failure as completeness is
   * how someone submits a half-empty application believing the extension had
   * checked it. So the count of fields still empty decides the wording, and
   * whatever the AI reported is always passed on rather than swallowed.
   */
  function fillOutcome(r) {
    const left = Number(r.empty || 0);
    const done = Number(r.filled || 0);
    // Fields the filler cannot see at all. Reported separately because no amount
    // of pressing Fill again will touch them, and saying so is the difference
    // between a bug someone can report and an extension that looks lazy.
    const blind = Number(r.unseen || 0)
      ? ` ${r.unseen} of them I can't see at all — the page console has the details.`
      : "";

    if (r.aiError) {
      const head = done ? `Filled ${done} of ${r.total}.` : "The rules filled nothing new.";
      const tail = left ? ` ${left} field(s) still empty.` : "";
      return [`${head}${tail}${blind} ${r.aiError}`, "warn"];
    }
    if (done) {
      const tail = left ? ` ${left} still empty.${blind}` : "";
      return [`Filled ${done} of ${r.total} fields.${tail} Amber outlines are guesses worth checking.`, "good"];
    }
    if (!r.total) return ["No form fields found on this page.", "warn"];
    if (left) {
      return [`Nothing here I could answer — ${left} field(s) are still empty.${blind} ` +
              `"Highlight what's still empty" will show you which.`, "warn"];
    }
    return ["Every field on this page already has a value.", "good"];
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  fillBtn.addEventListener("click", async () => {
    if (!alive()) return;
    lock(true);
    setStatus("Filling…", "", true);
    try {
      const r = await onFill((msg) => setStatus(msg, "", true));
      setCount(r.filled);
      setStatus(...fillOutcome(r));
    } catch (err) {
      setStatus(`Couldn't fill: ${failure(err)}`, "bad");
    } finally {
      lock(false);
      syncUndo();
    }
  });

  stepsBtn.addEventListener("click", async () => {
    if (!alive()) return;
    lock(true);
    setStatus("Working through the steps…", "", true);
    trail.hidden = false;
    trail.textContent = "";
    try {
      const r = await onFillSteps();
      setCount(r.filled);
      // Every click it made is listed. This mode navigates on your behalf, so
      // what it did should never need guessing.
      trail.textContent = r.trail.join("\n");
      setStatus(`Filled ${r.filled} across ${r.steps + 1} step(s). Review, then submit yourself.`, "good");
    } catch (err) {
      setStatus(`Stopped: ${failure(err)}`, "bad");
      trail.textContent = "";
      trail.hidden = true;
    } finally {
      lock(false);
      syncUndo();
    }
  });

  // Both of these now cover every frame of the tab, so both are asynchronous —
  // the frames holding the form answer through the service worker.
  undoBtn.addEventListener("click", async () => {
    if (!alive()) return;
    const n = await onUndo();
    setCount(0);
    setStatus(n ? `Put ${n} field(s) back the way they were.` : "Nothing to undo.", n ? "good" : "warn");
    syncUndo();
  });

  $("[data-review]").addEventListener("click", async () => {
    if (!alive()) return;
    try { await onHighlight(); await openReview(); } catch (e) { setStatus(e.message, "bad"); }
  });

  /**
   * Which posting an answer was built from, when that is not this page.
   *
   * Worth a sentence rather than silence: the description usually comes from the
   * listing page you captured two clicks ago, and a letter about a job you did
   * not mean is the one failure here that is expensive to notice late.
   */
  const fromNote = (via) => (via?.source === "saved"
    ? ` Built from the posting you captured${via.company ? ` at ${via.company}` : ""}.`
    : "");

  letterBtn.addEventListener("click", async () => {
    if (!alive()) return;
    lock(true);
    setStatus("Drafting a cover letter…", "", true);
    try {
      const { text, placed, via } = await onCoverLetter((m) => setStatus(m, "", true));
      if (placed) {
        setStatus(`Cover letter drafted into the form. Read it before you send it.${fromNote(via)}`, "good");
      } else {
        await navigator.clipboard.writeText(text).catch(() => {});
        setStatus(`No cover-letter box here, so the draft is on your clipboard.${fromNote(via)}`, "good");
      }
    } catch (err) {
      setStatus(failure(err), "bad");
    } finally {
      lock(false);
      syncUndo();
    }
  });

  // ── Job match ────────────────────────────────────────────────────────────

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /**
   * Render a match. The score leads because it is what you look at first, but
   * the gaps are the reason this exists — they are what tells you whether to
   * apply and what to write about, so they are never collapsed away.
   */
  function renderMatch(m) {
    const gaps = [...m.gaps].sort((a, b) => {
      const rank = { blocking: 0, important: 1, minor: 2 };
      return rank[a.severity] - rank[b.severity];
    });

    matchOut.innerHTML = `
      <div class="top">
        <div class="score ${esc(m.verdict)}">${m.score}%</div>
        <div class="sum">${esc(m.summary)}</div>
      </div>
      ${m.meets.length ? `<h4>You meet (${m.meets.length})</h4><ul>${
        m.meets.slice(0, 6).map((x) =>
          `<li class="yes">${esc(x.requirement)}${x.evidence ? ` <em>— ${esc(x.evidence)}</em>` : ""}</li>`
        ).join("")}</ul>` : ""}
      ${gaps.length ? `<h4>Gaps (${gaps.length})</h4><ul>${
        gaps.slice(0, 6).map((x) =>
          `<li class="${x.severity === "blocking" ? "blocking" : "no"}">${esc(x.requirement)}${
            x.closeable ? ` <em>— ${esc(x.closeable)}</em>` : ""}</li>`
        ).join("")}</ul>` : ""}
      ${m.leadWith.length ? `<h4>Lead with</h4><ul>${
        m.leadWith.slice(0, 4).map((x) => `<li class="yes">${esc(x)}</li>`).join("")}</ul>` : ""}
      ${m.keywords.length ? `<h4>Their words, missing from your resume</h4><ul>${
        m.keywords.slice(0, 8).map((x) => `<li class="no">${esc(x)}</li>`).join("")}</ul>` : ""}
    `;
    matchOut.hidden = false;
  }

  matchBtn.addEventListener("click", async () => {
    if (!alive()) return;
    lock(true);
    setStatus("Comparing you against this posting…", "", true);
    try {
      const m = await onMatch((msg) => setStatus(msg, "", true));
      renderMatch(m);
      const tone = m.verdict === "strong" ? "good" : m.verdict === "weak" ? "bad" : "warn";
      setStatus(`${m.score}% match — ${m.meets.length} met, ${m.gaps.length} missing.${fromNote(m.via)}`, tone);
    } catch (err) {
      setStatus(failure(err), "bad");
    } finally {
      lock(false);
    }
  });

  /**
   * Warn if this employer is already in the tracker. Two different roles at one
   * company is normal, so this states what it found and lets you judge rather
   * than calling it a mistake.
   */
  async function checkPrior() {
    if (!onPriorApplications) return;
    const prior = await onPriorApplications().catch(() => null);
    if (!prior) { dupe.hidden = true; return; }

    const n = prior.rows.length;
    const last = prior.rows[0];
    const when = last?.ts ? Math.floor((Date.now() - last.ts) / 86400000) : null;
    dupe.innerHTML = `You have applied to <strong>${esc(prior.company)}</strong> ${
      n === 1 ? "once" : `${n} times`} before${
      when === null ? "" : when === 0 ? ", today" : `, most recently ${when} day${when === 1 ? "" : "s"} ago`}${
      last?.role ? ` (${esc(last.role)})` : ""}.`;
    dupe.hidden = false;
  }

  $("[data-options]").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "open_options" });
  });

  $("[data-off]").addEventListener("click", async () => {
    await onDisableSite();
  });

  // ── State ────────────────────────────────────────────────────────────────
  function syncUndo() {
    undoBtn.disabled = !canUndo?.();
  }

  async function refreshStatus() {
    paint();
    // Opening the card is the first thing anyone does, and it is the first
    // thing that touches storage — so on a page the extension has been reloaded
    // out from under, this is where the failure surfaces. It used to surface as
    // an uncaught rejection: the card opened, the status line kept whatever it
    // last said, and nothing indicated that the panel was now decorative.
    if (!alive()) return;
    try {
      await reload();
    } catch (err) {
      setStatus(failure(err), isContextGone(err) ? "warn" : "bad");
      if (isContextGone(err)) lock(true);
      return;
    }
    const ctx = getContext();
    const missing = [];
    if (!ctx.profile.personal.email) missing.push("no profile yet");
    if (!ctx.resumeMeta.fileName) missing.push("no resume uploaded");

    if (missing.length) setStatus(`Set-up needed: ${missing.join(", ")}.`, "warn");
    else if (!ctx.settings.aiAutofillEnabled) setStatus("Ready. AI answers are off for unknown fields.", "");
    else setStatus("Ready. AI will answer anything the rules can't.", "good");

    // Both of these spend a model call, so both need a key. The letter also
    const key = ctx.settings.provider === "groq"
      ? ctx.settings.groqApiKey : ctx.settings.geminiApiKey;
    const hasKey = !!String(key || "").trim();

    letterBtn.disabled = !hasKey;
    letterBtn.title = letterBtn.disabled
      ? "Add an API key in the dashboard to draft cover letters"
      : "Read the posting on this page and write a letter for it";

    matchBtn.disabled = !hasKey;
    matchBtn.title = !hasKey
      ? "Add an API key in the dashboard to compare yourself against a posting"
      : !ctx.resumeMeta.fileName && !ctx.resumeMeta.text
        ? "Works better once your resume is uploaded — it compares against your profile alone until then"
        : "Read this posting and show what you meet and what you're missing";
    syncUndo();
  }

  function setCount(n) {
    if (n > 0) { count.textContent = String(n); count.classList.add("on"); }
    else count.classList.remove("on");
  }

  syncUndo();

  return {
    setCount,
    openReview,
    setError: (message) => setStatus(message, "bad"),
    host,
    destroy() { host.remove(); }
  };
}

Object.assign(__x, { mount });
};

__m["src/shared/contact.js"] = (__x, __req) => {
// Apply karo — where feedback goes.
//
// One address, one mailto builder. The popup, the dashboard and the on-page
// panel all link here, so changing the address is a one-line edit rather than a
// grep across four files.
//
// Bug reports arrive far more useful with the version and the browser already
// in the body — nobody writing an annoyed two-line email is going to dig those
// out of chrome://extensions, and without them half the reports are unactionable.

const CONTACT_EMAIL = "rishitgoel259@gmail.com";

const version = () => {
  try { return chrome.runtime.getManifest().version; } catch { return "unknown"; }
};

/** Chrome's UA is long and mostly noise; the build number is the part that matters. */
const browserLine = () => {
  const ua = navigator.userAgent || "";
  const chrome_ = /Chrom(?:e|ium)\/([\d.]+)/.exec(ua);
  const edge = /Edg\/([\d.]+)/.exec(ua);
  const brave = navigator.brave ? "Brave " : "";
  const name = edge ? `Edge ${edge[1]}` : chrome_ ? `${brave}Chrome ${chrome_[1]}` : ua.slice(0, 80);
  return `${name} · ${navigator.platform || "unknown platform"}`;
};

const TEMPLATES = {
  bug: {
    subject: "Apply karo — bug report",
    body: [
      "What went wrong:",
      "",
      "",
      "Which site (the job board or careers page):",
      "",
      "",
      "What you expected instead:",
      "",
      ""
    ]
  },
  idea: {
    subject: "Apply karo — suggestion",
    body: [
      "What you'd like it to do:",
      "",
      "",
      "When it would help:",
      "",
      ""
    ]
  },
  general: {
    subject: "Apply karo — feedback",
    body: ["", ""]
  }
};

/**
 * Build a Gmail web compose URL for a feedback email.
 * Opens directly in Gmail web in a new browser tab with recipient, subject, and body pre-filled.
 *
 * @param {"bug"|"idea"|"general"} kind      which template to prefill
 * @param {object}  [extra]                  extra diagnostic lines, `label: value`
 * @param {boolean} [extra.includeContext]   append version/browser footer (default true)
 */
function feedbackGmailUrl(kind = "general", extra = {}) {
  const { includeContext = true, ...facts } = extra;
  const t = TEMPLATES[kind] || TEMPLATES.general;

  const lines = [...t.body];
  if (includeContext) {
    lines.push(
      "—".repeat(24),
      "Sent from the extension — these help me reproduce it:",
      `Version: ${version()}`,
      `Browser: ${browserLine()}`,
      ...Object.entries(facts).map(([k, v]) => `${k}: ${v}`)
    );
  }

  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(CONTACT_EMAIL)}`
    + `&su=${encodeURIComponent(t.subject)}`
    + `&body=${encodeURIComponent(lines.join("\n"))}`;
}

const feedbackMailto = feedbackGmailUrl;

Object.assign(__x, { CONTACT_EMAIL, feedbackGmailUrl, feedbackMailto });
};

  window.__applyKaroEngine = __req("src/engine/index.js");
  __start(window.__applyKaroEngine);
})();
