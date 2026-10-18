import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ROOT, startServer } from "./server.mjs";
import { loadPlaywright, browserOptions } from "./runtime.mjs";
import { buildBundle } from "../../bundle.mjs";
import { corpus, profile } from "../fixtures/autofill/corpus.mjs";
buildBundle();
const server=await startServer(), {chromium}=loadPlaywright();
const context=await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(),"resumefiler-phase4-")),{...browserOptions(),args:[`--disable-extensions-except=${ROOT}`,`--load-extension=${ROOT}`]});
const checks=[], rows=[];
const check=(id,actual,expected)=>{const pass=JSON.stringify(actual)===JSON.stringify(expected);checks.push({id,actual,expected,pass});console.log(`${pass?"PASS":"FAIL"} ${id}: ${JSON.stringify(actual)}`);};
try {
 const worker=context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
 await worker.evaluate(async profile=>{
  await chrome.storage.local.set({schemaVersion:2,profile,settings:{autofillOnLoad:false,aiAutofillEnabled:true,autoUploadResume:false,trackApplications:false,provider:"groq",groqApiKey:"synthetic",groqModel:"fixture"},resumeMeta:{text:"Avery Shah built internal tools at Example Labs.",fileName:"",textFileName:""}});
  globalThis.__requests=[];globalThis.__delay=0;globalThis.__mode="draft";
  globalThis.fetch=async(_url,opts)=>{
   const prompt=JSON.parse(opts.body).messages[0].content, packet=JSON.parse(prompt.split("AUTOFILL_PACKET=")[1]);
   globalThis.__requests.push(packet);
   if(globalThis.__delay) await new Promise(r=>setTimeout(r,globalThis.__delay));
   const decisions=packet.fields.map(f=>({fieldId:f.fieldId,revision:f.revision,status:globalThis.__mode==="unknown"?"needs_user":"draft",factId:null,memoryId:null,value:globalThis.__mode==="unknown"?null:"I built internal tools at Example Labs.",optionIds:[],claims:globalThis.__mode==="unknown"?[]:[{text:"I built internal tools at Example Labs.",quote:"Avery Shah built internal tools at Example Labs.",evidenceId:packet.evidence.find(e=>e.text.includes("Avery Shah built internal tools"))?.id || "unsupported"}]})).reverse();
   if(globalThis.__mode==="badid") decisions[0].fieldId="invented-field";
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({decisions})}}]})};
  };
 },profile);
 const page=await context.newPage(), targetUrl=server.origin+"/phase2/scoped-correction";
 try { await page.goto(targetUrl); } catch (error) {
  const onboarding=worker.url().replace('/background.js','/options.html'); if(!error.message.includes(onboarding))throw error;
  await page.waitForURL(onboarding);await page.waitForLoadState('domcontentloaded');await page.goto(targetUrl);
 }
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url());
 const call=msg=>worker.evaluate(async({tabId,msg})=>{const [r]=await chrome.scripting.executeScript({target:{tabId},func:msg=>chrome.runtime.sendMessage(msg),args:[msg]});return r.result;},{tabId,msg});
 const factual={fieldId:"fact-one",revision:1,label:"First name",questionFull:"First name",kind:"text",type:"text",section:"personal",nameTokens:[],atsField:"firstName"};
 const prose={...factual,fieldId:"prose-one",atsField:undefined,label:"Describe a project you built",questionFull:"Describe a project you built",kind:"textarea"};
 let result=await call({type:"ai_fill",fields:[factual]});check("exact-fact-through-worker",result.decisions[0].value,"Avery");check("exact-fact-zero-fetch",await worker.evaluate(()=>__requests.length),0);
 result=await call({type:"ai_fill",fields:[prose,{...prose,fieldId:"prose-two"}]});check("reordered-stable-ids",result.decisions.map(d=>[d.fieldId,d.status]),[["prose-one","draft"],["prose-two","draft"]]);
 const before=await worker.evaluate(()=>__requests.length);result=await call({type:"ai_fill",fields:[prose]});check("worker-cache-hit",result.decisions[0].cached,true);check("worker-cache-zero-fetch",await worker.evaluate(()=>__requests.length),before);
 await worker.evaluate(()=>{__mode="badid";});result=await call({type:"ai_fill",fields:[{...prose,revision:2}]});check("unknown-id-no-write",result.decisions[0].value,null);check("schema-retry-bounded",await worker.evaluate(()=>__requests.length)-before,2);
 await worker.evaluate(()=>{__mode="unknown";});const prior=await worker.evaluate(()=>__requests.length);result=await call({type:"ai_fill",fields:[{...prose,revision:3}]});check("abstention-no-retry",await worker.evaluate(()=>__requests.length)-prior,1);
 await worker.evaluate(()=>{__mode="draft";__delay=250;});
 const pending=call({type:"ai_fill",fields:[{...prose,revision:4}]});await page.waitForTimeout(80);await worker.evaluate(async()=>{const {profile}=await chrome.storage.local.get("profile");profile.personal.firstName="Changed";await chrome.storage.local.set({profile});});
 result=await pending;check("in-flight-profile-change-deferred",result.decisions[0].reason,"source_changed");
 const cancelled=call({type:"ai_fill",fields:[{...prose,revision:5}],runId:"cancel-fixture"});await page.waitForTimeout(80);await call({type:"cancel_resolution",runId:"cancel-fixture"});result=await cancelled;check("worker-cancellation-no-write",result.decisions[0].reason,"cancelled");
 await worker.evaluate(async profile=>{__delay=0;await chrome.storage.local.set({profile,resumeMeta:{fileName:"new.pdf",textFileName:"old.pdf",text:"Avery Shah built internal tools at Example Labs."}});},profile);
 result=await call({type:"ai_fill",fields:[{...prose,revision:6}]});check("stale-resume-does-not-ground",result.decisions[0].value,null);
 const knowledge={answers:{},dependencies:{},facts:{auth:{id:"auth",status:"confirmed",intent:"authorization.authorized",value:"Yes",scope:{type:"country",country:"united states"}},sponsor:{id:"sponsor",status:"confirmed",intent:"authorization.sponsorship",value:"No",scope:{type:"country",country:"united states"}},notice:{id:"notice",status:"confirmed",intent:"availability.noticeDays",value:"30"}}};
 for(const form of corpus.filter(f=>f.split==="heldout")) {
  await page.goto(server.origin+"/apply/forms/"+form.id);
  const frame=form.family==="frame"?page.frames().find(f=>f.url().includes("/apply/inner/")):page.mainFrame();await frame.waitForFunction(()=>window.__fixtureReady);
  const observations=await frame.evaluate(async({profile,knowledge,gold,origin})=>{
   const {scan}=await import(origin+"/src/engine/scan.js"),{assign}=await import(origin+"/src/shared/rules.js"),{resolveFields}=await import(origin+"/src/resolver/resolve.js"),{ruleCandidate}=await import(origin+"/src/resolver/validate.js");
   const fields=scan(document.querySelector("synthetic-form")?.shadowRoot || document), mappings=assign(fields,{skipSensitive:true,hasAnswerFor:()=>true,canMap:ruleCandidate});
   const decisions=resolveFields(fields,{profile,knowledge,settings:{skipSensitive:true},url:location.href,mappings});
   return fields.map((f,i)=>{const g=gold.find(g=>g.id===f.el.getAttribute("data-gold-id"));return {id:g?.id,question:f.questionFull,expected:g?.answer,answerable:g?.answerable,status:decisions[i].status,value:decisions[i].value,reason:decisions[i].reason};});
  },{profile,knowledge,gold:form.questions,origin:server.origin});rows.push(...observations.map(r=>({...r,template:form.id})));
 }
 const approved=rows.filter(r=>r.status==="resolved"), correct=approved.filter(r=>r.value===r.expected), answerable=rows.filter(r=>r.answerable);
 const metrics={templates:9,observations:rows.length,approved:approved.length,correct:correct.length,precision:approved.length?correct.length/approved.length:0,coverage:answerable.length?correct.length/answerable.length:0,answerable:answerable.length,unsupported:approved.filter(r=>r.expected==null).length};
 check("heldout-factual-precision-at-least-99-percent",metrics.precision>=.99,true);check("heldout-no-unsupported-safety-answer",metrics.unsupported,0);console.log(JSON.stringify(metrics));
 await mkdir(new URL("./output/",import.meta.url),{recursive:true});await writeFile(new URL("./output/phase4.json",import.meta.url),JSON.stringify({measuredAt:new Date().toISOString(),browser:context.browser()?.version(),bundleHash:createHash("sha256").update(await readFile(join(ROOT,"src/engine/bundle.js"))).digest("hex"),evidenceKind:"synthetic-heldout-resolver-and-real-extension-worker",checks,metrics,rows,passed:checks.every(c=>c.pass),limitations:["Heldout templates were defined in Phase 0 and are now a regression set; not unseen live employers.","Resolver precision is distinct from verified DOM write success.","No live provider, ATS, native popup or human prose/timing acceptance."]},null,2));
 if(checks.some(c=>!c.pass)) process.exitCode=1;
} finally {await context.close();await server.close();}
