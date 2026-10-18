import { JOB_LABELS, isRunningJob } from "./src/engine/session.js";
// Apply karo — toolbar popup.
//
// Three jobs, in priority order: say what the extension can see on this tab,
// give you one press that fills it, and surface the two switches you actually
// reach for (fill automatically, and leave this site alone). Everything else
// lives in the dashboard.

import {
  loadContext, saveSettings, loadHistory, save, saveResumeFile,
  isSiteDisabled, setSiteDisabled, normalizeHost, completeness,
  loadJob, clearJob, DEFAULT_JOB
} from "./src/shared/schema.js";
import { MIN_JD_CHARS } from "./src/shared/posting.js";
import { resolveProvider, providerHealth } from "./src/shared/ai.js";
import { ICONS } from "./src/shared/icons.js";
import { applyTheme, THEMES } from "./src/shared/theme.js";
import { feedbackMailto } from "./src/shared/contact.js";

const $ = (id) => document.getElementById(id);

const ctx = await loadContext();
applyTheme(ctx.settings.theme);

// ─── Icons ───────────────────────────────────────────────────────────────────
$("logo").innerHTML = ICONS.brand;
$("dashboard-btn").innerHTML = ICONS.sliders;
$("fill-icon").innerHTML = ICONS.bolt;
for (const el of document.querySelectorAll("[data-icon]")) {
  el.innerHTML = ICONS[el.dataset.icon];
}

const THEME_ICON = { system: "monitor", light: "sun", dark: "moon" };
function paintThemeButton() {
  $("theme-btn").innerHTML = ICONS[THEME_ICON[ctx.settings.theme] || "monitor"];
  $("theme-btn").title = `Theme: ${ctx.settings.theme}`;
}
paintThemeButton();

$("theme-btn").addEventListener("click", async () => {
  const next = THEMES[(THEMES.indexOf(ctx.settings.theme) + 1) % THEMES.length];
  ctx.settings.theme = next;
  applyTheme(next);
  paintThemeButton();
  await saveSettings(ctx.settings);
  notifyPage();
});

$("dashboard-btn").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("setup-link").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ─── Tab plumbing ────────────────────────────────────────────────────────────
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

let host = "";
try { host = normalizeHost(new URL(tab?.url || "").hostname); } catch { /* chrome:// etc. */ }

/**
 * `sendMessage` rejects when no content script is listening at all, which is a
 * different failure from the engine replying "nothing to do". Keep them apart so
 * the message we show is actually true.
 */
let noReceiver = false;
const send = (message) => {
  if (!tab?.id) return Promise.resolve(null);
  return chrome.tabs.sendMessage(tab.id, message).catch(() => { noReceiver = true; return null; });
};

/**
 * Run an action across every frame of the tab and get one combined answer.
 *
 * Not `chrome.tabs.sendMessage` directly: that broadcasts to all frames but
 * keeps only the first reply, and on an embedded board — Greenhouse or Lever
 * inside a company careers page — the frame holding the form is not the frame
 * that answers. The service worker fans the action out and adds the results up.
 */
const act = async (action, extra = {}) => {
  if (!tab?.id) return null;
  const r = await chrome.runtime
    .sendMessage({ type: "tab_action", action, tabId: tab.id, ...extra })
    .catch(() => null);
  // No frame acknowledged, so no engine is loaded anywhere in this tab. That is
  // a different thing from a page the extension cannot touch at all, and only
  // the second is hopeless — so it is reported as a miss, not as an error.
  if (!r?.ok || !r.frames) { noReceiver = !r?.ok; return null; }
  return r;
};

const notifyPage = () => send({ type: "rf_settings_changed" });

// ─── Header state ────────────────────────────────────────────────────────────
$("version").textContent = `v${chrome.runtime.getManifest().version}`;

const footer = $("footer-text");
const setFooter = (html) => { footer.innerHTML = html; };

/* Provider error messages are relayed into the footer, and they are the one
   string here that neither this file nor the engine wrote. */
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SHORTCUT_HINT = "Stored on this device &middot; <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>F</kbd>";

/* Feedback. The site you were on is the single most useful line in a bug report
   about a form that filled wrong, so it goes in before you start typing. */
$("feedback-icon").innerHTML = ICONS.mail;
$("feedback-link").href = feedbackMailto("bug", host ? { Site: host } : {});
$("feedback-link").target = "_blank";

