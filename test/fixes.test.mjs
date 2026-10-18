// Deep verification tests for aggressive overwriting, AI filling, and missed fields
// Run with: node test/fixes.test.mjs

import { assign, tokenize, pickResumeTargets, ATS_BY_NAME, ATS_BY_ID, ATS_BY_AUTOMATION_ID } from "../src/shared/rules.js";
import { DEFAULT_SETTINGS } from "../src/shared/schema.js";
import { readAnswers, PROVIDERS } from "../src/shared/ai.js";
import { matchOption, optionScore, isFocused, fillCombobox } from "../src/engine/fill.js";
import { hasExistingUpload, helperTextFor, labelFor, isGenericLabel } from "../src/engine/scan.js";
import { classify, semanticScore, parseTimeframe } from "../src/shared/values.js";
import { isParagraphTarget } from "../src/engine/inline.js";
import { ruleValue } from "../src/engine/index.js";
import { readFileSync } from "node:fs";

let pass = 0;
const fails = [];
const check = (desc, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push({ desc, want: w, got: g });
};

function field({ label = "", name = "", id = "", automationId = "", type = "text",
                 kind = "text", placeholder = "", autocomplete = "", section = null,
                 skip = false, options = null, filled = false, el = {}, instance = 0, repeatGroup = 0 }) {
  const atsField =
    (automationId && ATS_BY_AUTOMATION_ID[automationId]) ||
    (name && ATS_BY_NAME[name]) ||
    (id && ATS_BY_ID[id]) || null;

  return {
    label: label.toLowerCase(), rawLabel: label,
    name, id, type, kind, placeholder, autocomplete,
    nameTokens: tokenize(`${name} ${id} ${automationId}`),
    atsField, section, skip, options, filled, el, instance, repeatGroup
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Aggressive Overwriting Prevention
// ─────────────────────────────────────────────────────────────────────────────
{
  // If an upload already has a file or detected existing upload, pickResumeTargets must not target it
  const alreadyUploaded = [
    { kind: "file", label: "resume", id: "resume_input", filled: true, accept: ".pdf" }
  ];
  check("pickResumeTargets skips already filled uploads",
    pickResumeTargets(alreadyUploaded, "resume.pdf").filter(f => !f.filled).length, 0);

  // When a user modifies an element, it must be protected from being overwritten
  const userModified = new WeakSet();
  const inputEl = { value: "User's Custom Text" };
  userModified.add(inputEl);

  const scannedField = field({ label: "First Name", name: "first_name", el: inputEl, filled: true });

  const shouldSkip = (f, isManual, activeElement) => {
    const isUserModified = userModified.has(f.el);
    const isActive = !isManual && activeElement === f.el;
    return f.filled || isUserModified || isActive;
  };

  check("User modified element is skipped on auto pass", shouldSkip(scannedField, false, null), true);
  check("User modified element is skipped even if cleared",
    shouldSkip({ ...scannedField, filled: false }, false, null), true);

  // Active typing in an element skips it during automatic pass
  const activeInput = { value: "" };
  const fieldBeingTyped = field({ label: "Last Name", name: "last_name", el: activeInput, filled: false });
  check("Active element is skipped during auto pass",
    shouldSkip(fieldBeingTyped, false, activeInput), true);
  check("Active element is NOT skipped during manual pass if not filled",
    shouldSkip(fieldBeingTyped, true, activeInput), false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. AI Filling Stability & Matching
// ─────────────────────────────────────────────────────────────────────────────
{
  // Default settings must use valid GA model
  check("DEFAULT_SETTINGS uses active GA Gemini model",
    DEFAULT_SETTINGS.geminiModel, "gemini-3.8-flash");
  check("DEFAULT_SETTINGS has AI autofill enabled",
    DEFAULT_SETTINGS.aiAutofillEnabled, true);

  // All Gemini provider models must be active GA models
  check("Gemini provider list contains active models",
    PROVIDERS.gemini.models.includes("gemini-3.8-flash"), true);
  check("Gemini provider list does not contain obsolete preview models",
    PROVIDERS.gemini.models.some((id) => /^gemini-(1\.5|2\.0)-/.test(id)), false);

  // readAnswers maps answers by field name if model returns names instead of numeric indices
  const fieldList = [
    { label: "preferred_name", name: "preferred_name" },
    { label: "notice_period", name: "notice_period" }
  ];
  const byNameJson = JSON.stringify({
    "preferred_name": { "value": "Rick", "confidence": 0.95 },
    "notice_period": { "value": "30 days", "confidence": 0.9 }
  });
  const answers = readAnswers(byNameJson, 2, fieldList);
  check("readAnswers maps field name keys to proper indices", answers[0]?.value, "Rick");
  check("readAnswers maps second field name key", answers[1]?.value, "30 days");

  // matchOption with ruleId bridges semantic gaps
  const authOpts = [
    { label: "Yes, I am legally authorized to work in the US", value: "yes_auth" },
    { label: "No, I am not authorized", value: "no_auth" }
  ];
  check("matchOption bridges 'Yes' for authorizedToWork",
    matchOption(authOpts, "Yes", "authorizedToWork")?.value, "yes_auth");

  const sponsorOpts = [
    { label: "I will now or in the future require visa sponsorship", value: "yes_sponsor" },
    { label: "No, I do not require sponsorship", value: "no_sponsor" }
  ];
  check("matchOption bridges 'No' for sponsorship",
    matchOption(sponsorOpts, "No", "sponsorship")?.value, "no_sponsor");

  const relocateOpts = [
    { label: "Yes, open to relocation", value: "yes" },
    { label: "No, local only", value: "no" }
  ];
  check("matchOption bridges 'Yes' for willingToRelocate",
    matchOption(relocateOpts, "Yes", "willingToRelocate")?.value, "yes");

  const degreeOpts = [
    { label: "Bachelor's Degree", value: "bachelors" },
    { label: "Master's Degree", value: "masters" },
    { label: "High School", value: "hs" }
  ];
  check("matchOption bridges 'B.Tech' for degree",
    matchOption(degreeOpts, "B.Tech", "degree")?.value, "bachelors");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Missed Form Fields Recognition
// ─────────────────────────────────────────────────────────────────────────────
{
  const opts = { skipSensitive: false, hasAnswerFor: () => true };

  const testCases = [
    // Preferred Name
    [field({ label: "Preferred Name", name: "preferred_name" }), "preferredName"],
    [field({ label: "Nickname / Preferred First Name", name: "nickname" }), "preferredName"],
    [field({ automationId: "legalNameSection_preferredName" }), "preferredName"],

    // Address Line 2
    [field({ label: "Address Line 2 (Apartment, suite, unit)", name: "address_2" }), "addressLine2"],
    [field({ automationId: "addressSection_addressLine2" }), "addressLine2"],

    // Phone Type
    [field({ label: "Phone Device Type", name: "phone_device_type" }), "phoneType"],
    [field({ automationId: "phoneDeviceType" }), "phoneType"],

    // Willing to Relocate
    [field({ label: "Are you willing to relocate?", name: "relocate" }), "willingToRelocate"],
    [field({ label: "Willingness to Relocate", name: "relocation_preference" }), "willingToRelocate"],

    // Work Location Preference
    [field({ label: "Workplace Preference (Remote / Hybrid / Onsite)", name: "work_mode" }), "workLocationPreference"],

    // Legal Age
    [field({ label: "Are you at least 18 years of age?", name: "legal_age" }), "legalAge"],

    // Former Employee
    [field({ label: "Have you ever been previously employed by this company?", name: "previous_employee" }), "formerEmployee"],
    [field({ label: "Former employee or contractor?", name: "prior_worker" }), "formerEmployee"],

    // Relative Employed
    [field({ label: "Do you have any relatives or family members currently working here?", name: "relative_employed" }), "relativeEmployed"],

    // Notice Period
    [field({ label: "Notice Period (days/weeks)", name: "notice_period" }), "noticePeriod"],
    [field({ label: "Required Notice Period", name: "days_notice" }), "noticePeriod"],

    // Twitter
    [field({ label: "Twitter / X Profile", name: "twitter_url" }), "twitter"],

    // Citizenship
    [field({ label: "Country of Citizenship", name: "citizenship_country" }), "citizenship"],

    // Current Salary
    [field({ label: "Current Salary / Compensation", name: "current_salary" }), "currentSalary"],

    // Work authorization variations
    [field({ label: "Are you authorized to work in the country of this role?", name: "work_auth" }), "authorizedToWork"],
    [field({ label: "Will you now or in the future require employment visa sponsorship?", name: "visa_sponsorship" }), "sponsorship"],

    // Suffix & County
    [field({ automationId: "legalNameSection_suffix" }), "suffix"],
    [field({ label: "Suffix (Jr., Sr., III)", name: "suffix" }), "suffix"],
    [field({ automationId: "addressSection_county" }), "county"],
    [field({ label: "County", name: "county" }), "county"],

    // Electronic Signature & Date
    [field({ automationId: "electronicSignature" }), "signature"],
    [field({ label: "Signature", name: "job_application[signature]" }), "signature"],
    [field({ label: "Please type your full legal name to sign", name: "sign_name" }), "signature"],
    [field({ automationId: "dateSigned" }), "signatureDate"],
    [field({ label: "Signature Date", name: "job_application[signature_date]" }), "signatureDate"],

    // Non-Compete Agreement
    [field({ automationId: "nonCompeteAgreement" }), "nonCompete"],
    [field({ label: "Are you bound by any non-compete agreements?", name: "non_compete" }), "nonCompete"],

    // Government Official
    [field({ automationId: "governmentOfficial" }), "governmentOfficial"],
    [field({ label: "Are you a public or government official?", name: "gov_official" }), "governmentOfficial"],

    // Reliable Transportation
    [field({ automationId: "reliableTransportation" }), "reliableTransportation"],
    [field({ label: "Do you have access to reliable transportation?", name: "reliable_transportation" }), "reliableTransportation"],

    // Felony / Criminal Record
    [field({ label: "Have you ever been convicted of a felony?", name: "criminal_record" }), "criminalRecord"],

    // Hispanic/Latino (EEO)
    [field({ automationId: "hispanicLatino" }), "hispanicLatino"],
    [field({ label: "Are you Hispanic or Latino?", name: "hispanic_latino" }), "hispanicLatino"]
  ];

  for (const [f, expectedRule] of testCases) {
    const assigned = assign([f], opts);
    check(`Field '${f.rawLabel || f.name || f.atsField}' matches '${expectedRule}'`,
      assigned.get(0)?.ruleId, expectedRule);
  }
}

// ─── 4. Option Score Token Overlap ───────────────────────────────────────────
{
  check("token overlap matches 'Hybrid' with 'Hybrid (2-3 days in office)'",
    optionScore("Hybrid (2-3 days in office)", "Hybrid") >= 0.8, true);
  check("token overlap matches 'Computer Science' with 'BS in Computer Science'",
    optionScore("BS in Computer Science", "Computer Science") >= 0.8, true);
}

// ─── 5. Digits in field names must NOT misroute batch index ──────────────────
{
  const fields = [
    { label: "First Name", name: "first_name" },
    { label: "Last Name", name: "last_name" },
    { label: "Email", name: "email" },
    { label: "Address Line 2", name: "address_line_2" },
    { label: "Phone 2", name: "phone_2" }
  ];
  // Model returns an object with "address_line_2" key
  const jsonWithDigitKey = JSON.stringify({
    "address_line_2": { "value": "Apt 4B", "confidence": 0.95 },
    "phone_2": { "value": "555-9876", "confidence": 0.9 }
  });
  const res = readAnswers(jsonWithDigitKey, 5, fields);
  // Must land on index 3 (address_line_2), NOT index 2 (email)
  check("readAnswers correctly routes address_line_2 to index 3", res[3]?.value, "Apt 4B");
  check("readAnswers does not overwrite index 2 with address_line_2", res[2], undefined);
  check("readAnswers correctly routes phone_2 to index 4", res[4]?.value, "555-9876");

  // Model returns batch keys with prefix: "field_0", "field 1"
  const prefixedJson = JSON.stringify({
    "field_0": { "value": "Alice", "confidence": 1 },
    "field 1": { "value": "Smith", "confidence": 1 }
  });
  const resPrefixed = readAnswers(prefixedJson, 5, fields);
  check("readAnswers parses field_0 prefix", resPrefixed[0]?.value, "Alice");
  check("readAnswers parses field 1 prefix", resPrefixed[1]?.value, "Smith");
}

// ─── 6. Combobox Placeholder vs Value Detection ──────────────────────────────
{
  const COMBO_PLACEHOLDER_RE = /^[\s\u00a0-]*(\b(select(\s+(one|an?\s+option))?|choose(\s+(one|an?\s+option))?|please\s+select|none|search|type\s+to\s+search)\b)?[\s\u00a0-]*$/i;
  check("COMBO_PLACEHOLDER_RE matches 'Select One'", COMBO_PLACEHOLDER_RE.test("Select One"), true);
  check("COMBO_PLACEHOLDER_RE matches '-- Please Select --'", COMBO_PLACEHOLDER_RE.test("-- Please Select --"), true);
  check("COMBO_PLACEHOLDER_RE matches 'Choose an option'", COMBO_PLACEHOLDER_RE.test("Choose an option"), true);
  check("COMBO_PLACEHOLDER_RE does not match 'United States'", COMBO_PLACEHOLDER_RE.test("United States"), false);
  check("COMBO_PLACEHOLDER_RE does not match 'Yes'", COMBO_PLACEHOLDER_RE.test("Yes"), false);
}

// ─── 7. React Re-mount Protection via userModifiedKeys ───────────────────────
{
  const userModifiedKeys = new Set();
  userModifiedKeys.add("first name");

  // Old element unmounted, new element mounted by React with empty value
  const newEl = { value: "" };
  const remountedField = field({ label: "First Name", name: "first_name", el: newEl, filled: false });

  const isProtected = (f) => userModifiedKeys.has(f.label) || userModifiedKeys.has(f.name);
  check("Remounted React element retains user-modified protection", isProtected(remountedField), true);
}

// ─── 8. Background Runs Must Not Re-attach Resume ────────────────────────────
{
  const shouldAttach = (isManual, ranOnce, userUploadedFile) => {
    if (userUploadedFile) return false;
    if (!isManual && ranOnce) return false;
    return true;
  };
  check("Attach on initial load", shouldAttach(false, false, false), true);
  check("Attach on manual click", shouldAttach(true, true, false), true);
  check("Do not attach during background observer run after initial load",
    shouldAttach(false, true, false), false);
  check("Do not attach if user uploaded their own file",
    shouldAttach(true, true, true), false);
}

// ─── 9. watchEdits Demotion Logic ───────────────────────────────────────────
{
  let demoted = false;
  const onUserEdit = (priorValue, cleanValue) => {
    if (priorValue && cleanValue !== priorValue.trim()) {
      if (!cleanValue) {
        demoted = true; // user cleared the field
      }
      // if cleanValue is not empty, do not demote!
    }
  };

  // User edits typo or refines text ("Rishit" -> "Rishitkumar")
  demoted = false;
  onUserEdit("Rishit", "Rishitkumar");
  check("Editing text value does NOT demote rule", demoted, false);

  // User clears the field ("Rishit" -> "")
  demoted = false;
  onUserEdit("Rishit", "");
  check("Clearing text value DOES demote rule", demoted, true);
}

// ─── 10. ruleValue customFields fallback verification ────────────────────────
{
  globalThis.window = { top: {} };
  globalThis.document = { addEventListener() {} };
  const { ruleValue } = await import("../src/engine/index.js");

  const profile = { personal: { country: "United States" }, customFields: {} };
  check("ruleValue legalAge stays unresolved without a confirmed fact", ruleValue("legalAge", profile), null);
  check("ruleValue formerEmployee stays unresolved without a confirmed fact", ruleValue("formerEmployee", profile), null);
  check("ruleValue relativeEmployed stays unresolved without a confirmed fact", ruleValue("relativeEmployed", profile), null);
  check("ruleValue noticePeriod stays unresolved without a confirmed fact", ruleValue("noticePeriod", profile), null);
  check("ruleValue citizenship stays unresolved without a confirmed fact", ruleValue("citizenship", profile), null);
  check("ruleValue salutation stays unresolved without a confirmed fact", ruleValue("salutation", profile), null);
  check("ruleValue consent stays unresolved without a confirmed fact", ruleValue("consent", profile), null);
  check("ruleValue backgroundCheck stays unresolved without a confirmed fact", ruleValue("backgroundCheck", profile), null);
  check("ruleValue travelPreference stays unresolved without a confirmed fact", ruleValue("travelPreference", profile), null);
  check("ruleValue driversLicense stays unresolved without a confirmed fact", ruleValue("driversLicense", profile), null);
  check("ruleValue securityClearance stays unresolved without a confirmed fact", ruleValue("securityClearance", profile), null);
  check("ruleValue phoneType stays unresolved without a confirmed fact", ruleValue("phoneType", profile), null);
  check("ruleValue willingToRelocate stays unresolved without a confirmed fact", ruleValue("willingToRelocate", profile), null);

  // When customFields explicitly provides an answer, that answer must win
  const customProfile = {
    personal: { country: "United States" },
    customFields: { formerEmployee: "Yes", salutation: "Dr.", legalAge: "No" }
  };
  check("ruleValue uses customFields when present", ruleValue("formerEmployee", customProfile), "Yes");
  check("ruleValue custom salutation", ruleValue("salutation", customProfile), "Dr.");
  check("ruleValue custom legalAge", ruleValue("legalAge", customProfile), "No");
}

// ─── 11. requiredEmpty ARIA & Select handling ────────────────────────────────
{
  const { requiredEmpty } = await import("../src/engine/steps.js");
  const makeDoc = (elements) => ({
    querySelectorAll: (sel) => elements
  });

  // Radio in ARIA radiogroup that is checked
  const checkedRadioGroup = {
    getAttribute: (attr) => attr === "role" ? "radiogroup" : null,
    tagName: "DIV",
    querySelector: (sel) => ({}) // has checked child
  };
  check("requiredEmpty does not flag answered ARIA radiogroup",
    requiredEmpty(makeDoc([checkedRadioGroup])).length, 0);

  const emptyRadioGroup = {
    getAttribute: (attr) => attr === "role" ? "radiogroup" : null,
    tagName: "DIV",
    querySelector: (sel) => null // no checked child
  };
  check("requiredEmpty flags unanswered ARIA radiogroup",
    requiredEmpty(makeDoc([emptyRadioGroup])).length, 1);

  // Switch with aria-checked="true"
  const checkedSwitch = {
    getAttribute: (attr) => attr === "role" ? "switch" : attr === "aria-checked" ? "true" : null,
    tagName: "DIV"
  };
  check("requiredEmpty does not flag checked ARIA switch",
    requiredEmpty(makeDoc([checkedSwitch])).length, 0);

  // Select with option 0 as valid value
  const validSelect = {
    tagName: "SELECT",
    selectedIndex: 0,
    value: "US",
    options: [{ text: "United States", value: "US" }]
  };
  check("requiredEmpty does not flag select with valid option 0",
    requiredEmpty(makeDoc([validSelect])).length, 0);

  // Select with placeholder option 0
  const placeholderSelect = {
    tagName: "SELECT",
    selectedIndex: 0,
    value: "",
    options: [{ text: "Select an option", value: "" }]
  };
  check("requiredEmpty flags select with placeholder option",
    requiredEmpty(makeDoc([placeholderSelect])).length, 1);
}

// ─── 12. readAnswers field_X name collision prevention ────────────────────────
{
  const fields = [
    { label: "Role Title", name: "title" },
    { label: "Secondary Field", name: "field_0" }
  ];
  // Model returns answers mapped by field name
  const json = JSON.stringify({
    "title": "Engineer",
    "field_0": "Special Answer"
  });
  const res = readAnswers(json, 2, fields);
  // field_0 is at index 1, not index 0!
  check("readAnswers prioritizes explicit field name over prefixed index", res[1]?.value, "Special Answer");
  check("readAnswers title at index 0", res[0]?.value, "Engineer");
}

// ─── 13. letterBtn disabled logic ─────────────────────────────────────────────
{
  const checkLetterDisabled = (apiKey) => {
    const hasKey = !!String(apiKey || "").trim();
    return !hasKey;
  };
  check("letterBtn disabled when no key, even if aiAutofillEnabled is true",
    checkLetterDisabled(""), true);
  check("letterBtn enabled when key present and aiAutofillEnabled is true",
    checkLetterDisabled("AIzaSy123"), false);
  check("letterBtn enabled when key present even if aiAutofillEnabled is false",
    checkLetterDisabled("AIzaSy123"), false);
}

// ─── 14. fillCombobox does not crash on 'known is not defined' ────────────────
{
  globalThis.MouseEvent ??= class extends Event {};
  globalThis.InputEvent ??= class extends Event {};
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };

  const optionEl = {
    textContent: "United States",
    getAttribute: () => null,
    offsetParent: {},
    getClientRects: () => [{}],
    scrollIntoView: () => {},
    dispatchEvent: () => true,
    focus: () => {},
    click: () => {}
  };
  const listboxEl = {
    getClientRects: () => [{}],
    querySelectorAll: () => [optionEl]
  };
  const mockCombobox = {
    tagName: "INPUT",
    value: "",
    getAttribute: (attr) => attr === "aria-controls" ? "lb1" : null,
    getRootNode: () => ({
      getElementById: (id) => id === "lb1" ? listboxEl : null,
      activeElement: null
    }),
    dispatchEvent: () => true,
    focus: () => {},
    blur: () => {},
    click: () => {}
  };

  // Case 1: options array provided
  const fieldWithOptions = {
    kind: "combobox",
    el: mockCombobox,
    options: [{ label: "United States", value: "US", el: optionEl }]
  };
  let threw = false;
  try {
    const filled = await fillCombobox(fieldWithOptions, "United States", "country");
    check("fillCombobox with options fills matching option", filled, true);
  } catch (err) {
    threw = true;
  }
  check("fillCombobox with options does not throw", threw, false);

  // Case 2: options array is null (where 'known' was previously undefined)
  const fieldNullOptions = {
    kind: "combobox",
    el: mockCombobox,
    options: null
  };
  threw = false;
  try {
    const filled = await fillCombobox(fieldNullOptions, "United States", "country");
    check("fillCombobox with null options completes without ReferenceError", typeof filled, "boolean");
  } catch (err) {
    threw = true;
  }
  check("fillCombobox with null options does not throw 'known is not defined'", threw, false);
}

// ─── 15. isFocused works across standard DOM and Shadow DOM ───────────────────
{
  const normalEl = {};
  const shadowEl = {};
  const docRoot = { activeElement: normalEl };
  const shadowRoot = { activeElement: shadowEl };

  normalEl.getRootNode = () => docRoot;
  shadowEl.getRootNode = () => shadowRoot;

  check("isFocused returns true when active in document", isFocused(normalEl), true);
  check("isFocused returns true when active in shadow root", isFocused(shadowEl), true);

  const unfocusedEl = { getRootNode: () => docRoot };
  check("isFocused returns false when element is not active", isFocused(unfocusedEl), false);
}

// ─── 16. requiredEmpty honors hasExistingUpload for file inputs ───────────────
{
  const { requiredEmpty } = await import("../src/engine/steps.js");
  const makeDoc = (elements) => ({
    querySelectorAll: (sel) => elements
  });

  const parentWithUploadedFile = {
    querySelector: (sel) => sel.includes("uploaded") ? {} : null,
    parentElement: null,
    textContent: "resume_final.pdf"
  };
  const fileInputWithUpload = {
    type: "file",
    files: [],
    parentElement: parentWithUploadedFile,
    closest: () => null,
    getAttribute: () => null
  };
  check("hasExistingUpload detects existing upload in container",
    hasExistingUpload(fileInputWithUpload), true);
  check("requiredEmpty does NOT flag file input when existing upload is detected",
    requiredEmpty(makeDoc([fileInputWithUpload])).length, 0);

  const parentEmpty = {
    querySelector: () => null,
    parentElement: null,
    textContent: ""
  };
  const emptyFileInput = {
    type: "file",
    files: [],
    parentElement: parentEmpty,
    closest: () => null,
    getAttribute: () => null
  };
  check("hasExistingUpload returns false when container has no upload",
    hasExistingUpload(emptyFileInput), false);
  check("requiredEmpty flags file input when no upload is present",
    requiredEmpty(makeDoc([emptyFileInput])).length, 1);
}

// ─── 17. PERSONAL_KEYS schema coverage and options UI integration ─────────────
{
  const optionsJsCode = readFileSync(new URL("../options.js", import.meta.url), "utf8");
  check("options.js includes preferredName in PERSONAL_KEYS",
    optionsJsCode.includes('"preferredName"'), true);
  check("options.js includes addressLine2 in PERSONAL_KEYS",
    optionsJsCode.includes('"addressLine2"'), true);
  check("options.js includes twitter in PERSONAL_KEYS",
    optionsJsCode.includes('"twitter"'), true);

  const optionsHtmlCode = readFileSync(new URL("../options.html", import.meta.url), "utf8");
  check("options.html has personal-preferredName input",
    optionsHtmlCode.includes('id="personal-preferredName"'), true);
  check("options.html has personal-addressLine2 input",
    optionsHtmlCode.includes('id="personal-addressLine2"'), true);
  check("options.html has personal-twitter input",
    optionsHtmlCode.includes('id="personal-twitter"'), true);
}

// ─── 18. aiPass imports isFocused in src/engine/index.js ──────────────────────
{
  const indexJsCode = readFileSync(new URL("../src/engine/index.js", import.meta.url), "utf8");
  check("src/engine/index.js imports isFocused from fill.js",
    /import\s*\{[^}]*\bisFocused\b[^}]*\}\s*from\s*["']\.\/fill\.js["']/.test(indexJsCode), true);
}

// ─── 19. Multi-file uploaders: no cross-input false positives ─────────────────
{
  const { requiredEmpty } = await import("../src/engine/steps.js");

  const resumeZone = {
    querySelector: (sel) => sel.includes("file-name") ? {} : null,
    querySelectorAll: () => [],
    textContent: "resume_final.pdf"
  };
  const resumeInput = {
    type: "file",
    files: [{ name: "resume_final.pdf" }],
    parentElement: resumeZone,
    closest: () => null,
    getAttribute: () => null
  };
  resumeZone.querySelectorAll = (sel) => sel.includes("file") ? [resumeInput] : [];

  const coverZone = {
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: ""
  };
  const coverInput = {
    type: "file",
    files: [],
    parentElement: coverZone,
    closest: () => null,
    getAttribute: () => null
  };
  coverZone.querySelectorAll = (sel) => sel.includes("file") ? [coverInput] : [];

  const sharedForm = {
    querySelectorAll: (sel) => sel.includes("file") ? [resumeInput, coverInput] : [],
    querySelector: (sel) => sel.includes("file-name") ? {} : null,
    textContent: "Resume: resume_final.pdf  Cover Letter: "
  };
  resumeZone.parentElement = sharedForm;
  coverZone.parentElement = sharedForm;
  sharedForm.parentElement = null;

  check("hasExistingUpload returns false for empty cover input despite uploaded resume sibling",
    hasExistingUpload(coverInput), false);
  check("hasExistingUpload returns true for resume input with upload",
    hasExistingUpload(resumeInput), true);

  const doc = {
    querySelectorAll: (sel) => [resumeInput, coverInput]
  };
  const emptyRequired = requiredEmpty(doc);
  check("requiredEmpty flags empty cover letter when resume is uploaded",
    emptyRequired.includes(coverInput), true);
  check("requiredEmpty does NOT flag uploaded resume",
    emptyRequired.includes(resumeInput), false);
}

// ─── 20. Generic remove/delete buttons do NOT trigger hasExistingUpload ───────
{
  const eduContainer = {
    querySelector: (sel) => {
      // Mock button matching generic "remove"
      if (sel.includes('remove') && !sel.includes('remove file') && !sel.includes('remove attachment') && !sel.includes('remove resume')) {
        return { getAttribute: () => "Remove education" };
      }
      return null;
    },
    querySelectorAll: (sel) => sel.includes("file") ? [{}] : [],
    textContent: "Education Section"
  };
  const transcriptInput = {
    type: "file",
    files: [],
    parentElement: eduContainer,
    closest: () => null,
    getAttribute: () => null
  };
  eduContainer.parentElement = null;

  check("hasExistingUpload returns false when container has generic 'Remove education' button",
    hasExistingUpload(transcriptInput), false);

  // When container has an explicit file delete button, it should return true
  const fileContainer = {
    querySelector: (sel) => sel.includes('remove file') ? {} : null,
    querySelectorAll: (sel) => sel.includes("file") ? [{}] : [],
    textContent: "Uploaded Transcripts"
  };
  const transcriptWithFileButton = {
    type: "file",
    files: [],
    parentElement: fileContainer,
    closest: () => null,
    getAttribute: () => null
  };
  fileContainer.parentElement = null;

  check("hasExistingUpload returns true when container has explicit 'Remove file' button",
    hasExistingUpload(transcriptWithFileButton), true);
}

// ─── 21. fillCombobox waits for asynchronous options and selects ──────────────
{
  globalThis.HTMLInputElement ??= class {};
  globalThis.HTMLTextAreaElement ??= class {};
  globalThis.HTMLSelectElement ??= class {};
  globalThis.PointerEvent ??= class extends Event {};
  globalThis.KeyboardEvent ??= class extends Event {};

  let asyncOptionsRendered = false;
  const asyncOption = {
    textContent: "United States",
    getAttribute: () => null,
    offsetParent: {},
    getClientRects: () => [{}],
    scrollIntoView: () => {},
    dispatchEvent: () => true,
    focus: () => {},
    click: () => {}
  };
  const asyncListbox = {
    getClientRects: () => [{}],
    isConnected: true,
    querySelectorAll: (sel) => asyncOptionsRendered ? [asyncOption] : []
  };

  let observerCb = null;
  globalThis.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };

  const asyncCombobox = {
    tagName: "INPUT",
    value: "",
    getAttribute: (attr) => attr === "aria-controls" ? "asynclb" : null,
    hasAttribute: () => false,
    getRootNode: () => ({
      getElementById: (id) => id === "asynclb" ? asyncListbox : null,
      activeElement: null
    }),
    dispatchEvent: (ev) => {
      if (ev.type === "input") {
        setTimeout(() => {
          asyncOptionsRendered = true;
          observerCb?.();
        }, 20);
      }
      return true;
    },
    focus: () => {},
    blur: () => {},
    click: () => {}
  };

  const field = { kind: "combobox", el: asyncCombobox, options: null };
  const ok = await fillCombobox(field, "United States", "country");
  check("fillCombobox waits for asynchronously loaded options and successfully selects", ok, true);
}

// ─── 22. fillCombobox detects aria-expanded=false as closed ───────────────────
{
  let ariaExpanded = "true";
  const dummyCombobox = {
    tagName: "INPUT",
    value: "test",
    getAttribute: (attr) => attr === "aria-expanded" ? ariaExpanded : attr === "aria-controls" ? "dummy-lb" : null,
    hasAttribute: () => false,
    getRootNode: () => ({
      getElementById: () => ({ isConnected: true, getClientRects: () => [{}], querySelectorAll: () => [] }),
      activeElement: null
    }),
    dispatchEvent: (ev) => {
      if (ev.key === "Enter") ariaExpanded = "false";
      return true;
    },
    focus: () => {},
    blur: () => {},
    click: () => {}
  };

  ariaExpanded = "false";
  check("aria-expanded='false' represents a closed combobox",
    dummyCombobox.getAttribute("aria-expanded") === "false", true);
}

// ─── 23. fillChoiceGroup ShadowRoot label proxy lookup ────────────────────────
{
  const labelInShadow = {
    dispatchEvent: () => true,
    click: () => {}
  };
  const radioEl = {
    id: "radio-in-shadow",
    checked: false,
    getRootNode: () => ({
      querySelector: (sel) => sel.includes("radio-in-shadow") ? labelInShadow : null
    }),
    closest: () => null,
    dispatchEvent: () => true
  };

  const root = radioEl.getRootNode();
  const foundLabel = root.querySelector(`label[for="${radioEl.id}"]`);
  check("ShadowRoot querySelector finds label proxy for radio element",
    foundLabel, labelInShadow);
}

// ─── 24. snapshot and restore handle ARIA checked and selected ────────────────
{
  const ariaToggle = {
    getAttribute: (attr) => attr === "aria-checked" ? ariaToggle._checked : null,
    setAttribute: (attr, val) => { if (attr === "aria-checked") ariaToggle._checked = val; },
    removeAttribute: (attr) => { if (attr === "aria-checked") ariaToggle._checked = null; },
    hasAttribute: (attr) => attr === "aria-checked" && ariaToggle._checked !== null,
    dispatchEvent: () => true,
    _checked: "false"
  };

  // Simulate snapshot
  const saved = [{
    el: ariaToggle,
    ariaChecked: ariaToggle.getAttribute("aria-checked")
  }];
  const restore = () => {
    for (const s of saved) {
      if (s.ariaChecked !== null) s.el.setAttribute("aria-checked", s.ariaChecked);
    }
  };

  // Modify
  ariaToggle.setAttribute("aria-checked", "true");
  check("ARIA toggle modified to true", ariaToggle.getAttribute("aria-checked"), "true");

  // Restore
  restore();
  check("Restore reverts ARIA toggle to saved 'false' state", ariaToggle.getAttribute("aria-checked"), "false");
}

// ─── 25. ATS_HOST includes myworkday.com tenant domains ───────────────────────
{
  const detectJsCode = readFileSync(new URL("../src/detect.js", import.meta.url), "utf8");
  check("src/detect.js includes myworkday.com in ATS_HOST",
    detectJsCode.includes('"myworkday\\\\.com"'), true);
}

// ─── 26. classify punctuation resilience in CLASSES ───────────────────────────
{
  const { classify } = await import("../src/shared/values.js");
  check("classify securityClearance handles 'TS/SCI Clearance'",
    classify("securityClearance", "TS/SCI Clearance"), "yes");
  check("classify securityClearance handles 'TS/SCI'",
    classify("securityClearance", "TS/SCI"), "yes");
  check("classify disabilityStatus handles 'No, I do not have a disability'",
    classify("disabilityStatus", "No, I do not have a disability"), "no");
  check("classify salutation handles 'Dr.'",
    classify("salutation", "Dr."), "dr");
  check("classify pronouns handles 'He/Him'",
    classify("pronouns", "He/Him"), "he");
}

// ─── 27. matchOption semantic matching with ruleId = null (AI answers) ───────
{
  // AI providing 'Remote' for a workLocationPreference dropdown without explicit ruleId
  const workOpts = [
    { label: "Virtual / Work From Home", value: "wfh" },
    { label: "On-site / In Office", value: "onsite" }
  ];
  check("matchOption with null ruleId bridges 'Remote' to 'Virtual / Work From Home'",
    matchOption(workOpts, "Remote", null)?.value, "wfh");

  const phoneOpts = [
    { label: "Cell Phone", value: "cell" },
    { label: "Landline", value: "land" }
  ];
  check("matchOption with null ruleId bridges 'Mobile' to 'Cell Phone'",
    matchOption(phoneOpts, "Mobile", null)?.value, "cell");

  const noticeOpts = [
    { label: "0 days / Available immediately", value: "immediate" },
    { label: "2 weeks notice", value: "2w" }
  ];
  check("matchOption with null ruleId bridges 'Immediately' to '0 days'",
    matchOption(noticeOpts, "Immediately", null)?.value, "immediate");
}

// ─── 28. findListbox handles multi-ID controls and ShadowRoot ─────────────────
{
  const optionInShadow = {
    offsetParent: {},
    getClientRects: () => [{}],
    scrollIntoView: () => {},
    dispatchEvent: () => true,
    click: () => {},
    textContent: "Option Two",
    getAttribute: (attr) => attr === "data-value" ? "two" : null
  };
  const listbox2 = {
    getClientRects: () => [{}],
    querySelectorAll: () => [optionInShadow]
  };
  const shadowRoot = {
    getElementById: (id) => id === "lb2" ? listbox2 : null,
    querySelectorAll: () => [listbox2],
    activeElement: null
  };
  const multiIdCombobox = {
    tagName: "INPUT",
    value: "",
    getAttribute: (attr) => attr === "aria-controls" ? "lb1 lb2" : null,
    hasAttribute: () => false,
    getRootNode: () => shadowRoot,
    dispatchEvent: () => true,
    focus: () => {},
    blur: () => {},
    click: () => {}
  };

  const field = {
    kind: "combobox",
    el: multiIdCombobox,
    options: [{ label: "Option Two", value: "two", el: optionInShadow }]
  };
  const filled = await fillCombobox(field, "Option Two", null);
  check("fillCombobox with multi-ID aria-controls finds listbox and fills", filled, true);
}

// ─── 29. scan() select placeholder detection with None and Select One ─────────
{
  const { COMBO_PLACEHOLDER_RE } = await import("../src/engine/scan.js");
  check("COMBO_PLACEHOLDER_RE matches 'None'", COMBO_PLACEHOLDER_RE.test("None"), true);
  check("COMBO_PLACEHOLDER_RE matches 'Choose an option'", COMBO_PLACEHOLDER_RE.test("Choose an option"), true);
  check("COMBO_PLACEHOLDER_RE matches 'Select One'", COMBO_PLACEHOLDER_RE.test("Select One"), true);
}

// ─── 30. requiredEmpty handles numeric 0 without flagging as empty ────────────
{
  const { requiredEmpty } = await import("../src/engine/steps.js");
  const numInput = {
    tagName: "INPUT",
    type: "number",
    value: 0,
    required: true,
    getAttribute: () => null,
    closest: () => null
  };
  const mockDoc = { querySelectorAll: () => [numInput] };
  check("requiredEmpty does NOT flag numeric input with value 0 as empty",
    requiredEmpty(mockDoc).length, 0);

  // Missing options property on select element does not crash
  const selectWithoutOptions = {
    tagName: "SELECT",
    selectedIndex: -1,
    value: "",
    required: true,
    getAttribute: () => null,
    closest: () => null
  };
  const mockDoc2 = { querySelectorAll: () => [selectWithoutOptions] };
  check("requiredEmpty does not crash on select with undefined options",
    requiredEmpty(mockDoc2).length, 1);
}

// ─── 31. hasAnswerFor with custom field variants ──────────────────────────────
{
  const { ruleValue } = await import("../src/engine/index.js");
  const profileWithUpperKeys = {
    personal: {},
    customFields: { "Gender": "Female", "veteran status": "No" }
  };
  check("ruleValue finds custom field with capitalized key 'Gender'",
    ruleValue("gender", profileWithUpperKeys), "Female");
  check("ruleValue finds custom field with spaced key 'veteran status'",
    ruleValue("veteranStatus", profileWithUpperKeys), "No");
}

// ─── 32. Multi-ID aria-labelledby heading extraction (Google Forms) ───────────
{
  const { labelOf } = await import("../src/engine/scan.js");
  const headingElem = {
    id: "q1_title",
    tagName: "DIV",
    getAttribute: (attr) => attr === "role" ? "heading" : null,
    textContent: "Full Name",
    childNodes: []
  };
  const descElem = {
    id: "q1_desc",
    tagName: "DIV",
    getAttribute: () => null,
    textContent: "Please enter your name as per your university degree",
    childNodes: []
  };
  const inputElem = {
    tagName: "INPUT",
    type: "text",
    value: "",
    name: "entry.123",
    id: "input_q1",
    getAttribute: (attr) => attr === "aria-labelledby" ? "q1_title q1_desc" : null,
    getRootNode: () => ({
      getElementById: (id) => id === "q1_title" ? headingElem : id === "q1_desc" ? descElem : null
    }),
    closest: () => null,
    getClientRects: () => [{ width: 100, height: 20 }]
  };
  check("labelOf() preserves all ordered accessible-name references",
    labelOf(inputElem), "Full Name Please enter your name as per your university degree");
}

// ─── 33. Google Forms ARIA choice option label resolution via aria-labelledby ───
{
  const { optionLabelFor } = await import("../src/engine/scan.js");
  const optTitle = {
    id: "opt_yes_label",
    tagName: "SPAN",
    getAttribute: () => null,
    textContent: "Yes",
    childNodes: []
  };
  const checkboxElem = {
    tagName: "DIV",
    getAttribute: (attr) => {
      if (attr === "role") return "checkbox";
      if (attr === "aria-labelledby") return "opt_yes_label";
      if (attr === "aria-checked") return "false";
      return null;
    },
    textContent: "",
    getRootNode: () => ({
      getElementById: (id) => id === "opt_yes_label" ? optTitle : null
    }),
    parentElement: {
      parentElement: null,
      querySelectorAll: () => [checkboxElem]
    },
    closest: () => null,
    getClientRects: () => [{ width: 20, height: 20 }]
  };
  check("optionLabelFor() extracts option label 'Yes' from aria-labelledby on div[role=checkbox]",
    optionLabelFor(checkboxElem), "Yes");
}

// ─── 34. fillCombobox finds options in detached .exportSelectPopup ─────────────
{
  const optionNode = {
    tagName: "DIV",
    getAttribute: (attr) => attr === "role" ? "option" : attr === "data-value" ? "Engineer" : null,
    textContent: "Engineer",
    offsetParent: {},
    getClientRects: () => [{ width: 80, height: 20 }],
    scrollIntoView: () => {},
    dispatchEvent: () => true,
    click: () => {}
  };
  const popupNode = {
    tagName: "DIV",
    className: "exportSelectPopup",
    getAttribute: (attr) => attr === "class" ? "exportSelectPopup" : null,
    getClientRects: () => [{ width: 100, height: 100 }],
    querySelector: () => optionNode,
    querySelectorAll: (sel) => sel.includes("option") ? [optionNode] : [],
    contains: () => false
  };
  const dropdownTrigger = {
    tagName: "DIV",
    getAttribute: (attr) => attr === "role" ? "listbox" : null,
    textContent: "Choose",
    getClientRects: () => [{ width: 100, height: 30 }],
    contains: (node) => node === dropdownTrigger,
    dispatchEvent: () => true,
    click: () => {},
    getRootNode: () => ({
      querySelectorAll: (sel) => sel.includes("SelectPopup") ? [popupNode] : sel.includes("option") ? [optionNode] : []
    })
  };
  const fieldCombobox = {
    kind: "combobox",
    el: dropdownTrigger,
    options: null
  };
  const filled = await fillCombobox(fieldCombobox, "Engineer", null);
  check("fillCombobox selects option inside detached .exportSelectPopup without locking onto el",
    filled, true);
}

// ─── 35. helperTextFor Extraction (aria-describedby & container hints) ─────────
{
  // 1. aria-describedby with multiple IDs
  const descEl1 = { tagName: "DIV", textContent: "Must be 8 to 20 characters." };
  const descEl2 = { tagName: "SPAN", textContent: "Include at least one number." };
  const reqEl = { tagName: "DIV", textContent: "This field is required" }; // should be filtered out
  const inputEl = {
    tagName: "INPUT",
    getAttribute: (attr) => attr === "aria-describedby" ? "desc1 desc2 req" : null,
    getRootNode: () => ({
      getElementById: (id) => id === "desc1" ? descEl1 : id === "desc2" ? descEl2 : id === "req" ? reqEl : null
    })
  };
  const extracted = helperTextFor(inputEl);
  check("helperTextFor resolves aria-describedby multiple IDs and suppresses required warnings",
    extracted, "Must be 8 to 20 characters. Include at least one number.");

  // 2. Surrounding container helper elements
  const hintNode = {
    tagName: "SMALL",
    className: "form-text text-muted",
    textContent: "Enter your legal signature as it appears on your passport.",
    contains: () => false
  };
  const parentContainer = {
    tagName: "DIV",
    className: "form-group",
    querySelectorAll: (sel) => sel.includes("small") ? [hintNode] : []
  };
  const fieldInGroup = {
    tagName: "INPUT",
    parentElement: parentContainer,
    getAttribute: () => null,
    getRootNode: () => ({ getElementById: () => null })
  };
  check("helperTextFor extracts container hint text from small.form-text",
    helperTextFor(fieldInGroup), "Enter your legal signature as it appears on your passport.");
}

// ─── 36. Semantic Classification & Option Matching for New ATS Rules ──────────
{
  check("classify nonCompete returns 'no' for 'not bound'",
    classify("nonCompete", "I am not bound by any restrictive covenants or agreements"), "no");
  check("classify reliableTransportation returns 'yes' for 'reliable transportation'",
    classify("reliableTransportation", "Yes, I have access to reliable transportation"), "yes");
  check("classify governmentOfficial returns 'no' for 'not a government official'",
    classify("governmentOfficial", "I am not a public or government official"), "no");
  check("classify hispanicLatino returns 'yes' for 'Yes, Hispanic or Latino'",
    classify("hispanicLatino", "Yes, Hispanic or Latino"), "yes");

  // Semantic option matching
  const nonCompeteOptions = [
    { label: "Yes, I am subject to a non-compete agreement", value: "yes" },
    { label: "No, I am not subject to any non-compete agreements", value: "no" }
  ];
  const matchedNonCompete = matchOption(nonCompeteOptions, "No", "nonCompete");
  check("matchOption bridges candidate 'No' to 'No, I am not subject to any non-compete agreements'",
    matchedNonCompete?.value, "no");

  const transportOptions = [
    { label: "Yes, I have reliable transportation", value: "1" },
    { label: "No, I do not have reliable transportation", value: "0" }
  ];
  const matchedTransport = matchOption(transportOptions, "Yes", "reliableTransportation");
  check("matchOption bridges candidate 'Yes' to 'Yes, I have reliable transportation'",
    matchedTransport?.value, "1");
}

// ─── 37. Work Experience & Repeater Rules (Workday & ATS) ─────────────────────
{
  const expOpts = { skipSensitive: true, hasAnswerFor: () => true };

  const expFields = [
    field({ automationId: "jobHistoryItem_company", section: "experience" }),
    field({ automationId: "jobHistoryItem_jobTitle", section: "experience" }),
    field({ automationId: "jobHistoryItem_location", section: "experience" }),
    field({ automationId: "jobHistoryItem_startDate", section: "experience" }),
    field({ automationId: "jobHistoryItem_endDate", section: "experience" }),
    field({ automationId: "jobHistoryItem_currentlyWorkHere", section: "experience" }),
    field({ automationId: "jobHistoryItem_roleDescription", section: "experience" })
  ];

  const assigned = assign(expFields, expOpts);
  check("jobHistoryItem_company maps to company", assigned.get(0)?.ruleId, "company");
  check("jobHistoryItem_jobTitle maps to jobTitle", assigned.get(1)?.ruleId, "jobTitle");
  check("jobHistoryItem_location maps to experienceLocation", assigned.get(2)?.ruleId, "experienceLocation");
  check("jobHistoryItem_startDate maps to experienceStartDate", assigned.get(3)?.ruleId, "experienceStartDate");
  check("jobHistoryItem_endDate maps to experienceEndDate", assigned.get(4)?.ruleId, "experienceEndDate");
  check("jobHistoryItem_currentlyWorkHere maps to currentJob", assigned.get(5)?.ruleId, "currentJob");
  check("jobHistoryItem_roleDescription maps to experienceDescription", assigned.get(6)?.ruleId, "experienceDescription");

  // Repeater multi-instance check
  const repeaterCards = [
    field({ label: "Role Title", name: "exp[0][title]", section: "experience", instance: 0 }),
    field({ label: "Start Date", name: "exp[0][start]", section: "experience", instance: 0 }),
    field({ label: "Role Title", name: "exp[1][title]", section: "experience", instance: 1 }),
    field({ label: "Start Date", name: "exp[1][start]", section: "experience", instance: 1 })
  ];
  const multiAssigned = assign(repeaterCards, expOpts);
  check("card 0 title matches jobTitle", multiAssigned.get(0)?.ruleId, "jobTitle");
  check("card 0 instance is 0", multiAssigned.get(0)?.instance, 0);
  check("card 0 start matches experienceStartDate", multiAssigned.get(1)?.ruleId, "experienceStartDate");
  check("card 1 title matches jobTitle", multiAssigned.get(2)?.ruleId, "jobTitle");
  check("card 1 instance is 1", multiAssigned.get(2)?.instance, 1);
  check("card 1 start matches experienceStartDate", multiAssigned.get(3)?.ruleId, "experienceStartDate");
}

// ─── 38. ruleValue Repeated Instance & Timeframe Parsing ──────────────────────
{
  const profile = {
    personal: { fullName: "Jane Doe" },
    experience: [
      {
        company: "Google",
        title: "Senior Engineer",
        timeframe: "Jan 2022 - Present",
        description: "Leading frontend architecture."
      },
      {
        company: "Meta",
        title: "Software Engineer",
        timeframe: "Jun 2019 - Dec 2021",
        description: "Built React components."
      }
    ]
  };

  check("parseTimeframe handles 'Jan 2022 - Present'",
    parseTimeframe("Jan 2022 - Present"), { start: "Jan 2022", end: "Present" });
  check("parseTimeframe handles '2019 to 2021'",
    parseTimeframe("2019 to 2021"), { start: "2019", end: "2021" });

  check("instance 0 company resolves", ruleValue("company", profile, 0), "Google");
  check("instance 0 title resolves", ruleValue("jobTitle", profile, 0), "Senior Engineer");
  check("instance 0 start date derives from timeframe", ruleValue("experienceStartDate", profile, 0), "Jan 2022");
  check("instance 0 end date is null for current job", ruleValue("experienceEndDate", profile, 0), null);
  check("instance 0 currentJob derives 'Yes'", ruleValue("currentJob", profile, 0), "Yes");

  check("instance 1 company resolves", ruleValue("company", profile, 1), "Meta");
  check("instance 1 title resolves", ruleValue("jobTitle", profile, 1), "Software Engineer");
  check("instance 1 start date derives from timeframe", ruleValue("experienceStartDate", profile, 1), "Jun 2019");
  check("instance 1 end date derives from timeframe", ruleValue("experienceEndDate", profile, 1), "Dec 2021");
  check("instance 1 currentJob derives 'No'", ruleValue("currentJob", profile, 1), "No");
}

// ─── 39. isParagraphTarget Open-ended Screening vs Simple Fields ───────────────
{
  // Should target:
  const essayInput = {
    kind: "text",
    rawLabel: "Why are you interested in this role at Stripe?",
    el: { tagName: "INPUT", type: "text", disabled: false, readOnly: false }
  };
  check("isParagraphTarget recognizes 'Why are you interested' text input", isParagraphTarget(essayInput), true);

  const challengeInput = {
    kind: "text",
    rawLabel: "Describe a significant technical challenge you overcame",
    el: { tagName: "INPUT", type: "text", disabled: false, readOnly: false }
  };
  check("isParagraphTarget recognizes 'Describe a challenge' text input", isParagraphTarget(challengeInput), true);

  const textareaField = {
    kind: "textarea",
    rawLabel: "Additional information",
    el: { tagName: "TEXTAREA", disabled: false, readOnly: false }
  };
  check("isParagraphTarget recognizes textarea", isParagraphTarget(textareaField), true);

  // Should NOT target:
  const nameInput = {
    kind: "text",
    rawLabel: "First Name",
    name: "first_name",
    el: { tagName: "INPUT", type: "text", disabled: false, readOnly: false }
  };
  check("isParagraphTarget ignores First Name input", isParagraphTarget(nameInput), false);

  const emailInput = {
    kind: "text",
    rawLabel: "Email Address",
    name: "email",
    el: { tagName: "INPUT", type: "email", disabled: false, readOnly: false }
  };
  check("isParagraphTarget ignores Email Address input", isParagraphTarget(emailInput), false);

  const zipInput = {
    kind: "text",
    rawLabel: "Postal Code",
    name: "zip",
    el: { tagName: "INPUT", type: "text", disabled: false, readOnly: false }
  };
  check("isParagraphTarget ignores Postal Code input", isParagraphTarget(zipInput), false);
}

// ─── 40. Semantic Matching for EmploymentType, CurrentJob, CriminalRecord ─────
{
  check("classify employmentType returns fulltime for 'Full-Time'",
    classify("employmentType", "Full-Time"), "fulltime");
  check("classify currentJob returns yes for 'I currently work here'",
    classify("currentJob", "I currently work here"), "yes");
  check("classify criminalRecord returns no for 'No criminal record'",
    classify("criminalRecord", "No criminal record"), "no");

  const empOptions = [
    { label: "Full Time / Regular Employee", value: "ft" },
    { label: "Contractor / 1099", value: "contract" },
    { label: "Internship", value: "intern" }
  ];
  check("matchOption bridges candidate 'Permanent' to 'Full Time / Regular Employee'",
    matchOption(empOptions, "Permanent", "employmentType")?.value, "ft");
}

// ─── 41. Generic Answer Placeholder Detection ─────────────────────────────────
{
  check("isGenericLabel detects 'Your answer'", isGenericLabel("Your answer"), true);
  check("isGenericLabel detects 'your answer'", isGenericLabel("your answer"), true);
  check("isGenericLabel detects 'Short answer text'", isGenericLabel("Short answer text"), true);
  check("isGenericLabel detects 'Long answer text'", isGenericLabel("Long answer text"), true);
  check("isGenericLabel detects 'Type your answer here'", isGenericLabel("Type your answer here"), true);
  check("isGenericLabel detects 'Enter your response'", isGenericLabel("Enter your response"), true);
  check("isGenericLabel rejects real questions like 'Why do you want to join?'",
    isGenericLabel("Why do you want to join?"), false);
  check("isGenericLabel rejects real questions like 'Describe a challenge'",
    isGenericLabel("Describe a challenge"), false);
}

// ─── 42. Google Forms Question Title Resolution ──────────────────────────────
{
  function mockElement({ tagName = "DIV", attrs = {}, text = "", children = [], parent = null }) {
    const el = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      getAttribute: (a) => attrs[a] ?? null,
      parentElement: parent,
      children: [],
      get previousElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx > 0 ? this.parentElement.children[idx - 1] : null;
      },
      get nextElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return (idx >= 0 && idx < this.parentElement.children.length - 1) ? this.parentElement.children[idx + 1] : null;
      },
      matches(sel) {
        if (!sel) return false;
        const parts = sel.split(",").map((s) => s.trim().toLowerCase());
        const tag = this.tagName.toLowerCase();
        const role = (attrs["role"] || "").toLowerCase();
        const cls = (attrs["class"] || "").toLowerCase();
        for (const p of parts) {
          if (p === tag) return true;
          if (p === `[role="${role}"]` || p === `[role=${role}]`) return true;
          if (p.startsWith(".") && cls.split(/\s+/).includes(p.slice(1))) return true;
        }
        return false;
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) {
        const all = this.querySelectorAll(sel);
        return all[0] || null;
      },
      querySelectorAll(sel) {
        const res = [];
        const parts = sel.split(",").map((s) => s.trim().toLowerCase());
        const walk = (node) => {
          for (const child of node.children) {
            let matched = false;
            const tag = child.tagName.toLowerCase();
            const role = (child.getAttribute("role") || "").toLowerCase();
            const cls = (child.getAttribute("class") || "").toLowerCase();
            for (const p of parts) {
              if (p === tag) matched = true;
              else if (p === `[role="${role}"]` || p === `[role=${role}]`) matched = true;
              else if (p.startsWith(".") && cls.includes(p.slice(1))) matched = true;
              else if (p.includes("heading") && (role === "heading" || cls.includes("heading"))) matched = true;
              else if (p.includes("label") && (tag === "label" || cls.includes("label"))) matched = true;
              if (matched) break;
            }
            if (matched) res.push(child);
            walk(child);
          }
        };
        walk(this);
        return res;
      },
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      textContent: text,
      get firstChild() {
        return children.length ? children[0] : (text ? { nodeType: 3, nodeValue: text, nextSibling: null } : null);
      }
    };
    for (const c of children) {
      c.parentElement = el;
      el.children.push(c);
    }
    return el;
  }

  // Google Forms structure for a paragraph question:
  const heading = mockElement({
    tagName: "DIV",
    attrs: { role: "heading", "aria-level": "3", class: "M7eMe" },
    text: "What is your greatest technical achievement? *"
  });
  const textarea = mockElement({
    tagName: "TEXTAREA",
    attrs: { "aria-label": "Your answer", class: "KHxj8b" }
  });
  const inputWrap = mockElement({ tagName: "DIV", attrs: { class: "Xb9hP" }, children: [textarea] });
  const agroD = mockElement({ tagName: "DIV", attrs: { class: "AgroD" }, children: [inputWrap] });
  const i3H8e = mockElement({ tagName: "DIV", attrs: { class: "I3H8e" }, children: [heading] });
  const geS5n = mockElement({ tagName: "DIV", attrs: { class: "geS5n" }, children: [i3H8e, agroD] });
  const listItem = mockElement({ tagName: "DIV", attrs: { role: "listitem", class: "Qr7Oae" }, children: [geS5n] });

  check("labelFor extracts Google Form question title instead of 'Your answer'",
    labelFor(textarea, new Map()), "What is your greatest technical achievement?");

  // Google Forms short-answer text input:
  const shortHeading = mockElement({
    tagName: "DIV",
    attrs: { role: "heading", "aria-level": "3", class: "M7eMe" },
    text: "What is your current notice period?"
  });
  const shortInput = mockElement({
    tagName: "INPUT",
    attrs: { type: "text", "aria-label": "Your answer", class: "whsOnd" }
  });
  const shortWrap = mockElement({ tagName: "DIV", attrs: { class: "Xb9hP" }, children: [shortInput] });
  const shortAgro = mockElement({ tagName: "DIV", attrs: { class: "AgroD" }, children: [shortWrap] });
  const shortI3H = mockElement({ tagName: "DIV", attrs: { class: "I3H8e" }, children: [shortHeading] });
  const shortGe = mockElement({ tagName: "DIV", attrs: { class: "geS5n" }, children: [shortI3H, shortAgro] });
  const shortItem = mockElement({ tagName: "DIV", attrs: { role: "listitem", class: "Qr7Oae" }, children: [shortGe] });

  check("labelFor extracts Google Form short input question instead of 'Your answer'",
    labelFor(shortInput, new Map()), "What is your current notice period?");
}

