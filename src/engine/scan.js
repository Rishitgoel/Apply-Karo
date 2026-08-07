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

import {
  tokenize, ATS_BY_NAME, ATS_BY_ID, ATS_BY_AUTOMATION_ID, FOREIGN_SECTION
} from "../shared/rules.js";

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
  '[role="spinbutton"]'
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

const OWN_UI = "#applykaro-root";

// ─────────────────────────────────────────────────────────────────────────────
// Shadow DOM host cache
// ─────────────────────────────────────────────────────────────────────────────

let shadowRoots = null;      // ShadowRoot[]
let shadowDirty = true;      // set by the observer when nodes are added

export function invalidateShadowCache() {
  shadowDirty = true;
}

function collectShadowRoots() {
  const roots = [];
  const walk = (root, depth) => {
    if (depth > 6) return;                       // pathological nesting guard
    let all;
    try { all = root.querySelectorAll("*"); } catch { return; }
    for (let i = 0; i < all.length; i++) {
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
function textOf(el, budget = 160) {
  if (!el) return "";
  let out = "";
  const walk = (node) => {
    if (out.length >= budget) return;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (out.length >= budget) return;
      if (child.nodeType === 3) {
        out += child.nodeValue;
      } else if (child.nodeType === 1) {
        if (SKIP_TAGS.has(child.tagName)) continue;
        if (child.getAttribute && child.getAttribute("aria-hidden") === "true") continue;
        walk(child);
      }
    }
  };
  walk(el);
  return normalize(out);
}

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
  for (const root of roots) {
    let labels;
    try { labels = root.querySelectorAll("label[for]"); } catch { continue; }
    for (const l of labels) {
      const key = l.getAttribute("for");
      if (key && !map.has(key)) map.set(key, l);
    }
  }
  return map;
}

function labelFor(el, labelMap) {
  // 1. aria-label — cheapest and usually authoritative.
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return normalize(aria);

  // 2. <label for="...">
  if (el.id) {
    const l = labelMap.get(el.id);
    if (l) {
      const t = textOf(l);
      if (t) return t;
    }
  }

  // 3. aria-labelledby (may list several ids).
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const root = el.getRootNode?.() || document;
    let parts = "";
    for (const id of by.split(/\s+/)) {
      const ref = (root.getElementById?.(id)) || document.getElementById(id);
      if (ref) parts += " " + textOf(ref, 80);
    }
    const t = normalize(parts);
    if (t) return t;
  }

  // 4. Wrapping <label>.
  const wrap = el.closest?.("label");
  if (wrap) {
    const t = textOf(wrap);
    if (t) return t;
  }

  // 5. Preceding sibling text, then the parent's own leading text. Covers the
  //    very common `<div><span>Email</span><input></div>` shape.
  let sib = el.previousElementSibling;
  for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
    if (SKIP_TAGS.has(sib.tagName)) continue;
    const t = textOf(sib, 100);
    if (t && t.length < 120) return t;
  }
  const parent = el.parentElement;
  if (parent) {
    const t = textOf(parent, 120);
    if (t && t.length < 120) return t;
  }

  // 6. Attributes as a last resort.
  const ph = el.getAttribute("placeholder");
  if (ph && ph.trim()) return normalize(ph);
  const title = el.getAttribute("title");
  if (title && title.trim()) return normalize(title);

  return "";
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
export function labelOf(el) {
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

const sectionCache = new WeakMap();

/**
 * Nearest heading above the field, classified.
 * Returns { kind: "education"|"experience"|null, foreign: boolean }.
 */
function sectionFor(el) {
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
        kind: /educat|school|universit|college|academic|degree/.test(low) ? "education"
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
  let node = el.parentElement;

  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) break;

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
      const attrs = `${el.name || ""} ${el.id || ""} ${el.getAttribute("data-automation-id") || ""}`;
      const explicit = attrs.match(/\[(\d{1,2})\]/) || attrs.match(/\.(\d{1,2})\./);
      return { group, index: Math.min(explicit ? +explicit[1] : index, 20) };
    }
  }

  return { group: 0, index: 0 };
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

  const proxied = type === "radio" || type === "checkbox";

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
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;   // zero-size honeypot
  }
  return true;
}

