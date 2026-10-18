export function canonicalQuestion(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
}
export function scopeForQuestion(url) {
  const u = new URL(url);
  const identifiers = [...u.searchParams].filter(([key]) => /^(job|jobid|requisition|requisitionid|reqid|applicationid|gh_jid)$/i.test(key)).sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(identifiers).toString();
  return u.origin + u.pathname + (query ? "?" + query : "");
}
export function contextualKey(field) {
  const question = canonicalQuestion(field.questionFull || field.rawLabel || field.label || field.name || field.id);
  if (!question) return "";
  return "q2:" + JSON.stringify([question, canonicalQuestion(field.sectionTitle || field.section || ""), field.instance || 0]);
}
