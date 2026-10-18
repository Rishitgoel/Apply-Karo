import { releasePolicy, DEFAULT_RELEASE } from "../shared/release.js";
export function mountReleaseControls() {
  const root=document.createElement("div");root.className="card card-pad mt-3";root.id="release-controls";
  const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;}, status=text("p","");status.setAttribute("role","status");
  const action=(label,callback)=>{const button=text("button",label);button.type="button";button.className="btn btn-secondary";button.addEventListener("click",async()=>{button.disabled=true;try{await callback();}catch{status.textContent="Could not complete this action. Refresh the dashboard and retry.";}finally{button.disabled=false;}});return button;};
  async function setPolicy(patch) {
    const {settings={}}=await chrome.storage.local.get("settings");
    const previous=settings.release||{...DEFAULT_RELEASE,cohort:crypto.getRandomValues(new Uint32Array(1))[0]%100};
    const release={...previous,...patch,cohort:patch.cohort ?? previous.cohort};await chrome.storage.local.set({settings:{...settings,release}});await refresh();
  }
  const flags={};for(const key of ["descriptor","resolver","adapter"]){const label=text("label",` Enable ${key} pipeline `),input=document.createElement("input");input.type="checkbox";input.setAttribute("aria-label",`Enable ${key} pipeline`);label.prepend(input);flags[key]=input;root.append(label);}
  const output=text("pre","");output.style.cssText="white-space:pre-wrap;overflow-wrap:anywhere";
  root.prepend(text("h2","Release controls"),text("p","Pause automatic filling while keeping your profile, knowledge and review tools. Disabling any required pipeline component pauses the whole fill; it never restores legacy guessing."));
  root.append(action("Save pipeline flags",()=>setPolicy(Object.fromEntries(Object.entries(flags).map(([k,input])=>[k,input.checked])))),
    action("Pause automatic filling",()=>setPolicy({stage:"paused"})),action("Pilot: 10% of installations",()=>setPolicy({stage:"pilot",percentage:10})),
    action("Resume verified pipeline",()=>setPolicy({...DEFAULT_RELEASE,cohort:undefined})),status,
    text("p","Synthetic provider check uses only a fictional profile, at most two requests to your selected model, and may consume its quota. It never sends your resume."),
    action("Run synthetic provider check",async()=>{const response=await chrome.runtime.sendMessage({type:"synthetic_provider_probe"});if(!response.ok){status.textContent=response.error;return;}output.textContent=JSON.stringify(response.result,null,2);}),
    action("Export provider check",async()=>{const {releaseProbe}=await chrome.storage.local.get("releaseProbe");if(!releaseProbe){status.textContent="Run the synthetic check first.";return;}const url=URL.createObjectURL(new Blob([JSON.stringify(releaseProbe,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="apply-karo-provider-check.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}),output);
  async function refresh(){const {settings={}}=await chrome.storage.local.get("settings"),policy=releasePolicy(settings);status.textContent=policy.enabled?`Verified pipeline active (${policy.stage}; cohort ${policy.cohort}).`:policy.reason;for(const [key,input]of Object.entries(flags))input.checked=policy[key]===true;}
  document.getElementById("tab-settings").append(root);refresh();return{refresh};
}
