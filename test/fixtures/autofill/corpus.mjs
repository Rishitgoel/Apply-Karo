// Authored synthetic gold data. Gold answers remain in the runner, never in the DOM.
export const profile = {
  personal: { firstName: "Avery", lastName: "Shah", fullName: "Avery Shah", email: "avery@example.invalid",
    phone: "+14155550123", city: "Palo Alto", state: "California", postalCode: "94301", country: "United States",
    address: "123 Example Lane", linkedin: "https://example.invalid/avery", github: "https://example.invalid/code",
    website: "https://example.invalid", authorizedToWork: "Yes", sponsorshipRequired: "No" },
  education: [{ school: "Example University", degree: "Bachelor's Degree", fieldOfStudy: "Computer Science", gpa: "3.7", endDate: "2025-05-01", city: "Boston" }],
  experience: [{ company: "Example Labs", position: "Software Engineer", title: "Software Engineer", location: "Remote", startDate: "2023-06-01" }],
  skills: "JavaScript, Python", summary: "Built internal tools at Example Labs.",
  customFields: { noticePeriod: "30 days", salaryExpectation: "100000", yearsOfExperience: "2" }
};

// 25 intent rows, exercised across 20 structural variants. This is 500 observations,
// not 500 independent intents. Held-out splits are by template, not individual row.
export const questions = [
  ["firstName", "First name", "Given name", "Avery"],
  ["lastName", "Last name", "Family name", "Shah"],
  ["email", "Email address", "Your email", "avery@example.invalid", "email"],
  ["phone", "Phone number", "Telephone", "+14155550123", "tel"],
  ["city", "City", "City of residence", "Palo Alto"],
  ["state", "State", "State / province", "California", "choice", ["California", "New York", "Texas"]],
  ["postalCode", "Postal code", "ZIP code", "94301"],
  ["country", "Country", "Country of residence", "United States", "choice", ["Canada", "India", "United States"]],
  ["addressLine1", "Street address", "Address line 1", "123 Example Lane"],
  ["linkedin", "LinkedIn URL", "LinkedIn profile", "https://example.invalid/avery"],
  ["github", "GitHub URL", "GitHub profile", "https://example.invalid/code"],
  ["website", "Personal website", "Website URL", "https://example.invalid"],
  ["university", "University", "School name", "Example University", "text", null, "education"],
  ["degree", "Degree", "Degree level", "Bachelor's Degree", "choice", ["High School", "Bachelor's Degree", "Master's Degree"], "education"],
  ["fieldOfStudy", "Field of study", "Major", "Computer Science", "choice", ["Mathematics", "Computer Science", "Physics"], "education"],
  ["gpa", "GPA", "Grade point average", "3.7", "number", null, "education"],
  ["company", "Employer", "Company name", "Example Labs", "text", null, "experience"],
  ["jobTitle", "Job title", "Position", "Software Engineer", "text", null, "experience"],
  ["authorizedToWork", "Are you authorized to work in the United States?", "Are you legally authorized to work in the United States?", "Yes", "choice", ["Yes", "No"]],
  ["sponsorship", "Will you require visa sponsorship in the United States?", "Do you need sponsorship to work in the United States?", "No", "choice", ["Yes", "No"]],
  ["noticePeriod", "Notice period", "What is your notice period?", "30 days"],
  ["yearsOfExperience", "Years of experience", "Total experience in years", "2", "number"],
  [null, "Why do you want to join Example Company?", "Why this employer?", null, "textarea"],
  ["currentSalary", "Current annual salary in USD", "What is your current salary in USD per year?", null, "number"],
  ["gender", "Gender", "Gender identity", null, "choice", ["Woman", "Man", "Prefer not to disclose"]]
].map(([rule, label, alternate, answer, kind = "text", options, section = "personal"], i) => ({
  id: `q${i + 1}`, rule, label, alternate, answer, kind, options: options || [], section,
  eligible: true, answerable: answer !== null
}));

