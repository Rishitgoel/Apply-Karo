// Apply karo — on-page panel.
//
// Imported only in the top frame, only on pages that passed detection. Rendered
// into a shadow root with `all: initial` so the host page's CSS cannot reach in
// and nothing here leaks out.
//
// Visual intent: read as part of the browser, not as an ad. Neutral surface,
// one accent, hairline borders, system type, real icons. It sits on top of
// someone's job application, so it should be quiet — collapsed to a small pill
// until you ask it for something, and draggable out of the way when a site puts
// its own controls in the same corner.

import { ICONS } from "../shared/icons.js";
import { resolveTheme } from "../shared/theme.js";
import { feedbackMailto } from "../shared/contact.js";

const HOST_ID = "applykaro-root";

/* The bundled typeface, matched to the popup and the dashboard.
 *
 * Chrome ignores @font-face rules declared inside a shadow root, so the face has
 * to be registered on the host document instead. The family name is namespaced
 * so it can never collide with — or be picked up by — the page's own styles;
 * only the markup below asks for it. If anything here fails the stack falls back
 * to system type, which is what the panel used before. */
const FONT_FAMILY = "Apply karo Inter";

function ensureFont() {
  try {
    if (!self.FontFace || !document.fonts) return;
    for (const f of document.fonts) if (f.family === FONT_FAMILY) return;
    const url = chrome.runtime.getURL("fonts/InterVariable.woff2");
    const face = new FontFace(FONT_FAMILY, `url("${url}")`, { weight: "100 900", display: "swap" });
    face.load().then((loaded) => document.fonts.add(loaded)).catch(() => {});
  } catch { /* system stack it is */ }
}

