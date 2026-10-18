// Matcher accuracy tests — run with:  node test/match.test.mjs
//
// Each case is a field descriptor shaped exactly as src/engine/scan.js emits
// one, drawn from the real markup of the platform named in the comment.

import { assign, tokenize, ATS_BY_NAME, ATS_BY_ID, ATS_BY_AUTOMATION_ID } from "../src/shared/rules.js";

/** Build a descriptor the way the scanner does, so tests exercise the real path. */
function field({ label = "", name = "", id = "", automationId = "", type = "text",
                 kind = "text", placeholder = "", autocomplete = "", section = null,
                 skip = false, options = null }) {
  const atsField =
    (automationId && ATS_BY_AUTOMATION_ID[automationId]) ||
    (name && ATS_BY_NAME[name]) ||
    (id && ATS_BY_ID[id]) || null;

  return {
    label: label.toLowerCase(), rawLabel: label,
    name, id, type, kind, placeholder, autocomplete,
    nameTokens: tokenize(`${name} ${id} ${automationId}`),
    atsField, section, skip, options
  };
}

const CASES = [
  // ── Greenhouse ──
  [{ label: "First Name *", name: "job_application[first_name]", id: "first_name" }, "firstName"],
  [{ label: "Last Name *", name: "job_application[last_name]", id: "last_name" }, "lastName"],
  [{ label: "Email *", name: "job_application[email]", id: "email", type: "email" }, "email"],
  [{ label: "Phone", name: "job_application[phone]", id: "phone", type: "tel" }, "phone"],
  [{ label: "LinkedIn Profile", name: "job_application[urls][LinkedIn]" }, "linkedin"],
  [{ label: "GitHub", name: "job_application[urls][GitHub]" }, "github"],

  // ── Lever ──
  [{ label: "Full name✱", name: "name" }, "fullName"],
  [{ label: "Email✱", name: "email", type: "email" }, "email"],
  [{ label: "Current company", name: "org" }, "company"],
  [{ label: "LinkedIn URL", name: "urls[LinkedIn]" }, "linkedin"],

  // ── Workday ──
  [{ label: "First Name", automationId: "legalNameSection_firstName" }, "firstName"],
  [{ label: "Last Name", automationId: "legalNameSection_lastName" }, "lastName"],
  [{ label: "Address Line 1", automationId: "addressSection_addressLine1" }, "addressLine1"],
  [{ label: "City", automationId: "addressSection_city" }, "city"],
  [{ label: "Postal Code", automationId: "addressSection_postalCode" }, "postalCode"],

  // ── Ashby ──
  [{ label: "Name", id: "_systemfield_name" }, "fullName"],
  [{ label: "Email", id: "_systemfield_email", type: "email" }, "email"],

  // ── Plain autocomplete attributes ──
  [{ label: "Given name", autocomplete: "given-name" }, "firstName"],
  [{ label: "Surname", autocomplete: "family-name" }, "lastName"],
  [{ label: "Town/City", autocomplete: "address-level2" }, "city"],
  [{ label: "State", autocomplete: "address-level1" }, "state"],
  [{ label: "ZIP", autocomplete: "postal-code" }, "postalCode"],
  [{ label: "Country", autocomplete: "country-name" }, "country"],

  // ── Disambiguation: these are what v1 got wrong ──
  [{ label: "Confirm Email Address", name: "confirm_email", type: "email" }, "emailConfirm"],
  [{ label: "Company Name", name: "company_name" }, "company"],
  [{ label: "School Name", name: "school", section: "education" }, "university"],
  [{ label: "Job Title", name: "current_title" }, "jobTitle"],
  [{ label: "Field of Study", name: "discipline", section: "education" }, "fieldOfStudy"],
  [{ label: "Expected Graduation Date", name: "grad_date", section: "education" }, "graduationDate"],

  // ── Common questions ──
  [{ label: "Desired Salary", name: "salary_expectation" }, "salaryExpectation"],
  [{ label: "How did you hear about us?", name: "source", kind: "select" }, "referral"],
  [{ label: "Earliest start date", name: "availability" }, "startDate"],
  [{ label: "Years of experience", name: "years_of_experience" }, "yearsOfExperience"],
  [{ label: "Portfolio / Website", name: "portfolio" }, "website"],

  // ── Radio groups: the question, not the answers ──
  [{ label: "Are you legally authorized to work in the United States?",
     kind: "radiogroup", name: "work_auth" }, "authorizedToWork"],
  [{ label: "Will you now or in the future require sponsorship for employment visa status?",
     kind: "radiogroup", name: "sponsorship" }, "sponsorship"],

  // ── ATS Standard Questions (Workday, Greenhouse, Ashby, Lever) ──
  [{ label: "Electronic Signature", automationId: "electronicSignature" }, "signature"],
  [{ label: "Date Signed", automationId: "dateSigned" }, "signatureDate"],
  [{ label: "Non-Compete Agreement", automationId: "nonCompeteAgreement" }, "nonCompete"],
  [{ label: "Government Official", automationId: "governmentOfficial" }, "governmentOfficial"],
  [{ label: "Reliable Transportation", automationId: "reliableTransportation" }, "reliableTransportation"],
  [{ label: "Suffix", automationId: "legalNameSection_suffix" }, "suffix"],
  [{ label: "County", automationId: "addressSection_county" }, "county"],
  [{ label: "Signature", name: "job_application[signature]" }, "signature"],
  [{ label: "Signature Date", name: "job_application[signature_date]" }, "signatureDate"],
  [{ label: "Are you subject to any non-compete agreements?", name: "non_compete" }, "nonCompete"],
  [{ label: "Do you have access to reliable transportation?", name: "reliable_transportation" }, "reliableTransportation"],
  [{ label: "Have you ever been convicted of a felony?", name: "felony" }, "criminalRecord"],

  // ── Must NOT match ──
  [{ label: "Reference Name", name: "reference_name" }, null],
  [{ label: "Emergency Contact Phone", name: "emergency_phone", type: "tel" }, null],
  [{ label: "Search jobs", name: "q", placeholder: "Search" }, null],
  [{ label: "Password", name: "password", type: "password" }, null]
];

