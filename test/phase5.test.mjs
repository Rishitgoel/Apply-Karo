import assert from 'node:assert/strict';
import { accepts,guardUndo } from '../src/engine/verify.js';
import { readControl,validationState } from '../src/engine/controls/read.js';
import { dependencyPriority } from '../src/engine/dependencies.js';
import { formatFact,prepareField } from '../src/resolver/format.js';
import { bindEntities } from '../src/engine/repeats.js';
let checks=0;const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
function element(value='') {const events=new Map();return {value,isConnected:true,type:'text',checked:undefined,textContent:'',getAttribute:()=>null,hasAttribute:()=>false,
 addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn),emit:(name,e)=>{for(const fn of events.get(name)||[])fn(e);}};}
const el=element('Avery'),field={el,kind:'text'};
equal(readControl(field),'Avery');equal(accepts(field,'Avery'),true);equal(accepts(field,'Shah'),false);
el.validity={valid:false};equal(validationState(field),'failed');el.validity.valid=true;equal(validationState(field),'passed');delete el.validity;equal(validationState(field),'not_exposed');
const undo=guardUndo(field,()=>{el.value='';});undo.arm();el.value='Later';equal(undo(),false);equal(el.value,'Later');
el.value='Avery';const edited=guardUndo(field,()=>{el.value='';});edited.arm();el.emit('input',{isTrusted:true});equal(edited(),false);equal(el.value,'Avery');
const untouched=guardUndo(field,()=>{el.value='';});untouched.arm();equal(untouched(),true);equal(el.value,'');
const detached=guardUndo(field,()=>{el.value='Bad';});detached.arm();el.isConnected=false;equal(detached(),false);el.isConnected=true;
const checkbox={el:{...element(),checked:false},kind:'checkbox'};equal(accepts(checkbox,'No'),true);equal(accepts(checkbox,'Yes'),false);
const radio={kind:'radiogroup',el:element(),options:[{label:'Remote',value:'remote',el:{...element(),checked:true}},{label:'Office',value:'office',el:{...element(),checked:false}}]};equal(readControl(radio),['remote']);equal(accepts(radio,'Remote'),true);equal(accepts(radio,'Office'),false);
equal(dependencyPriority({kind:'text'},'country'),0);equal(dependencyPriority({kind:'text'},'university'),1);equal(dependencyPriority({kind:'checkbox'},'currentJob'),2);equal(dependencyPriority({kind:'text'},'state'),3);equal(dependencyPriority({kind:'text'},'email'),4);
const multi=prepareField({fieldId:'multi',kind:'checkboxgroup',options:['Python','JavaScript','Java']});equal(formatFact(multi,'Python, JavaScript','skills').value,['Python','JavaScript']);equal(formatFact(multi,'Python, Rust','skills').reason,'ambiguous_options');
const block={}, anchor={...element('Example'),closest:()=>block}, title={...element('Developer'),closest:()=>block};
const fields=[{el:anchor,section:'experience',instance:0,rawLabel:'Employer'},{el:title,section:'experience',instance:0,rawLabel:'Job title'}];
const rows=[{company:'Example',title:'Engineer'},{company:'Example',title:'Developer'}];
equal(bindEntities(fields,{experience:rows}).map(f=>f.instance),[1,1]);
anchor.value='';title.value='';equal(bindEntities(fields,{experience:[rows[1],rows[0]]}).map(f=>f.instance),[0,0]);
equal(bindEntities(fields,{experience:[{company:'Other',title:'Other'}]}).every(f=>f.entityConflict),true);
console.log(`phase5: ${checks} assertions passed`);
