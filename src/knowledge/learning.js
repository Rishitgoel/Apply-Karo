import { canonicalQuestion } from "../shared/field-identity.js";
// Wider reuse is deliberately limited to reviewed, literal, personal questions.
export function reusableQuestion(question) {
  return /^(first name|last name|full name|email|email address|phone|phone number|mobile phone|mobile number|current location|city|country|linkedin profile|linkedin url|portfolio url|github url)$/.test(canonicalQuestion(question));
}
export function correctionKind(previous, value, repair = false) {
  if (repair) return "mapping-repair";
  return previous && String(previous.value) !== String(value) ? "answer-replacement" : "user-answer";
}
export function answerText(field, value) {
  if (field.kind === "file") return (value || []).map(file => file.name).join(", ");
  if (field.kind === "dategroup" && Array.isArray(value)) { const parts = Object.fromEntries(value); return [parts.year, parts.month, parts.day].filter(v => v !== undefined).map((v, i) => i ? String(v).padStart(2, "0") : String(v)).join("-"); }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(v => field.options?.find(o => [o.value, canonicalQuestion(o.label)].includes(v))?.label || v).join(", ");
  return String(value ?? "").trim();
}
