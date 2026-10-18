# Phase 1: execution reliability and answer safeguards

Measured 7 October 2026. Engineering implemented; local gates passed. Live release acceptance remains open.

## What changed

Toolbar Fill, Alt+Shift+F and the page panel use one worker-owned `start_fill` job. The worker prepares every permitted frame, waits for an explicit engine-ready acknowledgement and returns a run ID before filling completes. Popup closure no longer owns or cancels the execution. The UI observes Preparing, Detecting, Filling, Waiting for AI, Checking, Completed or Needs attention states.

The reproduced toolbar defect was an envelope overwrite: spreading the incoming `type: tab_action` over `type: rf_fill` delivered the wrong message to the engine. The coordinator now constructs the action envelope in the correct order. It validates frame/document identities, deduplicates results, reports thrown runs, and bounds lost-result waits. Content heartbeats allow long model requests to proceed within the overall deadline.

Minimal job metadata lives in extension session storage. Repeated starts share the current tab/document job. After worker termination, recovery observes cached content results; it never replays a write whose outcome is unknown. Navigation during preparation prevents dispatch to the replacement document. This is bounded recovery, not a guarantee that every interrupted model request completes.

AI output no longer automatically becomes trusted memory. Existing learned/custom entries without confirmation are preserved in storage and backups, excluded from reuse, and listed for explicit review in Settings. Confirmation is bound to the exact saved value. Editing other profile values cannot silently approve unchanged legacy answers. Backups currently omit confirmation metadata: restored answers require review again. Scoped transactional knowledge storage remains Phase 3.

Rules, memory lookup, bulk AI and inline AI share the sensitive-field policy. Unknown consent, driver’s-license status, criminal history, work authorization, sponsorship, citizenship, relocation and availability no longer receive rule fallback guesses. AI uses stored profile/resume data, typed answer statuses and source references. Missing or invalid confidence is unknown, never certainty. Contradictory forced-answer retries are removed. Exact facts require compatible source paths and unchanged values; unsupported answers abstain. Prose remains a reviewable draft even with a valid evidence reference: references do not establish that every generated claim follows from them.

Inline buttons resolve the current field/question at click time and again before writing. Value/event/question/document guards preserve edits made while generating. Undo preserves a later edit and explains why it cannot restore older text. Bulk and inline requests use the same worker validation facade and the selected BYOK provider. Missing page context no longer imports an unrelated stored job.

New Gemini configurations use `gemini-3.8-flash`. Existing explicit model selections remain unchanged. Known retired Gemini families and incompatible model names produce actionable health errors rather than a chain of retired fallbacks. Suggestions were refreshed from [Google's model lifecycle documentation](https://ai.google.dev/gemini-api/docs/deprecations/) and [Groq's model list](https://console.groq.com/docs/models). Custom model IDs remain available; local configuration validation does not prove account access or live availability. Recovery follows Chrome's [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) and uses session storage across worker restarts.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Unit checks | 760 assertions passed, including 53 Phase 1 assertions | `node test/eval/unit.mjs` |
| Scoped Phase 1 browser gate | 23/23 extension cases and 2/2 module contracts passed | [results.json](results.json), `node test/eval/run.mjs --phase1` |
| Actual worker termination | 2/2 passed; DevTools observed stopped workers | [lifecycle.json](lifecycle.json), `node test/eval/lifecycle.mjs` |
| Package | 37 files; every packaged file equals current source, including the rebuilt engine and three new modules | [package.json](package.json), `node build.mjs` and ZIP byte comparisons |
| Syntax / whitespace | Changed entry-point syntax checks and `git diff --check` passed | `node --check options.js`, `popup.js`, `background.js` |
| Corpus submissions | 0 across 20 structural fixtures | [results.json](results.json) |

Browser coverage includes cold/warm toolbar starts, on-page parity, popup-tab closure, delayed injection, repeated clicks, permitted embedded frames, claimed-frame exceptions and retry after failure, bounded lost results, sensitive exclusions, no automatic AI memory promotion, legacy quarantine/confirmation/reuse, fresh inline questions, supported drafts, in-flight edit protection, undo protection, unknown declarations and absent-context isolation. Provider responses are local fakes; no live model requests were made. Popup UI is rendered in an extension tab with the active-tab lookup pinned to the fixture; native toolbar focus/dismissal is not claimed.

The worker lifecycle test stops actual workers in a fresh browser profile. One case simulates a lost persisted completion after the content run finished; recovery reports the cached result. The second substitutes an unknown run ID and verifies interruption without replaying a write over a subsequent edit. Unit checks cover navigation during preparation, deduplication and late progress. These are specific cases, not comprehensive suspension/long-running-provider acceptance.

Changes were made in the existing dirty checkout without resetting other work. No commit, publication or store upload was performed. Bundle and package SHA-256 values identify the measured implementation; the final Settings notice refresh is syntax/package checked, while the browser measurement uses the same engine bundle.

## Baseline comparison and remaining defects

Phase 0's original 16 extension scenarios had 3 passing cases. After Phase 1, 14/16 pass; the remaining failures are the 80-field AI cap and custom-widget correction learning. Additional positive/safety cases bring the browser suite to 25 cases; the scoped Phase 1 gate excludes those two later-phase failures explicitly. Original unknown-answer and confidence module contracts now pass. Four question/key-identity contracts remain red.

The deterministic corpus remains **320/440 correct answerable fields (72.7%)**, **466/500 complete questions (93.2%)**, **87/132 correct Workday-style fields (65.9%)**, and **one delayed false-success write**. This replay exercises scanner/rules/filler directly, not AI quality. Phase 1 does not establish improved overall coverage or the 90% time-saving target. The full strict gate remains unsatisfied; scoped success must not hide these failures.

- [ ] Phase 2: complete multipart questions, Unicode/section identities, option discovery and early Workday dropdown coverage.
- [ ] Phase 3: scoped approved-answer knowledge, resume freshness/provenance and transactional correction writes.
- [ ] Phases 4–6: stronger semantic grounding, all-field resolution, post-render value verification, dynamic widgets and consolidated review.
- [ ] Native toolbar popup interaction and restricted/related-frame acceptance.
- [ ] Real provider/account/model responses using synthetic personal data.
- [ ] Live Workday/other ATS pages and measured human review/correction time.

## Try the updated extension

1. Reload this unpacked extension at `chrome://extensions`, then refresh any application tabs that still contain the old engine.
2. In Dashboard → Settings, review legacy answers and confirm only the values you want reused. Unconfirmed originals remain available.
3. If your explicitly selected model is retired, choose a replacement in the model field and use the existing Test action with your own key. The extension does not silently replace that selection.
4. Use toolbar Fill or the page panel. Review amber AI drafts and unresolved fields, then submit manually. Workday dropdown improvements are the next phase.

The installable archive is `dist/apply-karo-2.1.0.zip`; extract it before choosing Load unpacked. The existing checkout can also be loaded directly. Packaging retains the current project version; this is a local build, not a published release.
