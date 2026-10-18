const identities = new WeakMap();
let sequence = 0;
export function describe(field, labels) {
  const question = labels.candidates.some((c) => c.source === "user-corrected") ? labels.question : field.rawLabel || labels.question;
  const fingerprint = JSON.stringify([question, field.helperText, field.sectionTitle, field.instance, field.kind,
    (field.options || []).map((o) => [o.label, o.value])]);
  let identity = identities.get(field.el);
  if (!identity) { identity = { fieldId: `field-${++sequence}`, fingerprint, revision: 1 }; identities.set(field.el, identity); }
  else if (identity.fingerprint !== fingerprint) { identity.fingerprint = fingerprint; identity.revision++; }
  return { ...field, rawLabel: question, label: question.toLowerCase(), fieldId: identity.fieldId, formRevision: identity.revision, questionFull: question,
    accessibleName: labels.question, labelCandidates: labels.candidates,
    visiblePrompt: labels.candidates.find((c) => ["label", "wrapping-label", "visible-heading", "visible-context"].includes(c.source))?.text || "",
    extraction: { ambiguous: labels.ambiguous, conflicting: labels.conflicting, truncated: labels.truncated, sources: labels.candidates.map((c) => c.source) },
    sectionPath: field.sectionTitle ? [field.sectionTitle] : [],
    entityId: `${field.section || "personal"}:${field.instance || 0}`,
    required: !!field.el.required || field.el.getAttribute?.("aria-required") === "true",
    optionsComplete: !!field.nativeSelect || !["combobox"].includes(field.kind),
    constraints: { maxLength: field.el.maxLength > 0 ? field.el.maxLength : null, min: field.el.min || null, max: field.el.max || null, pattern: field.el.pattern || null }
  };
}
