# Phase 7: release tooling implemented, acceptance still open

Engineering work is implemented. **Public release and the 90% time-saving claim are not approved by these results.** The overall coverage gate remains below 95% when inaccessible forms are included. No live provider check or human paired trial has been completed.

## What changed

- Release controls expose stable, 10% pilot and paused modes plus descriptor/resolver/adapter flags. Disabling any required component pauses the whole pipeline without restoring legacy guessing. Pausing cancels active worker resolution and stops subsequent writes/navigation. Existing profile, verified knowledge and backups remain intact. Ordinary preference changes preserve release controls, even from an older UI snapshot.
- The dashboard synthetic provider probe uses only a fixed fictional profile and resume, the selected provider/model, at most two requests and bounded deadlines. It validates grounded prose, unknown-salary abstention and preservation of known facts when generation fails. It records usage when the provider supplies it; monetary cost remains unknown without a billing rate. Content pages cannot invoke this quota-consuming check.
- The test runner extracts the actual ZIP with path, CRC, size and byte-for-byte source checks, then loads that extracted extension in a fresh Chromium profile. It exercises 42 variants / 1,260 labeled field observations across native, Workday-style, open-shadow, iframe, dynamic, heading-based and inaccessible closed-shadow forms. This is a factorial synthetic stress corpus of 30 questions, not 1,260 independent intents or a representative user workload. It was defined before its first run; after that evaluation it is a regression corpus.
- The broader run reproduced field-heading/section-heading confusion and wrapped dropdown-menu contamination of questions. Explicit enclosing legends now take precedence, and widget/option text is excluded from question extraction. Canonical dropdown readback deduplicates the same selection observed through multiple attributes. Newly opened, previously unknown choices can retain verified review evidence only when question/helper/section/entity remain unchanged and readback still matches.
- Current country-specific authorization/sponsorship facts do not answer historical, lifetime, future-year, past-job or other-person/company questions. Those qualifiers and owners require their own confirmed answer.
- Applicant contact facts are withheld from education/employment record sections. Consolidated missing-answer groups preserve full section, helper, entity, type, units, choices and constraints rather than grouping by short wording alone.
- A paired-trial recorder measures active and elapsed time separately, requires completed review and observer checks, exports measurements, and rejects incomplete or duplicate records. Analysis reports p50/p90, family/maturity breakdowns, setup amortization and bootstrap uncertainty. Unsupported trials stay in the overall calculation. Synthetic timing examples cannot satisfy human acceptance.

## Results and limitations

The frozen JSON reports and `package.json` contain exact counts, hashes, browser version and measured latency. The expected overall-coverage failure remains visible; the evaluation command returns a failing exit code for that gate. It is not excluded to manufacture a release pass.

| Final measurement | Result |
|---|---:|
| Unit checks | 1,112 passed, including 83 Phase 7 assertions |
| Packaged checks | 26/27 passed; overall coverage gate remains failed |
| Variants / labeled observations | 42 / 1,260 |
| Supported discovery / question fidelity | 100% / 100% |
| Observed factual precision | 648/648 correct (100%) |
| Supported answerable coverage | 647/648 accepted (99.85%) |
| Overall answerable coverage | 647/756 accepted (85.58%) |
| False successes / final submissions | 0 / 0 |
| Local runner elapsed p50 / p90 | 5.829s / 6.338s |
| Previous-phase review / controls / resolver / Keka checks | 48 / 56 / 13 / 16 passed |
| Recorder checks | 10 passed; zero human trials |
| Live provider / 90% time-saving measurement | Pending / unmeasured |

The 69-file archive matches current source byte for byte. ZIP SHA-256: `c79a1800d602b5d9f4db3cc9c444f07b6cd10d6ee5924cd85ba9820c29068883`. Bundle SHA-256: `2a32a7668360872e2b3ece810f8d6c57f79f6be5ef9aba50f6940c76fd01501f`.

The next bottlenecks to measure are inaccessible controls, missing or ambiguous facts, unfamiliar wording, company-specific prose and user review/correction time. This corpus's known labels and fictional facts do not establish performance on arbitrary new questions.

Supported surface discovery and question fidelity are measured separately from overall coverage. Inaccessible closed roots contribute 180 unanswered observations, including 108 otherwise answerable fields, to the overall denominator. A deliberately integer-only GPA control remains a validation refusal; the extension does not round a confirmed GPA to invent an acceptable value.

The first run is retained in `first-run.json`. Its initial apparent dropdown precision failures included duplicate readback representations, and its generic numeric GPA controls unintentionally used integer steps. Decimal controls are now authored with `step="any"`, with one explicit contradictory integer-only GPA retained as a rejection test. This fixture correction is separate from the production fixes and is not evidence of improved live ATS coverage.

`extension.json` is the packaged corpus and release-control evidence. `review.json`, `controls.json`, `resolver.json` and `select2.json` record the previous-phase regressions on the current bundle. `tools.json` verifies the recorder UI, including narrow-screen layout; it represents zero human trials. `live.json` records the pending provider check. `timing.json` records zero completed paired trials and null timing estimates. Unit results are in `unit.txt`.

Local browser elapsed time includes coordination, review retrieval and read-only observation. It is not human active time or live model latency. Offline/mocked tests do not measure live cost, model quality, physical browser-popup dismissal, server-side ATS acceptance or the 90% objective. Ordinary DOM APIs cannot inspect the closed-root fixture's hidden values; that surface is reported as unsupported.

## Complete the open acceptance work

The user selected an even workload: **10 Workday, 10 Keka and 10 other-form paired trials**, with matched variants and counterbalanced order. Follow [the trial protocol](TRIAL_PROTOCOL.md). `trials.json` intentionally contains no invented measurements.

For a live provider probe, reload the extension and application page, then use **Settings → Release controls → Run synthetic provider check** with the existing selected key/model. The available browser connection exposes only Codex's in-app browser, so the configured user extension/key was not accessible here. Alternatively, set `AUTOFILL_LIVE_PROVIDER`, `AUTOFILL_LIVE_MODEL` and the selected provider's `GROQ_API_KEY` or `GEMINI_API_KEY` in a local environment, then run `npm run eval:phase7-live`. Do not paste keys into issue reports or chat.

The probe follows the providers' structured-output contracts and still validates responses locally: [Google structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [Groq structured outputs](https://console.groq.com/docs/structured-outputs). A passed small probe confirms that particular configured model/request worked; it does not establish broad answer quality.

Run:

```text
npm test
npm run build
npm run eval:phase7
npm run eval:phase7-tools
npm run eval:phase6
npm run eval:phase5
npm run eval:phase4
node test/eval/reported-form.mjs --keka
npm run eval:phase7-live
npm run eval:phase7-trials -- path/to/exported-trials.json
node test/eval/package-phase7.mjs
```

The package is for local review/testing. Do not publish it as a broadly validated 90% release until the coverage, live/provider and human acceptance gates pass. Pausing preserves the new knowledge namespace; rollback never copies stale legacy guesses over newer records.
