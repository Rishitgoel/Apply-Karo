# Chrome Web Store submission

Everything the dashboard asks for, written out. Not shipped in the package —
this is a checklist and a copy source.

## Before you submit

- [ ] Host `PRIVACY.md` somewhere public and paste the URL into **Privacy
      practices → Privacy policy URL**. A GitHub repo file view or a GitHub
      Pages site is fine. This field is required and a submission without it is
      rejected without review.
- [ ] `node build.mjs`, then upload `dist/apply-karo-2.1.0.zip`.
- [ ] Screenshots: 1280×800 or 640×400, at least one, up to five.
- [ ] Small promo tile: 440×280.
- [ ] Confirm the resume PDF is not in the zip. The build refuses to include
      one, but look at the file list it prints anyway.

Expect the first review to take longer than the published estimate. An
extension with broad host access and a file upload feature gets a human
reviewer, and a rejection usually names one permission whose justification was
thin rather than anything in the code.

## Single purpose

> Apply karo fills in job application forms. It detects application forms on
> job boards and company career sites, fills them from a profile the user
> enters once, attaches their resume file, and keeps a log of what they applied
> to.

Keep this narrow when you paste it. The store rejects a stated purpose broad
enough to cover unrelated features, and everything in this extension genuinely
serves the one above.

## Permission justifications

**`storage`**

> Stores the user's profile — name, contact details, work history, education —
> along with their settings and the log of applications they have filled. All
> of it stays on the user's own device. The extension has no server and no
> account system, so this is the only place the data it needs can live.

**`unlimitedStorage`**

> The user's resume PDF is held in extension storage so it can be attached to
> application forms that ask for a file. A resume commonly exceeds the default
> quota once encoded, and hitting that quota silently breaks the single feature
> users install the extension for.

**`activeTab`**

> Used when the user explicitly invokes the extension — clicking the toolbar
> button or pressing the keyboard shortcut — so it can fill the form on the tab
> they are currently looking at. It is not used in the background.

**Host permission: `https://generativelanguage.googleapis.com/*`**

> The optional AI features send a request to Google's Gemini API using an API
> key the user supplies themselves. Off by default; only ever runs when the
> user presses a button.

**Host permission: `https://api.groq.com/*`**

> The same optional AI features, for users who choose Groq as their provider
> instead of Google. The user supplies their own API key. Off by default.

**Content scripts on `http://*/*` and `https://*/*`**

This is the one that draws scrutiny, so justify it concretely:

> Job applications are not hosted on a predictable set of domains. The major
> applicant tracking systems (Greenhouse, Lever, Workday, Ashby, iCIMS and a
> dozen others) are frequently served from the employer's own domain rather
> than the vendor's, and many employers run applications through a Google Form
> or Typeform. There is no host list that would cover a meaningful share of the
> forms users need filled.
>
> The script actually injected everywhere is a 3 KB detection sentinel. On a
> page that is not an application it runs a single regular expression against
> the URL and stops, without reading page content, registering observers, or
> loading any other code. The rest of the extension — roughly 40 KB — is
> dynamically imported only after that check passes. Page content is read only
> to locate and fill form fields, and is never transmitted anywhere except in
> the user-initiated AI cases described above.

**`all_frames: true`**

> Applicant tracking systems routinely embed the application form in an iframe
> on the employer's careers page. Without frame access the extension cannot see
> the form on a large share of real postings.

## Data disclosures

Tick **Personally identifiable information** (name, address, email, phone),
**Authentication information** (the user's own API keys), and **Personal
communications** if you read the cover letter feature that way. Then all three
certifications:

- Not being sold to third parties — true, there is no third party.
- Not being used or transferred for a purpose unrelated to the single purpose —
  true.
- Not being used or transferred to determine creditworthiness or for lending —
  true.

The one thing to be careful about: the AI features do transfer user data to
Google or Groq. That is disclosed in the privacy policy, it happens on the
user's own API key, and it directly serves the single purpose — but do not
answer these questions as though no data ever leaves the device, because on the
AI path it does.

## Listing copy

**Short description** (132 characters max):

> Fill job applications in one keypress. Detects the form, fills it from your
> profile, attaches your resume, tracks what you sent.

**Category:** Productivity · **Language:** English

For the long description, the top of `README.md` is close to right already —
lead with what it does, keep the "it never submits an application" promise
prominent, and say plainly that data stays on the device. Reviewers read the
listing against the permissions, and a listing that undersells why you need
broad host access invites the question.
