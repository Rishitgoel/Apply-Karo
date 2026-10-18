# Phase 3: verified knowledge and scoped answer memory

Measured 7 October 2026. Engineering implemented and locally verified. Live extraction/ATS acceptance and the 90% time-saving target remain open.

## What changed

The service worker owns an extension-origin IndexedDB repository with versioned Fact, Evidence and ApprovedAnswer collections. Every new approved answer retains the original question, section/entity context, choices, application URL and visible application identity, explicit scope, provenance, timestamps, record revision, expiry and dependency digests. Transactions apply incremental operations to current data; optimistic revision checks reject stale writes. Revisions remain monotonic across deletion/undo to reject older edits.

Native trusted manual corrections are saved promptly through worker messages. Content scripts no longer save whole learned/profile snapshots on page exit. Dashboard profile edits send changed paths with their previous values, preserving unrelated concurrent updates. Existing correction-demotion writes are merged centrally. A committed knowledge update has a recoverable compatibility-profile projection: interruption is repaired on the next operation; conflicting newer profile data is preserved and the interrupted values remain in the exported recovery namespace.

Resume extraction now proposes facts for a selected-fact confirmation view. Existing values appear beside conflicts; neither extraction nor proposal creation replaces them. Facts retain available source offsets and resume evidence references. Normalized facts absent verbatim from the source have a null span, rather than invented evidence. Source paragraphs are stored as project/story evidence; this is source-span retrieval groundwork, not an AI assessment that every generated story is grounded. Changes to the resume or profile invalidate outstanding proposals. Confirmed resume facts retain provenance, while their source freshness can later require review.

**Ask once: common details** collects address, location preferences, notice/start date, compensation amount/currency/period, country-specific authorization/sponsorship and disclosure preference. Incomplete compensation units or jurisdiction-free authorization are rejected. Time-dependent facts have an as-of date and 90-day refresh policy. Contact updates project into the profile; simple authorization questions use matching confirmed country facts. Compound/negative questions abstain unless their full question has an approved answer. Countries outside the initial five-country question vocabulary require an exact reviewed answer or later resolver support. Ask/skip disclosure preferences exclude automatic sensitive fills; “use confirmed” still respects the sensitive-field setting.

Unicode exact and lexical retrieval filters scope, section/entity, choices, units, country/company/polarity context, visible application identity, expiry and dependencies. Only one exact current match may fill automatically. Approximate candidates are never automatic answers; critical/negative questions exclude approximate retrieval. Profile, resume binary/text or stored-job changes conservatively invalidate dependent answers. A visible application title/employer/role change also prevents reuse. No model request is needed for an exact approved answer.

Legacy migration is repeatable and preserves the original profile/learned/trust/correction backup in a separate namespace. Provenance-free migrated records remain unverified. Existing user-confirmed personal-contact compatibility remains available; unscoped contextual legacy answers no longer override the new scoped answer path. Existing profile rule values remain a compatibility layer, not a claim that every old field has verified resume provenance. General all-field resolution is Phase 4.

Knowledge records support export, revision-checked deletion and undo. Full dashboard backups include knowledge alongside the old format. Imported records are quarantined; scoped answers can be explicitly reviewed and approved. Matching existing approvals must be resolved before import approval. Facts imported without local confirmation remain unverified. Deleting a knowledge fact removes its record; personal-profile values are edited separately in Personal info. Reset clears the knowledge repository as well as extension storage.

The repository uses one transactional state record containing the collections, suitable for this local single-user database. It performs exact/lexical scans rather than embeddings or a remote database. It follows [IndexedDB transaction completion](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) and [extension-origin storage behavior](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies). Browser shutdown durability beyond acknowledged transactions and broader migration/recovery scenarios remain acceptance work.

## Verification

| Check | Result | Evidence / reproduce |
| --- | --- | --- |
| Unit suite | 841 assertions passed; 45 new Phase 3 assertions | `node test/eval/unit.mjs` |
| Phase 3 browser gate | 46/46 checks passed using the actual unpacked extension and real IndexedDB | `node test/eval/phase3.mjs`, [results.json](results.json) |
| Earlier scoped gate | 6/6 contracts, 24/24 scoped extension cases and 41/41 Phase 2 control checks passed | `node test/eval/run.mjs --phase2`, [regression.json](regression.json) |
| Actual worker-stop regression | 2/2 passed; Phase 3 additionally verifies knowledge/migration survive a stopped worker | `node test/eval/lifecycle.mjs`, [lifecycle.json](lifecycle.json) |
| Package | 49 files; every ZIP entry equals source, all seven knowledge modules included, measured engine matches ZIP | `node build.mjs`, [package.json](package.json) |
| Syntax / whitespace | Changed entry points parse and `git diff --check` passes | `node --check background.js`, `options.js` |
| Dashboard | Loads without page errors; saves an initially absent profile field; setup screenshot visually reviewed | [dashboard.png](dashboard.png) |

Browser checks cover repeated migration, original backup retention, concurrent profile patches, conflicting stale updates, country/unit validation, proposal conflict/confirmation, stale-resume rejection, two-tab native corrections, explicit approval metadata, export without API credentials, delete/undo, imported-answer quarantine/reapproval, the 15-field setup UI, profile/resume/job invalidation, simple India authorization reuse versus US/compound abstention, projection interruption/conflict and worker restart persistence. Unit adversarial checks cover country, company, entity, section, application, polarity, units, choices, application identity, dependency and expiry mismatches.

Fresh headless Edge test profiles were used. New knowledge tests block live provider transport and supply synthetic extraction output. They prove the proposal/confirmation/storage behavior, not real resume-model extraction quality. Older extension scenarios use local fake model responses. No user applications were submitted, no store upload was performed, and existing dirty changes were preserved.

The broader corpus remains 367/440 correct answerable fields (83.4%), 500/500 complete questions and one delayed text-field false-success. F13 custom-widget correction learning remains recorded as failing. Phase 3 does not establish an overall accuracy or timing improvement. Phase 2's scoped gate excludes F13 explicitly; the full strict acceptance gate remains open.

## Remaining work

- [ ] Phase 4: shared all-field resolver, semantic cross-site memory matching, typed compensation/availability formatting and stronger claim grounding.
- [ ] Phases 5–6: general post-render verification, custom-widget correction capture, stable semantic entity reconciliation and consolidated missing-fact review.
- [ ] Live BYOK resume extraction, real Workday/employer templates and native toolbar acceptance.
- [ ] Full imported-fact confirmation UX and wider crash/migration/large-database acceptance.
- [ ] Human review/correction timing demonstrating 90% reduced filling time.

## Try it

Reload the unpacked extension and refresh application tabs. Open **Learned answers → Verified knowledge** for setup and record review. Use **Resume & AI → Fill profile from resume**, then select and confirm the proposed facts. Review unresolved fields and drafts before manually submitting. The local archive is `dist/apply-karo-2.1.0.zip`; extract it before Load unpacked. This retains the existing version and is not a published release.
