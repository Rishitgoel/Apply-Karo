import { semanticScore } from "../../shared/values.js";

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

export function rankChoices(options, value, ruleId) {
  const target = norm(value);
  const ranked = options.filter((o) => !o.el?.disabled && o.el?.getAttribute?.("aria-disabled") !== "true")
    .map((o) => ({ ...o, score: norm(o.label) === target || norm(o.value) === target ? 1 : Math.max(vocabularyScore(ruleId, o.label, o.value, value), semanticScore(ruleId, o.label, o.value, String(value))) }))
    .filter((o) => o.score >= .9).sort((a, b) => b.score - a.score);
  const first = ranked[0], second = ranked.find((o) => norm(o.label) !== norm(first?.label) || norm(o.value) !== norm(first?.value));
  const ambiguous = !!first && !!second && !(first.score === 1 && second.score < 1) && first.score - second.score < .06;
  return { choice: first && !ambiguous ? first : null, ambiguous, candidates: ranked.slice(0, 3) };
}

export function ownedMenu(el, previous = new Set()) {
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
export function readChoices(menu) {
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
export function selectedValues(el, option = null) {
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
export async function fillWorkday(field, value, ruleId, ops) {
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
