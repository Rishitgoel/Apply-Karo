// Apply karo Content Script
// Handles scanning form fields, auto-filling details, auto-uploading resumes,
// tracking manual adjustments (learning loop), and rendering the interactive floating widget.

(function() {
  let state = null;
  let activeWidget = null;
  let capturedEdits = {}; // Track user edits on the page
  let formsScannedCount = 0;

  const IS_TOP_FRAME = (window === window.top);
  const REVIEW_THRESHOLD = 0.7;        // AI confidence below this → flag the field for review
  let autofilledOnLoadDone = false;
  let dynamicRescanTimer = null;

  // Deep query that also descends into open shadow roots (modern ATS web components).
  function deepQueryAll(selector) {
    const out = [];
    const walk = (root) => {
      let matches;
      try { matches = root.querySelectorAll(selector); } catch (_) { return; }
      for (const el of matches) out.push(el);
      let hosts;
      try { hosts = root.querySelectorAll("*"); } catch (_) { return; }
      for (const el of hosts) { if (el.shadowRoot) walk(el.shadowRoot); }
    };
    walk(document);
    return out;
  }

  // Cheap light-DOM presence check used to gate widget/autofill on form pages only.
  function hasFillableFields() {
    const els = document.querySelectorAll("input, textarea, select");
    for (const el of els) {
      if (el.closest && el.closest("#apply-karo-widget-root")) continue;
      if (isFillableField(el)) return true;
    }
    return false;
  }

  // Visibility + honeypot filter: skip hidden / zero-size / anti-bot trap fields.
  // Filling a honeypot is a common way to get flagged as a bot.
  function isFillableField(el) {
    if (el.disabled) return false;
    const type = (el.type || "").toLowerCase();
    if (type === "hidden") return false;

    // Cheap, layout-free rejections first (honeypot name patterns, aria-hidden).
    const hay = `${el.name || ""} ${el.id || ""} ${typeof el.className === "string" ? el.className : ""}`.toLowerCase();
    if (/honeypot|honey-pot|bot-?field|leave-?blank|no-?fill|do-?not-?fill/.test(hay)) return false;
    if (el.closest && el.closest('[aria-hidden="true"]')) return false;

    let cs = null;
    try { cs = window.getComputedStyle(el); } catch (_) {}
    if (cs && cs.display === "none") return false;

    // ATS platforms (Greenhouse, Workday, Lever, Ashby) render the NATIVE
    // radio/checkbox visually hidden (opacity:0 / 1px / sr-only clip) behind a
    // styled proxy — those inputs are still the real fill target, so do NOT apply
    // the opacity/zero-size honeypot filter to them. Only text-like fields get it.
    if (type !== "radio" && type !== "checkbox") {
      if (cs && (cs.visibility === "hidden" || parseFloat(cs.opacity) === 0)) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false; // zero-size honeypot
    }
    return true;
  }

  // Amber "needs review" highlight for low-confidence / guessed fills.
  function ensureReviewStyles() {
    if (document.getElementById("rf-review-styles")) return;
    const s = document.createElement("style");
    s.id = "rf-review-styles";
    s.textContent = ".rf-review{outline:2px solid #f59e0b !important;outline-offset:1px !important;box-shadow:0 0 0 3px rgba(245,158,11,0.25) !important;}";
    (document.head || document.documentElement).appendChild(s);
  }
  function markForReview(el) {
    try { ensureReviewStyles(); el.classList.add("rf-review"); } catch (_) {}
  }

  // Normalize an AI field result to { value, confidence }. Tolerant of the older
  // bare-string shape, so a model that ignores the schema still fills (confidently).
  function normalizeAiEntry(entry) {
    if (entry === null || entry === undefined) return { value: null, confidence: 0 };
    if (typeof entry === "object") {
      const v = entry.value === undefined ? null : entry.value;
      const present = v !== null && v !== undefined && String(v).trim() !== "";
      let c = Number(entry.confidence);          // tolerate numeric strings like "0.3"
      if (!Number.isFinite(c)) c = present ? 1 : 0; // default by presence, not truthiness (value 0/false is valid)
      if (c > 1) c = c / 100;                     // tolerate a 0-100 scale
      return { value: v, confidence: Math.max(0, Math.min(1, c)) };
    }
    return { value: entry, confidence: 1 };
  }

  // 1. INITIALIZE CONTENT SCRIPT
  async function init() {
    try {
      state = await window.ResumeStorage.loadAll();

      // Always listen for manual triggers from the popup. The fill runs in every
      // frame (so forms inside iframes get filled too), but only the TOP frame
      // replies — otherwise N frames race sendResponse and the popup's reported
      // count comes from an arbitrary frame.
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "manual_autofill") {
          const filling = runAutofill(true);
          if (IS_TOP_FRAME) {
            filling.then(count => {
              updateWidgetBadge(count);
              sendResponse({ success: true, count: count });
            }).catch(err => {
              // Always answer the popup, even if a fill threw, so it doesn't show
              // a misleading "could not trigger" error after partial success.
              console.warn("Apply karo: autofill error:", err && err.message);
              sendResponse({ success: false, count: 0, error: err && err.message });
            });
            return true; // keep the channel open for the top frame's response
          }
          return false; // sub-frames fill silently
        }
      });

      // Learning loop + submit capture are cheap (delegated) — always on.
      observeFormSubmissions();
      observeInputChanges();

      // Only do form work on pages that actually have fields, and re-check as the
      // DOM changes (SPAs / multi-step forms render their fields late).
      handleFormPresence();
      observeDynamicForms();
    } catch (err) {
      console.error("Apply karo Init Error:", err);
    }
  }

  // Create the widget + optionally autofill — but only when the page has fields.
  function handleFormPresence() {
    if (!hasFillableFields()) return;
    if (IS_TOP_FRAME) createFloatingWidget(0);
    if (state.settings.autofillOnLoad && !autofilledOnLoadDone) {
      autofilledOnLoadDone = true;
      setTimeout(async () => {
        // Automatic on-load: only the TOP frame runs AI Phase-2; sub-frames do
        // rule-based fills only, so a multi-iframe page can't silently fan out
        // independent Gemini calls and burn free-tier quota.
        const count = await runAutofill(false, { rulesOnly: !IS_TOP_FRAME });
        updateWidgetBadge(count);
      }, 1200);
    }
  }

  // Re-scan when fields appear later (debounced). Rule-based only — this never
  // fires AI calls automatically; the user triggers AI via the widget/popup.
  function observeDynamicForms() {
    const obs = new MutationObserver((mutations) => {
      // Cheapest hot-path check: only consider records that added nodes, and only
      // then pay for the widget-root closest() test.
      let added = false;
      for (const m of mutations) {
        if (!(m.addedNodes && m.addedNodes.length)) continue;
        if (m.target && m.target.closest && m.target.closest("#apply-karo-widget-root")) continue;
        added = true;
        break;
      }
      if (!added) return;
      clearTimeout(dynamicRescanTimer);
      dynamicRescanTimer = setTimeout(() => {
        // Create the widget once (top frame) if a form has now appeared.
        if (IS_TOP_FRAME && !activeWidget && hasFillableFields()) createFloatingWidget(0);
        // Rule-based only (single light-DOM scan) — never auto-fires AI.
        if (state.settings.autofillOnLoad) {
          runAutofill(false, { rulesOnly: true }).then(count => { if (count > 0) updateWidgetBadge(count); });
        }
      }, 700);
    });
    try {
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
  }

  // 2. DOM SCRAIPING & FIELD PARSING HEURISTICS
  function getFieldLabel(input) {
    // Resolve lookups against the element's own root (handles shadow-DOM-scoped labels).
    const root = (input.getRootNode && input.getRootNode()) || document;
    // 1. Check if input has an id and there's a label element with 'for' attribute
    if (input.id) {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(input.id) : input.id;
      const label = root.querySelector(`label[for="${esc}"]`);
      if (label && label.innerText.trim()) return label.innerText.trim();
    }

    // 2. Check if parent element is a label
    let parent = input.parentElement;
    while (parent && parent.tagName !== "BODY") {
      if (parent.tagName === "LABEL" && parent.innerText.trim()) {
        return parent.innerText.trim();
      }
      parent = parent.parentElement;
    }

    // 3. Check for ARIA label attributes
    if (input.getAttribute("aria-label")) {
      return input.getAttribute("aria-label").trim();
    }
    if (input.getAttribute("aria-labelledby")) {
      const lid = input.getAttribute("aria-labelledby");
      // Prefer the element's own (possibly shadow) scope, then fall back to the
      // outer document — aria-labelledby may reference an id outside the shadow root.
      const labelEl = (root.getElementById ? root.getElementById(lid) : null) || document.getElementById(lid);
      if (labelEl && labelEl.innerText.trim()) return labelEl.innerText.trim();
    }

    // 4. Check placeholder attribute
    if (input.getAttribute("placeholder")) {
      return input.getAttribute("placeholder").trim();
    }

    // 5. Look for preceding text nodes or headings in sibling elements
    let sibling = input.previousElementSibling;
    if (sibling && sibling.innerText && sibling.innerText.trim()) {
      return sibling.innerText.trim();
    }

    // 6. Fallback to name or id
    return input.name || input.id || "";
  }

  function getJobDescriptionText() {
    // Look for common job description containers
    const selectors = [
      ".job-description", ".description", "#job-desc", ".job-section",
      "[data-automation-id='jobPostingDescription']", ".posting-requirements",
      ".section-wrapper", "#content", "article"
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim().length > 200) {
        return el.innerText.trim().substring(0, 8000); // Limit to 8000 chars for API performance
      }
    }

    // Fallback: search paragraph text blocks with substantial content
    const paragraphs = Array.from(document.querySelectorAll("p, li"));
    let extractedText = "";
    paragraphs.forEach(p => {
      if (p.innerText.trim().split(/\s+/).length > 8) {
        extractedText += p.innerText.trim() + "\n";
      }
    });

    if (extractedText.length > 300) {
      return extractedText.substring(0, 8000);
    }

    // Ultimate fallback: return body text (stripped)
    return document.body.innerText.replace(/\s+/g, ' ').substring(0, 5000);
  }

  // 3. AUTOFILL ENGINE (Two-Phase Architecture)

  /**
   * Scan the page and build a structured descriptor for every fillable field.
   */
  function scanFormFields(opts) {
    // Light-DOM-only scan for the frequent dynamic re-scan path; full shadow-DOM
    // walk for manual / agent / on-load runs where coverage matters most.
    const inputs = (opts && opts.lightOnly)
      ? document.querySelectorAll("input, textarea, select")
      : deepQueryAll("input, textarea, select");
    const fields = [];

    for (const input of inputs) {
      // Skip our own widget elements
      if (input.closest && input.closest("#apply-karo-widget-root")) continue;
      // Skip hidden / disabled / zero-size / honeypot fields
      if (!isFillableField(input)) continue;

      const label = getFieldLabel(input);
      const fieldInfo = {
        element: input,
        label: label,
        name: input.name || "",
        id: input.id || "",
        type: input.type || "",
        tagName: input.tagName,
        placeholder: input.placeholder || ""
      };

      // Collect options for select elements
      if (input.tagName === "SELECT") {
        fieldInfo.options = Array.from(input.options)
          .map(o => o.text.trim())
          .filter(t => t !== "" && t !== "Select" && t !== "Choose" && t !== "-- Select --" && t.length > 0);
      }

      fields.push(fieldInfo);
    }

    return fields;
  }

  // Compact field descriptors sent to the AI (shared by Phase 2 and Agent mode).
  function buildFieldDescriptors(list) {
    return list.map(f => ({
      label: f.label,
      name: f.name,
      type: f.type,
      tagName: f.tagName,
      placeholder: f.placeholder,
      options: f.options || null
    }));
  }

  /**
   * Phase 1: Fast rule-based matching (instant, no API call).
   * Phase 2: AI batch analysis for unmatched fields (async, one API call).
   */
  async function runAutofill(manual = false, opts = {}) {
    if (!state) return 0;

    let filledCount = 0;
    let reviewCount = 0;
    const fields = scanFormFields({ lightOnly: !!opts.rulesOnly });
    const profile = state.profile || {};
    const learned = state.learnedMappings || {};
    const customFields = profile.customFields || {};

    // ─── PHASE 1: Rule-Based Matching ───
    const { matched, unmatched } = window.matchFieldsByRules(fields, profile, learned, customFields);

    // Fill all Phase 1 matches
    for (const [element, match] of matched) {
      const success = await fillElement(element, match.value);
      if (success) filledCount++;
    }

    // Auto-upload resume for file inputs (skip ones we've already populated, so
    // dynamic re-scans don't re-inject the file repeatedly).
    for (const fieldInfo of fields) {
      if (fieldInfo.type === "file" && state.resume && state.resume.base64 &&
          !fieldInfo.element.classList.contains("rf-filled")) {
        const cleanLabel = (fieldInfo.label || "").toLowerCase();
        const cleanName = (fieldInfo.name || "").toLowerCase();
        const cleanId = (fieldInfo.id || "").toLowerCase();
        if (cleanLabel.match(/resume|cv|c\.v\.|curriculum vitae|attachment/i) ||
            cleanName.match(/resume|cv/i) || cleanId.match(/resume|cv/i)) {
          await injectResumeFile(fieldInfo.element, state.resume.base64, state.resume.fileName);
          filledCount++;
        }
      }
    }

    // ─── PHASE 2: AI Batch Analysis for Unmatched Fields ───
    // Skipped when rulesOnly is set (e.g. dynamic re-scans) to avoid surprise API calls.
    if (!opts.rulesOnly && unmatched.length > 0 && state.settings.aiAutofillEnabled &&
        state.settings.geminiApiKey && state.settings.geminiApiKey.trim() !== "") {
      
      // Filter out file inputs and already-filled fields from AI analysis
      const aiCandidates = unmatched.filter(f => 
        f.type !== "file" && 
        f.type !== "submit" && 
        f.type !== "button" &&
        f.label && f.label.trim() !== "" &&
        (!f.element.value || f.element.value.trim() === "")
      );

      if (aiCandidates.length > 0) {
        console.log(`Apply karo: Phase 2 — Sending ${aiCandidates.length} unmatched fields to AI...`);
        
        try {
          // Serialize field descriptors for the AI prompt
          const descriptors = buildFieldDescriptors(aiCandidates);

          const aiMappings = await window.ResumeGemini.analyzeFormFields(
            state.settings.geminiApiKey,
            state.settings.geminiModel,
            descriptors,
            profile,
            state.resume?.text || "",
            customFields
          );

          // Apply AI results
          for (const [indexStr, raw] of Object.entries(aiMappings)) {
            const index = parseInt(indexStr, 10);
            if (isNaN(index) || index >= aiCandidates.length) continue;

            const { value, confidence } = normalizeAiEntry(raw);
            if (value === null || value === undefined || String(value).trim() === "") continue;

            const fieldInfo = aiCandidates[index];
            const success = await fillElement(fieldInfo.element, String(value));
            if (success) {
              filledCount++;
              if (confidence < REVIEW_THRESHOLD) { markForReview(fieldInfo.element); reviewCount++; }

              // Auto-learn: silently save this mapping for next time (Option A)
              const cleanLabel = (fieldInfo.label || "").toLowerCase().trim();
              if (cleanLabel) {
                // Save as customField if it looks like a personal fact, otherwise as learnedMapping
                const isPersonalFact = cleanLabel.match(/gender|race|ethnicity|veteran|disability|salary|start date|experience|authorized|sponsor|citizen|visa|nationality|age|dob|date of birth/i);
                if (isPersonalFact) {
                  if (!state.profile.customFields) state.profile.customFields = {};
                  state.profile.customFields[cleanLabel] = String(value);
                  await window.ResumeStorage.saveProfile(state.profile);
                } else {
                  state.learnedMappings[cleanLabel] = String(value);
                  await window.ResumeStorage.saveLearnedMappings(state.learnedMappings);
                }
              }
            }
          }

          console.log(`Apply karo: Phase 2 — AI filled additional fields.`);
        } catch (err) {
          console.warn("Apply karo: Phase 2 AI analysis failed (non-fatal):", err.message);
        }
      }
    }

    if (reviewCount > 0) {
      console.log(`Apply karo: ${reviewCount} field(s) filled with low confidence — highlighted amber for review.`);
    }
    console.log(`Apply karo: Auto-filled ${filledCount} fields total.`);
    return filledCount;
  }

  // 3b. AGENTIC AUTOFILL ENGINE (AI Agent Mode)

  function injectAgentStyles() {
    if (document.getElementById("rf-agent-global-styles")) return;
    const style = document.createElement("style");
    style.id = "rf-agent-global-styles";
    style.textContent = `
      @keyframes rfAgentTarget {
        0% {
          box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.4), 0 0 0 4px rgba(168, 85, 247, 0.2);
        }
        50% {
          box-shadow: 0 0 0 4px rgba(236, 72, 153, 0.8), 0 0 0 8px rgba(236, 72, 153, 0.3);
        }
        100% {
          box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.4), 0 0 0 4px rgba(168, 85, 247, 0.2);
        }
      }
      .rf-agent-active {
        animation: rfAgentTarget 1.2s infinite !important;
        border-color: #ec4899 !important;
        outline: none !important;
      }
      .rf-agent-tooltip {
        position: absolute;
        background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
        color: white;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        z-index: 10000000;
        box-shadow: 0 4px 12px rgba(168, 85, 247, 0.35);
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        white-space: nowrap;
        transition: opacity 0.2s, transform 0.2s;
        transform: translateY(-8px);
      }
    `;
    document.head.appendChild(style);
  }

  function showAgentTooltip(element, text) {
    const old = document.querySelector(".rf-agent-tooltip");
    if (old) old.remove();

    const rect = element.getBoundingClientRect();
    const tooltip = document.createElement("div");
    tooltip.className = "rf-agent-tooltip";
    tooltip.textContent = text;
    
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - 40}px`;
    
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function typeValueAgent(el, value) {
    return new Promise((resolve) => {
      let currentIdx = 0;
      el.focus();
      el.value = ""; // Clear existing value
      
      const interval = setInterval(() => {
        if (currentIdx < value.length) {
          el.value += value[currentIdx];
          el.dispatchEvent(new Event('input', { bubbles: true }));
          currentIdx++;
        } else {
          clearInterval(interval);
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
          resolve();
        }
      }, 30); // 30ms per character typing animation
    });
  }

  async function runAgenticAutofill(shadow) {
    if (!state) return;
    if (!state.settings.geminiApiKey || state.settings.geminiApiKey.trim() === "") {
      alert("Please configure your Gemini API Key in the settings first.");
      return;
    }

    const fields = scanFormFields();
    if (fields.length === 0) {
      alert("No fillable form fields found on this page.");
      return;
    }

    // Candidates for AI planning (no files, no buttons/submits)
    const candidates = fields.filter(f => 
      f.type !== "file" && 
      f.type !== "submit" && 
      f.type !== "button" &&
      f.label && f.label.trim() !== ""
    );

    if (candidates.length === 0) {
      alert("No suitable fields found for AI Agent filling.");
      return;
    }

    const agentBtn = shadow.getElementById("widget-agent-fill-btn");
    const originalText = agentBtn.innerHTML;
    agentBtn.disabled = true;
    agentBtn.innerHTML = "🤖 Agent planning...";

    try {
      // Call Gemini to plan *all* fields
      const descriptors = buildFieldDescriptors(candidates);

      const profile = state.profile || {};
      const customFields = profile.customFields || {};
      
      const aiMappings = await window.ResumeGemini.analyzeFormFields(
        state.settings.geminiApiKey,
        state.settings.geminiModel,
        descriptors,
        profile,
        state.resume?.text || "",
        customFields
      );

      injectAgentStyles();
      let agentFilledCount = 0;
      agentBtn.innerHTML = "🤖 Agent executing...";

      for (const [indexStr, raw] of Object.entries(aiMappings)) {
        const index = parseInt(indexStr, 10);
        if (isNaN(index) || index >= candidates.length) continue;

        const norm = normalizeAiEntry(raw);
        if (norm.value === null || norm.value === undefined || String(norm.value).trim() === "") continue;

        const field = candidates[index];
        const el = field.element;
        const cleanVal = String(norm.value);

        // Scroll field into center of viewport
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 600)); // wait for smooth scroll

        el.classList.add("rf-agent-active");

        if (el.tagName === "SELECT") {
          showAgentTooltip(el, `🤖 AI Agent: Selecting "${cleanVal}"`);
          await new Promise(r => setTimeout(r, 900));
          await fillElement(el, cleanVal);
        } else if (el.type === "radio" || el.type === "checkbox") {
          showAgentTooltip(el, `🤖 AI Agent: Checking option`);
          await new Promise(r => setTimeout(r, 900));
          await fillElement(el, cleanVal);
        } else if (isLikelyAutocomplete(el)) {
          showAgentTooltip(el, `🤖 AI Agent: Selecting autocomplete "${cleanVal}"`);
          await new Promise(r => setTimeout(r, 950));
          await fillElement(el, cleanVal);
        } else {
          showAgentTooltip(el, `🤖 AI Agent: Typing response...`);
          await new Promise(r => setTimeout(r, 200));
          await typeValueAgent(el, cleanVal);
        }

        await new Promise(r => setTimeout(r, 400));
        if (norm.confidence < REVIEW_THRESHOLD) markForReview(el);
        el.classList.remove("rf-agent-active");
        agentFilledCount++;
      }

      // Handle resume file upload
      for (const fieldInfo of fields) {
        if (fieldInfo.type === "file" && state.resume && state.resume.base64) {
          const cleanLabel = (fieldInfo.label || "").toLowerCase();
          const cleanName = (fieldInfo.name || "").toLowerCase();
          const cleanId = (fieldInfo.id || "").toLowerCase();
          if (cleanLabel.match(/resume|cv|c\.v\.|curriculum vitae|attachment/i) ||
              cleanName.match(/resume|cv/i) || cleanId.match(/resume|cv/i)) {
            fieldInfo.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await new Promise(r => setTimeout(r, 600));
            fieldInfo.element.classList.add("rf-agent-active");
            showAgentTooltip(fieldInfo.element, `🤖 AI Agent: Uploading resume "${state.resume.fileName}"`);
            await new Promise(r => setTimeout(r, 1200));
            await injectResumeFile(fieldInfo.element, state.resume.base64, state.resume.fileName);
            fieldInfo.element.classList.remove("rf-agent-active");
            agentFilledCount++;
          }
        }
      }

      // Cleanup tooltip
      const tooltip = document.querySelector(".rf-agent-tooltip");
      if (tooltip) tooltip.remove();

      agentBtn.innerHTML = "✨ Agent finished!";
      setTimeout(() => {
        agentBtn.disabled = false;
        agentBtn.innerHTML = originalText;
        updateWidgetBadge(agentFilledCount);
      }, 2000);

    } catch (err) {
      console.error("AI Agent Autofill error:", err);
      alert("AI Agent Autofill failed: " + err.message);
      agentBtn.disabled = false;
      agentBtn.innerHTML = originalText;
      const tooltip = document.querySelector(".rf-agent-tooltip");
      if (tooltip) tooltip.remove();
    }
  }

  // Helper: Levenshtein distance for fuzzy matching
  function levenshtein(a, b) {
    const al = a.length, bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;
    // Rolling two-row implementation: O(min) memory instead of a full O(al*bl) matrix.
    let prev = new Array(al + 1);
    let curr = new Array(al + 1);
    for (let j = 0; j <= al; j++) prev[j] = j;
    for (let i = 1; i <= bl; i++) {
      curr[0] = i;
      const bc = b[i - 1];
      for (let j = 1; j <= al; j++) {
        const cost = bc === a[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      const tmp = prev; prev = curr; curr = tmp;
    }
    return prev[al];
  }

  // Helper function to check if option text matches target values
  function fuzzyOptionMatch(optText, targetText) {
    const text = optText.toLowerCase().trim();
    const target = targetText.toLowerCase().trim();
    
    // Direct matches
    if (text === target) return true;
    if (text.includes(target) || target.includes(text)) return true;

    // Check initials/abbreviations (e.g. DTU for Delhi Technological University)
    const words = target.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 1) {
      const initials = words.map(w => w[0]).join("").toLowerCase();
      if (text === initials || text.includes(`(${initials})`) || text.includes(initials)) {
        return true;
      }
    }

    // Levenshtein distance — allow ~20% character error rate
    if (text.length > 3 && target.length > 3) {
      const maxDist = Math.floor(Math.max(text.length, target.length) * 0.2);
      // Edit distance is always >= the length difference, so skip the matrix
      // computation entirely when the lengths already differ by more than maxDist.
      if (Math.abs(text.length - target.length) <= maxDist && levenshtein(text, target) <= maxDist) return true;
    }

    return false;
  }

  /**
   * Set a value on an input using the native setter to ensure React/Angular/Vue
   * frameworks detect the change through their synthetic event systems.
   */
  function setNativeValue(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (el.tagName === "TEXTAREA" && nativeTextareaValueSetter) {
      nativeTextareaValueSetter.call(el, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  /**
   * Detect if an input might have an autocomplete/suggestion popup.
   * Uses ARIA roles, data attributes, and common patterns instead of hardcoded selectors.
   */
  function isLikelyAutocomplete(el) {
    const role = (el.getAttribute("role") || "").toLowerCase();
    const ariaAutocomplete = el.getAttribute("aria-autocomplete");
    const ariaExpanded = el.getAttribute("aria-expanded");
    const ariaOwns = el.getAttribute("aria-owns") || el.getAttribute("aria-controls");
    const list = el.getAttribute("list"); // HTML5 datalist

    if (role === "combobox" || role === "searchbox") return true;
    if (ariaAutocomplete) return true;
    if (ariaExpanded !== null) return true; // Has expandable state
    if (ariaOwns) return true; // Controls another element (likely a listbox)
    if (list) return true; // HTML5 datalist binding

    // Check common class/attribute patterns
    const cls = (el.className || "").toLowerCase();
    const attrs = Array.from(el.attributes).map(a => a.name.toLowerCase());
    if (cls.match(/autocomplete|typeahead|combobox|select|search|suggest/)) return true;
    if (attrs.some(a => a.match(/autocomplete|typeahead|combobox/))) return true;

    return false;
  }

  /**
   * Use MutationObserver to detect newly-appeared suggestion items after typing.
   * Returns the best matching suggestion element, or null.
   */
  function waitForSuggestions(el, value, timeoutMs = 600) {
    return new Promise((resolve) => {
      const cleanVal = value.toLowerCase().trim();
      let resolved = false;

      // Watch for DOM changes near the input or in the document body
      const observeTarget = el.parentElement?.parentElement || document.body;
      
      const observer = new MutationObserver((mutations) => {
        if (resolved) return;

        // Look for newly added nodes that could be suggestion items
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            
            // Search within the newly added subtree for clickable suggestions
            const candidates = node.querySelectorAll 
              ? [node, ...node.querySelectorAll('[role="option"], [role="menuitem"], li, div, span')]
              : [node];

            for (const candidate of candidates) {
              const text = (candidate.innerText || candidate.textContent || "").trim();
              if (text.length < 2) continue;
              if (fuzzyOptionMatch(text, value)) {
                resolved = true;
                observer.disconnect();
                resolve(candidate);
                return;
              }
            }
          }
        }
      });

      observer.observe(observeTarget, { childList: true, subtree: true });

      // Also check existing visible elements (suggestions might already be rendered)
      setTimeout(() => {
        if (resolved) return;

        // Strategy 1: ARIA-linked listbox
        const ariaOwns = el.getAttribute("aria-owns") || el.getAttribute("aria-controls");
        if (ariaOwns) {
          const listbox = document.getElementById(ariaOwns);
          if (listbox) {
            const options = listbox.querySelectorAll('[role="option"], li, div');
            for (const opt of options) {
              const text = (opt.innerText || opt.textContent || "").trim();
              if (text.length > 1 && fuzzyOptionMatch(text, value)) {
                resolved = true;
                observer.disconnect();
                resolve(opt);
                return;
              }
            }
          }
        }

        // Strategy 2: Known selector patterns (kept as a fast fallback)
        const fallbackSelectors = [
          '[role="option"]', '[role="menuitem"]', '[role="listbox"] > *',
          '.dropdown-menu li', '.autocomplete-items div', '.react-select__option',
          '.select-items div', '.dropdown-item', '.typeahead-result',
          '.suggestion-item', '.autocomplete-result', '.combo-box-option',
          '[data-testid*="option"]', '[class*="option"]', '[class*="suggestion"]'
        ];

        for (const selector of fallbackSelectors) {
          const items = document.querySelectorAll(selector);
          for (const item of items) {
            if (item.offsetWidth === 0 && item.offsetHeight === 0) continue;
            const text = (item.innerText || item.textContent || "").trim();
            if (text.length > 1 && fuzzyOptionMatch(text, value)) {
              resolved = true;
              observer.disconnect();
              resolve(item);
              return;
            }
          }
        }

        // Strategy 3: first visible leaf node matching the value.
        // Iterate and break on the first hit instead of building+filtering a full
        // array, and do the cheap child-count check before reading offsetWidth
        // (which forces a layout) so most nodes are rejected without reflow.
        const leafNodes = document.querySelectorAll('div, li, span, a');
        for (let li = 0; li < leafNodes.length; li++) {
          const n = leafNodes[li];
          if (n.children.length > 2) continue; // not a leaf-ish node
          if (n.offsetWidth === 0 || n.offsetHeight === 0) continue;
          const t = (n.innerText || "").toLowerCase().trim();
          if (t.length > 2 && fuzzyOptionMatch(t, value)) {
            resolved = true;
            observer.disconnect();
            resolve(n);
            return;
          }
        }
      }, 350);

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  // Helper: Get specific label text for radio/checkbox inputs
  function getSpecificInputLabel(input) {
    const root = (input.getRootNode && input.getRootNode()) || document;
    if (input.id) {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(input.id) : input.id;
      const label = root.querySelector(`label[for="${esc}"]`);
      if (label && label.innerText.trim()) return label.innerText.trim();
    }
    let parent = input.parentElement;
    if (parent && parent.tagName === "LABEL") {
      return parent.innerText.trim();
    }
    let next = input.nextSibling;
    if (next) {
      if (next.nodeType === Node.TEXT_NODE && next.textContent.trim()) {
        return next.textContent.trim();
      }
      if (next.nodeType === Node.ELEMENT_NODE && next.innerText && next.innerText.trim()) {
        return next.innerText.trim();
      }
    }
    return input.value || "";
  }

  async function fillElement(el, value) {
    if (!value || String(value).trim() === "") return false;
    value = String(value);

    // Skip if already filled by user (not by us) and user's value differs
    if (el.value && el.value.trim() !== "" && !el.classList.contains("rf-filled") && el.type !== "radio" && el.type !== "checkbox") {
      if (el.value === value) {
        el.classList.add("rf-filled");
        return true;
      }
      return false;
    }

    // A. Radio buttons
    if (el.tagName === "INPUT" && el.type === "radio") {
      const specificLabel = getSpecificInputLabel(el);
      const isMatch = el.value.toLowerCase() === value.toLowerCase() || 
                      fuzzyOptionMatch(specificLabel, value) || 
                      (value.toLowerCase() === "yes" && (el.value.match(/^yes$|^y$/i) || specificLabel.match(/^yes$|^y$/i))) ||
                      (value.toLowerCase() === "no" && (el.value.match(/^no$|^n$/i) || specificLabel.match(/^no$|^n$/i)));
      if (isMatch) {
        // Only click when state actually needs to change — re-clicking an already
        // selected custom/toggle radio on a re-scan could turn it back off.
        if (!el.checked) {
          el.checked = true;
          el.click();
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        el.classList.add("rf-filled");
        return true;
      }
      return false;
    }

    // B. Checkboxes
    if (el.tagName === "INPUT" && el.type === "checkbox") {
      const specificLabel = getSpecificInputLabel(el);
      const isYesVal = value.toLowerCase() === "yes" || value.toLowerCase() === "true" || value === "1";
      const isNoVal = value.toLowerCase() === "no" || value.toLowerCase() === "false" || value === "0";
      
      let shouldCheck = false;
      if (isYesVal) {
        shouldCheck = true;
      } else if (isNoVal) {
        shouldCheck = false;
      } else {
        shouldCheck = el.value.toLowerCase() === value.toLowerCase() || fuzzyOptionMatch(specificLabel, value);
      }

      if (el.checked !== shouldCheck) {
        el.checked = shouldCheck;
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      el.classList.add("rf-filled");
      return true;
    }

    // A. Native Dropdowns (select tag)
    if (el.tagName === "SELECT") {
      let matchedOptionValue = null;
      const cleanValue = value.toLowerCase().trim();
      
      // Attempt 1: Exact match on text or value
      for (let i = 0; i < el.options.length; i++) {
        const optText = el.options[i].text.toLowerCase().trim();
        const optVal = el.options[i].value.toLowerCase().trim();
        
        if (optText === cleanValue || optVal === cleanValue) {
          matchedOptionValue = el.options[i].value;
          break;
        }
        
        // Semantic yes/no matching
        if (cleanValue === "yes" && (optText.match(/^yes$|^y$/i) || optVal.match(/^yes$|^y$/i))) {
          matchedOptionValue = el.options[i].value;
          break;
        }
        if (cleanValue === "no" && (optText.match(/^no$|^n$/i) || optVal.match(/^no$|^n$/i))) {
          matchedOptionValue = el.options[i].value;
          break;
        }
      }

      // Attempt 2: Fuzzy match (includes Levenshtein)
      if (matchedOptionValue === null) {
        let bestScore = Infinity;
        let bestOption = null;
        for (let i = 0; i < el.options.length; i++) {
          const optText = el.options[i].text.trim();
          if (fuzzyOptionMatch(optText, value) || fuzzyOptionMatch(el.options[i].value, value)) {
            const dist = levenshtein(optText.toLowerCase(), cleanValue);
            if (dist < bestScore) {
              bestScore = dist;
              bestOption = el.options[i].value;
            }
          }
        }
        if (bestOption !== null) matchedOptionValue = bestOption;
      }

      // Attempt 3: Look for "Other" / "Not Listed" / "Prefer not to say" fallback
      if (matchedOptionValue === null) {
        for (let i = 0; i < el.options.length; i++) {
          const optText = el.options[i].text.toLowerCase();
          if (optText.match(/other|not\s*listed|don't\s*see|unlisted|prefer not/i)) {
            matchedOptionValue = el.options[i].value;
            break;
          }
        }
      }

      if (matchedOptionValue !== null) {
        el.value = matchedOptionValue;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.classList.add("rf-filled");
        return true;
      }
      return false;
    }

    // B. Autocomplete / Combobox Inputs (generic detection)
    if (el.tagName === "INPUT" && isLikelyAutocomplete(el)) {
      setNativeValue(el, value);
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Simulate keystrokes to trigger suggestion lists
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));

      // Wait for suggestions via MutationObserver
      const bestMatch = await waitForSuggestions(el, value);
      if (bestMatch) {
        bestMatch.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        bestMatch.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        bestMatch.click();
        console.log("Apply karo: Clicked autocomplete suggestion:", bestMatch.innerText?.substring(0, 50));
      } else {
        // Keyboard fallback: highlight the first suggestion with ArrowDown, commit with Enter.
        // Helps virtualized / canvas-drawn lists where no clickable node is found.
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }

      el.classList.add("rf-filled");
      return true;
    }
    
    // C. Default Text inputs and textareas
    setNativeValue(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.classList.add("rf-filled");
    return true;
  }

  // Programmatic file injection using DataTransfer API
  async function injectResumeFile(fileInput, base64Url, fileName) {
    try {
      const response = await fetch(base64Url);
      const blob = await response.blob();
      const file = new File([blob], fileName || "resume.pdf", { type: blob.type || "application/pdf" });
      
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileInput.classList.add("rf-filled");
      
      // Update floating widget label if active
      console.log(`Apply karo: Auto-uploaded resume "${fileName}" successfully!`);
    } catch (err) {
      console.error("Apply karo: File upload automation failed:", err);
    }
  }

  // 4. LEARNING LOOP (ADAPTIVE ADJUSTMENTS)
  function observeInputChanges() {
    // One delegated listener on the document (capture phase) instead of attaching
    // a separate handler to every field. Lower setup cost + memory, and it also
    // captures fields added dynamically after load.
    document.addEventListener("change", (e) => {
      const input = e.target;
      if (!input || !input.tagName) return;
      const tag = input.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;
      if (input.type === "hidden" || input.disabled || input.type === "file") return;
      if (input.closest && input.closest("#apply-karo-widget-root")) return;

      const label = getFieldLabel(input);
      if (!label) return;

      capturedEdits[label] = input.value;
    }, true);
  }

  function observeFormSubmissions() {
    // Intercept standard submit events
    document.addEventListener("submit", async (e) => {
      await saveCapturedEdits();
    }, true);
  }

  async function saveCapturedEdits() {
    const editKeys = Object.keys(capturedEdits);
    if (editKeys.length === 0) return;

    const learned = state.learnedMappings || {};
    let updatedProfile = false;
    let customMappingsToConfirm = {};

    for (const label of editKeys) {
      const value = capturedEdits[label];
      if (!value || value.trim() === "") continue;

      const cleanLabel = label.toLowerCase().trim();
      
      // Use FIELD_RULES to check if this maps to a known profile path
      const fieldInfo = { label: label, name: "", id: "", type: "" };
      let isStandard = false;

      for (const rule of window.FIELD_RULES) {
        if (window.doesFieldMatchRule(rule, fieldInfo)) {
          // Update the profile at the resolved path
          const pathParts = rule.profilePath.split(".");
          let target = state.profile;
          
          for (let i = 0; i < pathParts.length - 1; i++) {
            const part = pathParts[i];
            const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
            if (arrayMatch) {
              const key = arrayMatch[1];
              const index = parseInt(arrayMatch[2], 10);
              if (!target[key]) target[key] = [];
              if (!target[key][index]) target[key][index] = {};
              target = target[key][index];
            } else {
              if (!target[part]) target[part] = {};
              target = target[part];
            }
          }
          
          const lastKey = pathParts[pathParts.length - 1];
          target[lastKey] = value;
          isStandard = true;
          updatedProfile = true;
          break;
        }
      }

      // If not a standard field, treat as custom/learned mapping
      if (!isStandard && learned[cleanLabel] !== value) {
        customMappingsToConfirm[label] = value;
      }
    }

    // Save profile if standard values updated
    if (updatedProfile) {
      await window.ResumeStorage.saveProfile(state.profile);
      console.log("Apply karo: Saved updated standard profile elements silently.");
    }

    // Auto-save custom mappings silently (Option A behavior)
    const customKeys = Object.keys(customMappingsToConfirm);
    if (customKeys.length > 0) {
      let profileUpdated = false;
      for (const label of customKeys) {
        const cleanLabel = label.toLowerCase().trim();
        const value = customMappingsToConfirm[label];
        
        // Save as customField if it looks like a personal fact, otherwise as learnedMapping
        const isPersonalFact = cleanLabel.match(/gender|race|ethnicity|veteran|disability|salary|start date|experience|authorized|sponsor|citizen|visa|nationality|age|dob|date of birth/i);
        if (isPersonalFact) {
          if (!state.profile.customFields) state.profile.customFields = {};
          state.profile.customFields[cleanLabel] = value;
          profileUpdated = true;
        } else {
          state.learnedMappings[cleanLabel] = value;
        }
      }
      if (profileUpdated) {
        await window.ResumeStorage.saveProfile(state.profile);
      }
      await window.ResumeStorage.saveLearnedMappings(state.learnedMappings);
      console.log(`Apply karo: Auto-saved ${customKeys.length} custom field / learned mappings.`);
    }

    // Clear edits log after saving
    capturedEdits = {};
  }

  // 5. WIDGET DOM INJECTION (SHADOW DOM ENCAPSULATION)
  function createFloatingWidget(initialFilledCount) {
    if (!IS_TOP_FRAME) return; // widget renders only in the top frame
    if (document.getElementById("apply-karo-widget-root")) return;

    const container = document.createElement("div");
    container.id = "apply-karo-widget-root";
    container.style.all = "initial"; // Reset page layouts
    document.body.appendChild(container);

    const shadow = container.attachShadow({ mode: "open" });
    
    // Inject styling inside the shadow root
    const style = document.createElement("style");
    style.textContent = `
      :host {
        --primary: #6366f1;
        --secondary: #a855f7;
        --grad-primary: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
        --panel-bg: rgba(13, 18, 36, 0.95);
        --border-color: rgba(255, 255, 255, 0.08);
        --text-primary: #f8fafc;
        --text-secondary: #94a3b8;
        --text-muted: #64748b;
        --success: #10b981;
        --danger: #ef4444;
        
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
      }

      /* Floating Button */
      .fab {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--grad-primary);
        box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: #fff;
        border: none;
        outline: none;
        transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.3s;
        position: relative;
      }

      .fab:hover {
        transform: scale(1.08) rotate(5deg);
        box-shadow: 0 6px 24px rgba(99, 102, 241, 0.6);
      }

      .fab-logo {
        font-size: 24px;
        font-weight: 800;
        user-select: none;
      }

      .badge {
        position: absolute;
        top: -4px;
        right: -4px;
        background: var(--success);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #080c16;
        animation: pulse 2s infinite;
      }

      /* Main Window */
      .widget-window {
        display: none;
        width: 360px;
        height: 480px;
        border-radius: 16px;
        background: var(--panel-bg);
        border: 1px solid var(--border-color);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(12px);
        overflow: hidden;
        flex-direction: column;
        position: absolute;
        bottom: 70px;
        right: 0;
        transform: translateY(20px);
        opacity: 0;
        transition: opacity 0.3s, transform 0.3s cubic-bezier(0.1, 0.8, 0.2, 1);
      }

      .widget-window.open {
        display: flex;
        transform: translateY(0);
        opacity: 1;
      }

      /* Header */
      .widget-header {
        padding: 16px;
        border-bottom: 1px solid var(--border-color);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .header-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .header-logo {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: var(--grad-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 850;
        color: #fff;
      }

      .close-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.2s;
      }

      .close-btn:hover {
        color: var(--text-primary);
      }

      /* Tabs */
      .widget-tabs {
        display: flex;
        border-bottom: 1px solid var(--border-color);
        background: rgba(0, 0, 0, 0.2);
      }

      .tab {
        flex: 1;
        padding: 10px;
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        cursor: pointer;
        transition: color 0.2s, background 0.2s;
      }

      .tab:hover {
        color: var(--text-primary);
        background: rgba(255,255,255,0.02);
      }

      .tab.active {
        color: var(--primary);
        border-bottom: 2px solid var(--primary);
        background: rgba(255,255,255,0.01);
      }

      /* Content Scroll Area */
      .widget-body {
        flex-grow: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .tab-panel {
        display: none;
        flex-direction: column;
        gap: 14px;
        height: 100%;
      }

      .tab-panel.active {
        display: flex;
      }

      /* Typography & Utility classes inside widget */
      .heading-sm {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 4px;
      }

      .desc-sm {
        font-size: 11px;
        color: var(--text-secondary);
        line-height: 1.4;
      }

      .btn-widget {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 600;
        padding: 8px 12px;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: transform 0.2s, background 0.2s;
      }

      .btn-widget:hover {
        background: rgba(255, 255, 255, 0.12);
        transform: translateY(-1px);
      }

      .btn-widget-primary {
        background: var(--grad-primary);
        border: none;
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
      }

      .btn-widget-primary:hover {
        background: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%);
        box-shadow: 0 4px 16px rgba(99, 102, 241, 0.4);
      }

      .btn-widget-success {
        background: var(--success);
        border: none;
      }

      .btn-widget-success:hover {
        background: #0d9488;
      }

      /* Custom list items for Question fields */
      .qa-row {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .qa-question {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .textarea-widget {
        width: 100%;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-primary);
        font-size: 12px;
        padding: 8px;
        outline: none;
        resize: vertical;
        box-sizing: border-box;
      }

      .textarea-widget:focus {
        border-color: var(--primary);
      }

      /* Confirmation Modal Dialog overlay inside shadow DOM */
      .confirm-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(8, 10, 20, 0.9);
        display: none;
        flex-direction: column;
        justify-content: center;
        padding: 24px;
        box-sizing: border-box;
        z-index: 100;
        animation: fadeIn 0.3s;
      }

      .confirm-overlay.show {
        display: flex;
      }

      .confirm-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: 8px;
      }

      .confirm-list {
        max-height: 220px;
        overflow-y: auto;
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .confirm-item {
        background: rgba(255,255,255,0.03);
        padding: 8px;
        border-radius: 6px;
        font-size: 11px;
        border-left: 2px solid var(--primary);
      }

      .confirm-label {
        font-weight: 600;
        color: var(--text-secondary);
        margin-bottom: 2px;
      }

      .confirm-val {
        color: var(--text-primary);
        word-break: break-all;
      }

      .confirm-actions {
        display: flex;
        gap: 12px;
      }

      .confirm-actions button {
        flex: 1;
      }

      @keyframes pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
        }
        70% {
          box-shadow: 0 0 0 8px rgba(16, 185, 129, 0);
        }
        100% {
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
        }
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    `;

    // Widget HTML Structure
    const widgetHTML = `
      <div id="rf-window" class="widget-window">
        <!-- Header -->
        <div class="widget-header">
          <div class="header-title">
            <div class="header-logo">R</div>
            <span>Apply karo Assistant</span>
          </div>
          <button id="rf-close-btn" class="close-btn">&times;</button>
        </div>

        <!-- Tabs -->
        <div class="widget-tabs">
          <div class="tab active" data-panel="panel-status">Status</div>
          <div class="tab" data-panel="panel-ai">AI Assist</div>
          <div class="tab" data-panel="panel-letter">Cover Letter</div>
        </div>

        <!-- Scrollable Body -->
        <div class="widget-body">
          
          <!-- 1. STATUS PANEL -->
          <div id="panel-status" class="tab-panel active">
            <div>
              <div class="heading-sm">Autofill Engine Status</div>
              <div class="desc-sm">Automatically loads matching data on web page structures.</div>
            </div>
            
            <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border-color); border-radius:8px; padding:12px;">
              <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">
                <span style="color:var(--text-secondary);">Resume attached:</span>
                <span id="widget-resume-status" style="font-weight:600;">Checking...</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:12px;">
                <span style="color:var(--text-secondary);">AI capabilities:</span>
                <span id="widget-ai-status" style="font-weight:600;">Checking...</span>
              </div>
            </div>

            <button id="widget-fill-btn" class="btn-widget btn-widget-primary" style="padding:12px;">
              Re-Trigger Form Autofill
            </button>

            <button id="widget-agent-fill-btn" class="btn-widget btn-widget-primary" style="padding:12px; background:linear-gradient(135deg, #a855f7 0%, #ec4899 100%); margin-top:4px; box-shadow:0 4px 12px rgba(168, 85, 247, 0.25); border:none;">
              ✨ Run AI Agent Autofill
            </button>

            <button id="widget-capture-btn" class="btn-widget" style="padding:10px; margin-top:4px;">
              <svg style="width:14px;height:14px;fill:currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M12 17L7 12H10V8H14V12H17L12 17Z"/>
              </svg>
              Capture Form Data
            </button>
          </div>

          <!-- 2. AI ASSIST PANEL -->
          <div id="panel-ai" class="tab-panel">
            <div>
              <div class="heading-sm">Custom Essay Questions</div>
              <div class="desc-sm" style="margin-bottom:8px;">Generate tailored answers using your resume details.</div>
            </div>
            
            <div id="ai-questions-container" style="display:flex; flex-direction:column; gap:12px; flex-grow:1; max-height:300px; overflow-y:auto; padding-right:4px;">
              <!-- Dynamic lists of scanned textareas -->
              <div style="text-align:center; color:var(--text-muted); font-size:11px; margin-top:20px;">
                No long-form text questions detected on this page.
              </div>
            </div>
          </div>

          <!-- 3. COVER LETTER PANEL -->
          <div id="panel-letter" class="tab-panel">
            <div>
              <div class="heading-sm">Cover Letter Generator</div>
              <div class="desc-sm">Generates a customized, targeted letter based on the current page's job description.</div>
            </div>

            <div style="display:flex; flex-direction:column; gap:8px; flex-grow:1;">
              <label class="desc-sm" style="font-weight:600;">Scraped Job Description Context:</label>
              <textarea id="widget-job-desc" class="textarea-widget" style="height:100px; font-size:11px;" placeholder="Paste job description here if it didn't scrape automatically..."></textarea>
            </div>

            <button id="widget-gen-letter-btn" class="btn-widget btn-widget-primary">
              Generate Cover Letter
            </button>

            <div id="letter-result-container" style="display:none; flex-direction:column; gap:8px;">
              <label class="desc-sm" style="font-weight:600; color:var(--success);">Generated Letter:</label>
              <textarea id="widget-letter-result" class="textarea-widget" style="height:120px; font-size:11px;" readonly></textarea>
              <div style="display:flex; gap:8px;">
                <button id="widget-copy-letter-btn" class="btn-widget" style="flex:1;">Copy</button>
                <button id="widget-autofill-letter-btn" class="btn-widget btn-widget-success" style="flex:1;">Autofill Box</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. CONFIRMATION OVERLAY FOR LEARNING -->
        <div id="rf-confirm-overlay" class="confirm-overlay">
          <div class="confirm-title">Save Custom Answers?</div>
          <div class="desc-sm" style="margin-bottom:12px;">Apply karo noticed you filled out some custom questions. Would you like to save these mappings to auto-fill them next time?</div>
          <div id="confirm-items-list" class="confirm-list">
            <!-- Dynamic elements go here -->
          </div>
          <div class="confirm-actions">
            <button id="confirm-cancel-btn" class="btn-widget" style="padding:10px;">Skip</button>
            <button id="confirm-save-btn" class="btn-widget btn-widget-primary" style="padding:10px;">Save Mappings</button>
          </div>
        </div>
      </div>

      <!-- Floating Trigger Button (FAB) -->
      <button id="rf-fab" class="fab">
        <span class="fab-logo">R</span>
        <span id="rf-badge" class="badge" style="display: none;">0</span>
      </button>
    `;

    // Append styles and markup
    shadow.appendChild(style);
    
    const markupWrapper = document.createElement("div");
    markupWrapper.innerHTML = widgetHTML;
    shadow.appendChild(markupWrapper);

    activeWidget = shadow;
    updateWidgetBadge(initialFilledCount);
    bindWidgetEvents(shadow);
  }

  function updateWidgetBadge(count) {
    if (!activeWidget) return;
    const badge = activeWidget.getElementById("rf-badge");
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }

  // 6. FLOATING WIDGET ACTIONS & BINDINGS
  function bindWidgetEvents(shadow) {
    const fab = shadow.getElementById("rf-fab");
    const windowEl = shadow.getElementById("rf-window");
    const closeBtn = shadow.getElementById("rf-close-btn");
    
    // Toggle Window on FAB Click
    fab.addEventListener("click", () => {
      const isOpen = windowEl.classList.contains("open");
      if (isOpen) {
        windowEl.classList.remove("open");
      } else {
        // Refresh statuses and scan page when opening
        updateWidgetStatusLabels(shadow);
        scanLongFormQuestions(shadow);
        
        // Pre-fill scraped job description if empty
        const jobDescArea = shadow.getElementById("widget-job-desc");
        if (!jobDescArea.value) {
          jobDescArea.value = getJobDescriptionText();
        }

        windowEl.classList.add("open");
      }
    });

    closeBtn.addEventListener("click", () => {
      windowEl.classList.remove("open");
    });

    // Tab Switching
    const tabs = shadow.querySelectorAll(".tab");
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        shadow.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        
        tab.classList.add("active");
        const panelId = tab.getAttribute("data-panel");
        shadow.getElementById(panelId).classList.add("active");
      });
    });

    // Status Tab: Re-trigger Autofill
    shadow.getElementById("widget-fill-btn").addEventListener("click", async () => {
      const count = await runAutofill(true);
      updateWidgetBadge(count);
    });

    // Status Tab: Run AI Agent Autofill
    shadow.getElementById("widget-agent-fill-btn").addEventListener("click", () => {
      runAgenticAutofill(shadow);
    });

    // Status Tab: Capture Form Data
    shadow.getElementById("widget-capture-btn").addEventListener("click", async () => {
      // Manually trigger scanning inputs on page
      const inputs = document.querySelectorAll("input, textarea, select");
      inputs.forEach(input => {
        if (input.type === "hidden" || input.disabled || input.type === "file") return;
        const label = getFieldLabel(input);
        if (label && input.value && input.value.trim() !== "") {
          capturedEdits[label] = input.value;
        }
      });

      await saveCapturedEdits();
    });

    // Cover Letter Tab: Generate
    const genLetterBtn = shadow.getElementById("widget-gen-letter-btn");
    const letterResultContainer = shadow.getElementById("letter-result-container");
    const letterResultText = shadow.getElementById("widget-letter-result");
    const copyLetterBtn = shadow.getElementById("widget-copy-letter-btn");
    const autofillLetterBtn = shadow.getElementById("widget-autofill-letter-btn");

    genLetterBtn.addEventListener("click", async () => {
      const key = state.settings.geminiApiKey;
      const model = state.settings.geminiModel;
      const jobDesc = shadow.getElementById("widget-job-desc").value.trim();

      if (!key) {
        alert("Please set your Gemini API Key in the options dashboard first.");
        return;
      }
      if (!jobDesc) {
        alert("Please paste or scrape a job description first.");
        return;
      }

      genLetterBtn.textContent = "Generating Letter...";
      genLetterBtn.disabled = true;

      try {
        const coverLetter = await window.ResumeGemini.generateCoverLetter(key, model, jobDesc, state.profile, state.resume.text);
        letterResultText.value = coverLetter;
        letterResultContainer.style.display = "flex";
      } catch (err) {
        alert(`API Error: ${err.message}`);
      } finally {
        genLetterBtn.textContent = "Generate Cover Letter";
        genLetterBtn.disabled = false;
      }
    });

    // Copy Cover Letter
    copyLetterBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(letterResultText.value);
      copyLetterBtn.textContent = "Copied!";
      setTimeout(() => {
        copyLetterBtn.textContent = "Copy";
      }, 1500);
    });

    // Autofill Cover Letter Box
    autofillLetterBtn.addEventListener("click", () => {
      const textareas = document.querySelectorAll("textarea");
      let filled = false;
      textareas.forEach(ta => {
        const label = getFieldLabel(ta).toLowerCase();
        if (label.match(/cover\s*letter|letter/i) || ta.name.match(/cover.*letter|letter/i)) {
          ta.value = letterResultText.value;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          filled = true;
        }
      });
      if (filled) {
        alert("Injected cover letter into form textarea!");
      } else {
        alert("Could not locate a cover letter textbox on the page. You can still manually copy and paste it using the 'Copy' button!");
      }
    });
  }

  function updateWidgetStatusLabels(shadow) {
    const resumeStatus = shadow.getElementById("widget-resume-status");
    const aiStatus = shadow.getElementById("widget-ai-status");

    if (state.resume && state.resume.base64) {
      resumeStatus.textContent = "Ready (" + state.resume.fileName + ")";
      resumeStatus.style.color = "var(--success)";
    } else {
      resumeStatus.textContent = "Missing";
      resumeStatus.style.color = "var(--danger)";
    }

    if (state.settings.geminiApiKey) {
      aiStatus.textContent = "Active";
      aiStatus.style.color = "var(--success)";
    } else {
      aiStatus.textContent = "Not Configured";
      aiStatus.style.color = "var(--text-muted)";
    }
  }

  // AI Tab: Scan for custom questions (textareas)
  function scanLongFormQuestions(shadow) {
    const container = shadow.getElementById("ai-questions-container");
    container.innerHTML = "";

    const textareas = Array.from(document.querySelectorAll("textarea"));
    
    // Filter out textareas that are clearly for Cover Letter or standard summaries
    const filteredTextareas = textareas.filter(ta => {
      const label = getFieldLabel(ta).toLowerCase();
      // Skip cover letters, standard summaries, or widgets
      return !label.match(/cover\s*letter|letter|summary|skills/i) && ta.id !== "widget-job-desc" && ta.id !== "widget-letter-result";
    });

    if (filteredTextareas.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; color:var(--text-muted); font-size:11px; margin-top:20px;">
          No long-form text questions detected on this page.
        </div>
      `;
      return;
    }

    filteredTextareas.forEach((ta, idx) => {
      const label = getFieldLabel(ta) || `Question ${idx + 1}`;
      
      const row = document.createElement("div");
      row.className = "qa-row";

      const qLabel = document.createElement("div");
      qLabel.className = "qa-question";
      qLabel.textContent = label;

      const genBtn = document.createElement("button");
      genBtn.className = "btn-widget btn-widget-primary";
      genBtn.textContent = "Generate Answer";
      
      const answerArea = document.createElement("textarea");
      answerArea.className = "textarea-widget";
      answerArea.style.display = "none";
      answerArea.style.height = "80px";
      answerArea.placeholder = "Generated AI response will appear here...";

      const actionRow = document.createElement("div");
      actionRow.style.display = "none";
      actionRow.style.gap = "8px";

      const insertBtn = document.createElement("button");
      insertBtn.className = "btn-widget btn-widget-success";
      insertBtn.style.flex = "1";
      insertBtn.textContent = "Inject Answer";

      actionRow.appendChild(insertBtn);

      genBtn.addEventListener("click", async () => {
        const key = state.settings.geminiApiKey;
        const model = state.settings.geminiModel;

        if (!key) {
          alert("Please configure your Gemini API Key in the dashboard first.");
          return;
        }

        genBtn.textContent = "AI is thinking...";
        genBtn.disabled = true;

        try {
          const answer = await window.ResumeGemini.answerQuestion(key, model, label, state.profile, state.resume.text);
          answerArea.value = answer;
          answerArea.style.display = "block";
          actionRow.style.display = "flex";
          genBtn.style.display = "none";
        } catch (err) {
          alert(`Failed to write answer:\n${err.message}`);
          genBtn.textContent = "Generate Answer";
          genBtn.disabled = false;
        }
      });

      insertBtn.addEventListener("click", () => {
        ta.value = answerArea.value;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        insertBtn.textContent = "Injected!";
        setTimeout(() => {
          insertBtn.textContent = "Inject Answer";
        }, 1500);
      });

      row.appendChild(qLabel);
      row.appendChild(genBtn);
      row.appendChild(answerArea);
      row.appendChild(actionRow);

      container.appendChild(row);
    });
  }

  // Confirms saving custom answers
  let currentOverlayMappings = {};
  
  function showConfirmationDialogInWidget(mappings) {
    currentOverlayMappings = mappings;
    const overlay = activeWidget.getElementById("rf-confirm-overlay");
    const list = activeWidget.getElementById("confirm-items-list");
    list.innerHTML = "";

    Object.keys(mappings).forEach(label => {
      const item = document.createElement("div");
      item.className = "confirm-item";
      
      const labelDiv = document.createElement("div");
      labelDiv.className = "confirm-label";
      labelDiv.textContent = label;

      const valDiv = document.createElement("div");
      valDiv.className = "confirm-val";
      valDiv.textContent = mappings[label];

      item.appendChild(labelDiv);
      item.appendChild(valDiv);
      list.appendChild(item);
    });

    overlay.classList.add("show");

    // Bind save / cancel buttons
    const saveBtn = activeWidget.getElementById("confirm-save-btn");
    const cancelBtn = activeWidget.getElementById("confirm-cancel-btn");

    // Clear old listeners
    const newSaveBtn = saveBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newSaveBtn.addEventListener("click", async () => {
      for (const label of Object.keys(currentOverlayMappings)) {
        await window.ResumeStorage.learnField(label, currentOverlayMappings[label]);
      }
      overlay.classList.remove("show");
      alert("Custom field mappings saved successfully!");
      // Reload states
      state = await window.ResumeStorage.loadAll();
    });

    newCancelBtn.addEventListener("click", () => {
      overlay.classList.remove("show");
    });
  }

  // 7. FIRE INITIALIZER
  init();
})();
