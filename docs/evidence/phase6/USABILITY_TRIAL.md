# Phase 6 human acceptance — pending

No human trial has been run. Use synthetic forms and fictional profiles so intentionally seeded wrong answers cannot enter a real application.

For each paired manual/assisted trial, use equivalent form variants with counterbalanced order. Record initial profile setup separately. Start active-time measurement when the participant begins the form, stop only after they have reviewed and corrected it, and record model waiting as elapsed time. Never submit the form.

Include native controls, a Workday-style dynamic dropdown, an embedded form, repeated employment/education, an unsupported control and a missing fact repeated twice. Seed errors independently of the filler: a wrong phone digit, a wrong education institution, a reversed sponsorship answer and an unsupported claim in a prose draft. Do not tell the participant which rows contain errors before review.

| Trial | Form family / variant | Manual active seconds | Assisted active seconds | Assisted elapsed seconds | Seeded errors noticed / total | Corrections | Missing facts answered | Review complete? |
|---|---|---:|---:|---:|---:|---:|---:|---|
| pending | | | | | | | | |

After review, independently compare every submitted-intent value with the fictional gold profile. Record critical errors separately and ask whether the participant understood source labels, scopes, unsupported fields and undo. A scripted browser check cannot substitute for this observation.

Calculate `1 - sum(assisted active time) / sum(manual active time)`. Report median and p90 time, setup cost, missed seeded errors, corrections, coverage and unsupported surfaces. Phase 7 expands to at least 30 paired representative trials. Leave the 90% claim unchecked until the agreed workload and correctness gates pass.
