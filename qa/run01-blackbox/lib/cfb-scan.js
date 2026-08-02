// Locate which OLE2 (CFB) streams inside a vbaProject.bin hold a given string.
//
// PROD-06: the generated book carries a NEW compressed module source with the
// new path, but an OLD copy of the path survives somewhere and Excel shows the
// old one. Guessing which stream would be exactly the mistake Luca warned
// about, so this walks the container and reports per-stream hits.
//
//   node cfb-scan.js <vbaProject.bin> <needle> [...needles]

'use strict';
const fs = require('fs');

const file = process.argv[2];
const needles = process.argv.slice(3);
const buf = fs.readFileSync(file);

if (buf.readUInt32LE(0) !== 0xE011CFD0 || buf.readUInt32LE(4) !== 0xE11AB1A1) {
  console.error('not a CFB file');
  process.exit(2);
}

const sectorShift = buf.readUInt16LE(0x1E);
const miniShift = buf.readUInt16LE(0x20);
const SEC = 1 << sectorShift;
const MINI = 1 << miniShift;
const dirStart = buf.readInt32LE(0x30);
const miniFatStart = buf.readInt32LE(0x3C);
const difatStart = buf.readInt32LE(0x44);
const difatCount = buf.readUInt32LE(0x48);

const off = (s) => (s + 1) * SEC;

// ---- FAT ----
const fatSectors = [];
for (let i = 0; i < 109; i++) {
  const v = buf.readInt32LE(0x4C + i * 4);
  if (v >= 0) fatSectors.push(v);
}
let ds = difatStart;
for (let n = 0; n < difatCount && ds >= 0; n++) {
  const base = off(ds);
  for (let i = 0; i < SEC / 4 - 1; i++) {
    const v = buf.readInt32LE(base + i * 4);
    if (v >= 0) fatSectors.push(v);
  }
  ds = buf.readInt32LE(base + SEC - 4);
}
const FAT = [];
for (const fs_ of fatSectors) {
  const base = off(fs_);
  for (let i = 0; i < SEC / 4; i++) FAT.push(buf.readInt32LE(base + i * 4));
}

function chain(start) {
  const out = [];
  let s = start;
  const seen = new Set();
  while (s >= 0 && s < FAT.length && !seen.has(s)) { seen.add(s); out.push(s); s = FAT[s]; }
  return out;
}

function readChain(start, size) {
  const parts = chain(start).map((s) => buf.slice(off(s), off(s) + SEC));
  return Buffer.concat(parts).slice(0, size);
}

// ---- directory ----
const dirBuf = readChain(dirStart, chain(dirStart).length * SEC);
const entries = [];
for (let i = 0; i * 128 < dirBuf.length; i++) {
  const b = dirBuf.slice(i * 128, i * 128 + 128);
  const nameLen = b.readUInt16LE(0x40);
  if (nameLen === 0) continue;
  const name = b.slice(0, Math.max(0, nameLen - 2)).toString('utf16le');
  entries.push({
    name,
    type: b.readUInt8(0x42),           // 1=storage 2=stream 5=root
    start: b.readInt32LE(0x74),
    size: Number(b.readBigUInt64LE(0x78))
  });
}

// ---- mini stream ----
const root = entries.find((e) => e.type === 5);
const miniStream = root ? readChain(root.start, root.size) : Buffer.alloc(0);
const miniFatSectors = chain(miniFatStart);
const MINIFAT = [];
for (const s of miniFatSectors) {
  const base = off(s);
  for (let i = 0; i < SEC / 4; i++) MINIFAT.push(buf.readInt32LE(base + i * 4));
}
function readMini(start, size) {
  const parts = [];
  let s = start;
  const seen = new Set();
  while (s >= 0 && s < MINIFAT.length && !seen.has(s)) {
    seen.add(s);
    parts.push(miniStream.slice(s * MINI, s * MINI + MINI));
    s = MINIFAT[s];
  }
  return Buffer.concat(parts).slice(0, size);
}

function streamData(e) {
  if (e.size < 4096 && root && e.start >= 0) return readMini(e.start, e.size);
  return readChain(e.start, e.size);
}

console.log(`file=${file}  sector=${SEC} mini=${MINI}`);
console.log('--- streams ---');
for (const e of entries) {
  if (e.type !== 2) continue;
  let data;
  try { data = streamData(e); } catch (err) { console.log(`  ${e.name} <read failed>`); continue; }
  const ascii = data.toString('latin1');
  const hits = needles
    .map((n) => ({ n, c: ascii.split(n).length - 1 }))
    .filter((h) => h.c > 0);
  const mark = hits.length ? '  <== ' + hits.map((h) => `"${h.n}" x${h.c}`).join(', ') : '';
  console.log(`  ${e.name.padEnd(22)} size=${String(e.size).padStart(7)}${mark}`);
}
