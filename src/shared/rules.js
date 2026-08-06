// Apply karo — field definitions and the scoring matcher.
//
// v1 matched with `label.includes(keyword)` and took the first rule that hit,
// locking that rule out for the rest of the form. One bad early guess therefore
// blocked the field that actually deserved it — the single biggest source of
// "it didn't detect my fields".
//
// Here every (field, rule) pair gets a score from several independent signals,
// and assignment happens globally: best pairs claim their slots first. A generic
// rule can no longer steal a field from a specific one, because the specific
// rule simply scores higher on it.

// ─────────────────────────────────────────────────────────────────────────────
// Signal weights
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  ATS: 98,          // known ATS attribute — as close to certain as it gets
  AUTOCOMPLETE: 96, // the spec-defined token; browsers rely on it, so should we
  NAME_EXACT: 88,   // name/id tokens are exactly the rule's pattern
  LABEL_EXACT: 84,
  NAME_SEQ: 70,     // rule's pattern appears as a contiguous token run
  INPUT_TYPE: 62,   // type="email" / type="tel"
  LABEL_PHRASE: 36, // + specificity bonus, see scoreLabel()
  PLACEHOLDER: 30,
  SECTION_BONUS: 12,
  SECTION_PENALTY: -28
};

export const MIN_SCORE = 36;

// ─────────────────────────────────────────────────────────────────────────────
// Field rules
// ─────────────────────────────────────────────────────────────────────────────
// autocomplete : standard tokens (https://html.spec.whatwg.org/#autofill)
// names        : token sequences matched against tokenized name/id
// keywords     : phrases matched against the visible label
// negatives    : any hit here disqualifies the rule for that field outright
// section      : "education" | "experience" — boosts/penalises by context
// multi        : rule may claim more than one field (e.g. two email boxes)

