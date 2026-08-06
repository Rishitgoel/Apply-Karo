// Apply karo — profile dashboard.

import {
  loadContext, loadResumeFile, saveResumeFile,
  saveProfile, saveSettings, saveLearned, save, DEFAULT_PROFILE,
  loadHistory, saveHistory, loadLetters, saveLetters,
  APPLICATION_STATUS, completeness, normalizeHost, setSiteDisabled,
  exportAll, importAll, resetAll, storageUsage, overlayFilled, staleApplications
} from "./src/shared/schema.js";
import { PROVIDERS, resolveProvider, canReadPdf } from "./src/shared/ai.js";
import { ICONS } from "./src/shared/icons.js";
import { applyTheme, watchTheme, THEMES } from "./src/shared/theme.js";
import {
  toast, toastError, dialog, confirmDialog, promptDialog,
  copyText, downloadBlob, pickFile, relativeTime
} from "./src/shared/ui.js";
import { CONTACT_EMAIL, feedbackMailto } from "./src/shared/contact.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PERSONAL_KEYS = [
  "firstName", "lastName", "middleName", "fullName", "email", "phone",
  "website", "linkedin", "github", "portfolio",
  "address", "city", "state", "postalCode", "country", "location",
  "visaStatus", "authorizedToWork", "sponsorshipRequired"
];

let state = await loadContext();
let resumeBase64 = await loadResumeFile();
let history = await loadHistory();
let letters = await loadLetters();

// ─── Chrome ──────────────────────────────────────────────────────────────────
$("version-line").textContent = `v${chrome.runtime.getManifest().version} · local only`;
$("logo").innerHTML = ICONS.brand;
for (const el of document.querySelectorAll("[data-icon]")) {
  el.insertAdjacentHTML("afterbegin", ICONS[el.dataset.icon] || "");
}
$("key-reveal").innerHTML = ICONS.eye;
$("save-status").innerHTML = `${ICONS.check}<span>Saved</span>`;
$("save-status").style.opacity = "0";

applyTheme(state.settings.theme);
watchTheme(() => state.settings.theme, null, null);

// ─── Elements ────────────────────────────────────────────────────────────────
const eduList = $("education-list");
const eduTemplate = $("education-template");
const expList = $("experience-list");
const expTemplate = $("experience-template");
const saveStatus = $("save-status");

const providerSelect = $("ai-provider");
const apiKeyInput = $("ai-api-key");
const modelInput = $("ai-model");
const modelSuggestions = $("model-suggestions");
const modelHint = $("model-hint");
const providerNameKey = $("provider-name-key");
const keyLink = $("key-link");
const testApiBtn = $("test-api-btn");
const apiKeyStatus = $("api-key-status");

const uploadZone = $("upload-zone");
const fileInput = $("resume-file-input");
const resumeDetails = $("resume-details");
const deleteResumeBtn = $("delete-resume-btn");
const parseResumeBtn = $("parse-resume-btn");
const autofillProfileBtn = $("autofill-profile-btn");
const resumeParsedText = $("resume-parsed-text");

const mappingsList = $("mappings-list");
const customFieldsList = $("custom-fields-list");
const aiAutofillToggle = $("ai-autofill-toggle");

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ask = (type, payload = {}) =>
  chrome.runtime.sendMessage({ type, ...payload }).then((r) => {
    if (!r?.ok) throw new Error(r?.error || "Request failed.");
    return r;
  });

let flashTimer = null;
function flash(text = "Saved") {
  saveStatus.querySelector("span").textContent = text;
  saveStatus.style.opacity = "1";
  saveStatus.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { saveStatus.style.opacity = "0"; }, 2200);
}

/** Run `fn` while a button shows a working label, then put the label back. */
async function withButton(btn, label, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); }
  finally { btn.textContent = original; btn.disabled = false; }
}

function emptyState(icon, title, body) {
  return `<div class="empty-state">${ICONS[icon]}<strong>${esc(title)}</strong><p>${esc(body)}</p></div>`;
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
const tabItems = [...document.querySelectorAll(".menu-item")];
const tabContents = [...document.querySelectorAll(".tab-content")];

// `history` in this module is the application log, not window.history — the
// tab a user is on is tracked in the hash so a reload keeps their place and the
// overview's "See all" buttons are ordinary links to it.
function showTab(id) {
  if (!document.getElementById(id)) return;
  tabItems.forEach((i) => i.classList.toggle("active", i.dataset.tab === id));
  tabContents.forEach((c) => c.classList.toggle("active", c.id === id));
  window.scrollTo({ top: 0 });
  if (location.hash !== `#${id}`) location.hash = id;
}

tabItems.forEach((item) => {
  item.addEventListener("click", () => showTab(item.dataset.tab));
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showTab(item.dataset.tab); }
  });
});
document.querySelectorAll("[data-goto]").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.goto)));

if (location.hash) showTab(location.hash.slice(1));
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

// ─── Theme switch ────────────────────────────────────────────────────────────
function paintThemeSwitch() {
  for (const b of document.querySelectorAll("[data-theme-choice]")) {
    b.classList.toggle("active", b.dataset.themeChoice === state.settings.theme);
  }
}
{
  const icons = { light: "sun", system: "monitor", dark: "moon" };
  for (const b of document.querySelectorAll("[data-theme-choice]")) {
    b.innerHTML = ICONS[icons[b.dataset.themeChoice]];
    b.addEventListener("click", async () => {
      state.settings.theme = b.dataset.themeChoice;
      applyTheme(state.settings.theme);
      paintThemeSwitch();
      await saveSettings(state.settings);
      flash("Theme saved");
    });
  }
  paintThemeSwitch();
}
if (!THEMES.includes(state.settings.theme)) state.settings.theme = "system";

