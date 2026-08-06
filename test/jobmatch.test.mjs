// Job-matching and tracker tests — node test/jobmatch.test.mjs
//
// Three things are covered here, all of them pure:
//
//  * normalizeMatch — the score is computed from the requirement lists rather
//    than taken from the model, so the headline number can never disagree with
//    the detail underneath it.
//  * overlayFilled — an extractor that says "" means the resume is silent, not
//    that the field should be cleared. This is the regression that wiped a
//    hand-typed address and work-authorization answer on every re-extraction.
//  * staleApplications / priorApplicationsFor — the tracker's two local
//    queries. No model, no network.

import { normalizeMatch } from "../src/shared/ai.js";
import { overlayFilled, staleApplications, priorApplicationsFor } from "../src/shared/schema.js";

let pass = 0, fail = 0;
const check = (desc, got, want) => {
  const g = typeof got === "object" ? JSON.stringify(got) : String(got);
  const w = typeof want === "object" ? JSON.stringify(want) : String(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`  FAIL  ${desc}\n        expected: ${w}\n        got:      ${g}`);
};

// ── normalizeMatch: the score is derived, never trusted ─────────────────────
{
  const m = normalizeMatch({
    summary: "Worth applying.",
    meets: [{ requirement: "React", evidence: "Collabify" }, { requirement: "Node", evidence: "TruSave" }],
    gaps: [], leadWith: ["CRDT editor"], keywords: ["GraphQL"]
  });
  check("all met scores 100", m.score, 100);
  check("100 reads as strong", m.verdict, "strong");
  check("summary survives", m.summary, "Worth applying.");
  check("leadWith survives", m.leadWith, ["CRDT editor"]);
  check("keywords survive", m.keywords, ["GraphQL"]);
}
{
  // A model's own number is ignored — only the lists count.
  const m = normalizeMatch({
    score: 95, verdict: "strong",
    meets: [{ requirement: "React" }],
    gaps: [{ requirement: "Security clearance", severity: "blocking" }]
  });
  check("a blocking gap sinks the score", m.score, 9);
  check("and the verdict follows the score", m.verdict, "weak");
  check("the model's own score is discarded", m.score !== 95, true);
}
{
  // Severity is weighted: the same count of gaps scores very differently.
  const minor = normalizeMatch({
    meets: [{ requirement: "a" }, { requirement: "b" }, { requirement: "c" }],
    gaps: [{ requirement: "x", severity: "minor" }]
  });
  const important = normalizeMatch({
    meets: [{ requirement: "a" }, { requirement: "b" }, { requirement: "c" }],
    gaps: [{ requirement: "x", severity: "important" }]
  });
  const blocking = normalizeMatch({
    meets: [{ requirement: "a" }, { requirement: "b" }, { requirement: "c" }],
    gaps: [{ requirement: "x", severity: "blocking" }]
  });
  check("one minor gap barely moves it", minor.score, 75);
  check("one important gap costs more", important.score, 50);
  check("one blocking gap costs most", blocking.score, 23);
  check("severity strictly orders the score",
    blocking.score < important.score && important.score < minor.score, true);
}
{
  // Verdict thresholds sit where the labels change.
  const at = (meets, gaps) => normalizeMatch({
    meets: Array.from({ length: meets }, (_, i) => ({ requirement: `m${i}` })),
    gaps: Array.from({ length: gaps }, (_, i) => ({ requirement: `g${i}`, severity: "minor" }))
  });
  check("7 of 10 is strong", at(7, 3).verdict, "strong");
  check("6 of 10 is fair", at(6, 4).verdict, "fair");
  check("4 of 10 is fair", at(4, 6).verdict, "fair");
  check("3 of 10 is weak", at(3, 7).verdict, "weak");
}
{
  // Garbage in must not throw — a model that ignores the schema is a fact of life.
  const m = normalizeMatch({});
  check("empty input yields a zero score", m.score, 0);
  check("empty input yields empty lists", [m.meets.length, m.gaps.length], [0, 0]);

  const junk = normalizeMatch({
    meets: "not a list", gaps: [{ requirement: "" }, null, { requirement: "Real", severity: "nonsense" }],
    leadWith: [null, "  ", "Keep"], keywords: "nope", summary: 42
  });
  check("a non-list meets becomes empty", junk.meets, []);
  check("blank and null gaps are dropped", junk.gaps.length, 1);
  check("an unknown severity falls back to important", junk.gaps[0].severity, "important");
  check("blank leadWith entries are dropped", junk.leadWith, ["Keep"]);
  check("a non-list keywords becomes empty", junk.keywords, []);
  check("a non-string summary becomes empty", junk.summary, "");
}