export const RULES = [
  // ─── Name ───
  {
    id: "firstName",
    autocomplete: ["given-name"],
    names: [["first", "name"], ["fname"], ["given", "name"], ["forename"], ["first"]],
    keywords: ["first name", "given name", "forename", "legal first name"],
    negatives: ["last", "middle", "family", "surname", "company", "school", "reference"],
    path: "personal.firstName",
    fallback: (p) => (p.personal?.fullName || "").trim().split(/\s+/)[0] || null
  },
  {
    id: "lastName",
    autocomplete: ["family-name"],
    names: [["last", "name"], ["lname"], ["family", "name"], ["surname"], ["last"]],
    keywords: ["last name", "family name", "surname", "legal last name"],
    negatives: ["first", "given", "middle", "company", "school", "reference"],
    path: "personal.lastName",
    fallback: (p) => {
      const parts = (p.personal?.fullName || "").trim().split(/\s+/);
      return parts.length > 1 ? parts.slice(1).join(" ") : null;
    }
  },
  {
    id: "middleName",
    autocomplete: ["additional-name"],
    names: [["middle", "name"], ["mname"], ["middle", "initial"]],
    keywords: ["middle name", "middle initial"],
    path: "personal.middleName"
  },
  {
    id: "fullName",
    autocomplete: ["name"],
    names: [["full", "name"], ["name"], ["candidate", "name"], ["applicant", "name"], ["legal", "name"]],
    keywords: ["full name", "your name", "legal name", "candidate name", "applicant name", "name"],
    negatives: [
      "first", "last", "middle", "user", "company", "employer", "school",
      "university", "reference", "organization", "business", "file", "job",
      "position", "title", "manager", "supervisor", "contact name"
    ],
    path: "personal.fullName",
    fallback: (p) => {
      const n = `${p.personal?.firstName || ""} ${p.personal?.lastName || ""}`.trim();
      return n || null;
    }
  },

  // ─── Contact ───
  {
    id: "email",
    autocomplete: ["email"],
    names: [["email"], ["e", "mail"], ["email", "address"]],
    keywords: ["email", "e-mail", "email address"],
    negatives: ["confirm", "verify", "re-enter", "reference", "manager", "supervisor"],
    inputType: "email",
    path: "personal.email",
    multi: true
  },
  {
    id: "emailConfirm",
    names: [["confirm", "email"], ["email", "confirm"], ["email", "confirmation"], ["re", "enter", "email"]],
    keywords: ["confirm email", "re-enter email", "verify email", "email confirmation", "confirm your email"],
    path: "personal.email"
  },
  {
    id: "phone",
    autocomplete: ["tel", "tel-national"],
    names: [["phone"], ["mobile"], ["telephone"], ["tel"], ["phone", "number"], ["cell"]],
    keywords: ["phone", "mobile", "telephone", "cell", "phone number", "contact number"],
    negatives: ["country code", "dial code", "extension", "ext", "reference", "emergency", "type"],
    inputType: "tel",
    path: "personal.phone",
    multi: true
  },
  {
    id: "phoneCountryCode",
    autocomplete: ["tel-country-code"],
    names: [["country", "code"], ["dial", "code"], ["phone", "code"], ["isd", "code"], ["tel", "country", "code"]],
    keywords: ["country code", "dialing code", "dialling code", "dial code", "isd code", "phone code"],
    negatives: ["country of", "country/region", "citizenship"],
    // Derived from personal.phone at fill time — see splitPhone().
    path: "personal.phoneCountryCode",
    multi: true
  },

  // ─── Links ───
  {
    id: "linkedin",
    names: [["linkedin"], ["linkedin", "url"], ["urls", "linkedin"], ["linked", "in"]],
    keywords: ["linkedin", "linkedin profile", "linkedin url"],
    path: "personal.linkedin",
    multi: true
  },
  {
    id: "github",
    names: [["github"], ["github", "url"], ["urls", "github"], ["git", "hub"]],
    keywords: ["github", "github profile", "github url"],
    path: "personal.github",
    multi: true
  },
  {
    id: "website",
    autocomplete: ["url"],
    names: [["website"], ["portfolio"], ["personal", "website"], ["urls", "portfolio"], ["blog"], ["url"]],
    keywords: ["portfolio", "website", "personal website", "personal site", "blog", "web page", "other url"],
    negatives: ["company", "employer", "linkedin", "github", "school", "university"],
    path: "personal.website",
    fallback: (p) => p.personal?.portfolio || null,
    multi: true
  },

  // ─── Address ───
  {
    id: "addressLine1",
    autocomplete: ["address-line1", "street-address"],
    names: [["address"], ["address", "line", "1"], ["street"], ["street", "address"], ["addressline1"]],
    keywords: ["address", "street address", "address line 1", "home address"],
    negatives: ["email", "e-mail", "ip", "web", "url", "line 2", "company", "employer"],
    path: "personal.address"
  },
  {
    id: "city",
    autocomplete: ["address-level2"],
    names: [["city"], ["town"], ["address", "city"], ["locality"]],
    keywords: ["city", "town", "city/town"],
    negatives: ["company", "employer", "school", "university"],
    path: "personal.city",
    fallback: (p) => (p.personal?.location || "").split(",")[0].trim() || null
  },
  {
    id: "state",
    autocomplete: ["address-level1"],
    names: [["state"], ["province"], ["region"], ["state", "province"]],
    keywords: ["state", "province", "region", "state/province"],
    negatives: ["united states", "employer", "school"],
    path: "personal.state"
  },
  {
    id: "postalCode",
    autocomplete: ["postal-code"],
    names: [["zip"], ["postal", "code"], ["zipcode"], ["postcode"], ["postal"]],
    keywords: ["zip", "postal code", "zip code", "postcode"],
    path: "personal.postalCode"
  },
  {
    id: "country",
    autocomplete: ["country", "country-name"],
    names: [["country"], ["country", "region"], ["nation"]],
    keywords: ["country", "country/region", "nationality"],
    negatives: ["code", "phone"],
    path: "personal.country"
  },
  {
    id: "location",
    names: [["location"], ["current", "location"], ["residence"], ["based"]],
    keywords: ["location", "current location", "where are you located", "where are you based", "current city"],
    negatives: ["company", "employer", "school", "university", "job", "office", "preferred", "willing"],
    path: "personal.location"
  },

  // ─── Work authorization ───
  {
    id: "authorizedToWork",
    names: [["work", "authorization"], ["authorized"], ["eligibility"], ["legal", "right"], ["work", "auth"]],
    keywords: [
      "authorized to work", "work authorization", "legally authorized", "eligible to work",
      "legal right to work", "employment eligibility", "right to work", "authorised to work"
    ],
    path: "personal.authorizedToWork",
    multi: true
  },
  {
    id: "sponsorship",
    names: [["sponsorship"], ["visa", "sponsorship"], ["require", "sponsorship"], ["need", "sponsorship"]],
    keywords: [
      "sponsorship", "visa sponsorship", "require sponsorship", "need sponsorship",
      "immigration sponsorship", "will you now or in the future require"
    ],
    path: "personal.sponsorshipRequired",
    multi: true
  },
  {
    id: "visaStatus",
    names: [["visa", "status"], ["immigration", "status"], ["citizenship", "status"], ["work", "permit"]],
    keywords: ["visa status", "immigration status", "citizenship status", "work permit", "employment authorization"],
    path: "personal.visaStatus",
    multi: true
  },

  // ─── Education ───
  {
    id: "university",
    names: [["school"], ["university"], ["college"], ["institution"], ["school", "name"]],
    keywords: ["university", "school", "college", "institution", "school name", "university name", "alma mater"],
    negatives: ["high school", "secondary", "company", "employer"],
    section: "education",
    path: "education[0].school"
  },
  {
    id: "degree",
    names: [["degree"], ["degree", "type"], ["education", "level"], ["qualification"]],
    keywords: ["degree", "degree type", "level of education", "education level", "highest degree", "qualification"],
    section: "education",
    path: "education[0].degree"
  },
  {
    id: "fieldOfStudy",
    names: [["major"], ["field", "of", "study"], ["discipline"], ["specialization"], ["concentration"]],
    keywords: ["major", "field of study", "area of study", "discipline", "concentration", "specialization"],
    section: "education",
    path: "education[0].fieldOfStudy"
  },
  {
    id: "gpa",
    names: [["gpa"], ["cgpa"], ["grade", "point"], ["cumulative", "gpa"]],
    keywords: ["gpa", "grade point", "cgpa", "cumulative gpa", "academic score"],
    section: "education",
    path: "education[0].gpa"
  },
  {
    id: "graduationDate",
    names: [["graduation", "date"], ["graduation", "year"], ["expected", "graduation"], ["completion", "date"], ["end", "date"]],
    keywords: ["graduation date", "expected graduation", "graduation year", "completion date", "end date", "to"],
    negatives: ["work", "job", "employment", "company", "start"],
    section: "education",
    isDate: true,
    path: "education[0].endDate"
  },
  {
    id: "educationStartDate",
    names: [["start", "date"], ["from"], ["attended", "from"]],
    keywords: ["start date", "from", "attended from", "date started"],
    negatives: ["work", "job", "employment", "company", "available", "earliest"],
    section: "education",
    isDate: true,
    path: "education[0].startDate"
  },

  // ─── Experience ───
  {
    id: "company",
    names: [["company"], ["employer"], ["organization"], ["org"], ["company", "name"], ["current", "employer"]],
    keywords: ["company", "employer", "organization", "company name", "current employer", "most recent employer"],
    negatives: ["school", "university", "college", "reference", "why", "about"],
    section: "experience",
    path: "experience[0].company"
  },
  {
    id: "jobTitle",
    names: [["job", "title"], ["title"], ["position"], ["role"], ["designation"], ["current", "title"]],
    keywords: ["job title", "title", "position", "role", "current title", "current position", "designation"],
    negatives: ["degree", "school", "university", "name", "job posting", "applying", "desired", "requisition"],
    section: "experience",
    path: "experience[0].title"
  },

  // ─── Free text ───
  {
    id: "summary",
    names: [["summary"], ["bio"], ["about"], ["objective"], ["headline"], ["personal", "statement"]],
    keywords: [
      "summary", "bio", "about you", "about yourself", "professional summary",
      "personal statement", "objective", "tell us about yourself", "headline", "introduction"
    ],
    path: "summary"
  },
  {
    id: "skills",
    names: [["skills"], ["technical", "skills"], ["competencies"], ["technologies"]],
    keywords: ["skills", "technical skills", "key skills", "competencies", "technologies", "proficiencies"],
    path: "skills"
  },

  // ─── Common application questions ───
  {
    id: "salaryExpectation",
    names: [["salary"], ["expected", "salary"], ["compensation"], ["desired", "salary"], ["expected", "ctc"]],
    keywords: [
      "salary", "expected salary", "salary expectation", "desired salary",
      "compensation", "pay expectation", "expected ctc"
    ],
    path: "customFields.salaryExpectation"
  },
  {
    id: "startDate",
    autocomplete: [],
    names: [["start", "date"], ["availability"], ["earliest", "start"], ["available", "date"], ["notice", "period"]],
    keywords: [
      "start date", "earliest start", "available to start", "availability",
      "when can you start", "notice period"
    ],
    negatives: ["school", "university", "education", "employment start", "previous"],
    path: "customFields.startDate"
  },
  {
    id: "yearsOfExperience",
    names: [["years", "experience"], ["years", "of", "experience"], ["total", "experience"], ["experience", "years"]],
    keywords: ["years of experience", "total experience", "how many years", "years experience"],
    path: "customFields.yearsOfExperience"
  },
  {
    id: "referral",
    names: [["referral"], ["referred", "by"], ["source"], ["how", "did", "you", "hear"]],
    keywords: ["referral", "referred by", "how did you hear", "hear about us", "how did you find"],
    path: "customFields.referral"
  },
  {
    id: "pronouns",
    names: [["pronouns"], ["preferred", "pronouns"]],
    keywords: ["pronouns", "preferred pronouns"],
    path: "customFields.pronouns"
  },

  // ─── Sensitive / EEO ───
  // Only filled when you have explicitly stored an answer; see isSensitive().
  {
    id: "gender",
    autocomplete: ["sex"],
    names: [["gender"], ["sex"], ["gender", "identity"]],
    keywords: ["gender", "sex", "gender identity"],
    path: "customFields.gender",
    sensitive: true
  },
  {
    id: "ethnicity",
    names: [["race"], ["ethnicity"], ["ethnic", "background"], ["racial"]],
    keywords: ["race", "ethnicity", "ethnic background", "race/ethnicity"],
    path: "customFields.ethnicity",
    sensitive: true
  },
  {
    id: "veteranStatus",
    names: [["veteran"], ["veteran", "status"], ["military"]],
    keywords: ["veteran", "veteran status", "protected veteran", "military service"],
    path: "customFields.veteranStatus",
    sensitive: true
  },
  {
    id: "disabilityStatus",
    names: [["disability"], ["disability", "status"]],
    keywords: ["disability", "disability status", "disabled"],
    path: "customFields.disabilityStatus",
    sensitive: true
  }
];

