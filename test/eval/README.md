# Phase 0 quality baseline

Run `npm ci` for the pinned Playwright dependency. An existing Codex bundled Playwright can also be used; `PLAYWRIGHT_MODULE_DIR` selects an explicit package directory. On Windows the default browser is installed Edge in a fresh temporary profile. Set `AUTOFILL_BROWSER_CHANNEL` or `AUTOFILL_BROWSER_PATH` for another extension-capable Chromium build. Chromium/Chrome builds that disable unpacked-extension command-line loading cannot run the extension scenarios.

```powershell
npm test
npm run eval:phase0
npm run eval:contracts
npm run eval:strict
```

`npm test` runs the existing suites plus diagnostics and fixture-integrity tests. `eval:phase0` is a measurement command: it writes actual failing contracts and metrics, and succeeds only when the harness itself finishes. It does **not** mean product acceptance passed. `eval:contracts` exits 1 while the known desired module contracts fail. `eval:strict` applies desired coverage/fidelity/contracts gates and is expected to fail before remediation.

Generated reports live in `test/eval/output/`. `phase0.json` includes per-field results, aggregate/family/tuning/held-out metrics, contract probes and extension scenarios. `corpus.json` and `extension-progress.json` preserve partial measurements if a later harness step errors. Reports use only the synthetic fixture profile. Screenshots are synthetic too. They are ignored by git; durable milestone evidence is copied to `docs/evidence/phase0/`.

The corpus contains 25 authored question/intent rows replayed through 20 markup variants: **500 correlated observations**, not 500 independent questions. Browser evaluation uses the real scanner, matcher, profile formatter and control writers. Gold data is maintained in the runner and every eligible gold question remains in the denominator even if the scanner misses it. No AI is used in the corpus: this establishes deterministic-path quality before comparing the future resolver. Three rows deliberately lack known answers; any automatic answer to these is incorrect for this baseline.

Whole templates, not rows, are assigned to tuning/held-out splits. The initial baseline necessarily inspects all results to identify defects; future tuning should use only the tuning split, with a new sealed holdout added before release to avoid repeated-test leakage. Native, Google, Greenhouse/Lever/Ashby and Workday forms are **structural simulations**, not captured live forms or claims of complete platform support.

Extension scenarios load the actual manifest, service worker and generated bundle in isolated-world content scripts. Provider responses are intercepted locally; no request goes to Gemini/Groq. The popup is rendered as an extension tab, with its active-tab lookup pinned to the fixture form. Actual tabs messaging and worker behavior remain real, but native browser-action popup dismissal/focus semantics need a separate manual/native-toolbar acceptance check.

The initial harness records question loss, memory identity collisions, absent confidence becoming certainty, retries of unknown facts, cold/warm toolbar execution, custom controls, unconfirmed AI memory, sensitive-policy bypass, inline edits/DOM reuse, field limits, stale job context and missing results. Known failures stay red; they are not assertions that the buggy output is desirable. Later phases must turn the same contracts green.

Local diagnostics can be enabled in Dashboard settings. The toolbar popup then offers an export. Only stage, elapsed time, anonymous frame-local field ID, control kind, extraction signal and allowlisted reason/outcome are retained. No questions, values, selectors, URLs, profile data or credentials are accepted into the ring. The ring holds at most 400 events per frame and reports dropped events; reload clears it. `write_reported` and `observed_nonempty` are observations, not proof of semantic correctness. No `reviewed` state is inferred from lack of edits.

Manual timing remains pending. For at least 30 representative paired trials, record manual time and assisted time including missing facts, corrections, review and model waiting. Separate initial profile setup, then also show setup amortized over 10/30 applications. See the implementation plan for quality gates and the 90% formula. This baseline does not establish live ATS correctness, live model accuracy or the requested time saving.

Use `timing-template.csv` for the pending trials. Start at the first form action and stop when every field has been reviewed, before submission. Record active, waiting and review periods without overlap. Alternate which method runs first on matched variants. Report `(manual total - assisted total) / manual total`, including corrections and unresolved fields, both overall and per platform. Leave unmeasured rows empty.

The replay command rebuilds the engine and records its SHA-256 hash. The repeated Workday fixture has two employment groups with different employer gold answers. Missing-result tests inject an acknowledgement explicitly because the existing coordinator overwrites the outgoing action type with its incoming envelope type; that deadline probe is separate from a normal successful fill.
