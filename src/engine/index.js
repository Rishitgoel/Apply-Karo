// Apply karo — engine entry point.
//
// Loaded lazily by src/detect.js via dynamic import, so none of this code is
// fetched, parsed or executed on pages that are not job applications.

import {
  loadContext, loadResumeFile, saveProfile, saveLearned, saveCorrections,
  resolvePath, recordApplication, isSiteDisabled, setSiteDisabled, saveSettings,
  recordMatch, priorApplicationsFor, loadHistory
} from "../shared/schema.js";
import {
  assign, RULE_BY_ID, COVER_LETTER_HINTS, pickResumeTargets, fieldKey, normalizeKey
} from "../shared/rules.js";
import { splitPhone } from "../shared/values.js";
import { scan, invalidateShadowCache, labelOf } from "./scan.js";
import { fillSync, fillAsync, fillFile, setValue, fire, matchOption } from "./fill.js";
import { runSteps as stepThrough } from "./steps.js";

const IS_TOP = window === window.top;
const OWN_UI = "#applykaro-root";
const CONTROL_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "FORM", "FIELDSET"]);

let ctx = null;
let panel = null;             // lazily imported UI module
let observer = null;
let quietRuns = 0;
let ranOnce = false;
let busy = false;
let siteDisabled = false;

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
  const els = new Set();
  if (field.el) els.add(field.el);
  for (const p of field.parts || []) if (p.field?.el) els.add(p.field.el);
  for (const o of field.options || []) if (o.el) els.add(o.el);

  const saved = [...els].map((el) => ({
    el,
    value: typeof el.value === "string" ? el.value : null,
    checked: typeof el.checked === "boolean" ? el.checked : null,
    text: el.isContentEditable ? el.textContent : null,
    files: el.type === "file"
  }));

  return () => {
    for (const s of saved) {
      try {
        if (s.text !== null) s.el.textContent = s.text;
        if (s.files) { s.el.value = ""; }
        else if (s.value !== null) setValue(s.el, s.value);
        if (s.checked !== null) s.el.checked = s.checked;
        fire(s.el, "input");
        fire(s.el, "change");
      } catch { /* a control that resists being reset is not worth aborting for */ }
    }
  };
}

