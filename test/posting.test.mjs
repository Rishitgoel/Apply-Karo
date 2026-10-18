// Captured-posting tests — node test/posting.test.mjs
//
// Two things, both of which fail silently in the browser if they break:
//
//  * postingFromPage must survive being handed to executeScript. The service
//    worker injects it into pages the engine is never loaded onto — a job
//    listing has no form on it — and executeScript serialises the function and
//    nothing else. A module-level constant it closed over would simply be
//    undefined on the other side, and the symptom is an empty capture on every
//    site, with no error anywhere. So it is run here the way Chrome runs it:
//    re-parsed from its own source, with no module scope behind it.
//
//  * the job slot's rule about what a new posting keeps. A match and a letter
//    belong to the posting they were made for, and the expensive failure is a
//    letter written for the last job quietly surviving into the next one.

import { postingFromPage, MIN_JD_CHARS } from "../src/shared/posting.js";
import { loadJob, saveJob, patchJob, setJob, clearJob, DEFAULT_JOB } from "../src/shared/schema.js";

let pass = 0, fail = 0;
const check = (desc, got, want) => {
  const g = typeof got === "object" ? JSON.stringify(got) : String(got);
  const w = typeof want === "object" ? JSON.stringify(want) : String(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`  FAIL  ${desc}\n        expected: ${w}\n        got:      ${g}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// A page, in the shape the reader actually touches
// ─────────────────────────────────────────────────────────────────────────────

const BODY = [
  "About the role", "We own the payments service end to end.",
  "Requirements:", "Five years of backend experience.", "Strong Postgres.",
  "You will be trusted with production from week one, and nobody here is on call alone."
].join("\n");

/** The posting container, plus the form controls the reader has to cut out. */
function makeScope(text) {
  return {
    textContent: `${text}\nWork authorization Submit Application`,
    cloneNode() {
      const copy = {
        textContent: `${text}\n   Work authorization   Submit Application`,
        querySelectorAll: () => [{
          // Standing in for the form/input/button nodes: removing them takes
          // their text with them, which is the property under test.
          remove() { copy.textContent = text; }
        }]
      };
      return copy;
    }
  };
}

function makeDoc({ text = BODY, hostname = "boards.greenhouse.io", h1 = "Backend Engineer",
                   siteName = null, title = "Backend Engineer at Acme | Greenhouse" } = {}) {
  const scope = makeScope(text);
  return {
    title,
    defaultView: {
      location: { hostname, href: `https://${hostname}/acme/jobs/1?src=li#apply` }
    },
    body: scope,
    querySelector(sel) {
      if (sel.startsWith("meta")) return siteName ? { getAttribute: () => siteName } : null;
      if (sel === "h1") return h1 ? { textContent: h1 } : null;
      if (sel === "main") return scope;
      return null;                       // nothing more specific on this page
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read as a module
// ─────────────────────────────────────────────────────────────────────────────

{
  const p = postingFromPage(makeDoc());
  check("reads the posting", /own our payments service|own the payments service/.test(p.text), true);
  check("keeps the stated requirements", /Five years of backend experience/.test(p.text), true);
  check("drops the form's labels", /Work authorization/.test(p.text), false);
  check("drops the submit button", /Submit Application/.test(p.text), false);
  check("long enough to send", p.text.length >= MIN_JD_CHARS, true);

  check("names the employer from the board host", p.company, "Greenhouse");
  check("takes the role from the heading", p.role, "Backend Engineer");
  check("keeps the query string, drops the fragment",
    p.url, "https://boards.greenhouse.io/acme/jobs/1?src=li");
  check("host loses www and nothing else", p.host, "boards.greenhouse.io");
}

{
  const p = postingFromPage(makeDoc({ siteName: "Acme Corp" }));
  check("og:site_name wins over the host", p.company, "Acme Corp");
}

{
  const p = postingFromPage(makeDoc({ h1: null }));
  check("no heading falls back to the title", p.role, "Backend Engineer at Acme");
}

{
  const p = postingFromPage(makeDoc(), { text: false });
  check("text:false still names the employer", p.company, "Greenhouse");
  check("text:false skips the extraction", p.text, "");
}

{
  const p = postingFromPage(makeDoc({ text: "Apply now." }));
  check("a page with no posting on it yields nothing usable", p.text.length < MIN_JD_CHARS, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Read the way executeScript reads it
//
// Re-parsed from source with no module scope behind it. This is the whole
// contract: if anyone lifts a constant out of the function body, this throws
// ReferenceError here rather than capturing nothing, forever, in production.
// ─────────────────────────────────────────────────────────────────────────────

{
  let injected = null, threw = null;
  try {
    // eslint-disable-next-line no-new-func
    injected = new Function(`return (${postingFromPage.toString()});`)();
  } catch (e) {
    threw = `${e.name}: ${e.message}`;
  }
  check("the function re-parses on its own", threw, null);

  let result = null;
  try {
    result = injected(makeDoc());
  } catch (e) {
    result = `${e.name}: ${e.message}`;
  }
  check("and runs with no module scope behind it",
    typeof result === "object" && result !== null, true);
  check("returning the same posting it does as a module",
    result?.text, postingFromPage(makeDoc()).text);
  check("and the same employer", result?.company, "Greenhouse");
}

// ─────────────────────────────────────────────────────────────────────────────
// The job slot
// ─────────────────────────────────────────────────────────────────────────────

{
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        },
        async set(patch) { Object.assign(store, patch); },
        async remove(key) { delete store[key]; }
      }
    }
  };

  const LONG = BODY.repeat(4);

  check("an empty slot reads as the default", (await loadJob()).text, "");

  await setJob({ text: LONG, url: "https://acme.test/jobs/1", company: "Acme", role: "Backend", source: "capture" });
  let job = await loadJob();
  check("a captured posting is stored", job.text, LONG);
  check("with its source", job.source, "capture");
  check("and a timestamp", job.ts > 0, true);

  await patchJob({ match: { score: 71, ts: 5 }, letter: "Dear Acme", letterTs: 6 });
  job = await loadJob();
  check("a result can be written back without disturbing the text", job.text, LONG);
  check("the match is kept", job.match.score, 71);

  await setJob({ text: LONG, url: "https://acme.test/jobs/1", company: "Acme", role: "Backend", source: "page" });
  job = await loadJob();
  check("re-reading the same posting keeps its match", job.match?.score, 71);
  check("and keeps its letter", job.letter, "Dear Acme");

  await setJob({ text: LONG, url: "https://beta.test/jobs/9", company: "Beta", role: "Frontend", source: "capture" });
  job = await loadJob();
  check("a different posting drops the old match", job.match, null);
  check("and the old letter", job.letter, "");
  check("and takes the new employer", job.company, "Beta");

  await saveJob({ ...DEFAULT_JOB, text: "x".repeat(20000) });
  check("stored text is capped", (await loadJob()).text.length, 9000);

  await clearJob();
  check("forgetting it empties the slot", (await loadJob()).text, "");
  check("and leaves a whole default behind", (await loadJob()).source, "");
}

console.log(`\n  ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
