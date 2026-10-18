import { knowledge } from "./client.js";
import { SETUP_FIELDS } from "./facts.js";
import { currentRecord } from "./retrieve.js";
const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
const button = (label, action) => { const node = text("button", label); node.type = "button"; node.className = "btn btn-secondary"; node.addEventListener("click", async () => { node.disabled = true; try { await action(); } catch (error) { errorBox.textContent = error.message; } finally { node.disabled = false; } }); return node; };
let errorBox;
export function mountKnowledge({ onProfile, notify }) {
  const root = document.createElement("div"); root.className = "card card-pad mt-3"; root.id = "knowledge-panel";
  root.append(text("h2", "Verified knowledge"), text("p", "Keep confirmed facts and application answers here. Resume proposals need your review."));
  errorBox = text("p", ""); errorBox.setAttribute("role", "alert");
  const setup = text("div", ""), proposals = text("div", ""), records = text("div", ""); setup.className = "grid-2 mt-2";
  const search = document.createElement("input"); search.type = "search"; search.className = "form-control"; search.placeholder = "Search saved questions and facts"; search.setAttribute("aria-label", "Search knowledge");
  search.addEventListener("input", () => { for (const row of records.children) row.hidden = !row.textContent.toLowerCase().includes(search.value.toLowerCase()); });
  root.append(button("Ask once: common details", async () => {
    setup.replaceChildren(); const fields = {};
    const state = await knowledge("snapshot");
    for (const [path, label] of SETUP_FIELDS) {
      const wrapper = text("div", ""), labelNode = text("label", label), input = document.createElement("input");
      wrapper.className = "form-group"; labelNode.className = "form-label"; input.className = "form-control";
      input.type = "text"; input.dataset.path = path; input.id = `setup-${path}`; labelNode.htmlFor = input.id;
      input.value = path.startsWith("authorization.") ? "" : Object.values(state.facts).find(f => f.intent === path && f.status === "confirmed")?.value || "";
      wrapper.append(labelNode, input); setup.append(wrapper); fields[path] = input;
    }
    setup.append(button("Save confirmed details", async () => {
      await knowledge("setup", { values: Object.fromEntries(Object.entries(fields).map(([path, input]) => [path, input.value.trim()])) });
      setup.replaceChildren(); await refresh(); notify("Details saved. Time-dependent facts refresh after 90 days."); await onProfile();
    }));
  }), button("Refresh knowledge", refresh), button("Export knowledge", async () => {
    const data = await knowledge("export"), blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "apply-karo-knowledge.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }), errorBox, setup, proposals, search, records);
  document.getElementById("tab-learned").append(root);
  async function refresh() {
    const state = await knowledge("snapshot"); records.replaceChildren();
    if (state.legacy.recoveryProfile) records.append(text("p", "An interrupted update conflicted with newer profile edits. The newer profile was preserved; the interrupted values remain in your knowledge export for review."));
    const pending = Object.values(state.facts).filter(f => f.status === "proposed" && f.dependencies?.resume === state.dependencies.resume && f.dependencies?.profile === state.dependencies.profile);
    showProposals(pending);
    for (const [collection, values] of [["answers", state.answers], ["facts", state.facts]]) {
      for (const record of Object.values(values).filter(r => ["approved", "confirmed", "stale", ...(collection === "answers" ? ["unverified"] : [])].includes(r.status))) {
        const row = text("div", ""); row.className = "mt-2";
        const fresh = collection === "answers" ? currentRecord(record, state.dependencies) : record.status !== "stale" && (!record.refreshAfter || record.refreshAfter > Date.now()) && Object.entries(record.dependencies || {}).every(([k,v]) => state.dependencies[k] === v);
        const label = SETUP_FIELDS.find(([path]) => path === record.intent)?.[1] || record.intent?.split(".").at(-1)?.replace(/([A-Z])/g, " $1");
        row.append(text("strong", record.question || label), text("p", `${record.value} · ${record.context?.section ? record.context.section + " · " : ""}${record.scope?.application || record.scope?.country || "Profile"} · ${fresh ? "current" : "needs review"}`));
        if (collection === "answers" && !fresh) row.append(button("Approve reviewed answer", async () => {
          await knowledge("approve-answer", { id: record.id, revision: record.revision }); await refresh();
        }));
        if (collection === "answers" && record.status === "approved") {
          row.append(button("Edit answer", async () => {
            const editor = document.createElement("textarea"); editor.value = record.value; editor.className = "form-control"; editor.setAttribute("aria-label", "Edit saved answer");
            const save = button("Save reviewed answer", async () => {
              const changed = await knowledge("edit-answer", { id: record.id, revision: record.revision, value: editor.value }); await refresh();
              const undo = button("Undo answer edit", async () => { await knowledge("undo", { token: changed.undoToken }); undo.remove(); await refresh(); }); root.append(undo);
            });
            row.append(editor, save);
          }));
        }
        row.append(button("Delete", async () => {
          const token = await knowledge("delete", { collection, id: record.id, revision: record.revision });
          await refresh(); const undo = button("Undo deletion", async () => { await knowledge("undo", { token }); undo.remove(); await refresh(); }); root.append(undo);
        })); records.append(row);
      }
    }
    if (!records.childElementCount) records.append(text("p", "No confirmed knowledge yet. Your original profile and legacy backup are preserved."));
    search.dispatchEvent(new Event("input"));
  }
  function showProposals(rows) {
    proposals.replaceChildren(); if (!rows.length) return;
    proposals.append(text("h3", "Review resume proposals"), text("p", "Select facts to confirm. Existing values are shown when they conflict; nothing changes until you confirm."));
    const choices = [];
    for (const row of rows) {
      const label = text("label", ""), input = document.createElement("input"); input.type = "checkbox"; input.dataset.proposal = row.id;
      label.append(input, document.createTextNode(`${row.intent}: ${row.value}${row.conflict !== null ? ` (existing: ${row.conflict})` : ""}`));
      proposals.append(label); choices.push({ row, input });
    }
    proposals.append(button("Confirm selected facts", async () => {
      const selected = choices.filter(c => c.input.checked).map(c => ({ id: c.row.id, revision: c.row.revision }));
      if (!selected.length) throw new Error("Select at least one fact to confirm.");
      await knowledge("confirm-proposals", { records: selected }); await onProfile(); await refresh(); notify("Selected resume facts confirmed.");
    }));
  }
  refresh().catch(error => { errorBox.textContent = error.message; });
  return { refresh, showProposals };
}
