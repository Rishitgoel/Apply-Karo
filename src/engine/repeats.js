import { realClick, isExtensionAction } from "./controls/native.js";
const bindings=new WeakMap();
const BLOCK='[data-repeat-group],[data-automation-id="workExperienceItem"],[data-automation-id="educationItem"],[data-repeat-item]';
const CONTROLS='input,select,textarea,[role="combobox"]';
export function bindEntities(fields,profile) {
  const groups=new Map();
  for(const field of fields) {
    if(!["experience","education"].includes(field.section))continue;
    const block=field.el.closest(BLOCK);if(!block)continue;
    if(!groups.has(block))groups.set(block,[]);groups.get(block).push(field);
  }
  for(const [block,group] of groups) {
    const section=group[0].section,rows=profile[section]||[], anchor=group.find(f=>section==="experience"?/^(employer|company( name)?)$/i.test(f.rawLabel):/^(school( name)?|university|institution)$/i.test(f.rawLabel));
    const value=String(anchor?.el.value||anchor?.el.getAttribute("data-selected")||"").trim().toLowerCase();
    const secondary=group.find(f=>section==="experience"?/^(job title|position|title)$/i.test(f.rawLabel):/^(degree|degree level)$/i.test(f.rawLabel));
    const secondaryValue=String(secondary?.el.value||"").trim().toLowerCase();
    const identity=row=>JSON.stringify(section==="experience"?[row.company,row.title||row.position,row.startDate,row.endDate]:[row.school,row.degree,row.fieldOfStudy,row.startDate,row.endDate]);
    const matches=value?rows.map((r,i)=>({i,r})).filter(({r})=>String(section==="experience"?r.company:r.school).trim().toLowerCase()===value && (!secondaryValue||String(section==="experience"?r.title||r.position:r.degree).trim().toLowerCase()===secondaryValue)):[];
    let binding=bindings.get(block);
    if(value && matches.length!==1){group.forEach(f=>{f.skip=true;f.entityConflict=true;});continue;}
    if(matches.length===1)binding={section,index:matches[0].i,identity:identity(matches[0].r)};
    else if(binding) {
      const current=rows.map((r,i)=>({i,r})).filter(({r})=>identity(r)===binding.identity);
      if(current.length!==1){group.forEach(f=>{f.skip=true;f.entityConflict=true;});continue;}
      binding={...binding,index:current[0].i};
    } else if(rows[group[0].instance||0])binding={section,index:group[0].instance||0,identity:identity(rows[group[0].instance||0])};
    else {group.forEach(f=>{f.skip=true;f.entityConflict=true;});continue;}
    if(binding.section!==section || !rows[binding.index]){group.forEach(f=>{f.skip=true;f.entityConflict=true;});continue;}
    bindings.set(block,binding);group.forEach(f=>{f.instance=binding.index;f.entityId=`${section}:${binding.index}`;});
  }
  return fields;
}
export async function addMissingRepeats(root,profile,{isCancelled=()=>false,maxAdds=5}={}) {
  const undo=[],added=[];
  for(const [section,buttonId,containerId,itemId,label] of [["experience","addWorkExperience","workExperience","workExperienceItem",/^add (another )?(work experience|employment|job)$/i],["education","addEducation","education","educationItem",/^add (another )?(education|school)$/i]]) {
    const buttons=[...root.querySelectorAll(`button[data-automation-id="${buttonId}"]`)].filter(b=>b.type==="button"&&!b.disabled&&b.getClientRects().length&&label.test((b.getAttribute("aria-label")||b.textContent).trim()));
    if(buttons.length!==1)continue;
    const button=buttons[0], container=button.closest(`[data-automation-id="${containerId}"]`);if(!container)continue;
    const existingRemove=container.querySelector(`button[data-automation-id="${section==="experience"?"deleteWorkExperience":"deleteEducation"}"][type="button"]`);
    if(!existingRemove)continue;
    let count=container.querySelectorAll(`[data-automation-id="${itemId}"]`).length;
    while(count>0 && count<(profile[section]||[]).length && added.length<maxAdds && !isCancelled()) {
      const previous=new Set(container.querySelectorAll(`[data-automation-id="${itemId}"]`));realClick(button);
      const deadline=Date.now()+1000;let blocks=[];
      do{await new Promise(r=>setTimeout(r,50));blocks=[...container.querySelectorAll(`[data-automation-id="${itemId}"]`)];}while(blocks.length===count&&Date.now()<deadline&&!isCancelled());
      const fresh=blocks.filter(b=>!previous.has(b));if(blocks.length!==count+1 || fresh.length!==1)break;
      const block=fresh[0], remove=[...block.querySelectorAll('button[data-automation-id="deleteWorkExperience"],button[data-automation-id="deleteEducation"]')].filter(b=>b.type==="button" && /^(remove|delete)( (work experience|employment|job|education|school))?$/i.test(b.textContent.trim()));
      if(remove.length!==1)break;
      let edited=false;const mark=e=>{if(e.isTrusted&&!isExtensionAction())edited=true;};block.addEventListener("input",mark);block.addEventListener("change",mark);
      const restore=()=>{if(edited || !block.isConnected || [...block.querySelectorAll(CONTROLS)].some(el=>el.value || el.checked || el.getAttribute("data-selected")))return false;realClick(remove[0]);restore.dispose();return true;};
      restore.dispose=()=>{block.removeEventListener("input",mark);block.removeEventListener("change",mark);};undo.push(restore);added.push(block);count++;
    }
  }
  return {added,undo};
}
