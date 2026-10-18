// Sentinel tests — node test/detect.test.mjs
//
// detect.js is a classic content script, not a module, so it is executed here
// inside a stub environment. This suite exists because the two bugs that made
// "Fill this page" fail on a Google Form were both in this file and neither was
// covered: the force-load listener sat behind an early return, and a later edit
// referenced an identifier that was never defined — a ReferenceError that would
// have thrown on *every* page load.

import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/detect.js", import.meta.url), "utf8");

let pass = 0;
const fails = [];
const check = (desc, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else fails.push({ desc, got: g, want: w });
};

/**
 * Run detect.js against a fake page.
 * Returns what it did: whether it registered a listener, whether it tried to
 * load the engine, and a handle to invoke the listener.
 */
function runSentinel({ href, controls = [], shadow = [], bodyText = "" }) {
  const url = new URL(href);
  const listeners = [];
  let importedEngine = false;
  let idleScheduled = null;

  const matches = (el, sel) =>
    sel.split(",").some((s) => {
      s = s.trim();
      if (s === "*") return true;
      const role = s.match(/^\[role="([^"]+)"\]$/);
      if (role) return el.role === role[1];
      return s.split(":")[0].toLowerCase() === (el.tag || "").toLowerCase();
    });

  const query = (pool) => (sel) => pool.filter((c) => matches(c, sel));

  // One custom element hosting an open shadow root, present only when the case
  // asks for it. `querySelectorAll("*")` has to return the host for the sentinel
  // to have anything to find — which is exactly the walk it is doing.
  const shadowHost = shadow.length
    ? { tag: "acme-form", shadowRoot: { querySelectorAll: query(shadow) } }
    : null;

  const doc = {
    querySelectorAll: (sel) =>
      (sel === "*" ? [...controls, ...(shadowHost ? [shadowHost] : [])] : controls)
        .filter((c) => matches(c, sel)),
    body: { textContent: bodyText, innerText: bodyText },
    documentElement: {}
  };

  const win = {
    location: { hostname: url.hostname, pathname: url.pathname, search: url.search, href },
    requestIdleCallback: (fn) => { idleScheduled = fn; },
    __applyKaroSeen: undefined
  };

  const chrome = {
    runtime: {
      getURL: (p) => `chrome-extension://x/${p}`,
      onMessage: { addListener: (fn) => listeners.push(fn) },
      // The engine no longer arrives by dynamic import — detect.js asks the
      // service worker to inject it, because a web-accessible engine is a URL
      // any page can probe to detect the extension. So "did it try to load the
      // engine" is now "did it send rf_inject".
      sendMessage: (msg) => {
        if (msg?.type === "rf_inject") importedEngine = true;
        return Promise.resolve({ ok: true });
      }
    }
  };

  new Function("window", "document", "chrome", "location", "MutationObserver",
               "setTimeout", "self",
    `${SRC}`
  )(win, doc, chrome, win.location,
    function () { return { observe() {}, disconnect() {} }; },
    (fn) => { if (typeof fn === "function") idleScheduled = idleScheduled || fn; return 0; },
    win);

  return {
    listenerCount: listeners.length,
    fireForceLoad: () => listeners.forEach((l) => l({ type: "rf_force_load" })),
    runIdle: () => { if (idleScheduled) idleScheduled(); },
    didImport: () => importedEngine
  };
}

const input = (type = "text") => ({ tag: "input", type });
const aria = (role) => ({ tag: "div", role });

// ── The reported bug: a page that fails every heuristic ──
{
  const s = runSentinel({ href: "https://docs.google.com/forms/d/e/abc/viewform", controls: [], bodyText: "" });
  check("force-load listener is registered even on an undetected page", s.listenerCount >= 1, true);
  s.fireForceLoad();
  check("and forcing actually loads the engine", s.didImport(), true);
}
{
  // A totally unrelated page still must accept a manual fill.
  const s = runSentinel({ href: "https://example.com/some/random/page", controls: [], bodyText: "" });
  check("listener exists on an unrelated page too", s.listenerCount >= 1, true);
  s.fireForceLoad();
  check("manual fill works anywhere", s.didImport(), true);
}

// ── No ReferenceError on load (the GENERIC_FORM_HOST regression) ──
for (const href of ["https://example.com/", "https://boards.greenhouse.io/acme/jobs/1",
                    "https://docs.google.com/forms/d/e/abc/viewform", "https://news.site/article/123"]) {
  let threw = null;
  try { runSentinel({ href, controls: [], bodyText: "" }); } catch (e) { threw = e.message; }
  check(`loads without throwing: ${new URL(href).hostname}`, threw, null);
}

