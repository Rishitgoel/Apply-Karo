export const REVIEW_GROUPS = ["Verified facts", "Drafts to review", "Missing facts", "Could not fill"];
export function reviewRow(field, decision, value, validation, empty) {
  const verified = field.verification?.status === "verified" && validation !== "failed";
  const group = validation === "failed" || field.verification?.status === "rejected" || decision?.status === "blocked" || decision?.status === "deferred" || field.skip
    ? "Could not fill" : decision?.status === "draft" ? "Drafts to review" : verified && decision?.status === "resolved" ? "Verified facts" : empty ? "Missing facts" : "Drafts to review";
  return { id: field.fieldId, revision: field.formRevision, question: field.questionFull || field.rawLabel || field.label || "Unlabeled field", group,
    answer: value, source: decision?.source || (empty ? "No confirmed source" : "Existing or manually entered value"),
    transformations: decision?.transformations || [], reason: field.verification?.reason || decision?.reason || (empty ? "A confirmed answer is needed" : "Review this value"),
    required: !!field.required, editable: !field.skip && field.kind !== "file", missingKey: JSON.stringify([field.questionFull || field.rawLabel, field.section, field.sectionTitle, field.helperText, field.entityId,
      field.kind, field.type, field.phonePart, field.country, field.company, field.polarity, field.units, field.constraints, field.options?.map(o => o.label)]) };
}
export function redactReview(rows, includeAnswers = false, includeQuestions = false) {
  return rows.map(({ id, revision, group, answer, question, source, transformations, reason, required }) => ({ id, revision, group, required,
    question: includeQuestions ? question : "[redacted]", answer: includeAnswers ? answer : "[redacted]", source, transformations, reason }));
}
