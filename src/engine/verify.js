import { readControl, controls, validationState } from "./controls/read.js";
import { rankChoices } from "./controls/workday.js";
import { asBool, parseDate, datePartValue, monthName } from "../shared/values.js";
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const norm = v => String(v ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
export function accepts(field, value, ruleId) {
  const actual = readControl(field), targets = Array.isArray(value) ? value : [value];
  if (["checkbox", "switch"].includes(field.kind)) return actual === asBool(value);
  if (["select", "radiogroup", "checkboxgroup"].includes(field.kind)) {
    const desired = targets.map(v => rankChoices(field.options || [], v, ruleId).choice);
    if (desired.some(v => !v)) return false;
    const want = desired.map(o => String(o.value || o.label));
    return Array.isArray(actual) ? same([...actual].sort(),want.sort()) : actual === want[0];
  }
  if (field.kind === "combobox") return targets.every(v => actual.includes(norm(v))) || targets.length === 1 && actual.includes(norm(field.controlOutcome?.value)) && !!field.controlOutcome?.value;
  if (field.kind === "dategroup") {
    const date = parseDate(value); if (!date) return false;
    return field.parts.every(p => { const raw=readControl(p.field), part=datePartValue(date,p.part); return Number(raw) === Number(part) || p.part === "month" && p.field.el.tagName === "SELECT" && norm(p.field.el.selectedOptions[0]?.text).slice(0,3) === norm(monthName(date.month)).slice(0,3); });
  }
  if (field.kind === "file") return actual.length === 1 && actual[0].name === value.name && actual[0].size === value.size;
  if (field.kind === "date" || ruleId && /Date$/.test(ruleId)) {
    const expected=parseDate(value), observed=parseDate(actual); return !!expected && !!observed && expected.year === observed.year && (!expected.month || expected.month === observed.month) && (!expected.day || expected.day === observed.day);
  }
  if(ruleId==="phone" || field.type==="tel") {
    const da = String(actual).replace(/\D/g,""), dv = String(value).replace(/\D/g,"");
    return (da === dv || (da.length >= 7 && dv.length >= 7 && (da.endsWith(dv) || dv.endsWith(da)))) && /\d/.test(dv);
  }
  if(field.type==="number")return Number.isFinite(Number(value))&&actual!==""&&Number(actual)===Number(value);
  const aNorm = String(actual).replace(/\r\n/g,"\n"), vNorm = String(value).replace(/\r\n/g,"\n");
  return aNorm === vNorm || aNorm.trim() === vNorm.trim();
}
export function verificationTicket(field, questionOf) {
  const question=questionOf(field.el), elements=controls(field), initial=readControl(field);
  const context=()=>{const box=field.el.closest('fieldset,[data-automation-id="workExperienceItem"],[data-automation-id="educationItem"]');return JSON.stringify([box?.querySelector('legend,h2,h3,h4')?.textContent||"",elements.map(el=>[el.name,el.type,el.disabled,el.readOnly,el.maxLength,el.min,el.max,el.pattern,el.getAttribute?.("aria-label"),el.getAttribute?.("aria-describedby"),(el.getAttribute?.("aria-describedby")||"").split(/\s+/).map(id=>el.getRootNode().getElementById?.(id)?.textContent||"")]),field.kind==="select"?[...field.el.options].map(o=>[o.value,o.text,o.disabled]):null]);};
  const signature=context();
  let edited=false, writing=false;
  const edit=e=>{if(e.isTrusted && !writing) edited=true;};
  elements.forEach(el=>{el.addEventListener("input",edit);el.addEventListener("change",edit);});
  return { initial, get edited(){return edited;}, valid:()=>!edited && elements.every(el=>el.isConnected) && questionOf(field.el)===question && context()===signature,
    writing:fn=>{writing=true;try{return fn();}finally{writing=false;}}, dispose:()=>elements.forEach(el=>{el.removeEventListener("input",edit);el.removeEventListener("change",edit);}) };
}
export async function verify(field, value, ruleId, ticket, { settleMs=450, isCancelled=()=>false }={}) {
  const deadline=Date.now()+settleMs;
  let persistent=true;
  do {
    if(isCancelled() || !ticket.valid()) return { status:"deferred", writeAttempted:true, domAccepted:false, validation:"not_checked", reason:isCancelled()?"cancelled":ticket.edited?"user_edit":"stale_descriptor" };
    persistent &&= accepts(field,value,ruleId);
    await new Promise(r=>setTimeout(r,Math.min(50,Math.max(1,deadline-Date.now()))));
  } while(Date.now()<deadline);
  const validation=validationState(field), domAccepted=persistent && accepts(field,value,ruleId);
  return { status:domAccepted && validation!=="failed"?"verified":"rejected",writeAttempted:true,domAccepted,validation,
    reason:!domAccepted?"value_not_persistent":validation==="failed"?"validation_failed":"canonical_value_persistent" };
}
export function guardUndo(field, restore) {
  let expected, edited=false, armed=false;
  const elements=controls(field), edit=e=>{if(armed && e.isTrusted) edited=true;};
  const dispose=()=>{armed=false;elements.forEach(el=>{el.removeEventListener("input",edit);el.removeEventListener("change",edit);});};
  const undo=()=>{if(!armed || edited || elements.some(el=>!el.isConnected) || !same(readControl(field),expected)){dispose();return false;}const restored=restore();dispose();return restored!==false;};
  undo.arm=()=>{expected=structuredClone(readControl(field));armed=true;elements.forEach(el=>{el.addEventListener("input",edit);el.addEventListener("change",edit);});};
  undo.dispose=dispose;return undo;
}