// ── overlayFilled: the profile-reset regression ─────────────────────────────
{
  // The reported bug, exactly: a resume states neither of these, so the
  // extractor returns "" for both and the old spread wrote the blanks through.
  const typed = {
    firstName: "Alex", address: "221B Baker Street", city: "London",
    authorizedToWork: "Yes", sponsorshipRequired: "No", visaStatus: "Authorized to work"
  };
  const extracted = {
    firstName: "Alex", lastName: "Morgan", address: "", city: "",
    authorizedToWork: "", sponsorshipRequired: "", visaStatus: ""
  };
  const m = overlayFilled(typed, extracted);
  check("address survives re-extraction", m.address, "221B Baker Street");
  check("city survives", m.city, "London");
  check("authorizedToWork survives", m.authorizedToWork, "Yes");
  check("sponsorshipRequired survives", m.sponsorshipRequired, "No");
  check("visaStatus survives", m.visaStatus, "Authorized to work");
  check("a genuinely new value still lands", m.lastName, "Morgan");

  check("whitespace counts as empty", overlayFilled({ a: "keep" }, { a: "   " }).a, "keep");
  check("null is ignored", overlayFilled({ a: "keep" }, { a: null }).a, "keep");
  check("an empty list does not wipe a populated one",
    overlayFilled({ education: [{ school: "X" }] }, { education: [] }).education, [{ school: "X" }]);
  check("a populated list replaces wholesale",
    overlayFilled({ education: [{ school: "X" }] }, { education: [{ school: "Y" }] }).education, [{ school: "Y" }]);
  check("zero is a real value, not emptiness", overlayFilled({ a: "x" }, { a: 0 }).a, 0);
  check("the base object is not mutated",
    (() => { const b = { a: "1" }; overlayFilled(b, { a: "2" }); return b.a; })(), "1");
}

// ── staleApplications ───────────────────────────────────────────────────────
{
  const NOW = 1_700_000_000_000;
  const days = (n) => NOW - n * 86400000;
  const history = [
    { url: "a", company: "Acme", status: "applied", ts: days(20) },
    { url: "b", company: "Beta", status: "applied", ts: days(3) },
    { url: "c", company: "Cyclo", status: "interview", ts: days(30) },
    { url: "d", company: "Delta", status: "rejected", ts: days(60) },
    { url: "e", company: "Echo", status: "saved", ts: days(90) },
    { url: "f", company: "Foxtrot", status: "offer", ts: days(45) }
  ];
  const stale = staleApplications(history, 14, NOW);
  check("only waiting statuses are chased", stale.map((h) => h.url), ["c", "a"]);
  check("a rejection is never chased", stale.some((h) => h.status === "rejected"), false);
  check("a filled-but-unsent row is not chased", stale.some((h) => h.status === "saved"), false);
  check("an offer is not chased", stale.some((h) => h.status === "offer"), false);
  check("recent applications are left alone", stale.some((h) => h.url === "b"), false);
  check("oldest first", stale[0].url, "c");
  check("daysSince is reported", stale[0].daysSince, 30);
  check("the threshold is configurable", staleApplications(history, 25, NOW).map((h) => h.url), ["c"]);
  check("exactly at the threshold counts",
    staleApplications([{ url: "x", status: "applied", ts: days(14) }], 14, NOW).length, 1);
  check("an empty history is fine", staleApplications([], 14, NOW).length, 0);
  check("a missing history is fine", staleApplications(undefined, 14, NOW).length, 0);
}

// ── priorApplicationsFor ────────────────────────────────────────────────────
{
  const history = [
    { url: "u1", company: "Acme", role: "Backend" },
    { url: "u2", company: "acme", role: "Frontend" },
    { url: "u3", company: "  ACME  ", role: "Data" },
    { url: "u4", company: "Beta", role: "Backend" }
  ];
  const prior = priorApplicationsFor(history, { company: "Acme", url: "u1" });
  check("the same employer is found regardless of case/space",
    prior.map((h) => h.url), ["u2", "u3"]);
  check("this exact posting is never its own duplicate",
    prior.some((h) => h.url === "u1"), false);
  check("a different employer is not a duplicate",
    prior.some((h) => h.company === "Beta"), false);
  check("no company means no claim", priorApplicationsFor(history, { company: "", url: "u1" }).length, 0);
  check("an unknown employer has no history",
    priorApplicationsFor(history, { company: "Zeta", url: "u9" }).length, 0);
  check("a missing history is fine", priorApplicationsFor(undefined, { company: "Acme" }).length, 0);
}

console.log(`\n  ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
