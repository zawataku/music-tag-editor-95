'use strict';

/* ------------------------------------------------------------------
   Rasterizes the music-note glyph from renderer/index.html's title
   bar into build/icon.ico (and build/icon.png for the non-Windows
   targets). No image libraries involved: the glyph is only rects on
   a 16x16 grid, so it is cheaper to plot it directly than to pull in
   an SVG renderer. Adapted from exif-viewer-95's script.

   Run with: npm run icon
   ------------------------------------------------------------------ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'build');

/* Sizes stored in the .ico. 256 is required by electron-builder. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ------------------------------------------------------------------
   The glyph, in the same 16x16 user space as the inline SVG: the
   path "M6 3h8v2H7v8H6zM13 5h1v6h-1zM2 11h5v3H2zM9 9h5v3H9z" split
   into rects, drawn once in black shifted by (1, 1) as a shadow and
   once in yellow on top. Painted back to front.
   ------------------------------------------------------------------ */
/* The glyph sits low in its 16x16 box (rows 3-14, shadow included),
   which reads as off-centre once it is alone on the taskbar. Nudging
   it up one unit balances the padding. Set to 0 to match the SVG
   pixel for pixel. */
const TRANSLATE_Y = -1;

const NOTE = [
  { x: 6, y: 3, w: 8, h: 2 },     // beam
  { x: 6, y: 5, w: 1, h: 8 },     // left stem
  { x: 13, y: 5, w: 1, h: 6 },    // right stem
  { x: 2, y: 11, w: 5, h: 3 },    // left head
  { x: 9, y: 9, w: 5, h: 3 }      // right head
];

const SHAPES = [
  ...NOTE.map((r) => ({ ...r, x: r.x + 1, y: r.y + 1, fill: '#000000' })),
  ...NOTE.map((r) => ({ ...r, fill: '#ffff00' }))
];

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hitRect(s, x, y) {
  return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h ? s.fill : null;
}

/* Returns an RGBA buffer, size*size*4, transparent where nothing paints. */
function raster(size) {
  const scale = size / 16;
  const buf = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / scale;
      const y = (py + 0.5) / scale - TRANSLATE_Y;

      let hex = null;
      for (const s of SHAPES) {
        const c = hitRect(s, x, y);
        if (c) hex = c;
      }
      if (!hex) continue;

      const [r, g, b] = rgb(hex);
      const o = (py * size + px) * 4;
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
    }
  }
  return buf;
}

/* ---------------------------- PNG ---------------------------- */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return c ^ -1;
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;    // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------------------- ICO ---------------------------- */

/* A 32bpp BITMAPINFOHEADER image: bottom-up BGRA, plus the legacy AND
   mask that Windows still expects even when alpha is present. */
function encodeBmpEntry(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);   // XOR + AND stacked
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }

  const maskStride = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskStride * size);   // all zero = fully opaque
  return Buffer.concat([header, xor, and]);
}

function encodeIco(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += img.data.length;
  }

  return Buffer.concat([dir, ...entries, ...images.map(i => i.data)]);
}

/* ---------------------------- main ---------------------------- */

fs.mkdirSync(OUT_DIR, { recursive: true });

const images = ICO_SIZES.map(size => {
  const rgba = raster(size);
  // 256px is stored PNG-compressed, per the Vista+ convention.
  return { size, data: size >= 256 ? encodePng(rgba, size) : encodeBmpEntry(rgba, size) };
});

fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeIco(images));
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), encodePng(raster(256), 256));

console.log('build/icon.ico  ' + ICO_SIZES.join(', ') + ' px');
console.log('build/icon.png  256 px');

/* A quick sanity view of the 16px grid, so a bad edge rule is
   obvious without opening the file. */
if (process.argv.includes('--preview')) {
  const rgba = raster(16);
  const seen = new Map();
  let out = '';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const o = (y * 16 + x) * 4;
      if (!rgba[o + 3]) { out += '.'; continue; }
      const key = `${rgba[o]},${rgba[o + 1]},${rgba[o + 2]}`;
      if (!seen.has(key)) seen.set(key, '#*+o=~'[seen.size] || '?');
      out += seen.get(key);
    }
    out += '\n';
  }
  console.log('\n' + out);
  for (const [k, v] of seen) console.log(`  ${v}  rgb(${k})`);
}
