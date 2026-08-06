// Apply karo — toasts and dialogs for the extension's own pages.
//
// Replaces window.alert / confirm / prompt. Those block the whole renderer, are
// unstyleable, and in a 344px popup the native prompt is wider than the window
// it belongs to. Everything here is themed, focus-trapped and dismissible.

import { ICONS } from "./icons.js";

// ─────────────────────────────────────────────────────────────────────────────
// Toasts
// ─────────────────────────────────────────────────────────────────────────────

let toastHost = null;

function host() {
  if (toastHost?.isConnected) return toastHost;
  toastHost = document.createElement("div");
  toastHost.className = "toast-host";
  document.body.appendChild(toastHost);
  return toastHost;
}

const TOAST_ICON = {
  success: ICONS.check,
  error: ICONS.alert,
  warning: ICONS.alert,
  info: ICONS.info
};

/**
 * @param {string} message
 * @param {"success"|"error"|"warning"|"info"} [type]
 * @param {number} [duration] ms; errors linger because they usually need reading.
 */
export function toast(message, type = "success", duration) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `${TOAST_ICON[type] || TOAST_ICON.info}<span></span>`;
  el.querySelector("span").textContent = message;
  host().appendChild(el);

  const ms = duration ?? (type === "error" ? 6500 : 2800);
  const close = () => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 200);
  };
  const timer = setTimeout(close, ms);
  el.addEventListener("click", () => { clearTimeout(timer); close(); });
  return close;
}

export const toastError = (err) =>
  toast(typeof err === "string" ? err : (err?.message || String(err)), "error");

// ─────────────────────────────────────────────────────────────────────────────
// Dialogs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A modal with an arbitrary set of text fields.
 *
 * @param {object} opts
 *   title, body      — heading and optional descriptive paragraph
 *   fields           — [{ key, label, value, placeholder, type, hint }]
 *   confirmText      — label for the primary button
 *   danger           — style the primary button as destructive
 * @returns {Promise<object|null>} the field values, or null if dismissed.
 */
export function dialog({ title, body = "", fields = [], confirmText = "Confirm", cancelText = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-host";

    const fieldHtml = fields.map((f, i) => `
      <div class="form-group">
        <label class="form-label" for="rf-dlg-${i}">${esc(f.label || f.key)}</label>
        ${f.type === "textarea"
          ? `<textarea id="rf-dlg-${i}" class="form-control" rows="4" placeholder="${esc(f.placeholder || "")}"></textarea>`
          : `<input id="rf-dlg-${i}" class="form-control" type="${esc(f.type || "text")}" placeholder="${esc(f.placeholder || "")}">`}
        ${f.hint ? `<div class="form-hint">${esc(f.hint)}</div>` : ""}
      </div>`).join("");

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><div class="modal-title">${esc(title)}</div></div>
        <div class="modal-body">${body ? `<p>${esc(body)}</p>` : ""}${fieldHtml}</div>
        <div class="modal-foot">
          <button class="btn" data-cancel>${esc(cancelText)}</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirmText)}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const inputs = [...overlay.querySelectorAll(".modal-body .form-control")];
    inputs.forEach((el, i) => { el.value = fields[i].value ?? ""; });

    const done = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const accept = () => {
      const out = {};
      fields.forEach((f, i) => { out[f.key] = inputs[i].value.trim(); });
      done(fields.length ? out : {});
    };

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); done(null); }
      // Enter commits from a single-line field; a textarea keeps its newlines.
      else if (e.key === "Enter" && e.target?.tagName !== "TEXTAREA") { e.preventDefault(); accept(); }
    }

    overlay.querySelector("[data-ok]").addEventListener("click", accept);
    overlay.querySelector("[data-cancel]").addEventListener("click", () => done(null));
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(null); });
    document.addEventListener("keydown", onKey, true);

    (inputs[0] || overlay.querySelector("[data-ok]")).focus();
  });
}

/** Yes/no. Resolves true only on the primary button. */
export async function confirmDialog(opts) {
  const r = await dialog({ confirmText: "Confirm", ...opts, fields: [] });
  return r !== null;
}

/** One text field. Resolves the string, or null if dismissed. */
export async function promptDialog({ label, value = "", placeholder = "", ...rest } = {}) {
  const r = await dialog({ ...rest, fields: [{ key: "value", label, value, placeholder }] });
  return r === null ? null : r.value;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────────────────────

export async function copyText(text, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} to the clipboard.`);
    return true;
  } catch {
    toast("Couldn't reach the clipboard.", "error");
    return false;
  }
}

export function downloadBlob(filename, text, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a file the user picked, as text. */
export function pickFile(accept = "application/json") {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
    input.click();
  });
}

/** "3 minutes ago" / "yesterday" / "12 Mar". */
export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
