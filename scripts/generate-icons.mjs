/**
 * Generates the Tauri icon set (PNG + ICO) with zero dependencies.
 * Run: node scripts/generate-icons.mjs
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps', 'desktop', 'src-tauri', 'icons');
mkdirSync(outDir, { recursive: true });

const SIZE = 128;
// Tahlely mark: deep background + accent "T" + underline bar.
const BG = [15, 17, 21, 255];
const ACCENT = [76, 141, 255, 255];

function inT(x, y) {
  const barH = y >= 28 && y < 44 && x >= 30 && x < 98;
  const stem = x >= 58 && x < 70 && y >= 44 && y < 96;
  const under = y >= 100 && y < 106 && x >= 44 && x < 84;
  return barH || stem || under;
}

const raw = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const [r, g, b, a] = inT(x, y) ? ACCENT : BG;
    const i = (y * SIZE + x) * 4;
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
    raw[i + 3] = a;
  }
}

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

const scanlines = [];
for (let y = 0; y < SIZE; y += 1) {
  scanlines.push(Buffer.from([0]));
  scanlines.push(raw.subarray(y * SIZE * 4, (y + 1) * SIZE * 4));
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk(
    'IHDR',
    (() => {
      const h = Buffer.alloc(13);
      h.writeUInt32BE(SIZE, 0);
      h.writeUInt32BE(SIZE, 4);
      h[8] = 8; // bit depth
      h[9] = 6; // RGBA
      return h;
    })(),
  ),
  chunk('IDAT', deflateSync(Buffer.concat(scanlines))),
  chunk('IEND', Buffer.alloc(0)),
]);

// Sanity: PNG must round-trip through inflate.
const check = (() => {
  let offset = 8;
  const parts = [];
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(png.subarray(offset + 8, offset + 8 + len));
    offset += 12 + len;
  }
  return inflateSync(Buffer.concat(parts));
})();
if (!check.equals(Buffer.concat(scanlines))) throw new Error('PNG round-trip failed');

writeFileSync(join(outDir, '128x128.png'), png);

// ICO with a single PNG-compressed entry (supported on Vista+).
const ico = Buffer.alloc(6 + 16 + png.length);
ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // count
ico[6] = SIZE === 256 ? 0 : SIZE;
ico[7] = SIZE === 256 ? 0 : SIZE;
ico[8] = 0; // palette
ico[9] = 0; // reserved
ico.writeUInt16LE(1, 10); // planes
ico.writeUInt16LE(32, 12); // bit count
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(6 + 16, 18); // data offset
png.copy(ico, 6 + 16);
writeFileSync(join(outDir, 'icon.ico'), ico);

console.log(`icons written to ${outDir}`);
