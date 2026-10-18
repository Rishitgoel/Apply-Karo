import { beginWrite, writeVerified, uploadVerified } from "./controls/adapter.js";
import { guardUndo, accepts } from "./verify.js";
import { validationState, readControl } from "./controls/read.js";
import { isExtensionAction, realClick } from "./controls/native.js";
import { dependencyPriority, trackDependencies } from "./dependencies.js";
import { bindEntities, addMissingRepeats } from "./repeats.js";
import { resolveFields, resolveOne } from "../resolver/resolve.js";
import { ruleCandidate } from "../resolver/validate.js";
// Apply karo — engine entry point.
//
// Loaded lazily by src/detect.js via dynamic import, so none of this code is
// fetched, parsed or executed on pages that are not job applications.

import {
  loadContext, loadResumeFile,
  resolvePath, recordApplication, isSiteDisabled, setSiteDisabled, saveSettings,
  priorApplicationsFor, loadHistory, loadJob, setJob,
  extensionAlive, STALE_MESSAGE
} from "../shared/schema.js";
// Reading a posting is in shared/posting.js rather than here, because the page
// holding the job description is the listing page — which has no form on it, so
// the engine is never injected there. The toolbar has to be able to read one
// without this module existing at all.
import { postingFromPage, pageIdentity, MIN_JD_CHARS } from "../shared/posting.js";
import {
  assign, RULE_BY_ID, COVER_LETTER_HINTS, pickResumeTargets, fieldKey, normalizeKey
} from "../shared/rules.js";
import { splitPhone, parseTimeframe } from "../shared/values.js";
import { scan, surfaceInventory, invalidateShadowCache, labelOf, helperTextFor, rawControls, whyDropped, isComboboxFilled, COMBO_PLACEHOLDER_RE, isGenericLabel } from "./scan.js";
import { setValue, fire, isFocused } from "./fill.js";
import { runSteps as stepThrough } from "./steps.js";
import { initFieldOverlays, updateFieldOverlays, destroyFieldOverlays, isParagraphTarget } from "./inline.js";
import { answerPolicy } from "../shared/answer-policy.js";
import { captureRevision, JOB_LABELS, isRunningJob } from "./session.js";
import { processQueue } from "./discovery/queue.js";
import { configureQuestionFixes, locatorFor } from "./discovery/labels.js";
import { createDiagnostics, extractionSignal } from "./diagnostics.js";
import { knowledge } from "../knowledge/client.js";
import { questionContext, scopedAnswerIdentity } from "../knowledge/retrieve.js";
import { answerText, reusableQuestion } from "../knowledge/learning.js";
import { reviewRow } from "./review.js";
import { releasePolicy } from "../shared/release.js";

const reviewDecisions = new Map();
const reviewOwner = `${globalThis.location?.href || ""}#${Math.random()}`;
const memoryUndos = new Map();
const unseenReviewControls = new Map();
function retainDecision(field, decision) { reviewDecisions.set(field.fieldId, { revision: field.formRevision, decision, field, dependencies: JSON.stringify(ctx?.knowledge?.dependencies || {}) }); }
export function reviewFields() {
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
export async function reviewAction(row, action, value, scope = "application") {
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
export function undoFill() {
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

export const canUndo = () => undoStack.length > 0;

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
export function ruleValue(ruleId, profile, instance = 0) {
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

export function run(opts = {}) {
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
export function widgetTurn(queue, opts) {
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
export async function matchThisJob(onStage) {
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
export async function priorApplications() {
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
export async function placeLetter(text) {
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
export async function writeCoverLetter(onStage) {
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
export function pageStatus() {
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

export async function handleExclusiveFill(field, customInstruction) {
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
export async function runSteps(max = 8) {
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
  const mod = await import(chrome.runtime.getURL("src/engine/panel.js"));
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
export function jobStatus(id) {
  const j = contentJobs.get(id); return j ? { state: j.state, result: j.result } : { state: "unknown" };
}

export async function correctQuestion(field, question) {
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
export function inventory() { return surfaceInventory(); }
export async function ready() {
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

export async function boot() {
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
export function highlightEmpty() {
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
