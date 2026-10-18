import { fillSync, fillAsync, fillFile, labelOfControl, setValue, fire } from "./native.js";
import { readControl } from "./read.js";
import { rankChoices } from "./workday.js";
import { verificationTicket, verify, guardUndo } from "../verify.js";
export function controlAdapter(field) {
  const freeText=field.kind==="combobox" && (field.el.hasAttribute("list") || ["both","inline"].includes(field.el.getAttribute("aria-autocomplete")));
  return { read:()=>readControl(field), resolveOptions:(value,ruleId)=>({ ...rankChoices(field.options || [],value,ruleId), complete:field.optionsComplete!==false }),
    write:(value,ruleId)=>fillSync(freeText?{...field,kind:"text"}:field,value,ruleId), writeAsync:async(value,ruleId)=>{
      if(field.nativeSelect) {const selected=rankChoices(field.options||[],value,ruleId).choice;if(!selected || field.nativeSelect.disabled || !field.writeGuard?.())return false;
        setValue(field.nativeSelect,selected.value);fire(field.nativeSelect,'input');fire(field.nativeSelect,'change');return true;}
      return await fillAsync(field,value,ruleId);
    },
    verify:(value,ruleId,ticket,opts)=>verify(field,value,ruleId,ticket,opts), undo:restore=>guardUndo(field,restore) };
}
export function beginWrite(field, value, ruleId, options={}) {
  const adapter=controlAdapter(field),ticket=verificationTicket(field,labelOfControl);
  const grouped=["radiogroup","checkboxgroup","dategroup"].includes(field.kind);
  const legend=field.el.closest("fieldset")?.querySelector("legend")?.textContent.trim();
  const staleSection=legend && field.sectionTitle && legend!==field.sectionTitle && legend!==field.rawLabel;
  const staleOptions=field.kind==="select" && (field.options || []).some(o=>o.el && (o.el.value!==o.value || o.el.text.trim()!==o.label));
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s\r\n*.:;,-]+/g, " ").trim();
  const currentLabel = labelOfControl(field.el);
  const staleLabel = !grouped && field.rawLabel && currentLabel && (norm(currentLabel) !== norm(field.rawLabel) && !norm(currentLabel).includes(norm(field.rawLabel)) && !norm(field.rawLabel).includes(norm(currentLabel)));
  if(options.isCancelled?.() || !ticket.valid() || staleSection || staleOptions || staleLabel || field.el.disabled || field.el.readOnly && field.kind!=="combobox") {ticket.dispose();field.verification={status:"deferred",writeAttempted:false,domAccepted:false,validation:"not_checked",reason:"stale_descriptor"};return {attempted:false, immediate:false, completion:Promise.resolve(false)};}
  const immediate=ticket.writing(()=>adapter.write(value,ruleId));
  field.proposedWrite={value,ruleId};
  field.writeGuard=()=>ticket.valid()&&!options.isCancelled?.();
  field.cleanupGuard=()=>ticket.valid();
  const completion=(async()=>{
    try {
      const wrote=immediate===null?await adapter.writeAsync(value,ruleId):immediate;
      if(!wrote){field.verification={status:"rejected",writeAttempted:true,domAccepted:false,validation:"not_checked",reason:"control_refused"};return false;}
      field.verification=await adapter.verify(value,ruleId,ticket,options);
      field.controlOutcome={...field.controlOutcome,...field.verification};
      return field.verification.status==="verified";
    } finally {delete field.writeGuard;delete field.cleanupGuard;ticket.dispose();}
  })();
  return {attempted:true,immediate,completion};
}
export async function writeVerified(field,value,ruleId,options){return await beginWrite(field,value,ruleId,options).completion;}
export async function uploadVerified(field,dataUrl,name,options={}) {
  const ticket=verificationTicket(field,labelOfControl);
  try {
    const before=readControl(field);
    const norm = (s) => String(s || "").toLowerCase().replace(/[\s\r\n*.:;,-]+/g, " ").trim();
    const currentLabel = labelOfControl(field.el);
    const staleLabel = field.rawLabel && currentLabel && (norm(currentLabel) !== norm(field.rawLabel) && !norm(currentLabel).includes(norm(field.rawLabel)) && !norm(field.rawLabel).includes(norm(currentLabel)));
    if(before.length || options.isCancelled?.() || !ticket.valid() || staleLabel)return false;
    const ok=await fillFile(field.el,dataUrl,name,()=>ticket.valid()&&!options.isCancelled?.());
    if(!ok)return false;
    const file=field.el.files[0];
    field.proposedWrite={value:{name:file.name,size:file.size},ruleId:null};
    field.verification=await verify(field,{name:file.name,size:file.size},null,ticket,options);
    const box=field.el.closest('[data-automation-id="formField"],[data-upload],.dropzone') || field.el.parentElement;
    const states=box?[box,...box.querySelectorAll('[data-upload-state="error"],[aria-busy="true"],[role="alert"]')]:[];
    if(states.some(el=>el.getAttribute('data-upload-state')==='error' || el.getAttribute('aria-busy')==='true' || el.getAttribute('role')==='alert' && el.getClientRects().length && el.textContent.trim()))field.verification={...field.verification,status:"deferred",reason:"upload_pending_or_error"};
    return field.verification.status==="verified";
  } finally {ticket.dispose();}
}
