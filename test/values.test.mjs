// Vocabulary-bridging tests — node test/values.test.mjs
//
// The question: one profile value has to satisfy the same field whether the site
// renders it as a text box (takes your words verbatim) or a dropdown (takes only
// its own). These cases are the real option lists from Greenhouse, Workday and
// Lever EEO/education sections.

import { semanticScore, asBool, classify, rangeContains } from "../src/shared/values.js";

// Mirrors bestOption() in fill.js: plain similarity, then the semantic bridge.
function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function plainScore(opt, target) {
  const o = norm(opt), t = norm(target);
  if (!o || !t) return 0;
  if (o === t) return 1;
  if (o.startsWith(t) || t.startsWith(o)) return 0.9;
  if (o.includes(t) || t.includes(o)) return 0.8;
  return 0;
}
function pick(options, value, ruleId) {
  let best = null, score = 0.5;
  for (const o of options) {
    const s = Math.max(plainScore(o, value), ruleId ? semanticScore(ruleId, o, "", value) : 0);
    if (s > score) { best = o; score = s; }
  }
  return best;
}

const GH_DEGREE = ["High School", "Associate's Degree", "Bachelor's Degree", "Master's Degree", "Doctorate (PhD)", "Other"];
const WD_DEGREE = ["Bachelor of Technology", "Bachelor of Science", "Master of Science", "Doctor of Philosophy"];
const AUTH = ["Yes, I am authorized to work in the United States for any employer",
              "No, I am not authorized to work in the United States"];
const SPONSOR = ["Yes, I will require sponsorship now or in the future",
                 "No, I do not require sponsorship"];
const GENDER = ["Male", "Female", "Non-binary", "I don't wish to answer"];
const VETERAN = ["I am not a protected veteran",
                 "I identify as one or more of the classifications of a protected veteran",
                 "I don't wish to answer"];
const YEARS = ["Less than 1 year", "1-2 years", "3-5 years", "6-9 years", "10+ years"];

const CASES = [
  // [ description, ruleId, profile value, options, expected option ]
  ["B.Tech onto Greenhouse degree list",   "degree", "B.Tech", GH_DEGREE, "Bachelor's Degree"],
  ["B.Tech onto Workday degree list",      "degree", "B.Tech", WD_DEGREE, "Bachelor of Technology"],
  ["Bachelor's spelled out",               "degree", "Bachelor of Engineering", GH_DEGREE, "Bachelor's Degree"],
  ["M.Tech onto master",                   "degree", "M.Tech", GH_DEGREE, "Master's Degree"],
  ["PhD onto doctorate",                   "degree", "PhD", GH_DEGREE, "Doctorate (PhD)"],

  ["Yes onto verbose work-auth option",    "authorizedToWork", "Yes", AUTH, AUTH[0]],
  ["No onto verbose work-auth option",     "authorizedToWork", "No", AUTH, AUTH[1]],
  ["No onto verbose sponsorship option",   "sponsorship", "No", SPONSOR, SPONSOR[1]],
  ["Yes onto verbose sponsorship option",  "sponsorship", "Yes", SPONSOR, SPONSOR[0]],

  ["Male onto gender list",                "gender", "Male", GENDER, "Male"],
  ["Man onto Male",                        "gender", "Man", GENDER, "Male"],
  ["Decline onto EEO opt-out",             "gender", "Prefer not to say", GENDER, "I don't wish to answer"],
  ["No onto veteran phrasing",             "veteranStatus", "No", VETERAN, VETERAN[0]],

  ["1 year onto a bucket list",            "yearsOfExperience", "1", YEARS, "1-2 years"],
  ["4 years onto a bucket list",           "yearsOfExperience", "4", YEARS, "3-5 years"],
  ["12 years onto the open bucket",        "yearsOfExperience", "12", YEARS, "10+ years"],
  ["0 years onto 'Less than 1'",           "yearsOfExperience", "0", YEARS, "Less than 1 year"],

  // Text-box side: the value must pass through untouched.
  ["free text keeps B.Tech verbatim",      "degree", "B.Tech", null, "B.Tech"]
];

let pass = 0;
const fails = [];

for (const [desc, ruleId, value, options, want] of CASES) {
  const got = options ? pick(options, value, ruleId) : value;  // null options == text input
  if (got === want) pass++;
  else fails.push({ desc, want, got });
}

// Direction checks that would silently corrupt an application if wrong.
const guards = [
  ["'I do not require sponsorship' reads as No", asBool("I do not require sponsorship"), false],
  ["'I am authorized' reads as Yes",             asBool("I am authorized to work"), true],
  ["'I am not authorized' reads as No",          asBool("I am not authorized"), false],
  ["'Decline to answer' is neither",             asBool("Decline to answer"), false],
  ["B.Tech classifies as bachelor",              classify("degree", "B.Tech"), "bachelor"],
  ["MBA classifies as master",                   classify("degree", "MBA"), "master"],
  ["'10+ years' contains 12",                    rangeContains("10+ years", 12), true],
  ["'1-2 years' excludes 4",                     rangeContains("1-2 years", 4), false],

  // Consent and certification boxes. These are required on most real
  // applications, and they are almost never worded "yes" — so every one of
  // these used to come back null, which the checkbox filler read as "untick it".
  ["'I agree' is Yes",                           asBool("I agree"), true],
  ["'I accept the terms' is Yes",                asBool("I accept the terms"), true],
  ["'I certify that the above is accurate' is Yes", asBool("I certify that the above is accurate"), true],
  ["'I acknowledge' is Yes",                     asBool("I acknowledge"), true],
  ["'I consent' is Yes",                         asBool("I consent"), true],
  ["'Agree' is Yes",                             asBool("Agree"), true],
  ["'Accept' is Yes",                            asBool("Accept"), true],

  // …and the refusals still have to win, since several share a prefix.
  ["'I do not agree' is still No",               asBool("I do not agree"), false],
  ["'I disagree' is No",                         asBool("I disagree"), false],
  ["'Decline' is No",                            asBool("Decline"), false],
  ["'I don't consent' is No",                    asBool("I don't consent"), false],

  // An answer that is neither must stay unreadable, so the filler leaves the
  // box exactly as it found it rather than guessing a direction.
  ["'Maybe' is neither",                         asBool("Maybe"), null],
  ["an empty answer is neither",                 asBool(""), null],
  // "N/A" lands on No, via the bare `n` branch. Left that way deliberately:
  // against "Do you require sponsorship?" the useful reading of "not applicable"
  // is No, and on a checkbox it means leave the box alone.
  ["'N/A' reads as No",                          asBool("N/A"), false]
];

for (const [desc, got, want] of guards) {
  if (got === want) pass++;
  else fails.push({ desc, want, got });
}

const total = CASES.length + guards.length;
console.log(`\n  ${pass}/${total} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}   got: ${f.got}`);
process.exit(fails.length ? 1 : 0);