// ── Auto-detection ──
{
  // Google Form built from ARIA widgets, reading as a job application.
  const s = runSentinel({
    href: "https://docs.google.com/forms/d/e/abc/viewform",
    controls: [aria("textbox"), aria("textbox"), aria("radiogroup")],
    bodyText: "Please upload your resume and tell us about your work authorization"
  });
  s.runIdle();
  check("auto-detects an application-shaped Google Form", s.didImport(), true);
}
{
  // Same host, ordinary survey — must NOT auto-fill unasked.
  const s = runSentinel({
    href: "https://docs.google.com/forms/d/e/xyz/viewform",
    controls: [aria("textbox"), aria("radiogroup")],
    bodyText: "What would you like for lunch on Friday?"
  });
  s.runIdle();
  check("does not auto-fill an unrelated Google Form", s.didImport(), false);
}
{
  const s = runSentinel({
    href: "https://boards.greenhouse.io/acme/jobs/123",
    controls: [input(), input(), input("file")],
    bodyText: "Apply for this job"
  });
  s.runIdle();
  check("auto-detects a Greenhouse application", s.didImport(), true);
}
{
  const s = runSentinel({
    href: "https://example.com/login",
    controls: [input("email"), input("password")],
    bodyText: "Sign in to your account"
  });
  s.runIdle();
  check("ignores a sign-in page", s.didImport(), false);
}

// ── Host / URL gating ────────────────────────────────────────────────────────
//
// The gate decides whether the automatic probe runs at all, so a host missing
// from it is a site where the extension silently does nothing on load. These
// pull the three regexes straight out of the source rather than restating them,
// because a copy in the test would happily keep passing after the real one
// regressed.
{
  const grab = (name, re) => {
    const m = SRC.match(re);
    if (!m) throw new Error(`could not find ${name} in detect.js`);
    return new Function(`return ${m[1]}`)();
  };
  const ATS_HOST = grab("ATS_HOST", /const ATS_HOST = (new RegExp\([\s\S]*?"i"\));/);
  const GENERIC = grab("GENERIC_FORM_HOST", /const GENERIC_FORM_HOST = (\/.*\/i);/);
  const URL_HINT = grab("URL_HINT", /const URL_HINT = (\/.*\/i);/);
  const HOST_HINT = grab("HOST_HINT", /const HOST_HINT = (\/.*\/i);/);

  /** Would detect.js get as far as running its structural probe here? */
  const gated = (href) => {
    const u = new URL(href);
    return !ATS_HOST.test(u.hostname) &&
           !GENERIC.test(u.hostname) &&
           !URL_HINT.test(u.pathname + u.search) &&
           !HOST_HINT.test(u.hostname);
  };

  // Application flows that must at least be looked at.
  for (const href of [
    "https://smartapply.indeed.com/beta/indeedapply/form/questions/1",
    "https://www.indeed.com/viewjob?jk=abc123",
    "https://www.linkedin.com/jobs/view/4012345678/",
    "https://job-boards.greenhouse.io/acme/jobs/12345",
    "https://boards.eu.greenhouse.io/acme/jobs/1",
    "https://jobs.lever.co/acme/uuid/apply",
    "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/X/Apply",
    "https://jobs.ashbyhq.com/acme/uuid/application",
    "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=x",
    "https://acme.rec.pro.ukg.net/ACM1/JobBoard/x/OpportunityDetail",
    "https://acme.dayforcehcm.com/CandidatePortal/en-US/acme/Posting/View/123",
    "https://acme.csod.com/ux/ats/careersite/4/home/requisition/99",
    "https://performancemanager.successfactors.eu/sfcareer/jobreqcareer?jobId=1",
    "https://fa-abcd.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123",
    "https://acme.zohorecruit.com/jobs/Careers/123/engineer",
    "https://acme.darwinbox.in/ms/candidate/careers/x",
    "https://acme.gupy.io/job/eyJ",
    "https://forms.office.com/r/abc123",
    // A company's own board. Its landing path is "/", which a path-only test
    // could never gate in — the hostname is the only signal there is.
    "https://careers.acme.com/",
    "https://jobs.acme.io/",
    "https://apply.acme.co.uk/"
  ]) {
    check(`probes an application host: ${new URL(href).hostname}`, gated(href), false);
  }

  // Ordinary browsing must stay at one regex test.
  for (const href of [
    "https://news.ycombinator.com/item?id=1",
    "https://mail.google.com/mail/u/0/",
    "https://github.com/anthropics/claude-code",
    "https://www.amazon.com/gp/cart/view.html",
    "https://www.keka.com/",
    "https://www.adp.com/",
    "https://x.com/home"
  ]) {
    check(`skips ordinary browsing: ${new URL(href).hostname}`, gated(href), true);
  }

  // Indeed's search page has two fillable boxes. A host-level ATS entry would
  // make it an application by definition and autofill someone's name into a job
  // search, so the apply subdomain is listed and the bare host deliberately is not.
  check("indeed.com is not an ATS host by itself", ATS_HOST.test("www.indeed.com"), false);
  check("but its apply flow is", ATS_HOST.test("smartapply.indeed.com"), true);
}

// ── Shadow-DOM forms ─────────────────────────────────────────────────────────
{
  // A form built out of custom elements. querySelectorAll does not cross a
  // shadow boundary, so the light DOM looks empty — and the engine that *does*
  // understand shadow roots never got loaded to find out otherwise.
  const s = runSentinel({
    href: "https://acme.csod.com/ux/ats/careersite/4/home/requisition/99",
    controls: [],
    shadow: [input(), input(), input("file")],
    bodyText: "Upload your resume to apply for this job"
  });
  s.runIdle();
  check("finds a form inside an open shadow root", s.didImport(), true);
}

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
process.exit(fails.length ? 1 : 0);
