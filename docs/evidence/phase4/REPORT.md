# Phase 4: shared AI-assisted resolver

Engineering implemented and locally verified on 7 October 2026. Live provider/ATS acceptance and human prose/timing acceptance remain open. Prior phase evidence is preserved.

## Behavior

Every scanned descriptor receives a shared resolution decision before an answer is written. The same deterministic resolver is used by normal filling and the worker facade used by bulk/inline AI. Rules propose mappings; incompatible mappings are rejected before the auction so a college-city question cannot consume the personal-city answer. A page heading of “Employment application” is no longer mistaken for a work-history section.

Confirmed profile values, exact application-scoped approved answers and supported typed setup facts are reused without a model request. The resolver checks the complete question, entity/section, negation, country, compensation currency/period and temporal scope. It rejects unsupported declarations and ambiguous transformations instead of guessing. Supported formatting includes derived full names, phone codes, date years, explicit current-job booleans and clear/curated option mappings. Compensation is not converted, facts are not truncated to fit, and a current employer requires an explicit current-job fact.

Ambiguous fields use batches of at most eight, with at most eight compatible profile candidates, four scoped memory candidates per field and eight relevant evidence spans per batch. The model returns structured decisions keyed by field ID/revision, source IDs and option IDs. Unknown IDs, stale revisions, duplicates, unexpected keys, invalid claim shapes and unsupported fact/option selections are rejected locally. The index-based `answers` response remains only a compatibility view computed by the worker; the current engine consumes stable IDs.

Semantic memory reuse is limited to matching application context and unchanged source wording in prose drafts. It does not establish cross-site factual equivalence. Resume prose requires exact source quotes and supported claim text, permitting whitespace normalization and candidate-name-to-I substitution. All prose drafts require review and are never automatically approved as answer memory. Unsupported claims stay blank. Human relevance and editing effort are distinct acceptance criteria.

Caches use SHA-256 fingerprints including descriptor/options, application context, knowledge dependencies/record changes, profile, current resume text, selected provider/model, instructions, job context and prompt revision. Entries are bounded to 128 and ten minutes; cached prose is revalidated against current evidence. Explicit inline generation bypasses the cache. Worker responses are deferred when profile/resume/answer dependencies change during a request.

AI runs share a 120-second deadline, 16 request attempts and a conservative 100,000 estimated-token reservation budget across content-side chunks. Each request has a 30-second ceiling and 2,048 output-token cap. A batch gets at most one retry for schema/transient network failures; abstention, quota and authentication failures do not force more requests. Cancellation aborts pending requests, and deadline/cancellation remains bounded even when a synthetic transport ignores abort. Earlier successful batches remain available when later work is deferred. Estimated token accounting is a limit, not a measurement of provider billing.

Autofill uses current stored resume text and never spends a PDF-parsing request merely to fill known facts. After changing a PDF, extract or paste the current text in the dashboard. Stale resume text cannot ground a draft. The existing parser also avoids saving an old result over a newer resume. API keys remain in the worker, the explicitly selected model remains selected, and final submission remains manual.

## Local evidence

| Check | Result |
|---|---|
| Unit suite | 925 passing checks, including 84 Phase 4 assertions |
| Phase 4 worker/held-out checks | 13/13 |
| Existing held-out templates | 9 templates, 225 observations, 198 answerable |
| Factual decisions approved | 142; all 142 equal gold answers |
| Factual decision precision | 100% (142/142) |
| Answerable decision coverage | 71.7% (142/198); 56 answerable observations withheld |
| Unsupported safety answers in held-out set | 0 |
| Phase 3 knowledge/storage browser checks | 46/46 |
| Scoped extension regressions | 25/25, including inline AI and all 81 prose fields |
| Form/control browser checks | 41/41 |
| Existing module contracts | 6/6 |
| Actual worker termination scenarios | 2/2 |
| Package check | 57 files; every packaged file equals source |

The held-out templates were defined in Phase 0 and now serve as a regression set. They are correlated observations across 25 authored intent rows, not a fresh independent live-employer sample. The precision result measures approved resolver decisions, not DOM/server acceptance. Frozen details are in [results.json](results.json), [regression.json](regression.json), [knowledge-regression.json](knowledge-regression.json), [lifecycle.json](lifecycle.json), [unit.txt](unit.txt) and [package.json](package.json).

The older broad corpus directly exercises scanner/rules/filler rather than the new resolver. It remains 367/440 correct answerable fields (83.4%), with one delayed text-field false-success. F13 custom-widget correction learning remains recorded as failing and is explicitly excluded from the scoped regression gate. The overall strict acceptance gate remains open; these older results must not be presented as the new resolver's coverage or precision.

Fresh headless Edge profiles, real unpacked-extension messaging/IndexedDB and local synthetic provider responses were used. No live provider calls, real applications, user-browser profiles, submissions or store uploads were used. The provider capability checks validate local request shapes, not live model compliance. Structured output guides informed the transport contracts: [Gemini](https://ai.google.dev/gemini-api/docs/structured-output) and [Groq](https://console.groq.com/docs/structured-outputs), checked on 7 October 2026. Local source/claim validation remains necessary regardless of schema mode.

## Package

- Archive: `dist/apply-karo-2.1.0.zip`, local build only; existing version retained.
- Archive SHA-256: `92dff32afd2c4b183ca0ab3c501e92e075d98a2498322db0c42f4a842ab8e368`.
- Engine bundle SHA-256: `d81efa41ffa83116663365a89171442e065773c15c5db9356a3c8585dd918468`.

Reload the unpacked extension and refresh application tabs. Confirm common facts under Verified knowledge and keep resume text current. Review prose drafts and unresolved fields before submitting manually.

## Acceptance still open

- [ ] Human prose grounding, full-question relevance and necessary-edit rate; use the [review worksheet](HUMAN_REVIEW.md).
- [ ] Live selected-provider/model requests and multiple real ATS/Workday employer templates.
- [ ] Phase 5: canonical write verification, dynamic workflow completion and general control acceptance.
- [ ] Phase 6: consolidated missing-fact review, broad semantic memory confirmation and custom-widget correction capture.
- [ ] Review-plus-correction timing demonstrating 90% reduced total filling time.
