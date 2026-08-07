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

import { semanticScore, asBool, parseDate, formatDate, datePartValue, monthName } from "../shared/values.js";
import { RULE_BY_ID } from "../shared/rules.js";

const TRACKER = "_valueTracker";

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

function nativeSetter(el) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype :
    HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(proto, "value")?.set;
}

export function setValue(el, value) {
  const set = nativeSetter(el);
  // React's value tracker caches the last value it wrote. Reset it first, or a
  // programmatic write that happens to equal the tracked value is swallowed.
  if (el[TRACKER]) {
    try { el[TRACKER].setValue(""); } catch { /* not React, or shape changed */ }
  }
  if (set) set.call(el, value);
  else el.value = value;
}

export function fire(el, type, init) {
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true, ...init }));
}

function fireInput(el) {
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText" }));
}

/** The pointer/mouse sequence a real click produces. */
export function realClick(el) {
  const opts = { bubbles: true, composed: true, cancelable: true, view: window };
  try { el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse" })); } catch {}
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  try { el.focus({ preventScroll: true }); } catch {}
  try { el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse" })); } catch {}
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.click();
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
export function commit(el, wasFocused) {
  // If the user genuinely had this control focused before we touched it,
  // saying they left it would be a lie the page acts on — validation fires
  // mid-typing.
  if (wasFocused) return;
  try {
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false, composed: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  } catch { /* a control that refuses focus events is not worth aborting for */ }
}

export function key(el, k, code = k) {
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
export function optionScore(optText, target) {
  const o = norm(optText), t = norm(target);
  if (!o || !t) return 0;
  if (o === t) return 1;

  // Yes/no semantics — the single most common shape in application forms.
  if (YES.test(t) && YES.test(o)) return 0.97;
  if (NO.test(t) && NO.test(o)) return 0.97;
  if ((YES.test(t) && NO.test(o)) || (NO.test(t) && YES.test(o))) return 0;

  if (o.startsWith(t) || t.startsWith(o)) return 0.9;
  if (o.includes(t) || t.includes(o)) return 0.8;

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
      ruleId ? semanticScore(ruleId, opt.label, opt.value, value) : 0
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
export function matchOption(options, value, ruleId = null) {
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

function fillText(el, value) {
  const wasFocused = isFocused(el);
  setValue(el, value);
  fireInput(el);
  fire(el, "change");
  commit(el, wasFocused);
  return true;
}

function fillContentEditable(el, value) {
  const wasFocused = isFocused(el);
  el.focus({ preventScroll: true });
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
    // Some widgets only commit on keyboard activation.
    if (!isChecked(target)) { key(target, " ", "Space"); }
    return isChecked(target);
  }

  // Prefer clicking the visible proxy: on Greenhouse/Workday the native input
  // is opacity:0 and the framework's handler lives on the label.
  const proxy = target.closest("label") ||
    (target.id ? document.querySelector(`label[for="${CSS.escape(target.id)}"]`) : null);
  if (proxy && proxy !== target) {
    realClick(proxy);
    if (target.checked) { fire(target, "change"); return true; }
  }

  target.checked = true;
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

  // Already in the state asked for. Nothing was written, so this is not a fill —
  // reporting it as one inflated the "filled N fields" count with boxes the page
  // had defaulted that way itself.
  if (el.checked === want) return false;

  const wasFocused = isFocused(el);
  const proxy = el.closest("label");
  if (proxy && proxy !== el) realClick(proxy);
  else { el.checked = want; realClick(el); }
  fire(el, "change");
  commit(el, wasFocused);
  return el.checked === want;
}

/** The options an open menu is currently showing. */
function visibleOptions(listbox) {
  const items = Array.from(
    listbox.querySelectorAll('[role="option"],li,[data-automation-id="promptOption"]')
  ).filter((n) => n.offsetParent !== null || n.getClientRects().length);

  return items.map((n) => ({
    el: n,
    label: (n.textContent || "").trim(),
    value: n.getAttribute("data-value") || ""
  })).filter((o) => o.label);
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
  const typeable = el.tagName === "INPUT" || el.isContentEditable;
  const before = el.isContentEditable ? (el.textContent || "")
               : (typeof el.value === "string" ? el.value : "");

  // Options the scanner could already see — a listbox rendered but hidden, an
  // `aria-owns` list, a <datalist>. When these exist the control is a closed
  // choice list, whether or not the menu opens for us.
  const known = field.options?.length ? field.options : null;

  realClick(el);

  // If it accepts text, type to filter — dramatically improves the hit rate on
  // long lists (countries, universities).
  if (typeable) {
    setValue(el, value);
    fireInput(el);
    key(el, "ArrowDown");
  }

  const listbox = await waitFor(() => findListbox(el), 1500);
  const open = listbox ? visibleOptions(listbox) : [];
  const pool = open.length ? open : (known || []);

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
    const closed = listbox && (!listbox.isConnected || !listbox.getClientRects().length);
    if ((listbox && now && (closed || now !== String(value).trim())) || acceptsFreeText(el)) {
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
    const byId = root.getElementById?.(controls) || document.getElementById(controls);
    if (byId && byId.getClientRects().length) return byId;
  }
  const active = el.getAttribute("aria-activedescendant");
  if (active) {
    const node = root.getElementById?.(active) || document.getElementById(active);
    const lb = node?.closest('[role="listbox"],ul,[role="menu"]');
    if (lb) return lb;
  }
  // Any listbox currently on screen.
  for (const lb of document.querySelectorAll('[role="listbox"],[role="menu"],.select__menu,[data-automation-id="promptOptions"]')) {
    if (lb.getClientRects().length) return lb;
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
  const out = formatDate(parts, kind === "date" ? (el.type === "month" ? "month" : "date") : "text", hint);

  const wasFocused = isFocused(el);
  setValue(el, out);
  fireInput(el);
  fire(el, "change");
  commit(el, wasFocused);
  return !!el.value;
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
export async function fillFile(el, dataUrl, fileName) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], fileName || "resume.pdf", {
      type: blob.type || "application/pdf",
      lastModified: Date.now()
    });
    const dt = new DataTransfer();
    dt.items.add(file);
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
    case "select":        return fillSelect(el, v, field.options, ruleId);
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
export function fillSync(field, value, ruleId = null) {
  const isDateRule = ruleId ? !!RULE_BY_ID.get(ruleId)?.isDate : false;
  try {
    return dispatchFill(field, String(value), ruleId, isDateRule);
  } catch (err) {
    console.warn(`Apply karo: skipped "${field.rawLabel || field.name || field.kind}" —`, err.message);
    return false;
  }
}

export async function fillAsync(field, value, ruleId = null) {
  try {
    if (field.kind === "combobox") return await fillCombobox(field, String(value), ruleId);
  } catch (err) {
    console.warn(`Apply karo: skipped "${field.rawLabel || field.name}" —`, err.message);
  }
  return false;
}