// ─── Repeaters ───────────────────────────────────────────────────────────────
function addEducationCard(data = {}) {
  const card = eduTemplate.content.cloneNode(true).querySelector(".repeater-card");
  for (const k of ["school", "gpa", "degree", "fieldOfStudy", "startDate", "endDate"]) {
    const el = card.querySelector(`.edu-${k}`);
    if (el) el.value = data[k] || "";
  }
  wireRepeaterCard(card, ".edu-school", "School");
  eduList.appendChild(card);
  renumber(eduList);
}

function addExperienceCard(data = {}) {
  const card = expTemplate.content.cloneNode(true).querySelector(".repeater-card");
  for (const k of ["company", "location", "title", "timeframe", "description"]) {
    const el = card.querySelector(`.exp-${k}`);
    if (el) el.value = data[k] || "";
  }
  wireRepeaterCard(card, ".exp-company", "Role");
  expList.appendChild(card);
  renumber(expList);
}

/**
 * Give the card a live title and a working delete button.
 *
 * v1 used an inline `onclick` here, which a strict extension CSP refuses to run
 * — so the delete button on every education and experience card did nothing.
 */
function wireRepeaterCard(card, primarySelector, kind) {
  const title = card.querySelector("[data-role=title]");
  const primary = card.querySelector(primarySelector);
  const del = card.querySelector(".repeater-card-delete");
  del.innerHTML = ICONS.trash;

  const paint = () => {
    const list = card.parentElement;
    const n = list ? [...list.children].indexOf(card) + 1 : 1;
    title.textContent = primary.value.trim() || `${kind} ${n}`;
  };
  primary.addEventListener("input", () => { paint(); queueSave(); });
  card.addEventListener("input", queueSave);
  card.dataset.paint = "1";
  card._paint = paint;
  paint();

  del.addEventListener("click", () => {
    const list = card.parentElement;
    card.remove();
    renumber(list);
    queueSave();
  });
}

function renumber(list) {
  if (!list) return;
  for (const card of list.children) card._paint?.();
}

// ─── Render ──────────────────────────────────────────────────────────────────
function renderAll() {
  const personal = state.profile.personal || {};
  for (const key of PERSONAL_KEYS) {
    const el = $(`personal-${key}`);
    if (el) el.value = personal[key] || "";
  }

  $("skills-list").value = state.profile.skills || "";
  $("profile-summary").value = state.profile.summary || "";

  eduList.innerHTML = "";
  (state.profile.education || []).forEach(addEducationCard);
  expList.innerHTML = "";
  (state.profile.experience || []).forEach(addExperienceCard);

  providerSelect.value = PROVIDERS[state.settings.provider] ? state.settings.provider : "gemini";
  aiAutofillToggle.checked = state.settings.aiAutofillEnabled === true;

  renderProvider();
  renderResume();
  renderLearned();
  renderCustomFields();
  renderSkillChips();
  renderCounts();
  renderOverview();
  renderApplications();
  renderLetters();
  renderSettings();
}

function renderCounts() {
  $("nav-count-apps").textContent = String(history.length);
  $("nav-count-learned").textContent = String(Object.keys(state.learned).length);
  $("nav-count-custom").textContent = String(Object.keys(state.profile.customFields || {}).length);
  $("summary-count").textContent = String(($("profile-summary").value || "").length);
  $("resume-text-count").textContent = String((resumeParsedText.value || "").length);
}

function renderSkillChips() {
  const skills = ($("skills-list").value || "").split(",").map((s) => s.trim()).filter(Boolean);
  $("skill-chips").innerHTML = skills.length
    ? skills.slice(0, 40).map((s) => `<span class="badge badge-neutral">${esc(s)}</span>`).join("") +
      (skills.length > 40 ? `<span class="badge badge-neutral">+${skills.length - 40}</span>` : "")
    : `<span class="text-xs faint">Skills you list here show up as chips.</span>`;
}

// ─── Overview ────────────────────────────────────────────────────────────────
const RING_CIRCUMFERENCE = 2 * Math.PI * 37;

/**
 * Applications that have gone quiet.
 *
 * No model, no network — the timestamp is already on the row, so this is a
 * filter. It is also the one thing a tracker can tell you that a spreadsheet
 * will not, because a spreadsheet never volunteers anything.
 */
function renderNudges() {
  const box = $("nudge-box");
  if (!box) return;

  const stale = staleApplications(history, state.settings.followUpDays ?? 14);
  if (!stale.length) { box.innerHTML = ""; box.hidden = true; return; }

  box.hidden = false;
  box.innerHTML = `
    <div class="nudge-list">
      ${stale.slice(0, 5).map((h) => `
        <div class="nudge" data-url="${esc(h.url)}">
          ${ICONS.clock}
          <span class="grow truncate">
            <strong>${esc(h.company || h.host)}</strong>
            ${h.role ? ` — ${esc(h.role)}` : ""}
            · ${h.daysSince} days with no update
          </span>
          <a class="icon-btn" href="${esc(h.url)}" target="_blank" rel="noopener"
             title="Open the posting">${ICONS.external}</a>
        </div>`).join("")}
    </div>
    ${stale.length > 5 ? `<div class="text-xs faint mt-2">and ${stale.length - 5} more.</div>` : ""}`;
}