// ─── Resume ──────────────────────────────────────────────────────────────────
//
// Swapping in a fresh resume is the thing you do most often after setting up,
// and it used to mean opening the whole dashboard. It happens here now.

function paintResume() {
  const has = !!ctx.resumeMeta.fileName;
  $("resume-badge").textContent = has ? "Active" : "Missing";
  $("resume-badge").className = `badge badge-${has ? "success" : "danger"}`;
  $("resume-upload-label").textContent = has ? "Replace" : "Upload";
  $("resume-filename").textContent = has
    ? `${ctx.resumeMeta.fileName}${ctx.resumeMeta.fileSize ? ` · ${ctx.resumeMeta.fileSize}` : ""}`
    : "";
  $("resume-filename").classList.toggle("hidden", !has);
}
paintResume();

const resumeInput = $("resume-file-input");
$("resume-upload-btn").addEventListener("click", () => resumeInput.click());

resumeInput.addEventListener("change", () => {
  const file = resumeInput.files?.[0];
  resumeInput.value = "";              // so picking the same file twice still fires
  if (!file) return;

  if (file.type !== "application/pdf") { setFooter("Only PDF files are supported."); return; }
  if (file.size > 8 * 1024 * 1024) { setFooter("That PDF is over 8 MB — most ATS uploads reject it."); return; }

  const btn = $("resume-upload-btn");
  btn.disabled = true;
  setFooter("Saving your resume…");

  const reader = new FileReader();
  reader.onload = async (e) => {
    const kb = Math.round(file.size / 1024);
    ctx.resumeMeta = {
      ...ctx.resumeMeta,
      fileName: file.name,
      fileSize: kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
      // A new PDF makes the old extracted text wrong, and the next AI run must
      // re-read rather than answering from the last resume. That is now settled
      // by `textFileName` no longer matching `fileName`, which says the same
      // thing without destroying text the user may have pasted in by hand —
      // the only copy there is on a provider that cannot read a PDF.
    };
    await Promise.all([saveResumeFile(e.target.result), save({ resumeMeta: ctx.resumeMeta })]);
    btn.disabled = false;
    paintResume();
    notifyPage();
    // A filename is not ours to trust as markup.
    footer.textContent = `${file.name} is ready to attach.`;
  };
  reader.onerror = () => { btn.disabled = false; setFooter("Couldn't read that file."); };
  reader.readAsDataURL(file);
});

// Read through the provider rather than a fixed key, or switching to Groq would
// report "Not set up" while working perfectly.
const { apiKey, model } = resolveProvider(ctx.settings);
const health = providerHealth(ctx.settings);
if (apiKey.trim() && ctx.settings.aiAutofillEnabled) {
  if (health.ok) {
    $("ai-badge").textContent = model.split("/").pop().slice(0, 22);
    $("ai-badge").className = "badge badge-success";
    $("ai-badge").title = model;
  } else {
    $("ai-badge").textContent = "Issue";
    $("ai-badge").className = "badge badge-danger";
    $("ai-badge").title = health.error;
  }
} else {
  $("ai-badge").textContent = apiKey.trim() ? "Off" : "Not set up";
  $("ai-badge").className = "badge badge-warning";
  $("ai-badge").title = apiKey.trim()
    ? "Turn it on in the dashboard, under Resume & AI"
    : "Add a provider key in the dashboard";
}

// ─── Completeness ────────────────────────────────────────────────────────────
{
  const c = completeness(ctx.profile, ctx.resumeMeta, ctx.settings);
  if (c.percent < 100) {
    $("setup-card").classList.remove("hidden");
    $("complete-pct").textContent = `${c.percent}%`;
    $("complete-bar").style.width = `${c.percent}%`;
    const missing = c.items.filter((i) => !i.done).map((i) => i.label);
    $("setup-missing").textContent =
      `Still missing: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? `, +${missing.length - 3} more` : ""}.`;
  }
}

// ─── Tracker stats ───────────────────────────────────────────────────────────
loadHistory().then((history) => {
  const weekAgo = Date.now() - 7 * 864e5;
  $("stat-total").textContent = String(history.length);
  $("stat-week").textContent = String(history.filter((h) => (h.ts || 0) > weekAgo).length);
  $("stat-learned").textContent =
    String(Object.keys(ctx.learned).length + Object.keys(ctx.profile.customFields || {}).length);
});

