// Worker-owned jobs. Restart reconciliation only observes existing content runs;
// it never replays writes whose outcome is unknown.
const terminal = new Set(["completed", "needs_attention", "failed", "interrupted"]);
export function createFillJobs({ storage, identify, prepare, dispatch, observe, notify = async () => {}, clock = Date.now }) {
  const jobs = new Map(), pending = new Map();
  let writes = Promise.resolve();
  const save = () => {
    const snapshot = [...jobs.values()].slice(-30).map((j) => ({ ...j }));
    writes = writes.catch(() => {}).then(() => storage.set({ fillJobs: snapshot }));
    return writes;
  };
  async function update(job, patch) {
    if (terminal.has(job.state)) return job;
    Object.assign(job, patch, { updatedAt: clock() });
    await save(); await notify(job).catch(() => {});
    return job;
  }
  async function finish(job, results) {
    const total = results.reduce((n, r) => n + (r.total || 0), 0);
    const filled = results.reduce((n, r) => n + (r.filled || 0), 0);
    const empty = results.reduce((n, r) => n + (r.empty || 0), 0);
    const drafts = results.reduce((n, r) => n + (r.drafts || 0), 0);
    const deferred = results.reduce((n, r) => n + (r.deferred || 0), 0);
    const error = results.map((r) => r.error || r.aiError || "").filter(Boolean).join("; ").slice(0, 500);
    const surfaceWarning = job.frames?.some((f) => f.surface?.uninspectableHosts) ? "Some form components cannot be inspected (possibly closed shadow roots). Review them manually." : "";
    const frameUrls = new Set(job.frames?.map((f) => f.url).filter(Boolean));
    const inaccessible = job.frames?.some((f) => f.surface?.frames.some((url) => !frameUrls.has(url))) ? "Some embedded pages are inaccessible. Review their fields manually." : "";
    const message = [error, surfaceWarning, inaccessible].filter(Boolean).join(" ");
    return update(job, { state: message || empty || drafts || deferred || !total ? "needs_attention" : "completed", total, filled, empty, drafts, deferred,
      error: message || (drafts ? `${drafts} AI draft(s) need your review.` : deferred ? `${deferred} fields deferred; click Fill to continue.` : total ? "" : "No form fields found here.") });
  }
  async function perform(job) {
    try {
      const frames = await prepare(job);
      if (!frames.length) throw new Error("No reachable form engine. Reload the page and try again.");
      if ((await identify(job.tabId)).documentId !== job.documentId) throw new Error("The application page changed during preparation. Review before retrying.");
      await update(job, { state: "detecting", frames });
      await update(job, { state: "filling" });
      await finish(job, await dispatch(job));
    } catch (e) { await update(job, { state: "failed", error: e.message || String(e) }); }
  }
  async function reconcile(job) {
    try {
      while (clock() < job.deadline) {
        const identity = await identify(job.tabId);
        if (identity.documentId !== job.documentId) throw new Error("The application page changed. Review before starting again.");
        const states = await observe(job);
        if (!states.length || states.some((s) => !s || s.state === "unknown")) throw new Error("The worker restarted before the page acknowledged the run. Review before retrying.");
        if (states.every((s) => s.state === "done")) { await finish(job, states.map((s) => s.result)); return; }
        await update(job, { state: "waiting_ai", error: "" });
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("The interrupted run exceeded its deadline. Review before retrying.");
    } catch (e) { await update(job, { state: "interrupted", error: e.message }); }
  }
  const ready = (async () => {
    const stored = await storage.get("fillJobs");
    for (const j of (stored.fillJobs || []).slice(-30)) {
      jobs.set(j.runId, j);
      if (!terminal.has(j.state)) void reconcile(j);
    }
  })();
  async function start(tabId) {
    await ready;
    if (pending.has(tabId)) return pending.get(tabId);
    const request = (async () => {
      const identity = await identify(tabId);
      const active = [...jobs.values()].reverse().find((j) => j.tabId === tabId && j.documentId === identity.documentId && !terminal.has(j.state));
      if (active) return { ok: true, runId: active.runId, job: { ...active } };
      const job = { runId: crypto.randomUUID(), tabId, documentId: identity.documentId, state: "preparing", startedAt: clock(), updatedAt: clock(), deadline: clock() + 120000, filled: 0, total: 0, empty: 0, error: "", frames: [] };
      jobs.set(job.runId, job);
      while (jobs.size > 30) { const old = [...jobs.values()].find((j) => terminal.has(j.state)); if (!old) break; jobs.delete(old.runId); }
      await save(); void perform(job);
      return { ok: true, runId: job.runId, job: { ...job } };
    })();
    pending.set(tabId, request);
    try { return await request; } finally { pending.delete(tabId); }
  }
  return { ready, start, get: async (tabId, runId) => { await ready; const j = runId ? jobs.get(runId) : [...jobs.values()].reverse().find((j) => j.tabId === tabId); return j?.tabId === tabId ? { ...j } : null; },
    progress: async (runId, state, detail = "") => { await ready; const j = jobs.get(runId); if (j && ["detecting", "filling", "waiting_ai", "verifying"].includes(state)) await update(j, { state, detail: String(detail).slice(0, 200) }); } };
}