const templates = [
  ["native-label", "native", "label"], ["native-wrap", "native", "wrap"],
  ["native-aria", "native", "aria"], ["native-help", "native", "help"],
  ["native-multipart", "native", "multipart"], ["native-long", "native", "long"],
  ["greenhouse-style", "greenhouse-style", "label"], ["lever-style", "lever-style", "wrap"],
  ["ashby-style", "ashby-style", "aria"], ["google-headings", "google-style", "heading"],
  ["google-multipart", "google-style", "multipart"], ["workday-button", "workday-style", "label"],
  ["workday-search", "workday-style", "aria"], ["workday-delayed", "workday-style", "label"],
  ["workday-virtualized", "workday-style", "label"], ["workday-dependent", "workday-style", "label"],
  ["workday-repeated", "workday-style", "label"], ["open-shadow", "shadow", "label"],
  ["iframe", "frame", "label"], ["dynamic-reuse", "dynamic", "label"]
];
export const corpus = templates.map(([id, family, markup], i) => ({
  id, family, markup, split: [4, 5, 8, 10, 13, 14, 15, 18, 19].includes(i) ? "heldout" : "tuning",
  questions: questions.map((q) => {
    if (id === "workday-repeated" && q.id === "q1") return { ...q, id: `${id}-${q.id}`, rule: "company", section: "experience-second", question: "Employer", answer: "Earlier Example Labs" };
    const question = i % 2 ? q.alternate : q.label;
    const full = markup === "long" ? `${question}. Please use the exact information you have confirmed for this application and consider the applicable jurisdiction, entity, currency and time period before answering. This field refers only to the current application and does not authorize changing facts.` : question;
    return { ...q, question: full, id: `${id}-${q.id}` };
  })
}));

