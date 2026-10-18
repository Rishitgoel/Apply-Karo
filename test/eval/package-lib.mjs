import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { resolve, dirname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync, crc32 } from "node:zlib";
import { createHash } from "node:crypto";
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export async function extractVerifiedPackage(root) {
  const manifest = JSON.parse(await readFile(join(root,"manifest.json"))), archive = join(root,"dist",`apply-karo-${manifest.version}.zip`), zip = await readFile(archive);
  const directory = await mkdtemp(join(tmpdir(),"apply-karo-package-")), entries = [], seen = new Set(); let offset = 0, total = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const flags = zip.readUInt16LE(offset+6), method = zip.readUInt16LE(offset+8), checksum = zip.readUInt32LE(offset+14), size = zip.readUInt32LE(offset+18), rawSize = zip.readUInt32LE(offset+22), nameLength = zip.readUInt16LE(offset+26), extraLength = zip.readUInt16LE(offset+28);
    const name = zip.subarray(offset+30,offset+30+nameLength).toString(), start = offset+30+nameLength+extraLength;
    if (flags & 9 || ![0,8].includes(method) || rawSize > 10000000 || start+size > zip.length || !name || name.includes("\\") || name.startsWith("/") || name.includes(":") || name.split("/").includes("..") || seen.has(name)) throw new Error("Unsafe or unsupported ZIP entry");
    const target = resolve(directory,name); if (!target.startsWith(directory+sep)) throw new Error("ZIP path escapes package directory");
    const bytes = method === 8 ? inflateRawSync(zip.subarray(start,start+size),{ maxOutputLength:10000000 }) : zip.subarray(start,start+size);
    if (bytes.length !== rawSize || crc32(bytes) !== checksum || !bytes.equals(await readFile(resolve(root,name)))) throw new Error("Package integrity/source mismatch: "+name);
    total += bytes.length; if (total > 20000000) throw new Error("Package exceeds the test extraction bound");
    await mkdir(dirname(target),{recursive:true}); await writeFile(target,bytes); seen.add(name); entries.push(name); offset=start+size;
  }
  if (!entries.includes("manifest.json") || !entries.includes("src/engine/bundle.js") || zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Incomplete ZIP archive");
  return { directory, entries, zipSHA256:hash(zip), bundleHash:hash(await readFile(join(directory,"src/engine/bundle.js"))), archive, everyPackagedFileMatchesSource:true };
}
