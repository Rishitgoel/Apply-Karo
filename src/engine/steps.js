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

import { realClick } from "./fill.js";
import { hasExistingUpload, isComboboxFilled, COMBO_PLACEHOLDER_RE } from "./scan.js";

const ADVANCE_RE = /\b(next|continue|proceed|save and continue|save & continue|next step|go to)\b/i;
const SUBMIT_RE = /\b(submit|apply now|send application|finish|complete application|agree and|accept and|confirm and)\b/i;

const CONTROL_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "FORM", "FIELDSET"]);

export function buttonText(el) {
  return (el.getAttribute("aria-label") || el.value || el.textContent || "").replace(/\s+/g, " ").trim();
}

/** True for anything that might finalise the application. */
export function isSubmitLike(text) {
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
export function hasStepIndicator(root = document) {
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
export function findAdvanceButton(root = document, ownUi = "#applykaro-root") {
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
export function requiredEmpty(root = document, ownUi = "#applykaro-root") {
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
export function waitForAdvance(timeoutMs = 3000) {
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
export async function runSteps(fillStep, opts = {}) {
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
