# Apply karo

One-key autofill for job applications. Made by Rishit Goel.

## Load it

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. The dashboard opens on first install. The profile ships empty — upload your
   resume PDF and press **Fill profile from resume**, then check what it read
   before you apply to anything with it.

If you had v1 installed, your saved profile, resume and learned mappings migrate
automatically on first run — nothing to re-enter.

## Use it

- Pages are filled automatically once detected as an application.
- **Alt + Shift + F** fills on demand, on any page — including one detection
  skipped. It is a real browser shortcut, declared in the manifest and
  dispatched from the service worker, so it works before the engine has loaded.
  Rebind or clear it at `chrome://extensions/shortcuts`.
- The corner button opens a panel: *Fill this page*, *Steps*, *Undo*,
  *Highlight what's still empty*, *Draft a cover letter*, *Edit profile*,
  *Turn off on this site*. Drag its handle if a site puts its own chat bubble
  in the same corner.
- The toolbar popup shows what it can see on the page, forces a fill on one
  detection skipped, swaps in a new resume PDF without opening the dashboard,
  and switches the extension off for the current site.
- It is also where you *Capture* the job description while you are reading it,
  then ask for a *Match me* or a *Cover letter* — from there, or from the form
  two clicks later, or from any page at all. See
  [The posting](#the-posting-and-where-it-actually-lives).

Green outline = filled from a rule. Amber = an AI draft or uncertain result that needs review. An evidence reference does not guarantee every claim in a draft is true.

Toolbar Fill, the browser shortcut and the page panel now start the same background-owned job. Closing the popup does not cancel it. Reopen it to see progress or the result. Interrupted jobs with an unknown outcome require review before retrying.

Older learned/custom answers are preserved but excluded from reuse until you confirm them in Dashboard → Settings → Legacy answers. Newly generated AI answers remain drafts; they are not automatically saved as approved answers. Existing model selections are preserved; a retired model shows an actionable error so you can choose a replacement.

**Your resume is attached for you.** A fill also uploads the PDF from the Resume
tab into the form's file box, so the one field that used to need a file dialog no
longer does. Turn it off in Dashboard → Settings.

The awkward part is not the upload, it is knowing *which* box. Every ATS hides
the real `<input type=file>` behind a styled button or drop zone — `display:none`
on Greenhouse, a 1×1 box on Workday, `opacity:0` under a label on Lever — so the
control carries none of the words a human reads. The scanner takes those from the
wrapper instead, and the choice is then deliberately conservative: a box that says
resume or CV gets it; so does a lone upload on an application form; a photo,
portfolio or cover-letter box never does, and neither does a box whose `accept`
list excludes your file's type. Given several unlabelled boxes and nothing to tell
them apart, it fills none of them and leaves you the click — a resume in the slot
meant for something else is worse than a slot left empty. Nothing is uploaded
twice, and *Undo* clears the file along with everything else.

**It never submits an application.** Nothing here clicks a Submit, Apply or
Finish button, in any mode — you review the form and send it yourself. The
multi-step mode clicks *Next* only, under the guards described below.

**Undo.** Every value written records how to put the control back, so one press
returns the page to exactly the state it was found in. Autofill's worst failure
is not a blank box, it is a confident wrong answer you did not notice.

## Beyond filling

| Feature | Where |
| --- | --- |
| **Captured postings.** The job description is on the listing page; the form you apply on is two clicks later and does not repeat it. *Capture* stores the posting while you are looking at it, and the match and the letter use it from anywhere afterwards. See below. | Popup → *Capture*, or *Paste* |
| **Job match.** Compares you against the captured posting and reports what you meet, what you're missing and what to lead with. See below. | Popup → *Match me*, or Panel → *Match me against this job* |
| **Application tracker.** Every page you fill is logged — company, role, site, fields filled, and the match score if you ran one — with a status you set as you hear back, plus CSV export. | Dashboard → Applications |
| **Follow-up nudges.** Anything sitting at *Applied* or *Interview* with no update for two weeks is surfaced. No model, no network — the timestamp is already on the row. | Dashboard → Overview |
| **Duplicate warning.** Opening the panel on an employer already in your tracker tells you when you last applied and for what. | The panel |
| **Cover letters.** A draft built from your real experience and the captured posting. *Put it in the form* types it into the page's cover-letter box; every draft is saved to the dashboard whether you use it or not. | Popup → *Cover letter*, the panel, and Dashboard → Cover letters |
| **Profile readiness.** A weighted checklist of what is still missing and what each gap costs you. | Dashboard → Overview, and the popup |
| **Per-site off switch.** Hostnames the extension ignores entirely — no panel, no automatic fill, no observer. | Popup switch, or Dashboard → Settings |
| **Backup.** Export/import profile, learned answers, settings and the application log as JSON. API keys are excluded unless you ask for them. | Dashboard → Settings |
| **Theme.** Light, dark or follow the system, applied to the dashboard, popup and on-page panel alike. | Header switch, or the popup |

The toolbar icon carries the number of fields filled on the current tab, and
clears itself when you navigate.

## How it works

**The form is often not in the page you are looking at.** Greenhouse, Lever,
Workable and SmartRecruiters all ship an embed, and employers use it: the careers
page is theirs and the application is a third-party iframe inside it. That breaks
two assumptions at once. The top frame has no fields, so it loaded no engine and
the corner panel never appeared; and `chrome.tabs.sendMessage` broadcasts to
every frame but keeps only the *first* reply, so the popup either reported the
top frame's zero or got a closed port and said "Chrome blocks extensions here" —
while the iframe had just filled twenty fields.

So a fill is coordinated by the service worker rather than answered down the
broadcast channel: every frame that takes part acknowledges, does its share, and
reports separately, and the totals are added up. Detection also loads the engine
into a top frame that merely *contains* an ATS iframe, so the panel is there.
Only the top frame writes the tracker row — the frame doing the work would file
it under greenhouse.io rather than under the employer whose page you were on.

This deliberately does not use `window.postMessage` between frames, which would
have been less code. Page script can post messages too, and a fill spends your
real name, address and phone number — "a page cannot ask for one" is worth more
than the saving.

Two tiers keep application filling separate from lightweight page detection:

| File | Role |
| --- | --- |
| `src/detect.js` | The auto-injected detector checks known hosts/URLs and performs a bounded structural probe for unfamiliar employment forms. |
| `src/engine/*` | Scanner, matcher, filler, panel. Dynamically imported **only** when detection passes. |
| `src/shared/rules.js` | Field definitions + the scoring matcher + ATS adapters. |
| `src/shared/values.js` | Vocabulary bridging, date parsing, phone splitting. |
| `src/engine/steps.js` | Multi-step navigation and its guards, kept separate so they are testable alone. |
| `src/shared/schema.js` | Profile schema and storage. The resume binary, the application log, the captured posting and saved letters each live under their own key, so a content script never loads what it will not read. |
| `src/shared/posting.js` | Reads a job description and an employer off a page. Outside the engine because the page holding the description is the listing page, which has no form on it — the service worker injects this into the tab on its own. |
| `src/shared/theme.js` | Resolves light/dark/system onto `<html data-theme>`. |
| `src/shared/icons.js` | One 16px icon grid shared by the popup, dashboard and panel, so the three cannot drift into different visual languages. |
| `src/shared/ui.js` | Toasts and modal dialogs, replacing `alert` / `confirm` / `prompt`. |
| `background.js` | Model proxy, badge, and storage migration. The API key never enters a page context. |

Matching scores every (field, rule) pair across independent signals — `autocomplete`
attribute, name/id tokens, visible label, input type, placeholder, section heading —
then assigns globally, best pairs first. A generic rule cannot steal a field from a
specific one, because the specific rule scores higher on it.

## What gets detected

Known ATS hosts, job-shaped URLs and form builders receive a structural probe.
Unfamiliar pages can also qualify through employment context and real controls.
Login, search and checkout fixtures stay excluded. Observation is bounded;
manual activation remains available when automatic detection misses a form.

The host list covers the five big boards (Greenhouse, Lever, Workday, Ashby,
SmartRecruiters), the mid-market SaaS boards, the enterprise HCM suites where the
long badly-labelled applications actually live — SuccessFactors, Oracle
Recruiting, Cornerstone, Dayforce, UKG, ADP WorkforceNow, Taleo, Brassring — and
the regional volume boards (Zoho Recruit, Darwinbox, Freshteam, Instahyre, Gupy).

Two details in that list are deliberate and worth keeping that way:

- **`smartapply.indeed.com` is listed; `indeed.com` is not.** A host in this list
  means "a form here is an application by definition", and Indeed's search page
  has two fillable boxes. Listing the bare host would autofill somebody's name
  into a job search.
- **The hostname is searched for job words, not just the path.** A company's own
  board is at `careers.acme.com` or `jobs.acme.com` and its landing path is `/`,
  so a path-only test gated out the entire self-hosted category — which is a
  large share of where applications actually are.

Passing a gate only earns a structural probe; the probe still has to find real
controls, and on a general form builder it also has to find words that read as a
job application, because a Google Form is just as likely to be a lunch order.

The probe looks inside open shadow roots when the light DOM comes back empty.
`querySelectorAll` does not cross a shadow boundary, so a form built out of
custom elements looked like a blank page — and the engine, which does understand
shadow DOM, was never loaded to find out otherwise.

Single-page boards get a mutation watcher, budgeted by *batches that actually
brought in form controls* rather than by batches. A React board burns thirty
undifferentiated batches during hydration alone, long before the form renders,
so the old budget was routinely spent before there was anything to find. A
client-side route change resets it, because browsing a board and then opening a
posting is one of the most ordinary ways to arrive at an application.

## Tests

```bash
npm test
npm run eval:phase2
npm run eval:phase3
npm run eval:phase4
npm run eval:phase5
npm run eval:lifecycle
npm run build
```

Phase 2 preserves complete questions and ordered accessible labels, uses Unicode
and section-aware answer keys, and detects question/option revisions. Supported
dropdowns use owned menus, delayed and virtualized options, clear option matches
and selection readback. Uncommitted search text does not count as a selection.
Prose-field popovers offer **Correct detected question**; fixes apply to the
original question on that application URL. Large AI queues report deferred work
instead of silently stopping at 80 fields; quota/cancellation requires another
manual Fill pass. Review every result and submit manually.

The automated browser suite uses synthetic ATS fixtures and fake providers.
It does not establish live Workday compatibility or 90% time savings. Current
results and remaining acceptance gates are in
[the Phase 2 report](docs/evidence/phase2/REPORT.md). `eval:strict` retains broader
accuracy, write-verification and custom-widget learning gates that remain open.

Phase 3 adds **Verified knowledge** under Learned answers: review resume proposals,
use **Ask once: common details**, and manage application-scoped corrections with
export, deletion and undo. Resume extraction proposes changes for confirmation.
Concurrent tabs send incremental updates to the worker's IndexedDB repository;
profile/resume/job changes invalidate dependent answers. Imported approvals need
review again. See [Phase 3 evidence](docs/evidence/phase3/REPORT.md) for coverage and
the remaining resolver/live-acceptance limits.

Phase 4 routes every scanned field through the shared resolver. Confirmed facts
and exact approved answers require no model request; ambiguous fields use small
candidate/evidence batches and stable field/option IDs. Unsupported facts stay
blank, and grounded or semantically reused prose remains a draft to review.
Selected-model requests have shared time/request/estimated-token budgets,
cancellation and dependency-aware caches. See [Phase 4 evidence](docs/evidence/phase4/REPORT.md).
Autofill uses current resume text: extract or paste text in the dashboard after
changing a PDF. Human prose relevance and 90% time savings remain unmeasured.

Phase 5 verifies canonical values after the page settles, checks exposed native
and ARIA validation, and keeps later edits during filling and undo. Dynamic
follow-ups rescan changed regions. Recognized Workday repeat controls can add
missing employment/education blocks with bounds and guarded undo; ambiguous
entity matches stay untouched. Submit-typed Next buttons require manual action.
See [Phase 5 evidence](docs/evidence/phase5/REPORT.md) for the supported-control
fixture gate and remaining live acceptance work.

Phase 6 adds a four-state review list, field focus across embedded frames, explicit
application/personal-question memory scopes, trusted custom-widget correction
learning, guarded source undo, knowledge search/edit/delete and redacted issue
reports. Use `npm run eval:phase6` for the real-extension regression checks.
See [Phase 6 evidence](docs/evidence/phase6/REPORT.md); human review timing and
seeded-error detection remain pending. Reload the extension and application page
to use the new review panel.

Phase 7 adds packaged ZIP evaluation, stable/pilot/pause release controls, a
fictional-data provider probe and a paired-trial recorder. The overall coverage
gate and human 90% time-saving target remain open. Use `npm run trials` for the
recorder and Settings → Release controls for the provider probe. See
[Phase 7 evidence](docs/evidence/phase7/REPORT.md) for measured results and limits.

DOM behaviour is covered by browser harnesses: `harness.html` for scanning
(23 checks), `harness2.html` for the features below including the submit guards
and job-description extraction (47 checks), `upload-harness.html` for resume
attachment against the markup Greenhouse, Lever and Workday actually ship — the
hidden input, the drop zone, the photo box next door (19 checks) — and
`harden-harness.html` for the controls that used to be invisible: consent
checkboxes, ARIA switches, read-only date boxes, on-blur validation (33 checks).
All import the real modules — nothing is reimplemented in the test.

```bash
python -m http.server 8731
```

Then open `http://127.0.0.1:8731/test/harness.html`, `…/harness2.html`,
`…/upload-harness.html` and `…/harden-harness.html`. Each page's title reports
PASS or FAIL.

`embed-harness.html` is the embedded-board case: a careers page whose form lives
in an iframe, asserting that the top frame has nothing to fill, that detection
notices the embed anyway, and that the tab's count comes out as the iframe's
rather than the top frame's zero (17 checks).

`dashboard-harness.html` is a viewer rather than a suite: it mounts the real
`options.html` and `options.js` against a stubbed `chrome.*` so the dashboard can
be used without packing the extension. `?s=none|read|stale|pasted` switches the
resume state. It is deliberately not assertions — what goes wrong in 1 400 lines
of DOM wiring is visual (a button in the wrong order, a card claiming a resume
has been read when it has not), and that does not survive being reduced to a
boolean.

Every harness imports its modules through a per-load cache buster. A module graph
is keyed by URL, so a plain reload re-runs the page against whatever copy the
browser already had — and a green result from a stale module is a pass for code
that is not the code you just wrote, which is a worse failure than a red one.

## Repeated sections, dates, phones and steps

**Repeated blocks.** A form asking for three schools renders three identical
cards. The scanner gives each field a `{ group, index }` so an indexable rule
(`education[0].school`) claims one slot *per card*, reading `education[1]`,
`education[2]` and so on. Repeat blocks are identified by the set of control
names they contain — tag and class alone would make every sibling `<fieldset>`
on a form look like a repeat.

**Phone.** When a form has a separate dialling-code control, the code goes there
(matched by digits, so "+91", "91" and "India (+91)" all work) and the number box
gets the national part only. With no code field, the number keeps its prefix.

**Dates.** `May 2027` is parsed once and rendered per control:
`input[type=date]` → `2027-05-01`, `input[type=month]` → `2027-05`, a text box
with a `MM/YYYY` placeholder → `05/2027`, and adjacent month/day/year selects are
merged into a single field and filled part by part.

**Multi-step.** *Fill and continue through steps* fills a step, clicks Next, and
repeats. **It never submits.** Four guards:

1. Anything whose label looks like a final submit is never clicked — "Submit",
   "Apply Now", "Finish", "Complete Application", "Agree and…".
2. A `type="submit"` control is only clicked when the page shows a genuine step
   indicator (`aria-current="step"`, a progress bar, "Step 2 of 4"). Such a
   button advances a step on a wizard and *sends the application* on an ordinary
   form, and the markup alone cannot tell you which — so without that evidence
   it stops and tells you to click it yourself.
3. It stops rather than advancing if a required field is still empty.
4. A hard step cap, and it stops the moment the page fails to change.

Every button it clicks is listed in the panel afterwards, and it always ends by
handing the submit back to you.

**Corrections.** When you overwrite a value it filled, that (field, rule) pairing
is demoted by 60 points next time — enough to beat a name or label match, not
enough to override an `autocomplete` attribute or a known ATS field. Demotions
are keyed by label, not by site, so correcting a question once carries to the
next board that asks it.

## The posting, and where it actually lives

Almost no application form carries the job description. You read the posting on
the listing page, press *Apply now*, and land on a form that repeats the company
boilerplate at best — so a feature that reads "the page you are standing on" is
blank at exactly the moment you want it. That was the old behaviour, and it
reported it as *Couldn't find a job description on this page*.

So the description is captured and stored. **Capture** in the popup reads the
posting off the page you are looking at; **Paste** takes one by hand, for a
posting behind a *read more*, in a PDF, or in an email. One slot, not a list —
you apply to one job at a time, and a list would turn a single press into a
picker. It is kept until you capture the next one or press the bin.

Capture does not need the fill engine, and deliberately so: a listing page has
no form on it, detection ignores it, and injecting a fill engine into a page
with nothing to fill would be all cost. The service worker injects the reader on
its own instead — into every frame, because an embedded board puts the
description in an iframe as often as not, and the longest answer wins.

After that the match and the letter run from the stored posting, so they work on
the form page, on a page you have already navigated away from, or with no tab
open at all. The panel still prefers a description on the page under it when
there is one — that is the most specific thing available — except against a
posting you captured by hand in the last twelve hours, which is an explicit
statement of which job this is. An application form's *About us* section quietly
replacing the description you captured two clicks ago is the failure that rule
exists to prevent.

Both requests run in the service worker and write their result to storage before
replying. A toolbar popup closes the moment you click the page behind it, and a
letter takes most of a minute; reopening the popup shows what landed while it
was shut.

## Matching yourself against a posting

*Match me* compares the captured posting against your resume. It answers two
questions: is this worth applying to, and what should you say if you do.

The number is the least interesting part of the output, so it is not the part
the model produces. The model returns two lists — requirements your resume
evidences, each with the evidence to point at, and requirements it does not,
each graded `blocking`, `important` or `minor`. The score is then computed from
those lists, weighted so a blocking gap costs ten times a minor one. Asking a
model for a percentage directly invites a confident 90% sitting above two
disqualifying gaps; deriving it means the headline can never contradict the
detail underneath it.

**The form is kept out of the posting.** On an ATS the application form sits in
the same container as the description, and field labels — "Work authorization",
"Years of experience" — read to a model exactly like stated requirements. Left
in, the comparison scores you against the form it is about to fill in. The
extractor clones the container and strips every control, label and button before
anything is sent.

**What it is not.** No employer's ranker works this way, and a tool claiming an
"87% ATS match" is inventing a number. This measures whether a careful reader
would find the posting's stated requirements evidenced in your resume. Treat it
as directional.

Running a match also improves the cover letter: the letter is then built from
the matched requirements and the evidence for them, and is told not to claim
anything the comparison found no evidence for.

Both cost one model call and run only when you press the button — never on the
automatic path.

## Same field, different control

A site renders "Degree" as a dropdown; the next one as a text box. Adapting the
*control* is easy — `fillSync` switches on the control kind. The harder half is
that a dropdown does not accept your words, it accepts its own: your `B.Tech`
scores near zero against `Bachelor's Degree` under plain string similarity, so
the dropdown silently stays empty.

`values.js` maps both sides onto a canonical class. One stored value of `B.Tech`:

| Control | Result |
| --- | --- |
| Greenhouse dropdown | `Bachelor's Degree` |
| Workday dropdown | `Bachelor of Technology` |
| Plain text box | `B.Tech` |

Same for yes/no (`No` → "No, I do not require sponsorship"), EEO opt-outs,
coded dropdowns (`India` selects the option whose submitted value is `IN`), and
numeric buckets (`4` → "3-5 years").

```bash
node test/compare-v1.mjs
```

Runs the same cases through the v1 engine in `test/legacy/` for comparison.

## Packaging

```bash
node build.mjs
```

Writes `dist/apply-karo-<version>.zip`, ready to upload. No dependencies — the
zip is written with `zlib`, so packaging never needs an install step.

The file list in `build.mjs` is an **allowlist**, which is the entire point of
having a script rather than zipping the folder. A denylist is one forgotten
entry away from shipping something private, and it fails silently: the upload
succeeds and you find out later. So adding a source file to the extension means
adding it to `SHIP_FILES` or `SHIP_DIRS` too, and the build refuses to run if
the manifest names a file that is not in the zip.

Nothing under `test/`, no `.pdf`, and no `.claude/` can reach the package —
those are rejected by a second check even if an allowlisted directory somehow
contains them.

**Never commit a real resume to this repo.** `.gitignore` excludes `*.pdf` for
that reason: a copy in the repo ships to everyone who unpacks the zip and stays
in the git history permanently.

## AI (optional, off by default)

Pick a provider in the dashboard, add its key, and turn on *Use AI for unknown
fields*. The model then answers everything the rule engine could not, but only
when you press Fill — it never runs on the automatic path.

| Provider | Key from | Reads PDFs |
| --- | --- | --- |
| Google Gemini | aistudio.google.com/apikey | yes |
| Groq | console.groq.com/keys | no |

**The model field takes free text.** A few suggestions are offered per provider,
but you can type any id the provider accepts — `moonshotai/kimi-k2-instruct`,
`openai/gpt-oss-120b`, a model released next week. *Test key & model* checks
exactly what is on screen, so a wrong id surfaces there rather than mid-application.

Keys and model names are stored per provider, so switching between them loses
neither. Groq cannot read a PDF; on Groq, either paste your resume text into the
dashboard or keep a Gemini key around to do the parsing.

**It drafts, you edit.** The instruction is to answer every field rather than
leave blanks, and to infer from the resume where a question is implied but not
stated. Anything it is unsure of gets an amber outline. One line stays strict:
it must never invent employers, titles, dates, degrees, GPAs, certifications or
visa status, because those are checkable and a wrong one is your problem, not
the model's. Those come from your profile and resume verbatim or not at all.

Your resume is read to text as soon as you upload it, and cached. That text is
what the model answers from; the PDF itself is only what gets attached to upload
boxes. The two are easy to confuse, so the Resume tab says outright whether the
file has been read, and the service worker reads it on demand as a backstop.

**The text is stamped with the file it came from.** Replacing your resume used to
leave the previous one's text in place, and everything downstream took it: the AI
answered from the resume you had just swapped out, and so did the cover letter
and the job match. Nothing on screen said so, because "is there text" was the
only question anyone asked. The stamp turns that into "is this text about the
resume that is stored now" — which the dashboard reports, and which makes a
re-read decidable instead of a guess. Text you typed or pasted claims no file and
is never treated as stale, because on a provider that cannot read a PDF it is the
only copy there is.

Prose answers are written to a house style aimed at not reading as machine
output: varied sentence length, concrete specifics over adjectives, no
"I am excited to", no *leverage / delve / spearhead / tapestry*, no
*Moreover / Furthermore*, no em dashes, and no tidy summarising last line.
AI output is not automatically remembered. Explicitly saved answers and trusted native-control corrections may be reused. Missing declarations, eligibility facts and preferences remain unresolved rather than receiving guessed defaults.

## Privacy

Your data stays on your machine. There is no server, no account and no
analytics, and the extension makes no network request at all unless you have
turned on an AI feature and pressed a button that uses one — at which point the
request goes from your browser straight to Google or Groq on your own API key,
and never through anything of mine.

The full policy is [PRIVACY.md](PRIVACY.md), and ships as `privacy.html` so it
is readable offline from Dashboard → Settings → Privacy. **The two are separate
copies — update both.** The markdown is the one to host for the Chrome Web Store
listing's privacy policy URL, which is a required field for an extension that
handles personal data.

## Licence

MIT — see [LICENSE](LICENSE). The bundled Inter typeface is under the SIL Open
Font License; see `fonts/LICENSE.txt`.

## Found a bug?

Email **rishitgoel259@gmail.com** — bugs, errors, ideas, or a site that filled
the wrong box. There are links in three places that prefill the version, the
browser and the site you were on, which is most of what makes a report
reproducible: the popup footer, the *Report a bug* button in Settings, and the
on-page panel.

The single most useful thing you can include is the URL of the form that
misbehaved. Most fixes are a new rule for one ATS, and that is impossible to
write without knowing which one.
