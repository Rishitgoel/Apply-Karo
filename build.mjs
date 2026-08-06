// Apply karo — packaging.
//
//   node build.mjs
//
// Produces dist/apply-karo-<version>.zip, ready to upload to the Chrome Web
// Store. No dependencies: the zip is written here with zlib, so packaging never
// needs an install step and cannot drift with a toolchain.
//
// The file list below is an ALLOWLIST, and that is the whole point of this
// script. A denylist ("everything except test/") is one forgotten entry away
// from shipping a private file, and the failure is silent — the zip uploads
// fine and you find out later. Adding a source file to the extension now means
// adding it here too, which is the intended friction.

import { createHash } from "node:crypto";
import { deflateRawSync, crc32 } from "node:zlib";
import {
  readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync
} from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = import.meta.dirname;
const OUT_DIR = join(ROOT, "dist");

// Individual files, and directories shipped whole (filtered by extension).
const SHIP_FILES = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "options.html",
  "options.js",
  "privacy.html",
  "privacy.js",
  "styles.css",
  "LICENSE"
];
// PRIVACY.md is deliberately absent: privacy.html is the copy users read, and
// the markdown exists to be hosted for the store listing's policy URL.

const SHIP_DIRS = [
  { path: "src", exts: [".js"] },
  { path: "icons", exts: [".png"] },
  { path: "fonts", exts: [".woff2", ".txt"] }
];

// Anything matching these never ships, whatever the lists above say. This is a
// backstop, not the mechanism — a resume dropped into src/ by accident should
// fail the build rather than ride along inside an allowlisted directory.
const FORBIDDEN = [/\.pdf$/i, /(^|[\\/])test[\\/]/i, /(^|[\\/])\.claude[\\/]/i, /\.zip$/i];

// ─────────────────────────────────────────────────────────────────────────────
// Collect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every file under `dir`, split into the ones that ship and the rest.
 *
 * The rest matter: a stray file is filtered out by extension long before the
 * FORBIDDEN check would see it, so a resume left in src/ would be quietly
 * skipped rather than reported. Quietly skipping is safe for the zip but tells
 * you nothing, and "there is a PDF in your source tree" is worth stopping for.
 */
function walk(dir, exts, acc = { ship: [], other: [] }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, acc);
    else if (exts.some((e) => entry.name.endsWith(e))) acc.ship.push(full);
    else acc.other.push(full);
  }
  return acc;
}

const files = [];
const problems = [];

for (const f of SHIP_FILES) {
  const full = join(ROOT, f);
  if (!existsSync(full)) { problems.push(`missing: ${f}`); continue; }
  files.push(full);
}

const rel = (full) => relative(ROOT, full).split(sep).join("/");

for (const { path, exts } of SHIP_DIRS) {
  const full = join(ROOT, path);
  if (!existsSync(full)) { problems.push(`missing directory: ${path}`); continue; }
  const found = walk(full, exts);
  files.push(...found.ship);
  // Checked but not shipped — this is what makes FORBIDDEN more than decoration.
  for (const f of found.other) {
    if (FORBIDDEN.some((re) => re.test(rel(f)))) {
      problems.push(`forbidden file inside a shipped directory: ${rel(f)}`);
    }
  }
}

// Zip paths are always forward-slashed, on every platform.
const entries = files.map((full) => ({ name: rel(full), data: readFileSync(full) }));

for (const e of entries) {
  if (FORBIDDEN.some((re) => re.test(e.name))) problems.push(`forbidden file matched: ${e.name}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify before writing anything
// ─────────────────────────────────────────────────────────────────────────────

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

/** Every path the manifest names must actually be in the zip. */
const referenced = new Set();
const collect = (v) => {
  if (typeof v === "string") { if (/\.(js|html|css|png|woff2)$/.test(v)) referenced.add(v); }
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === "object") Object.values(v).forEach(collect);
};
collect(manifest);

const shipped = new Set(entries.map((e) => e.name));
for (const ref of referenced) {
  // web_accessible_resources use globs; check the directory instead.
  if (ref.includes("*")) {
    const prefix = ref.slice(0, ref.indexOf("*"));
    if (![...shipped].some((s) => s.startsWith(prefix))) problems.push(`manifest glob matches nothing: ${ref}`);
    continue;
  }
  if (!shipped.has(ref)) problems.push(`manifest references a file that is not shipped: ${ref}`);
}

if (!manifest.version) problems.push("manifest has no version");
if (!manifest.commands?.["fill-page"]) problems.push("manifest lost the fill-page command");

if (problems.length) {
  console.error("Build failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Zip
// ─────────────────────────────────────────────────────────────────────────────

// A fixed timestamp keeps the zip byte-identical across runs, so the checksum
// below means "the contents changed", not "you rebuilt it".
const DOS_TIME = 0x6000;          // 12:00:00
const DOS_DATE = 0x5821;          // 2024-01-01

function zip(items) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of items) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    // Storing beats deflating when compression makes the entry bigger, which
    // happens on already-compressed payloads like the PNGs and the woff2.
    const store = deflated.length >= data.length;
    const body = store ? data : deflated;
    const method = store ? 0 : 8;
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cd, end]);
}

entries.sort((a, b) => (a.name < b.name ? -1 : 1));
const buf = zip(entries);

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const outPath = join(OUT_DIR, `apply-karo-${manifest.version}.zip`);
writeFileSync(outPath, buf);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const raw = entries.reduce((n, e) => n + e.data.length, 0);

console.log(`apply-karo-${manifest.version}.zip`);
console.log(`  ${entries.length} files · ${kb(raw)} raw · ${kb(buf.length)} zipped`);
console.log(`  sha256 ${createHash("sha256").update(buf).digest("hex").slice(0, 16)}`);
console.log(`  ${relative(process.cwd(), outPath)}`);
