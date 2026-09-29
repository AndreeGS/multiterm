/**
 * Gera o icone do app (PNG) sem depender de ferramentas externas.
 * Desenha em 2x e reduz pela media, o que da antialiasing nas bordas redondas.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

const SCALE = 2;

const COLORS = {
  bg: [0x15, 0x18, 0x22],
  pane: [0x0f, 0x11, 0x16],
  header: [0x1b, 0x1f, 0x2b],
  running: [0x3f, 0xb9, 0x50],
  idle: [0xd2, 0x99, 0x22],
  exited: [0x6e, 0x76, 0x81],
};

function canvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function fillRoundRect(img, x, y, w, h, r, [cr, cg, cb]) {
  for (let py = Math.max(0, y | 0); py < Math.min(img.size, y + h); py += 1) {
    for (let px = Math.max(0, x | 0); px < Math.min(img.size, x + w); px += 1) {
      if (!insideRoundRect(px + 0.5, py + 0.5, x, y, w, h, r)) continue;
      const i = (py * img.size + px) * 4;
      img.data[i] = cr;
      img.data[i + 1] = cg;
      img.data[i + 2] = cb;
      img.data[i + 3] = 255;
    }
  }
}

function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function fillCircle(img, cx, cy, radius, [cr, cg, cb]) {
  for (let py = Math.max(0, (cy - radius) | 0); py < Math.min(img.size, cy + radius + 1); py += 1) {
    for (let px = Math.max(0, (cx - radius) | 0); px < Math.min(img.size, cx + radius + 1); px += 1) {
      if ((px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 > radius * radius) continue;
      const i = (py * img.size + px) * 4;
      img.data[i] = cr;
      img.data[i + 1] = cg;
      img.data[i + 2] = cb;
      img.data[i + 3] = 255;
    }
  }
}

/** Reduz por media de blocos SCALE x SCALE. */
function downsample(img, factor) {
  const size = img.size / factor;
  const out = canvas(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const i = ((y * factor + sy) * img.size + (x * factor + sx)) * 4;
          for (let c = 0; c < 4; c += 1) acc[c] += img.data[i + c];
        }
      }
      const i = (y * size + x) * 4;
      const n = factor * factor;
      for (let c = 0; c < 4; c += 1) out.data[i + c] = Math.round(acc[c] / n);
    }
  }
  return out;
}

function encodePng(img) {
  const stride = img.size * 4;
  // Cada linha do PNG e prefixada pelo byte de filtro (0 = nenhum).
  const raw = Buffer.alloc((stride + 1) * img.size);
  for (let y = 0; y < img.size; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(img.data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])) >>> 0, body.length + 8);
    return out;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.size, 0);
  ihdr.writeUInt32BE(img.size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function buildIcon(size) {
  const s = size * SCALE;
  const img = canvas(s);
  const u = s / 512; // unidade de desenho, relativa ao design de 512px

  fillRoundRect(img, 0, 0, s, s, 108 * u, COLORS.bg);

  const pad = 62 * u;
  const gap = 22 * u;
  const cell = (s - pad * 2 - gap) / 2;
  const dots = [COLORS.running, COLORS.idle, COLORS.idle, COLORS.exited];

  for (let i = 0; i < 4; i += 1) {
    const x = pad + (i % 2) * (cell + gap);
    const y = pad + Math.floor(i / 2) * (cell + gap);
    const radius = 14 * u;
    fillRoundRect(img, x, y, cell, cell, radius, COLORS.pane);
    fillRoundRect(img, x, y, cell, 34 * u, radius, COLORS.header);
    fillRoundRect(img, x, y + 20 * u, cell, 14 * u, 0, COLORS.header);
    fillCircle(img, x + 20 * u, y + 17 * u, 7 * u, dots[i]);
  }

  return encodePng(downsample(img, SCALE));
}

if (process.argv[2]) {
  const size = Number(process.argv[3] ?? 256);
  writeFileSync(process.argv[2], buildIcon(size));
  console.log(`icone ${size}x${size} -> ${process.argv[2]}`);
}
