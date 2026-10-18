// Tests for the five follow-up features — node test/features.test.mjs

import { assign, tokenize, fieldKey, RULE_BY_ID, DEMOTION } from "../src/shared/rules.js";
import { splitPhone, parseDate, formatDate, datePartValue, semanticScore } from "../src/shared/values.js";
import {
  resolvePath, resumeTextIsCurrent, DEFAULT_RESUME_META, safeHttpUrl,
  extensionAlive, isContextGone
} from "../src/shared/schema.js";

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

  const demoted = assign([f], { ...noOpts, isDemoted: (fl, r) => fieldKey(fl) === fieldKey(f) && r === "location" });
  check("demoted pairing loses the field", demoted.get(0)?.ruleId ?? null, null);

  // Demotion is a penalty, not a ban: an ATS attribute still wins through.
  const strong = { ...field({ label: "City", name: "city" }), atsField: "city" };
  const still = assign([strong], { ...noOpts, isDemoted: () => true });
  check("strong ATS signal survives demotion", still.get(0)?.ruleId, "city");
  check("penalty is smaller than the ATS score", DEMOTION < 98, true);

  check("fieldKey ignores punctuation/case", fieldKey({ label: "Current Location *" }), fieldKey({ label: "current location" }));
  check("fieldKey falls back to name", fieldKey({ label: "", name: "work_auth" }), fieldKey({ label: "work auth" }));
}

// ─── 6. Resume text freshness ────────────────────────────────────────────────
//
// Whether the stored resume text describes the resume that is stored *now*.
// Everything downstream reads this: the service worker decides whether to
// re-read the PDF by it, and the dashboard's status line reports it. Before it
// existed the test was "is there any text at all", so replacing your resume left
// the previous one's text in place and every AI answer, cover letter and job
// match went on describing the resume you had just swapped out.
{
  const meta = (o) => ({ fileName: "", fileSize: "", text: "", textFileName: "", ...o });

  check("no text at all is not current",
    resumeTextIsCurrent(meta({ fileName: "cv.pdf" })), false);
  check("whitespace is not text",
    resumeTextIsCurrent(meta({ fileName: "cv.pdf", text: "   \n ", textFileName: "cv.pdf" })), false);
  check("text read from the stored resume is current",
    resumeTextIsCurrent(meta({ fileName: "cv.pdf", text: "…", textFileName: "cv.pdf" })), true);

  // The case this exists for.
  check("text from the resume it replaced is NOT current",
    resumeTextIsCurrent(meta({ fileName: "cv_v2.pdf", text: "…", textFileName: "cv_v1.pdf" })), false);

  // Hand-pasted text claims no file, and must never be discarded as stale: on a
  // provider that cannot read a PDF it is the only copy there is.
  check("hand-pasted text is always current",
    resumeTextIsCurrent(meta({ fileName: "cv.pdf", text: "…", textFileName: "" })), true);
  check("hand-pasted text survives with no resume stored at all",
    resumeTextIsCurrent(meta({ text: "…", textFileName: "" })), true);

  // Deleting the PDF keeps the text; it is still honestly attributed.
  check("text outlives the file it came from, and says so",
    resumeTextIsCurrent(meta({ fileName: "", text: "…", textFileName: "cv.pdf" })), false);

  check("the default meta carries the stamp field",
    Object.keys(DEFAULT_RESUME_META).includes("textFileName"), true);
}

// ─── 7. URLs that reach an href ──────────────────────────────────────────────
//
// The tracker renders each row's URL as a link. Escaping the string stops it
// breaking out of the attribute and does nothing about the scheme, and
// `javascript:` needs neither quotes nor angle brackets to survive escaping — so
// a link like that in the dashboard runs script in the extension's own origin,
// where the profile, the resume and the API keys live.
//
// Not reachable from ordinary use, because the tracker's URLs come from pages a
// content script ran on and those are always http(s). Reachable through Settings
// → Import: a backup is plain JSON from wherever the user got it.
{
  for (const ok of [
    "https://job-boards.greenhouse.io/acme/jobs/1",
    "http://careers.acme.com/apply?id=2",
    "https://acme.wd1.myworkdayjobs.com/en-US/careers"
  ]) {
    check(`keeps an ordinary posting URL: ${ok.slice(0, 34)}`, safeHttpUrl(ok), ok);
  }

  for (const bad of [
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///C:/Windows/System32",
    "chrome-extension://abc/options.html",
    "not a url at all",
    ""
  ]) {
    check(`refuses ${JSON.stringify(bad.slice(0, 30))}`, safeHttpUrl(bad), "");
  }

  // Case and leading whitespace are the usual way past a naive prefix test;
  // `new URL` normalises both, which is why the check is a parse rather than a
  // startsWith.
  check("scheme matching is not case-sensitive", safeHttpUrl("HTTPS://acme.com/x"), "HTTPS://acme.com/x");
  check("a null is not a URL", safeHttpUrl(null), "");
}

// ─── A page that has outlived the extension ──────────────────────────────────
//
// Reloading an unpacked build leaves the already-injected script talking to a
// runtime that no longer exists. Everything it does then fails asynchronously,
// so this has to be detectable *before* the call rather than only from what it
// throws.
{
  check("no runtime at all reads as gone", extensionAlive(), false);
  check("chrome's own wording is recognised",
    isContextGone(new Error("Extension context invalidated.")), true);

  globalThis.chrome = { runtime: { id: "abc" } };
  check("a live runtime reads as alive", extensionAlive(), true);
  // The check must not swallow ordinary failures — a spent quota reported as
  // "reload the page" sends the user to the one fix that will not help.
  check("an ordinary failure is not mistaken for it",
    isContextGone(new Error("Groq has no quota left (429).")), false);

  // The port is gone the moment the id is, which is before any call throws.
  globalThis.chrome = { runtime: {} };
  check("a runtime with no id is a dead port", extensionAlive(), false);
  check("and any error from it counts as the same failure",
    isContextGone(new Error("whatever")), true);
  delete globalThis.chrome;
}

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
process.exit(fails.length ? 1 : 0);