// ─── Toggles ─────────────────────────────────────────────────────────────────
const autofillToggle = $("autofill-toggle");
autofillToggle.checked = ctx.settings.autofillOnLoad;
autofillToggle.addEventListener("change", async () => {
  ctx.settings.autofillOnLoad = autofillToggle.checked;
  await saveSettings(ctx.settings);
  notifyPage();
});

const siteToggle = $("site-toggle");
if (!host) {
  siteToggle.disabled = true;
  $("site-label").textContent = "No site to control here";
} else {
  const enabled = !isSiteDisabled(ctx.settings, host);
  siteToggle.checked = enabled;
  $("site-label").textContent = `Enabled on ${host}`;
  $("site-label").title = host;

  siteToggle.addEventListener("change", async () => {
    setSiteDisabled(ctx.settings, host, !siteToggle.checked);
    await saveSettings(ctx.settings);
    notifyPage();
    setFooter(siteToggle.checked
      ? `Reload the page to switch Apply karo back on.`
      : `Apply karo will leave ${host} alone.`);
    paintPageCard(lastStatus);
  });
}

// ─── Page status ─────────────────────────────────────────────────────────────
const fillBtn = $("fill-btn");
const stepsBtn = $("steps-btn");
const reviewBtn = $("review-btn");
const undoBtn = $("undo-btn");

let lastStatus = null;

function paintPageCard(status) {
  const card = $("page-card");
  const dot = $("page-dot");
  const text = $("page-host-text");
  const state = $("page-state");

  text.textContent = host || tab?.url?.split("/")[0] || "This page";

  if (!host) {
    card.classList.remove("is-app");
    dot.style.color = "var(--text-faint)";
    state.textContent = "Chrome blocks extensions on this kind of page.";
    fillBtn.disabled = stepsBtn.disabled = reviewBtn.disabled = true;
    return;
  }

  if (isSiteDisabled(ctx.settings, host)) {
    card.classList.remove("is-app");
    dot.style.color = "var(--danger)";
    state.textContent = "Switched off here. Fill still works if you press it.";
    return;
  }

  if (!status) {
    card.classList.remove("is-app");
    dot.style.color = "var(--text-faint)";
    state.textContent = "Not detected as an application — press Fill to run anyway.";
    return;
  }

  card.classList.add("is-app");
  dot.style.color = "var(--success)";
  dot.classList.add("dot-live");
  const bits = [`${status.total} field${status.total === 1 ? "" : "s"}`];
  if (status.empty) bits.push(`${status.empty} empty`);
  if (status.hasResumeUpload) bits.push("resume upload");
  state.textContent = `Application form found · ${bits.join(" · ")}`;
}

async function refreshStatus() {
  if (!host) { paintPageCard(null); return; }
  const status = await act("rf_status");
  lastStatus = status?.ok ? status : null;
  paintPageCard(lastStatus);
  undoBtn.disabled = !lastStatus?.canUndo;
}

await refreshStatus();

