// Minimal PNG read/write for 8-bit RGBA/RGB (no palette), using Node's zlib.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
export function readPNG(path) {
  const b = readFileSync(path); let p = 8, w, h, ct, bd; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12]) throw new Error('interlaced'); }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 2)) throw new Error(`unsupported bit depth ${bd} / colour type ${ct}`);
  const ch = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = cur[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; out[o] = cur[x * ch]; out[o + 1] = cur[x * ch + 1]; out[o + 2] = cur[x * ch + 2]; out[o + 3] = ch === 4 ? cur[x * ch + 3] : 255; }
    [prev, cur] = [cur, prev];
  }
  return { w, h, data: out };
}
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
export function writePNG(path, { w, h, data }) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
