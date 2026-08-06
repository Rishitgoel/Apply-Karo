// ResumeFiler — value vocabulary bridging.
//
// The same question appears as a text box on one site and a dropdown on the
// next. Adapting the *control* is easy (see fill.js). The harder half is that a
// dropdown does not accept your words — it accepts its own.
//
// Your profile says "B.Tech". Greenhouse offers "Bachelor's Degree". Workday
// offers "Bachelor of Technology". Lever asks the same thing as free text, where
// "B.Tech" is exactly right. Plain string similarity scores "B.Tech" against
// "Bachelor's Degree" at roughly zero, so the dropdown silently stays empty.
//
// This module maps both sides onto a canonical class so they can meet in the
// middle, and understands the numeric ranges that experience dropdowns use.

// ─────────────────────────────────────────────────────────────────────────────
// Yes / no
//
// Negatives are tested first and must be, because application forms phrase
// refusals as "I do not require sponsorship" — which starts with "I do" and
// would otherwise read as agreement.
// ─────────────────────────────────────────────────────────────────────────────

const NO_RE = /^(no\b|n\b|false|nope|i am not|i'm not|i do not|i don'?t|i have not|i haven'?t|i will not|not\b|never|decline|neither)/i;
const YES_RE = /^(yes\b|y\b|true|yep|yeah|i am\b|i'm\b|i do\b|i have\b|i will\b|i can\b|authoriz|eligible|legally)/i;

export function asBool(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (NO_RE.test(t)) return false;
  if (YES_RE.test(t)) return true;
  if (/^1$/.test(t)) return true;
  if (/^0$/.test(t)) return false;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical classes
// ─────────────────────────────────────────────────────────────────────────────

const CLASSES = {
  degree: {
    doctorate: ["phd", "ph d", "doctor", "doctorate", "doctoral", "dphil"],
    master: ["master", "masters", "m tech", "mtech", "m s", "ms", "msc", "m sc", "mba", "m e", "me", "mca", "postgraduate", "post graduate", "pg"],
    bachelor: ["bachelor", "bachelors", "b tech", "btech", "b e", "be", "b s", "bs", "bsc", "b sc", "b a", "ba", "bca", "bba", "undergraduate", "under graduate", "ug", "engineering degree"],
    associate: ["associate", "diploma", "a s", "a a"],
    highschool: ["high school", "secondary", "hsc", "12th", "ged", "matriculation"]
  },
  gender: {
    male: ["male", "man", "m"],
    female: ["female", "woman", "f"],
    nonbinary: ["non binary", "nonbinary", "genderqueer", "other"],
    // Apostrophes are stripped by norm(), so "I don't wish to answer" arrives as
    // "i don t wish to answer" — the opt-out phrasings must be listed post-norm.
    declined: ["decline", "prefer not", "not disclose", "not wish", "do not wish",
               "don t wish", "dont wish", "wish to answer", "not answer", "choose not"]
  },
  veteranStatus: {
    no: ["not a protected veteran", "not a veteran", "i am not a", "no"],
    yes: ["identify as one or more", "i am a", "protected veteran", "yes"],
    declined: ["decline", "prefer not", "not wish", "choose not"]
  },
  disabilityStatus: {
    no: ["no, i do not", "do not have", "no"],
    yes: ["yes, i have", "i have a disability", "yes"],
    declined: ["decline", "prefer not", "not wish", "do not want"]
  },
  visaStatus: {
    citizen: ["citizen", "permanent resident", "green card", "national"],
    authorized: ["authorized", "authorised", "work permit", "opt", "cpt", "h1b", "ead", "no sponsorship"],
    sponsorship: ["require sponsorship", "need sponsorship", "will require", "sponsorship required"]
  }
};

const norm = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Map a phrase onto a canonical class for the given rule, or null.
 * Longer keywords are tested first so "master" cannot be claimed by a stray
 * substring of a longer, more specific term.
 */
export function classify(ruleId, text) {
  const table = CLASSES[ruleId];
  if (!table) return null;
  const t = norm(text);
  if (!t) return null;

  let best = null;
  let bestLen = 0;
  for (const [cls, keywords] of Object.entries(table)) {
    for (const kw of keywords) {
      if (kw.length <= bestLen) continue;
      // Word-boundary containment, so "be" does not match "before".
      if (t === kw || t.startsWith(kw + " ") || t.endsWith(" " + kw) || t.includes(" " + kw + " ")) {
        best = cls;
        bestLen = kw.length;
      }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Numeric ranges
//
// Experience dropdowns are almost always buckets: "0-2 years", "3-5 years",
// "Less than 1 year", "10+ years". A stored value of "2" has to land in the
// right bucket, which string similarity cannot do.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Does the option text describe a range containing `n`?
 *
 * Note this deliberately does NOT use norm(): the range syntax lives entirely in
 * the punctuation. Stripping it turns "3-5 years" into "3 5 years" and "10+
 * years" into "10 years", so every bucket silently collapses to an exact match.
 */
export function rangeContains(optionText, n) {
  const t = String(optionText || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || !Number.isFinite(n)) return false;

  const between = t.match(/(\d+)\s*(?:to|-|–|—)\s*(\d+)/);
  if (between) return n >= +between[1] && n <= +between[2];

  const plus = t.match(/(\d+)\s*(?:\+|or more|and above|and over|or greater)/);
  if (plus) return n >= +plus[1];

  const under = t.match(/(?:less than|under|fewer than|below)\s*(\d+)/);
  if (under) return n < +under[1];

  const exact = t.match(/^(\d+)\s*(?:years?|yrs?)?$/);
  if (exact) return n === +exact[1];

  if (/^(none|no experience|fresher|entry level)$/.test(t)) return n === 0;
  return false;
}

/** First number in a string, or null. */
export function numberIn(text) {
  const m = String(text || "").match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/**
 * Bonus similarity for an option, on top of plain text matching.
 * Returns 0..1, or 0 when this module has nothing to add.
 */
export function semanticScore(ruleId, optionLabel, optionValue, target) {
  // 1. Canonical class agreement — the "B.Tech" vs "Bachelor's Degree" case.
  const wantClass = classify(ruleId, target);
  if (wantClass) {
    if (classify(ruleId, optionLabel) === wantClass) return 0.95;
    if (optionValue && classify(ruleId, optionValue) === wantClass) return 0.93;
  }

  // 2. Yes/no agreement, however verbosely the option phrases it.
  const wantBool = asBool(target);
  if (wantBool !== null) {
    const gotBool = asBool(optionLabel) ?? (optionValue ? asBool(optionValue) : null);
    if (gotBool !== null) return gotBool === wantBool ? 0.94 : 0;
  }

  // 3. Numeric bucketing for experience-style dropdowns.
  if (ruleId === "yearsOfExperience") {
    const n = numberIn(target);
    if (n !== null && rangeContains(optionLabel, n)) return 0.92;
  }

  // 4. Dialling-code dropdowns render the same code half a dozen ways:
  //    "+91", "91", "India (+91)", "IN +91". Compare digits, not text.
  if (ruleId === "phoneCountryCode") {
    const want = String(target).replace(/\D/g, "");
    if (want) {
      for (const src of [optionValue, optionLabel]) {
        if (!src) continue;
        const codes = String(src).match(/\+\s*(\d{1,4})/) || String(src).match(/^\s*(\d{1,4})\s*$/);
        if (codes && codes[1] === want) return 0.96;
      }
    }
  }

  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone numbers
// ─────────────────────────────────────────────────────────────────────────────

// Enough of the ITU list to disambiguate a code that is not followed by a
// separator. Ordered longest-first so "+441" cannot be read as "+4".
const DIAL_CODES = [
  "1", "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44",
  "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61",
  "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95",
  "98", "212", "213", "216", "218", "220", "233", "234", "251", "254", "255", "256", "260",
  "263", "351", "352", "353", "354", "355", "358", "359", "370", "371", "372", "380", "381",
  "385", "386", "420", "421", "852", "853", "855", "856", "880", "886", "962", "963", "964",
  "965", "966", "968", "970", "971", "972", "973", "974", "975", "976", "977", "994", "995", "998"
].sort((a, b) => b.length - a.length);

/**
 * Split "+91 9996007259" into its dialling code and national number.
 *
 * A separator after the code makes this unambiguous; without one, fall back to
 * the ITU prefix list, because "+123456..." could be +1, +12 or +123.
 */
export function splitPhone(raw) {
  const t = String(raw || "").trim();
  if (!t) return { code: "", national: "" };

  const sep = t.match(/^\+\s*(\d{1,4})[\s\-.()]+(.*)$/);
  if (sep) return { code: `+${sep[1]}`, national: sep[2].replace(/\D/g, "") };

  const plain = t.match(/^\+\s*(\d+)$/);
  if (plain) {
    const digits = plain[1];
    for (const code of DIAL_CODES) {
      if (digits.startsWith(code) && digits.length > code.length) {
        return { code: `+${code}`, national: digits.slice(code.length) };
      }
    }
    return { code: "", national: digits };
  }

  return { code: "", national: t.replace(/\D/g, "") };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["january","february","march","april","may","june",
                     "july","august","september","october","november","december"];
const MONTH_INDEX = {};
MONTH_NAMES.forEach((m, i) => { MONTH_INDEX[m.slice(0, 3)] = i + 1; });

/** "May 2027", "2027-05", "05/2027", "2027" → { year, month, day }. */
export function parseDate(text) {
  const t = String(text || "").trim();
  if (!t || /^(present|current|ongoing|now)$/i.test(t)) return null;

  let m = t.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
  if (m) return { year: +m[1], month: +m[2], day: m[3] ? +m[3] : null };

  // Day-first must be tried before bare month-year: "12 June 2025" also
  // contains "June 2025", so the looser pattern would swallow it and drop the 12.
  m = t.match(/^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i);
  if (m) {
    const mo = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
    if (mo) return { year: +m[3], month: mo, day: +m[1] };
  }

  m = t.match(/([a-z]{3,9})\.?,?\s+(\d{1,2})?,?\s*(\d{4})/i);
  if (m) {
    const mo = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
    if (mo) return { year: +m[3], month: mo, day: m[2] ? +m[2] : null };
  }

  // Ambiguous slash forms. Treat a value > 12 in the first slot as a day.
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    let year = +m[3];
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return a > 12 ? { year, month: b, day: a } : { year, month: a, day: b };
  }

  m = t.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) return { year: +m[2], month: +m[1], day: null };

  m = t.match(/\b(19|20)(\d{2})\b/);
  if (m) return { year: +(m[1] + m[2]), month: null, day: null };

  return null;
}

const pad = (n) => String(n).padStart(2, "0");

export function monthName(n, style = "long") {
  const name = MONTH_NAMES[n - 1];
  if (!name) return "";
  const cap = name[0].toUpperCase() + name.slice(1);
  return style === "short" ? cap.slice(0, 3) : cap;
}

/**
 * Render a parsed date for a specific control.
 * `hint` is a placeholder or format attribute when the page offers one.
 */
export function formatDate(parts, kind, hint = "") {
  if (!parts) return "";
  const { year, month, day } = parts;

  if (kind === "date") return `${year}-${pad(month || 1)}-${pad(day || 1)}`;
  if (kind === "month") return `${year}-${pad(month || 1)}`;

  const h = String(hint).toLowerCase();
  if (/yyyy[-/]mm[-/]dd/.test(h)) return `${year}-${pad(month || 1)}-${pad(day || 1)}`;
  if (/dd[-/]mm[-/]yyyy/.test(h)) return `${pad(day || 1)}/${pad(month || 1)}/${year}`;
  if (/mm[-/]dd[-/]yyyy/.test(h)) return `${pad(month || 1)}/${pad(day || 1)}/${year}`;
  if (/mm[-/]yyyy/.test(h)) return `${pad(month || 1)}/${year}`;
  if (/^yyyy$/.test(h.trim())) return String(year);

  if (month && day) return `${pad(month)}/${pad(day)}/${year}`;
  if (month) return `${pad(month)}/${year}`;
  return String(year);
}

/** Value for one part of a split month/day/year control. */
export function datePartValue(parts, part) {
  if (!parts) return "";
  if (part === "year") return parts.year ? String(parts.year) : "";
  if (part === "day") return parts.day ? String(parts.day) : "1";
  if (part === "month") return parts.month ? String(parts.month) : "";
  return "";
}
