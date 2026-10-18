// Apply karo — detection sentinel.
//
// This is the ONLY script the manifest injects, and it runs in every frame of
// every page you visit — so it is deliberately dependency-free and does as
// little as possible. Its single job is to decide whether this frame holds a
// job application; the engine is injected by the service worker only if it does.
//
// v1 instead injected four scripts totalling ~110 KB into every frame of every
// page, then immediately started a document-wide MutationObserver. That cost
// was paid continuously while browsing, on pages with no form at all.

(() => {
  if (window.__applyKaroSeen) return;
  window.__applyKaroSeen = true;

  // Hosts where a form is an application by definition.
  //
  // Entries are matched against the *whole* hostname with a `$` anchor and an
  // optional leading dot, so `greenhouse.io` covers `job-boards.greenhouse.io`
  // and `boards.eu.greenhouse.io` without listing either.
  //
  // A host only belongs here when a form on it is an application *and nothing
  // else*. That is why `indeed.com` is not in the list but `smartapply.indeed.com`
  // is: Indeed's search page has two fillable boxes ("what" and "where") and a
  // host-level entry would auto-fill a job search with someone's name.
  const ATS_HOST = new RegExp("(^|\\.)(" + [
    // The big five
    "greenhouse\\.io", "lever\\.co", "myworkdayjobs\\.com", "myworkdaysite\\.com", "myworkday\\.com",
    "ashbyhq\\.com",
    // Mid-market SaaS boards
    "workable\\.com", "smartrecruiters\\.com", "icims\\.com", "taleo\\.net",
    "jobvite\\.com", "breezy\\.hr", "recruitee\\.com", "bamboohr\\.com",
    "teamtailor\\.com", "personio\\.(com|de)", "join\\.com", "pinpointhq\\.com",
    "dover\\.com", "wellfound\\.com", "applytojob\\.com", "jazz\\.co",
    "hire\\.withgoogle\\.com", "eightfold\\.ai", "phenompeople\\.com",
    "avature\\.net", "jobscore\\.com", "clearcompany\\.com", "applicantpro\\.com",
    "trakstar\\.com", "rippling-ats\\.com", "manatal\\.com", "talentlyft\\.com",
    "factorialhr\\.com", "heyjobs\\.co", "polymer\\.co", "workwithus\\.io",
    // Enterprise HCM suites. These are where the long, multi-step, badly
    // labelled applications live, and none of them were reached before.
    "successfactors\\.(com|eu)", "sapsf\\.(com|eu)", "oraclecloud\\.com",
    "csod\\.com", "brassring\\.com", "dayforcehcm\\.com", "ultipro\\.com",
    "ukg\\.net", "recruiting\\.paylocity\\.com", "paycomonline\\.net",
    "workforcenow\\.adp\\.com", "myjobs\\.adp\\.com",
    "silkroad\\.com", "jobdiva\\.com", "peoplefluent\\.com",
    // India / APAC volume boards
    "zohorecruit\\.(com|in|eu)", "freshteam\\.com", "darwinbox\\.(com|in)",
    "instahyre\\.com", "cutshort\\.io", "hirist\\.(com|tech)",
    // LatAm / EU
    "gupy\\.io", "kenoby\\.com", "solides\\.com\\.br", "softgarden\\.io",
    // Indeed's apply flow only — never indeed.com itself, see above.
    "smartapply\\.indeed\\.com", "apply\\.indeed\\.com"
  ].join("|") + ")$", "i");

  // General-purpose form builders. Employers routinely run applications through
  // these, and their URLs carry no job-related words at all — a Google Form is
  // just /forms/d/e/<id>/viewform — so the URL heuristic can never catch them.
  const GENERIC_FORM_HOST = /(^|\.)(docs\.google\.com|forms\.gle|typeform\.com|jotform\.com|airtable\.com|tally\.so|fillout\.com|formstack\.com|wufoo\.com|surveymonkey\.com|zohopublic\.com|smartsheet\.com|notion\.so|paperform\.co|cognitoforms\.com|forms\.office\.com|forms\.microsoft\.com|forms\.app|zeffy\.com)$/i;

  const URL_HINT = /\/(apply|application|applications|job|jobs|career|careers|vacanc|opening|position|positions|recruit|recruitment|recruiting|candidate|candidateportal|posting|postings|requisition|internship|hiring|talent|joinus|join-us|work-with-us|prescreen|gethired|indeedapply)(\/|$|\?)|gh_jid|lever-|\bjobId=|\breq(uisition)?[Ii]d=|\/forms?\/|\/viewform|\/viewjob|smartapply/i;

  const TEXT_HINT = /\b(resume|résumé|cv|cover letter|work authorization|work authorisation|apply for|application form|first name|full name|legal name|desired salary|notice period|why do you want to work|linkedin|github|portfolio|years of experience)\b/i;

  // The same words, in the hostname rather than the path. A company's own board
  // is almost always at careers.acme.com or jobs.acme.com, and its landing path
  // is just "/" — so a path-only test gated out the entire self-hosted category,
  // which is where a great many applications actually live.
  const HOST_HINT = /(^|[.-])(careers?|jobs?|apply|applicants?|recruit(ing|ment)?|hiring|talent|joinus|workfor|worka?t)([.-])/i;

  const hostIsATS = ATS_HOST.test(location.hostname);
  const urlHints = URL_HINT.test(location.pathname + location.search) ||
                   HOST_HINT.test(location.hostname);

  let probes = 0;
  let observer = null;

  const ARIA_CONTROL =
    '[role="textbox"],[role="radiogroup"],[role="listbox"],[role="combobox"],[role="switch"],[role="checkbox"]';

  /**
   * Count fillable controls under one root. Kept separate from the caller so the
   * same accounting can be run again inside shadow roots.
   */
  function countIn(root, tally) {
    let inputs;
    try { inputs = root.querySelectorAll("input,select,textarea"); } catch { return; }

    for (let i = 0; i < inputs.length; i++) {
      const el = inputs[i];
      const t = (el.type || "text").toLowerCase();
      if (t === "hidden" || t === "submit" || t === "button" || t === "reset") continue;
      if (el.disabled) continue;
      if (t === "password") { tally.hasPassword = true; continue; }
      if (t === "file") tally.hasFile = true;
      tally.fillable++;
    }

    // Form builders render most controls as ARIA widgets rather than real
    // inputs, so a native-only count reports an empty page on exactly the forms
    // that need help most.
    try { tally.fillable += root.querySelectorAll(ARIA_CONTROL).length; } catch { /* ignore */ }
  }

  /**
   * The same count again, this time inside open shadow roots.
   *
   * `querySelectorAll` does not cross a shadow boundary, so a form built out of
   * custom elements — Oracle, SAP and several design systems ship them — looks
   * like an empty page to the probe above, and the engine that *does* understand
   * shadow DOM never gets loaded to find out otherwise.
   *
   * This materialises every element in the document, which is the expensive thing
   * this file exists to avoid, so it is a last resort: only on a page that already
   * passed the host/URL gate, and only when the light DOM came back near-empty.
   */
  function countInShadows(tally) {
    let all;
    try { all = document.querySelectorAll("*"); } catch { return; }
    if (all.length > 8000) return;                // pathological page, not worth it

    const roots = [];
    for (let i = 0; i < all.length && roots.length < 60; i++) {
      if (all[i].shadowRoot) roots.push(all[i].shadowRoot);
    }
    for (const r of roots) countIn(r, tally);
  }

  /** Cheap structural probe — no computed styles, no layout reads. */
  function looksLikeApplication() {
    const tally = { fillable: 0, hasFile: false, hasPassword: false };
    countIn(document, tally);
    if (tally.fillable < 2) countInShadows(tally);

    const { fillable, hasFile, hasPassword } = tally;
    if (fillable < 2) return false;

    // Sign-in and sign-up forms are the main false positive; they are small and
    // password-bearing, and never carry a file upload.
    if (hasPassword && fillable <= 3 && !hasFile) return false;

    if (hostIsATS && fillable >= 2) return true;
    if (hasFile && fillable >= 2) return true;

    // textContent, not innerText — innerText forces a reflow. The slice bounds
    // the regex, not the read: `textContent` has already built the whole string
    // by the time we get here, so a larger window is free. 6 000 characters was
    // not enough on a heavy board — LinkedIn and Workday spend that much on
    // chrome before the form's own words start.
    const text = document.body?.textContent?.slice(0, 40000) || "";
    const ordinary = /\b(checkout|shopping cart|payment details|sign in|log in|reset password)\b/i.test(text);
    const employment = /\b(job application|employment application|apply for (this|the) (job|role|position)|resume|résumé|curriculum vitae|cover letter|work authori[sz]ation)\b/i.test(text);
    if (!hostIsATS && ordinary && !employment) return false;
    if (!hostIsATS && !urlHints && !GENERIC_FORM_HOST.test(location.hostname)) return !hasPassword && fillable >= 3 && employment;

    // On a general form builder, only auto-fill when the page reads as a job
    // application. A Google Form is just as likely to be a lunch order, and
    // typing someone's contact details into that unasked is worse than doing
    // nothing. The toolbar button still forces a fill anywhere.
    if (GENERIC_FORM_HOST.test(location.hostname)) return TEXT_HINT.test(text);

    return fillable >= 3 && TEXT_HINT.test(text);
  }

  /**
   * Ask the service worker to inject the engine into THIS frame.
   *
   * Not a dynamic import any more. That required listing the engine in
   * web_accessible_resources, which hands every page you visit a
   * chrome-extension://<id>/... URL it can probe to detect the extension.
   * `use_dynamic_url` was meant to close that hole and does hide the URL — but
   * Chrome will not serve a module-script fetch from the rotating GUID origin
   * it returns, so `import()` failed with "Failed to fetch dynamically imported
   * module" on every site and the engine never loaded at all.
   *
   * chrome.scripting.executeScript has neither problem: nothing is
   * web-accessible, so there is nothing to probe, and the file is injected
   * rather than fetched, so no page CSP sits in the way. The worker injects the
   * flattened classic build (src/engine/bundle.js, built by `node bundle.mjs`),
   * because executeScript cannot run ES modules.
   *
   * The bundle boots itself and is guarded against being injected twice, so
   * calling this more than once — automatic detection, then "Fill this page" —
   * is safe.
   */
  function start() {
    observer?.disconnect();
    observer = null;
    chrome.runtime.sendMessage({ type: "rf_inject" })
      // console.error, not warn: this is the one failure that makes every
      // button in the popup report "Couldn't reach the page", and a warning
      // nobody looks at is why that reads as an unexplained dead page rather
      // than a load error with a cause attached to it.
      .then((r) => {
        if (!r?.ok) console.error("Apply karo: engine failed to load —", r?.error || "no reply");
      })
      .catch((err) => console.error("Apply karo: engine failed to load —", err));
  }

  /**
   * Is the application on this page actually inside an iframe?
   *
   * Greenhouse, Lever, Workable and SmartRecruiters all offer an embed, and
   * employers use it constantly: the careers page is theirs and the form is a
   * third-party frame inside it. The frame passes detection on its own and fills
   * correctly — but the panel only mounts in the top frame, and the top frame
   * has no fields, so it saw an ordinary page and loaded nothing. The result was
   * a form that filled from the toolbar and had no on-page button at all.
   *
   * Checked against GENERIC_FORM_HOST too, not just ATS_HOST: a Google Form or
   * Typeform embedded via its own "Embed" snippet is the same shape, and this
   * file's own comment on GENERIC_FORM_HOST says employers "routinely" use one
   * for exactly this.
   *
   * Only the top frame asks this, and only after its own probe found nothing.
   */
  function hasEmbeddedApplication() {
    if (window !== window.top) return false;
    let frames;
    try { frames = document.querySelectorAll("iframe[src]"); } catch { return false; }
    for (let i = 0; i < frames.length && i < 30; i++) {
      let host;
      try { host = new URL(frames[i].src, location.href).hostname; } catch { continue; }
      if (ATS_HOST.test(host) || GENERIC_FORM_HOST.test(host)) return true;
    }
    return false;
  }

  function probe() {
    if (looksLikeApplication()) { start(); return true; }
    // Nothing to fill here, but something below us has plenty. Load the engine
    // so the panel exists; the fill itself is coordinated across frames.
    if (hasEmbeddedApplication()) { start(); return true; }
    return false;
  }

  // The popup can always force the engine in, on ANY page, regardless of what
  // the heuristics below decide — this must be registered unconditionally.
  // It previously sat after the `hostIsATS`/`urlHints` gate below, so a page
  // that failed the heuristic (a Google Form used for an application, a
  // careers page on an unlisted host, ...) had no listener at all: the popup's
  // force-load message found no receiver and failed instantly, which is why
  // "Fill this page" reported "Can't run here" instead of actually retrying.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "rf_force_load") return;
    chrome.runtime.sendMessage({ type: "rf_inject" }).then(sendResponse,
      (err) => sendResponse({ ok: false, state: "error", error: err.message }));
    return true;
  });

  // A page with no URL signal and no ATS/known-form host is almost never an
  // application — skip the automatic probe there. Bailing here means the vast
  // majority of browsing costs one regex test; it does NOT skip registering
  // the listener above, so a manual "Fill this page" still works everywhere.
  const unfamiliar = !hostIsATS && !urlHints && !GENERIC_FORM_HOST.test(location.hostname);

  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 150));

  /**
   * Does this mutation batch plausibly change the answer?
   *
   * The old budget was 30 mutation *batches*, spent regardless of what was in
   * them. A React board burns that inside its first second of hydration — long
   * before the application form itself renders — so the watcher was routinely
   * exhausted and disconnected on exactly the single-page boards it was added
   * for. Counting only batches that brought in controls (or a shadow host, or a
   * route change) makes the budget mean what it says.
   */
  // ARIA_CONTROL plus the individual roles a group is made of — a `<div
  // role="radiogroup">` containing `<div role="radio">` children is exactly
  // the shape Google Forms and similar builders render one question as, and
  // neither half of it was watched for below without these.
  const WORTH_PROBING_SELECTOR =
    "input,select,textarea," + ARIA_CONTROL + ',[role="radio"],[role="checkbox"]';

  function worthProbing(records) {
    for (const r of records) {
      const added = r.addedNodes;
      for (let i = 0; i < added.length; i++) {
        const n = added[i];
        if (n.nodeType !== 1) continue;
        if (n.shadowRoot) return true;
        const tag = n.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "FORM") return true;
        // The added node can BE the control — a whole question appended as one
        // already-populated unit — not just contain one somewhere inside it.
        // `querySelector` only searches descendants, so that case needs its
        // own check.
        if (n.matches?.(WORTH_PROBING_SELECTOR)) return true;
        if (n.querySelector?.(WORTH_PROBING_SELECTOR)) return true;
      }
    }
    return false;
  }

  idle(() => {
    if (probe()) return;
    if (unfamiliar) {
      const tally = { fillable: 0, hasFile: false, hasPassword: false };
      countIn(document, tally);
      // No long-lived observer on ordinary articles or account pages.
      if (tally.fillable < 2 || tally.hasPassword) return;
    }

    // Single-page job boards (and form builders that render late) fill in their
    // fields after routing. Watch briefly, then give up.
    let deadline = Date.now() + (unfamiliar ? 8000 : 25000);
    let seenUrl = location.href;

    const stop = () => { observer?.disconnect(); observer = null; };

    observer = new MutationObserver((records) => {
      // A client-side route change is the other thing that makes this page a
      // different page. History is not patchable from an isolated world, so the
      // URL is compared here instead — and a new route resets the budget,
      // because browsing a board and then opening a posting is one of the most
      // ordinary ways to arrive at an application.
      if (location.href !== seenUrl) {
        seenUrl = location.href;
        probes = 0;
        deadline = Date.now() + 25000;
      } else if (!worthProbing(records)) {
        return;
      }

      if (Date.now() > deadline || ++probes > 40) { stop(); return; }
      probe();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // A hard outer cap, so a page that never stops mutating cannot keep this
    // alive forever.
    setTimeout(stop, unfamiliar ? 10000 : 120000);
  }, { timeout: 1500 });
})();
