// Revisions are local to the document. Never write or undo over a later edit.
export function captureRevision(field, question) {
  const el = field.el;
  let revision = 0;
  const changed = () => { revision++; };
  el.addEventListener("input", changed);
  el.addEventListener("change", changed);
  const value = () => String(el.value ?? el.textContent ?? "");
  const initial = value();
  return {
    valid: (currentQuestion) => el.isConnected && revision === 0 && value() === initial && currentQuestion === question,
    dispose: () => { el.removeEventListener("input", changed); el.removeEventListener("change", changed); }
  };
}
export const TERMINAL_STATES = ["completed", "needs_attention", "failed", "interrupted"];
export function isRunningJob(job) { return !!job && !TERMINAL_STATES.includes(job.state); }
export const JOB_LABELS = { preparing: "Preparing page…", detecting: "Detecting fields…", filling: "Filling…", waiting_ai: "Waiting for AI…", verifying: "Checking fields…", completed: "Completed — review before submitting.", needs_attention: "Needs attention", failed: "Fill failed", interrupted: "Fill interrupted — review before retrying." };
