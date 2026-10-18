import { canonicalQuestion } from "../shared/field-identity.js";
import { answerPolicy, valueAt } from "../shared/answer-policy.js";
import { RULE_BY_ID } from "../shared/rules.js";
import { splitPhone } from "../shared/values.js";
const patterns = {
  firstName: /first name|given name/, lastName: /last name|family name|surname/, fullName: /full name|legal name|your name|^name$/,
  middleName: /middle name/, preferredName: /preferred name/, email: /email|e mail/, phone: /phone|telephone|mobile/, phoneCountryCode: /dial|calling|country code/,
  city: /city|residence/, location: /^(current |home |residential )?location$|^where are you (located|based)$/, state: /state|province|region/, country: /country/, postalCode: /postal|zip/,
  addressLine1: /street|address/, addressLine2: /address.*2|apartment|suite/, linkedin: /linkedin/, github: /github/, website: /website|personal site/, portfolio: /portfolio/,
  university: /school|university|institution|college/, degree: /degree|qualification/, fieldOfStudy: /major|field of study|discipline|speciali[sz]ation/, gpa: /gpa|grade point/,
  company: /employer|company|organization/, jobTitle: /job title|position|title/, experienceLocation: /location|city/, graduationDate: /graduat|end date/,
  educationStartDate: /start|from|begin/, educationEndDate: /end|to|graduat/, experienceStartDate: /start|from|begin/, experienceEndDate: /end|to|finish/,
  currentJob: /current|present|still.*work/, summary: /summary|about yourself/, skills: /skills|technolog/
};
export function compatibleIntent(field, ruleId) {
  const rule = RULE_BY_ID.get(ruleId), q = canonicalQuestion(field.questionFull || field.rawLabel || field.label);
  if (!rule || !(patterns[ruleId]?.test(q) || ruleId==="phoneCountryCode" && field.phonePart==="code")) return false;
  if (rule.path.startsWith("personal.") && ["education", "experience"].includes(field.section)) return false;
  if (ruleId !== "currentJob" && /^(do|does|can|is|are|will|have|would)\b/.test(q)) return false;
  if (!["summary", "skills"].includes(ruleId) && /\b(describe|explain|why|initials)\b|how (long|many|did|does|do)|tell.*about/.test(q)) return false;
  const context = canonicalQuestion([q, field.helperText, field.sectionTitle].filter(Boolean).join(" "));
  if (/\b(emergency|reference|referee|manager|supervisor|parent|spouse|recruiter|citizenship|nationality)\b/.test(context)) return false;
  if (/\b(not|without|except|unless)\b/.test(field.helperText || "")) return false;
  if (ruleId === "firstName" && /middle|preferred|family|surname|last/.test(q)) return false;
  if (ruleId === "country" && /\bcode\b/.test(q)) return false;
  if (ruleId === "university" && /\b(city|location|address|email|phone|percentage|gpa|degree|major)\b/.test(q)) return false;
  if (ruleId === "fieldOfStudy" && /\b(achievements?|accomplishments?|percentage|gpa|employer|company)\b/.test(q)) return false;
  if (answerPolicy({ ...field, rawLabel: q }, {}).critical && !/^(education|experience)(Start|End)Date$/.test(ruleId)) return false;
  if (/\b(emergency|reference|referee|manager|supervisor|parent|spouse|recruiter|birth|citizenship|nationality|preferred country|relocat|willing|desired|expected)\b/.test(q)) return false;
  const exampleOnly = ruleId === "fieldOfStudy" && /^speciali[sz]ation\s*\(primary speciali[sz]ation ex[: ]/i.test(field.questionFull || field.rawLabel || "");
  if (/\b(and|or)\b/.test(q) && !exampleOnly && !/state or province|country or region|city or town/.test(q)) return false;
  if (field.extraction?.conflicting || field.extraction?.truncated || field.extraction?.ambiguous) return false;
  if (/\b(not|without|except|excluding|unless|previous|former|future)\b/.test(q)) return false;
  if (/first name/.test(q) && /last name|family name/.test(q)) return false;
  const explicitEducation = ruleId === "university" ? /^(college|school|university|institution)( name)?$/.test(q) : ["degree", "fieldOfStudy", "gpa"].includes(ruleId);
  if (rule.section && ["education", "experience"].includes(rule.section) && !String(field.section || "").toLowerCase().includes(rule.section) && !(rule.section === "education" && !field.section && explicitEducation)) return false;
  if (!rule.section && ["education", "experience"].includes(field.section) && /^(city|location|state|country|addressLine1|addressLine2)$/.test(ruleId)) return false;
  if (rule.path.startsWith("personal.") && /\b(school|university|employer|company|organization)\b/.test(q)) return false;
  if (["summary", "skills"].includes(ruleId) && !/^(summary|professional summary|about yourself|tell us about yourself|skills|technical skills|technologies)$/.test(q)) return false;
  if (["city", "state", "country", "addressLine1", "addressLine2"].includes(ruleId) && /school|university|employer|company/.test(q)) return false;
  return true;
}
export function ruleCandidate(field, rule) { return ["authorizedToWork", "sponsorship"].includes(rule.id) || compatibleIntent(field, rule.id); }
export function sourceForRule(field, mapping, profile) {
  const rule = RULE_BY_ID.get(mapping?.ruleId);
  if (!rule || !compatibleIntent(field, mapping.ruleId) || rule.path.startsWith("customFields.")) return null;
  const instance = field.instance || mapping.instance || 0;
  if (!Number.isInteger(instance) || instance < 0) return null;
  if (rule.section === "education" && !field.section && (profile.education || []).length !== 1) return null;
  if (mapping.ruleId === "university" && /high school|secondary|10th|12th/i.test(field.questionFull)) return null;
  if (rule.section === "experience" && mapping.ruleId !== "currentJob" && /\b(current|present)\b/i.test(field.questionFull) && profile.experience?.[instance]?.current !== true) return null;
  const path = /^(education|experience)\[0\]/.test(rule.path) ? rule.path.replace("[0]", `[${instance}]`) : rule.path;
  const raw = valueAt(profile, path);
  if (mapping.ruleId === "location" && !raw && profile.personal?.city) return { id: "derived:location", value: [profile.personal.city, profile.personal.state, profile.personal.country].filter(Boolean).join(", "), intent: "location", provenance: { source: "derived", paths: ["personal.city", "personal.state", "personal.country"] } };
  if (mapping.ruleId === "currentJob" && typeof raw === "boolean") return { id: `profile:${path}`, value: raw ? "Yes" : "No", intent: mapping.ruleId, provenance: { source: "profile", path, quote: String(raw) } };
  if (rule.isDate && typeof raw === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(raw) && /\byear\b/.test(field.questionFull) && !/month|day/.test(field.questionFull)) return { id: `profile:${path}:year`, value: raw.slice(0,4), intent: mapping.ruleId, provenance: { source: "derived", path, quote: raw } };
  if (mapping.ruleId === "phoneCountryCode" && !raw) {
    const value = splitPhone(profile.personal?.phone || "").code;
    if (value) return { id: "derived:phoneCountryCode", value, intent: mapping.ruleId, provenance: { source: "derived", paths: ["personal.phone"] } };
  }
  if (raw !== undefined && raw !== null && String(raw).trim()) return { id: `profile:${path}`, value: raw, intent: mapping.ruleId,
    provenance: { source: "profile", path, quote: String(raw) }, entityId: field.entityId, path };
  // Explicit, evidence-preserving derivations only; no general rule fallbacks.
  if (mapping.ruleId === "fullName" && profile.personal?.firstName && profile.personal?.lastName) return { id: "derived:fullName", value: [profile.personal.firstName, profile.personal.middleName, profile.personal.lastName].filter(Boolean).join(" "), intent: "fullName", provenance: { source: "derived", paths: ["personal.firstName", "personal.middleName", "personal.lastName"] } };
  return null;
}
export function groundedClaims(entry, evidence, profile = {}) {
  if (!Array.isArray(entry.claims) || !entry.claims.length || entry.claims.length > 12) return null;
  const fullName = String(profile.personal?.fullName || [profile.personal?.firstName, profile.personal?.lastName].filter(Boolean).join(" ")).trim();
  const claims = [];
  for (const claim of entry.claims) {
    const source = evidence.find(e => e.id === claim.evidenceId);
    if (!source || typeof claim.text !== "string" || typeof claim.quote !== "string" || claim.quote.length < 12 || !source.text.includes(claim.quote)) return null;
    const normalized = text => (fullName ? text.replaceAll(fullName, "I") : text).trim().replace(/\s+/g, " ");
    if (normalized(claim.text) !== normalized(claim.quote)) return null;
    claims.push(claim.text.trim());
  }
  const value = claims.join(" ");
  if (entry.value !== value) return null;
  return { value, evidenceIds: [...new Set(entry.claims.map(c => c.evidenceId))], claims: entry.claims };
}
export function proseTarget(field) {
  return ["textarea","richtext"].includes(field.kind) || field.kind==="text" && (!field.type || field.type==="text") && /^achievements?$/.test(canonicalQuestion(field.questionFull || field.rawLabel || field.label));
}
export function eligible(field, settings) {
  const policy = answerPolicy({ ...field, rawLabel: field.questionFull }, settings);
  if (!policy.allowed) return { status: "blocked", reason: policy.reason };
  if (field.skip || field.filled || field.currentValue) return { status: "deferred", reason: "existing_or_user_value" };
  if (!field.fieldId || !field.questionFull || field.extraction?.truncated || field.extraction?.ambiguous) return { status: "needs_user", reason: "ambiguous_question" };
  return null;
}
