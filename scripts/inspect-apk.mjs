#!/usr/bin/env node
/**
 * Inspects an APK without an Android SDK: archive entries, signature markers, ABIs,
 * SHA-256 and manifest metadata decoded from binary XML. Read-only; no network or secrets.
 *
 * Usage: node scripts/inspect-apk.mjs path/to/app.apk
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/inspect-apk.mjs <apk>");
  process.exit(2);
}
const apk = readFileSync(path);

function findEocd(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("ZIP end-of-central-directory not found");
}

const eocd = findEocd(apk);
const entryCount = apk.readUInt16LE(eocd + 10);
let pos = apk.readUInt32LE(eocd + 16);
const entries = [];
for (let i = 0; i < entryCount; i++) {
  if (apk.readUInt32LE(pos) !== 0x02014b50) throw new Error("bad central directory entry");
  const method = apk.readUInt16LE(pos + 10);
  const compressedSize = apk.readUInt32LE(pos + 20);
  const uncompressedSize = apk.readUInt32LE(pos + 24);
  const nameLen = apk.readUInt16LE(pos + 28);
  const extraLen = apk.readUInt16LE(pos + 30);
  const commentLen = apk.readUInt16LE(pos + 32);
  const localOffset = apk.readUInt32LE(pos + 42);
  const name = apk.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
  entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
  pos += 46 + nameLen + extraLen + commentLen;
}

function readEntry(name) {
  const e = entries.find((x) => x.name === name);
  if (!e) throw new Error(`${name} not found in APK`);
  if (apk.readUInt32LE(e.localOffset) !== 0x04034b50) throw new Error("bad local file header");
  const nameLen = apk.readUInt16LE(e.localOffset + 26);
  const extraLen = apk.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = apk.subarray(start, start + e.compressedSize);
  return e.method === 8 ? inflateRawSync(raw) : raw;
}

function readLength8(buf, offset) {
  let v = buf[offset++];
  if (v & 0x80) v = ((v & 0x7f) << 8) | buf[offset++];
  return [v, offset];
}

function decodeStringPool(buf) {
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const type = buf.readUInt16LE(pos);
    const headerSize = buf.readUInt16LE(pos + 2);
    const size = buf.readUInt32LE(pos + 4);
    if (size < headerSize || pos + size > buf.length) throw new Error("bad XML chunk size");
    if (type === 0x0001) {
      const count = buf.readUInt32LE(pos + 8);
      const flags = buf.readUInt32LE(pos + 16);
      const stringsStart = buf.readUInt32LE(pos + 20);
      const utf8 = (flags & 0x100) !== 0;
      const offsets = [];
      for (let i = 0; i < count; i++) offsets.push(buf.readUInt32LE(pos + headerSize + i * 4));
      const base = pos + stringsStart;
      return offsets.map((off) => {
        let p = base + off;
        if (utf8) {
          [, p] = readLength8(buf, p);
          const [byteLen, start] = readLength8(buf, p);
          return buf.subarray(start, start + byteLen).toString("utf8");
        }
        let len = buf.readUInt16LE(p);
        p += 2;
        if (len & 0x8000) {
          len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p);
          p += 2;
        }
        return buf.subarray(p, p + len * 2).toString("utf16le");
      });
    }
    pos += size;
  }
  throw new Error("binary XML string pool not found");
}

function parseManifestAttributes(buf, strings) {
  let pos = 8;
  const elements = [];
  while (pos + 8 <= buf.length) {
    const type = buf.readUInt16LE(pos);
    const headerSize = buf.readUInt16LE(pos + 2);
    const size = buf.readUInt32LE(pos + 4);
    if (type === 0x0102) {
      const nameIndex = buf.readUInt32LE(pos + 20);
      const attributeStart = buf.readUInt16LE(pos + 24);
      const attributeSize = buf.readUInt16LE(pos + 26);
      const attributeCount = buf.readUInt16LE(pos + 28);
      const attrs = {};
      const base = pos + headerSize + attributeStart;
      for (let i = 0; i < attributeCount; i++) {
        const a = base + i * attributeSize;
        const name = strings[buf.readUInt32LE(a + 4)] || "";
        const rawIndex = buf.readUInt32LE(a + 8);
        const dataType = buf[a + 15];
        const data = buf.readUInt32LE(a + 16);
        let value = null;
        if (rawIndex !== 0xffffffff && strings[rawIndex] !== undefined) value = strings[rawIndex];
        else if (dataType === 0x10) value = data;
        else if (dataType === 0x12) value = data !== 0;
        if (name) attrs[name] = value;
      }
      elements.push({ tag: strings[nameIndex] || "", attrs });
    }
    if (size < headerSize || pos + size > buf.length) break;
    pos += size;
  }
  return elements;
}

const manifestXml = readEntry("AndroidManifest.xml");
const strings = decodeStringPool(manifestXml);
const elements = parseManifestAttributes(manifestXml, strings);
const manifest = elements.find((e) => e.tag === "manifest")?.attrs || {};
const usesSdk = elements.find((e) => e.tag === "uses-sdk")?.attrs || {};
const abis = [...new Set(entries.map((e) => e.name.match(/^lib\/([^/]+)\//)?.[1]).filter(Boolean))].sort();
const signatureFiles = entries
  .map((e) => e.name)
  .filter((n) => /^META-INF\/.*\.(RSA|DSA|EC|SF)$/.test(n))
  .sort();

const result = {
  file: path,
  sizeBytes: apk.length,
  sha256: createHash("sha256").update(apk).digest("hex"),
  zipEntries: entries.length,
  archiveIntegrity: "central directory parsed; all entries indexed",
  packageName: manifest.package || null,
  versionCode: manifest.versionCode ?? null,
  versionName: manifest.versionName ?? null,
  minSdkVersion: usesSdk.minSdkVersion ?? null,
  targetSdkVersion: usesSdk.targetSdkVersion ?? null,
  abis,
  signatureFiles,
  signatureMarkersPresent: signatureFiles.length > 0,
  releaseSigned: false,
  note: "Signature markers only; this tool does not run apksigner and does not verify cryptographic validity.",
};
console.log(JSON.stringify(result, null, 2));