const diagnosticsButton = $("diagnostics-export-btn");
diagnosticsButton.classList.toggle("hidden", ctx.settings.diagnosticsEnabled !== true);
diagnosticsButton.addEventListener("click", async () => {
  diagnosticsButton.disabled = true;
  try {
    const result = await act("rf_diagnostics");
    if (!result) { setFooter("No diagnostics available on this page yet."); return; }
    const data = { version: 1, frames: result.frames, dropped: result.diagnosticDropped || 0, events: result.diagnosticEvents || [] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "apply-karo-diagnostics.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFooter("Exported redacted local diagnostics.");
  } finally { diagnosticsButton.disabled = false; }
});

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Detection is deliberately conservative, so the page may have decided it was
 * not an application and never loaded the engine. Force it in and retry —
 * pressing a button here is an unambiguous signal.
 */
async function withEngine(action, extra = {}) {
  const prepared = await chrome.runtime.sendMessage({ type: "prepare_engine", tabId: tab.id }).catch(() => null);
  if (!prepared?.ok) { setFooter(escapeHtml(prepared?.error || "Could not prepare this page.")); return null; }
  return act(action, extra);
}
async function observeFill(runId) {
  const deadline = Date.now() + 125000;
  while (Date.now() < deadline) {
    const { job } = await chrome.runtime.sendMessage({ type: "fill_job_status", tabId: tab.id, runId });
    if (!job) throw new Error("Fill status is unavailable. Review the form before retrying.");
    const label = job.detail || JOB_LABELS[job.state] || "Working…";
    if (isRunningJob(job)) { busy(true, label); setFooter(label); }
    else return { ...job, aiError: job.error, ok: job.state !== "failed" && job.state !== "interrupted" };
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Fill status timed out. Review the form before retrying.");
}
function renderFillResult(res) {
  if (!res.ok) { setFooter(escapeHtml(res.aiError || "Fill failed. Review before retrying.")); return; }
  const left = Number(res.empty || 0);
  setFooter(`Filled <strong>${res.filled}</strong> of ${res.total} fields.${left ? ` ${left} still empty.` : ""}${res.deferred ? ` ${res.deferred} deferred; click Fill to continue.` : ""} ${escapeHtml(res.aiError || "Review before submitting.")}`);
}

function busy(on, label) {
  for (const b of [fillBtn, stepsBtn, reviewBtn, undoBtn]) b.disabled = on;
  $("fill-icon").innerHTML = on ? `<span class="spinner"></span>` : ICONS.bolt;
  $("fill-label").textContent = on ? label : "Fill this page";
  if (on) return;
  undoBtn.disabled = !lastStatus?.canUndo;
  // A page Chrome will not let us touch stays untouchable after a run.
  if (!host) for (const b of [fillBtn, stepsBtn, reviewBtn]) b.disabled = true;
}

function unreachable() {
  setFooter(noReceiver
    ? "Can't run on this page — Chrome blocks extensions here."
    : "Couldn't reach the page. Reload it and try again.");
}

fillBtn.addEventListener("click", async () => {
  busy(true, "Preparing page…");
  try {
    const start = await chrome.runtime.sendMessage({ type: "start_fill", tabId: tab.id });
    if (!start?.ok) throw new Error(start?.error || "Could not start filling.");
    renderFillResult(await observeFill(start.runId));
    await refreshStatus();
  } catch (err) { setFooter(escapeHtml(err.message)); }
  finally { busy(false); }
});

// Reopening the popup attaches to the worker's existing job, without re-filling.
const currentFill = await chrome.runtime.sendMessage({ type: "fill_job_status", tabId: tab?.id }).catch(() => null);
if (currentFill?.job && isRunningJob(currentFill.job)) {
  busy(true, JOB_LABELS[currentFill.job.state]);
  void observeFill(currentFill.job.runId).then(renderFillResult,
    (err) => setFooter(escapeHtml(err.message))).finally(() => busy(false));
}

stepsBtn.addEventListener("click", async () => {
  busy(true, "Stepping…");
  setFooter("Filling each step. It never submits.");

  try {
    const res = await withEngine("rf_steps");
    if (!res?.ok) { unreachable(); return; }
    await refreshStatus();
    setFooter(`Filled <strong>${res.filled}</strong> across ${res.steps + 1} step(s). Submit it yourself.`);
  } catch (err) { setFooter(escapeHtml(err.message)); }
  finally { busy(false); }
});

reviewBtn.addEventListener("click", async () => {
  await withEngine("rf_open_review");
  const res = await withEngine("rf_highlight");
  if (!res?.ok) { unreachable(); return; }
  setFooter(res.empty
    ? `<strong>${res.empty}</strong> field(s) still empty${res.required ? `, <strong>${res.required}</strong> required` : ""}, outlined on the page.` +
      (res.unseen ? ` ${res.unseen} of them the filler can't see.` : "")
    : "Every field on this page has a value.");
  setTimeout(() => window.close(), 900);
});

undoBtn.addEventListener("click", async () => {
  const res = await act("rf_undo");
  if (!res?.ok) { unreachable(); return; }
  await refreshStatus();
  setFooter(res.restored
    ? `Put <strong>${res.restored}</strong> field(s) back.`
    : "Nothing to undo.");
});

// ─── The posting ─────────────────────────────────────────────────────────────
//
// A job description lives on the listing page. You read it there, press "Apply
// now", and fill in a form that does not repeat it — so the on-page panel, which
// only ever read the page under it, could not write a letter at the one moment
// you wanted one. This is the way round that: capture the description while you
// are looking at it, and it stays available for the rest of the application.
//
// Both requests run in the service worker and write their result to storage
// before replying. That matters here more than anywhere else in the extension: a
// popup closes the moment you click the page behind it, and a letter takes most
// of a minute. Reopening shows what landed while it was shut.

const jobCard = $("job-card");
const jobName = $("job-name");
const jobMeta = $("job-meta");
const captureBtn = $("capture-btn");
const pasteBtn = $("paste-btn");
const pasteBox = $("paste-box");
const jobTextInput = $("job-text");
const matchBtn = $("match-btn");
const letterBtn = $("letter-btn");
const jobOut = $("job-out");

const hasKey = !!apiKey.trim();
let job = await loadJob();

const hasPosting = () => String(job.text || "").length >= MIN_JD_CHARS;

/** How long ago, in the roughest terms that are still true. */
function ago(ts) {
  const mins = Math.floor((Date.now() - (ts || 0)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Is a run still in flight? Stale flags are ignored rather than trusted. */
const isRunning = () => !!job.running && Date.now() - (job.runningSince || 0) < 180000;

function paintJob() {
  const has = hasPosting();
  const running = isRunning();

  jobCard.classList.toggle("is-app", has);
  jobName.textContent = has
    ? ([job.company, job.role].filter(Boolean).join(" — ") || job.host || "Saved posting")
    : "No posting saved";
  jobName.title = jobName.textContent;

  if (running) {
    jobMeta.textContent = job.running === "match"
      ? "Comparing you against it…" : "Drafting the letter…";
  } else if (has) {
    const words = Math.round(job.text.trim().split(/\s+/).length / 10) * 10;
    const how = job.source === "manual" ? "pasted" : "captured";
    jobMeta.textContent = `~${words} words, ${how} ${ago(job.ts)}`;
  } else {
    jobMeta.textContent = "Open the job description and press Capture.";
  }
  jobMeta.title = jobMeta.textContent;

  $("job-forget").classList.toggle("hidden", !has);
  captureBtn.disabled = running;
  pasteBtn.disabled = running;
  matchBtn.disabled = running || !has || !hasKey;
  letterBtn.disabled = running || !has || !hasKey;

  const why = !hasKey
    ? "Add a provider key in the dashboard first"
    : !has ? "Capture or paste a job description first" : "";
  matchBtn.title = why || "Compare your resume against this posting";
  letterBtn.title = why || "Write a letter for this posting";

  // The letter is shown ahead of the match: it is the thing you are about to
  // paste somewhere, and the comparison stays one press away.
  if (job.letter && job.letterTs >= (job.match?.ts || 0)) renderLetter(job.letter);
  else if (job.match) renderMatch(job.match);
  else jobOut.classList.add("hidden");
}

function renderMatch(m) {
  const gaps = [...(m.gaps || [])].sort((a, b) => {
    const rank = { blocking: 0, important: 1, minor: 2 };
    return rank[a.severity] - rank[b.severity];
  });
  const meets = m.meets || [];

  jobOut.innerHTML = `
    <div class="top">
      <div class="score ${escapeHtml(m.verdict)}">${Number(m.score) || 0}%</div>
      <div class="sum">${escapeHtml(m.summary)}</div>
    </div>
    ${meets.length ? `<h4>You meet (${meets.length})</h4><ul>${
      meets.slice(0, 5).map((x) =>
        `<li class="yes">${escapeHtml(x.requirement)}${
          x.evidence ? ` <em>— ${escapeHtml(x.evidence)}</em>` : ""}</li>`).join("")}</ul>` : ""}
    ${gaps.length ? `<h4>Gaps (${gaps.length})</h4><ul>${
      gaps.slice(0, 5).map((x) =>
        `<li class="${x.severity === "blocking" ? "blocking" : "no"}">${escapeHtml(x.requirement)}${
          x.closeable ? ` <em>— ${escapeHtml(x.closeable)}</em>` : ""}</li>`).join("")}</ul>` : ""}
    ${(m.leadWith || []).length ? `<h4>Lead with</h4><ul>${
      m.leadWith.slice(0, 4).map((x) => `<li class="yes">${escapeHtml(x)}</li>`).join("")}</ul>` : ""}`;
  jobOut.classList.remove("hidden");
}

function renderLetter(text) {
  jobOut.innerHTML = `
    <div class="letter" id="letter-body"></div>
    <div class="row gap-1 mt-2">
      <button class="btn btn-sm grow" id="letter-copy">${ICONS.copy}Copy</button>
      <button class="btn btn-sm grow" id="letter-place">Put it in the form</button>
    </div>
    <div class="text-xs faint mt-2">Saved to the dashboard. Read it before you send it.</div>`;
  // Never as markup: this is model output going onto a page that can reach
  // storage, the profile and the API keys.
  $("letter-body").textContent = text;
  jobOut.classList.remove("hidden");

  $("letter-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setFooter("Letter copied.");
  });

  $("letter-place").addEventListener("click", async () => {
    const res = await withEngine("rf_place_letter", { text });
    if (!res) { unreachable(); return; }
    if (res.placed) {
      setFooter("Dropped into the cover-letter box. Read it before you submit.");
      setTimeout(() => window.close(), 1100);
    } else {
      await navigator.clipboard.writeText(text).catch(() => {});
      setFooter("No empty cover-letter box on this page, so it is on your clipboard.");
    }
  });
}

/** Ask the service worker for something, without throwing at the call site. */
const ask = (type, extra = {}) =>
  chrome.runtime.sendMessage({ type, ...extra }).catch(() => null);

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  setFooter("Reading this page…");
  const res = await ask("read_posting", { tabId: tab?.id });
  captureBtn.disabled = false;

  if (!res?.ok) {
    setFooter(escapeHtml(res?.error || "Couldn't read this page."));
    // Whether the posting was behind a "read more" or the page is one Chrome
    // will not let an extension touch at all, pasting is the way through. Open
    // the box rather than leaving a dead end with an error in it.
    openPaste();
    return;
  }

  job = res.job || await loadJob();
  paintJob();
  setFooter(`Captured the posting from <strong>${escapeHtml(job.company || job.host)}</strong>.`);
});

function openPaste() {
  pasteBox.classList.remove("hidden");
  jobTextInput.value = hasPosting() ? job.text : "";
  jobTextInput.focus();
}

pasteBtn.addEventListener("click", () => {
  if (pasteBox.classList.contains("hidden")) openPaste();
  else pasteBox.classList.add("hidden");
});

$("paste-cancel").addEventListener("click", () => pasteBox.classList.add("hidden"));

$("paste-save").addEventListener("click", async () => {
  const text = jobTextInput.value.trim();
  const res = await ask("save_posting", {
    text,
    // The page you paste on is the page you are applying from, so tying the
    // posting to it is what lets the tracker file the match against this row.
    url: tab?.url || "",
    host,
    role: (tab?.title || "").split(/\s+[|–—]\s+/)[0].slice(0, 120)
  });

  if (!res?.ok) { setFooter(escapeHtml(res?.error || "Couldn't save that.")); return; }
  job = res.job || await loadJob();
  pasteBox.classList.add("hidden");
  paintJob();
  setFooter("Posting saved.");
});

$("job-forget").addEventListener("click", async () => {
  await clearJob();
  job = { ...DEFAULT_JOB };
  jobOut.classList.add("hidden");
  paintJob();
  setFooter("Forgotten. Capture the next one when you get there.");
});

/**
 * Run one of the two requests.
 *
 * The reply is only half of how the result arrives — the worker has already
 * written it to storage by the time this resolves, and the listener below picks
 * it up if the popup happens to be reopened rather than still standing here.
 */
async function request(what) {
  const btn = what === "match" ? matchBtn : letterBtn;
  // innerHTML, not textContent: these buttons carry an icon, and putting the
  // label back as text would drop it for the rest of the session.
  const label = btn.innerHTML;
  matchBtn.disabled = letterBtn.disabled = true;
  btn.textContent = what === "match" ? "Comparing…" : "Writing…";
  setFooter("Working. This takes a moment — closing the popup won't lose it.");

  const res = await ask(what === "match" ? "job_match" : "job_letter");
  btn.innerHTML = label;
  job = await loadJob();
  paintJob();

  if (!res?.ok) { setFooter(escapeHtml(res?.error || "The model did not reply.")); return; }

  if (what === "match") {
    const m = res.match;
    setFooter(`<strong>${m.score}%</strong> — ${m.meets.length} met, ${m.gaps.length} missing.`);
  } else {
    setFooter("Draft ready below.");
  }
}

matchBtn.addEventListener("click", () => request("match"));
letterBtn.addEventListener("click", () => request("letter"));

// A run that finished while this window was closed, or one started from the
// on-page panel: either way the slot is the truth and the popup follows it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.job) return;
  job = { ...DEFAULT_JOB, ...(changes.job.newValue || {}) };
  paintJob();
});

paintJob();

setFooter(SHORTCUT_HINT);
