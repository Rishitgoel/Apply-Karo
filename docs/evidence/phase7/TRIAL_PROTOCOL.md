# Pending human trials: 10 Workday, 10 Keka, 10 other forms

No human timing observations have been collected. Automated recorder and browser tests are not participant trials.

1. Use matched form variants A/B with the same fictional gold facts. For each family, run five manual-first and five assisted-first pairs. Record distinct variant IDs, anonymous participant ID, profile maturity and setup time. Prefer several participants; a one-person result only describes that person's tested workload.
2. Start each timer before beginning the form. Pause active time only for waiting or an unrelated interruption, never for review or correction. Elapsed time retains waits. Stop only after completing all questions and reviewing/correcting the result. Do not submit.
3. An observer independently checks every final answer. On synthetic forms, seed a wrong phone digit, wrong school, reversed sponsorship answer and unsupported prose claim. Record total seeded errors, noticed errors and remaining final errors. Never plant wrong information in a real application.
4. Include unsupported controls, required missing facts, dropdowns, repeated records and embedded forms. If assistance cannot fill a form, finish it manually and retain that entire assisted time in the dataset. Record login/CAPTCHA/video/identity steps in end-to-end elapsed time; do not silently remove slow trials.
5. Run `npm run trials` and open the printed local `/trials` URL, or open [the standalone recorder](../../../test/eval/trials.html). The recorder stores only trial metadata locally. The observer must confirm matched variants and final answers before saving.
6. Export the recorder's JSON. Run `npm run eval:phase7-trials -- path/to/export.json`. Inspect the results alongside the gold answers, sample composition and provider/coverage reports. Keep incomplete or failed trials visible; do not remove them to increase the measured saving.

Acceptance needs at least 30 complete, counterbalanced pairs with the selected 10/10/10 workload, at least 90% aggregate active-time reduction, no remaining final errors and all seeded errors noticed. Report p50/p90, uncertainty, setup cost, cold/mature results and unsupported surfaces. Self-reported measurements still require independent correctness and workload review before a public release claim.

Slot schedule: Workday W01–W10, Keka K01–K10, Other O01–O10. Odd slots are manual-first; even slots are assisted-first. Replace generic A/B with the actual matched variant IDs. Keep the unfilled `trials.json` as the pending template; populate it only with genuine observations.
