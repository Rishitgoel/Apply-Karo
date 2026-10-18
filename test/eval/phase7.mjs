import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, startServer } from "./server.mjs";
import { loadPlaywright, browserOptions } from "./runtime.mjs";
import { extractVerifiedPackage } from "./package-lib.mjs";
import { phase7Corpus, phase7Profile } from "../fixtures/autofill/phase7.mjs";
import { fieldMetrics, percentile } from "../../src/release/metrics.js";
const packageEvidence = await extractVerifiedPackage(ROOT), server = await startServer(), { chromium } = loadPlaywright();
const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(),"apply-karo-release-")), { ...browserOptions(), args:[`--disable-extensions-except=${packageEvidence.directory}`,`--load-extension=${packageEvidence.directory}`] });
const rows = [], runs = [], checks = [], check = (id,actual,expected) => { const pass=JSON.stringify(actual)===JSON.stringify(expected); checks.push({id,actual,expected,pass}); console.log(`${pass?'PASS':'FAIL'} ${id}`); };
const smokeOnly=process.argv.includes('--smoke-only');
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker"), extension = worker.url().replace('/background.js','');
  const driver = await context.newPage(); await driver.goto(extension+'/privacy.html');
  await worker.evaluate(async profile => { await chrome.storage.local.set({schemaVersion:2,profile,settings:{autofillOnLoad:false,aiAutofillEnabled:false,autoUploadResume:false,trackApplications:false,skipSensitive:true,panelEnabled:true}}); globalThis.__requests=0;globalThis.fetch=()=>{globalThis.__requests++;throw Error('Live calls forbidden in corpus');}; }, phase7Profile);
  const execute = async (tabId,method,args=[]) => worker.evaluate(async ({tabId,method,args}) => { const [r] = await chrome.scripting.executeScript({target:{tabId},func:async(method,args)=>{await window.__applyKaroEngine.ready();return await window.__applyKaroEngine[method](...args);},args:[method,args]}); return r.result; },{tabId,method,args});
  for (const form of smokeOnly?[]:phase7Corpus) {
    const page=await context.newPage();await page.goto(server.origin+'/phase7/forms/'+form.id); await page.bringToFront();
    const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,page.url());
    const started=Date.now(), outcome=await driver.evaluate(async tabId=>chrome.runtime.sendMessage({type:'tab_action',action:'rf_fill',tabId}),tabId);
    const reviews=await driver.evaluate(async tabId=>chrome.runtime.sendMessage({type:'tab_action',action:'rf_review',tabId}),tabId);
    const observed=await Promise.all(page.frames().map(frame=>frame.evaluate(async origin=>{
      const {scan}=await import(origin+'/src/engine/scan.js'),{readControl,validationState}=await import(origin+'/src/engine/controls/read.js');
      return {fields:scan().filter(f=>f.el.dataset.goldId).map(f=>({id:f.el.dataset.goldId,question:f.questionFull,value:readControl(f),kind:f.kind,validation:validationState(f)})),submissions:window.__submissions||0};
    },server.origin)));
    const fields=observed.flatMap(r=>r.fields), normalize = value => String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    for(const gold of form.questions) {
      const actual=fields.find(f=>f.id===gold.id), value=Array.isArray(actual?.value)?actual.value.join(', '):actual?.value??'', written=!!String(value).trim(), review=reviews.reviewRows?.find(r=>normalize(r.question)===normalize(actual?.question));
      rows.push({template:form.id,family:form.family,id:gold.id,answerable:gold.answerable,expected:gold.answer,actual:value,discovered:!!actual,questionCorrect:!!actual&&normalize(actual.question)===normalize(gold.question),written,correct:written&&gold.answer!==null&&normalize(value)===normalize(gold.answer),accepted:written&&actual?.validation!=='failed',reportedVerified:review?.group==='Verified facts',unsupported:form.family==='restricted',adversarial:!!gold.adversarial});
    }
    runs.push({template:form.id,family:form.family,elapsedMs:Date.now()-started,reportedFilled:outcome.filled||0,observedWrites:fields.filter(f=>Array.isArray(f.value)?f.value.length:String(f.value||'').trim()).length,submissions:observed.reduce((s,r)=>s+r.submissions,0)});
    console.log(`${form.id}: ${fields.length}/${form.questions.length} discovered, ${outcome.filled||0} reported filled`);
    await page.close();
  }
  if(!smokeOnly){check('at-least-40-variants',phase7Corpus.length>=40,true);check('at-least-1000-labeled-fields',rows.length>=1000,true);}
  check('zero-final-submissions',runs.reduce((s,r)=>s+r.submissions,0),0);check('no-live-requests',await worker.evaluate(()=>__requests),0);
  const metrics=fieldMetrics(rows),supported=rows.filter(r=>!r.unsupported), supportedMetrics=fieldMetrics(supported).overall;
  if(!smokeOnly){
  check('supported-discovery-98-percent',supportedMetrics.discovered/supportedMetrics.fields>=.98,true);
  check('supported-question-fidelity-99-percent',supportedMetrics.questionFidelity>=.99,true);
  check('factual-precision-99-percent',(metrics.overall.precision??0)>=.99,true);
  check('answerable-coverage-95-percent',(metrics.overall.coverage??0)>=.95,true);
  check('zero-false-successes',metrics.overall.falseSuccesses,0);
  check('supported-accepted-write-rate-99-percent',(supportedMetrics.acceptedWriteRate??0)>=.99,true);
  check('integer-only-GPA-not-reported-verified',rows.find(r=>r.id==='release-4-0-q15')?.reportedVerified,false);
  check('adversarial-zero-writes',rows.filter(r=>r.adversarial&&r.written).length,0);
  }
  const smoke=await context.newPage();await smoke.goto(server.origin+'/phase7/forms/release-0-0');const smokeId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,smoke.url());
  await worker.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:{...settings,release:{version:'verified-autofill-v1',stage:'paused',percentage:100,cohort:0,descriptor:true,resolver:true,adapter:true}}});});
  const paused=await driver.evaluate(async tabId=>chrome.runtime.sendMessage({type:'tab_action',action:'rf_fill',tabId}),smokeId);check('rollback-pause-zero-writes',paused.filled||0,0);
  const before=await driver.evaluate(()=>chrome.runtime.sendMessage({type:'knowledge',action:'snapshot'}));check('rollback-keeps-knowledge',!!before.result?.legacy?.backup,true);
  const blocked=await driver.evaluate(()=>chrome.runtime.sendMessage({type:'ai_fill',fields:[{fieldId:'pause',revision:1,questionFull:'First name',kind:'text'}]}));check('worker-resolver-pause',blocked.ok,false);
  const selectedProbe=await driver.evaluate(()=>chrome.runtime.sendMessage({type:'synthetic_provider_probe'}));check('no-key-live-probe-pending',selectedProbe.result?.status,'pending');
  const forbiddenProbe=await worker.evaluate(async tabId=>{const [r]=await chrome.scripting.executeScript({target:{tabId},func:()=>chrome.runtime.sendMessage({type:'synthetic_provider_probe'})});return r.result;},smokeId);check('content-page-cannot-spend-probe-quota',forbiddenProbe.ok,false);
  await worker.evaluate(async()=>{
    const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:{...settings,provider:'groq',groqModel:'fixture',groqApiKey:'synthetic-key'},profile:{personal:{firstName:'USER_PRIVATE_SENTINEL'}},resumeMeta:{text:'USER_RESUME_SENTINEL'}});
    globalThis.__probeLeak=false;globalThis.__probeModels=[];globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body),prompt=body.messages[0].content;globalThis.__probeLeak ||= /USER_PRIVATE_SENTINEL|USER_RESUME_SENTINEL/.test(prompt);globalThis.__probeModels.push(body.model);const packet=JSON.parse(prompt.split('AUTOFILL_PACKET=')[1]),evidence=packet.evidence.find(e=>e.text.includes('Morgan Vale built a parser'));
      return{ok:true,json:async()=>({usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150},choices:[{message:{content:JSON.stringify({decisions:packet.fields.map(f=>({fieldId:f.fieldId,revision:f.revision,status:'draft',factId:null,memoryId:null,value:'I built a parser at Fictional Labs.',optionIds:[],claims:[{text:'I built a parser at Fictional Labs.',evidenceId:evidence.id,quote:'Morgan Vale built a parser at Fictional Labs.'}]}))})}}]})};};
  });
  const workerProbe=await driver.evaluate(()=>chrome.runtime.sendMessage({type:'synthetic_provider_probe'}));check('packaged-worker-synthetic-schema-probe',workerProbe.result?.passed,true);
  check('probe-never-uses-stored-profile-or-resume',await worker.evaluate(()=>__probeLeak),false);check('probe-selected-model-only',await worker.evaluate(()=>__probeModels),['fixture']);
  check('probe-report-redacts-key',JSON.stringify(workerProbe).includes('synthetic-key'),false);check('probe-token-usage-recorded',workerProbe.result?.usage?.[0]?.totalTokens,150);
  const dashboard=await context.newPage();await dashboard.goto(extension+'/options.html#tab-settings');await dashboard.getByRole('button',{name:'Pause automatic filling',exact:true}).click();await dashboard.locator('.toggle-switch:has(#set-diagnostics)').click();
  await dashboard.waitForFunction(async()=>{const{settings}=await chrome.storage.local.get('settings');return settings.diagnosticsEnabled===true;});
  check('ordinary-settings-save-keeps-release-paused',await worker.evaluate(async()=>(await chrome.storage.local.get('settings')).settings.release.stage),'paused');
  await dashboard.getByRole('button',{name:'Resume verified pipeline',exact:true}).click();await dashboard.waitForFunction(async()=>{const{settings}=await chrome.storage.local.get('settings');return settings.release.stage==='stable';});
  await worker.evaluate(async profile=>chrome.storage.local.set({profile}),phase7Profile);
  const resumed=await driver.evaluate(async tabId=>chrome.runtime.sendMessage({type:'tab_action',action:'rf_fill',tabId}),smokeId);check('resume-verified-pipeline-restores-useful-fill',resumed.filled>0,true);
  for(const flag of ['descriptor','resolver','adapter']){await worker.evaluate(async flag=>{const{settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:{...settings,release:{...settings.release,descriptor:true,resolver:true,adapter:true,[flag]:false}}});},flag);const gated=await execute(smokeId,'run',[{manual:true,useAI:false}]);check(flag+'-disabled-fails-closed',gated.filled,0);}
  await dashboard.close();
  await smoke.close();
  const report={measuredAt:new Date().toISOString(),evidenceKind:'packaged-extension-synthetic-factorial-corpus',browser:context.browser()?.version(),package:{...packageEvidence,directory:undefined},bundleHash:packageEvidence.bundleHash,
    checks,passed:checks.every(c=>c.pass),metrics,supportedMetrics,runs,rows,latency:{p50Ms:percentile(runs.map(r=>r.elapsedMs),.5),p90Ms:percentile(runs.map(r=>r.elapsedMs),.9)},model:{corpusRequests:0,corpusRetries:0,corpusCostUsd:0,usage:null},syntheticWorkerProbe:workerProbe.result,humanTrials:{completed:0,targetMeasured:false,targetPassed:false},
    limitations:['42 authored factor combinations of 30 questions, not 1260 independent intents. After first evaluation these become a regression set.','Restricted closed-shadow forms stay in the overall workload denominator; their field values cannot be inspected.','The filler is loaded from the ZIP; read-only observers use byte-identical source modules served locally.','Local browser task latency is not human review time.','Providers are disabled here; zero cost does not estimate live cost.','No claim of real Workday/Keka acceptance or 90% human time saving.']};
  await mkdir(new URL('./output/',import.meta.url),{recursive:true});await writeFile(new URL(smokeOnly?'./output/phase7-smoke.json':'./output/phase7.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({metrics:metrics.overall,supportedMetrics,latency:report.latency,passed:report.passed},null,2));if(!report.passed)process.exitCode=1;
} finally { await context.close();await server.close(); }
