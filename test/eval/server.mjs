import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { corpus, renderFixture, renderForm } from "../fixtures/autofill/corpus.mjs";
import { renderScenario } from "../fixtures/autofill/scenarios.mjs";
import { phase2Fixture } from "../fixtures/autofill/phase2.mjs";
import { phase5Fixture } from "../fixtures/autofill/phase5.mjs";
import { reportedForm, reportedKekaForm } from "../fixtures/autofill/reported-form.mjs";
import { phase7Corpus, renderPhase7 } from "../fixtures/autofill/phase7.mjs";
export const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/trials") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(await readFile(resolve(ROOT,"test/eval/trials.html"))); return; }
      if (url.pathname.startsWith("/phase7/")) { const form = phase7Corpus.find(f => f.id === url.pathname.split("/").pop()); if (!form) { res.writeHead(404).end(); return; } res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(renderPhase7(form, url.pathname.includes("/inner/"))); return; }
      if(url.pathname==="/reported-form"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(reportedForm());return;}
      if(url.pathname==="/reported-keka"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(reportedKekaForm());return;}
      if (url.pathname.startsWith("/phase5/")) { res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});res.end(phase5Fixture(url.pathname.split("/").pop()));return; }
      if (url.pathname.startsWith("/phase2/")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(phase2Fixture(url.pathname.split("/").pop())); return;
      }
      if (url.pathname.startsWith("/neutral/")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderScenario(url.pathname.split("/").pop())); return;
      }
      const match = url.pathname.match(/^\/apply\/(forms|inner)\/([^/]+)$/);
      if (match) {
        const form = corpus.find((f) => f.id === match[2]);
        if (!form) { res.writeHead(404).end(); return; }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(match[1] === "inner" ? renderForm(form) : renderFixture(form)); return;
      }
      if (url.pathname === "/blank") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>Blank local fixture</title><p>No form.</p>"); return; }
      const absolute = resolve(ROOT, "." + decodeURIComponent(url.pathname));
      if (!absolute.startsWith(ROOT + sep) || !/^\/(src\/|test\/fixtures\/)/.test(url.pathname)) { res.writeHead(403).end(); return; }
      const type = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".json": "application/json" }[extname(absolute)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type }); res.end(await readFile(absolute));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
