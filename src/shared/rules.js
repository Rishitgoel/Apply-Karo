import { canonicalQuestion, contextualKey } from "./field-identity.js";
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
    id: "preferredName",
    names: [["preferred", "name"], ["nickname"], ["chosen", "name"], ["preferred", "first", "name"]],
    keywords: ["preferred name", "chosen name", "nickname", "preferred first name", "goes by"],
    negatives: ["legal first name", "last name", "surname"],
    path: "personal.preferredName",
    fallback: (p) => p.personal?.firstName || null
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
    id: "addressLine2",
    autocomplete: ["address-line2"],
    names: [["address", "line", "2"], ["address", "2"], ["apt"], ["suite"], ["unit"], ["building"], ["addressline2"]],
    keywords: ["address line 2", "address 2", "apt", "suite", "unit", "building", "apartment"],
    negatives: ["address line 1", "street address"],
    path: "personal.addressLine2",
    fallback: (p) => p.customFields?.addressLine2 || null
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
      "legal right to work", "employment eligibility", "right to work", "authorised to work",
      "are you legally authorized", "are you authorized", "work authorization status"
    ],
    path: "personal.authorizedToWork",
    multi: true
  },
  {
    id: "sponsorship",
    names: [["sponsorship"], ["visa", "sponsorship"], ["require", "sponsorship"], ["need", "sponsorship"]],
    keywords: [
      "sponsorship", "visa sponsorship", "require sponsorship", "need sponsorship",
      "immigration sponsorship", "will you now or in the future require",
      "require visa sponsorship", "visa sponsorship requirement", "do you require sponsorship"
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
    keywords: [
      "degree", "degree type", "level of education", "education level", "highest degree",
      "highest level of education", "degree level", "qualification"
    ],
    section: "education",
    path: "education[0].degree"
  },
  {
    id: "fieldOfStudy",
    names: [["major"], ["field", "of", "study"], ["discipline"], ["specialization"], ["specialisation"], ["concentration"]],
    keywords: ["major", "field of study", "area of study", "discipline", "concentration", "specialization", "specialisation"],
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
    negatives: ["degree", "school", "university", "name", "job posting", "applying", "desired", "requisition", "salutation", "prefix", "honorific", "mr", "mrs", "ms"],
    section: "experience",
    indexable: true,
    path: "experience[0].title"
  },
  {
    id: "experienceLocation",
    names: [["company", "location"], ["job", "location"], ["employer", "location"], ["work", "location"]],
    keywords: ["company location", "employer location", "job location", "work location", "office location"],
    negatives: ["school", "university", "college", "home", "current location", "residence"],
    section: "experience",
    indexable: true,
    path: "experience[0].location"
  },
  {
    id: "experienceStartDate",
    names: [["start", "date"], ["from"], ["date", "started"], ["from", "date"], ["start", "month"], ["start", "year"]],
    keywords: ["start date", "from", "date started", "employment start", "start month", "start year"],
    negatives: ["school", "university", "education", "available", "earliest", "notice", "to", "end"],
    section: "experience",
    isDate: true,
    indexable: true,
    path: "experience[0].startDate"
  },
  {
    id: "experienceEndDate",
    names: [["end", "date"], ["to"], ["date", "ended"], ["to", "date"], ["end", "month"], ["end", "year"], ["completion", "date"]],
    keywords: ["end date", "to", "date ended", "employment end", "end month", "end year", "until"],
    negatives: ["school", "university", "education", "graduation", "from", "start"],
    section: "experience",
    isDate: true,
    indexable: true,
    path: "experience[0].endDate"
  },
  {
    id: "currentJob",
    names: [["current"], ["current", "job"], ["currently", "work"], ["present"], ["current", "role"]],
    keywords: [
      "i currently work here", "currently work here", "current employer", "current job",
      "current role", "present employer", "i currently work in this role", "is this your current job"
    ],
    section: "experience",
    indexable: true,
    path: "experience[0].current"
  },
  {
    id: "experienceDescription",
    names: [["description"], ["responsibilities"], ["duties"], ["summary"], ["role", "description"], ["work", "summary"]],
    keywords: [
      "description", "responsibilities", "role description", "summary of duties",
      "work description", "key responsibilities", "duties", "job description"
    ],
    negatives: ["company", "employer", "school", "project", "education"],
    section: "experience",
    indexable: true,
    path: "experience[0].description"
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
    names: [["start", "date"], ["availability"], ["earliest", "start"], ["available", "date"]],
    keywords: [
      "start date", "earliest start", "available to start", "availability",
      "when can you start"
    ],
    negatives: ["school", "university", "education", "employment start", "previous", "notice period", "notice"],
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
    keywords: [
      "referral", "referred by", "how did you hear", "hear about us", "how did you find",
      "how did you hear about this opportunity", "job board", "source"
    ],
    path: "customFields.referral"
  },
  {
    id: "pronouns",
    names: [["pronouns"], ["preferred", "pronouns"]],
    keywords: ["pronouns", "preferred pronouns"],
    path: "customFields.pronouns"
  },
  {
    id: "phoneType",
    names: [["phone", "type"], ["phone", "device", "type"], ["device", "type"]],
    keywords: ["phone type", "phone device type", "device type", "type of phone"],
    path: "customFields.phoneType",
    fallback: () => "Mobile"
  },
  {
    id: "willingToRelocate",
    names: [["relocate"], ["willing", "relocate"], ["relocation"], ["open", "relocation"]],
    keywords: ["willing to relocate", "relocate", "relocation", "open to relocation", "are you willing to relocate"],
    path: "customFields.willingToRelocate",
    fallback: () => "Yes"
  },
  {
    id: "workLocationPreference",
    names: [["workplace", "type"], ["remote"], ["hybrid"], ["work", "location"], ["work", "model"]],
    keywords: ["workplace preference", "work location preference", "remote/hybrid", "work model", "work arrangement"],
    path: "customFields.workLocationPreference"
  },
  {
    id: "legalAge",
    names: [["legal", "age"], ["18", "older"], ["over", "18"], ["age", "18"]],
    keywords: ["are you 18", "18 years of age or older", "18 or older", "at least 18", "legal age to work", "are you at least 18"],
    path: "customFields.legalAge",
    fallback: () => "Yes"
  },
  {
    id: "formerEmployee",
    names: [["former", "employee"], ["previously", "employed"], ["worked", "before"], ["prior", "employee"]],
    keywords: ["previously employed", "former employee", "have you worked here", "worked for us before", "have you ever worked for", "prior employee"],
    path: "customFields.formerEmployee",
    fallback: () => "No"
  },
  {
    id: "relativeEmployed",
    names: [["relatives"], ["family", "employed"], ["conflict", "interest"]],
    keywords: ["relatives", "family member", "any relatives", "family employed", "conflict of interest"],
    path: "customFields.relativeEmployed",
    fallback: () => "No"
  },
  {
    id: "noticePeriod",
    names: [["notice", "period"], ["days", "notice"], ["how", "soon", "start"]],
    keywords: ["notice period", "days notice", "how much notice", "official notice period", "how soon can you start"],
    path: "customFields.noticePeriod",
    fallback: (p) => p.customFields?.noticePeriod || p.customFields?.startDate || "Immediately"
  },
  {
    id: "twitter",
    names: [["twitter"], ["twitter", "url"], ["x", "profile"], ["x", "com"]],
    keywords: ["twitter", "twitter profile", "twitter url", "x profile"],
    path: "personal.twitter",
    fallback: (p) => p.customFields?.twitter || null,
    multi: true
  },
  {
    id: "citizenship",
    names: [["citizenship"], ["country", "citizenship"], ["primary", "citizenship"]],
    keywords: ["citizenship", "country of citizenship", "primary citizenship", "citizen of"],
    path: "customFields.citizenship",
    fallback: (p) => p.personal?.country || null
  },
  {
    id: "currentSalary",
    names: [["current", "salary"], ["current", "ctc"], ["current", "compensation"]],
    keywords: ["current salary", "current ctc", "current compensation", "present salary"],
    path: "customFields.currentSalary"
  },
  {
    id: "salutation",
    names: [["salutation"], ["prefix"], ["title"], ["honorific"]],
    keywords: ["salutation", "prefix", "personal title", "honorific", "mr/ms/mrs"],
    negatives: ["job", "position", "current", "company", "degree", "school", "posting", "role"],
    path: "customFields.salutation",
    fallback: () => "Mr."
  },
  {
    id: "consent",
    names: [["consent"], ["certify"], ["terms"], ["privacy"], ["acknowledgment"], ["declaration"], ["agreement"], ["attestation"]],
    keywords: [
      "i certify", "i agree", "consent", "terms and conditions", "privacy policy", "data privacy",
      "acknowledge and agree", "i acknowledge", "certify that the information", "accurate and complete",
      "terms of use", "declaration", "attestation", "applicant statement", "electronic signature agreement"
    ],
    path: "customFields.consent",
    fallback: () => "Yes"
  },
  {
    id: "backgroundCheck",
    names: [["background", "check"], ["background", "screening"], ["screening", "consent"], ["drug", "test"], ["drug", "screening"]],
    keywords: [
      "background check", "background screening", "willing to undergo a background check",
      "pre-employment background check", "drug screening", "drug test", "background investigation"
    ],
    path: "customFields.backgroundCheck",
    fallback: () => "Yes"
  },
  {
    id: "travelPreference",
    names: [["travel"], ["willing", "travel"], ["travel", "percentage"], ["travel", "requirement"]],
    keywords: [
      "willing to travel", "travel requirement", "travel percentage", "travel willingness", "open to travel"
    ],
    path: "customFields.travelPreference",
    fallback: () => "Yes"
  },
  {
    id: "driversLicense",
    names: [["driver", "license"], ["drivers", "license"], ["driving", "license"]],
    keywords: ["driver's license", "drivers license", "valid driver's license", "driving license"],
    path: "customFields.driversLicense",
    fallback: () => "Yes"
  },
  {
    id: "securityClearance",
    names: [["security", "clearance"], ["clearance"], ["clearance", "level"]],
    keywords: ["security clearance", "clearance level", "active security clearance", "possess a security clearance"],
    path: "customFields.securityClearance",
    fallback: () => "No"
  },
  {
    id: "signature",
    names: [["signature"], ["electronic", "signature"], ["applicant", "signature"], ["sign", "name"], ["e", "signature"], ["digital", "signature"]],
    keywords: [
      "electronic signature", "signature", "applicant signature", "sign your name",
      "type your full legal name", "type your full name", "type your name",
      "typed signature", "digital signature", "please sign", "signature of applicant"
    ],
    negatives: ["date", "time", "day", "month", "year"],
    path: "personal.fullName",
    fallback: (p) => (p.personal?.fullName || `${p.personal?.firstName || ""} ${p.personal?.lastName || ""}`.trim()) || null
  },
  {
    id: "signatureDate",
    names: [["signature", "date"], ["date", "signed"], ["today", "date"], ["current", "date"], ["agreement", "date"]],
    keywords: ["signature date", "date signed", "date of signature", "today's date", "todays date", "current date"],
    path: "customFields.signatureDate",
    fallback: () => new Date().toISOString().split("T")[0],
    isDate: true
  },
  {
    id: "nonCompete",
    names: [["non", "compete"], ["restrictive", "covenant"], ["non", "disclosure", "agreement"], ["noncompete"]],
    keywords: [
      "non-compete", "non compete", "restrictive covenant", "non-compete agreement",
      "subject to a non-compete", "bound by any non-compete", "restrictive covenants"
    ],
    path: "customFields.nonCompete",
    fallback: () => "No"
  },
  {
    id: "governmentOfficial",
    names: [["government", "official"], ["public", "official"], ["politically", "exposed"]],
    keywords: ["government official", "public official", "are you a government official", "related to a government official"],
    path: "customFields.governmentOfficial",
    fallback: () => "No"
  },
  {
    id: "reliableTransportation",
    names: [["transportation"], ["reliable", "transportation"], ["valid", "transportation"]],
    keywords: ["reliable transportation", "access to reliable transportation", "reliable means of transportation"],
    path: "customFields.reliableTransportation",
    fallback: () => "Yes"
  },
  {
    id: "criminalRecord",
    names: [["felony"], ["criminal", "conviction"], ["convicted"]],
    keywords: ["convicted of a felony", "criminal conviction", "have you ever been convicted", "felony conviction"],
    path: "customFields.criminalRecord",
    fallback: () => "No"
  },
  {
    id: "suffix",
    names: [["suffix"], ["name", "suffix"]],
    keywords: ["suffix", "name suffix", "generation suffix", "jr/sr"],
    negatives: ["first", "last", "middle"],
    path: "personal.suffix",
    fallback: (p) => p.customFields?.suffix || null
  },
  {
    id: "county",
    names: [["county"], ["district"], ["parish"]],
    keywords: ["county", "parish"],
    negatives: ["country"],
    path: "customFields.county"
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
    id: "hispanicLatino",
    names: [["hispanic"], ["latino"], ["hispanic", "latino"]],
    keywords: ["are you hispanic or latino", "hispanic or latino", "hispanic/latino", "hispanic origin"],
    path: "customFields.hispanicLatino",
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
  return contextualKey(field);
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
  return canonicalQuestion(s);
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
  "job_application[preferred_name]": "preferredName",
  "job_application[email]": "email",
  "job_application[phone]": "phone",
  "job_application[location]": "location",
  "job_application[address_line_2]": "addressLine2",
  "job_application[urls][LinkedIn]": "linkedin",
  "job_application[urls][GitHub]": "github",
  "job_application[urls][Portfolio]": "website",
  "job_application[urls][Website]": "website",
  "job_application[urls][Twitter]": "twitter",
  "job_application[urls][Other]": "website",
  "job_application[gender]": "gender",
  "job_application[race]": "ethnicity",
  "job_application[veteran_status]": "veteranStatus",
  "job_application[disability_status]": "disabilityStatus",
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
  "urls[Twitter]": "twitter",
  "urls[Other]": "website",
  comments: "summary",
  additional_information: "summary",

  // Workable
  firstname: "firstName",
  lastname: "lastName",
  headline: "summary",

  // SmartRecruiters / generic camelCase
  firstName: "firstName",
  lastName: "lastName",
  phoneNumber: "phone",
  emailAddress: "email",
  title: "salutation",
  salutation: "salutation",
  consent: "consent",
  terms: "consent",
  background_check: "backgroundCheck",
  "job_application[signature]": "signature",
  "job_application[e_signature]": "signature",
  "job_application[signature_date]": "signatureDate",
  "job_application[date]": "signatureDate",
  signature: "signature",
  e_signature: "signature",
  electronic_signature: "signature",
  signature_date: "signatureDate",
  non_compete: "nonCompete",
  hispanic_latino: "hispanicLatino",
  "job_application[job_title]": "jobTitle",
  "job_application[company_name]": "company",
  reliable_transportation: "reliableTransportation"
};

export const ATS_BY_ID = {
  // Greenhouse
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  phone: "phone",
  signature: "signature",
  electronic_signature: "signature",
  e_signature: "signature",

  // Ashby
  _systemfield_name: "fullName",
  _systemfield_preferred_name: "preferredName",
  _systemfield_email: "email",
  _systemfield_phone: "phone",
  _systemfield_company: "company",
  _systemfield_title: "jobTitle",
  _systemfield_location: "location",
  _systemfield_address: "addressLine1",
  _systemfield_city: "city",
  _systemfield_postal_code: "postalCode",
  _systemfield_country: "country",
  _systemfield_linkedin: "linkedin",
  _systemfield_github: "github",
  _systemfield_portfolio: "website",
  _systemfield_website: "website",

  // Taleo / iCIMS
  quickApplyFirstName: "firstName",
  quickApplyLastName: "lastName",
  quickApplyEmail: "email"
};

// Workday — data-automation-id
export const ATS_BY_AUTOMATION_ID = {
  legalNameSection_title: "salutation",
  legalNameSection_firstName: "firstName",
  legalNameSection_lastName: "lastName",
  legalNameSection_middleName: "middleName",
  legalNameSection_preferredName: "preferredName",
  legalNameSection_suffix: "suffix",
  email: "email",
  "phone-number": "phone",
  phoneNumber: "phone",
  phoneDeviceType: "phoneType",
  "phone-device-type": "phoneType",
  addressSection_addressLine1: "addressLine1",
  addressSection_addressLine2: "addressLine2",
  addressSection_city: "city",
  addressSection_countryRegion: "country",
  addressSection_postalCode: "postalCode",
  addressSection_county: "county",
  addressSection_regionSubdivision1: "state",
  "source--source": "referral",
  formField_sourcePrompt: "referral",
  yearsOfExperience: "yearsOfExperience",
  workAuthorization: "authorizedToWork",
  legallyAuthorized: "authorizedToWork",
  candidateWorkAuthorization: "authorizedToWork",
  visaSponsorship: "sponsorship",
  requireSponsorship: "sponsorship",
  immigrationSponsorship: "sponsorship",
  citizenshipStatus: "citizenship",
  school: "university",
  degree: "degree",
  fieldOfStudy: "fieldOfStudy",
  gpa: "gpa",
  company: "company",
  jobTitle: "jobTitle",
  startDate: "startDate",
  jobHistoryItem_company: "company",
  jobHistoryItem_title: "jobTitle",
  jobHistoryItem_jobTitle: "jobTitle",
  jobHistoryItem_location: "experienceLocation",
  jobHistoryItem_startDate: "experienceStartDate",
  jobHistoryItem_endDate: "experienceEndDate",
  jobHistoryItem_currentlyWorkHere: "currentJob",
  jobHistoryItem_roleDescription: "experienceDescription",
  jobHistory_company: "company",
  jobHistory_title: "jobTitle",
  jobHistory_location: "experienceLocation",
  jobHistory_startDate: "experienceStartDate",
  jobHistory_endDate: "experienceEndDate",
  jobHistory_currentlyWorkHere: "currentJob",
  jobHistory_roleDescription: "experienceDescription",
  educationItem_school: "university",
  educationItem_degree: "degree",
  educationItem_fieldOfStudy: "fieldOfStudy",
  educationItem_startDate: "educationStartDate",
  educationItem_endDate: "graduationDate",
  educationItem_gpa: "gpa",
  education_school: "university",
  education_degree: "degree",
  education_fieldOfStudy: "fieldOfStudy",
  education_startDate: "educationStartDate",
  education_endDate: "graduationDate",
  education_gpa: "gpa",
  noticePeriod: "noticePeriod",
  willingToRelocate: "willingToRelocate",
  backgroundCheck: "backgroundCheck",
  termsAndConditions: "consent",
  electronicSignature: "signature",
  candidateSignature: "signature",
  signature_name: "signature",
  signature: "signature",
  dateSigned: "signatureDate",
  date_signed: "signatureDate",
  nonCompeteAgreement: "nonCompete",
  restrictiveCovenant: "nonCompete",
  governmentOfficial: "governmentOfficial",
  reliableTransportation: "reliableTransportation",
  hispanicLatino: "hispanicLatino",
  hispanicOrLatino: "hispanicLatino"
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
        if (opts.canMap && !opts.canMap(field, rule)) continue;
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
