// Shared policy for rule, memory, bulk and inline answers. Confidence is not evidence.
const SENSITIVE = /\b(gender|sex|pronouns?|race|ethnic\w*|veteran|disabil\w*|religio\w*|sexual orientation|marital)\b/i;
const CRITICAL = /authori[sz]|sponsor|visa|citizen|salary|compensation|notice|availability|start date|certificat|licen[cs]|criminal|convict|consent|agree|declar|attest/i;
export function answerPolicy(field = {}, settings = {}) {
  if (field.extraction?.conflicting) return { allowed: false, reason: "conflicting_question" };
  const question = [field.rawLabel || field.label, field.name, field.helperText].filter(Boolean).join(" ");
  if (field.type === "password" || field.kind === "file") return { allowed: false, reason: "unsupported" };
  if (settings.skipSensitive !== false && SENSITIVE.test(question)) return { allowed: false, reason: "sensitive" };
  return { allowed: true, critical: CRITICAL.test(question), prose: field.kind === "textarea" || field.kind === "richtext" };
}
export function confidenceOf(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}
export function valueAt(profile, path) {
  if (typeof path !== "string" || !/^(personal|education|experience|customFields|summary|skills)(\[\d+\]|\.[a-zA-Z0-9_]+)*$/.test(path)) return undefined;
  return path.replace(/\[(\d+)\]/g, ".$1").split(".").reduce((v, k) => v && Object.hasOwn(v, k) ? v[k] : undefined, profile);
}
const INTENTS = [
  [/first name|given name/i, /personal\.firstName$/], [/last name|family name/i, /personal\.lastName$/],
  [/full name|legal name/i, /personal\.fullName$/], [/email/i, /personal\.email$/], [/phone|telephone/i, /personal\.phone$/],
  [/postal|zip code/i, /personal\.postalCode$/], [/country/i, /personal\.country$/], [/state|province/i, /personal\.state$/],
  [/city|residence/i, /personal\.city$/], [/street|address line 1/i, /personal\.address$/],
  [/sponsor/i, /personal\.sponsorshipRequired$/], [/authori[sz]/i, /personal\.authorizedToWork$/],
  [/linkedin/i, /personal\.linkedin$/], [/github/i, /personal\.github$/], [/website/i, /personal\.website$/],
  [/university|school/i, /education\[\d+\]\.school$/], [/degree/i, /education\[\d+\]\.degree$/],
  [/major|field of study/i, /education\[\d+\]\.fieldOfStudy$/], [/gpa/i, /education\[\d+\]\.gpa$/],
  [/employer|company name/i, /experience\[\d+\]\.company$/], [/job title|position/i, /experience\[\d+\]\.(title|position)$/]
];
const canonical = (s) => String(s).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function compatibleFact(field, evidence, profile) {
  const question = field.rawLabel || field.label || "";
  const hit = INTENTS.find(([pattern]) => pattern.test(question));
  if (hit) {
    if (evidence.source !== "profile" || !hit[1].test(evidence.path)) return false;
    if (/authori[sz]|sponsor/i.test(question)) {
      const country = profile.personal?.country;
      if (!country || !question.toLowerCase().includes(country.toLowerCase())) return false;
      if (/without|not require|do not|don't|no sponsorship/i.test(question)) return false;
    }
    return true;
  }
  return evidence.source === "profile" && evidence.path?.startsWith("customFields.") && canonical(evidence.path.slice(13)) === canonical(question);
}
export function validateAnswer(entry, field, { settings = {}, profile = {}, resumeText = "" } = {}) {
  const policy = answerPolicy(field, settings);
  if (!policy.allowed) return { status: "blocked", value: null, reason: policy.reason };
  if (!entry || entry.value == null || !String(entry.value).trim()) return { status: "missing_fact", value: null, reason: "missing_fact" };
  const value = String(entry.value).trim();
  const evidence = (Array.isArray(entry.evidence) ? entry.evidence : []).filter((e) => {
    if (e?.source === "profile") return typeof e.quote === "string" && String(valueAt(profile, e.path) ?? "") === e.quote && !!e.quote.trim();
    return e?.source === "resume" && typeof e.quote === "string" && e.quote.trim().length >= 12 && resumeText.includes(e.quote);
  });
  if (!evidence.length) return { status: "missing_fact", value: null, reason: "unsupported_answer" };
  // A prose draft is still unapproved and must be visibly reviewed. It cannot
  // invent declarations, eligibility, compensation or other missing facts.
  const draft = entry.status === "draft" && policy.prose && !policy.critical;
  const fact = entry.status === "grounded" && evidence.some((e) => e.quote === value && compatibleFact(field, e, profile));
  if (!draft && !fact) return { status: "missing_fact", value: null, reason: "unsupported_transformation" };
  if (field.options?.length && !field.options.some((o) => String(typeof o === "string" ? o : o.label || o.value) === value)) return { status: "ambiguous", value: null, reason: "invalid_option" };
  return { value, status: draft ? "draft" : "grounded", evidence, confidence: confidenceOf(entry.confidence), reason: "supported" };
}
