import { readFile,writeFile,mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { trialMetrics } from "../../src/release/metrics.js";
const file=process.argv[2]||new URL('../../docs/evidence/phase7/trials.json',import.meta.url),raw=await readFile(file),document=JSON.parse(raw);
const report={...trialMetrics(document),sourceSHA256:createHash('sha256').update(raw).digest('hex'),measuredAt:new Date().toISOString()};
await mkdir(new URL('./output/',import.meta.url),{recursive:true});await writeFile(new URL('./output/phase7-trials.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
