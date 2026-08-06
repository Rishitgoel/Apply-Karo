// Tests for the five follow-up features — node test/features.test.mjs

import { assign, tokenize, fieldKey, RULE_BY_ID, DEMOTION } from "../src/shared/rules.js";
import { splitPhone, parseDate, formatDate, datePartValue, semanticScore } from "../src/shared/values.js";
import { resolvePath } from "../src/shared/schema.js";

let pass = 0;
const fails = [];
const check = (desc, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push({ desc, want: w, got: g });
};

function field(spec) {
  return {
    label: (spec.label || "").toLowerCase(), rawLabel: spec.label || "",
    name: spec.name || "", id: spec.id || "", type: spec.type || "text",
    kind: spec.kind || "text", placeholder: spec.placeholder || "", autocomplete: "",
    nameTokens: tokenize(`${spec.name || ""} ${spec.id || ""}`),
    atsField: null, section: spec.section ?? null, instance: spec.instance || 0,
    skip: false, options: null
  };
}
const noOpts = { skipSensitive: true, hasAnswerFor: () => false };

// ─── 1. Repeated sections ────────────────────────────────────────────────────
{
  // Three education cards. Every "School" box must win the university rule for
  // its own card; before this, only the first was ever filled.
  const fields = [];
  for (let i = 0; i < 3; i++) {
    fields.push(field({ label: "School", name: `educations[${i}][school]`, section: "education", instance: i }));
    fields.push(field({ label: "Degree", name: `educations[${i}][degree]`, section: "education", instance: i }));
  }
  const got = assign(fields, noOpts);
  check("3 education cards all match university",
    [0, 2, 4].map((i) => got.get(i)?.ruleId), ["university", "university", "university"]);
  check("each card carries its own instance",
    [0, 2, 4].map((i) => got.get(i)?.instance), [0, 1, 2]);
  check("degree matches per card",
    [1, 3, 5].map((i) => got.get(i)?.ruleId), ["degree", "degree", "degree"]);

  // A non-indexable rule still holds exactly one slot form-wide.
  const two = assign([field({ label: "Email", name: "email", type: "email" }),
                      field({ label: "School", name: "school", section: "education", instance: 1 })], noOpts);
  check("email is not indexable", RULE_BY_ID.get("email").indexable, false);
  check("university is indexable", RULE_BY_ID.get("university").indexable, true);
  check("instance-1 school still matches", two.get(1)?.ruleId, "university");

  // Path indexing resolves against the right profile entry.
  const profile = { education: [{ school: "DTU" }, { school: "Some College" }, { school: "Third" }] };
  const rule = RULE_BY_ID.get("university");
  check("education[1] resolves", resolvePath(profile, rule.path.replace("[0]", "[1]")), "Some College");
  check("education[9] is absent", resolvePath(profile, rule.path.replace("[0]", "[9]")), null);
}

// ─── 2. Phone country code ───────────────────────────────────────────────────
check("split with separator", splitPhone("+91 9996007259"), { code: "+91", national: "9996007259" });
check("split with dash", splitPhone("+1-555-0100"), { code: "+1", national: "5550100" });
check("split without separator", splitPhone("+919996007259"), { code: "+91", national: "9996007259" });
check("no code present", splitPhone("9996007259"), { code: "", national: "9996007259" });
check("empty", splitPhone(""), { code: "", national: "" });

check("code matches '+91'", semanticScore("phoneCountryCode", "+91", "", "+91") > 0.9, true);
check("code matches 'India (+91)'", semanticScore("phoneCountryCode", "India (+91)", "", "+91") > 0.9, true);
check("code matches bare '91'", semanticScore("phoneCountryCode", "91", "", "+91") > 0.9, true);
check("code rejects '+1'", semanticScore("phoneCountryCode", "United States (+1)", "", "+91"), 0);

{
  // The code box must not steal the number box, nor vice versa.
  const got = assign([field({ label: "Country Code", name: "country_code" }),
                      field({ label: "Phone Number", name: "phone", type: "tel" })], noOpts);
  check("country code -> phoneCountryCode", got.get(0)?.ruleId, "phoneCountryCode");
  check("phone number -> phone", got.get(1)?.ruleId, "phone");
}

// ─── 3. Dates ────────────────────────────────────────────────────────────────
check("parse 'May 2027'", parseDate("May 2027"), { year: 2027, month: 5, day: null });
check("parse 'Aug 2023'", parseDate("Aug 2023"), { year: 2023, month: 8, day: null });
check("parse ISO", parseDate("2027-05"), { year: 2027, month: 5, day: null });
check("parse ISO full", parseDate("2027-05-14"), { year: 2027, month: 5, day: 14 });
check("parse MM/YYYY", parseDate("05/2027"), { year: 2027, month: 5, day: null });
check("parse day-first when >12", parseDate("14/05/2027"), { year: 2027, month: 5, day: 14 });
check("parse '12 June 2025'", parseDate("12 June 2025"), { year: 2025, month: 6, day: 12 });
check("parse year only", parseDate("2027"), { year: 2027, month: null, day: null });
check("'Present' is not a date", parseDate("Present"), null);

const may2027 = parseDate("May 2027");
check("format for input[type=date]", formatDate(may2027, "date"), "2027-05-01");
check("format for input[type=month]", formatDate(may2027, "month"), "2027-05");
check("format honours DD/MM/YYYY hint", formatDate(may2027, "text", "DD/MM/YYYY"), "01/05/2027");
check("format honours MM/YYYY hint", formatDate(may2027, "text", "MM/YYYY"), "05/2027");
check("format default", formatDate(may2027, "text", ""), "05/2027");
check("date part: year", datePartValue(may2027, "year"), "2027");
check("date part: month", datePartValue(may2027, "month"), "5");

// ─── 5. Correction feedback ──────────────────────────────────────────────────
{
  const f = field({ label: "Location", name: "location" });
  const before = assign([f], noOpts).get(0);
  check("location matches by default", before?.ruleId, "location");

  const demoted = assign([f], { ...noOpts, isDemoted: (fl, r) => fieldKey(fl) === "location" && r === "location" });
  check("demoted pairing loses the field", demoted.get(0)?.ruleId ?? null, null);

  // Demotion is a penalty, not a ban: an ATS attribute still wins through.
  const strong = { ...field({ label: "City", name: "city" }), atsField: "city" };
  const still = assign([strong], { ...noOpts, isDemoted: () => true });
  check("strong ATS signal survives demotion", still.get(0)?.ruleId, "city");
  check("penalty is smaller than the ATS score", DEMOTION < 98, true);

  check("fieldKey ignores punctuation/case", fieldKey({ label: "Current Location *" }), "current location");
  check("fieldKey falls back to name", fieldKey({ label: "", name: "work_auth" }), "work auth");
}

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
process.exit(fails.length ? 1 : 0);
