import { prepareField, formatFact, typedSetup } from "./format.js";
import { eligible, sourceForRule } from "./validate.js";
import { exactAnswer, questionContext, scopedAuthorization } from "../knowledge/retrieve.js";
import { canonicalQuestion } from "../shared/field-identity.js";
export const PROMPT_VERSION = "resolver-v1";
export function decision(field, status, reason, extra = {}) { return { fieldId: field.fieldId, revision: field.revision, status, value: null, reason, evidenceIds: [], optionIds: [], transformations: [], ...extra }; }
export function resolveOne(rawField, { profile = {}, settings = {}, knowledge = {}, url = "https://invalid.local/", mapping = null, legacy = {} } = {}) {
  const field = prepareField(rawField), policy = eligible(field, settings);
  if (policy) return decision(field, policy.status, policy.reason);
  let memory = null;
  try { memory = exactAnswer({ answers: {}, dependencies: {}, ...knowledge }, questionContext(field, url)); } catch { return decision(field, "blocked", "invalid_application_scope"); }
  if (memory) {
    const formatted = formatFact(field, memory.value, mapping?.ruleId);
    return formatted.value ? decision(field, "resolved", "approved_memory", { ...formatted, source: "approved_memory", evidenceIds: [memory.id], intent: mapping?.ruleId || "approved_answer" }) : decision(field, "needs_user", formatted.reason);
  }
  // Reviewed contact compatibility only; other legacy labels have no scope.
  if (!/education|experience/.test(field.section || "") && /^(first name|given name|last name|family name|full name|email( address)?|e mail( address)?|phone( number)?|telephone)$/.test(canonicalQuestion(field.questionFull))) {
    const contact = legacy[canonicalQuestion(field.questionFull)];
    if (contact) { const formatted = formatFact(field, contact, mapping?.ruleId); if (formatted.value) return decision(field, "resolved", "reviewed_contact", { ...formatted, source: "reviewed_contact", evidenceIds: [`legacy-contact:${canonicalQuestion(field.questionFull)}`], intent: mapping?.ruleId }); }
  }
  const typed = typedSetup(field, knowledge);
  if (typed) { const formatted = formatFact(field, typed.value, typed.intent); if (formatted.value) return decision(field, "resolved", "confirmed_typed_fact", { ...formatted, source: "fact", intent: typed.intent, evidenceIds: typed.facts.map(f => f.id) }); }
  if (["authorizedToWork", "sponsorship"].includes(mapping?.ruleId)) {
    if (/future|\b(and|or)\b|authori[sz].*sponsor|sponsor.*authori[sz]/i.test(field.questionFull)) return decision(field, "needs_user", "compound_or_temporal_authorization");
    const intent = mapping.ruleId === "sponsorship" ? "authorization.sponsorship" : "authorization.authorized", value = scopedAuthorization(knowledge, field, intent);
    if (value) { const formatted = formatFact(field, value, mapping.ruleId); if (formatted.value) return decision(field, "resolved", "confirmed_country_fact", { ...formatted, source: "fact", intent, evidenceIds: Object.values(knowledge.facts || {}).filter(f => f.intent === intent && f.status === "confirmed").map(f => f.id) }); }
    return decision(field, "needs_user", "missing_scoped_authorization");
  }
  const fact = sourceForRule(field, mapping, profile);
  if (fact) {
    const formatted = formatFact(field, fact.value, fact.intent);
    if (formatted.value) return decision(field, "resolved", "compatible_profile_fact", { ...formatted, source: fact.provenance.source, intent: fact.intent, evidenceIds: [fact.id], provenance: fact.provenance });
    return decision(field, "needs_user", formatted.reason, { intent: fact.intent });
  }
  return decision(field, "needs_user", "missing_compatible_fact");
}
export function resolveFields(fields, context = {}) {
  const ids = new Set();
  return fields.map((field, i) => { if (ids.has(field.fieldId)) throw new Error("Duplicate field identity."); ids.add(field.fieldId);
    return resolveOne(field, { ...context, mapping: context.mappings?.get(i) || null }); });
}
