import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function renderIcon(size, options = {}) {
  const { rounded = true, background = true, checkScale = 1, checkOnly = false, padding = 0 } = options;
  const ss = size <= 64 ? 4 : size <= 256 ? 3 : 2;
  const pixels = Buffer.alloc(size * size * 4);
  const radius = rounded ? size * 0.23 : 0;
  const cx = size / 2;
  const cy = size / 2;
  const stroke = size * 0.085 * checkScale;
  const inset = padding * size;
  const scale = (1 - padding * 2) * checkScale;

  function insideRounded(x, y) {
    if (radius === 0) return true;
    const left = radius;
    const top = radius;
    const right = size - radius;
    const bottom = size - radius;
    if (x >= left && x <= right) return y >= 0 && y <= size;
    if (y >= top && y <= bottom) return x >= 0 && x <= size;
    const cornerX = x < left ? left : right;
    const cornerY = y < top ? top : bottom;
    return Math.hypot(x - cornerX, y - cornerY) <= radius;
  }

  function inCheck(x, y) {
    const ox = cx - (size * scale) / 2 + inset;
    const oy = cy - (size * scale) / 2 + inset;
    const s = size * scale;
    const ax = ox + s * 0.24;
    const ay = oy + s * 0.53;
    const bx = ox + s * 0.43;
    const by = oy + s * 0.71;
    const dx = ox + s * 0.77;
    const dy = oy + s * 0.33;
    return (
      distanceToSegment(x, y, ax, ay, bx, by) <= stroke / 2 ||
      distanceToSegment(x, y, bx, by, dx, dy) <= stroke / 2
    );
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          if (background && !insideRounded(px, py)) continue;
          const check = inCheck(px, py);
          if (checkOnly) {
            if (check) {
              r += 255;
              g += 255;
              b += 255;
              a += 255;
            }
            continue;
          }
          const t = Math.max(0, Math.min(1, (px + py) / (2 * size)));
          let cr = mix(0x6d, 0x47, t);
          let cg = mix(0x6a, 0x40, t);
          let cb = mix(0xf7, 0xc9, t);
          let ca = 255;
          if (check) {
            cr = 255;
            cg = 255;
            cb = 255;
          }
          r += cr;
          g += cg;
          b += cb;
          a += ca;
        }
      }
      const total = ss * ss;
      const offset = (y * size + x) * 4;
      if (checkOnly) {
        const alpha = Math.round((a / total) * 1);
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = alpha;
      } else {
        pixels[offset] = Math.round(r / total);
        pixels[offset + 1] = Math.round(g / total);
        pixels[offset + 2] = Math.round(b / total);
        pixels[offset + 3] = Math.round(a / total);
      }
    }
  }
  return encodePng(size, size, pixels);
}

const root = path.resolve(import.meta.dirname, '..');

function write(file, size, options) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, renderIcon(size, options));
  console.log(`  ${file} (${size}px)`);
}

console.log('生成图标…');
write('web/public/icons/icon-192.png', 192);
write('web/public/icons/icon-512.png', 512);
write('web/public/icons/icon-maskable-512.png', 512, { rounded: false, checkScale: 0.82 });
write('desktop/assets/icon.png', 256);
write('desktop/assets/tray.png', 32, { rounded: true });
write('android/app/src/main/res/drawable-nodpi/ic_launcher.png', 192);
write('android/app/src/main/res/drawable-nodpi/ic_notify.png', 48, {
  rounded: false,
  background: false,
  checkOnly: true,
  checkScale: 1.15,
});
console.log('完成。');
