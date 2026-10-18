// Opt-in, frame-local diagnostics. Never retain labels, values, selectors or URLs.
// A successful write attempt is not called verified: readback belongs to the verifier.
export const OUTCOMES = Object.freeze([
  "discovered", "deferred", "unsupported", "ambiguous", "missing_fact",
  "answer_ready", "write_attempted", "write_reported", "write_rejected",
  "observed_nonempty", "verified", "edited", "reviewed"
]);
const STAGES = new Set(["discovery", "rules", "widgets", "ai", "review", "run", "verify", "resolver"]);
const REASONS = new Set([
  "scan", "existing_value", "user_modified", "focused", "no_rule", "no_value",
  "widget_pending", "budget", "rule", "memory", "ai", "control_refused",
  "source_unverified", "not_empty", "remaining_empty", "run_start", "run_end", "canonical_value_persistent", "value_not_persistent", "validation_failed", "stale_descriptor", "cancelled", "user_edit", "not_attempted"
]);
const KINDS = new Set(["text", "textarea", "select", "combobox", "radiogroup",
  "checkboxgroup", "checkbox", "switch", "date", "dategroup", "file", "richtext"]);
const SIGNALS = new Set(["aria-label", "aria-labelledby", "label", "placeholder", "name", "context"]);

export function createDiagnostics({ clock = () => performance.now(), limit = 400 } = {}) {
  let enabled = false, events = [], dropped = 0, sequence = 0, runId = 0, start = 0;
  let identities = new WeakMap();
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 2000) : 400;
  function configure(on) {
    enabled = on === true;
    if (!enabled) { events = []; dropped = 0; identities = new WeakMap(); sequence = 0; }
  }
  function fieldId(field) {
    const el = field?.el;
    if (!enabled || !el || typeof el !== "object") return 0;
    if (!identities.has(el)) identities.set(el, ++sequence);
    return identities.get(el);
  }
  function record({ field, stage, outcome, reason, source, frame = "top" } = {}) {
    if (!enabled || !STAGES.has(stage) || (outcome && !OUTCOMES.includes(outcome))) return;
    const event = {
      runId, fieldId: fieldId(field), frame: frame === "child" ? "child" : "top",
      stage, outcome: outcome || null, reason: REASONS.has(reason) ? reason : null,
      kind: KINDS.has(field?.kind) ? field.kind : null,
      extractionSource: SIGNALS.has(source) ? source : null,
      ms: Math.max(0, Math.round(clock() - start))
    };
    events.push(event);
    if (events.length > cap) { events.shift(); dropped++; }
  }
  function begin(frame) {
    if (!enabled) return;
    runId++; start = clock();
    record({ stage: "run", reason: "run_start", frame });
  }
  function snapshot() {
    return { version: 1, enabled, dropped, events: events.map((e) => ({ ...e })) };
  }
  return { get enabled() { return enabled; }, configure, begin, record, snapshot };
}

// Candidate signal only, not a claim about which branch labelFor actually selected.
export function extractionSignal(field) {
  const el = field?.el;
  if (el?.getAttribute?.("aria-labelledby")) return "aria-labelledby";
  if (el?.getAttribute?.("aria-label")) return "aria-label";
  if (el?.labels?.length || el?.closest?.("label")) return "label";
  if (field?.rawLabel) return "context";
  if (field?.placeholder) return "placeholder";
  return field?.name ? "name" : null;
}
