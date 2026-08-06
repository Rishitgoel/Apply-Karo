// Runs the same field descriptors through the v1 rule engine (test/legacy/field_rules.js)
// to confirm the test cases actually discriminate between the two implementations.
//   node test/compare-v1.mjs

import { readFileSync } from "node:fs";
import { assign, tokenize, ATS_BY_NAME, ATS_BY_ID, ATS_BY_AUTOMATION_ID } from "../src/shared/rules.js";

// legacy/field_rules.js publishes onto `window`; give it one.
const sandbox = { window: {} };
const src = readFileSync(new URL("./legacy/field_rules.js", import.meta.url), "utf8");
new Function("window", src)(sandbox.window);
const { matchFieldsByRules } = sandbox.window;

// A profile with every path populated, so v1 is never blocked by a missing value.
const PROFILE = {
  personal: {
    firstName: "Rishit", lastName: "Goel", fullName: "Rishit Goel",
    email: "a@b.com", phone: "+91 9996007259", website: "https://site",
    linkedin: "https://li", github: "https://gh", portfolio: "https://pf",
    location: "New Delhi, India", visaStatus: "Authorized to work",
    authorizedToWork: "Yes", sponsorshipRequired: "No"
  },
  education: [{ school: "DTU", degree: "B.Tech", fieldOfStudy: "SE", startDate: "2023", endDate: "2027", gpa: "9.18" }],
  experience: [{ company: "TruSave", title: "SWE Intern", location: "Delhi", timeframe: "2026" }],
  summary: "Summary", skills: "C++",
  customFields: { gender: "Male", salaryExpectation: "20 LPA", startDate: "Immediate", yearsofexperience: "1", referral: "LinkedIn" }
};

const CASES = [
  ["Greenhouse first name",  { label: "First Name *", name: "job_application[first_name]", id: "first_name" }, "firstName"],
  ["Greenhouse LinkedIn",    { label: "LinkedIn Profile", name: "job_application[urls][LinkedIn]" }, "linkedin"],
  ["Workday first name",     { label: "First Name", automationId: "legalNameSection_firstName" }, "firstName"],
  ["Workday city",           { label: "City", automationId: "addressSection_city" }, "city"],
  ["autocomplete given-name",{ label: "Given name", autocomplete: "given-name" }, "firstName"],
  ["autocomplete postal",    { label: "ZIP", autocomplete: "postal-code" }, "postalCode"],
  ["Confirm email",          { label: "Confirm Email Address", name: "confirm_email", type: "email" }, "emailConfirm"],
  ["Work auth question",     { label: "Are you legally authorized to work in the United States?", name: "work_auth" }, "authorizedToWork"],
  ["Sponsorship question",   { label: "Will you now or in the future require sponsorship for employment visa status?", name: "sponsorship" }, "sponsorship"],
  ["Reference name",         { label: "Reference Name", name: "reference_name" }, null],
  ["Emergency phone",        { label: "Emergency Contact Phone", name: "emergency_phone", type: "tel" }, null],
  ["Site search box",        { label: "Search jobs", name: "q", placeholder: "Search" }, null]
];

function v2(spec) {
  const atsField =
    (spec.automationId && ATS_BY_AUTOMATION_ID[spec.automationId]) ||
    (spec.name && ATS_BY_NAME[spec.name]) ||
    (spec.id && ATS_BY_ID[spec.id]) || null;
  const f = {
    label: (spec.label || "").toLowerCase(), rawLabel: spec.label || "",
    name: spec.name || "", id: spec.id || "", type: spec.type || "text",
    kind: "text", placeholder: spec.placeholder || "", autocomplete: spec.autocomplete || "",
    nameTokens: tokenize(`${spec.name || ""} ${spec.id || ""} ${spec.automationId || ""}`),
    atsField, section: spec.section ?? null, skip: false, options: null
  };
  return assign([f], { skipSensitive: true, hasAnswerFor: () => false }).get(0)?.ruleId ?? null;
}

function v1(spec) {
  // v1 never read autocomplete or data-automation-id at all, so they simply are
  // not available to it — that absence is the point of the comparison.
  const el = {};
  const info = {
    element: el, label: spec.label || "", name: spec.name || "",
    id: spec.id || "", type: spec.type || "text", tagName: "INPUT",
    placeholder: spec.placeholder || ""
  };
  const { matched } = matchFieldsByRules([info], PROFILE, {}, PROFILE.customFields);
  return matched.get(el)?.ruleId ?? null;
}

const W = 26;
console.log(`\n  ${"case".padEnd(W)} ${"expected".padEnd(18)} ${"v1".padEnd(18)} v2`);
console.log(`  ${"-".repeat(W)} ${"-".repeat(18)} ${"-".repeat(18)} ${"-".repeat(18)}`);

let v1ok = 0, v2ok = 0;
for (const [name, spec, want] of CASES) {
  const a = v1(spec), b = v2(spec);
  if (a === want) v1ok++;
  if (b === want) v2ok++;
  const mark = (got) => (got === want ? " " : "✗");
  console.log(`  ${name.padEnd(W)} ${String(want).padEnd(18)} ${mark(a)}${String(a).padEnd(17)} ${mark(b)}${String(b)}`);
}

console.log(`\n  v1: ${v1ok}/${CASES.length}    v2: ${v2ok}/${CASES.length}\n`);
