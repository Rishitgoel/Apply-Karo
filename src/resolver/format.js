import { canonicalQuestion } from "../shared/field-identity.js";
import { rankChoices } from "../engine/controls/workday.js";
import { splitPhone } from "../shared/values.js";
export function prepareField(field) {
  const fieldId = field.fieldId;
  return { ...field, questionFull: field.questionFull || field.rawLabel || field.label || "", revision: field.revision || field.formRevision || 1,
    options: (field.options || []).map((option, i) => ({ optionId: typeof option === "object" && option.optionId || `${fieldId}:option:${i}`,
      label: typeof option === "string" ? option : option.label || option.value || "", value: typeof option === "string" ? option : option.value ?? option.label ?? "" })) };
}
export function formatFact(field, value, ruleId) {
  if ((field.kind === "checkboxgroup" || field.multiple) && field.options?.length) {
    const values=Array.isArray(value)?value:ruleId==="skills"?String(value).split(/[,;\n]+/).map(v=>v.trim()).filter(Boolean):[String(value)];
    const choices=values.map(v=>rankChoices(field.options,v,ruleId).choice);
    if(choices.some(c=>!c))return {reason:"ambiguous_options"};
    return {value:choices.map(c=>c.label),optionIds:choices.map(c=>c.optionId),transformations:[]};
  }
  let text = String(value ?? "").trim();
  const transformations = [];
  if(ruleId==="phone" && field.phonePart==="national") {text=splitPhone(text).national;transformations.push("separate_dial_code");}
  if (["linkedin", "github", "website", "portfolio"].includes(ruleId)) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) { text = "https://" + text.replace(/^\/\//, ""); transformations.push("add_https_scheme"); }
    try {
      const url = new URL(text);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".") || /\s/.test(text)) return { reason: "invalid_profile_url" };
    } catch { return { reason: "invalid_profile_url" }; }
  }
  if (!text) return { reason: "missing_fact" };
  const limit = field.constraints?.maxLength || field.maxLength;
  if (limit && text.length > limit) return { reason: "fact_exceeds_length" };
  if (field.options?.length && field.kind !== "checkbox") {
    const ranked = rankChoices(field.options, text, ruleId);
    if (!ranked.choice) return { reason: ranked.reason || "ambiguous_options" };
    return { value: ranked.choice.label, optionIds: [ranked.choice.optionId], optionsComplete: field.optionsComplete !== false, transformations: text === ranked.choice.label ? [] : ["curated_option_mapping"] };
  }
  return { value: text, optionIds: [], transformations };
}
export function typedSetup(field, state, now = Date.now()) {
  const q = canonicalQuestion(field.questionFull), facts = Object.values(state?.facts || {}).filter(f => f.status === "confirmed" && (!f.refreshAfter || f.refreshAfter > now));
  const fact = intent => { const found = facts.filter(f => f.intent === intent); return found.length === 1 ? found[0] : null; };
  if (/\b(not|without|unless|except|future)\b/.test(q)) return null;
  if (/^(can|are|is|do|does|will|have|would)\b/.test(q)) return null;
  if (/notice/.test(q)) {
    const f = fact("availability.noticeDays");
    if (f && !/weeks?|months?|years?/.test(q)) return { value: field.type === "number" || /\bdays\b/.test(q) ? String(f.value) : `${f.value} days`, facts: [f], intent: "noticePeriod" };
  }
  if (/available.*start|availability|earliest.*start/.test(q) && !/school|education|employment|experience|job history/.test(field.section || "")) { const f = fact("availability.startDate"); if (f && /^\d{4}-\d{2}-\d{2}$/.test(f.value)) return { value: f.value, facts: [f], intent: "startDate" }; }
  if (/expected|desired|expectation/.test(q) && /salary|compensation|pay/.test(q) && !/current|previous|minimum|maximum|range|bonus|equity|gross|net|total/.test(q)) {
    const amount = fact("compensation.amount"), currency = fact("compensation.currency"), period = fact("compensation.period");
    const currencies = [...q.matchAll(/\b(usd|inr|eur|gbp|cad|aud)\b/g)].map(m => m[1]);
    const periods = /annual|year/.test(q) ? ["year"] : /month/.test(q) ? ["month"] : /hour/.test(q) ? ["hour"] : [];
    if (amount && currency && period && currencies.length === 1 && currencies[0] === canonicalQuestion(currency.value) && periods.length === 1 && periods[0] === period.value)
      return { value: String(amount.value), facts: [amount, currency, period], intent: "expectedSalary" };
  }
  return null;
}