export const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));

// A rule whose path carries an index can be satisfied once per repeated block —
// three education cards on a form are three legitimate "School" fields, not one
// correct field and two impostors.
for (const r of RULES) r.indexable = /\[0\]/.test(r.path || "");

/**
 * Stable identity for a field across sites, used by the correction feedback
 * loop. Deliberately excludes the host: correcting "Location" on one board
 * should inform the same question on the next.
 */
export function fieldKey(field) {
  return normalizeKey(field.label || field.name || field.id || "");
}

/**
 * The normalisation behind every key this extension stores a value under.
 *
 * Exported because the learned map and the correction log have to agree on it:
 * a value remembered under one spelling of a question and looked up under
 * another is a value that is never reused. "E-mail address *" and "E-mail
 * Address" are the same question and must produce the same key.
 */
export function normalizeKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// ATS adapters
//
// These platforms use stable, documented attributes. A direct hit here is worth
// more than any amount of label guessing, and it is a single dictionary lookup.
// ─────────────────────────────────────────────────────────────────────────────

export const ATS_BY_NAME = {
  // Greenhouse
  "job_application[first_name]": "firstName",
  "job_application[last_name]": "lastName",
  "job_application[email]": "email",
  "job_application[phone]": "phone",
  "job_application[urls][LinkedIn]": "linkedin",
  "job_application[urls][GitHub]": "github",
  "job_application[urls][Portfolio]": "website",
  "job_application[urls][Website]": "website",
  first_name: "firstName",
  last_name: "lastName",

  // Lever
  name: "fullName",
  email: "email",
  phone: "phone",
  org: "company",
  "urls[LinkedIn]": "linkedin",
  "urls[Github]": "github",
  "urls[GitHub]": "github",
  "urls[Portfolio]": "website",
  "urls[Other]": "website",

  // Workable
  firstname: "firstName",
  lastname: "lastName",
  headline: "summary",

  // SmartRecruiters / generic camelCase
  firstName: "firstName",
  lastName: "lastName",
  phoneNumber: "phone",
  emailAddress: "email"
};

