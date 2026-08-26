#!/usr/bin/env node
/*
 * Иконки приложения. Запуск из корня репозитория:
 *
 *     node tools/make-icons.js
 *
 * Зависимостей нет и не будет: PNG собирается вручную через встроенный zlib.
 * Рисунок — глагольная рамка (tangconstructie): скоба, стягивающая
 * предложение от личной формы глагола до того, что стоит в конце. Это
 * главная идея нидерландского синтаксиса и весь смысл курса. Рисуется
 * формулой, поэтому любой размер выходит чётким и репозиторий не тащит
 * бинарных исходников.
 *
 * Файлы перезаписываются целиком. Менять цвет — константы ниже.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(path.resolve(__dirname, '..'), 'assets', 'icons');

const BG = [0x0e, 0x4a, 0x5e];   // --start-deep, цвет блока 0
const FG = [0xff, 0xff, 0xff];

/* ---------- PNG ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// rgba: Uint8Array размером size*size*4
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // бит на канал
  ihdr[9] = 6;    // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;   // фильтр «none»
    rgba.copy
      ? rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
      : Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- рисование ---------- */

// Сглаживание: доля пикселя внутри фигуры считается по расстоянию до её
// границы. Полпикселя в обе стороны — этого хватает, чтобы край не рябил.
function cover(dist) {
  return Math.max(0, Math.min(1, 0.5 - dist));
}

// Точки скобы: вертикаль вниз — перекладина — вертикаль вниз, со скруглёнными
// углами. Слева — личная форма глагола, справа — то, что уехало в конец.
function tildePoints(size, pad) {
  const pts = [];
  const x0 = pad;
  const x1 = size - pad;
  const top = size * 0.34;
  const bot = size * 0.68;
  const r = Math.min((x1 - x0) * 0.22, (bot - top) * 0.9);

  const push = (x, y) => pts.push([x, y]);
  const N = 90;

  for (let i = 0; i <= N; i++) push(x0, bot - (bot - top - r) * (i / N));
  for (let i = 0; i <= N; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / N);
    push(x0 + r + r * Math.cos(a), top + r + r * Math.sin(a));
  }
  for (let i = 0; i <= N * 2; i++) push(x0 + r + (x1 - x0 - 2 * r) * (i / (N * 2)), top);
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / N);
    push(x1 - r + r * Math.cos(a), top + r + r * Math.sin(a));
  }
  for (let i = 0; i <= N; i++) push(x1, top + r + (bot - top - r) * (i / N));
  return pts;
}

function render(size, { radius, glyphPad, stroke }) {
  const buf = Buffer.alloc(size * size * 4);
  const pts = tildePoints(size, glyphPad);
  const half = stroke / 2;

  // Ограничивающая рамка тильды — считать расстояние по всему полотну незачем.
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  minY = Math.floor(minY - half - 2); maxY = Math.ceil(maxY + half + 2);
  const minX = Math.floor(pts[0][0] - half - 2);
  const maxX = Math.ceil(pts[pts.length - 1][0] + half + 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5, py = y + 0.5;

      // Фон: квадрат со скруглением (у maskable radius = 0, полное покрытие).
      const dx = Math.abs(px - size / 2) - (size / 2 - radius);
      const dy = Math.abs(py - size / 2) - (size / 2 - radius);
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - radius;
      const bgA = cover(outside);

      let fgA = 0;
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
        let best = Infinity;
        for (let k = 0; k < pts.length; k++) {
          const d = (px - pts[k][0]) ** 2 + (py - pts[k][1]) ** 2;
          if (d < best) best = d;
        }
        fgA = cover(Math.sqrt(best) - half);
      }

      const a = Math.max(bgA, 0);
      const mix = Math.min(fgA, a);
      buf[i]     = Math.round(BG[0] * (1 - mix) + FG[0] * mix);
      buf[i + 1] = Math.round(BG[1] * (1 - mix) + FG[1] * mix);
      buf[i + 2] = Math.round(BG[2] * (1 - mix) + FG[2] * mix);
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, buf);
}

/* ---------- файлы ---------- */

// maskable обрезается системой по кругу или скруглённому квадрату, поэтому
// у него фон во весь квадрат, а рисунок ужат в безопасную зону (80%).
const FILES = [
  ['icon-192.png',          192, { radius: 42,  glyphPad: 38,  stroke: 21 }],
  ['icon-512.png',          512, { radius: 112, glyphPad: 102, stroke: 56 }],
  ['icon-192-maskable.png', 192, { radius: 0,   glyphPad: 55,  stroke: 19 }],
  ['icon-512-maskable.png', 512, { radius: 0,   glyphPad: 148, stroke: 50 }],
  ['apple-touch-icon.png',  180, { radius: 0,   glyphPad: 36,  stroke: 20 }],
  ['favicon-32.png',        32,  { radius: 6,   glyphPad: 4,   stroke: 5  }],
  ['favicon-16.png',        16,  { radius: 3,   glyphPad: 2,   stroke: 3  }],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size, opts] of FILES) {
  fs.writeFileSync(path.join(OUT, name), render(size, opts));
  console.log('  ' + name + '  ' + size + '×' + size);
}
console.log('Готово: ' + FILES.length + ' файлов в assets/icons/');
