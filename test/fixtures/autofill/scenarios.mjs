const text = (question, id = "answer") => `<label for="${id}" id="question">${question}</label><textarea id="${id}"></textarea>`;
export function renderScenario(id) {
  let content;
  switch (id) {
    case "cold": case "warm": case "close": case "delayed": case "missing-frame":
      content = '<label for="first">First name</label><input id="first" name="first_name"><label for="email">Email address</label><input id="email" name="email" type="email">'; break;
    case "learning": content = text("Do you hold a forklift operator certificate?"); break;
    case "sensitive": content = '<label for="answer">Gender</label><select id="answer"><option value="">Select one</option><option>Woman</option><option>Man</option></select>'; break;
    case "inline-edit": content = text("Describe a project you built."); break;
    case "inline-reuse": content = text("Describe your Python experience."); break;
    case "large": content = Array.from({ length: 81 }, (_, i) => `<div><label for="a${i}">Custom application question ${i + 1}</label><textarea id="a${i}"></textarea></div>`).join(""); break;
    case "unknown-declarations": content = '<label for="license">Do you have a driver license?</label><select id="license"><option value="">Select one</option><option>Yes</option><option>No</option></select><label for="citizenship">Country of citizenship</label><input id="citizenship"><label for="consent"><input id="consent" type="checkbox">I agree to the terms and consent to screening.</label>'; break;
    case "job-context": content = text("Why do you want to join this company?"); break;
    case "review-learning": content = '<label for="phone1">Phone number</label><input id="phone1"><label for="phone2">Phone number</label><input id="phone2"><label for="license">Professional license number</label><input id="license" required><label for="blocked">I agree to the terms</label><input id="blocked" type="checkbox" required>'; break;
    case "custom-learning": content = '<label for="answer">Country</label><button id="answer" role="combobox" type="button" aria-controls="choices" aria-expanded="false">Select one</button><div id="choices" role="listbox" hidden><div role="option">United States</div><div role="option">Canada</div></div>'; break;
    default: throw new Error(`Unknown scenario ${id}`);
  }
  return `<!doctype html><meta charset="utf-8"><title>Synthetic application regression</title><style>body{font:16px Arial;margin:35px}label{display:block;margin-top:18px}input,select,textarea{width:480px;min-height:32px}textarea{height:100px}[hidden]{display:none!important}</style><h1>Synthetic application regression</h1><form>${content}<button type="submit">Submit application</button></form><script>window.__submissions=0;document.addEventListener('submit',e=>{e.preventDefault();window.__submissions++});${id === "custom-learning" ? "const el=document.querySelector('#answer'),menu=document.querySelector('#choices');el.onclick=()=>{menu.hidden=false;el.setAttribute('aria-expanded','true')};menu.querySelectorAll('[role=option]').forEach(o=>o.onclick=()=>{el.textContent=o.textContent;el.dataset.selected=o.textContent;el.setAttribute('aria-expanded','false');menu.hidden=true;el.dispatchEvent(new Event('change',{bubbles:true}))});" : ""}</script>`;
}
