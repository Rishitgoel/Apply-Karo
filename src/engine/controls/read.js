import { selectedValues } from "./workday.js";
export const checked = el => typeof el?.checked === "boolean" ? el.checked : el?.getAttribute?.("aria-checked") === "true" || el?.getAttribute?.("aria-selected") === "true";
export function controls(field) { return [...new Set([field.el, field.nativeSelect, ...(field.parts || []).map(p => p.field?.el), ...(field.kind === "combobox" ? [] : field.options || []).map(o => o.el)].filter(Boolean))]; }
export function readControl(field) {
  const el = field.el;
  if (field.kind === "file") return [...el.files || []].map(f => ({ name: f.name, size: f.size, type: f.type }));
  if (["checkbox", "switch"].includes(field.kind)) return checked(el);
  if (["radiogroup", "checkboxgroup"].includes(field.kind)) return (field.options || []).filter(o => checked(o.el)).map(o => o.value || o.label);
  if (field.kind === "dategroup") return (field.parts || []).map(p => [p.part, readControl(p.field)]);
  if (field.kind === "combobox") {
    if(field.nativeSelect) {
      const text=field.nativeSelect.selectedOptions[0]?.text.trim(),rendered=el.querySelector('.select2-selection__rendered')?.textContent.trim();
      return field.nativeSelect.value && text===rendered ? [text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()] : [];
    }
    if(el.hasAttribute("list") || ["both","inline"].includes(el.getAttribute("aria-autocomplete"))) return el.value ? [String(el.value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()] : [];
    return selectedValues(el);
  }
  if (field.kind === "select" && el.multiple) return [...el.selectedOptions].map(o => o.value);
  return el.isContentEditable ? el.textContent || "" : String(el.value ?? el.textContent ?? "");
}
export function validationState(field) {
  const els = controls(field), invalid = els.some(el => el.getAttribute?.("aria-invalid") === "true" || el.validity?.valid === false);
  const ids = els.flatMap(el => (el.getAttribute?.("aria-errormessage") || "").split(/\s+/).filter(Boolean));
  const error = ids.some(id => { const el = field.el.getRootNode().getElementById?.(id) || field.el.ownerDocument.getElementById(id); return el?.getClientRects().length && el.textContent?.trim(); });
  return invalid || error ? "failed" : els.some(el => el.validity || el.hasAttribute?.("aria-invalid") || el.hasAttribute?.("aria-errormessage")) ? "passed" : "not_exposed";
}
