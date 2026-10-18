# Keka form coverage and URL correction

User report: the extension filled only some fields and reported 20 still empty. Screenshots showed Current Location, college, specialisation and phone missing, and a bare LinkedIn address rejected by the form.

## Diagnosis

Read-only inspection of the user's [reported job](https://kickdrum.keka.com/careers/jobdetails/87037) and its Apply form confirmed the visible labels and the Select2 phone widget. No personal data was entered, no files uploaded, no consent/CAPTCHA completed and no application submitted. The user's installed extension state and stored profile were not accessed.

The shared resolver rejected `location` because its compatibility-pattern table omitted that existing rule. Education rules required a detected Education heading, while this mixed Keka form has none. British `Specialisation` was not mapped, and the `and` inside its explanatory examples was treated as a compound question. Links were copied verbatim without adding an HTTPS scheme.

A screenshot-label reconstruction reproduced three verified known fills and a bare invalid LinkedIn value. Its phone prefix and number shared a label, so the prefix was not distinguished from the number. Live DOM inspection revealed another gap: Keka hides the native phone-code select behind Select2, and the visible trigger's ARIA label points to the selected display text. That display was also being scanned as a separate text field.

## Changes

- Recognize home/current location and compose it from confirmed city/state/country when no explicit location is stored.
- Allow explicit College Name and specialisation without a section heading when exactly one education record can supply the answer. Ambiguous multiple records remain unresolved. Employer locations, high-school questions, grade percentages and unrelated school contact questions do not inherit these facts.
- Support British spelling and the observed specialisation example format while keeping negation/exclusion checks.
- Add HTTPS to bare stored profile links and reject malformed or non-HTTP links. Do not truncate an expanded URL to fit.
- Detect locally paired native phone controls and explicit `mobilePhone.countryCode`/`.number` pairs. Separate the dialling code from the national number before checking the number's length.
- Bind a single-select Select2 trigger to its adjacent backing select, preserve a stable question label, expose its complete native choices, and ignore its readonly selected-text display as a separate input. A successful write requires backing value and visible rendered selection to agree. Undo includes the backing select.
- Permit source-grounded Achievements drafts in the observed single-line text input. URL/link inputs do not accept prose drafts. Existing quote validation, review requirement and non-promotion to approved memory remain in force.

## Verification

The same local screenshot-label reconstruction now verifies nine known fields: first name, last name, email, phone code, national phone number, location, LinkedIn, college and specialisation. The separate live-DOM-informed Select2 reconstruction also verifies nine. Unknown percentages, preferred test language, video link and CAPTCHA stay blank; consent remains unchecked. A stored GPA of 9.1 is not converted into an invented percentage.

- 979 unit checks passed, including 26 report-specific assertions.
- 16/16 checks passed in each of the native-pair and Keka-style reconstructions.
- Existing resolver checks: 13/13; 142/142 correct approved factual decisions at 71.7% answerable coverage on the earlier synthetic held-out set.
- Existing Phase 5 checks: 56/56, including 22/22 explicitly supported control writes.
- Existing form/control checks: 41/41.
- Scoped extension checks are recorded separately; F13 custom-widget correction learning remains a known excluded failure.

Frozen outputs and package/source comparison are stored alongside this report. The Select2 fixture uses a local change-handler shim matching the inspected backing/rendered structure; live autofill against Keka and the user's actual profile was not performed. General ATS coverage, actual provider response quality and the 90% time-saving target are not established by this fix.

## Remaining fields

The banner combines missing facts with currently unsupported mappings and optional blanks. Grades, experience totals, strongest backend/frontend and preferred test language require confirmed answers. Certifications require evidence/confirmation. A video URL requires an actual accessible video; narrative answers cannot replace it. Gender follows the disclosure setting. Consent, CAPTCHA and final submission remain manual. These unresolved fields do not mean every remaining dropdown driver failed.

Reload the unpacked extension (or extract the rebuilt local archive), then refresh the application page. Clear the previously invalid LinkedIn value once before filling again: autofill preserves already-filled/user-edited fields. Keep current location, phone and education facts in the dashboard, and current resume text available for grounded Achievements drafts.
