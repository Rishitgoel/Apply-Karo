import assert from "node:assert/strict";
import { createResolver, newBudget, cacheKey } from "../src/resolver/service.js";
import { resolveOne } from "../src/resolver/resolve.js";
import { prepareField } from "../src/resolver/format.js";
import { parseDecisions, capabilities } from "../src/ai/schemas.js";
import { generate } from "../src/ai/transport.js";
import { questionContext, answerIdentity } from "../src/knowledge/retrieve.js";
import { profile } from "./fixtures/autofill/corpus.mjs";
let checks = 0;
const equal = (a,b) => { assert.deepEqual(a,b); checks++; };
const field = (question, extra={}) => prepareField({ fieldId: "field-one", revision: 1, questionFull: question, label: question, kind: "text", type: "text", section: "personal", nameTokens: [], ...extra });
const context = { profile, settings: { provider: "groq", groqModel: "fixture", groqApiKey: "synthetic" }, url: "https://example.invalid/apply", knowledge: { answers: {}, dependencies: {}, facts: {} }, resumeText: "Avery Shah built internal tools at Example Labs." };
let calls=0;
const forbidden = createResolver({ request: () => { calls++; throw new Error("Unexpected model call"); } });
equal((await forbidden.resolve([field("First name", { atsField: "firstName" })], context, { useAI: true })).decisions[0].value, "Avery");
equal(calls,0);
const duplicates=[field("First name",{fieldId:"duplicate-a",atsField:"firstName"}),field("First name",{fieldId:"duplicate-b",atsField:"firstName"})];
const factSelector=createResolver({request:async(_settings,prompt)=>{const packet=JSON.parse(prompt.split("AUTOFILL_PACKET=")[1]);return JSON.stringify({decisions:packet.fields.map(f=>({fieldId:f.fieldId,revision:f.revision,status:"fact",factId:"profile:personal.firstName",memoryId:null,value:null,optionIds:[],claims:[]}))});}});
const duplicateResult=await factSelector.resolve(duplicates,context,{useAI:true});equal(duplicateResult.decisions.map(d=>d.value),["Avery","Avery"]);equal(duplicateResult.requests,1);
for (const [question, rule] of [["Emergency contact first name","firstName"],["Country of citizenship","country"],["Country of birth","country"],["Employer city","city"],["Previous employer","company"],["First name and last name","firstName"],["Do you have a first name without restrictions?","firstName"],["Expected salary in USD per year","firstName"],["Are you comfortable sharing your first name?","firstName"],["Full name in initials","fullName"]]) {
  equal(resolveOne(field(question), { ...context, mapping: { ruleId: rule } }).value,null);
}
equal(resolveOne(field("Employer", { section: "experience", instance: 1 }), { ...context, profile: { experience: [...profile.experience, { company: "Earlier Labs" }] }, mapping: {ruleId:"company",instance:1} }).value,"Earlier Labs");
equal(resolveOne(field("First name", { maxLength: 2 }), { ...context, mapping: {ruleId:"firstName"} }).value,null);
equal(resolveOne(field("Current employer",{section:"experience"}),{...context,mapping:{ruleId:"company"}}).value,null);
equal(resolveOne(field("Current employer",{section:"experience"}),{...context,profile:{...profile,experience:[{...profile.experience[0],current:true}]},mapping:{ruleId:"company"}}).value,"Example Labs");
equal(resolveOne(field("Country", { options:["Canada","India"] }), { ...context, mapping:{ruleId:"country"} }).value,null);
equal(resolveOne(field("Country", { options:["United States","Canada"] }), { ...context, mapping:{ruleId:"country"} }).optionIds,["field-one:option:0"]);
const setupFacts = Object.fromEntries([["availability.noticeDays","30"],["availability.startDate","2027-01-15"],["compensation.amount","120000"],["compensation.currency","USD"],["compensation.period","year"]].map(([intent,value])=>[intent,{id:intent,intent,value,status:"confirmed",refreshAfter:Date.now()+60000}]));
const setupContext={...context,knowledge:{...context.knowledge,facts:setupFacts}};
for(const [question,value,type] of [["Notice period","30 days"],["Notice period in days","30"],["Earliest available start date","2027-01-15"],["Expected annual salary in USD","120000","number"],["Expected monthly salary in USD",null],["Expected annual salary in INR",null],["Current annual salary in USD",null],["Can you give 30 days notice?",null],["Are you available to start on Monday?",null],["Notice period in weeks",null],["Expected annual salary in USD and INR",null]]) equal(resolveOne(field(question,{type:type||"text"}),setupContext).value,value);
equal(resolveOne(field("Notice period"),{...setupContext,knowledge:{...context.knowledge,facts:{notice:{...setupFacts["availability.noticeDays"],refreshAfter:1}}}}).value,null);
equal(resolveOne(field("Start date",{section:"education"}),setupContext).value,null);
equal(resolveOne(field("First name",{helperText:"Emergency contact details"}),{...context,mapping:{ruleId:"firstName"}}).value,null);
equal(resolveOne(field("Country code"),{...context,mapping:{ruleId:"country"}}).value,null);
const auth={...setupContext,knowledge:{...context.knowledge,facts:{auth:{id:"auth",status:"confirmed",intent:"authorization.authorized",scope:{type:"country",country:"india"},value:"Yes"}}}};
for(const q of ["Are you authorized to work in Canada?","Are you authorized to work in India without sponsorship?","Are you authorized to work in India now or in future?"]) equal(resolveOne(field(q),{...auth,mapping:{ruleId:"authorizedToWork"}}).value,null);
equal(resolveOne(field("Are you authorized to work in India?",{options:["Yes","No"]}),{...auth,mapping:{ruleId:"authorizedToWork"}}).value,"Yes");
const prose=field("Describe a project you built",{kind:"textarea"});
const row = (f,extra={}) => ({fieldId:f.fieldId,revision:f.revision,status:"needs_user",factId:null,memoryId:null,value:null,optionIds:[],claims:[],...extra});
const json = rows => JSON.stringify({decisions:rows});
const savedQuestion={...prose,questionFull:"Describe an internal project you built"};
const savedContext=questionContext(savedQuestion,context.url),memoryId=answerIdentity(savedContext);
const memoryState={...context.knowledge,answers:{[memoryId]:{id:memoryId,question:savedQuestion.questionFull,context:savedContext,status:"approved",value:"I built internal tools at Example Labs.",scope:{type:"application",application:savedContext.application},dependencies:{}}}};
let memoryCalls=0;
const memoryResolver=createResolver({request:async()=>{memoryCalls++;return json([row(prose,{status:"memory",memoryId})]);}});
equal((await memoryResolver.resolve([prose],{...context,knowledge:memoryState},{useAI:true})).decisions[0].status,"draft");
equal(memoryCalls,1);
equal((await forbidden.resolve([savedQuestion],{...context,knowledge:memoryState},{useAI:true})).decisions[0].value,"I built internal tools at Example Labs.");equal(calls,0);
for(const extra of [{fieldId:"unknown"},{revision:2},{unknown:true},{claims:[{text:"fake",quote:"fake"}]},{optionIds:[3]}]) { assert.throws(()=>parseDecisions(json([row(prose,extra)]),[prose])); checks++; }
assert.throws(()=>parseDecisions(json([row(prose),row(prose)]),[prose])); checks++;
const draft = f => row(f,{status:"draft", value:"I built internal tools at Example Labs.", claims:[{text:"I built internal tools at Example Labs.",quote:context.resumeText,evidenceId:"resume:span:0"}]});
let requests=0;
const resolver=createResolver({request:async(_settings,prompt)=>{requests++; const packet=JSON.parse(prompt.split("AUTOFILL_PACKET=")[1]); return json(packet.fields.map(draft).reverse());}});
equal((await resolver.resolve([prose],context,{useAI:true})).decisions[0].status,"draft");
equal((await resolver.resolve([prose],context,{useAI:true})).decisions[0].cached,true); equal(requests,1);
for(const replacement of [{resumeText:"Changed resume"},{profile:{...profile,summary:"Changed"}},{settings:{...context.settings,groqModel:"other"}},{settings:{...context.settings,defaultCustomInstruction:"short"}},{jobContext:{company:"other"}},{knowledge:{...context.knowledge,answers:{new:{}}}},{url:"https://other.invalid/apply"}]) equal(cacheKey(prose,context)===cacheKey(prose,{...context,...replacement}),false);
equal(cacheKey(prose,context)===cacheKey({...prose,options:[{label:"new"}]},context),false);
for(const claim of ["I did not build internal tools at Example Labs.","I built internal tools at Example Labs and increased sales by 80%.","I built internal tools at Example Labs!"]) {
 const bad=createResolver({request:async()=>json([draft(prose)].map(r=>({...r,value:claim,claims:[{...r.claims[0],text:claim}]})))});
 equal((await bad.resolve([prose],context,{useAI:true})).decisions[0].value,null);
}
let retries=0;
const retry=createResolver({request:async()=>++retries===1?"invalid":json([draft(prose)])});
equal((await retry.resolve([prose],context,{useAI:true})).decisions[0].status,"draft"); equal(retries,2);
retries=0; const abstain=createResolver({request:async()=>{retries++;return json([row(prose)]);}});
equal((await abstain.resolve([prose],context,{useAI:true})).decisions[0].status,"needs_user");equal(retries,1);
let networkCalls=0;const network=createResolver({request:async()=>{if(++networkCalls===1)throw Object.assign(new Error("temporary"),{status:503});return json([row(prose)]);}});
equal((await network.resolve([prose],context,{useAI:true})).decisions[0].status,"needs_user");equal(networkCalls,2);
for(const error of [Object.assign(new Error("quota"),{quota:true}),Object.assign(new Error("auth"),{status:401})]) {
 retries=0;const fail=createResolver({request:async()=>{retries++;throw error;}});
 equal((await fail.resolve([prose],context,{useAI:true})).decisions[0].status,"deferred");equal(retries,1);
}
equal((await resolver.resolve([{...prose,fieldId:"new"}],context,{useAI:true,budget:newBudget({maxRequests:0})})).decisions[0].reason,"budget");
const timeout=createResolver({request:()=>new Promise(()=>{})});
equal((await timeout.resolve([prose],context,{useAI:true,budget:newBudget({deadlineMs:15})})).decisions[0].reason,"budget");
const controller=new AbortController(); setTimeout(()=>controller.abort(),10);
equal((await timeout.resolve([prose],context,{useAI:true,budget:newBudget({signal:controller.signal})})).decisions[0].reason,"cancelled");
const many=Array.from({length:9},(_,i)=>({...prose,fieldId:"p"+i}));
const partial=await resolver.resolve(many,context,{useAI:true,budget:newBudget({maxRequests:1})});
equal(partial.decisions.filter(r=>r.status==="draft").length,8);equal(partial.decisions[8].reason,"budget");
equal(capabilities("groq","openai/gpt-oss-120b").schema,true);equal(capabilities("groq","llama-3.3-70b-versatile").schema,false);equal(capabilities("gemini","gemini-2.5-flash").schema,true);
const oldFetch=globalThis.fetch;let bodies=[];
try {
 globalThis.fetch=async(_url,opts)=>{bodies.push(JSON.parse(opts.body));return {ok:true,json:async()=>({choices:[{message:{content:'{}'}}],candidates:[{content:{parts:[{text:'{}'}]}}]})};};
 await generate({...context.settings,groqModel:"openai/gpt-oss-120b"},"synthetic",{json:true,schema:{type:"object"},maxRetries:0});
 equal(bodies[0].response_format.type,"json_schema");equal(bodies[0].model,"openai/gpt-oss-120b");
 await generate({provider:"gemini",geminiApiKey:"synthetic",geminiModel:"gemini-2.5-flash"},"synthetic",{json:true,schema:{type:"object"},maxRetries:0});
 equal(bodies[1].generationConfig.responseJsonSchema,{type:"object"});
} finally {globalThis.fetch=oldFetch;}
console.log(`phase4: ${checks} assertions passed`);
