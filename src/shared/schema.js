// Apply karo — profile schema + storage access.
import { knowledge } from "../knowledge/client.js";
import { DEFAULT_RELEASE } from "./release.js";
//
// Storage is deliberately split across keys so that readers only pay for what
// they need. In v1 everything (including the base64 PDF, ~105 KB) lived under a
// single blob that `loadAll()` pulled into every frame of every page. Here the
// resume binary sits alone under `resumeFile` and is fetched on demand — only
// once a page actually turns out to have a file input.
//
//   profile         — personal / education / experience / skills / customFields
//   learned         — label -> value pairs harvested from manual edits
//   settings        — behaviour toggles + provider config
//   resumeMeta      — { fileName, fileSize, text }   (small, safe to load)
//   resumeFile      — { base64 }                     (large, load on demand)
//   history         — application log                (grows; load on demand)
//   letters         — saved cover letters            (grows; load on demand)

// An empty template, deliberately.
//
// Every value here is typed verbatim into real job applications, so shipping a
// populated profile means a fresh install applies to jobs as whoever the build
// was seeded from. The dashboard opens on first install and *Fill profile from
// resume* populates this from your own PDF in one step, which is the path that
// should fill it — not a default nobody chose.
//
// A stored profile always wins over these (see withDefaults), so this also
// supplies the keys a saved profile happens to be missing.
export const DEFAULT_PROFILE = {
  personal: {
    firstName: "",
    lastName: "",
    middleName: "",
    fullName: "",
    preferredName: "",
    email: "",
    phone: "",
    website: "",
    linkedin: "",
    github: "",
    portfolio: "",
    twitter: "",
    address: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    location: "",
    // Left blank on purpose. A wrong answer to a work-authorization question is
    // a misrepresentation on an application, so these are yours to state.
    visaStatus: "",
    authorizedToWork: "",
    sponsorshipRequired: ""
  },
  // Empty rather than one blank card: the dashboard's Add buttons create these,
  // and a blank entry would otherwise be saved back as a real one.
  education: [],
  experience: [],
  summary: "",
  skills: "",
  // Answers to questions boards ask repeatedly — pronouns, notice period,
  // expected salary. Left empty because every one of them is a personal fact
  // that only you can state; the extension fills these in as it learns them.
  customFields: {}
};

export const DEFAULT_SETTINGS = {
  release: DEFAULT_RELEASE,
  // Fill automatically once a job-application page is detected. Rules only —
  // the AI pass never fires without an explicit user action.
  autofillOnLoad: true,
  // Allow the Gemini pass to attempt fields the rule engine could not resolve.
  aiAutofillEnabled: true,
  // Attach the stored resume to a form's upload box as part of a fill. Only
  // boxes that ask for a resume, or a lone upload on an application form — see
  // pickResumeTargets in shared/rules.js.
  autoUploadResume: true,
  // Highlight filled fields briefly so you can see what changed.
  highlightFills: true,
  // Never touch these categories automatically (EEO questions etc.).
  skipSensitive: true,
  // Which provider answers unknown fields. Keys and model names are kept per
  // provider, so switching back and forth does not lose either.
  provider: "gemini",
  geminiApiKey: "",
  // Must stay equal to PROVIDERS.gemini.models[0] in shared/ai.js, which is what
  // resolveProvider falls back to when nothing is stored. Gemini 2.0 Flash is
  // the fast, stable GA model for document and form filling.
  geminiModel: "gemini-3.8-flash",
  groqApiKey: "",
  groqModel: "llama-3.3-70b-versatile",

  // "system" | "light" | "dark". Resolved by src/shared/theme.js.
  theme: "system",
  // Show the launcher button in the corner of application pages.
  panelEnabled: true,
  // Where the user dragged it to, as { right, bottom } in px. Null = default.
  panelPos: null,
  // Log every page filled, so the dashboard can act as an application tracker.
  trackApplications: true,
  // Days of silence after which an applied/interviewing role is worth chasing.
  followUpDays: 14,
  // Put the number of fields filled on the toolbar icon.
  showBadge: true,
  // Show an exclusive "Fill with AI" button on fields demanding paragraph answers.
  fieldAiButtonEnabled: true,
  // Optional default custom instructions when generating paragraph answers.
  defaultCustomInstruction: "",
  // Local redacted stage diagnostics. Off by default; no labels or answers retained.
  diagnosticsEnabled: false,
  // Hostnames the extension leaves completely alone.
  disabledSites: []
};

