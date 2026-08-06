# Privacy Policy — Apply karo

**Last updated: 6 August 2026**

Apply karo is a Chrome extension that fills in job application forms. It is
built and maintained by one person, Rishit Goel, and can be reached at
**rishitgoel259@gmail.com**.

The short version: your data stays on your computer. There is no Apply karo
server, no account, and no analytics. The only time anything leaves your machine
is when you have turned on the optional AI features and pressed a button that
uses one — and then it goes to the AI provider you chose, using your own API
key, not to me.

## What the extension stores

All of it lives in `chrome.storage.local` on the device where you installed the
extension. It is not synced to your Google account and it is not uploaded
anywhere.

| What | Why it exists |
| --- | --- |
| Your profile — name, email, phone, address, work history, education, skills, links, work authorization, and any custom answers you add | These are the values written into application forms |
| Your resume PDF, and the text extracted from it | Attached to forms that ask for a file; the text is what the AI features read |
| Learned answers and corrections | So a question you answered or corrected once is answered the same way next time |
| Your application log — company, role, site, URL, page title, how many fields were filled, when, the status you set, and the match score if you ran one | The tracker and the follow-up reminders in the dashboard |
| Cover letters you generate | So you can reread and reuse them |
| Settings, including your API keys and the list of sites you switched the extension off on | To work the way you configured it |

Nothing is stored about pages you merely visit. A page is only written to the
application log when a fill actually runs on it.

## What leaves your device, and when

Nothing is transmitted unless you have added an API key and enabled an AI
feature. Those features are off by default and none of them run automatically —
each one requires you to press a button.

When you do, the extension sends a request directly from your browser to the
provider you selected:

| Provider | Endpoint | Their policy |
| --- | --- | --- |
| Google Gemini | `generativelanguage.googleapis.com` | https://ai.google.dev/gemini-api/terms |
| Groq | `api.groq.com` | https://groq.com/privacy-policy |

Depending on which feature you pressed, the request contains some combination
of: the labels and surrounding text of the form fields on the page, your profile
values, your resume text or the resume PDF itself, and the job description from
the page you are on. Your API key travels in the request header to authenticate
you.

**These requests go straight from your browser to the provider.** They do not
pass through any server of mine — I have none, and I never see the contents.
Once your data reaches Google or Groq it is governed by their policies, linked
above, not by this one. If you would rather nothing left your machine at all,
leave the AI features off; rule-based filling, the tracker, and everything else
in the dashboard work entirely offline.

The extension makes no other network requests. No analytics, no telemetry, no
crash reporting, no update pings, no advertising or tracking of any kind, and no
remotely hosted code — everything that runs is in the package you installed.

## Why the extension asks for the permissions it does

- **Access to the websites you visit.** A small detection script runs on pages
  to work out whether you are looking at a job application. On a page that is
  not one, it does a single check and stops; the rest of the extension is never
  loaded. It reads page content only to find and fill form fields, and it never
  sends that content anywhere except in the AI cases described above.
- **Storage, and unlimited storage.** To keep your profile and settings. The
  unlimited variant is needed because your resume PDF is held in that storage
  and would otherwise run into Chrome's default quota.
- **Active tab.** So the toolbar button and the keyboard shortcut can act on the
  page you are looking at when you press them.

## What is never done

The extension never submits an application. No code in it clicks a Submit,
Apply, or Finish button in any mode — you review the form and send it yourself.

Your data is never sold, rented, shared, or transferred to anyone. It is not
used to build a profile of you, and it is not used for advertising or for
training anyone's model beyond whatever the provider you chose does under their
own policy.

## Your control over it

- **See it.** Everything is visible and editable in the dashboard.
- **Export it.** Dashboard → Settings → Export backup writes a JSON file. API
  keys are excluded unless you explicitly ask for them.
- **Delete part of it.** The dashboard has individual controls to remove your
  resume, clear saved cover letters, clear the application log, and clear
  learned mappings.
- **Delete all of it.** Dashboard → Settings → Erase everything. Uninstalling
  the extension also removes everything Chrome held for it.

Because there is no server, there is nothing for me to delete on your behalf and
no request you need to send me to make deletion happen.

## Children

Apply karo is intended for people old enough to be applying for jobs. It is not
directed at children under 13 and collects nothing from them knowingly.

## Changes

If this policy changes in a way that affects what is collected or where it goes,
the version here will be updated with a new date, and a release note will say
what changed.

## Contact

Questions about any of this: **rishitgoel259@gmail.com**.
