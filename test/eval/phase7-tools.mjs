import { mkdir,writeFile,readFile } from "node:fs/promises";
import { startServer } from "./server.mjs";
import { loadPlaywright,browserOptions } from "./runtime.mjs";
import { trialMetrics } from "../../src/release/metrics.js";
const server=await startServer(),{chromium}=loadPlaywright(),browser=await chromium.launch(browserOptions()),page=await browser.newPage({viewport:{width:800,height:1000}}),checks=[];
const check=(id,actual,expected)=>{const pass=JSON.stringify(actual)===JSON.stringify(expected);checks.push({id,actual,expected,pass});console.log(`${pass?'PASS':'FAIL'} ${id}`);};
try{
 await page.goto(server.origin+'/trials');await page.locator('#save').click();check('incomplete-pair-not-saved',(await page.locator('#status').textContent()).includes('both methods'),true);
 await page.locator('#manual').click();await page.locator('#stop').click();check('review-required-before-stopping',(await page.locator('#status').textContent()).includes('Finish reviewing'),true);
 await page.locator('#pause').click();await page.locator('#pause').click();await page.locator('#reviewed').check();await page.locator('#stop').click();
 await page.locator('#assisted').click();await page.locator('#reviewed').check();await page.locator('#stop').click();await page.locator('#save').click();check('observer-required',(await page.locator('#status').textContent()).includes('observer'),true);
 await page.locator('#observer').check();await page.locator('#noticed').fill('2');await page.locator('#save').click();check('invalid-error-counts-rejected',(await page.locator('#status').textContent()).includes('error counts'),true);
 await page.locator('#noticed').fill('0');await page.locator('#save').click();check('valid-pair-saved',(await page.locator('#summary').textContent()).includes('1/30'),true);
 const event=page.waitForEvent('download');await page.locator('#export').click();const download=await event,document=JSON.parse(await readFile(await download.path(),'utf8'));
 check('records-both-methods',document.trials[0].manualActiveMs>0&&document.trials[0].assistedActiveMs>0,true);check('elapsed-includes-wait',document.trials[0].manualElapsedMs>=document.trials[0].manualActiveMs,true);
 check('workload-even-mix',document.workload,{Workday:10,Keka:10,Other:10});check('one-ui-test-does-not-prove-target',trialMetrics(document).targetMeasured,false);
 await page.setViewportSize({width:390,height:850});check('narrow-screen-no-horizontal-overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await mkdir(new URL('./output/',import.meta.url),{recursive:true});await writeFile(new URL('./output/phase7-tools.json',import.meta.url),JSON.stringify({evidenceKind:'synthetic-recorder-ui-test',checks,passed:checks.every(c=>c.pass),humanTrialsPerformed:0},null,2));if(checks.some(c=>!c.pass))process.exitCode=1;
}finally{await browser.close();await server.close();}