function renderOverview() {
  const name = state.profile.personal?.firstName || "";
  $("greeting").textContent = name ? `Hello, ${name}` : "Welcome to Apply karo";

  const c = completeness(state.profile, state.resumeMeta, state.settings);
  $("ring-label").textContent = `${c.percent}%`;
  $("ring-value").setAttribute("stroke-dasharray", String(RING_CIRCUMFERENCE));
  $("ring-value").setAttribute("stroke-dashoffset",
    String(RING_CIRCUMFERENCE * (1 - c.percent / 100)));
  $("ready-sub").textContent = c.percent === 100
    ? "Everything is in place. Applications should complete in one press."
    : "Fill these in once and most application forms complete in a single press.";

  $("checklist").innerHTML = c.items.map((i) => `
    <div class="check-item ${i.done ? "done" : ""}" data-goto-tab="${i.tab}" title="${esc(i.hint || "")}">
      <span class="check-mark">${ICONS.check}</span>
      <span class="check-text">${esc(i.label)}</span>
      <span class="check-go">${i.done ? "Edit" : "Add"} &rsaquo;</span>
    </div>`).join("");
  $("checklist").querySelectorAll("[data-goto-tab]").forEach((el) =>
    el.addEventListener("click", () => showTab(el.dataset.gotoTab)));

  const week = Date.now() - 7 * 864e5;
  const fieldsFilled = history.reduce((n, h) => n + (h.filled || 0), 0);
  $("overview-stats").innerHTML = [
    ["archive", "accent", history.length, "applications tracked"],
    ["clock", "info", history.filter((h) => (h.ts || 0) > week).length, "in the last 7 days"],
    ["bolt", "success", fieldsFilled, "fields filled for you"],
    ["brain", "warning", Object.keys(state.learned).length, "answers learned"]
  ].map(([icon, tone, value, label]) => `
    <div class="stat">
      <div class="stat-icon badge-${tone}">${ICONS[icon]}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-label">${esc(label)}</div>
    </div>`).join("");

  renderNudges();

  const recent = history.slice(0, 5);
  $("recent-list").innerHTML = recent.length
    ? recent.map((h) => `
      <div class="row-between" style="padding:11px 18px;border-top:1px solid var(--border)">
        <div class="grow" style="min-width:0">
          <div class="truncate" style="font-weight:550;font-size:13px">${esc(h.company || h.host)}</div>
          <div class="text-xs muted truncate">${esc(h.role || h.title || h.host)}</div>
        </div>
        <span class="badge badge-neutral">${h.filled} filled</span>
        <span class="text-xs faint" style="width:88px;text-align:right">${esc(relativeTime(h.ts))}</span>
      </div>`).join("")
    : emptyState("archive", "Nothing filled yet",
        "Open a job application and press Fill. Every page you fill shows up here.");
}

// ─── Resume ──────────────────────────────────────────────────────────────────
function renderResume() {
  const has = !!resumeBase64;
  uploadZone.classList.toggle("hidden", has);
  resumeDetails.classList.toggle("hidden", !has);

  if (has) {
    $("active-filename").textContent = state.resumeMeta.fileName || "resume.pdf";
    $("active-filesize").textContent = state.resumeMeta.fileSize || "";
  }
  if (resumeParsedText.value !== (state.resumeMeta.text || "")) {
    resumeParsedText.value = state.resumeMeta.text || "";
  }

  const keyed = !!apiKeyInput.value.trim();
  // Only a multimodal provider can read the PDF itself. On Groq the button is
  // disabled and says why, rather than failing after you press it.
  const pdfCapable = canReadPdf({ provider: providerSelect.value });

  parseResumeBtn.disabled = !(has && keyed && pdfCapable);
  parseResumeBtn.title = !has ? "Upload a resume first"
    : !keyed ? "Add an API key first"
    : pdfCapable ? "Extract the resume text so the AI can use it"
    : `${PROVIDERS[providerSelect.value].label} cannot read PDFs — paste the text below instead.`;

  autofillProfileBtn.disabled = !(keyed && state.resumeMeta.text);
  autofillProfileBtn.title = autofillProfileBtn.disabled
    ? "Needs an API key and some resume text"
    : "Read the resume text and fill in the profile fields";
}

function setApiBadge(tone, text) {
  apiKeyStatus.textContent = text;
  apiKeyStatus.className = `badge badge-${tone}`;
}

/** Point the key and model fields at whichever provider is selected. */
function renderProvider() {
  const name = providerSelect.value;
  const spec = PROVIDERS[name];

  apiKeyInput.value = (name === "groq" ? state.settings.groqApiKey : state.settings.geminiApiKey) || "";
  apiKeyInput.placeholder = spec.keyPlaceholder;
  modelInput.value = (name === "groq" ? state.settings.groqModel : state.settings.geminiModel) || spec.models[0];
  modelInput.placeholder = spec.models[0];

  providerNameKey.textContent = `(${spec.label})`;
  keyLink.href = spec.keyUrl;
  keyLink.textContent = new URL(spec.keyUrl).host;

  // Free-text field backed by suggestions, so a model that ships next week is
  // usable immediately instead of waiting for this list to be updated.
  modelSuggestions.innerHTML = spec.models.map((m) => `<option value="${esc(m)}">`).join("");
  modelHint.textContent = spec.readsPdf
    ? "Any model id the provider accepts works here, including ones not listed."
    : "Any model id Groq accepts works here. Groq cannot read PDFs, so paste your resume text below (or keep a Gemini key to parse it).";

  setApiBadge(apiKeyInput.value.trim() ? "warning" : "danger",
              apiKeyInput.value.trim() ? "Not tested" : "No key");
}

$("key-reveal").addEventListener("click", () => {
  const show = apiKeyInput.type === "password";
  apiKeyInput.type = show ? "text" : "password";
  $("key-reveal").innerHTML = show ? ICONS.eyeOff : ICONS.eye;
  $("key-reveal").title = show ? "Hide the key" : "Show the key";
});

// ─── Saving ──────────────────────────────────────────────────────────────────
$("add-education-btn").addEventListener("click", () => { addEducationCard(); queueSave(); });
$("add-experience-btn").addEventListener("click", () => { addExperienceCard(); queueSave(); });

