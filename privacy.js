// Apply karo — the privacy page.
//
// The policy text is static HTML; this only fills in the three things that
// would otherwise go stale — the logo, the version the reader is actually
// running, and the contact address — and wires the way back.
//
// It is shipped inside the extension rather than linked out so the policy is
// readable offline and always describes the version installed, not whatever is
// currently on a web page somewhere. The hosted copy at PRIVACY.md is the one
// the Web Store listing points at; keep the two in step.

import { applyTheme } from "./src/shared/theme.js";
import { ICONS } from "./src/shared/icons.js";
import { CONTACT_EMAIL, feedbackMailto } from "./src/shared/contact.js";
import { loadContext } from "./src/shared/schema.js";

const $ = (id) => document.getElementById(id);

$("logo").innerHTML = ICONS.brand;

// Guarded the same way contact.js guards it. The policy text is static HTML and
// stays readable whatever happens here, but an uncaught throw on this line would
// take the back button down with it — and this is the page a reader is least
// likely to forgive being broken.
try { $("version").textContent = chrome.runtime.getManifest().version; }
catch { $("version").textContent = "—"; }

const contact = $("contact-link");
contact.textContent = CONTACT_EMAIL;
contact.href = feedbackMailto("general");
contact.target = "_blank";
contact.rel = "noopener noreferrer";

$("back-btn").addEventListener("click", () => {
  // Opened from the dashboard in the same tab, so history is the way back; a
  // direct visit has nothing behind it, so open the dashboard instead.
  if (history.length > 1) history.back();
  else chrome.runtime.openOptionsPage();
});

// Read the theme so this page does not flash white inside a dark dashboard.
loadContext()
  .then(({ settings }) => applyTheme(settings.theme))
  .catch(() => applyTheme("system"));