// `textFileName` is the PDF the text was read from, or "" when it was typed or
// pasted by hand.
//
// Without it there is no way to tell resume text that describes the current file
// from text left over by the one it replaced — and "any text will do" is what let
// a swapped resume keep being answered from the old one. It also gives the
// dashboard something true to say about whether the setup is actually working,
// which a character count on its own cannot.
export const DEFAULT_RESUME_META = { fileName: "", fileSize: "", text: "", textFileName: "" };

/**
 * Is the stored resume text about the resume that is stored now?
 *
 * Hand-pasted text ("" — no file claimed) is always current: the user typed it
 * for whatever is in the slot, and silently discarding it to re-read a PDF would
 * throw away the only copy on a provider that cannot read PDFs at all.
 */
export function resumeTextIsCurrent(meta = {}) {
  if (!String(meta.text || "").trim()) return false;
  if (!meta.textFileName) return true;
  return meta.textFileName === meta.fileName;
}

const KEYS = ["profile", "learned", "settings", "resumeMeta", "corrections", "answerTrust", "questionFixes"];

/**
 * Is the extension this page was injected by still there?
 *
 * Reloading an unpacked extension, updating it, or switching it off leaves the
 * content script already injected into every open tab running against a dead
 * `chrome.runtime`. Every storage read and every message from that orphan then
 * rejects with "Extension context invalidated" — asynchronously, out of
 * whatever the user just clicked, as an uncaught promise nobody sees but the
 * console. The panel goes quiet, the buttons keep looking enabled, and the only
 * cure (reload the page) is the one thing nothing on screen suggests.
 *
 * `chrome.runtime.id` is the tell: it is undefined exactly when the port behind
 * these APIs has gone. Reading it can itself throw on some Chrome versions,
 * hence the try.
 */
export function extensionAlive() {
  try {
    return !!chrome?.runtime?.id;
  } catch {
    return false;
  }
}

/** Is this error that page-outlived-the-extension failure, rather than a bug? */
export function isContextGone(err) {
  return /context invalidated|extension context/i.test(err?.message || "") || !extensionAlive();
}

export const STALE_MESSAGE =
  "Apply karo was reloaded or updated while this page was open. Refresh the page to use it again.";

function area() {
  return chrome.storage.local;
}