function collectProfile() {
  // Start from what is already stored so keys without a visible input (and any
  // added by a future version) survive a save instead of being dropped.
  const personal = { ...state.profile.personal };
  for (const key of PERSONAL_KEYS) {
    const el = $(`personal-${key}`);
    if (el) personal[key] = el.value.trim();
  }

  const read = (card, cls) => (card.querySelector(cls)?.value || "").trim();

  const education = [...eduList.querySelectorAll(".education-card")].map((c) => ({
    school: read(c, ".edu-school"), gpa: read(c, ".edu-gpa"),
    degree: read(c, ".edu-degree"), fieldOfStudy: read(c, ".edu-fieldOfStudy"),
    startDate: read(c, ".edu-startDate"), endDate: read(c, ".edu-endDate")
  })).filter((e) => e.school || e.degree);

  const experience = [...expList.querySelectorAll(".experience-card")].map((c) => ({
    company: read(c, ".exp-company"), location: read(c, ".exp-location"),
    title: read(c, ".exp-title"), timeframe: read(c, ".exp-timeframe"),
    description: read(c, ".exp-description")
  })).filter((e) => e.company || e.title);

  return {
    personal,
    education,
    experience,
    skills: $("skills-list").value.trim(),
    summary: $("profile-summary").value.trim(),
    // v1 rebuilt this object without customFields, silently wiping every
    // learned answer on each save. Carry them through.
    customFields: state.profile.customFields || {}
  };
}

async function saveEverything(quiet = false) {
  state.profile = collectProfile();
  captureProviderFields();
  state.settings.aiAutofillEnabled = aiAutofillToggle.checked;
  state.resumeMeta.text = resumeParsedText.value;

  await Promise.all([
    saveProfile(state.profile),
    saveSettings(state.settings),
    save({ resumeMeta: state.resumeMeta })
  ]);

  renderOverview();
  renderCounts();
  if (!quiet) flash();
}

/**
 * Autosave. Typing a whole profile and then losing it to a closed tab because
 * you never noticed the Save button is a bad trade; the explicit button stays
 * for people who want to see it happen.
 */
let saveTimer = null;
function queueSave() {
  saveStatus.style.opacity = "1";
  saveStatus.classList.remove("show");
  saveStatus.querySelector("span").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveEverything(false).catch(toastError), 800);
}

for (const el of document.querySelectorAll(
  ".dashboard-content input.form-control, .dashboard-content textarea.form-control, .dashboard-content select.form-control")) {
  if (el.closest("#tab-letter") || el.closest("#tab-applications") ||
      el.id === "ai-api-key" || el.id === "ai-model" || el.id === "ai-provider" ||
      el.id.startsWith("app-") || el.id.endsWith("-search")) continue;
  el.addEventListener("input", queueSave);
}

$("global-save-btn").addEventListener("click", () => {
  clearTimeout(saveTimer);
  saveEverything().catch(toastError);
});

// Nothing typed in the last second should be lost to a closed tab.
window.addEventListener("beforeunload", () => {
  if (saveTimer) { clearTimeout(saveTimer); saveEverything(true); }
});

$("skills-list").addEventListener("input", renderSkillChips);
$("profile-summary").addEventListener("input", renderCounts);
resumeParsedText.addEventListener("input", renderCounts);

// ─── Resume upload ───────────────────────────────────────────────────────────
uploadZone.addEventListener("click", () => fileInput.click());
$("replace-resume-btn").addEventListener("click", () => fileInput.click());
uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", (e) => { if (e.target.files[0]) processFile(e.target.files[0]); });

