// ResumeFiler — detection sentinel.
//
// This is the ONLY script the manifest injects, and it runs in every frame of
// every page you visit — so it is deliberately dependency-free and does as
// little as possible. Its single job is to decide whether this frame holds a
// job application; the ~40 KB engine is dynamically imported only if it does.
//
// v1 instead injected four scripts totalling ~110 KB into every frame of every
// page, then immediately started a document-wide MutationObserver. That cost
// was paid continuously while browsing, on pages with no form at all.

(() => {
  if (window.__resumeFilerSeen) return;
  window.__resumeFilerSeen = true;

  // Hosts where a form is an application by definition.
  const ATS_HOST = /(^|\.)(greenhouse\.io|lever\.co|myworkdayjobs\.com|myworkdaysite\.com|ashbyhq\.com|workable\.com|smartrecruiters\.com|icims\.com|taleo\.net|jobvite\.com|breezy\.hr|recruitee\.com|bamboohr\.com|teamtailor\.com|personio\.(com|de)|join\.com|pinpointhq\.com|dover\.com|wellfound\.com|jobs\.ashbyhq\.com|applytojob\.com|jazz\.co|hire\.withgoogle\.com|eightfold\.ai|phenompeople\.com|avature\.net|successfactors\.com|oraclecloud\.com)$/i;

  // General-purpose form builders. Employers routinely run applications through
  // these, and their URLs carry no job-related words at all — a Google Form is
  // just /forms/d/e/<id>/viewform — so the URL heuristic can never catch them.
  const GENERIC_FORM_HOST = /(^|\.)(docs\.google\.com|forms\.gle|typeform\.com|jotform\.com|airtable\.com|tally\.so|fillout\.com|formstack\.com|wufoo\.com|surveymonkey\.com|zohopublic\.com|smartsheet\.com|notion\.so)$/i;

  const URL_HINT = /\/(apply|application|applications|job|jobs|career|careers|vacanc|opening|position|recruit|candidate)(\/|$|\?)|gh_jid|lever-|\bjobId=|\/forms\/|\/viewform/i;

  const TEXT_HINT = /\b(resume|cv|cover letter|work authorization|apply for|application form|first name)\b/i;

  const hostIsATS = ATS_HOST.test(location.hostname);
  const urlHints = URL_HINT.test(location.pathname + location.search);

  let probes = 0;
  let observer = null;

  /** Cheap structural probe — no computed styles, no layout reads. */
  function looksLikeApplication() {
    const inputs = document.querySelectorAll("input,select,textarea");

    let fillable = 0;
    let hasFile = false;
    let hasPassword = false;

    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i];
      const t = (el.type || "text").toLowerCase();
      if (t === "hidden" || t === "submit" || t === "button" || t === "reset") continue;
      if (el.disabled) continue;
      if (t === "password") { hasPassword = true; continue; }
      if (t === "file") hasFile = true;
      fillable++;
    }

    // Form builders render most controls as ARIA widgets rather than real
    // inputs, so a native-only count reports an empty page on exactly the forms
    // that need help most.
    fillable += document.querySelectorAll(
      '[role="textbox"],[role="radiogroup"],[role="listbox"],[role="combobox"]'
    ).length;

    if (fillable < 2) return false;

    // Sign-in and sign-up forms are the main false positive; they are small and
    // password-bearing, and never carry a file upload.
    if (hasPassword && fillable <= 3 && !hasFile) return false;

    if (hostIsATS && fillable >= 2) return true;
    if (hasFile && fillable >= 2) return true;

    // textContent, not innerText — innerText forces a reflow.
    const text = document.body?.textContent?.slice(0, 6000) || "";

    // On a general form builder, only auto-fill when the page reads as a job
    // application. A Google Form is just as likely to be a lunch order, and
    // typing someone's contact details into that unasked is worse than doing
    // nothing. The toolbar button still forces a fill anywhere.
    if (GENERIC_FORM_HOST.test(location.hostname)) return TEXT_HINT.test(text);

    return fillable >= 4 && TEXT_HINT.test(text);
  }

  function start() {
    observer?.disconnect();
    observer = null;
    import(chrome.runtime.getURL("src/engine/index.js"))
      .then((m) => m.boot())
      .catch((err) => console.warn("ResumeFiler: engine failed to load —", err));
  }

  function probe() {
    if (looksLikeApplication()) { start(); return true; }
    return false;
  }

  // The popup can always force the engine in, on ANY page, regardless of what
  // the heuristics below decide — this must be registered unconditionally.
  // It previously sat after the `hostIsATS`/`urlHints` gate below, so a page
  // that failed the heuristic (a Google Form used for an application, a
  // careers page on an unlisted host, ...) had no listener at all: the popup's
  // force-load message found no receiver and failed instantly, which is why
  // "Fill this page" reported "Can't run here" instead of actually retrying.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "rf_force_load") start();
  });

  // A page with no URL signal and no ATS/known-form host is almost never an
  // application — skip the automatic probe there. Bailing here means the vast
  // majority of browsing costs one regex test; it does NOT skip registering
  // the listener above, so a manual "Fill this page" still works everywhere.
  if (!hostIsATS && !urlHints && !GENERIC_FORM_HOST.test(location.hostname)) return;

  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 150));

  idle(() => {
    if (probe()) return;

    // Single-page job boards (and form builders that render late) fill in
    // their fields after routing. Watch briefly, then give up.
    observer = new MutationObserver(() => {
      if (++probes > 30) { observer.disconnect(); observer = null; return; }
      probe();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer?.disconnect(); observer = null; }, 20000);
  }, { timeout: 1500 });
})();