// ─── Run ─────────────────────────────────────────────────────────────────────
// Each case is assigned in isolation so a failure names one field, not a form.
let pass = 0;
const failures = [];

for (const [spec, expected] of CASES) {
  const f = field(spec);
  const result = assign([f], { skipSensitive: true, hasAnswerFor: () => false });
  const got = result.get(0)?.ruleId ?? null;

  if (got === expected) pass++;
  else failures.push({ label: spec.label, expected, got, score: result.get(0)?.score });
}

// ─── A whole form at once, to exercise global assignment ─────────────────────
// "Name" alone would match fullName, but with dedicated first/last boxes
// present the specific rules must win and fullName must not steal one of them.
const form = [
  field({ label: "First Name", name: "first" }),
  field({ label: "Last Name", name: "last" }),
  field({ label: "Name of Reference", name: "ref_name" }),
  field({ label: "Email", name: "email", type: "email" }),
  field({ label: "Confirm Email", name: "email_confirm", type: "email" })
];
const formResult = assign(form, { skipSensitive: true, hasAnswerFor: () => false });
const formGot = form.map((_, i) => formResult.get(i)?.ruleId ?? null);
const formWant = ["firstName", "lastName", null, "email", "emailConfirm"];

const formOk = JSON.stringify(formGot) === JSON.stringify(formWant);
if (formOk) pass++;
else failures.push({ label: "[whole-form assignment]", expected: formWant.join(","), got: formGot.join(",") });

const total = CASES.length + 1;

// ─── Report ──────────────────────────────────────────────────────────────────
console.log(`\n  ${pass}/${total} passed\n`);
for (const f of failures) {
  console.log(`  FAIL  "${f.label}"`);
  console.log(`        expected: ${f.expected}   got: ${f.got}${f.score ? ` (score ${f.score})` : ""}`);
}
process.exit(failures.length ? 1 : 0);
