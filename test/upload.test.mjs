// Tests for resume upload targeting — node test/upload.test.mjs
//
// The DOM half (finding the hidden input, injecting the file) is exercised in
// test/harness2.html. What lives here is the decision: given the upload boxes a
// page offers, which one — if any — should receive the resume. That is where a
// mistake is expensive, because it is silent: the wrong file goes up and the
// user finds out from a rejection email.

import { pickResumeTargets, acceptAllows } from "../src/shared/rules.js";

let pass = 0;
const fails = [];
const check = (desc, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else fails.push({ desc, want: w, got: g });
};

/** A file descriptor shaped exactly as src/engine/scan.js emits one. */
function file(spec = {}) {
  return {
    kind: "file",
    label: (spec.label || "").toLowerCase(),
    rawLabel: spec.label || "",
    name: spec.name || "",
    id: spec.id || "",
    accept: spec.accept || "",
    uploadContext: spec.context || "",
    className: spec.className || "",
    filled: !!spec.filled
  };
}
const idsOf = (fields) => fields.map((f) => f.id || f.name || f.rawLabel);

// ─── accept ──────────────────────────────────────────────────────────────────
{
  check("no accept means no restriction", acceptAllows("", "resume.pdf"), true);
  check("extension list allows a pdf", acceptAllows(".pdf,.doc,.docx", "resume.pdf"), true);
  check("extension list rejects a pdf it omits", acceptAllows(".jpg,.png", "resume.pdf"), false);
  check("image/* rejects a pdf", acceptAllows("image/*", "resume.pdf"), false);
  check("application/pdf allows a pdf", acceptAllows("application/pdf", "resume.pdf"), true);
  check("*/* allows anything", acceptAllows("*/*", "resume.pdf"), true);
  check("accept is matched against the real file", acceptAllows(".pdf", "Rishit_Goel_Resume.docx"), false);
  check("docx is understood", acceptAllows(".doc,.docx", "resume.docx"), true);
  check("spacing and case are ignored", acceptAllows(" .PDF , .DOC ", "resume.pdf"), true);
}

// ─── The box says resume ─────────────────────────────────────────────────────
{
  check("labelled resume box wins",
    idsOf(pickResumeTargets([file({ label: "Resume/CV", id: "resume" })])), ["resume"]);

  check("a hidden input is found through its wrapper's wording",
    idsOf(pickResumeTargets([file({ id: "file-1", context: "resume_fieldset Attach your resume here" })])),
    ["file-1"]);

  // Workday asks on the upload step and again on review.
  check("every explicit resume box is filled",
    idsOf(pickResumeTargets([
      file({ label: "Resume", id: "a" }),
      file({ label: "Upload resume", id: "b" })
    ])), ["a", "b"]);

  check("an already-attached box is left alone",
    idsOf(pickResumeTargets([file({ label: "Resume", id: "a", filled: true })])), []);
}

// ─── Boxes that are not the resume ───────────────────────────────────────────
{
  check("cover letter box is left for the letter writer",
    idsOf(pickResumeTargets([
      file({ label: "Resume", id: "cv" }),
      file({ label: "Cover letter", id: "letter" })
    ])), ["cv"]);

  check("a lone cover-letter box gets nothing",
    idsOf(pickResumeTargets([file({ label: "Cover letter", id: "letter" })])), []);

  // One control for both is common on smaller boards, and there the resume does
  // belong in it.
  check('"Resume / Cover letter" still counts as a resume box',
    idsOf(pickResumeTargets([file({ label: "Resume / Cover letter", id: "both" })])), ["both"]);

  check("photo upload is skipped",
    idsOf(pickResumeTargets([file({ label: "Profile photo", id: "photo" })])), []);

  check("an image-only box is skipped even when unlabelled",
    idsOf(pickResumeTargets([file({ id: "img", accept: "image/png,image/jpeg" })])), []);
}

// ─── The unlabelled case, which is most of the real ones ─────────────────────
{
  check("a lone unlabelled upload is the resume",
    idsOf(pickResumeTargets([file({ id: "file" })])), ["file"]);

  check("a lone upload alongside text fields is still the resume",
    idsOf(pickResumeTargets([
      { kind: "text", rawLabel: "First name", id: "fn" },
      file({ id: "upload" }),
      { kind: "text", rawLabel: "Email", id: "em" }
    ])), ["upload"]);

  // Two anonymous boxes and nothing to tell them apart: guessing here means a
  // 50% chance of putting the resume where the portfolio belonged.
  check("two indistinguishable uploads get nothing",
    idsOf(pickResumeTargets([file({ id: "a" }), file({ id: "b" })])), []);

  // ...unless one of them names itself, in which case it is not a guess.
  check("a named box disambiguates its anonymous neighbour",
    idsOf(pickResumeTargets([file({ id: "a" }), file({ label: "Resume", id: "b" })])), ["b"]);

  // A photo box does not count as competition: excluding it leaves one real
  // candidate, and that one is the resume.
  check("the only non-photo upload is the resume",
    idsOf(pickResumeTargets([file({ label: "Headshot", id: "pic" }), file({ id: "doc" })])), ["doc"]);

  check("a filled box does not block its neighbour",
    idsOf(pickResumeTargets([file({ id: "a", filled: true }), file({ id: "b" })])), ["b"]);
}

console.log(`\n  ${pass}/${pass + fails.length} passed\n`);
for (const f of fails) console.log(`  FAIL  ${f.desc}\n        expected: ${f.want}\n        got:      ${f.got}`);
process.exit(fails.length ? 1 : 0);
