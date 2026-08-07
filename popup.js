// Apply karo — toolbar popup.
//
// Three jobs, in priority order: say what the extension can see on this tab,
// give you one press that fills it, and surface the two switches you actually
// reach for (fill automatically, and leave this site alone). Everything else
// lives in the dashboard.

import {
  loadContext, saveSettings, loadHistory, save, saveResumeFile,
  isSiteDisabled, setSiteDisabled, normalizeHost, completeness
} from "./src/shared/schema.js";
import { resolveProvider } from "./src/shared/ai.js";
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
if (apiKey.trim() && ctx.settings.aiAutofillEnabled) {
  $("ai-badge").textContent = model.split("/").pop().slice(0, 22);
  $("ai-badge").className = "badge badge-success";
  $("ai-badge").title = model;
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

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Detection is deliberately conservative, so the page may have decided it was
 * not an application and never loaded the engine. Force it in and retry —
 * pressing a button here is an unambiguous signal.
 */
async function withEngine(action, extra = {}) {
  noReceiver = false;
  let res = await act(action, extra);
  if (res) return res;

  noReceiver = false;
  await send({ type: "rf_force_load" });
  // The engine is a dynamic import; give it time to land before asking again,
  // and retry rather than judging it dead on one miss.
  for (let i = 0; i < 6 && !res; i++) {
    await new Promise((r) => setTimeout(r, 250));
    noReceiver = false;
    res = await act(action, extra);
  }
  return res;
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
  busy(true, "Filling…");
  setFooter("Working…");

  const res = await withEngine("rf_fill");
  busy(false);

  if (!res) { unreachable(); return; }

  await refreshStatus();

  if (res.filled > 0) {
    setFooter(`Filled <strong>${res.filled}</strong> of ${res.total} fields.`);
    setTimeout(() => window.close(), 1100);
  } else {
    setFooter(res.total ? "Nothing new to fill on this page." : "No form fields found here.");
  }
});

stepsBtn.addEventListener("click", async () => {
  busy(true, "Stepping…");
  setFooter("Filling each step. It never submits.");

  const res = await withEngine("rf_steps");
  busy(false);

  if (!res?.ok) { unreachable(); return; }
  await refreshStatus();
  setFooter(`Filled <strong>${res.filled}</strong> across ${res.steps + 1} step(s). Submit it yourself.`);
});

reviewBtn.addEventListener("click", async () => {
  const res = await withEngine("rf_highlight");
  if (!res?.ok) { unreachable(); return; }
  setFooter(res.empty
    ? `<strong>${res.empty}</strong> field(s) still empty${res.required ? `, <strong>${res.required}</strong> required` : ""}, outlined on the page.`
    : "Every visible field has a value.");
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

setFooter(SHORTCUT_HINT);
