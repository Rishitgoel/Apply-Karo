// Apply karo — reading a posting off a page.
//
// A job description is almost never on the page you apply from. You read the
// posting on the listing page, press "Apply now", and the form you land on
// repeats the company boilerplate at best. The listing page has no form on it,
// so detection never loads the engine there — which left the one page holding
// the description as the one page nothing could read it from.
//
// So this lives outside the engine, and `postingFromPage` is written to survive
// being handed to chrome.scripting.executeScript({ func }). That is the only way
// onto a page the engine has no business being injected into, and it comes with
// one hard rule:
//
//   `postingFromPage` MUST NOT reference anything outside its own body.
//
// executeScript serialises the function and nothing else — a module-level
// constant it closed over would simply be undefined on the other side, and the
// failure would be a silent empty result rather than an error. Everything it
// needs is therefore declared inside it, and the smaller helpers below are
// written in terms of it rather than the other way round.

/** Enough of a posting to be worth sending. Shared by the match and the letter. */
export const MIN_JD_CHARS = 200;

/**
 * The posting on this page: its text, and who it is from.
 *
 * @param {Document} [doc]
 * @param {{text?: boolean}} [opts]  text:false skips the expensive extraction
 *   for callers that only want the company and role.
 * @returns {{host:string, company:string, role:string, title:string,
 *            text:string, url:string}}
 */
export function postingFromPage(doc = document, opts = {}) {
  const wantText = opts.text !== false;
  const loc = doc.defaultView?.location || location;

  // ── Who this posting is from ───────────────────────────────────────────────
  const host = loc.hostname.replace(/^www\./, "");
  const siteName =
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content")?.trim() || "";
  const company = siteName ||
    // Greenhouse and Lever both put the employer in the boilerplate host.
    (host.match(/^(?:job-boards|boards|jobs|careers|apply)\.(.+)$/)?.[1] || host).split(".")[0];

  const title = (doc.title || "").trim();
  const heading = doc.querySelector("h1")?.textContent?.trim() || "";
  // A heading is usually the role; a <title> is usually "Role at Company | Board".
  const role = (heading || title.split(/\s+[|–—]\s+/)[0] || "").slice(0, 120);

  const identity = {
    host,
    company: company.charAt(0).toUpperCase() + company.slice(1),
    role,
    title: title.slice(0, 160),
    url: loc.href.split("#")[0].slice(0, 500)
  };
  if (!wantText) return { ...identity, text: "" };

  // ── The posting itself ─────────────────────────────────────────────────────
  //
  // Containers that hold the description, most specific first. `main` and
  // `article` exist on plenty of ATS pages that also wrap the form, so they are
  // the fallback rather than the answer.
  const containers = [
    "[class*=job-description]", "[class*=jobDescription]", "[data-testid*=description]",
    "[data-automation-id*=jobPostingDescription]", "#job-details", "[class*=posting-content]",
    "[class*=job-post]", "[class*=jobPost]", "article", "main"
  ];

  let scope = null;
  for (const sel of containers) {
    const el = doc.querySelector(sel);
    if (el && (el.textContent || "").trim().length > 200) { scope = el; break; }
  }
  if (!scope) scope = doc.body;
  if (!scope) return { ...identity, text: "" };

  // The form is the trap here. On an ATS the fields sit inside the same `main`
  // as the description, and their labels — "Work authorization", "Years of
  // experience" — read to a model exactly like stated requirements, so the
  // comparison ends up scoring the candidate against the form it is about to
  // fill in. Cloning the container and cutting the controls out first is what
  // keeps the two apart.
  let text;
  try {
    const copy = scope.cloneNode(true);
    copy.querySelectorAll(
      "form,input,select,textarea,button,label,fieldset,legend,nav,header,footer,script,style," +
      '[role="navigation"],[role="banner"],[role="contentinfo"],[id*=applykaro]'
    ).forEach((n) => n.remove());
    // innerText is unavailable on a detached node, so read textContent and
    // rebuild the paragraph breaks the model needs to see structure.
    text = copy.textContent || "";
  } catch {
    text = scope.innerText || scope.textContent || "";
  }

  return {
    ...identity,
    text: text
      .replace(/[ \t ]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 9000)
  };
}

/** Just the description text. */
export function jobDescriptionFromPage(doc = document) {
  return postingFromPage(doc).text;
}

/** Just the employer and role, for the application tracker. */
export function pageIdentity(doc = document) {
  const { host, company, role, title } = postingFromPage(doc, { text: false });
  return { host, company, role, title };
}