const CSS = `
:host{all:initial}
*{box-sizing:border-box;
  font-family:"${FONT_FAMILY}",InterVariable,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-optical-sizing:auto;font-feature-settings:"liga" 1,"calt" 1,"cv05" 1}

.wrap{position:fixed;z-index:2147483646;
  display:flex;flex-direction:column;align-items:flex-end;gap:9px}

/* Launcher */
.fab{position:relative;display:flex;align-items:center;gap:7px;
  height:36px;padding:0 12px 0 10px;border-radius:10px;cursor:pointer;
  background:var(--surface);color:var(--text);
  border:1px solid var(--border);
  box-shadow:0 1px 2px rgba(16,20,30,.08),0 6px 18px rgba(16,20,30,.12);
  font-size:12.5px;font-weight:550;letter-spacing:-.01em;
  transition:transform .16s cubic-bezier(.2,.7,.3,1),box-shadow .16s,background .13s,border-color .13s}
.fab:hover{background:var(--bg-inset);border-color:var(--border-strong);transform:translateY(-1px);
  box-shadow:0 2px 4px rgba(16,20,30,.09),0 10px 24px rgba(16,20,30,.16)}
.fab:active{transform:translateY(0)}
.fab .badge{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;
  background:var(--logo-bg);box-shadow:inset 0 0 0 1px var(--logo-ring);color:#fff;flex:none}
.fab .badge svg{width:13px;height:13px}
.count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;
  background:var(--ok-soft);color:var(--ok);
  font-size:10.5px;font-weight:650;line-height:18px;text-align:center;display:none}
.count.on{display:block}
.grip{width:9px;height:16px;margin-left:1px;cursor:grab;flex:none;
  background-image:radial-gradient(circle,var(--faint) 1px,transparent 1px);
  background-size:4px 4px;opacity:.55}
.grip:active{cursor:grabbing}
.fab:hover .grip{opacity:.9}

/* Card */
.card{width:290px;border-radius:14px;overflow:hidden;display:none;
  background:var(--surface);border:1px solid var(--border);
  box-shadow:0 1px 3px rgba(16,20,30,.08),0 18px 44px rgba(16,20,30,.20);
  transform-origin:bottom right}
.card.open{display:block;animation:pop .18s cubic-bezier(.2,.8,.3,1)}
@keyframes pop{from{opacity:0;transform:translateY(8px) scale(.97)}}

.head{display:flex;align-items:center;gap:8px;padding:11px 12px 10px}
.head .badge{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;
  background:var(--logo-bg);box-shadow:inset 0 0 0 1px var(--logo-ring);color:#fff;flex:none}
.head .badge svg{width:14px;height:14px}
.name{font-size:12.5px;font-weight:650;letter-spacing:-.02em;color:var(--text);flex:1;line-height:1.2}
.host{font-size:10px;color:var(--faint);font-weight:400;display:block;margin-top:1px}
.x{width:22px;height:22px;border:none;background:none;cursor:pointer;
  color:var(--muted);border-radius:5px;display:grid;place-items:center;padding:0}
.x svg{width:14px;height:14px}
.x:hover{background:var(--bg-inset);color:var(--text)}

.body{padding:0 12px 12px}

.status{display:flex;align-items:flex-start;gap:7px;
  font-size:11px;color:var(--muted);line-height:1.45;
  margin:0 0 10px;padding:8px 9px;border-radius:8px;
  background:var(--bg-inset)}
.status svg{width:13px;height:13px;flex:none;margin-top:.5px;color:var(--muted)}
.status.good{background:var(--ok-soft);color:var(--ok)}
.status.good svg{color:var(--ok)}
.status.warn{background:var(--warn-soft);color:var(--warn)}
.status.warn svg{color:var(--warn)}
.status.bad{background:var(--bad-soft);color:var(--bad)}
.status.bad svg{color:var(--bad)}
.spin{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;
  border-radius:50%;animation:sp .65s linear infinite;flex:none;margin-top:.5px}
@keyframes sp{to{transform:rotate(360deg)}}

button.act{display:flex;align-items:center;gap:8px;width:100%;
  padding:8px 10px;margin-bottom:4px;border-radius:8px;cursor:pointer;
  font-size:12px;font-weight:550;text-align:left;letter-spacing:-.01em;
  border:1px solid var(--border);background:var(--surface);color:var(--text);
  transition:background .12s,border-color .12s,transform .1s}
button.act:hover:not(:disabled){background:var(--bg-inset);border-color:var(--border-strong)}
button.act:active:not(:disabled){transform:translateY(1px)}
button.act:disabled{opacity:.45;cursor:default}
button.act svg{width:14px;height:14px;flex:none;color:var(--muted)}
button.act .kb{margin-left:auto;font-size:9.5px;padding:1px 4px;border-radius:4px;
  border:1px solid var(--border);color:var(--faint);font-family:ui-monospace,Menlo,Consolas,monospace}
button.act.primary{background:var(--brand);border-color:transparent;color:#fff;
  box-shadow:0 1px 3px rgba(79,70,229,.35)}
button.act.primary:hover:not(:disabled){filter:brightness(1.08);border-color:transparent}
button.act.primary svg{color:#fff}
button.act.primary .kb{border-color:rgba(255,255,255,.35);color:rgba(255,255,255,.85)}

.split{display:flex;gap:4px;margin-bottom:4px}
.split button.act{margin-bottom:0}

.more{max-height:0;overflow:hidden;transition:max-height .22s cubic-bezier(.2,.7,.3,1)}
.more.open{max-height:180px}

.trail{font:10.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  white-space:pre-wrap;margin:8px 0 0;padding:8px 9px;border-radius:8px;
  background:var(--bg-inset);color:var(--muted);max-height:120px;overflow:auto}

/* You have applied to this employer before. */
.dupe{margin-top:8px;padding:7px 9px;border-radius:8px;font-size:10.5px;
  line-height:1.5;background:var(--warn-soft);color:var(--warn)}

/* Match result. The score is a headline, the two lists are the substance. */
.match{margin-top:8px;padding:9px;border-radius:8px;
  background:var(--bg-inset);max-height:230px;overflow:auto}
.match .top{display:flex;align-items:center;gap:9px;margin-bottom:7px}
.match .score{font-size:19px;font-weight:650;letter-spacing:-.02em;line-height:1}
.match .score.strong{color:var(--ok)}
.match .score.fair{color:var(--warn)}
.match .score.weak{color:var(--danger,#c0392b)}
.match .sum{flex:1;font-size:10.5px;line-height:1.5;color:var(--muted)}
.match h4{margin:8px 0 3px;font-size:9.5px;font-weight:650;letter-spacing:.05em;
  text-transform:uppercase;color:var(--faint)}
.match ul{margin:0;padding:0;list-style:none}
.match li{font-size:10.5px;line-height:1.5;color:var(--text);
  padding-left:13px;position:relative;margin-bottom:2px}
.match li::before{position:absolute;left:0;top:0}
.match li.yes::before{content:"✓";color:var(--ok)}
.match li.no::before{content:"•";color:var(--warn)}
.match li.blocking::before{content:"!";color:var(--danger,#c0392b);font-weight:700}
.match li em{font-style:normal;color:var(--faint)}

.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;
  margin-top:9px;padding-top:9px;border-top:1px solid var(--border);
  font-size:10px;color:var(--faint)}
.linkbtn{border:none;background:none;padding:0;cursor:pointer;
  font:inherit;font-size:10px;color:var(--faint);text-decoration:underline;
  text-underline-offset:2px}
.linkbtn:hover{color:var(--muted)}
.by{margin-top:6px;text-align:center;font-size:9.5px;color:var(--faint)}
.by strong{font-weight:600;color:var(--muted)}
.by .dot{opacity:.5;margin:0 4px}
.by a{color:var(--faint);text-decoration:underline;text-underline-offset:2px;
  text-decoration-color:var(--border-strong)}
.by a:hover{color:var(--muted);text-decoration-color:currentColor}
kbd{font:inherit;font-size:9.5px;padding:1px 5px;border-radius:4px;
  border:1px solid var(--border);background:var(--bg-inset);color:var(--muted);
  font-family:ui-monospace,Menlo,Consolas,monospace}

/* Tokens, light and dark.
   --brand has white text on it; --accent-ish roles are drawn on the surface.
   One token cannot satisfy both in dark mode without failing contrast. */
:host,:host([data-theme="light"]){
  --surface:#fff;--bg-inset:#f1f3f7;--border:#e2e5ec;--border-strong:#cbd0da;
  --text:#12151b;--muted:#586070;--faint:#838b99;
  --brand:linear-gradient(135deg,#6366f1,#7c3aed);
  --logo-bg:#000;--logo-ring:transparent;
  --ok:#0f7b46;--ok-soft:#e6f5ed;
  --warn:#92650a;--warn-soft:#fcf3e2;
  --bad:#c0273a;--bad-soft:#fdecef}
:host([data-theme="dark"]){
  --surface:#16191f;--bg-inset:#232833;--border:#2c323c;--border-strong:#3f4653;
  --text:#e8ebf0;--muted:#99a1b0;--faint:#7c8492;
  --brand:linear-gradient(135deg,#4f46e5,#7c3aed);
  --logo-bg:#000;--logo-ring:rgba(255,255,255,.16);
  --ok:#48d488;--ok-soft:#10251a;
  --warn:#e0a63f;--warn-soft:#2a2213;
  --bad:#f8737f;--bad-soft:#2c171b}
:host([data-theme="dark"]) .fab{box-shadow:0 1px 2px rgba(0,0,0,.45),0 6px 18px rgba(0,0,0,.4)}
:host([data-theme="dark"]) .fab:hover{box-shadow:0 2px 4px rgba(0,0,0,.5),0 10px 24px rgba(0,0,0,.5)}
:host([data-theme="dark"]) .card{box-shadow:0 1px 3px rgba(0,0,0,.5),0 18px 44px rgba(0,0,0,.6)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

const DEFAULT_POS = { right: 16, bottom: 16 };

export function mount({
  onFill, onFillSteps, onUndo, onHighlight, onCoverLetter, onMatch,
  onPriorApplications, onDisableSite, onMove, canUndo, getContext, reload
}) {
  if (document.getElementById(HOST_ID)) return null;

  ensureFont();

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = CSS;

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML = `
    <div class="card" role="dialog" aria-label="Apply karo">
      <div class="head">
        <span class="badge">${ICONS.brand}</span>
        <span class="name">Apply karo<span class="host" data-host></span></span>
        <button class="x" data-close aria-label="Close">${ICONS.x}</button>
      </div>
      <div class="body">
        <p class="status" data-status>${ICONS.info}<span data-status-text>Ready</span></p>

        <button class="act primary" data-fill>${ICONS.bolt}Fill this page<span class="kb">⌥⇧F</span></button>
        <div class="split">
          <button class="act" data-steps title="Fill each step and click Next. Never submits.">
            ${ICONS.steps}Steps</button>
          <button class="act" data-undo title="Put every field this filled back the way it was">
            ${ICONS.undo}Undo</button>
        </div>
        <button class="act" data-review>${ICONS.search}Highlight what's still empty</button>
        <button class="act" data-match>${ICONS.target}Match me against this job</button>
        <button class="act" data-letter>${ICONS.sparkle}Draft a cover letter</button>

        <div class="dupe" data-dupe hidden></div>
        <div class="match" data-match-out hidden></div>

        <div class="more" data-more>
          <button class="act" data-options>${ICONS.user}Edit profile</button>
          <button class="act" data-off>${ICONS.power}Turn off on this site</button>
        </div>

        <pre class="trail" data-trail hidden></pre>

        <div class="foot">
          <span>Never submits for you</span>
          <button class="linkbtn" data-toggle-more>More</button>
        </div>
        <div class="by">Made by <strong>Rishit Goel</strong><span class="dot">·</span><a
          data-feedback href="#" target="_blank" rel="noopener noreferrer" title="Email me a bug, an error or an idea">Report a bug</a></div>
      </div>
    </div>
    <button class="fab" data-toggle aria-label="Apply karo">
      <span class="badge">${ICONS.brand}</span><span>Fill</span>
      <span class="count" data-count></span>
      <span class="grip" data-grip title="Drag to move"></span>
    </button>
  `;

  shadow.append(style, wrap);
  (document.body || document.documentElement).appendChild(host);

  const $ = (sel) => shadow.querySelector(sel);
  const card = $(".card");
  const count = $("[data-count]");
  const statusBox = $("[data-status]");
  const statusText = $("[data-status-text]");
  const fillBtn = $("[data-fill]");
  const stepsBtn = $("[data-steps]");
  const undoBtn = $("[data-undo]");
  const letterBtn = $("[data-letter]");
  const matchBtn = $("[data-match]");
  const matchOut = $("[data-match-out]");
  const dupe = $("[data-dupe]");
  const trail = $("[data-trail]");
  const more = $("[data-more]");

  $("[data-host]").textContent = location.hostname.replace(/^www\./, "");

  /* A bug report from here is worth far more with the page it happened on
     attached — that is the whole reason the link lives in the panel and not
     only in the dashboard. */
  const fbLink = $("[data-feedback]");
  fbLink.href = feedbackMailto("bug", { Site: location.host });
  fbLink.target = "_blank";
  fbLink.rel = "noopener noreferrer";

  // ── Theme ────────────────────────────────────────────────────────────────
  const paint = () => {
    host.setAttribute("data-theme", resolveTheme(getContext()?.settings?.theme));
  };
  paint();
  matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", paint);

  // ── Position ─────────────────────────────────────────────────────────────
  const place = (pos) => {
    const p = pos || DEFAULT_POS;
    wrap.style.right = `${p.right}px`;
    wrap.style.bottom = `${p.bottom}px`;
  };
  place(getContext()?.settings?.panelPos);

  // Some sites pin their own chat bubble bottom-right. Dragging the grip moves
  // ours instead of making the user choose between the two.
  (function draggable() {
    const grip = $("[data-grip]");
    let start = null;

    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = wrap.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, right: innerWidth - r.right, bottom: innerHeight - r.bottom };
      grip.setPointerCapture(e.pointerId);
    });

    grip.addEventListener("pointermove", (e) => {
      if (!start) return;
      const right = Math.max(4, Math.min(innerWidth - 80, start.right - (e.clientX - start.x)));
      const bottom = Math.max(4, Math.min(innerHeight - 60, start.bottom - (e.clientY - start.y)));
      place({ right: Math.round(right), bottom: Math.round(bottom) });
    });

    const end = () => {
      if (!start) return;
      start = null;
      onMove?.({
        right: parseInt(wrap.style.right, 10) || DEFAULT_POS.right,
        bottom: parseInt(wrap.style.bottom, 10) || DEFAULT_POS.bottom
      });
    };
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    // A drag that ends on the grip must not also read as a click on the pill.
    grip.addEventListener("click", (e) => e.stopPropagation());
  })();

  // ── Status line ──────────────────────────────────────────────────────────
  function setStatus(text, tone = "", busy = false) {
    statusBox.className = `status ${tone}`;
    statusBox.firstChild.replaceWith(
      busy ? spinNode() : iconNode(tone === "bad" ? "alert" : tone === "warn" ? "alert" : tone === "good" ? "check" : "info")
    );
    statusText.textContent = text;
  }

  function iconNode(name) {
    const t = document.createElement("template");
    t.innerHTML = ICONS[name];
    return t.content.firstElementChild;
  }
  function spinNode() {
    const s = document.createElement("span");
    s.className = "spin";
    return s;
  }

  const setOpen = (open) => {
    card.classList.toggle("open", open);
    if (open) { refreshStatus(); checkPrior(); }
  };

  $("[data-toggle]").addEventListener("click", () => setOpen(!card.classList.contains("open")));
  $("[data-close]").addEventListener("click", () => setOpen(false));
  shadow.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });

  $("[data-toggle-more]").addEventListener("click", (e) => {
    const open = more.classList.toggle("open");
    e.target.textContent = open ? "Less" : "More";
  });

  const busyButtons = [fillBtn, stepsBtn, letterBtn, matchBtn, undoBtn];
  const lock = (on) => busyButtons.forEach((b) => { b.disabled = on; });

  // ── Actions ──────────────────────────────────────────────────────────────
  fillBtn.addEventListener("click", async () => {
    lock(true);
    setStatus("Filling…", "", true);
    try {
      const r = await onFill((msg) => setStatus(msg, "", true));
      setCount(r.filled);
      if (r.filled) {
        setStatus(`Filled ${r.filled} of ${r.total} fields. Amber outlines are guesses worth checking.`, "good");
      } else {
        setStatus(r.total ? "Nothing left to fill here." : "No form fields found on this page.", "warn");
      }
    } catch (err) {
      setStatus(`Couldn't fill: ${err.message}`, "bad");
    } finally {
      lock(false);
      syncUndo();
    }
  });

  stepsBtn.addEventListener("click", async () => {
    lock(true);
    setStatus("Working through the steps…", "", true);
    trail.hidden = false;
    trail.textContent = "";
    try {
      const r = await onFillSteps();
      setCount(r.filled);
      // Every click it made is listed. This mode navigates on your behalf, so
      // what it did should never need guessing.
      trail.textContent = r.trail.join("\n");
      setStatus(`Filled ${r.filled} across ${r.steps + 1} step(s). Review, then submit yourself.`, "good");
    } catch (err) {
      setStatus(`Stopped: ${err.message}`, "bad");
      trail.textContent = "";
      trail.hidden = true;
    } finally {
      lock(false);
      syncUndo();
    }
  });

  // Both of these now cover every frame of the tab, so both are asynchronous —
  // the frames holding the form answer through the service worker.
  undoBtn.addEventListener("click", async () => {
    const n = await onUndo();
    setCount(0);
    setStatus(n ? `Put ${n} field(s) back the way they were.` : "Nothing to undo.", n ? "good" : "warn");
    syncUndo();
  });

  $("[data-review]").addEventListener("click", async () => {
    const { count, required } = await onHighlight();
    // The required count is the one that decides whether the form will submit,
    // so it leads when there is one.
    const detail = required ? `${count} still empty, ${required} of them required` : `${count} field(s) still empty`;
    setStatus(count ? `${detail}, outlined in red.` : "Every visible field has a value.",
              required ? "bad" : count ? "warn" : "good");
  });

  letterBtn.addEventListener("click", async () => {
    lock(true);
    setStatus("Drafting a cover letter…", "", true);
    try {
      const { text, placed } = await onCoverLetter((m) => setStatus(m, "", true));
      if (placed) {
        setStatus("Cover letter drafted into the form. Read it before you send it.", "good");
      } else {
        await navigator.clipboard.writeText(text).catch(() => {});
        setStatus("No cover-letter box here, so the draft is on your clipboard.", "good");
      }
    } catch (err) {
      setStatus(err.message, "bad");
    } finally {
      lock(false);
      syncUndo();
    }
  });

  // ── Job match ────────────────────────────────────────────────────────────

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /**
   * Render a match. The score leads because it is what you look at first, but
   * the gaps are the reason this exists — they are what tells you whether to
   * apply and what to write about, so they are never collapsed away.
   */
  function renderMatch(m) {
    const gaps = [...m.gaps].sort((a, b) => {
      const rank = { blocking: 0, important: 1, minor: 2 };
      return rank[a.severity] - rank[b.severity];
    });

    matchOut.innerHTML = `
      <div class="top">
        <div class="score ${esc(m.verdict)}">${m.score}%</div>
        <div class="sum">${esc(m.summary)}</div>
      </div>
      ${m.meets.length ? `<h4>You meet (${m.meets.length})</h4><ul>${
        m.meets.slice(0, 6).map((x) =>
          `<li class="yes">${esc(x.requirement)}${x.evidence ? ` <em>— ${esc(x.evidence)}</em>` : ""}</li>`
        ).join("")}</ul>` : ""}
      ${gaps.length ? `<h4>Gaps (${gaps.length})</h4><ul>${
        gaps.slice(0, 6).map((x) =>
          `<li class="${x.severity === "blocking" ? "blocking" : "no"}">${esc(x.requirement)}${
            x.closeable ? ` <em>— ${esc(x.closeable)}</em>` : ""}</li>`
        ).join("")}</ul>` : ""}
      ${m.leadWith.length ? `<h4>Lead with</h4><ul>${
        m.leadWith.slice(0, 4).map((x) => `<li class="yes">${esc(x)}</li>`).join("")}</ul>` : ""}
      ${m.keywords.length ? `<h4>Their words, missing from your resume</h4><ul>${
        m.keywords.slice(0, 8).map((x) => `<li class="no">${esc(x)}</li>`).join("")}</ul>` : ""}
    `;
    matchOut.hidden = false;
  }

  matchBtn.addEventListener("click", async () => {
    lock(true);
    setStatus("Comparing you against this posting…", "", true);
    try {
      const m = await onMatch((msg) => setStatus(msg, "", true));
      renderMatch(m);
      const tone = m.verdict === "strong" ? "good" : m.verdict === "weak" ? "bad" : "warn";
      setStatus(`${m.score}% match — ${m.meets.length} met, ${m.gaps.length} missing.`, tone);
    } catch (err) {
      setStatus(err.message, "bad");
    } finally {
      lock(false);
    }
  });

  /**
   * Warn if this employer is already in the tracker. Two different roles at one
   * company is normal, so this states what it found and lets you judge rather
   * than calling it a mistake.
   */
  async function checkPrior() {
    if (!onPriorApplications) return;
    const prior = await onPriorApplications().catch(() => null);
    if (!prior) { dupe.hidden = true; return; }

    const n = prior.rows.length;
    const last = prior.rows[0];
    const when = last?.ts ? Math.floor((Date.now() - last.ts) / 86400000) : null;
    dupe.innerHTML = `You have applied to <strong>${esc(prior.company)}</strong> ${
      n === 1 ? "once" : `${n} times`} before${
      when === null ? "" : when === 0 ? ", today" : `, most recently ${when} day${when === 1 ? "" : "s"} ago`}${
      last?.role ? ` (${esc(last.role)})` : ""}.`;
    dupe.hidden = false;
  }

  $("[data-options]").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "open_options" });
  });

  $("[data-off]").addEventListener("click", async () => {
    await onDisableSite();
  });

  // ── State ────────────────────────────────────────────────────────────────
  function syncUndo() {
    undoBtn.disabled = !canUndo?.();
  }

  async function refreshStatus() {
    paint();
    await reload();
    const ctx = getContext();
    const missing = [];
    if (!ctx.profile.personal.email) missing.push("no profile yet");
    if (!ctx.resumeMeta.fileName) missing.push("no resume uploaded");

    if (missing.length) setStatus(`Set-up needed: ${missing.join(", ")}.`, "warn");
    else if (!ctx.settings.aiAutofillEnabled) setStatus("Ready. AI answers are off for unknown fields.", "");
    else setStatus("Ready. AI will answer anything the rules can't.", "good");

    // Both of these spend a model call, so both need a key. The letter also
    // runs when AI autofill is off — having a key is the real precondition.
    const hasKey = !!(ctx.settings.provider === "groq"
      ? ctx.settings.groqApiKey : ctx.settings.geminiApiKey);

    letterBtn.disabled = !hasKey && !ctx.settings.aiAutofillEnabled;
    letterBtn.title = letterBtn.disabled
      ? "Add an API key in the dashboard to draft cover letters"
      : "Read the posting on this page and write a letter for it";

    matchBtn.disabled = !hasKey;
    matchBtn.title = !hasKey
      ? "Add an API key in the dashboard to compare yourself against a posting"
      : !ctx.resumeMeta.fileName && !ctx.resumeMeta.text
        ? "Works better once your resume is uploaded — it compares against your profile alone until then"
        : "Read this posting and show what you meet and what you're missing";
    syncUndo();
  }

  function setCount(n) {
    if (n > 0) { count.textContent = String(n); count.classList.add("on"); }
    else count.classList.remove("on");
  }

  syncUndo();

  return {
    setCount,
    host,
    destroy() { host.remove(); }
  };
}
