// Derives the assistant's robot layers from the artwork, without redrawing him:
//   robot.png            the artwork, cropped to the robot
//   robot-base.png       the same with the eyes (and their soft shadows) painted out: the blue screen rebuilt from the
//                        clean blue around each eye
//   robot-eye-left.png   each eye with its shadow, fading to nothing at its edge, so that in place it matches the
//   robot-eye-right.png  artwork and moved or squashed (a blink, a glance) it still sits naturally on the screen
// Run on a Mac from this folder (sips does the WebP decode and the final resize):
//   sips -s format png robot-source.webp --out /tmp/robot-source.png && node make-layers.mjs /tmp/robot-source.png
// If the artwork changes, check the eye boxes and the crop below, then the positions in ../robot.css.
import { execFileSync } from 'node:child_process';
import { readPNG, writePNG } from './png.mjs';
const src = readPNG(process.argv[2]); const { w, data: S } = src; const at = (x, y) => (y * w + x) * 4;
const EYES = [{ name: 'robot-eye-left', x0: 464, x1: 539, y0: 653, y1: 769 }, { name: 'robot-eye-right', x0: 712, x1: 787, y0: 653, y1: 769 }];
const M = 26, CROP = { x: 177, y: 181, w: 895, h: 831 }, OUT_W = 240, TMP = '/tmp/flr-robot-';
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const base = Buffer.from(S);
for (const e of EYES) {
  const X0 = e.x0 - M, X1 = e.x1 + M, Y0 = e.y0 - M, Y1 = e.y1 + M, sw = X1 - X0 + 1, sh = Y1 - Y0 + 1, sp = Buffer.alloc(sw * sh * 4);
  const fill = (x, y, c) => {   // a Coons patch from the box's edges
    const tx = (x - X0) / (X1 - X0), ty = (y - Y0) / (Y1 - Y0);
    const hz = S[at(X0, y) + c] * (1 - tx) + S[at(X1, y) + c] * tx, vt = S[at(x, Y0) + c] * (1 - ty) + S[at(x, Y1) + c] * ty;
    const k = S[at(X0, Y0) + c] * (1 - tx) * (1 - ty) + S[at(X1, Y0) + c] * tx * (1 - ty) + S[at(X0, Y1) + c] * (1 - tx) * ty + S[at(X1, Y1) + c] * tx * ty;
    return hz + vt - k;
  };
  const F = Math.round(M * 0.55), cx = (e.x0 + e.x1) / 2, cy = (e.y0 + e.y1) / 2, hw = (e.x1 - e.x0) / 2, hh = (e.y1 - e.y0) / 2;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    const o = at(x, y), q = ((y - Y0) * sw + (x - X0)) * 4;
    for (let c = 0; c < 3; c++) base[o + c] = Math.max(0, Math.min(255, Math.round(fill(x, y, c))));
    const out = Math.max(0, Math.hypot(Math.abs(x - cx), Math.max(0, Math.abs(y - cy) - (hh - hw))) - hw);   // beyond the pill's outline
    for (let c = 0; c < 3; c++) sp[q + c] = S[o + c];
    sp[q + 3] = Math.round((1 - smooth((out - F) / (M - F - 1))) * S[o + 3]);
  }
  writePNG(TMP + e.name + '.png', { w: sw, h: sh, data: sp });
  const s = OUT_W / CROP.w;
  execFileSync('sips', ['-z', String(Math.round(sh * s)), String(Math.round(sw * s)), TMP + e.name + '.png', '--out', `../${e.name}.png`]);
  console.log(`${e.name}: left ${(100 * (X0 - CROP.x) / CROP.w).toFixed(2)}% top ${(100 * (Y0 - CROP.y) / CROP.h).toFixed(2)}% width ${(100 * sw / CROP.w).toFixed(2)}% height ${(100 * sh / CROP.h).toFixed(2)}%`);
}
for (const [img, name] of [[S, 'robot'], [base, 'robot-base']]) {
  const out = Buffer.alloc(CROP.w * CROP.h * 4);
  for (let y = 0; y < CROP.h; y++) img.copy(out, y * CROP.w * 4, at(CROP.x, CROP.y + y), at(CROP.x + CROP.w, CROP.y + y));
  writePNG(TMP + name + '.png', { w: CROP.w, h: CROP.h, data: out });
  execFileSync('sips', ['-z', String(Math.round(CROP.h * OUT_W / CROP.w)), String(OUT_W), TMP + name + '.png', '--out', `../${name}.png`]);
}
console.log('done: robot.png, robot-base.png and the eyes, in assistant/');
