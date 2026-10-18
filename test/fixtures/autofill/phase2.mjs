const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const style = '<style>body{font:16px Arial;margin:24px}.field{margin:12px}input,button,select,textarea{min-height:30px;min-width:180px}[role=listbox]{max-height:180px;overflow:auto;background:#eee}[role=option]{padding:12px}[hidden]{display:none!important}</style>';
export function phase2Fixture(id) {
  if (id === "scoped-correction") return `<!doctype html>${style}<h1>Employment application</h1><form><fieldset><legend>Education</legend><label>City<input id=collegecity></label></fieldset><fieldset><legend>Personal information</legend><label>City<input id=homecity></label><label>First name<input id=first></label><label>Email address<input id=email></label></fieldset></form>`;
  if (["unfamiliar", "checkout", "login", "search"].includes(id)) {
    const title = { unfamiliar: "Employment application: upload your resume", checkout: "Checkout: payment details", login: "Sign in", search: "Search people" }[id];
    return `<!doctype html>${style}<h1>${title}</h1><form><label>First name<input id=first></label><label>Last name<input></label><label>Email address<input type=email></label><label>Phone number<input></label>${id === "login" ? '<input type=password>' : ''}</form>`;
  }
  if (id === "related-frames") return `<!doctype html>${style}<h1>Employment application</h1><iframe id=blank></iframe><iframe srcdoc="${escape('<label>First name<input id=first></label><label>Last name<input id=last></label>')}"></iframe><script>const d=document.querySelector('#blank').contentDocument;d.body.innerHTML='<label>First name<input id=first></label><label>Last name<input id=last></label>';</script>`;
  if (id === "closed") return `<!doctype html>${style}<h1>Employment application</h1><closed-form></closed-form><script>customElements.define('closed-form',class extends HTMLElement{constructor(){super();this.attachShadow({mode:'closed'}).innerHTML='<label>First name<input></label>';}});</script>`;
  if (id === "labels") return `<!doctype html>${style}<form><fieldset><legend>Education</legend><label for=city>City</label><input id=city><label for=long>${escape("Describe your professional experience. " + "Consider all confirmed project facts. ".repeat(12) + "Only Python, never Java.")}</label><textarea id=long></textarea><span id=head>Are you authorized to work</span><span id=tail>in India without sponsorship?</span><input id=multi aria-labelledby="head tail"><span id=help>Only use your confirmed jurisdiction-specific facts.</span><input id=described aria-label="Eligibility" aria-describedby="head tail help"><label for=conflict>Phone number</label><input id=conflict aria-label="Email address"></fieldset></form>`;
  if (id === "conditional") return `<!doctype html>${style}<h1>Employment application</h1><form><label>Country<select id=country><option value=''>Select one</option><option>United States</option></select></label><div id=children></div><script>country.addEventListener('change',()=>{children.innerHTML='<label>State<select id=state><option value="">Select one</option><option>California</option></select></label>';});</script></form>`;
  const names = id === "ambiguous" ? ["USA", "United States of America"] : id === "hierarchical" ? ["Engineering"] : id === "chips" ? ["React", "Python"] : id === "virtual" ? Array.from({ length: 60 }, (_, i) => `Unrelated ${i + 1}`).concat("United States") : ["Canada", "India", "United States"];
  const input = ["searchable", "search-only"].includes(id);
  const native = id === "native-revert";
  const label = id === "chips" ? "Skills" : id === "hierarchical" ? "Department" : "Country";
  if (native) return `<!doctype html>${style}<label>Country<select id=trigger><option value=''>Select one</option><option>United States</option></select></label><script>trigger.addEventListener('change',()=>setTimeout(()=>trigger.value='',150));</script>`;
  return `<!doctype html>${style}<h1>Employment application</h1><div class=field><label id=question for=trigger>${label}</label>${input ? '<input id=trigger' : '<button type=button id=trigger'} role=combobox data-automation-id=prompt aria-controls=owned aria-expanded=false${input ? ' aria-autocomplete=list>' : '>Select one</button>'}<div id=chips></div></div><div id=owned role=listbox hidden></div>
  ${id === "portal" ? '<div role=listbox><div role=option>Wrong unrelated menu</div></div>' : ''}
  <script>
  window.__selected=[];const pool=${JSON.stringify(names)};let start=0;
  function paint(){
    const query=${input ? "trigger.value.toLowerCase()" : "''"};
    const available=pool.filter(v=>!query||v.toLowerCase().includes(query));
    const list=${id === "virtual" ? "available.slice(start,start+12)" : "available"};
    owned.replaceChildren(...list.map(v=>{const o=document.createElement('div');o.role='option';o.textContent=v;o.addEventListener('click',()=>{
      if(${JSON.stringify(id)}==='search-only'){owned.hidden=true;trigger.setAttribute('aria-expanded','false');return;}
      if(${JSON.stringify(id)}==='hierarchical'&&v==='Engineering'){pool.splice(0,pool.length,'Software');paint();return;}
      window.__selected.push(v);trigger.dataset.selected=v;${input ? 'trigger.value=v;' : 'trigger.textContent=v;'}
      if(${JSON.stringify(id)}==='chips'){const chip=document.createElement('span');chip.dataset.chip='';chip.textContent=v;chips.append(chip);}
      owned.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.dispatchEvent(new Event('change',{bubbles:true}));
      if(${JSON.stringify(id)}==='destroyed-menu')owned.replaceChildren();
      if(${JSON.stringify(id)}==='revert')setTimeout(()=>{window.__selected=[];delete trigger.dataset.selected;trigger.textContent='Select one';},150);
    });return o;}));
    if(${JSON.stringify(id)}==='virtual'){const spacer=document.createElement('div');spacer.style.height=(pool.length*40+400)+'px';owned.append(spacer);}
  }
  trigger.addEventListener('click',()=>{owned.hidden=false;trigger.setAttribute('aria-expanded','true');owned.textContent='Loading…';setTimeout(paint,${id === "delayed" ? 1700 : 0});});
  trigger.addEventListener('input',()=>{start=0;paint();});owned.addEventListener('scroll',()=>{start+=12;paint();});
  trigger.addEventListener('keydown',e=>{if(e.key==='Escape'){owned.hidden=true;trigger.setAttribute('aria-expanded','false')}});
  </script>`;
}