/** Deep-merge stored values over defaults so new keys appear for old installs. */
function withDefaults(stored, defaults) {
  if (!stored || typeof stored !== "object") return structuredClone(defaults);
  const out = structuredClone(defaults);
  for (const [k, v] of Object.entries(stored)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = { ...out[k], ...v };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Everything a content script needs, minus the resume binary.
 * One storage round-trip; ~2-6 KB rather than ~110 KB.
 */
export async function loadContext({ includeUnverified = false } = {}) {
  const knowledgeState = typeof document !== "undefined" && chrome.runtime?.sendMessage && chrome.runtime?.id
    ? await knowledge("snapshot") : null;
  const raw = await area().get(KEYS);
  const resumeMeta = withDefaults(raw.resumeMeta, DEFAULT_RESUME_META);

  // An install from before `textFileName` existed has none in storage, and
  // `withDefaults` fills the gap with the default "" — indistinguishable from
  // text genuinely typed by hand, which `resumeTextIsCurrent` treats as
  // permanently current. Before this field existed, `text` only ever got into
  // storage by reading the file named in `fileName`, so that is the honest
  // reading of an old record: tie it to that file rather than to none, so a
  // later replacement is correctly seen as stale instead of trusted forever.
  if (raw.resumeMeta && !("textFileName" in raw.resumeMeta) && resumeMeta.fileName) {
    resumeMeta.textFileName = resumeMeta.fileName;
  }

  const trusted = (values, records) => Object.fromEntries(Object.entries(values || {}).filter(([key, value]) => records?.[key]?.source === "user-confirmed" && records[key].value === value));
  const profile = withDefaults(raw.profile, DEFAULT_PROFILE);
  const legacyUnverified = {
    learned: Object.fromEntries(Object.entries(raw.learned || {}).filter(([k, v]) => raw.answerTrust?.learned?.[k]?.value !== v || raw.answerTrust?.learned?.[k]?.source !== "user-confirmed")),
    customFields: Object.fromEntries(Object.entries(profile.customFields || {}).filter(([k, v]) => raw.answerTrust?.customFields?.[k]?.value !== v || raw.answerTrust?.customFields?.[k]?.source !== "user-confirmed"))
  };
  if (!includeUnverified) profile.customFields = trusted(profile.customFields, raw.answerTrust?.customFields);
  const settings = withDefaults(raw.settings, DEFAULT_SETTINGS);
  const disclosure = Object.values(knowledgeState?.facts || {}).find(r => r.status === "confirmed" && r.intent === "disclosure.preference");
  if (disclosure && ["skip", "ask"].includes(disclosure.value)) settings.skipSensitive = true;
  return {
    knowledge: knowledgeState,
    profile,
    learned: includeUnverified ? raw.learned || {} : trusted(raw.learned, raw.answerTrust?.learned),
    legacyUnverified,
    answerTrust: raw.answerTrust || { version: 1, learned: {}, customFields: {} },
    questionFixes: raw.questionFixes || {},
    settings,
    resumeMeta,
    // { "<field key>": ["ruleId", …] } — pairings you have overridden.
    corrections: raw.corrections || {}
  };
}

export async function saveCorrections(corrections) {
  await area().set({ corrections });
}

/** The base64 data URL of the resume. Only call this when a file input exists. */
export async function loadResumeFile() {
  const raw = await area().get("resumeFile");
  return (raw.resumeFile && raw.resumeFile.base64) || "";
}

export async function saveResumeFile(base64) {
  await area().set({ resumeFile: { base64: base64 || "" } });
}

export async function save(patch) {
  await area().set(patch);
}

let answerWrite = Promise.resolve();
function serializeAnswers(action) {
  const task = answerWrite.catch(() => {}).then(action); answerWrite = task; return task;
}
async function saveAnswerMap(kind, values, { confirmed = false, replace = false } = {}, profile = null) {
  return serializeAnswers(async () => {
    const raw = await area().get(["profile", "learned", "answerTrust"]);
    const old = kind === "learned" ? raw.learned || {} : raw.profile?.customFields || {};
    const trust = raw.answerTrust || { version: 1, learned: {}, customFields: {} };
    trust[kind] ||= {};
    if (confirmed) for (const [key, value] of Object.entries(values || {})) {
      // Saving unrelated profile edits must not approve unchanged legacy guesses.
      if (old[key] !== value) trust[kind][key] = { value, source: "user-confirmed", confirmedAt: Date.now() };
    }
    const merged = replace ? values : { ...old, ...values };
    const patch = kind === "learned" ? { learned: merged } : { profile: { ...profile, customFields: merged } };
    await area().set({ ...patch, answerTrust: trust });
  });
}
export async function saveProfile(profile, options = {}) {
  await saveAnswerMap("customFields", profile.customFields || {}, options, profile);
}
export async function saveSettings(settings) {
  // Ordinary preference writers may hold an old settings snapshot. Only the
  // dedicated release controls change rollout state; stale UI cannot unpause it.
  const { settings: current = {} } = await area().get("settings");
  await area().set({ settings: { ...settings, release: Object.hasOwn(current, "release") ? current.release : DEFAULT_RELEASE } });
}
export async function saveLearned(learned, options = {}) { await saveAnswerMap("learned", learned, options); }
export async function confirmSavedAnswer(kind, key, value) {
  if (!["learned", "customFields"].includes(kind)) throw new Error("Invalid saved answer kind.");
  return serializeAnswers(async () => {
    const raw = await area().get(["profile", "learned", "answerTrust"]);
    const values = kind === "learned" ? raw.learned || {} : raw.profile?.customFields || {};
    if (values[key] !== value) throw new Error("This answer changed. Refresh and review it again.");
    const trust = raw.answerTrust || { version: 1, learned: {}, customFields: {} };
    trust[kind] ||= {}; trust[kind][key] = { value, source: "user-confirmed", confirmedAt: Date.now() };
    await area().set({ answerTrust: trust });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Application history
//
// Kept out of loadContext deliberately: it only grows, and every frame of every
// application page would otherwise pay to load a list it never reads. The engine
// touches it once, after a fill that actually did something.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_HISTORY = 400;

export const APPLICATION_STATUS = [
  { value: "saved", label: "Filled" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" }
];

export async function loadHistory() {
  const raw = await area().get("history");
  return Array.isArray(raw.history) ? raw.history : [];
}

export async function saveHistory(history) {
  await area().set({ history: history.slice(0, MAX_HISTORY) });
}

/**
 * Record a fill, newest first.
 *
 * Re-filling the same URL updates the existing row rather than adding another —
 * a multi-step Workday application would otherwise show up as six separate
 * "applications", and pressing Fill twice on one page as two.
 */
export async function recordApplication(entry) {
  const history = await loadHistory();
  const existing = history.findIndex((h) => h.url === entry.url);

  if (existing !== -1) {
    const prev = history[existing];
    history.splice(existing, 1);
    history.unshift({
      ...prev,
      ...entry,
      // Keep whatever the user set by hand; only the machine-written parts move.
      status: prev.status,
      note: prev.note || "",
      filled: Math.max(prev.filled || 0, entry.filled || 0),
      firstSeen: prev.firstSeen || prev.ts,
      ts: entry.ts
    });
  } else {
    history.unshift({ status: "saved", note: "", firstSeen: entry.ts, ...entry });
  }

  await saveHistory(history);
  return history;
}

/**
 * Attach a job-match result to the row for `url`, creating the row if the page
 * has not been filled yet — you often compare yourself against a posting before
 * deciding to apply, and that comparison is worth keeping either way.
 */
export async function recordMatch(url, match, identity = {}) {
  const history = await loadHistory();
  const i = history.findIndex((h) => h.url === url);
  const stamped = { ...match, ts: match?.ts ?? Date.now() };

  if (i !== -1) {
    history[i] = { ...history[i], match: stamped };
  } else {
    history.unshift({
      status: "saved", note: "", filled: 0, total: 0,
      firstSeen: stamped.ts, ts: stamped.ts,
      ...identity, url, match: stamped
    });
  }

  await saveHistory(history);
  return history;
}

// Statuses that mean "waiting to hear back". A rejection is not waiting, and a
// row you have not actually submitted yet is not waiting either.
const AWAITING = new Set(["applied", "interview"]);

/**
 * Applications you have not heard about in a while.
 *
 * Entirely local — no model, no network. The timestamp is already recorded, so
 * "applied 18 days ago, still applied" is a lookup, and it is the single most
 * useful thing a tracker can tell you that a spreadsheet will not.
 */
export function staleApplications(history = [], days = 14, now = Date.now()) {
  const cutoff = days * 86400000;
  return history
    .filter((h) => AWAITING.has(h.status) && now - (h.ts || 0) >= cutoff)
    .map((h) => ({ ...h, daysSince: Math.floor((now - (h.ts || 0)) / 86400000) }))
    .sort((a, b) => b.daysSince - a.daysSince);
}

/**
 * Earlier applications to the same employer, excluding this exact posting.
 *
 * Applying twice to one company is common and not always wrong — two different
 * roles is fine, the same role twice is a mistake. Returning the rows and
 * letting the caller say what they are beats guessing which case it is.
 */
export function priorApplicationsFor(history = [], { company, url } = {}) {
  const key = String(company || "").trim().toLowerCase();
  if (!key) return [];
  return history.filter((h) =>
    h.url !== url && String(h.company || "").trim().toLowerCase() === key);
}

// ─────────────────────────────────────────────────────────────────────────────
// The posting you are working on
//
// One slot, not a list. A job description is read on the listing page and needed
// two pages later on the form, so it has to outlive the tab it was read from —
// but you only ever apply to one job at a time, and a list would turn a
// one-press feature into a picker.
//
// `match` and `letter` live in here rather than beside the run that produced
// them because the popup is a window that closes the moment you look away. The
// service worker writes the result here when it lands, so re-opening the popup
// shows the letter that was drafted while it was shut.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_JOB = {
  text: "",
  // "capture" — read off a page you pressed Capture on.
  // "manual"  — pasted in by hand.
  // "page"    — picked up automatically from the page a match or letter ran on.
  source: "",
  company: "", role: "", title: "", url: "", host: "",
  ts: 0,
  match: null,
  letter: "", letterTs: 0,
  // "match" | "letter" while the service worker is working, so a popup opened
  // mid-run says so instead of looking empty.
  running: "", runningSince: 0,
  error: ""
};

export async function loadJob() {
  const raw = await area().get("job");
  return withDefaults(raw.job, DEFAULT_JOB);
}

export async function saveJob(job) {
  await area().set({ job: { ...job, text: String(job.text || "").slice(0, 9000) } });
}

/** Change part of the stored posting without disturbing the rest. */
export async function patchJob(patch) {
  const next = { ...(await loadJob()), ...patch };
  await saveJob(next);
  return next;
}

/**
 * Replace the stored posting with one just read from a page.
 *
 * A match and a letter belong to the posting they were made for, so they only
 * survive when this is the same posting arriving again — re-capturing the page
 * you already captured should not throw away the letter you just paid for, and
 * capturing a different job must never leave the last job's letter behind it.
 */
export async function setJob(posting) {
  const prev = await loadJob();
  const same = !!prev.url && prev.url === posting.url;
  const next = {
    ...DEFAULT_JOB,
    ...posting,
    ts: Date.now(),
    match: same ? prev.match : null,
    letter: same ? prev.letter : "",
    letterTs: same ? prev.letterTs : 0
  };
  await saveJob(next);
  return next;
}

export async function clearJob() {
  await area().remove("job");
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved cover letters
// ─────────────────────────────────────────────────────────────────────────────

export async function loadLetters() {
  const raw = await area().get("letters");
  return Array.isArray(raw.letters) ? raw.letters : [];
}

export async function saveLetters(letters) {
  await area().set({ letters: letters.slice(0, 60) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-site rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A URL that is safe to put in an href, or "".
 *
 * Escaping the string stops it breaking out of the attribute; it does nothing
 * about the *scheme*, and `javascript:alert(1)` needs no quotes or angle
 * brackets to survive it. An anchor carrying that in the dashboard runs script
 * in the extension's own origin, with access to everything in
 * `chrome.storage.local` — the profile, the resume, the API keys.
 *
 * The tracker's URLs come from pages a content script ran on, which are always
 * http(s), so this is not reachable from ordinary use. It is reachable through
 * Settings → Import: a backup file is plain JSON from wherever the user got it,
 * and nothing about receiving one implies it was written by this extension.
 */
export function safeHttpUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") ? s : "";
  } catch {
    return "";                       // not a URL at all
  }
}

/** Normalise a hostname so "www.x.com" and "X.com" cannot both be stored. */
export function normalizeHost(host) {
  return String(host || "").trim().toLowerCase().replace(/^www\./, "");
}

export function isSiteDisabled(settings, host) {
  const h = normalizeHost(host);
  if (!h) return false;
  return (settings.disabledSites || []).some((d) => h === d || h.endsWith(`.${d}`));
}

/** Returns the new list; the caller decides when to persist. */
export function setSiteDisabled(settings, host, disabled) {
  const h = normalizeHost(host);
  const list = (settings.disabledSites || []).filter((d) => d !== h);
  if (disabled && h) list.push(h);
  settings.disabledSites = list.sort();
  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile completeness
//
// Drives the dashboard ring and the popup's setup nudge. A single definition so
// the two surfaces cannot disagree about whether the profile is "done".
// ─────────────────────────────────────────────────────────────────────────────

export function completeness(profile = {}, resumeMeta = {}, settings = {}) {
  const p = profile.personal || {};
  const has = (v) => !!String(v ?? "").trim();

  const items = [
    { key: "name",     label: "Name and email",        tab: "tab-personal",  done: has(p.firstName) && has(p.email), weight: 2 },
    { key: "contact",  label: "Phone number",          tab: "tab-personal",  done: has(p.phone),      weight: 1 },
    { key: "address",  label: "Structured address",    tab: "tab-personal",  done: has(p.city) && has(p.country), weight: 1,
      hint: "Workday and iCIMS ask for city, state and country as separate boxes." },
    { key: "work",     label: "Work authorisation",    tab: "tab-personal",  done: has(p.authorizedToWork), weight: 1 },
    { key: "edu",      label: "At least one school",   tab: "tab-education", done: (profile.education || []).length > 0, weight: 2 },
    { key: "skills",   label: "Skills list",           tab: "tab-education", done: has(profile.skills), weight: 1 },
    { key: "exp",      label: "Work experience",       tab: "tab-experience", done: (profile.experience || []).length > 0, weight: 2 },
    { key: "summary",  label: "Professional summary",  tab: "tab-experience", done: has(profile.summary), weight: 1 },
    { key: "links",    label: "LinkedIn or GitHub",    tab: "tab-links",     done: has(p.linkedin) || has(p.github), weight: 1 },
    { key: "resume",   label: "Resume PDF uploaded",   tab: "tab-resume",    done: has(resumeMeta.fileName), weight: 3,
      hint: "Without it, file-upload fields are skipped." },
    { key: "text",     label: "Resume text extracted", tab: "tab-resume",    done: has(resumeMeta.text), weight: 1,
      hint: "The AI answers open questions from this." },
    { key: "ai",       label: "AI provider connected", tab: "tab-resume",
      done: has(settings.provider === "groq" ? settings.groqApiKey : settings.geminiApiKey), weight: 1,
      hint: "Optional. Lets the extension answer questions no rule covers." }
  ];

  const total = items.reduce((n, i) => n + i.weight, 0);
  const got = items.reduce((n, i) => n + (i.done ? i.weight : 0), 0);
  return { percent: Math.round((got / total) * 100), items, done: got, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup
// ─────────────────────────────────────────────────────────────────────────────

const BACKUP_KEYS = ["profile", "learned", "settings", "resumeMeta", "corrections", "history", "letters"];

/**
 * Everything except the resume binary, which would multiply the file size by
 * thirty for something the user already has on disk.
 *
 * @param {boolean} includeKeys — API keys are credentials; off unless asked for.
 */
export async function exportAll({ includeKeys = false } = {}) {
  const raw = await area().get(BACKUP_KEYS);
  const settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  if (!includeKeys) {
    settings.geminiApiKey = "";
    settings.groqApiKey = "";
  }
  return {
    knowledge: typeof document !== "undefined" && chrome.runtime?.id ? await knowledge("export") : undefined,
    _format: "applykaro-backup",
    _version: 2,
    exportedAt: new Date().toISOString(),
    profile: raw.profile || DEFAULT_PROFILE,
    learned: raw.learned || {},
    settings,
    resumeMeta: raw.resumeMeta || DEFAULT_RESUME_META,
    corrections: raw.corrections || {},
    history: raw.history || [],
    letters: raw.letters || []
  };
}

/**
 * Restore a backup. Merges rather than replaces, so importing a profile onto a
 * device that already has a resume does not wipe the resume.
 */
export async function importAll(data) {
  // "resumefiler-backup" is the pre-rename tag; files exported before the app
  // became Apply karo still carry it and must keep restoring.
  const known = ["applykaro-backup", "resumefiler-backup"];
  if (!data || !known.includes(data._format)) {
    throw new Error("That file is not an Apply karo backup.");
  }
  const current = await area().get(BACKUP_KEYS);
  const patch = {};

  if (data.profile) patch.profile = withDefaults(data.profile, DEFAULT_PROFILE);
  if (data.learned) patch.learned = { ...(current.learned || {}), ...data.learned };
  if (data.corrections) patch.corrections = { ...(current.corrections || {}), ...data.corrections };
  if (data.settings) {
    const merged = withDefaults(data.settings, withDefaults(current.settings, DEFAULT_SETTINGS));
    // An export with the keys stripped must not blank the keys already here.
    if (!data.settings.geminiApiKey) merged.geminiApiKey = current.settings?.geminiApiKey || "";
    if (!data.settings.groqApiKey) merged.groqApiKey = current.settings?.groqApiKey || "";
    patch.settings = merged;
  }
  if (data.resumeMeta) {
    patch.resumeMeta = {
      ...withDefaults(data.resumeMeta, DEFAULT_RESUME_META),
      // The binary is not in the backup, so the filename must not claim one is.
      fileName: current.resumeMeta?.fileName || "",
      fileSize: current.resumeMeta?.fileSize || ""
    };
  }
  if (Array.isArray(data.history)) {
    const seen = new Set((current.history || []).map((h) => h.url));
    // Rewrite every incoming URL through the scheme check rather than only
    // escaping it at render time. A backup is plain JSON from wherever the user
    // got it, and this is the boundary where it stops being someone else's data
    // — sanitising here means a row cannot sit in storage waiting for the one
    // place that forgot to sanitise on the way out.
    patch.history = [...(current.history || []),
                     ...data.history.filter((h) => h && !seen.has(h.url))
                                    .map((h) => ({ ...h, url: safeHttpUrl(h.url) }))]
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, MAX_HISTORY);
  }
  if (Array.isArray(data.letters)) patch.letters = [...data.letters, ...(current.letters || [])].slice(0, 60);

  await area().set(patch);
  if (data.knowledge && typeof document !== "undefined" && chrome.runtime?.id) await knowledge("import", { data: data.knowledge });
  return Object.keys(patch);
}

/** Wipe everything this extension has stored, including the resume. */
export async function resetAll() {
  if (typeof document !== "undefined" && chrome.runtime?.id) await knowledge("clear");
  await area().clear();
  await area().set({ schemaVersion: 2 });
}

/** Rough bytes in use, for the settings page. */
export async function storageUsage() {
  try {
    return await area().getBytesInUse(null);
  } catch {
    return 0;
  }
}

/**
 * Migrate a v1 install in place.
 *
 * v1 stored `resume: { fileName, fileSize, base64, text }` and
 * `learnedMappings: {}`. Split the binary out and rename the map. Idempotent —
 * safe to run on every service-worker start.
 */
export async function migrateFromV1() {
  const raw = await area().get(["resume", "learnedMappings", "settings", "schemaVersion"]);
  if (raw.schemaVersion >= 2) return false;

  const patch = { schemaVersion: 2 };

  if (raw.resume && typeof raw.resume === "object") {
    patch.resumeMeta = {
      fileName: raw.resume.fileName || "",
      fileSize: raw.resume.fileSize || "",
      text: raw.resume.text || ""
    };
    if (raw.resume.base64) patch.resumeFile = { base64: raw.resume.base64 };
  }

  if (raw.learnedMappings && typeof raw.learnedMappings === "object") {
    patch.learned = raw.learnedMappings;
  }

  // Preserve explicit model selections; health checks explain retired models.
  await area().set(patch);
  await area().remove(["resume", "learnedMappings"]);
  return true;
}

/** Resolve "personal.email" / "education[0].school" against a profile. */
/**
 * Copy `incoming` over `base`, skipping anything the source left empty.
 *
 * Empty means "the source does not say", not "clear this". The resume extractor
 * is asked to return "" for any fact a resume does not state — and a resume
 * states neither a street address nor an answer to a work-authorization
 * question — so a plain spread wrote those blanks straight over values typed by
 * hand. Populated lists still replace wholesale: education and experience come
 * back as the complete ordered set, not as a patch.
 */
export function overlayFilled(base, incoming) {
  const out = { ...base };
  for (const [k, v] of Object.entries(incoming || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) continue;
    out[k] = v;
  }
  return out;
}

export function resolvePath(obj, path) {
  if (!path || !obj) return null;
  let cur = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return null;
    const arr = part.match(/^(\w+)\[(\d+)\]$/);
    if (arr) {
      const list = cur[arr[1]];
      if (!Array.isArray(list)) return null;
      cur = list[Number(arr[2])];
    } else {
      cur = cur[part];
    }
  }
  if (cur === null || cur === undefined) return null;
  const s = String(cur).trim();
  return s === "" ? null : s;
}
