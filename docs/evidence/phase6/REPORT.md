# Phase 6 engineering evidence

Phase 6 adds field-by-field review and scoped correction learning. Engineering verification uses synthetic profiles and local fixtures; no user resume was sent to a provider and no job application was submitted.

The panel and toolbar open a review list with Verified facts, Drafts to review, Missing facts and Could not fill. Rows show the full question, value, source, transformations and reason. Row actions focus the owning control, including embedded frames. Existing values remain drafts until reviewed; native validity failures and policy exclusions are explained separately. Visible empty controls without a supported descriptor are listed as unsupported.

Equivalent missing questions with matching section, entity and choices can be answered once. Batch confirmation saves only explicitly selected, reviewed answers. Common profile facts, country-specific work eligibility, compensation units and availability remain in the existing common-details setup and resume-proposal confirmation flow. Refreshing review shows changed source facts as needing review; it does not silently replace existing application values.

“Use for this application” is the default. “Remember for similar questions” enables reuse of an explicit allowlist of literal personal questions (name, contact details, location and profile links). Section/entity, country, polarity, units, options, dependency freshness and expiry still apply. Broader semantic equivalence and employer-wide reuse are intentionally not automatic. Company-specific answers stay within the application. The worker rejects broader scope requests for unsafe questions before approval.

Trusted native changes and custom-widget pointer/keyboard selections are read through the control adapter. Synthetic events and extension-authored pointer actions never approve generated answers. Menu teardown is permitted during readback only when the question, helper text, section and entity remain unchanged and the selected value is actually observable. A phone-number replacement changes the answer, rather than demoting the phone intent. Explicit “Wrong field mapping” records a mapping correction instead.

Source undo guards DOM writes and saved approvals against later edits and record revisions. Saved-answer edits, deletions and deletion undo are available in searchable dashboard knowledge. Issue reports redact question text, answers and page ownership by default; the user can explicitly include question text and/or answers. These reports describe field outcomes; they do not include credentials, resumes or browsing history.

Validation artifacts are frozen alongside this report:

Final gates: **1,029 unit assertions, 48 extension integration checks, 46 knowledge checks, 13 resolver checks, 56 control checks and 16 Keka reconstruction checks passed**. The 65-file archive matches source byte for byte. ZIP SHA-256: `514acefd87de9b29306049d33477f6d0e25e9a46be8e94b83af86791f03bd5dc`. Bundle SHA-256: `9fdec686fc23ee81a0f1d896374491f6a2736f19284a58eb882081445597c5e7`.

- `unit.txt`: the complete unit suite, including scope, near-match, correction classification, optimistic concurrency, source undo and redaction checks.
- `extension.json`: real unpacked extension with local forms and mocked providers. Includes native-toolbar simulation, four review states, focus, confirmation/undo, child-frame routing, draft review, custom correction persistence/reload, meaning-changing abstention, menu teardown, consolidated missing answers, redacted download and dashboard search/edit/delete/undo. The earlier F13 failure is included and passes; it is no longer excluded.
- `knowledge.json`: real IndexedDB migration, concurrent edits, profile projection, imports, dependency invalidation and worker restart regression checks.
- `resolver.json`: 13 worker/resolver checks; 142/142 approved factual decisions correct over the existing 225-field fixture set, with 142/198 answerable coverage (71.7%). This is regression evidence, not a new held-out accuracy claim.
- `controls.json`: 56 checks, including 22/22 supported verified control attempts, delayed rejection, user edits, repeated entities and submission boundaries.
- `select2-reconstruction.json`: 16 checks on the previously reported Keka layout reconstructed locally. This is not live Keka acceptance.
- `review.png`: visual inspection of the synthetic review panel.
- `package.json`: archive SHA-256, bundle SHA-256, counts and byte-for-byte packaged/source comparison. The new review and learning modules must be present.

Run `npm test`, `npm run eval:phase6`, `npm run eval:phase3`, `npm run eval:phase4`, `npm run eval:phase5`, `node test/eval/reported-form.mjs --keka`, then `npm run build`. Packaging evidence checks that browser gates use the bundle in the archive.

Human usability, error detection and time saving remain **unverified**. Use [the trial worksheet](USABILITY_TRIAL.md) for matched manual/assisted forms and intentionally seeded errors. Live employers, native toolbar dismissal, real provider quality and closed/inaccessible surfaces also remain open. The broad legacy low-level corpus has separate historical failures; these focused engineering gates do not relabel it as passing.
