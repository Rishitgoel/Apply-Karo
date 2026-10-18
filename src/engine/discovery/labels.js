// Question text is semantic input. Display shortening belongs in the UI.
import { scopeForQuestion } from "../../shared/field-identity.js";
export function cleanText(value) {
  return String(value || "").replace(/[\s\u00a0]+/g, " ").replace(/[*:•]+\s*$/, "").trim();
}
const skip = new Set(["INPUT", "SELECT", "TEXTAREA", "OPTION", "BUTTON", "SCRIPT", "STYLE", "SVG"]);
let questionFixes = {};
export function configureQuestionFixes(records) { questionFixes = records || {}; }
export function locatorFor(el) {
  return el.id ? `id:${el.id}` : el.name ? `name:${el.name}` : el.getAttribute?.("data-automation-id") ? `automation:${el.getAttribute("data-automation-id")}` : "";
}
export function questionScope(url) { return scopeForQuestion(url); }
export function fullText(el) {
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
export function references(el, attribute) {
  const root = el.getRootNode?.() || globalThis.document;
  const seen = new Set();
  return String(el.getAttribute?.(attribute) || "").trim().split(/\s+/).filter((id) => id && !seen.has(id) && seen.add(id))
    .map((id) => ({ id, text: fullText(root?.getElementById?.(id)) })).filter((r) => r.text);
}
export function labelCandidates(el, map, generic) {
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
export function resolveLabels(el, map, fallback, generic) {
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
