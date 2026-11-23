/**
 * Vygeneruje ikony icons/icon{16,32,48,128}.png bez dalších závislostí
 * (vlastní PNG enkodér přes zlib). Styl HeMi: dlaždice s přechodem, bílá obrazovka s fialovým
 * trojúhelníkem a lišta režimu kina. Spuštění: npm run icons
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { join } from 'node:path';

const OUT_DIR = join(import.meta.dirname, '..', 'icons');
const SIZES = [16, 32, 48, 128, 256];
const SAMPLES = 4; // vyhlazení hran: 4×4 vzorků na pixel

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bitová hloubka
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtr None
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const MARGIN = 8 / 256;
const RADIUS = 52 / 256;
const WHITE = [255, 255, 255];
const PURPLE = [0x6e, 0x6a, 0xff];

/** Inside a rounded rectangle (coordinates 0..1). */
function inRound(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Inside the play triangle pointing right. */
function inPlay(x, y, left, top, bottom, tip) {
  if (x < left || x > tip) return false;
  const half = ((tip - x) / (tip - left)) * ((bottom - top) / 2);
  const mid = (top + bottom) / 2;
  return y >= mid - half && y <= mid + half;
}

/**
 * The colour of a point (0..1), or null (transparent). The HeMi style shared by all HeMi apps: a rounded tile in the
 * gradient #5CA4FF -> #8B4CFF, a white glyph and details in purple #6E6AFF. HeMiTube: a white screen with a purple play
 * triangle (a video) and the wide bar of the theatre mode under it.
 */
function shade(x, y) {
  if (!inRound(x, y, MARGIN, MARGIN, 1 - MARGIN, 1 - MARGIN, RADIUS)) return null;
  if (inRound(x, y, 0.2, 0.22, 0.8, 0.62, 0.085)) return inPlay(x, y, 0.445, 0.33, 0.51, 0.6) ? PURPLE : WHITE;
  if (inRound(x, y, 0.2, 0.71, 0.8, 0.78, 0.035)) return WHITE;
  const t = (x + y) / 2;
  return [0x5c + (0x8b - 0x5c) * t, 0xa4 + (0x4c - 0xa4) * t, 0xff];
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = shade((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return encodePng(size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(OUT_DIR, `icon${size}.png`), render(size));
  console.log(`icons/icon${size}.png`);
}
