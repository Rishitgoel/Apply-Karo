# Phase 5: verify control writes and dynamic workflows

Engineering implemented and locally verified on 7 October 2026. The supported-control fixture gate is separate from live ATS acceptance, server acceptance and the 90% time-saving target. Earlier frozen phase reports are preserved.

## Behavior

The fill primitives now live in `src/engine/controls/native.js`, with compatible exports from `fill.js`. The common adapter exposes read, resolveOptions, write, verify and guarded undo operations. Bulk rules, bulk AI, inline AI, cover-letter placement and resume upload use the verified path. Native setters and existing date/phone/event helpers remain in use.

Verification records write attempted, canonical DOM acceptance, exposed validation state and a final outcome. Ordinary values settle over a bounded 450-ms observation window; native selects and custom choices also retain their existing settling checks. Native validity, ARIA invalidity and linked error messages can reject a value even when it remains visible. A final run readback detects values that changed during later batches. The count excludes rejected writes; a nonempty rejected value still requires review. Server acceptance is not inferred from browser acceptance.

Supported paths cover text, textarea, email/numeric inputs, native dates and date parts, native selects, radio groups, checkbox groups, multiple native selections, rich text, custom search dropdowns, multi-select chips and file inputs. A stored resume is counted only after file metadata survives readback and exposed upload state is neither pending nor an error. A pending upload is deferred. An explicit free-text suggestion control can accept text; typing into a closed dropdown is still insufficient proof of selection.

The Workday-style adapter searches an empty initial menu, waits for options, scopes portal menus to their owning control, traverses bounded virtualized/hierarchical lists and verifies selection/chip state. It checks cancellation and user/question revisions during asynchronous work. New synthetic templates include a button trigger with a portal search and a readonly-input trigger with a search inside the owned menu. They are structural fixtures, not captured employer pages.

Country controls precede region controls, school search precedes degree controls, and toggles precede dependent details. Mutation tracking collects changed control regions for up to three bounded follow-up passes. Unaffected regions are not rescanned by the follow-up queue, although initial and final inventory checks still scan the page. Independent ordinary writes settle together, including AI batches; dropdown interactions remain ordered.

Recognized repeat blocks bind to profile employment/education entries using unique visible anchors and retained row identity. A reordered block or reordered profile does not silently change a previously bound entity. Employer plus title, or school plus degree, disambiguates repeated organizations where available. Ambiguous or changed bindings are skipped. Initially empty recognized blocks use their explicit/DOM index until bound; semantic inference for arbitrary repeater layouts is not claimed.

Manual Fill can add up to five missing blocks through recognized, visible, enabled Workday-style Add controls with explicit `type=button`, expected labels/containers and known Remove controls. Additions have reversible bookkeeping. Unknown buttons are not clicked. Undo removes an added block only after its authored values have been restored and it has no later user edits.

Before a write, stale/disconnected controls, changed questions/sections/options, readonly ordinary inputs and cancelled work are rejected. During settling, trusted user edits and descriptor changes defer verification. Undo checks the authored value and later edit events before restoring anything; it reports only successful restores. Closed dropdown undo uses a recognized Clear control and otherwise declines instead of manufacturing selected-state attributes. Unsupported dropdown undo and arbitrary repeat expansion remain manual.

Ordinary text writes no longer move real focus away from another control. Extension-generated click events are distinguished from later user edits. Submit-typed controls are never clicked by the shared click primitive; submit-typed Next buttons require manual action even when a wizard is visible. Multi-step filling stops at missing/invalid required controls, rejected verification, cancellation or uncertain advancement. Final submission remains manual.

## Local evidence

The frozen evidence files in this directory record the exact tested bundle and local archive.

| Check | Result |
|---|---|
| Unit suite | 953 passing checks, including 28 Phase 5 assertions |
| Phase 5 browser assertions | 56/56 |
| Supported verification attempts | 22/22 verified, 100% |
| Deliberate revert/validation rejection | Rejected; not counted as verified fills |
| Stale/cancelled/detached before-write cases | Zero writes |
| User edit during settling and later undo | Edit preserved |
| Recognized repeat expansion/reordering/undo | Passed |
| Unknown repeat and submit-typed Next | Zero clicks/submissions |
| Nested frame fill | Verified value and frame inventory passed |
| Resolver regression | 13/13; 142/142 correct factual decisions at 71.7% answerable coverage |
| Knowledge/storage regression | 46/46 |
| Prior scoped extension regression | 25/25 |
| Prior form/control regression | 41/41 |
| Existing module contracts | 6/6 |
| Actual worker termination scenarios | 2/2 |

The supported success denominator is deliberately small and explicit: 11 ordinary/grouped controls, one accepted file upload, seven prior custom-menu variants and three additional empty-search templates. Deliberately rejected, stale, user-edited and pending cases have their own assertions and are not counted as supported successful writes. This establishes the narrow >=99% fixture gate, not a statistical estimate for live applications.

Evidence: [results.json](results.json), [resolver-regression.json](resolver-regression.json), [knowledge-regression.json](knowledge-regression.json), [regression.json](regression.json), [lifecycle.json](lifecycle.json), [unit.txt](unit.txt), [package.json](package.json). Fresh headless Edge profiles, real unpacked-extension messaging/IndexedDB and synthetic provider responses were used. No live provider calls, real applications, user browser profiles, submissions or store uploads were used.

One repeated regression run hit the install-time dashboard navigation interrupting the first fixture. The harness now waits for that onboarding navigation before retrying only this specific interruption; other navigation errors still fail. The scoped regression subsequently passed. This setup issue is separate from the measured form engine behavior.

The older broad corpus invokes legacy low-level primitives directly and does not use the new verifier. Its recorded delayed false-success remains useful as a low-level baseline; the new Phase 5 test exercises the verified path and rejects that failure. The existing F13 custom-widget correction-learning test remains failing and explicitly excluded from the scoped regression gate. Full strict acceptance remains open, rather than being claimed from this narrower fixture gate.

## Try it

Reload the unpacked extension and refresh application tabs. Confirm common facts and keep resume text current. Fill, review any rejected values and drafts, and submit manually. Undo keeps later edits; unsupported custom-menu undo requires manual clearing. Some wizard Next buttons now intentionally require manual action because they are submit-typed.

Local archive: `dist/apply-karo-2.1.0.zip`; existing version retained, not published. The authoritative archive/bundle SHA-256 values and file-by-file source comparison are recorded in [package.json](package.json).

## Acceptance still open

- [ ] Multiple real Workday employers and live Greenhouse/Lever/Ashby/Google Forms applications.
- [ ] Provider quality and server-side submission acceptance.
- [ ] Arbitrarily delayed rejections beyond the bounded observation window, unsupported Clear/remove controls and unknown repeat schemas.
- [ ] Phase 6 consolidated review and reliable custom-widget correction learning.
- [ ] Human prose quality and review-plus-correction timing demonstrating 90% reduced total filling time.
