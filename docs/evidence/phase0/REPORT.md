# Phase 0 baseline — 7 October 2026

The engineering baseline is implemented. This milestone establishes reproducible failures and observation tools; it does not fix the autofill defects or demonstrate the 90% time-saving target. See [baseline.json](baseline.json) for the measured results, per-field answers, tuning/held-out splits, browser version and source-bundle hash.

## Delivered

- A replay harness using the actual scanner, rules, profile formatters and writers: 20 structural variants, 500 gold observations, 440 answerable fields, 25 authored intent rows. These observations are correlated, not 500 independent questions.
- Native, Google/Greenhouse/Lever/Ashby-style markup, six Workday-style variants, repeated employment entities, delayed/search/virtualized/dependent options, an open shadow root, an iframe and a value that clears after replacement.
- Whole-template tuning/held-out splits and ten adversarial question pairs. The pairs are authored retrieval fixtures; their presence does not establish that semantic retrieval works.
- Desired-contract probes for question extraction, memory identity, unknown-fact retries and confidence, plus actual unpacked-extension integration scenarios with local provider fakes.
- An opt-in diagnostics ring with anonymous field IDs, frame role, control kind, extraction signal, run-relative timings, stages and reason codes. No question, answer, URL, selector, profile or credential is retained. Bounded at 400 events per frame; drops are counted. Disabling clears observations in open pages. Export is available in the toolbar popup.
- A manual timing CSV and protocol. No human times have been invented.

## Baseline results

| Measurement | Result |
| --- | --- |
| Eligible fields detected | 500 / 500 (100%) |
| Full extracted question matches gold | 466 / 500 (93.2%) |
| Correct values among answerable fields | 320 / 440 (72.7%) |
| Correct values among all nonempty writes | 320 / 330 (97.0%) |
| Reported successful writes that clear afterward | 1 |
| Correct answerable Workday-style fields | 87 / 132 (65.9%) |
| Unexpected submissions | 0 |

Question matching uses normalized complete-string equality; this is stricter than a human semantic comparison. Detection recall reflects this authored corpus, not arbitrary sites. The deterministic replay does not use AI. Its precision and coverage therefore cannot be used as model-quality measurements.

Known desired contracts remain failing, including toolbar cold/warm starts, delayed startup, popup-tab closure, repeated starts, unapproved AI memory, sensitive-field provider access, overwriting an in-flight edit, stale inline questions, the 80-field cap, absent-context worker fallback and custom-widget correction learning. Module probes also expose missing confidence becoming certainty, truncated/Unicode/section key collisions, incomplete accessible names and forced retries for unknown facts. Per-field rows expose additional mapping and option-write failures. Later phases must make these contracts pass without changing the gold answers to match defects.

The toolbar has a concrete message-envelope defect: `tab_action` passes its remaining incoming properties to `fanOut`; `fanOut` spreads those properties after `type: action`, so the incoming `type: "tab_action"` overwrites `"rf_fill"`. The engine listens for `rf_fill`. The on-page panel calls its own frame's run directly, which explains the observed difference on these fixtures. Phase 1 must fix and unify execution, readiness and progress. Phase 0 preserves this failure; only the new observation-only diagnostics action keeps its action type intact so diagnostics can be exported.

The missing-result deadline test explicitly injects an acknowledgement to isolate result loss from that envelope defect. It fails the 12-second test deadline; the production ceiling is 120 seconds. This is not a measurement of ordinary provider latency.

## Verification

- `node test/eval/unit.mjs`: **707 / 707 assertions passed** across 13 suites, including the existing 687 assertions and 20 new diagnostics/corpus assertions.
- `node test/eval/run.mjs --strict`: harness finishes and writes evidence; **exit 1 is expected**, because desired quality/contracts gates remain failing. The measurement command without `--strict` reports the same failures but exits successfully when measurement completes.
- Actual unpacked extension loaded in installed Edge, fresh temporary profile, with local synthetic forms and mocked provider fetches. Neither a user's browser profile nor a live model was used.
- Diagnostics integration probes confirm exported events exist, synthetic identifying strings are absent, and opt-out clears the ring.
- Engine bundle rebuilt from current sources by the runner; bundle syntax/boot and source equivalence covered by the existing suite.

Use `npm test`, `npm run eval:phase0`, `npm run eval:contracts` and `npm run eval:strict` to repeat the checks. See [harness instructions](../../../test/eval/README.md).

## Acceptance still open

Native toolbar dismissal/focus behavior, live Workday employer variants, live provider availability/quality, worker restart, cross-context stale-memory races and partial-provider failures require broader acceptance. The integration popup is an extension tab with active-tab lookup pinned to the target; the form is brought forward after clicking to avoid hiding it artificially. Closing that test tab exercises the popup code's lifetime, not every native popup lifecycle detail.

Paired manual/assisted timing remains unchecked. Use [timing-template.csv](../../../test/eval/timing-template.csv), count waiting, corrections and review, and keep final submission manual. A fresh sealed held-out corpus is required before release because this initial baseline has been inspected. No live ATS support or 90% reduction is claimed.