export const negativePairs = [
  ["Are you authorized to work in India?", "Are you authorized to work in the United States?", "jurisdiction"],
  ["Do you require sponsorship?", "Can you work without sponsorship?", "polarity"],
  ["Current annual salary in INR", "Expected monthly salary in USD", "intent-units"],
  ["City", "City", "entity", "personal", "education"],
  ["Current employer", "Previous employer", "time"],
  ["Please describe your professional experience and qualifications for Python", "Please describe your professional experience and qualifications for Java", "skill"],
  ["What attracts you to Example A?", "What attracts you to Example B?", "employer"],
  ["Do you have three years of professional Python experience?", "Have you used Python?", "scope"],
  ["भाषा", "शहर", "unicode"],
  ["Can you start on 1 May 2027?", "Did you graduate on 1 May 2027?", "intent"]
].map(([a, b, difference, sectionA = "personal", sectionB = "personal"], i) => ({ id: `negative-${i + 1}`, a, b, difference, sectionA, sectionB, equivalent: false }));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function renderForm(form) {
  const blocks = form.questions.map((q, i) => {
    const id = `f-${i}`, labelId = `label-${i}`, helpId = `help-${i}`;
    const words = q.question.split(" "), cut = Math.max(1, Math.floor(words.length / 2));
    let attrs = `id="${id}" data-gold-id="${q.id}"`;
    if (form.markup === "aria") attrs += ` aria-label="${esc(q.question)}"`;
    if (form.markup === "multipart") attrs += ` aria-labelledby="${labelId} ${labelId}-tail"`;
    if (form.markup === "help") attrs += ` aria-describedby="${helpId}"`;
    const isCombo = form.family === "workday-style" && q.options.length > 0;
    let control;
    if (isCombo) {
      const tag = form.id === "workday-search" ? "input" : "button";
      const options = form.id === "workday-virtualized" ? Array.from({ length: 45 }, (_, n) => `Unrelated choice ${n + 1}`).concat(q.options) : q.options;
      // Delays and virtualization are fixture behavior; answer data is not encoded here.
      attrs += ` role="combobox" aria-haspopup="listbox" aria-controls="menu-${i}" aria-expanded="false" data-automation-id="prompt" data-combo="${i}"`;
      control = tag === "input" ? `<input ${attrs} aria-autocomplete="list">` : `<button type="button" ${attrs}>Select one</button>`;
      control += `<div id="menu-${i}" role="listbox" hidden data-options='${esc(JSON.stringify(options))}'></div>`;
    } else if (q.options.length) {
      control = `<select ${attrs}><option value="">Select one</option>${q.options.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select>`;
    } else if (q.kind === "textarea") control = `<textarea ${attrs}></textarea>`;
    else control = `<input ${attrs} type="${["email", "tel", "number"].includes(q.kind) ? q.kind : "text"}">`;
    let label = `<label for="${id}" id="${labelId}">${esc(q.question)}</label>`;
    if (form.markup === "multipart") label = `<span id="${labelId}">${esc(words.slice(0, cut).join(" "))}</span> <span id="${labelId}-tail">${esc(words.slice(cut).join(" "))}</span>`;
    if (form.markup === "heading") label = `<div role="heading">${esc(q.question)}</div>`;
    if (form.markup === "aria") label = `<p>${esc(q.question)}</p>`;
    if (form.markup === "wrap") return `<div class="field"><label>${esc(q.question)} ${control}</label></div>`;
    return `<div class="field" ${form.family === "google-style" ? 'role="listitem"' : ""}>${label}${control}${form.markup === "help" ? `<small id="${helpId}">Use your confirmed ${esc(q.section)} details.</small>` : ""}</div>`;
  });
  // Section containers deliberately hold several controls, as real ATS forms do.
  const sections = ["personal", "education", "experience", "experience-second"].filter((section) => form.questions.some((q) => q.section === section)).map((section) => `<fieldset data-repeat-group="${section.startsWith("experience") ? "experience" : section}"><legend>${section === "personal" ? "Personal information" : section === "education" ? "Education" : "Work experience"}</legend>${form.questions.map((q, i) => q.section === section ? blocks[i] : "").join("")}</fieldset>`).join("");
  const style = `<style>body{font:16px Arial;margin:24px}fieldset{margin:18px 0}.field{margin:12px 0}label,small{display:block}input,select,textarea,button[role=combobox]{min-width:260px;min-height:28px}textarea{height:60px}[role=listbox]{background:#eee;max-height:180px;overflow:auto}[role=option]{padding:8px;cursor:pointer}[hidden]{display:none!important}</style>`;
  const script = `<script>
  window.__submissions=0; window.__fixtureReady=false; window.__pendingValidations=0;
  document.addEventListener('submit',e=>{e.preventDefault();window.__submissions++});
  function bind(root){
    root.querySelectorAll('[data-combo]').forEach(el=>{
      const menu=root.querySelector('#'+el.getAttribute('aria-controls'));
      const pool=JSON.parse(menu.dataset.options);
      let pageStart=0;
      function paint(){
        const query=el.tagName==='INPUT'?el.value.toLowerCase():'';
        const list=pool.filter(v=>!query||v.toLowerCase().includes(query));
        const limited=${JSON.stringify(form.id)}==='workday-virtualized'?list.slice(pageStart,pageStart+15):list;
        menu.replaceChildren(...limited.map(v=>{const o=document.createElement('div');o.role='option';o.textContent=v;o.dataset.value=v;o.addEventListener('click',()=>{el.dataset.selected=v;if(el.tagName==='INPUT')el.value=v;else el.textContent=v;el.setAttribute('aria-expanded','false');menu.hidden=true;el.dispatchEvent(new Event('change',{bubbles:true}));});return o;}));
        if(${JSON.stringify(form.id)}==='workday-virtualized'){const spacer=document.createElement('div');spacer.style.height=(pool.length*40+400)+'px';menu.append(spacer);}
      }
      el.addEventListener('click',()=>{el.setAttribute('aria-expanded','true');menu.hidden=false;menu.textContent='Loading…';setTimeout(paint,${form.id === "workday-delayed" ? 1600 : 0});});
      el.addEventListener('input',()=>{pageStart=0;paint();});
      if(${JSON.stringify(form.id)}==='workday-virtualized'){menu.style.height='180px';menu.addEventListener('scroll',()=>{pageStart+=15;paint();});}
      el.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;el.setAttribute('aria-expanded','false')}});
    });
    ${form.id === "workday-dependent" ? `const country=root.querySelector('[data-gold-id$="-q8"]'),state=root.querySelector('[data-gold-id$="-q6"]');country.addEventListener('change',()=>{state.dataset.selected='';state.textContent='Select one';});` : ""}
  }
  const form=document.querySelector('form');
  ${form.family === "shadow" ? `const host=document.createElement('synthetic-form');form.before(host);const root=host.attachShadow({mode:'open'});root.innerHTML=${JSON.stringify(style)};root.append(form);bind(root);` : "bind(document);"}
  ${form.id === "dynamic-reuse" ? `const email=document.querySelector('[data-gold-id$="-q3"]');email.addEventListener('change',()=>{window.__pendingValidations++;setTimeout(()=>{const replacement=email.cloneNode();replacement.value='';email.replaceWith(replacement);window.__pendingValidations--;},150);},{once:true});` : ""}
  window.__fixtureReady=true;
  </script>`;
  return `<!doctype html><meta charset="utf-8"><title>Synthetic job application</title>${style}<h1>Synthetic job application</h1><form>${sections}<button type="submit">Submit application</button></form>${script}`;
}

export function renderFixture(form) {
  if (form.family !== "frame") return renderForm(form);
  return `<!doctype html><title>Embedded synthetic application</title><iframe title="Application" src="/apply/inner/${form.id}" style="width:95vw;height:1800px;border:0"></iframe>`;
}