function isHoneypot(el) {
  const hay = `${el.name || ""} ${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`;
  if (HONEYPOT.test(hay)) return true;
  if (el.getAttribute("autocomplete") === "off" && el.tabIndex === -1) return true;
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
  return (el.getAttribute("aria-haspopup") || "").toLowerCase() === "listbox";
}

function kindOf(el) {
  const tag = el.tagName;
  if (tag === "SELECT") return "select";
  if (tag === "TEXTAREA") return "textarea";
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
  return nodes.map((n) => ({
    el: n,
    label: normalize(n.getAttribute("aria-label") || n.getAttribute("data-value") || textOf(n, 80)),
    value: n.getAttribute("data-value") || n.getAttribute("value") || ""
  })).filter((o) => o.label);
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
  if (el.id && labelMap.has(el.id)) {
    const t = textOf(labelMap.get(el.id), 80);
    if (t) return t;
  }
  const wrap = el.closest?.("label");
  if (wrap) {
    const t = textOf(wrap, 80);
    if (t) return t;
  }
  const next = el.nextElementSibling;
  if (next && !SKIP_TAGS.has(next.tagName)) {
    const t = textOf(next, 80);
    if (t) return t;
  }
  return normalize(el.getAttribute("aria-label") || el.value || "");
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
    if (aria) return normalize(aria);
    // `aria-labelledby` is a *list* of ids. Passing the raw attribute to
    // getElementById finds nothing the moment a page names two elements —
    // "legend-1 hint-1" is not an id — and the question then fell through to the
    // section heading, which on a form is usually the name of the whole section.
    const by = rg.getAttribute("aria-labelledby");
    if (by) {
      const root = rg.getRootNode?.() || document;
      let parts = "";
      for (const id of by.split(/\s+/)) {
        const ref = root.getElementById?.(id) || document.getElementById(id);
        if (ref) parts += " " + textOf(ref, 120);
      }
      const t = normalize(parts);
      if (t) return t;
    }
  }

  // Then the enclosing fieldset's legend. For native radios — which carry no
  // ARIA of their own — this is the question, and it stays the main path.
  const fs = el.closest?.("fieldset");
  if (fs) {
    const lg = fs.querySelector(":scope > legend");
    if (lg) {
      const t = textOf(lg, 200);
      if (t) return t;
    }
  }

  // Fall back to the nearest heading-ish text above the group container.
  const sec = sectionFor(el);
  return sec.text || "";
}

/**
 * Scan the frame and return field descriptors.
 *
 * Radios and checkboxes sharing a name become a single "radiogroup" descriptor
 * carrying its options, so the matcher sees the question rather than the answers.
 */
export function scan() {
  const roots = getRoots();
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
      d.options.push({
        el,
        label: aria ? normalize(el.getAttribute("aria-label") || textOf(el, 80)) : optionLabelFor(el, labelMap),
        value: el.getAttribute("data-value") || el.value || ""
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
        .filter((o) => o.label && !/^(--\s*)?(select|choose|please select)/i.test(o.label));
      d.filled = el.selectedIndex > 0 && !!el.value;
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
      d.filled = !!(el.files && el.files.length > 0);
      d.accept = el.getAttribute("accept") || "";
      // A hidden input carries none of the words a human reads. "Attach resume"
      // lives on the button, "Drop your CV here" on the zone — so the wrapper is
      // where the descriptor has to get its meaning from.
      d.uploadContext = uploadContextFor(el);
      d.className = typeof el.className === "string" ? el.className : "";
    } else if (isAria(el)) {
      // An ARIA textbox/combobox holds its value as text, not in `.value`.
      d.filled = !!(el.getAttribute("aria-label") && el.textContent?.trim()) || !!el.value?.trim();
    } else {
      d.filled = !!(el.value && el.value.trim());
    }

    // Left to the end so the `filled` rules above stay exactly as they were —
    // this only adds what the control offers, when that is readable up front.
    if (kind === "combobox") d.options = comboboxOptions(el);

    fields.push(d);
  }

  return groupDateParts(fields);
}

/** Cheap probe used by the sentinel: does this frame hold a real form? */
export function countFillable() {
  let n = 0;
  const els = document.querySelectorAll("input,select,textarea");
  for (const el of els) {
    const t = (el.type || "text").toLowerCase();
    if (t === "hidden" || t === "submit" || t === "button" || el.disabled) continue;
    n++;
  }
  return n;
}
