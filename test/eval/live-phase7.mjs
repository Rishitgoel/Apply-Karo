import { mkdir,writeFile } from "node:fs/promises";
import { syntheticProviderProbe } from "../../src/release/probe.js";
const settings={provider:process.env.AUTOFILL_LIVE_PROVIDER,groqModel:process.env.AUTOFILL_LIVE_MODEL,geminiModel:process.env.AUTOFILL_LIVE_MODEL,
  groqApiKey:process.env.GROQ_API_KEY,geminiApiKey:process.env.GEMINI_API_KEY};
const explicit=!!settings.provider&&!!process.env.AUTOFILL_LIVE_MODEL;
const report=explicit?await syntheticProviderProbe(settings):{status:"pending",passed:false,reason:"Set AUTOFILL_LIVE_PROVIDER and AUTOFILL_LIVE_MODEL plus the selected provider key in the environment, or run the dashboard synthetic check.",requests:0,costUsd:null,syntheticOnly:true};
await mkdir(new URL('./output/',import.meta.url),{recursive:true});await writeFile(new URL('./output/phase7-live.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(explicit&&!report.passed)process.exitCode=1;
