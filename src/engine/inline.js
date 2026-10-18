// Apply karo — inline field AI triggers.
//
// Mounts a dedicated "Fill with AI" button on every field that demands
// paragraph answers (e.g. textareas, cover letters, challenge descriptions,
// rich textboxes). Clicking the button sends an exclusive request for that
// specific field and allows optional custom instructions.

import { ICONS } from "../shared/icons.js";
import { resolveTheme } from "../shared/theme.js";
import { labelOf, isGenericLabel } from "./scan.js";

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
export function isParagraphTarget(field) {
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
export function initFieldOverlays({ getContext, onExclusiveFill, onCorrectQuestion }) {
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
export function updateFieldOverlays(fields) {
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
export function destroyFieldOverlays() {
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
