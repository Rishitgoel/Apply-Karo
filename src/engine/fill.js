// ResumeFiler — value injection.
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
  setValue(el, value);
  fireInput(el);
  fire(el, "change");
  return true;
}

function fillContentEditable(el, value) {
  el.focus({ preventScroll: true });
  el.textContent = value;
  fireInput(el);
  fire(el, "change");
  return true;
}

function fillSelect(el, value, options, ruleId) {
  const opts = options?.length
    ? options
    : Array.from(el.options).map((o) => ({ el: o, label: o.text.trim(), value: o.value }));

  const pick = bestOption(opts, value, 0.5, ruleId) || fallbackOption(opts);
  if (!pick) return false;

  setValue(el, pick.value);
  // Some frameworks track selectedIndex rather than value.
  if (el.value !== pick.value && pick.el) pick.el.selected = true;
  fireInput(el);
  fire(el, "change");
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

function fillCheckbox(el, value) {
  // asBool understands the long-form phrasings ("I do not wish to answer"),
  // which a bare /^yes/ test reads as agreement.
  const want = asBool(value) ?? false;
  if (el.checked === want) return true;
  const proxy = el.closest("label");
  if (proxy && proxy !== el) realClick(proxy);
  else { el.checked = want; realClick(el); }
  fire(el, "change");
  return el.checked === want;
}

/**
 * Custom combobox: a text input or button that opens a listbox.
 * Workday, Ashby and most design systems build them this way and they are
 * invisible to a plain `value =` write.
 */
async function fillCombobox(el, value, ruleId) {
  realClick(el);

  // If it accepts text, type to filter — dramatically improves the hit rate on
  // long lists (countries, universities).
  const typeable = el.tagName === "INPUT" || el.isContentEditable;
  if (typeable) {
    setValue(el, value);
    fireInput(el);
    key(el, "ArrowDown");
  }

  const listbox = await waitFor(() => findListbox(el), 1500);
  if (listbox) {
    const items = Array.from(
      listbox.querySelectorAll('[role="option"],li,[data-automation-id="promptOption"]')
    ).filter((n) => n.offsetParent !== null || n.getClientRects().length);

    const opts = items.map((n) => ({ el: n, label: (n.textContent || "").trim(), value: n.getAttribute("data-value") || "" }));
    const pick = bestOption(opts, value, 0.55, ruleId);
    if (pick) {
      pick.el.scrollIntoView({ block: "nearest" });
      realClick(pick.el);
      fire(el, "change");
      return true;
    }
  }

  // Keyboard commit — works for virtualised lists with no clickable node.
  if (typeable) {
    key(el, "ArrowDown");
    key(el, "Enter");
    fire(el, "change");
    return !!el.value;
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

  setValue(el, out);
  fireInput(el);
  fire(el, "change");
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
      setValue(el, raw);
      fireInput(el);
      fire(el, "change");
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
    console.warn("ResumeFiler: file injection failed —", err.message);
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
    console.warn(`ResumeFiler: skipped "${field.rawLabel || field.name || field.kind}" —`, err.message);
    return false;
  }
}

export async function fillAsync(field, value, ruleId = null) {
  try {
    if (field.kind === "combobox") return await fillCombobox(field.el, String(value), ruleId);
  } catch (err) {
    console.warn(`ResumeFiler: skipped "${field.rawLabel || field.name}" —`, err.message);
  }
  return false;
}
