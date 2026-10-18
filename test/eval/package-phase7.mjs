import { readFile,writeFile,mkdir,copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractVerifiedPackage } from "./package-lib.mjs";
const root=process.cwd(),destination=resolve(root,'docs/evidence/phase7'),pkg=await extractVerifiedPackage(root),load=async name=>JSON.parse(await readFile(resolve(root,'test/eval/output',name+'.json')));
const [corpus,review,controls,resolver,select2,tools,live,timing]=await Promise.all(['phase7','phase6','phase5','phase4','reported-keka','phase7-tools','phase7-live','phase7-trials'].map(load));
for(const gate of [review,controls,resolver,select2])if(!gate.passed||gate.bundleHash!==pkg.bundleHash)throw Error('Failed or stale regression gate');
if(corpus.package.zipSHA256!==pkg.zipSHA256||corpus.bundleHash!==pkg.bundleHash||corpus.rows.length<1000||corpus.runs.length<40)throw Error('Stale or incomplete packaged corpus');
const failed=corpus.checks.filter(c=>!c.pass);
if(failed.some(c=>c.id!=='answerable-coverage-95-percent')||!tools.passed)throw Error('Unexpected engineering failure; inspect before freezing');
const unit=await readFile(resolve(root,'test/eval/output/phase7-unit.txt'),'utf8');if(/FAIL|test scripts failed/.test(unit)||!unit.includes('phase7: 83 assertions passed'))throw Error('Unit gate failed or stale');
const unitChecks=[...unit.matchAll(/(\d+)\/\d+ passed|(\d+) assertions passed/g)].reduce((s,m)=>s+Number(m[1]||m[2]),0);
await mkdir(destination,{recursive:true});
for(const [source,target]of [['phase7.json','extension.json'],['phase6.json','review.json'],['phase5.json','controls.json'],['phase4.json','resolver.json'],['reported-keka.json','select2.json'],['phase7-tools.json','tools.json'],['phase7-live.json','live.json'],['phase7-trials.json','timing.json'],['phase7-unit.txt','unit.txt']])await copyFile(resolve(root,'test/eval/output',source),resolve(destination,target));
const summary={measuredAt:new Date().toISOString(),files:pkg.entries.length,zipSHA256:pkg.zipSHA256,bundleSHA256:pkg.bundleHash,everyPackagedFileMatchesSource:true,
 unitChecks,phase7UnitChecks:83,corpusVariants:corpus.runs.length,labeledFields:corpus.rows.length,packageChecks:corpus.checks.length,reviewChecks:review.results.length,controlChecks:controls.checks.length,resolverChecks:resolver.checks.length,select2Checks:select2.results.length,recorderChecks:tools.checks.length,
 metrics:corpus.metrics,supportedMetrics:corpus.supportedMetrics,latency:corpus.latency,failedGates:failed.map(c=>c.id),liveProviderCheck:live.status,humanTrials:timing.trials,timeSavingMeasured:timing.targetMeasured,
 releaseReady:corpus.passed&&live.passed&&timing.targetPassed,entries:pkg.entries};
await writeFile(resolve(destination,'package.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,entries:undefined,metrics:summary.metrics.overall},null,2));
