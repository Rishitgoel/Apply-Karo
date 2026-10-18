# Phase 2: complete questions and early Workday controls

Measured 7 October 2026. Engineering implemented and scoped local gates passed. Live ATS/provider acceptance and the 90% time-saving target remain open.

## Changes

Discovery now produces complete question descriptors with ordered accessible references, visible prompts, descriptions, label candidates, section/repeat context, constraints and option completeness. Conflicting labels block answers rather than silently choosing one. Unicode contextual keys distinguish questions that previously collided after 60 characters or across sections. Document-local IDs remain stable while descriptor revisions change with questions, context or options. These are early descriptors, not the complete typed knowledge/entity system planned for Phase 3.

Bulk and inline AI receive current full questions and known choices, with revision checks before applying responses. The 80-field cutoff is removed: batching accounts for the full queue and reports deferred fields on cancellation, quota or widget time limits. Another manual Fill pass rescans current fields and skips existing values; it does not replay an unknown write. Prose-field popovers offer **Correct detected question**, scoped to the application URL, original question and unique locator. This UI is not yet available on every control. Corrections are local settings, currently outside backup export.

The early Workday adapter opens the field's owned menu, waits for delayed options, searches or scrolls bounded virtualized lists, and ranks exact choices before curated vocabulary mappings. Ambiguous matches report candidate choices. Button prompts, searchable controls, portal menus, explicit hierarchical paths and multi-select chips have positive fixtures. Country is scheduled before state, followed by conditional discovery. A selection must persist in a canonical value, selected label or chip; typed search text and menu closure are insufficient. Rejected uncommitted searches are restored when the field remains unchanged. Native selects also use clear-choice matching and delayed readback.

Unfamiliar employment forms receive bounded detection; login, search and checkout negative fixtures remain excluded. Ready-frame inventories and open-root scans expose inspectable surfaces and warn about recognizable uninspectable components or missing frame URLs. Manual all-frame injection fills tested about:blank/srcdoc frames without changing manifest permissions. Inventory cannot prove that every closed root or inaccessible frame was identified.

Ordered labels and selection-versus-editing behavior follow the [W3C accessible-name working draft](https://www.w3.org/TR/accname-1.2/) and [combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/). The extractor is not a claim of full accessible-name specification conformance. Related-frame access depends on [Chrome injection and origin rules](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts); restricted origins, sandboxed frames, redirects and automatic related-frame startup still need wider acceptance testing.

## Verification

| Check | Result | Reproduce / evidence |
| --- | --- | --- |
| Unit suite | 796 assertions passed, including 36 Phase 2 assertions | `node test/eval/unit.mjs` |
| Scoped Phase 2 gate | Passed; 6/6 module contracts, 24/24 scoped existing extension cases and 41/41 new browser/control checks | `node test/eval/run.mjs --phase2`, [results.json](results.json), [controls.json](controls.json) |
| Worker termination | 2/2 actual worker-stop cases passed | `node test/eval/lifecycle.mjs`, [lifecycle.json](lifecycle.json) |
| Supported held-out families | 100% discovery recall and complete authored question text in each measured family | `phase2Gate.supportedHeldout` in [results.json](results.json) |
| Local package | 42 files; every ZIP entry equals source; tested engine bundle equals packaged bundle | `node build.mjs`, [package.json](package.json) |
| Source checks | Changed entry-point syntax and `git diff --check` passed | `node --check background.js`, `node --check popup.js` |
| Submissions | 0 in the deterministic corpus | [results.json](results.json) |

The new checks include the 61st virtualized option, a 1.7-second option delay, an unrelated open portal menu, similar choices, native/custom selection reversion, uncommitted search restoration, hierarchy/chips, stale-question rejection, full long/multipart questions, conflicting labels, section revisions, scoped correction reuse, country/state dependencies, related frames, uninspectable components and unfamiliar/negative detection. Outcome checks include canonical fixture application state rather than only displayed search text. The original extension scenarios also retain the 81-field queue regression.

Tests use fresh headless Edge profiles and the actual unpacked extension. The deterministic corpus directly exercises scanner/rules/filler; AI responses in extension scenarios are local fakes, and new control tests disable/block AI transport. No live provider requests, real application submissions or native toolbar-focus acceptance were performed.

## Corpus comparison

| Metric | Frozen Phase 0/1 | Phase 2 |
| --- | ---: | ---: |
| Complete questions | 466/500 (93.2%) | 500/500 (100%) |
| Correct answerable fields | 320/440 (72.7%) | 367/440 (83.4%) |
| Correct Workday-style fields | 87/132 (65.9%) | 118/132 (89.4%) |
| Delayed false-success writes | 1 | 1 |

This is a synthetic structural corpus with 25 authored intent rows repeated across 20 templates; observations are correlated. Question fidelity compares full authored text, not model comprehension. The gold questions/answers are preserved, but Phase 2 repairs the virtualized fixture's scrolling behavior and aligns replay ordering with country-before-state execution. Both corpus and fixture hashes are recorded. The comparison includes these benchmark changes and is not a live ATS accuracy or timing claim.

The broad strict acceptance gate remains unsatisfied: answerable coverage is below 95%, the dynamic-reuse text fixture still has a delayed false-success write, and F13 custom-widget correction learning still fails. The scoped Phase 2 gate explicitly excludes F13 while retaining its failed result in the report. Dropdown readback is implemented here; general text/radio write verification and transactional custom-widget learning remain later-phase work.

## Remaining acceptance

- [ ] Real Workday employer templates and other ATS pages, including complex repeated/nested controls.
- [ ] Live BYOK model question interpretation and grounded answer quality.
- [ ] Native toolbar interaction; restricted, sandboxed and additional related-frame configurations.
- [ ] Full closed-root inventory and shadow roots attached after initial observation.
- [ ] Longer delayed reversion, all-field verification, scoped transactional knowledge and custom-widget correction learning.
- [ ] Human review/correction timing demonstrating 90% reduced form-filling time.

Changes preserve the existing dirty checkout. No commit, publication or store upload was performed. SHA-256 values in the package evidence identify the measured engine and installable archive.

## Try it

Reload the unpacked extension in `chrome://extensions` or `edge://extensions`, then refresh application tabs to replace their old engine. Alternatively extract `dist/apply-karo-2.1.0.zip` and load that folder unpacked. Use toolbar Fill or the page panel, review unresolved choices and drafts, and submit manually. The package retains the existing version and is a local build.
