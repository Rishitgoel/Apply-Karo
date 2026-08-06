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
function runSentinel({ href, controls = [], bodyText = "" }) {
  const url = new URL(href);
  const listeners = [];
  let importedEngine = false;
  let idleScheduled = null;

  const matches = (el, sel) =>
    sel.split(",").some((s) => {
      s = s.trim();
      const role = s.match(/^\[role="([^"]+)"\]$/);
      if (role) return el.role === role[1];
      return s.split(":")[0].toLowerCase() === (el.tag || "").toLowerCase();
    });

  const doc = {
    querySelectorAll: (sel) => controls.filter((c) => matches(c, sel)),
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
      onMessage: { addListener: (fn) => listeners.push(fn) }
    }
  };

  const sandboxImport = () => { importedEngine = true; return Promise.resolve({ boot() {} }); };

  // detect.js uses bare `import(...)`, which is illegal in a Function body, so
  // route it through an injected helper without altering any logic under test.
  const code = SRC.replace(/\bimport\(chrome\.runtime\.getURL\(([^)]*)\)\)/g, "__imp($1)");

  new Function("window", "document", "chrome", "location", "MutationObserver",
               "setTimeout", "__imp", "self",
    `${code}`
  )(win, doc, chrome, win.location,
    function () { return { observe() {}, disconnect() {} }; },
    (fn) => { if (typeof fn === "function") idleScheduled = idleScheduled || fn; return 0; },
    sandboxImport, win);

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

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
process.exit(fails.length ? 1 : 0);
