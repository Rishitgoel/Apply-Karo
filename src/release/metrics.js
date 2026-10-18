export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b), index = (sorted.length - 1) * fraction, low = Math.floor(index);
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
}
export function fieldMetrics(rows) {
  const byFamily = {};
  const summarize = values => {
    const written = values.filter(r => r.written), correct = written.filter(r => r.correct), answerable = values.filter(r => r.answerable);
    const accepted = written.filter(r => r.accepted !== false);
    return { fields: values.length, discovered: values.filter(r => r.discovered).length, questionFidelity: values.filter(r => r.questionCorrect).length / Math.max(1, values.length),
      precision: written.length ? correct.length / written.length : null, coverage: answerable.length ? correct.filter(r => r.answerable && r.accepted !== false).length / answerable.length : null,
      unresolvedRate: values.filter(r => !r.written || r.accepted === false).length / Math.max(1, values.length), correctionRate: written.length ? written.filter(r => !r.correct || r.accepted === false).length / written.length : null,
      factualCorrectionRate: written.length ? written.filter(r => !r.correct).length / written.length : null,
      falseSuccesses: values.filter(r => r.reportedVerified && (!r.correct || r.accepted === false)).length, unsupported: values.filter(r => r.unsupported).length,
      acceptedWrites: accepted.length, acceptedWriteRate: written.length ? accepted.length / written.length : null, written: written.length, correct: correct.length, answerable: answerable.length };
  };
  for (const family of new Set(rows.map(r => r.family))) byFamily[family] = summarize(rows.filter(r => r.family === family));
  return { overall: summarize(rows), byFamily };
}
export function trialMetrics(document) {
  if (!Array.isArray(document?.trials)) throw new Error("A trial file must contain a trials array.");
  if (document.setupActiveMs != null && (!Number.isFinite(document.setupActiveMs) || document.setupActiveMs < 0)) throw new Error("Profile setup time must be a nonnegative measured duration.");
  const trials = document.trials;
  const ids = new Set();
  for (const row of trials) {
    if (!row.trialId || ids.has(row.trialId) || !row.participantId || !row.family || !row.manualVariant || !row.assistedVariant || row.manualVariant === row.assistedVariant || row.observerReviewed !== true || !["manual-first", "assisted-first"].includes(row.order) || row.reviewComplete !== true ||
      !["manualActiveMs", "assistedActiveMs", "manualElapsedMs", "assistedElapsedMs"].every(k => Number.isFinite(row[k]) && row[k] > 0) || row.manualElapsedMs < row.manualActiveMs || row.assistedElapsedMs < row.assistedActiveMs ||
      !["finalErrors", "seededErrors", "noticedErrors"].every(k => Number.isInteger(row[k]) && row[k] >= 0) || row.noticedErrors > row.seededErrors) throw new Error("A trial is incomplete, duplicated or invalid; incomplete trials cannot be silently excluded.");
    ids.add(row.trialId);
  }
  const saving = sample => sample.length ? 1 - sample.reduce((s,r) => s+r.assistedActiveMs,0) / sample.reduce((s,r) => s+r.manualActiveMs,0) : null;
  const grouped = [...new Set(trials.map(r => r.participantId))].map(id => trials.filter(r => r.participantId === id));
  const clusters = grouped.length > 1 ? grouped : trials.map(r => [r]), boot = []; let seed = 7;
  for (let i = 0; trials.length && i < 2000; i++) {
    const sample = []; for (let j = 0; j < clusters.length; j++) { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; sample.push(...clusters[seed % clusters.length]); } boot.push(saving(sample));
  }
  const human = document.evidenceKind === "human-self-reported", aggregateSaving = saving(trials);
  const byFamily = {}, byMaturity = {};
  const describe = values => ({ trials: values.length, aggregateSaving: saving(values), manualP50Ms: percentile(values.map(r=>r.manualActiveMs),.5), assistedP50Ms: percentile(values.map(r=>r.assistedActiveMs),.5), assistedP90Ms: percentile(values.map(r=>r.assistedActiveMs),.9) });
  for (const family of new Set(trials.map(r=>r.family))) byFamily[family]=describe(trials.filter(r=>r.family===family));
  for (const maturity of new Set(trials.map(r=>r.profileMaturity || "unspecified"))) byMaturity[maturity]=describe(trials.filter(r=>(r.profileMaturity || "unspecified")===maturity));
  const workload = Object.entries(document.workload || {}), workloadComplete = workload.length >= 3 && workload.every(([family,count])=>Number.isInteger(count)&&count>0&&trials.filter(r=>r.family===family).length>=count);
  const counterbalanced = workload.length >= 3 && workload.every(([family])=>{const values=trials.filter(r=>r.family===family);return values.some(r=>r.order==='manual-first')&&values.some(r=>r.order==='assisted-first');});
  return { evidenceKind: document.evidenceKind, trials: trials.length, participants: grouped.length, aggregateSaving,
    byFamily, byMaturity, workloadComplete, counterbalanced,
    saving95Interval: boot.length ? [percentile(boot,.025),percentile(boot,.975)] : null, uncertaintyUnit: grouped.length > 1 ? "participant clusters" : "paired trials conditional on this participant",
    manualP50Ms: percentile(trials.map(r => r.manualActiveMs),.5), manualP90Ms: percentile(trials.map(r => r.manualActiveMs),.9),
    assistedP50Ms: percentile(trials.map(r => r.assistedActiveMs),.5), assistedP90Ms: percentile(trials.map(r => r.assistedActiveMs),.9), assistedElapsedP90Ms: percentile(trials.map(r => r.assistedElapsedMs),.9),
    setupActiveMs: document.setupActiveMs ?? null, setupAmortized10Ms: Number.isFinite(document.setupActiveMs) ? document.setupActiveMs / 10 : null, setupAmortized30Ms: Number.isFinite(document.setupActiveMs) ? document.setupActiveMs / 30 : null,
    finalErrors: trials.reduce((s,r) => s+r.finalErrors,0), seededErrors: trials.reduce((s,r) => s+r.seededErrors,0), noticedErrors: trials.reduce((s,r) => s+r.noticedErrors,0),
    unsupportedTrials: trials.filter(r => r.unsupported).length, targetMeasured: human && trials.length >= 30 && workloadComplete && counterbalanced,
    targetPassed: human && trials.length >= 30 && workloadComplete && counterbalanced && aggregateSaving >= .9 && trials.every(r => r.finalErrors === 0) && trials.every(r => r.noticedErrors === r.seededErrors),
    limitations: ["Self-reported measurements require independent correctness and workload review.", "No inference to untested users or ATS families.", "Unsupported trials remain in the aggregate denominator."] };
}
