import { canonicalQuestion } from "../shared/field-identity.js";
export function relevantEvidence(state, profile, resumeText, fields, limit = 8) {
  const texts = Object.values(state.evidence || {}).filter(e => ["confirmed", "proposed"].includes(e.status) && (!e.expiresAt || e.expiresAt > Date.now()) && (!e.refreshAfter || e.refreshAfter > Date.now()) && Object.entries(e.dependencies || {}).every(([k,v]) => state.dependencies?.[k] === v)).map(e => ({ id: e.id, text: e.text, source: e.provenance?.source }));
  if (profile.summary) texts.push({ id: "profile:summary", text: profile.summary, source: "profile" });
  if (resumeText) {
    let i = 0;
    for (const part of resumeText.split(/\n+/).filter(t => t.trim().length >= 12)) texts.push({ id: `resume:span:${i++}`, text: part.trim(), source: "resume" });
  }
  const terms = new Set(canonicalQuestion(fields.map(f => f.questionFull).join(" ")).split(" ").filter(t => t.length > 3));
  const seen = new Set();
  return texts.filter(e => e.text && !seen.has(e.text) && (seen.add(e.text), true)).map(e => ({ ...e, score: canonicalQuestion(e.text).split(" ").filter(t => terms.has(t)).length }))
    .sort((a,b) => b.score - a.score).filter(e => e.text.length <= 6000).slice(0, limit);
}