export const ATS_BY_ID = {
  // Greenhouse
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  phone: "phone",

  // Ashby
  _systemfield_name: "fullName",
  _systemfield_email: "email",
  _systemfield_phone: "phone",

  // Taleo / iCIMS
  quickApplyFirstName: "firstName",
  quickApplyLastName: "lastName",
  quickApplyEmail: "email"
};

// Workday — data-automation-id
export const ATS_BY_AUTOMATION_ID = {
  legalNameSection_firstName: "firstName",
  legalNameSection_lastName: "lastName",
  legalNameSection_middleName: "middleName",
  email: "email",
  "phone-number": "phone",
  phoneNumber: "phone",
  addressSection_addressLine1: "addressLine1",
  addressSection_city: "city",
  addressSection_countryRegion: "country",
  addressSection_postalCode: "postalCode",
  addressSection_regionSubdivision1: "state",
  "source--source": "referral",
  formField_sourcePrompt: "referral"
};

/** File inputs that should receive the resume. */
export const RESUME_HINTS = /resume|c\.?v\.?\b|curriculum\s*vitae/i;
export const COVER_LETTER_HINTS = /cover\s*letter|motivation\s*letter/i;

/** Uploads that are emphatically not a resume, however the page words them. */
const NOT_RESUME_UPLOAD = /photo|head\s*shot|headshot|avatar|profile\s*(picture|image)|logo|passport|visa\s*copy|id\s*(card|proof)|certificate|transcript|portfolio\s*image|signature/i;