/** Put the page back the way the last fill found it. */
export function undoFill() {
  const n = undoStack.length;
  if (!n) return 0;
  busy = true;                       // do not learn from our own restore events
  try {
    // Newest first: a later fill may have been layered onto an earlier one.
    for (let i = n - 1; i >= 0; i--) undoStack[i]();
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
  return n;
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
  for (const variant of [key, key.toLowerCase(), spaced, spaced.replace(/ /g, "_")]) {
    const v = custom[variant];
    if (v !== undefined && String(v).trim() !== "") return String(v);
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

  if (rule.path.startsWith("customFields.")) {
    return customLookup(profile.customFields, rule.path.slice("customFields.".length));
  }

  const path = rule.indexable && instance ? rule.path.replace("[0]", `[${instance}]`) : rule.path;
  let v = resolvePath(profile, path);

  // Fallbacks describe entry zero only; a missing third school is just missing.
  if (!v && rule.fallback && !instance) v = rule.fallback(profile);
  return v;
}

/**
 * Exact-label lookups the user has taught us, which outrank every rule.
 *
 * Two spellings are tried. `fieldKey` is what `learn()` writes under, and the
 * raw label covers entries typed straight into the dashboard as well as
 * anything an older build stored before the two agreed.
 */
function taughtValue(field) {
  const { learned, profile } = ctx;
  const custom = profile.customFields || {};

  for (const key of [fieldKey(field), field.label]) {
    if (!key) continue;
    if (learned[key] !== undefined && learned[key] !== "") return learned[key];
    if (custom[key] !== undefined && custom[key] !== "") return custom[key];
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The fill pass
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 *   manual  — user-initiated: overwrite nothing, but do run the async widgets
 *   useAI   — allow the Gemini pass for fields no rule could resolve
 * @returns {Promise<{filled:number, total:number, unmatched:Array}>}
 */
export async function run(opts = {}) {
  if (busy) return { filled: 0, total: 0, unmatched: [] };
  busy = true;

  try {
    const t0 = performance.now();
    const fields = scan();
    if (!fields.length) return { filled: 0, total: 0, unmatched: [] };

    const profile = ctx.profile;
    const custom = profile.customFields || {};

    // Anything the user already typed is off-limits, always.
    for (const f of fields) {
      if (f.filled && f.kind !== "file") f.skip = true;
    }

    // Values the user taught us take priority; withhold those fields from the
    // rule auction so a rule cannot claim a slot that is already decided.
    const taught = new Map();
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].skip) continue;
      const v = taughtValue(fields[i]);
      if (v !== null) { taught.set(i, v); fields[i].skip = true; }
    }

    const assigned = assign(fields, {
      skipSensitive: ctx.settings.skipSensitive,
      hasAnswerFor: (ruleId) => {
        const rule = RULE_BY_ID.get(ruleId);
        return !!resolvePath(profile, rule.path);
      },
      isDemoted: (field, ruleId) => (ctx.corrections[fieldKey(field)] || []).includes(ruleId)
    });

    // If the form has a separate dialling-code box, the number box must not also
    // carry the code — "+91 +919996007259" fails validation on most forms.
    const hasCodeField = [...assigned.values()].some((h) => h.ruleId === "phoneCountryCode");

    // ── Pass 1: everything synchronous, in one go ──
    // v1 awaited each field individually, so a 30-field form serialised into
    // several seconds of visible stutter. These all land in a single frame.
    const asyncQueue = [];
    const unmatched = [];
    let filled = 0;

    // ruleId travels with the value so the option matcher can bridge vocabulary:
    // your "B.Tech" onto the dropdown's "Bachelor's Degree", your "No" onto its
    // "No, I do not require sponsorship".
    // fillSync never throws — one unfillable control skips itself rather than
    // aborting the remaining fields. See its contract in fill.js.
    const apply = (i, value, guess, ruleId) => {
      const field = fields[i];
      const restore = snapshot(field);
      const result = fillSync(field, value, ruleId);
      if (result === null) { asyncQueue.push({ field, value, guess, ruleId, restore }); return; }
      if (result) { filled++; undoStack.push(restore); highlight(field.el, guess); remember(field, value, ruleId); }
    };

    for (const [i, value] of taught) apply(i, value, false, null);

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (taught.has(i)) continue;

      const hit = assigned.get(i);
      if (!hit) {
        if (!field.skip && field.kind !== "file") unmatched.push(field);
        continue;
      }
      let value = ruleValue(hit.ruleId, profile, hit.instance);
      if (value === null) { unmatched.push(field); continue; }
      if (hit.ruleId === "phone" && hasCodeField) value = splitPhone(value).national || value;
      apply(i, value, hit.score < 50, hit.ruleId);
    }

    // ── Pass 2: widgets that need to open a menu and wait ──
    const deadline = opts.manual ? Infinity : performance.now() + AUTO_WIDGET_BUDGET_MS;
    for (const job of widgetTurn(asyncQueue, opts)) {
      // Out of time for this pass. What is left keeps its place in the queue
      // for the next one rather than being written off as already tried.
      if (performance.now() > deadline) break;
      if (!opts.manual) widgetTried.add(job.field.el);

      const ok = await fillAsync(job.field, job.value, job.ruleId);
      if (ok) {
        filled++;
        undoStack.push(job.restore);
        highlight(job.field.el, job.guess);
        remember(job.field, job.value, job.ruleId);
      }
    }

    // ── Pass 3: resume upload ──
    filled += await attachFiles(fields);

    const ms = Math.round(performance.now() - t0);
    console.debug(`Apply karo: ${filled}/${fields.length} fields in ${ms}ms`);

    // ── Pass 4: optional AI for the leftovers ──
    if (opts.useAI && unmatched.length && ctx.settings.aiAutofillEnabled) {
      // Parsing the resume and answering in batches can take half a minute; say
      // so, or a stalled-looking button reads as a hang.
      opts.onStage?.(`Rules filled ${filled}. Asking AI about ${unmatched.length} more…`);
      filled += await aiPass(unmatched);
    }

    ranOnce = true;
    if (filled > 0) {
      setBadge(filled);
      logApplication(filled, fields.length);
    }
    return { filled, total: fields.length, unmatched, ms };
  } finally {
    busy = false;
  }
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
for (const type of ["keydown", "input", "pointerdown"]) {
  document.addEventListener(type, (e) => {
    if (e.isTrusted && !e.target?.closest?.(OWN_UI)) lastHumanEdit = Date.now();
  }, true);
}

/** Are you in the middle of filling something in yourself? */
function userIsBusy() {
  const el = document.activeElement;
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

/** Best guess at the company and role, from what the page already tells us. */
function pageIdentity() {
  const meta = (sel, attr = "content") =>
    document.querySelector(sel)?.getAttribute(attr)?.trim() || "";

  const host = location.hostname.replace(/^www\./, "");
  const company =
    meta('meta[property="og:site_name"]') ||
    // Greenhouse and Lever both put the employer in the boilerplate host.
    (host.match(/^(?:job-boards|boards|jobs|careers|apply)\.(.+)$/)?.[1] || host).split(".")[0];

  const title = (document.title || "").trim();
  const heading = document.querySelector("h1")?.textContent?.trim() || "";
  // A heading is usually the role; a <title> is usually "Role at Company | Board".
  const role = (heading || title.split(/\s+[|–—]\s+/)[0] || "").slice(0, 120);

  return {
    host,
    company: company.charAt(0).toUpperCase() + company.slice(1),
    role,
    title: title.slice(0, 160)
  };
}

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
// Cover letters
//
// The backend for this already existed and nothing could reach it. Reading the
// job description off the page the user is standing on is the whole point: a
// letter written against the actual posting is worth having, one written from
// the profile alone is not.
// ─────────────────────────────────────────────────────────────────────────────

// Containers that hold the posting itself, most specific first. Ordered because
// `main` and `article` exist on plenty of ATS pages that also wrap the form, so
// they are the fallback rather than the answer.
const JD_CONTAINERS = [
  "[class*=job-description]", "[class*=jobDescription]", "[data-testid*=description]",
  "[data-automation-id*=jobPostingDescription]", "#job-details", "[class*=posting-content]",
  "[class*=job-post]", "[class*=jobPost]", "article", "main"
];

/**
 * The posting text, with the application form kept out of it.
 *
 * The form is the trap here. On an ATS the fields sit inside the same `main`
 * as the description, and their labels — "Work authorization", "Years of
 * experience" — read to a model exactly like stated requirements, so the
 * comparison ends up scoring the candidate against the form it is about to
 * fill in. Cloning the container and cutting the controls out first is what
 * keeps the two apart.
 */
export function jobDescriptionFromPage(doc = document) {
  let scope = null;
  for (const sel of JD_CONTAINERS) {
    const el = doc.querySelector(sel);
    if (el && (el.textContent || "").trim().length > 200) { scope = el; break; }
  }
  if (!scope) scope = doc.body;
  if (!scope) return "";

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

  return text
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 9000);
}

/** Enough of a posting to be worth sending. Shared by the match and the letter. */
export const MIN_JD_CHARS = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Job matching
// ─────────────────────────────────────────────────────────────────────────────

// Kept for this page so the cover letter can build on it, and so pressing the
// button twice does not pay for the same comparison twice.
let lastMatch = null;

/**
 * Compare the profile and resume against this posting.
 *
 * Explicit action only, never on the automatic path: it costs a model call and
 * reads the whole page, neither of which should happen because you opened a
 * tab. The result is written to the application record so the dashboard can
 * sort by it later.
 *
 * @returns {Promise<object>} the normalized match
 */
export async function matchThisJob(onStage, { force = false } = {}) {
  if (lastMatch && !force) return lastMatch;

  const jd = jobDescriptionFromPage();
  if (jd.length < MIN_JD_CHARS) {
    throw new Error("Couldn't find a job description on this page. Open the posting itself and try again.");
  }

  onStage?.("Reading the posting…");
  const resp = await chrome.runtime.sendMessage({
    type: "match_job",
    jobDescription: jd,
    profile: ctx.profile
  }).catch(() => null);

  if (!resp?.ok) throw new Error(resp?.error || "The model did not reply.");
  lastMatch = resp.match;

  // Store it against this posting. A comparison you ran before deciding to
  // apply is worth keeping even if you never fill the form.
  if (IS_TOP && ctx?.settings.trackApplications) {
    recordMatch(location.href.split("#")[0].slice(0, 500), lastMatch, pageIdentity())
      .catch((err) => console.debug("Apply karo: could not save the match —", err.message));
  }
  return lastMatch;
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
 * Draft a cover letter for this posting and put it in the page's cover-letter
 * box if there is one.
 * @returns {Promise<{text:string, placed:boolean}>}
 */
export async function writeCoverLetter(onStage) {
  const jd = jobDescriptionFromPage();
  if (jd.length < MIN_JD_CHARS) throw new Error("Couldn't find a job description on this page.");

  onStage?.("Reading the posting…");
  const resp = await chrome.runtime.sendMessage({
    type: "cover_letter",
    jobDescription: jd,
    profile: ctx.profile,
    // If this posting has already been compared, the letter is built on those
    // conclusions instead of re-deriving them — and it will not claim a
    // requirement the comparison found no evidence for.
    match: lastMatch
  }).catch(() => null);

  if (!resp?.ok) throw new Error(resp?.error || "The model did not reply.");
  const text = String(resp.text || "").trim();
  if (!text) throw new Error("The model returned an empty letter.");

  // Place it only in a box that is genuinely for a cover letter, and only if
  // that box is empty — overwriting one you had already written would be worse
  // than making you paste it yourself.
  const target = scan().find((f) => {
    if (f.kind !== "textarea" || f.filled) return false;
    return COVER_LETTER_HINTS.test(`${f.label} ${f.name} ${f.id}`);
  });

  if (target) {
    const restore = snapshot(target);
    busy = true;
    try {
      if (fillSync(target, text)) {
        undoStack.push(restore);
        highlight(target.el, true);
        target.el.scrollIntoView({ block: "center", behavior: "smooth" });
        return { text, placed: true };
      }
    } finally {
      busy = false;
    }
  }
  return { text, placed: false };
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

async function attachFiles(fields) {
  if (ctx.settings.autoUploadResume === false) return 0;

  const fileName = ctx.resumeMeta.fileName || "resume.pdf";
  const targets = pickResumeTargets(fields, fileName).filter((f) => !attached.has(f.el));
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
    if (await fillFile(f.el, dataUrl, fileName)) {
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

async function aiPass(unmatched) {
  // Keep the field objects in a parallel array. The model answers by index into
  // what we sent it, so indexing back into `unmatched` would be off by however
  // many entries the filter removed — and would write values into the wrong
  // boxes.
  // A field with no <label> still has a name, a placeholder or an adjacent
  // heading — dropping those left a chunk of every form unanswered. Anything
  // with a usable hint goes to the model; only truly anonymous boxes are cut.
  const candidates = unmatched.filter((f) => {
    if (f.kind === "file") return false;                    // handled separately
    if (f.type === "password") return false;                // never ours to fill
    return !!(f.rawLabel || f.name || f.placeholder || f.options?.length);
  }).slice(0, 80);

  const descriptors = candidates.map((f) => ({
    label: f.rawLabel || f.placeholder || f.name || "(unlabelled field)",
    name: f.name,
    type: f.type,
    kind: f.kind,
    placeholder: f.placeholder,
    // A maxlength tells the model how long an answer the box actually accepts.
    maxLength: f.el?.maxLength > 0 ? f.el.maxLength : null,
    options: f.options ? f.options.map((o) => o.label).slice(0, 40) : null
  }));
  if (!descriptors.length) return 0;

  // The API key stays in the service worker, and so does the resume: the worker
  // sources it itself rather than trusting whatever the page had cached.
  const resp = await chrome.runtime.sendMessage({
    type: "ai_fill",
    fields: descriptors,
    profile: ctx.profile
  }).catch(() => null);

  if (!resp?.ok || !resp.answers) return 0;

  let n = 0;
  for (const [idxStr, entry] of Object.entries(resp.answers)) {
    const i = Number(idxStr);
    const field = candidates[i];
    if (!field || !entry) continue;
    let value = typeof entry === "object" ? entry.value : entry;
    const confidence = typeof entry === "object" ? Number(entry.confidence ?? 1) : 1;
    if (value === null || value === undefined || String(value).trim() === "") continue;

    // The model is asked to answer an option field with one of its options, and
    // usually does. When it does not — a bare "Yes" against "Yes, I am legally
    // authorized" / "No, I will require sponsorship" — the answer is still
    // right, but only as a choice. Snap it to the option it means, so the
    // control receives its own vocabulary rather than the model's.
    // Single checkboxes are excluded: their one "option" is the box's own
    // wording, and matching against it would answer a different question.
    if (field.options?.length && field.kind !== "checkbox") {
      const pick = matchOption(field.options, value);
      if (pick) value = pick.label || pick.value;
    }

    const result = fillSync(field, value);
    const ok = result === null ? await fillAsync(field, value) : result;
    if (ok) {
      n++;
      highlight(field.el, confidence < 0.7);
      // Remember short factual answers ("Yes", "Immediately", "2 years") so the
      // rule engine can reuse them for free next time. Never remember prose: a
      // stored essay would be replayed word for word on the next application,
      // which is both untailored and exactly the repetition that makes writing
      // look generated.
      const v = String(value);
      if (v.length <= 120 && !/\n/.test(v)) learn(field.label, v);
    }
  }
  if (n) await persistLearned();
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Learning loop
// ─────────────────────────────────────────────────────────────────────────────

const PERSONAL_FACT = /gender|race|ethnic|veteran|disab|salary|start date|notice|experience|authorized|sponsor|citizen|visa|nationality|pronoun/i;

let learnedDirty = false;

/**
 * Remember an answer against a question.
 *
 * The key is normalised here, in the one place every caller passes through, so
 * that whatever a caller happens to hold — a raw label, a name attribute, a
 * `fieldKey` — lands in the same slot `taughtValue()` reads from. Previously
 * each write path used its own spelling and none of them matched the lookup,
 * so nothing learned from a manual edit was ever reused.
 */
function learn(label, value) {
  const key = normalizeKey(label);
  if (!key || !value || value.length > 600) return;
  if (PERSONAL_FACT.test(key)) {
    if (!ctx.profile.customFields) ctx.profile.customFields = {};
    ctx.profile.customFields[key] = value;
  } else {
    ctx.learned[key] = value;
  }
  learnedDirty = true;
}

async function persistLearned() {
  if (!learnedDirty) return;
  learnedDirty = false;
  await Promise.all([saveLearned(ctx.learned), saveProfile(ctx.profile)]);
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
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el?.tagName) return;
    const tag = el.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;
    if (el.type === "hidden" || el.type === "file" || el.disabled) return;
    if (el.closest?.(OWN_UI)) return;
    // Our own fills dispatch `change` synchronously, before the highlight class
    // lands — so a class check alone would echo every value we just wrote back
    // into storage, cementing any wrong guess as a learned answer.
    if (busy) return;

    const value = el.type === "checkbox" ? (el.checked ? "Yes" : "No") : el.value;
    const clean = String(value || "").trim();

    // Did you just overwrite something we filled? That is a correction, and it
    // says the rule was wrong for this field — not merely that the value was.
    const prior = wrote.get(el);
    if (prior && clean !== prior.value.trim()) {
      demote(prior.key, prior.ruleId);
      wrote.delete(el);
      if (clean) learn(prior.key, clean);
      return;
    }

    // The *visible* label, resolved the way the scanner resolves it. Reading
    // name/id instead would key this answer as "job application first name"
    // while the lookup asks for "first name" — the same question, stored where
    // it can never be found again.
    const label = labelOf(el) || el.name || el.id || "";
    if (label && clean) learn(label, clean);
  }, true);

  // Persist on submit and when the tab goes away — never on every edit.
  document.addEventListener("submit", persist, true);
  window.addEventListener("pagehide", () => { persist(); }, { once: true });
}

async function persist() {
  await persistLearned();
  if (!correctionsDirty) return;
  correctionsDirty = false;
  await saveCorrections(ctx.corrections);
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-step forms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fill this step, advance, repeat. Explicit user action only.
 * The navigation guards live in ./steps.js so they can be tested on their own.
 */
export async function runSteps(max = 8) {
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

const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));

function watchForms() {
  let scheduled = false;

  observer = new MutationObserver((records) => {
    if (!hasNewControls(records)) return;
    invalidateShadowCache();
    if (scheduled) return;
    scheduled = true;
    idle(async () => {
      scheduled = false;
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

  observer.observe(document.documentElement, { childList: true, subtree: true });
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
      return { count: mine.count + (rest.empty || 0), required: mine.required + (rest.required || 0) };
    },
    onCoverLetter: (onStage) => writeCoverLetter(onStage),
    onMatch: (onStage) => matchThisJob(onStage, { force: true }),
    onPriorApplications: () => priorApplications(),
    onDisableSite: async () => {
      setSiteDisabled(ctx.settings, location.hostname, true);
      await saveSettings(ctx.settings);
      siteDisabled = true;
      stopWatching();
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
async function inOtherFrames(action) {
  const r = await chrome.runtime
    .sendMessage({ type: "tab_action", action, skipTop: true })
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
  const mine = await run({ manual: true, useAI: true, onStage });
  const rest = await inOtherFrames("rf_fill");
  return {
    filled: mine.filled + (rest.filled || 0),
    total: mine.total + (rest.total || 0)
  };
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
        if (claim(msg) === false) return false;
        run({ manual: true, useAI: true }).then((r) => {
          panel?.setCount(r.filled);
          report(runId, { ok: true, filled: r.filled, total: r.total });
        });
        return false;

      case "rf_steps":
        if (claim(msg) === false) return false;
        runSteps().then((r) => report(runId, { ok: true, ...r }));
        return false;

      case "rf_undo":
        if (claim(msg) === false) return false;
        report(runId, { ok: true, restored: undoFill() });
        return false;

      case "rf_highlight": {
        if (claim(msg) === false) return false;
        const { count, required } = highlightEmpty();
        report(runId, { ok: true, empty: count, required });
        return false;
      }

      case "rf_status":
        if (claim(msg) === false) return false;
        report(runId, pageStatus());
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
          siteDisabled = isSiteDisabled(ctx.settings, location.hostname);
          if (siteDisabled || ctx.settings.panelEnabled === false) {
            panel?.destroy();
            panel = null;
          } else if (IS_TOP) {
            ensurePanel();
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

  const marked = [];
  let first = null;
  let required = 0;

  for (const f of scan()) {
    if (f.filled) continue;
    if (f.el?.closest?.(OWN_UI)) continue;

    // A control the page hides behind a styled proxy — a file input, an
    // opacity:0 radio — cannot carry a visible outline of its own.
    const target = outlineTarget(f);
    if (!target || (!target.offsetParent && !target.getClientRects().length)) continue;

    if (isRequired(f)) { required++; first = first || target; }
    target.classList.add("rf-missed");
    marked.push(target);
    first = first || target;
  }

  first?.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(() => {
    for (const el of marked) el.classList.remove("rf-missed");
  }, 6000);
  return { count: marked.length, required };
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
