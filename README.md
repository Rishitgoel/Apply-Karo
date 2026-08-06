# ResumeFiler

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
- **Alt + Shift + F** fills on demand, anywhere.
- The corner button opens a panel: *Fill this page*, *Steps*, *Undo*,
  *Highlight what's still empty*, *Draft a cover letter*, *Edit profile*,
  *Turn off on this site*. Drag its handle if a site puts its own chat bubble
  in the same corner.
- The toolbar popup shows what it can see on the page, forces a fill on one
  detection skipped, swaps in a new resume PDF without opening the dashboard,
  and switches the extension off for the current site.

Green outline = filled from a rule. Amber = a low-confidence guess worth checking.

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
| **Job match.** Compares you against the posting on screen and reports what you meet, what you're missing and what to lead with. See below. | Panel → *Match me against this job* |
| **Application tracker.** Every page you fill is logged — company, role, site, fields filled, and the match score if you ran one — with a status you set as you hear back, plus CSV export. | Dashboard → Applications |
| **Follow-up nudges.** Anything sitting at *Applied* or *Interview* with no update for two weeks is surfaced. No model, no network — the timestamp is already on the row. | Dashboard → Overview |
| **Duplicate warning.** Opening the panel on an employer already in your tracker tells you when you last applied and for what. | The panel |
| **Cover letters.** Paste a posting and get a draft built from your real experience; on an application page the panel reads the posting itself and types the letter into the form. | Dashboard → Cover letters, and the panel |
| **Profile readiness.** A weighted checklist of what is still missing and what each gap costs you. | Dashboard → Overview, and the popup |
| **Per-site off switch.** Hostnames the extension ignores entirely — no panel, no automatic fill, no observer. | Popup switch, or Dashboard → Settings |
| **Backup.** Export/import profile, learned answers, settings and the application log as JSON. API keys are excluded unless you ask for them. | Dashboard → Settings |
| **Theme.** Light, dark or follow the system, applied to the dashboard, popup and on-page panel alike. | Header switch, or the popup |

The toolbar icon carries the number of fields filled on the current tab, and
clears itself when you navigate.

## How it works

Two tiers, so the extension costs nothing on pages that are not applications:

| File | Role |
| --- | --- |
| `src/detect.js` | The only auto-injected script. ~3 KB, runs in every frame, decides whether this is an application. On a normal page it costs one regex test and stops. |
| `src/engine/*` | Scanner, matcher, filler, panel. Dynamically imported **only** when detection passes. |
| `src/shared/rules.js` | Field definitions + the scoring matcher + ATS adapters. |
| `src/shared/values.js` | Vocabulary bridging, date parsing, phone splitting. |
| `src/engine/steps.js` | Multi-step navigation and its guards, kept separate so they are testable alone. |
| `src/shared/schema.js` | Profile schema and storage. The resume binary, the application log and saved letters each live under their own key, so a content script never loads what it will not read. |
| `src/shared/theme.js` | Resolves light/dark/system onto `<html data-theme>`. |
| `src/shared/icons.js` | One 16px icon grid shared by the popup, dashboard and panel, so the three cannot drift into different visual languages. |
| `src/shared/ui.js` | Toasts and modal dialogs, replacing `alert` / `confirm` / `prompt`. |
| `background.js` | Model proxy, badge, and storage migration. The API key never enters a page context. |

Matching scores every (field, rule) pair across independent signals — `autocomplete`
attribute, name/id tokens, visible label, input type, placeholder, section heading —
then assigns globally, best pairs first. A generic rule cannot steal a field from a
specific one, because the specific rule scores higher on it.

## Tests

```bash
for t in detect ai match values features upload jobmatch; do node test/$t.test.mjs; done
```

257 cases: field matching against real Greenhouse / Lever / Workday / Ashby
markup, the dropdown-vs-text-box problem below, plus repeated sections, phone
splitting, date parsing, correction demotion, resume-upload targeting, and the
job-match scoring described below.

DOM behaviour is covered by browser harnesses: `harness.html` for scanning
(23 checks), `harness2.html` for the features below including the submit guards
and job-description extraction (47 checks), and `upload-harness.html` for resume
attachment against the markup Greenhouse, Lever and Workday actually ship — the
hidden input, the drop zone, the photo box next door (19 checks). All import the
real modules — nothing is reimplemented in the test.

```bash
python -m http.server 8731
```

Then open `http://127.0.0.1:8731/test/harness.html`, `…/harness2.html` and
`…/upload-harness.html`. Each page's title reports PASS or FAIL, so a stale
module cache shows up as a failure rather than a wrong green.

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

## Matching yourself against a posting

*Match me against this job* reads the posting you are standing on and compares it
against your resume. It answers two questions: is this worth applying to, and
what should you say if you do.

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
Nothing under `test/` ships — exclude the whole directory when you package.

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

Your resume is parsed to text automatically the first time the AI runs, and
cached. Previously this only happened if you pressed *Parse Resume Text* by
hand, so in practice the model was answering from the profile summary alone —
which is why it left most open questions empty.

Prose answers are written to a house style aimed at not reading as machine
output: varied sentence length, concrete specifics over adjectives, no
"I am excited to", no *leverage / delve / spearhead / tapestry*, no
*Moreover / Furthermore*, no em dashes, and no tidy summarising last line.
Short factual answers ("Yes", "30 days") are remembered for next time; prose
never is, so the same essay is not replayed across applications.

## Found a bug?

Email **rishitgoel259@gmail.com** — bugs, errors, ideas, or a site that filled
the wrong box. There are links in three places that prefill the version, the
browser and the site you were on, which is most of what makes a report
reproducible: the popup footer, the *Report a bug* button in Settings, and the
on-page panel.

The single most useful thing you can include is the URL of the form that
misbehaved. Most fixes are a new rule for one ATS, and that is impossible to
write without knowing which one.