/** Section headings that mean "this block is not about you". */
export const FOREIGN_SECTION = /\breference|emergency\s*contact|guardian|next\s*of\s*kin|previous\s*employer|referee/i;

// ─────────────────────────────────────────────────────────────────────────────
// Resume upload targeting
//
// Kept here, away from the DOM, because deciding *which* upload box gets the
// resume is the part that goes wrong — and the part worth testing. The scanner
// hands over descriptors; this decides, and index.js only does the injecting.
// ─────────────────────────────────────────────────────────────────────────────

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text"
};

/**
 * Would this input take our file, going by its own `accept` list?
 *
 * A photo upload declaring `accept="image/*"` sits on plenty of application
 * forms. Assigning a PDF to it "succeeds" — nothing validates a scripted
 * assignment — and the site then rejects the submission with an error the user
 * has to work out for themselves. Reading `accept` first avoids that entirely.
 */
export function acceptAllows(accept, fileName = "resume.pdf") {
  const list = String(accept || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;                       // no restriction stated

  const dot = String(fileName).lastIndexOf(".");
  const ext = dot > -1 ? String(fileName).slice(dot).toLowerCase() : "";
  const mime = MIME_BY_EXT[ext] || "";

  return list.some((a) => {
    if (a === "*" || a === "*/*") return true;
    if (a.startsWith(".")) return a === ext;
    if (a.endsWith("/*")) return !!mime && mime.startsWith(a.slice(0, -1));
    return !!mime && a === mime;
  });
}

/**
 * Choose the upload boxes that should receive the resume.
 *
 * @param {Array} fields   scanner descriptors, any kind — non-file ones are ignored
 * @param {string} fileName  the stored resume's name, for the `accept` check
 * @returns {Array} the descriptors to fill, in page order
 *
 * The rules, in order of how much they are trusted:
 *
 *  1. A box that says "resume" or "CV" is the resume box, even if the page also
 *     has others. Every explicit one is filled — Workday asks twice on some
 *     tenants, once on the upload step and again on the review step.
 *  2. Otherwise, a lone remaining upload on an application form is the resume in
 *     practice. This is the case that matters most in the wild: the real
 *     <input type=file> behind a styled "Attach" button routinely carries no
 *     label, no name and no id worth reading.
 *  3. With several unlabelled boxes and nothing to tell them apart, fill none.
 *     Putting a resume into the box meant for a portfolio or a photo is worse
 *     than leaving one click for the user.
 */
export function pickResumeTargets(fields, fileName = "resume.pdf") {
  const candidates = [];

  for (const f of fields) {
    if (!f || f.kind !== "file" || f.filled) continue;

    const hay = `${f.rawLabel || f.label || ""} ${f.name || ""} ${f.id || ""} ` +
                `${f.uploadContext || ""} ${f.className || ""}`;

    const isResume = RESUME_HINTS.test(hay);
    // A cover-letter box is claimed by the letter writer, not by us — unless the
    // page words it as one control for both ("Resume / Cover letter").
    if (!isResume && COVER_LETTER_HINTS.test(hay)) continue;
    if (!isResume && NOT_RESUME_UPLOAD.test(hay)) continue;
    if (!acceptAllows(f.accept, fileName)) continue;

    candidates.push({ field: f, isResume });
  }

  const explicit = candidates.filter((c) => c.isResume);
  if (explicit.length) return explicit.map((c) => c.field);
  return candidates.length === 1 ? [candidates[0].field] : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

/** "job_application[first_name]" / "firstName" -> ["first","name"] */
export function tokenize(s) {
  return String(s || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does `seq` appear as a contiguous run inside `tokens`? */
function hasSeq(tokens, seq) {
  if (seq.length > tokens.length) return false;
  outer: for (let i = 0; i <= tokens.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (tokens[i + j] !== seq[j]) continue outer;
    }
    return true;
  }
  return false;
}

function scoreLabel(rule, label) {
  if (!label) return 0;
  let best = 0;
  for (const kw of rule.keywords || []) {
    if (label === kw) return S.LABEL_EXACT;
    if (label.includes(kw)) {
      // Longer, more specific phrases are stronger evidence than single words:
      // "expected graduation date" beating a bare "date" is the whole point.
      const words = kw.split(/\s+/).length;
      best = Math.max(best, S.LABEL_PHRASE + Math.min(words * 8, 24));
    }
  }
  return best;
}

/**
 * Score one field against one rule. Returns 0 when the rule is disqualified.
 *
 * `field` is the descriptor produced by the scanner:
 *   { label, name, id, type, placeholder, autocomplete, automationId,
 *     nameTokens, section }
 */
export function scoreField(rule, field) {
  const label = field.label || "";

  // Hard disqualifiers — checked against label *and* attribute tokens so that
  // name="confirm_email" is rejected for the plain email rule even when the
  // visible label is just "Email".
  if (rule.negatives) {
    const hay = `${label} ${field.name} ${field.id}`.toLowerCase();
    for (const neg of rule.negatives) {
      if (hay.includes(neg)) return 0;
    }
  }

  let score = 0;

  // 1. ATS attribute — decisive.
  if (field.atsField) {
    return field.atsField === rule.id ? S.ATS : 0;
  }

  // 2. autocomplete attribute — the spec's own answer to this exact problem.
  if (field.autocomplete && rule.autocomplete?.length) {
    // Handles section/shipping prefixes: "shipping address-level2".
    const tokens = field.autocomplete.toLowerCase().split(/\s+/);
    for (const ac of rule.autocomplete) {
      if (tokens.includes(ac)) return S.AUTOCOMPLETE;
    }
  }

  // 3. name / id token patterns.
  const nt = field.nameTokens;
  if (nt && nt.length && rule.names) {
    const joined = nt.join(" ");
    for (const seq of rule.names) {
      const pat = seq.join(" ");
      if (joined === pat) { score = Math.max(score, S.NAME_EXACT); break; }
      if (hasSeq(nt, seq)) score = Math.max(score, S.NAME_SEQ);
    }
  }

  // 4. Visible label.
  score = Math.max(score, scoreLabel(rule, label));

  // 5. Input type.
  if (rule.inputType && field.type === rule.inputType) {
    score = Math.max(score, S.INPUT_TYPE);
  }

  // 6. Placeholder — weakest signal, only if nothing better landed.
  if (score === 0 && field.placeholder && rule.keywords) {
    const ph = field.placeholder.toLowerCase();
    for (const kw of rule.keywords) {
      if (ph.includes(kw)) { score = S.PLACEHOLDER; break; }
    }
  }

  if (score === 0) return 0;

  // 7. Section context. A "School" input under an "Employment" heading is
  //    almost certainly not your university.
  if (rule.section && field.section) {
    score += field.section === rule.section ? S.SECTION_BONUS : S.SECTION_PENALTY;
  }

  return score;
}

/**
 * Penalty applied to a (field, rule) pair the user has previously overridden.
 *
 * Sized so that only spec-grade evidence survives a correction: an ATS attribute
 * (98) or an `autocomplete` token (96) still clears MIN_SCORE afterwards, while
 * a name match (88) or a label match (84) does not. Correcting a field should
 * settle it, but not against the one signal the page states outright.
 */
export const DEMOTION = 60;

/**
 * Globally assign rules to fields.
 *
 * Every (field, rule) pair above MIN_SCORE is ranked, then claimed greedily.
 * Each field takes at most one rule; ties break toward the earlier field so
 * forms fill top-down.
 *
 * Slot accounting is per repeated block. A plain rule holds one slot for the
 * whole form; an indexable rule holds one slot per `field.instance`, so a form
 * with three education cards fills all three rather than only the first.
 *
 * @param opts.skipSensitive  withhold EEO rules unless an answer is stored
 * @param opts.hasAnswerFor   (ruleId) => boolean
 * @param opts.isDemoted      (field, ruleId) => boolean, from past corrections
 *
 * Returns Map<fieldIndex, { ruleId, score, instance }>.
 */
export function assign(fields, opts = {}) {
  const pairs = [];

  for (let fi = 0; fi < fields.length; fi++) {
    const field = fields[fi];
    if (field.skip) continue;

    for (const rule of RULES) {
      if (rule.sensitive && opts.skipSensitive && !opts.hasAnswerFor?.(rule.id)) continue;

      let score = scoreField(rule, field);
      if (score < MIN_SCORE) continue;

      // You corrected this pairing before. Demote rather than forbid, so a
      // strong signal (an ATS attribute) can still win where a weak label
      // match no longer can.
      if (opts.isDemoted?.(field, rule.id)) {
        score -= DEMOTION;
        if (score < MIN_SCORE) continue;
      }

      pairs.push({ fi, ruleId: rule.id, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score || a.fi - b.fi);

  const out = new Map();
  const usedSlots = new Set();

  for (const p of pairs) {
    if (out.has(p.fi)) continue;
    const rule = RULE_BY_ID.get(p.ruleId);
    const field = fields[p.fi];
    const instance = field.instance || 0;
    // Scoped by repeat group as well as index: two independent repeaters on one
    // page each count from zero, and must not consume each other's slots.
    const slot = rule.indexable ? `${p.ruleId}#${field.repeatGroup || 0}:${instance}` : p.ruleId;

    if (!rule.multi && usedSlots.has(slot)) continue;
    out.set(p.fi, { ruleId: p.ruleId, score: p.score, instance });
    usedSlots.add(slot);
  }

  return out;
}
