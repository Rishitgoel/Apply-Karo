// Apply karo — where feedback goes.
//
// One address, one mailto builder. The popup, the dashboard and the on-page
// panel all link here, so changing the address is a one-line edit rather than a
// grep across four files.
//
// Bug reports arrive far more useful with the version and the browser already
// in the body — nobody writing an annoyed two-line email is going to dig those
// out of chrome://extensions, and without them half the reports are unactionable.

export const CONTACT_EMAIL = "rishitgoel259@gmail.com";

const version = () => {
  try { return chrome.runtime.getManifest().version; } catch { return "unknown"; }
};

/** Chrome's UA is long and mostly noise; the build number is the part that matters. */
const browserLine = () => {
  const ua = navigator.userAgent || "";
  const chrome_ = /Chrom(?:e|ium)\/([\d.]+)/.exec(ua);
  const edge = /Edg\/([\d.]+)/.exec(ua);
  const brave = navigator.brave ? "Brave " : "";
  const name = edge ? `Edge ${edge[1]}` : chrome_ ? `${brave}Chrome ${chrome_[1]}` : ua.slice(0, 80);
  return `${name} · ${navigator.platform || "unknown platform"}`;
};

const TEMPLATES = {
  bug: {
    subject: "Apply karo — bug report",
    body: [
      "What went wrong:",
      "",
      "",
      "Which site (the job board or careers page):",
      "",
      "",
      "What you expected instead:",
      "",
      ""
    ]
  },
  idea: {
    subject: "Apply karo — suggestion",
    body: [
      "What you'd like it to do:",
      "",
      "",
      "When it would help:",
      "",
      ""
    ]
  },
  general: {
    subject: "Apply karo — feedback",
    body: ["", ""]
  }
};

/**
 * Build a Gmail web compose URL for a feedback email.
 * Opens directly in Gmail web in a new browser tab with recipient, subject, and body pre-filled.
 *
 * @param {"bug"|"idea"|"general"} kind      which template to prefill
 * @param {object}  [extra]                  extra diagnostic lines, `label: value`
 * @param {boolean} [extra.includeContext]   append version/browser footer (default true)
 */
export function feedbackGmailUrl(kind = "general", extra = {}) {
  const { includeContext = true, ...facts } = extra;
  const t = TEMPLATES[kind] || TEMPLATES.general;

  const lines = [...t.body];
  if (includeContext) {
    lines.push(
      "—".repeat(24),
      "Sent from the extension — these help me reproduce it:",
      `Version: ${version()}`,
      `Browser: ${browserLine()}`,
      ...Object.entries(facts).map(([k, v]) => `${k}: ${v}`)
    );
  }

  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(CONTACT_EMAIL)}`
    + `&su=${encodeURIComponent(t.subject)}`
    + `&body=${encodeURIComponent(lines.join("\n"))}`;
}

export const feedbackMailto = feedbackGmailUrl;
