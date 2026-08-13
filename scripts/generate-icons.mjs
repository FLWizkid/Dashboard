#!/usr/bin/env node
/**
 * Generates the PWA raster icons from the same geometry as `icon.svg`.
 *
 * Written by hand against Node's zlib rather than pulling in an image
 * library: the icon is a rounded square, a ring and a checkmark, and a
 * hundred lines of arithmetic is cheaper than a dependency the app never
 * otherwise needs.
 *
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "icons",
);

const FOREST = [30, 77, 59];
const BRASS = [201, 169, 110];
const CREAM = [250, 249, 247];

/* ── PNG encoding ─────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10-12: compression, filter, interlace — all 0.

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── Geometry ─────────────────────────────────────────────────────────── */

/** Signed distance from a point to a line segment. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance to the boundary of a rounded square, negative inside. */
function roundedSquare(px, py, half, radius) {
  const qx = Math.abs(px) - (half - radius);
  const qy = Math.abs(py) - (half - radius);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

function blend(target, offset, colour, alpha) {
  if (alpha <= 0) return;
  const existing = target[offset + 3] / 255;
  const out = alpha + existing * (1 - alpha);
  for (let i = 0; i < 3; i++) {
    const src = colour[i] / 255;
    const dst = target[offset + i] / 255;
    target[offset + i] = Math.round(
      ((src * alpha + dst * existing * (1 - alpha)) / out) * 255,
    );
  }
  target[offset + 3] = Math.round(out * 255);
}

/**
 * `padding` inflates the safe area for maskable icons, where the platform is
 * free to crop up to 20% off every edge.
 */
function drawIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4, 0);
  const scale = size / 100;
  const inset = maskable ? 0 : 4 * scale;
  const half = size / 2 - inset;
  const radius = maskable ? size / 2 : 22 * scale;
  // Shrink the glyph inside a maskable icon so cropping never bites it.
  const glyphScale = maskable ? 0.72 : 1;
  const aa = 1.0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - size / 2;
      const py = y + 0.5 - size / 2;
      const offset = (y * size + x) * 4;

      // Background plate.
      const plate = roundedSquare(px, py, half, radius);
      blend(pixels, offset, FOREST, Math.min(1, Math.max(0, 0.5 - plate / aa)));

      const gx = px / glyphScale;
      const gy = py / glyphScale;

      // Brass ring.
      const ringRadius = 30 * scale;
      const ringWidth = 3.2 * scale;
      const ring = Math.abs(Math.hypot(gx, gy) - ringRadius) - ringWidth / 2;
      blend(
        pixels,
        offset,
        BRASS,
        Math.min(1, Math.max(0, 0.5 - ring / aa)) * 0.9,
      );

      // Checkmark.
      const strokeWidth = 6 * scale;
      const check = Math.min(
        distanceToSegment(
          gx,
          gy,
          -14 * scale,
          1 * scale,
          -4 * scale,
          11 * scale,
        ),
        distanceToSegment(
          gx,
          gy,
          -4 * scale,
          11 * scale,
          15 * scale,
          -11 * scale,
        ),
      );
      blend(
        pixels,
        offset,
        CREAM,
        Math.min(1, Math.max(0, 0.5 - (check - strokeWidth / 2) / aa)),
      );
    }
  }

  return encodePng(size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-180.png", size: 180 },
  { name: "icon-maskable-512.png", size: 512, maskable: true },
];

for (const target of targets) {
  writeFileSync(
    join(OUT_DIR, target.name),
    drawIcon(target.size, { maskable: target.maskable ?? false }),
  );
  console.log(`wrote ${target.name} (${target.size}×${target.size})`);
}