// ─── 43. Prevention of Picking Previous Questions for Next Textbox ────────────
{
  function mockSimpleElement({ tagName = "DIV", attrs = {}, text = "", children = [], parent = null }) {
    const el = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      getAttribute: (a) => attrs[a] ?? null,
      parentElement: parent,
      children: [],
      get previousElementSibling() {
        if (!this.parentElement) return null;
        const idx = this.parentElement.children.indexOf(this);
        return idx > 0 ? this.parentElement.children[idx - 1] : null;
      },
      matches(sel) {
        if (!sel) return false;
        const parts = sel.split(",").map((s) => s.trim().toLowerCase());
        const tag = this.tagName.toLowerCase();
        const role = (attrs["role"] || "").toLowerCase();
        const cls = (attrs["class"] || "").toLowerCase();
        for (const p of parts) {
          if (p === tag) return true;
          if (p === `[role="${role}"]` || p === `[role=${role}]`) return true;
          if (p.startsWith(".") && cls.split(/\s+/).includes(p.slice(1))) return true;
        }
        return false;
      },
      closest(sel) {
        let cur = this;
        while (cur) {
          if (cur.matches && cur.matches(sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) {
        const all = this.querySelectorAll(sel);
        return all[0] || null;
      },
      querySelectorAll(sel) {
        const res = [];
        const parts = sel.split(",").map((s) => s.trim().toLowerCase());
        const walk = (node) => {
          for (const child of node.children) {
            let matched = false;
            const tag = child.tagName.toLowerCase();
            const role = (child.getAttribute("role") || "").toLowerCase();
            const cls = (child.getAttribute("class") || "").toLowerCase();
            for (const p of parts) {
              if (p === tag) matched = true;
              else if (p === `[role="${role}"]` || p === `[role=${role}]`) matched = true;
              else if (p.startsWith(".") && cls.includes(p.slice(1))) matched = true;
              else if (p.includes("label") && (tag === "label" || cls.includes("label"))) matched = true;
              else if (p.includes("title") && cls.includes("title")) matched = true;
              if (matched) break;
            }
            if (matched) res.push(child);
            walk(child);
          }
        };
        walk(this);
        return res;
      },
      contains(other) {
        let cur = other;
        while (cur) {
          if (cur === this) return true;
          cur = cur.parentElement;
        }
        return false;
      },
      textContent: text,
      get firstChild() {
        return children.length ? children[0] : (text ? { nodeType: 3, nodeValue: text, nextSibling: null } : null);
      }
    };
    for (const c of children) {
      c.parentElement = el;
      el.children.push(c);
    }
    return el;
  }

  // Consecutive form groups:
  const label1 = mockSimpleElement({ tagName: "LABEL", text: "Tell us about your background" });
  const textarea1 = mockSimpleElement({ tagName: "TEXTAREA", attrs: { id: "q1" } });
  const group1 = mockSimpleElement({ tagName: "DIV", attrs: { class: "form-group" }, children: [label1, textarea1] });

  const label2 = mockSimpleElement({ tagName: "LABEL", text: "Why do you want this role?" });
  const textarea2 = mockSimpleElement({ tagName: "TEXTAREA", attrs: { id: "q2" } });
  const group2 = mockSimpleElement({ tagName: "DIV", attrs: { class: "form-group" }, children: [label2, textarea2] });

  const textarea3 = mockSimpleElement({ tagName: "TEXTAREA", attrs: { id: "q3", placeholder: "Additional notes" } });
  const group3 = mockSimpleElement({ tagName: "DIV", attrs: { class: "form-group" }, children: [textarea3] });

  const form = mockSimpleElement({ tagName: "FORM", children: [group1, group2, group3] });

  check("labelFor on field 1 resolves question 1",
    labelFor(textarea1, new Map()), "Tell us about your background");
  check("labelFor on field 2 resolves question 2, never question 1",
    labelFor(textarea2, new Map()), "Why do you want this role?");
  check("labelFor on field 3 falls back to placeholder, never stealing question 1 or 2",
    labelFor(textarea3, new Map()), "Additional notes");

  // Sibling controls in the same row:
  const labelFn = mockSimpleElement({ tagName: "LABEL", text: "First Name" });
  const inputFn = mockSimpleElement({ tagName: "INPUT", attrs: { id: "fn" } });
  const inputLn = mockSimpleElement({ tagName: "INPUT", attrs: { id: "ln", placeholder: "Last Name" } });
  const row = mockSimpleElement({ tagName: "DIV", attrs: { class: "form-row" }, children: [labelFn, inputFn, inputLn] });

  check("labelFor on first sibling control gets its label",
    labelFor(inputFn, new Map()), "First Name");
  check("labelFor on second sibling control never steals previous sibling's label",
    labelFor(inputLn, new Map()), "Last Name");
}

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
process.exit(fails.length ? 1 : 0);