function processFile(file) {
  if (file.type !== "application/pdf") { toast("Only PDF files are supported.", "error"); return; }
  if (file.size > 8 * 1024 * 1024) { toast("That PDF is over 8 MB — most ATS uploads reject it.", "warning"); }

  const reader = new FileReader();
  reader.onload = async (e) => {
    resumeBase64 = e.target.result;
    const kb = Math.round(file.size / 1024);
    state.resumeMeta = {
      fileName: file.name,
      fileSize: kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`,
      text: state.resumeMeta.text || ""
    };
    await Promise.all([saveResumeFile(resumeBase64), save({ resumeMeta: state.resumeMeta })]);
    renderResume();
    renderOverview();
    toast(`${file.name} is ready to be attached.`);
  };
  reader.onerror = () => toast("Couldn't read that file.", "error");
  reader.readAsDataURL(file);
}

deleteResumeBtn.addEventListener("click", async () => {
  if (!await confirmDialog({
    title: "Remove the resume?",
    body: "The PDF is deleted from this browser. The extracted text is kept, so the AI can still answer from it.",
    confirmText: "Remove", danger: true
  })) return;

  resumeBase64 = "";
  state.resumeMeta = { fileName: "", fileSize: "", text: state.resumeMeta.text || "" };
  await Promise.all([saveResumeFile(""), save({ resumeMeta: state.resumeMeta })]);
  renderResume();
  renderOverview();
  toast("Resume removed.");
});

// ─── Provider ────────────────────────────────────────────────────────────────
/** Read the on-screen key and model back into the settings for this provider. */
function captureProviderFields() {
  const name = providerSelect.value;
  state.settings.provider = name;
  const key = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || PROVIDERS[name].models[0];
  if (name === "groq") {
    state.settings.groqApiKey = key;
    state.settings.groqModel = model;
  } else {
    state.settings.geminiApiKey = key;
    state.settings.geminiModel = model;
  }
}

// Switching provider saves whatever is typed first, so neither key is lost.
providerSelect.addEventListener("change", async () => {
  const previous = state.settings.provider;
  if (previous && PROVIDERS[previous]) {
    const key = apiKeyInput.value.trim();
    const model = modelInput.value.trim();
    if (previous === "groq") { state.settings.groqApiKey = key; if (model) state.settings.groqModel = model; }
    else { state.settings.geminiApiKey = key; if (model) state.settings.geminiModel = model; }
  }
  state.settings.provider = providerSelect.value;
  renderProvider();
  renderResume();
  await saveSettings(state.settings);
});

apiKeyInput.addEventListener("input", () => { renderResume(); renderOverview(); });
apiKeyInput.addEventListener("change", async () => { captureProviderFields(); await saveSettings(state.settings); });
modelInput.addEventListener("change", async () => { captureProviderFields(); await saveSettings(state.settings); });

testApiBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || PROVIDERS[providerSelect.value].models[0];
  const label = PROVIDERS[providerSelect.value].label;

  if (!key) { setApiBadge("danger", "No key"); toast(`Enter a ${label} API key first.`, "error"); return; }

  setApiBadge("warning", "Testing…");
  await withButton(testApiBtn, "Testing…", async () => {
    try {
      // Tests exactly what is on screen, including a model name typed by hand,
      // so a wrong id surfaces here rather than mid-application.
      await ask("test_key", { provider: providerSelect.value, apiKey: key, model });
      setApiBadge("success", `${model} works`);
      captureProviderFields();
      await saveSettings(state.settings);
      renderResume();
      renderOverview();
      toast(`${label} answered on ${model}.`);
    } catch (err) {
      setApiBadge("danger", "Failed");
      toast(`${label} test failed for "${model}": ${err.message}`, "error");
    }
  });
});

parseResumeBtn.addEventListener("click", async () => {
  if (!resumeBase64) { toast("Upload a resume first.", "error"); return; }
  await withButton(parseResumeBtn, "Extracting…", async () => {
    try {
      const { text } = await ask("parse_resume", { dataUrl: resumeBase64 });
      resumeParsedText.value = text;
      state.resumeMeta.text = text;
      await save({ resumeMeta: state.resumeMeta });
      renderResume();
      renderCounts();
      renderOverview();
      toast(`Extracted ${text.length.toLocaleString()} characters.`);
    } catch (err) {
      toastError(err);
    }
  });
});

autofillProfileBtn.addEventListener("click", async () => {
  if (!state.resumeMeta.text) { toast("Extract the resume text first.", "error"); return; }
  await withButton(autofillProfileBtn, "Reading…", async () => {
    try {
      const { profile } = await ask("extract_profile", { resumeText: state.resumeMeta.text });
      // Overlay, never overwrite with nothing. The extraction prompt asks for ""
      // when a fact is absent, and a resume states neither a street address nor
      // an answer to a work-authorization question — so a plain spread wrote
      // those blanks over values you had typed by hand. A blank from the
      // extractor means "the resume does not say", not "clear this field".
      state.profile = {
        ...overlayFilled(state.profile, profile),
        personal: overlayFilled(state.profile.personal, profile.personal),
        customFields: state.profile.customFields || {}
      };
      await saveProfile(state.profile);
      renderAll();
      toast("Profile filled in from your resume. Check it over.");
    } catch (err) {
      toastError(err);
    }
  });
});

// DEFAULT_PROFILE is an empty template, so this is a reset rather than a load:
// it clears the profile back to blank and leaves the learned answers and custom
// fields — which are keyed by question, not by whose profile it is — in place.
$("load-defaults-btn").addEventListener("click", async () => {
  if (!await confirmDialog({
    title: "Clear the profile?",
    body: "Every profile field is emptied, including education and experience. Your resume, learned answers and custom fields are kept.",
    confirmText: "Clear profile", danger: true
  })) return;

  state.profile = {
    ...structuredClone(DEFAULT_PROFILE),
    customFields: state.profile.customFields || {}
  };
  await saveProfile(state.profile);
  renderAll();
  toast("Profile cleared.");
});

aiAutofillToggle.addEventListener("change", async () => {
  state.settings.aiAutofillEnabled = aiAutofillToggle.checked;
  await saveSettings(state.settings);
  flash(aiAutofillToggle.checked ? "AI answers on" : "AI answers off");
});

// ─── Key/value lists ─────────────────────────────────────────────────────────
function renderKeyValueList(container, data, { onChange, onDelete, empty, rowClass, keyClass, filter }) {
  container.innerHTML = "";
  const needle = (filter || "").toLowerCase();
  const keys = Object.keys(data)
    .filter((k) => !needle || k.toLowerCase().includes(needle) || String(data[k]).toLowerCase().includes(needle))
    .sort((a, b) => a.localeCompare(b));

  if (!keys.length) {
    container.innerHTML = Object.keys(data).length
      ? emptyState("search", "No matches", "Nothing here matches that search.")
      : empty;
    return;
  }

  for (const key of keys) {
    const row = document.createElement("div");
    row.className = rowClass;

    const label = document.createElement("span");
    label.className = keyClass;
    label.textContent = key;
    label.title = key;

    const input = document.createElement("input");
    input.className = "form-control";
    input.value = data[key];
    const wrapper = document.createElement("div");
    wrapper.className = "grow";
    wrapper.appendChild(input);
    input.addEventListener("change", () => onChange(key, input.value.trim()));

    const del = document.createElement("button");
    del.className = "btn btn-danger btn-sm";
    del.innerHTML = ICONS.trash;
    del.title = `Forget "${key}"`;
    del.addEventListener("click", () => onDelete(key));

    row.append(label, wrapper, del);
    container.appendChild(row);
  }
}

let learnedFilter = "";
let customFilter = "";

function renderLearned() {
  renderKeyValueList(mappingsList, state.learned, {
    filter: learnedFilter,
    onChange: async (k, v) => { state.learned[k] = v; await saveLearned(state.learned); flash(); },
    onDelete: async (k) => { delete state.learned[k]; await saveLearned(state.learned); renderLearned(); renderCounts(); flash("Forgotten"); },
    empty: emptyState("brain", "Nothing learned yet",
      "Fill a form field in by hand and the question and your answer are remembered here."),
    rowClass: "learned-mapping-item", keyClass: "learned-mapping-key"
  });
}

function renderCustomFields() {
  if (!state.profile.customFields) state.profile.customFields = {};
  renderKeyValueList(customFieldsList, state.profile.customFields, {
    filter: customFilter,
    onChange: async (k, v) => { state.profile.customFields[k] = v; await saveProfile(state.profile); flash(); },
    onDelete: async (k) => { delete state.profile.customFields[k]; await saveProfile(state.profile); renderCustomFields(); renderCounts(); flash("Removed"); },
    empty: emptyState("list", "No custom fields yet",
      "Add answers to questions you get asked over and over — notice period, salary expectation, pronouns."),
    rowClass: "custom-field-row", keyClass: "custom-field-key"
  });
}

$("learned-search").addEventListener("input", (e) => { learnedFilter = e.target.value; renderLearned(); });
$("custom-search").addEventListener("input", (e) => { customFilter = e.target.value; renderCustomFields(); });

$("clear-mappings-btn").addEventListener("click", async () => {
  if (!await confirmDialog({
    title: "Forget every learned answer?",
    body: `${Object.keys(state.learned).length} answers will be deleted. This cannot be undone.`,
    confirmText: "Forget all", danger: true
  })) return;
  state.learned = {};
  await saveLearned(state.learned);
  renderLearned();
  renderCounts();
  toast("Learned answers cleared.");
});

$("add-learned-btn").addEventListener("click", async () => {
  const r = await dialog({
    title: "Add a learned answer",
    body: "The question is matched against the form's visible label, so write it the way the form asks it.",
    fields: [
      { key: "label", label: "Question / field label", placeholder: "how did you hear about us?" },
      { key: "value", label: "Your answer", placeholder: "A friend who works here" }
    ],
    confirmText: "Add"
  });
  if (!r?.label) return;
  state.learned[r.label.toLowerCase()] = r.value;
  await saveLearned(state.learned);
  renderLearned();
  renderCounts();
  toast("Saved.");
});

$("add-custom-field-btn").addEventListener("click", () => addCustomField());

async function addCustomField(name = "", value = "") {
  const r = await dialog({
    title: "Add a custom field",
    fields: [
      { key: "name", label: "Field name", value: name, placeholder: "notice period" },
      { key: "value", label: "Value", value, placeholder: "30 days" }
    ],
    confirmText: "Add"
  });
  if (!r?.name) return;
  state.profile.customFields[r.name.toLowerCase()] = r.value;
  await saveProfile(state.profile);
  renderCustomFields();
  renderCounts();
  toast("Saved.");
}

{
  const suggestions = [
    "notice period", "expected salary", "current salary", "years of experience",
    "gender", "pronouns", "race / ethnicity", "veteran status", "disability status",
    "how did you hear about us", "willing to relocate", "earliest start date",
    "preferred work location", "referral name"
  ];
  $("suggested-fields").innerHTML = suggestions
    .map((s) => `<button class="btn btn-sm" data-suggest="${esc(s)}">${ICONS.plus}${esc(s)}</button>`).join("");
  $("suggested-fields").querySelectorAll("[data-suggest]").forEach((b) =>
    b.addEventListener("click", () => addCustomField(b.dataset.suggest)));
}

// ─── Cover letters ───────────────────────────────────────────────────────────
$("generate-letter-btn").addEventListener("click", async () => {
  const jd = $("jd-input").value.trim();
  if (jd.length < 120) { toast("Paste a bit more of the job description first.", "error"); return; }

  const btn = $("generate-letter-btn");
  await withButton(btn, "Writing…", async () => {
    try {
      const role = $("letter-role").value.trim();
      const company = $("letter-company").value.trim();
      const context = [
        role && `The role is: ${role}.`,
        company && `The company is: ${company}.`,
        jd
      ].filter(Boolean).join("\n\n");

      const { text } = await ask("cover_letter", { jobDescription: context, profile: state.profile });
      $("letter-output").value = text;
      $("letter-output-card").hidden = false;
      $("letter-output-card").scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Draft ready. Read it before you send it.");
    } catch (err) {
      toastError(err);
    }
  });
});

const letterName = () => {
  const parts = [$("letter-company").value.trim(), $("letter-role").value.trim()].filter(Boolean);
  return parts.length ? parts.join(" — ") : "Untitled letter";
};

$("copy-letter-btn").addEventListener("click", () => copyText($("letter-output").value, "Letter copied"));
$("download-letter-btn").addEventListener("click", () =>
  downloadBlob(`cover-letter-${Date.now()}.txt`, $("letter-output").value, "text/plain"));

$("save-letter-btn").addEventListener("click", async () => {
  const text = $("letter-output").value.trim();
  if (!text) return;
  letters.unshift({ id: `${Date.now()}`, title: letterName(), text, ts: Date.now() });
  await saveLetters(letters);
  renderLetters();
  toast("Letter saved.");
});

function renderLetters() {
  const list = $("letters-list");
  if (!letters.length) {
    list.innerHTML = emptyState("pen", "No saved letters",
      "Generate one above and press Save to keep it for a similar role later.");
    return;
  }
  list.innerHTML = letters.map((l) => `
    <div class="row-between" style="padding:11px 18px;border-top:1px solid var(--border)">
      <div class="grow" style="min-width:0">
        <div class="truncate" style="font-weight:550;font-size:13px">${esc(l.title)}</div>
        <div class="text-xs muted truncate">${esc(l.text.slice(0, 110))}…</div>
      </div>
      <span class="text-xs faint" style="width:86px;text-align:right">${esc(relativeTime(l.ts))}</span>
      <button class="btn btn-sm" data-open-letter="${esc(l.id)}">Open</button>
      <button class="btn btn-danger btn-sm" data-del-letter="${esc(l.id)}">${ICONS.trash}</button>
    </div>`).join("");

  list.querySelectorAll("[data-open-letter]").forEach((b) => b.addEventListener("click", () => {
    const l = letters.find((x) => x.id === b.dataset.openLetter);
    if (!l) return;
    $("letter-output").value = l.text;
    $("letter-output-card").hidden = false;
    $("letter-output-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }));

  list.querySelectorAll("[data-del-letter]").forEach((b) => b.addEventListener("click", async () => {
    letters = letters.filter((x) => x.id !== b.dataset.delLetter);
    await saveLetters(letters);
    renderLetters();
  }));
}

$("clear-letters-btn").addEventListener("click", async () => {
  if (!letters.length) return;
  if (!await confirmDialog({ title: "Delete every saved letter?", confirmText: "Delete", danger: true })) return;
  letters = [];
  await saveLetters(letters);
  renderLetters();
});

// ─── Applications ────────────────────────────────────────────────────────────
$("app-status-filter").insertAdjacentHTML("beforeend",
  APPLICATION_STATUS.map((s) => `<option value="${s.value}">${esc(s.label)}</option>`).join(""));

let appFilter = "";
let appStatus = "";

$("app-search").addEventListener("input", (e) => { appFilter = e.target.value.toLowerCase(); renderApplications(); });
$("app-status-filter").addEventListener("change", (e) => { appStatus = e.target.value; renderApplications(); });

/**
 * The Fit cell. Hovering gives the whole comparison, because a bare percentage
 * is not actionable and the gaps are the part worth reading.
 */
function fitCell(match) {
  if (!match || typeof match.score !== "number") return `<span class="text-xs faint">—</span>`;

  const lines = [];
  if (match.summary) lines.push(match.summary, "");
  if (match.meets?.length) {
    lines.push(`MEETS (${match.meets.length})`,
      ...match.meets.slice(0, 8).map((m) => `  + ${m.requirement}`));
  }
  if (match.gaps?.length) {
    if (lines.length) lines.push("");
    lines.push(`GAPS (${match.gaps.length})`,
      ...match.gaps.slice(0, 8).map((g) => `  ${g.severity === "blocking" ? "!" : "-"} ${g.requirement}`));
  }

  return `<span class="fit fit-${esc(match.verdict || "fair")}" title="${esc(lines.join("\n"))}">${match.score}%</span>`;
}

function renderApplications() {
  const body = $("applications-body");

  const counts = Object.fromEntries(APPLICATION_STATUS.map((s) => [s.value, 0]));
  for (const h of history) counts[h.status] = (counts[h.status] || 0) + 1;
  $("app-stats").innerHTML = [
    ["archive", "accent", history.length, "total"],
    ["target", "info", counts.applied || 0, "applied"],
    ["clock", "warning", counts.interview || 0, "interviewing"],
    ["check", "success", counts.offer || 0, "offers"]
  ].map(([icon, tone, value, label]) => `
    <div class="stat">
      <div class="stat-icon badge-${tone}">${ICONS[icon]}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-label">${esc(label)}</div>
    </div>`).join("");

  const rows = history.filter((h) => {
    if (appStatus && h.status !== appStatus) return false;
    if (!appFilter) return true;
    return `${h.company} ${h.role} ${h.host} ${h.title}`.toLowerCase().includes(appFilter);
  });

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8">${history.length
      ? emptyState("search", "No matches", "Nothing here matches that filter.")
      : emptyState("archive", "No applications yet",
          "Every page you fill is logged here automatically. Turn it off in Settings if you would rather it wasn't.")
      }</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((h) => `
    <tr data-url="${esc(h.url)}">
      <td style="font-weight:550;max-width:180px" class="truncate">${esc(h.company || h.host)}</td>
      <td style="max-width:260px" class="truncate" title="${esc(h.role || h.title || "")}">${esc(h.role || h.title || "—")}</td>
      <td class="text-xs muted truncate" style="max-width:150px">${esc(h.host)}</td>
      <td class="shrink">${fitCell(h.match)}</td>
      <td class="shrink text-xs muted">${h.filled}/${h.total || "?"}</td>
      <td class="shrink text-xs muted" title="${esc(new Date(h.ts).toLocaleString())}">${esc(relativeTime(h.ts))}</td>
      <td class="shrink">
        <select class="status-select" data-status="${esc(h.status)}" data-set-status>
          ${APPLICATION_STATUS.map((s) =>
            `<option value="${s.value}"${s.value === h.status ? " selected" : ""}>${esc(s.label)}</option>`).join("")}
        </select>
      </td>
      <td class="shrink">
        <div class="row gap-1">
          <a class="icon-btn" href="${esc(h.url)}" target="_blank" rel="noopener" title="Open the posting">${ICONS.external}</a>
          <button class="icon-btn" data-del-app title="Remove from the list">${ICONS.trash}</button>
        </div>
      </td>
    </tr>`).join("");

  body.querySelectorAll("[data-set-status]").forEach((sel) =>
    sel.addEventListener("change", async () => {
      const url = sel.closest("tr").dataset.url;
      const row = history.find((h) => h.url === url);
      if (!row) return;
      row.status = sel.value;
      sel.dataset.status = sel.value;
      await saveHistory(history);
      renderApplications();
      renderOverview();
    }));

  body.querySelectorAll("[data-del-app]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const url = btn.closest("tr").dataset.url;
      history = history.filter((h) => h.url !== url);
      await saveHistory(history);
      renderApplications();
      renderCounts();
      renderOverview();
    }));
}

$("export-apps-btn").addEventListener("click", () => {
  if (!history.length) { toast("Nothing to export yet.", "warning"); return; }
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    ["Date", "Company", "Role", "Site", "Status", "Fields filled", "URL"].join(","),
    ...history.map((h) => [
      new Date(h.ts).toISOString().slice(0, 10),
      h.company, h.role || h.title, h.host, h.status, h.filled, h.url
    ].map(cell).join(","))
  ].join("\n");
  downloadBlob(`applykaro-applications-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
  toast(`Exported ${history.length} rows.`);
});

$("clear-apps-btn").addEventListener("click", async () => {
  if (!history.length) return;
  if (!await confirmDialog({
    title: "Clear the application log?",
    body: `${history.length} entries will be deleted. Your profile and learned answers are untouched.`,
    confirmText: "Clear log", danger: true
  })) return;
  history = [];
  await saveHistory(history);
  renderApplications();
  renderCounts();
  renderOverview();
  toast("Application log cleared.");
});

// ─── Settings ────────────────────────────────────────────────────────────────
const SETTING_TOGGLES = {
  "set-autofill": "autofillOnLoad",
  "set-upload": "autoUploadResume",
  "set-highlight": "highlightFills",
  "set-sensitive": "skipSensitive",
  "set-panel": "panelEnabled",
  "set-track": "trackApplications",
  "set-badge": "showBadge"
};

for (const [id, key] of Object.entries(SETTING_TOGGLES)) {
  $(id).addEventListener("change", async () => {
    state.settings[key] = $(id).checked;
    await saveSettings(state.settings);
    flash("Setting saved");
  });
}

function renderSettings() {
  for (const [id, key] of Object.entries(SETTING_TOGGLES)) $(id).checked = state.settings[key] !== false;

  const list = $("disabled-sites-list");
  const sites = state.settings.disabledSites || [];
  if (!sites.length) {
    list.innerHTML = emptyState("globe", "No sites switched off",
      "Use the switch in the toolbar popup to silence Apply karo on a site you never apply through.");
  } else {
    list.innerHTML = sites.map((s) => `
      <div class="custom-field-row">
        <span class="grow mono text-sm">${esc(s)}</span>
        <button class="btn btn-sm" data-enable-site="${esc(s)}">Switch back on</button>
      </div>`).join("");
    list.querySelectorAll("[data-enable-site]").forEach((b) =>
      b.addEventListener("click", async () => {
        setSiteDisabled(state.settings, b.dataset.enableSite, false);
        await saveSettings(state.settings);
        renderSettings();
        toast(`${b.dataset.enableSite} switched back on.`);
      }));
  }

  storageUsage().then((bytes) => {
    const kb = bytes / 1024;
    $("storage-line").textContent =
      `Using ${kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`} of local storage · ` +
      `${history.length} applications, ${Object.keys(state.learned).length} learned answers, ` +
      `${letters.length} saved letters${state.resumeMeta.fileName ? `, resume ${state.resumeMeta.fileSize}` : ""}.`;
  });
}

$("add-site-btn").addEventListener("click", async () => {
  const raw = await promptDialog({
    title: "Switch Apply karo off on a site",
    body: "Subdomains are covered too, so \"example.com\" also silences \"jobs.example.com\".",
    label: "Hostname", placeholder: "example.com", confirmText: "Add"
  });
  const host = normalizeHost(raw || "");
  if (!host) return;
  setSiteDisabled(state.settings, host, true);
  await saveSettings(state.settings);
  renderSettings();
  toast(`${host} switched off.`);
});

// ─── Backup ──────────────────────────────────────────────────────────────────
async function doExport(includeKeys) {
  const data = await exportAll({ includeKeys });
  downloadBlob(
    `applykaro-backup-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(data, null, 2)
  );
  toast(includeKeys ? "Backup saved — it contains your API keys, so keep it private." : "Backup saved.");
}

$("export-btn").addEventListener("click", () => doExport(false).catch(toastError));
$("export-keys-btn").addEventListener("click", async () => {
  if (!await confirmDialog({
    title: "Include your API keys?",
    body: "The file will contain your provider keys in plain text. Anyone who opens it can use them.",
    confirmText: "Export with keys", danger: true
  })) return;
  doExport(true).catch(toastError);
});

$("import-btn").addEventListener("click", async () => {
  const file = await pickFile("application/json");
  if (!file) return;
  try {
    const parsed = JSON.parse(file.text);
    const keys = await importAll(parsed);
    state = await loadContext();
    history = await loadHistory();
    letters = await loadLetters();
    resumeBase64 = await loadResumeFile();
    applyTheme(state.settings.theme);
    paintThemeSwitch();
    renderAll();
    toast(`Imported ${keys.length} sections from ${file.name}.`);
  } catch (err) {
    toastError(err);
  }
});

$("reset-btn").addEventListener("click", async () => {
  const r = await dialog({
    title: "Erase everything?",
    body: "Your profile, resume, learned answers, application log and API keys are deleted from this browser. There is no undo. Type ERASE to confirm.",
    fields: [{ key: "confirm", label: "Type ERASE", placeholder: "ERASE" }],
    confirmText: "Erase everything", danger: true
  });
  if (r?.confirm !== "ERASE") {
    if (r) toast("Not erased — the confirmation did not match.", "warning");
    return;
  }
  await resetAll();
  toast("Everything erased. Reloading…");
  setTimeout(() => location.reload(), 900);
});

// ─── Feedback ────────────────────────────────────────────────────────────────
//
// Real mailto anchors rather than click handlers: middle-click, "copy link" and
// right-click → open all behave the way the browser already taught people.

$("contact-address").textContent = CONTACT_EMAIL;
$("report-bug-btn").href = feedbackMailto("bug");
$("report-bug-btn").target = "_blank";
$("suggest-btn").href = feedbackMailto("idea");
$("suggest-btn").target = "_blank";
$("sidebar-feedback").href = feedbackMailto("bug");
$("sidebar-feedback").target = "_blank";

$("copy-email-btn").addEventListener("click", () => copyText(CONTACT_EMAIL, "Email address copied"));

// ─── Go ──────────────────────────────────────────────────────────────────────
renderAll();
