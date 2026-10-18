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

import { fullText, resolveLabels } from "./discovery/labels.js";
import { describe } from "./discovery/descriptor.js";
import { selectedValues } from "./controls/workday.js";

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

export function invalidateShadowCache() {
  shadowDirty = true;
}

export function surfaceInventory() {
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

export const GENERIC_LABEL_RE = /^(your\s*answer|your\s*response|my\s*answer|answer(\s*here)?|short\s*answer(\s*text)?|long\s*answer(\s*text)?|(enter|type|write|fill\s*in)\s*(your\s*)?(answer|response|text)?(\s*here)?|text\s*area|text\s*box|input|text|response|required(\s*field)?|optional|question(\s*text)?|votre\s*r[eé]ponse|tu\s*respuesta|sua\s*resposta|ihre\s*antwort|la\s*tua\s*risposta)$/i;

export function isGenericLabel(s) {
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

export function labelFor(el, labelMap) {
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
export function helperTextFor(el) {
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
export function optionLabelFor(el, labelMap) {
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

export const COMBO_PLACEHOLDER_RE = /^[\s\u00a0-]*(\b(select(\s+(one|an?\s+option))?|choose(\s+(one|an?\s+option))?|please\s+select|none|search|type\s+to\s+search)\b)?[\s\u00a0-]*$/i;

export function isComboboxFilled(el) {
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
export function hasExistingUpload(el) {
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
export function scan(customRoot = null) {
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
export function rawControls() {
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
export function whyDropped(el) {
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
