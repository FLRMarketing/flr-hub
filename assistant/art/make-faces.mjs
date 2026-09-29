// Makes the assistant's six faces (../face/*.webp) from the original drawings, without redrawing him:
//   - every drawing is cropped to the same box: the smallest that holds him in all six poses, so switching moods never
//     moves him or changes his size
//   - he's made fully solid inside his outline (the originals are about 99% opaque, which lets a dark page show through)
//   - scaled down with his edges blended properly (the see-through pixels in the originals are black, which a plain
//     resize smears into a dark rim round him)
//   - saved as WebP with transparency, a few KB each
// The originals are kept out of this public repository. Put them in one folder, named by expression:
//   default.webp (thumbs up)  thinking.webp  celebrating.webp  reassuring.webp  unsure.webp  angry.webp
// then, on a Mac (sips reads the WebP; FFmpeg with libwebp writes it: set FFMPEG if it isn't at the path below):
//   node assistant/art/make-faces.mjs <folder with the originals> [width, default 224]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { readPNG, writePNG } from './png.mjs';

const FACES = ['default', 'thinking', 'celebrating', 'reassuring', 'unsure', 'angry'];
const SRC = process.argv[2], OUT_W = Number(process.argv[3]) || 224;
const FFMPEG = process.env.FFMPEG || join(homedir(), '.hyperframes-tools/node_modules/ffmpeg-static/ffmpeg');
const OUT = new URL('../face/', import.meta.url).pathname;
if (!SRC) { console.error('usage: node make-faces.mjs <folder with the originals> [width]'); process.exit(1); }

const tmp = mkdtempSync(join(tmpdir(), 'flr-faces-'));
try {
  const imgs = FACES.map(name => {
    const png = join(tmp, name + '.png');
    execFileSync('sips', ['-s', 'format', 'png', join(SRC, name + '.webp'), '--out', png], { stdio: 'ignore' });
    const img = readPNG(png);
    // solid inside: stretch alpha so his body (252-253 in the originals) is 255, keeping the soft edge's ramp
    const seen = new Uint32Array(256);
    for (let i = 3; i < img.data.length; i += 4) seen[img.data[i]]++;
    let body = 255;
    for (let a = 129; a < 256; a++) if (seen[a] > seen[body]) body = a;              // the commonest level inside him
    const k = 255 / Math.max(1, body - 1);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = Math.min(255, Math.round(img.data[i] * k));
    return img;
  });
  const { w: W, h: H } = imgs[0];
  if (imgs.some(i => i.w !== W || i.h !== H)) throw new Error('the originals must all be the same size');

  // one box round him in every pose (ignoring near-invisible specks), then the output's shape
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const { data } of imgs) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, OUT_H = Math.round(OUT_W * ch / cw);

  for (const [k, img] of imgs.entries()) {
    const small = resize(img, { x: x0, y: y0, w: cw, h: ch }, OUT_W, OUT_H);
    const png = join(tmp, FACES[k] + '-small.png'), webp = join(OUT, FACES[k] + '.webp');
    writePNG(png, small);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-pix_fmt', 'yuva420p', '-preset', 'picture',
      '-quality', '84', '-compression_level', '6', webp]);
    console.log(`${FACES[k]}.webp  ${OUT_W}×${OUT_H}  ${(statSync(webp).size / 1024).toFixed(1)} KB`);
  }
  console.log(`crop x${x0} y${y0} ${cw}×${ch} of ${W}×${H}; aspect-ratio for the CSS: ${OUT_W}/${OUT_H}`);
} finally { rmSync(tmp, { recursive: true, force: true }); }

// Lanczos-3 on premultiplied colour, one direction at a time: sharp, and no dark fringe from the black see-through pixels.
function resize({ w, data }, box, ow, oh) {
  const px = box.w * box.h, pre = new Float32Array(px * 4);
  for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
    const s = ((box.y + y) * w + box.x + x) * 4, d = (y * box.w + x) * 4, a = data[s + 3] / 255;
    pre[d] = data[s] * a; pre[d + 1] = data[s + 1] * a; pre[d + 2] = data[s + 2] * a; pre[d + 3] = data[s + 3];
  }
  const across = pass(pre, box.w, box.h, ow, true), down = pass(across, ow, box.h, oh, false);
  const out = Buffer.alloc(ow * oh * 4);
  for (let i = 0; i < ow * oh; i++) {
    const a = Math.max(0, Math.min(255, down[i * 4 + 3]));
    out[i * 4 + 3] = Math.round(a);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = a < 0.5 ? 0 : Math.round(Math.max(0, Math.min(255, down[i * 4 + c] * 255 / a)));
  }
  return { w: ow, h: oh, data: out };
}
function pass(src, sw, sh, dn, horizontal) {
  const sn = horizontal ? sw : sh, scale = sn / dn, support = 3 * scale;
  const lanczos = t => { t = Math.abs(t); if (t < 1e-7) return 1; if (t >= 3) return 0; const p = Math.PI * t; return 3 * Math.sin(p) * Math.sin(p / 3) / (p * p); };
  const taps = [];
  for (let i = 0; i < dn; i++) {
    const c = (i + 0.5) * scale, lo = Math.max(0, Math.floor(c - support)), hi = Math.min(sn - 1, Math.ceil(c + support));
    const ws = [];
    let sum = 0;
    for (let j = lo; j <= hi; j++) { const wgt = lanczos((j + 0.5 - c) / scale); ws.push([j, wgt]); sum += wgt; }
    taps.push(ws.map(([j, wgt]) => [j, wgt / sum]));
  }
  const ow = horizontal ? dn : sw, oh = horizontal ? sh : dn, out = new Float32Array(ow * oh * 4);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const o = (y * ow + x) * 4;
    for (const [j, wgt] of taps[horizontal ? x : y]) {
      const s = horizontal ? (y * sw + j) * 4 : (j * sw + x) * 4;
      out[o] += src[s] * wgt; out[o + 1] += src[s + 1] * wgt; out[o + 2] += src[s + 2] * wgt; out[o + 3] += src[s + 3] * wgt;
    }
  }
  return out;
}
