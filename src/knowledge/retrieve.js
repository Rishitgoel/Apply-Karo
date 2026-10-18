import { canonicalQuestion, scopeForQuestion } from "../shared/field-identity.js";
import { reusableQuestion } from "./learning.js";
export function questionContext(field, url) {
  return { question: field.questionFull || field.rawLabel || field.label || "", section: canonicalQuestion(field.sectionTitle || field.section || ""),
    entityId: field.entityId || `${field.section || "personal"}:${field.instance || 0}`, application: scopeForQuestion(url),
    country: canonicalQuestion(field.country || ""), company: canonicalQuestion(field.company || ""), polarity: canonicalQuestion(field.polarity || ""),
    applicationContext: String(field.applicationContext || ""),
    units: canonicalQuestion(field.units || ""), options: (field.options || []).map(o => canonicalQuestion(o.label || o.value)).sort() };
}
export function answerIdentity(context) { return "answer:" + JSON.stringify([canonicalQuestion(context.question), context.section, context.entityId, context.application, context.country, context.company, context.polarity, context.units, context.options, context.applicationContext]); }
export function scopedAnswerIdentity(context, scope) { return scope === "similar" ? "personal:" + answerIdentity({ ...context, application: "", company: "", applicationContext: "" }) : answerIdentity(context); }
export function currentRecord(record, dependencies, now = Date.now()) {
  return record.status === "approved" && (!record.expiresAt || record.expiresAt > now) &&
    Object.entries(record.dependencies || {}).every(([key, value]) => value === dependencies[key]);
}
export function candidates(state, context, { limit = 8, now = Date.now() } = {}) {
  const q = canonicalQuestion(context.question), tokens = new Set(q.split(" "));
  return Object.values(state.answers).filter((r) => currentRecord(r, state.dependencies, now) &&
    (r.scope?.type === "application" && r.scope.application === context.application && r.context.applicationContext === context.applicationContext && r.context.company === context.company ||
     r.scope?.type === "personal-question" && reusableQuestion(q) && canonicalQuestion(r.question) === q) &&
    r.context.section === context.section && r.context.entityId === context.entityId &&
    ["country", "polarity", "units"].every(k => r.context[k] === context[k]) && JSON.stringify(r.context.options) === JSON.stringify(context.options))
    .map((r) => { const other = canonicalQuestion(r.question), shared = other.split(" ").filter(t => tokens.has(t)).length;
      return { ...r, exact: other === q, score: other === q ? 1 : shared / Math.max(tokens.size, other.split(" ").length) }; })
    .filter(r => r.score > .25 && (r.exact || !/authori[sz]|sponsor|visa|citizen|salary|compensation|notice|availability|consent|agree|criminal|convict|certificat|licen[cs]|\bnot\b|\bwithout\b/i.test(q + " " + r.question)))
    .sort((a, b) => b.score - a.score).slice(0, limit);
}
export function exactAnswer(state, context) { const found = candidates(state, context).filter(r => r.exact), local = found.filter(r => r.scope.type === "application"); return local.length ? local.length === 1 ? local[0] : null : found.length === 1 ? found[0] : null; }
export function scopedAuthorization(state, field, intent, now = Date.now()) {
  const question = canonicalQuestion(field.questionFull || field.rawLabel || field.label);
  const temporalContext = canonicalQuestion([question, field.helperText, field.sectionTitle].filter(Boolean).join(" "));
  if (["education", "experience"].includes(field.section) || field.entityId && !/^personal(?::0)?$/.test(field.entityId) ||
      /\b(emergency|reference|referee|manager|supervisor|parent|spouse|recruiter|employer|company)\b/.test(temporalContext)) return null;
  if (/\b(ever|did|previous|formerly|former|past|historical|last year|before|since|future|next year)\b|\b(?:19|20)\d{2}\b/.test(temporalContext)) return null;
  if (/\b(without|not|never|unless|except)\b/.test(question)) return null;
  const countries = [["india", /\bindia\b/], ["united states", /\b(united states|usa|u s a|u s)\b/], ["united kingdom", /\b(united kingdom|uk|u k)\b/], ["canada", /\bcanada\b/], ["australia", /\baustralia\b/]];
  const match = countries.filter(([, pattern]) => pattern.test(question)); if (match.length !== 1) return null;
  const aliases = new Map([["usa", "united states"], ["us", "united states"], ["uk", "united kingdom"]]);
  const found = Object.values(state?.facts || {}).filter(r => r.status === "confirmed" && r.intent === intent && r.scope?.type === "country" &&
    (!r.entityId || /^personal(?::0)?$/.test(r.entityId)) &&
    (aliases.get(r.scope.country) || r.scope.country) === match[0][0] && (!r.refreshAfter || r.refreshAfter > now));
  return found.length === 1 ? found[0].value : null;
}
