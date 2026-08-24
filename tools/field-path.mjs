// Field continuity, measured off the field's own framebuffer instead of off a
// screenshot diff. continuity.mjs subtracts a field-off frame from a field-on
// one, so anything else on the page that moves between the two frames is
// counted as particles — which is exactly what happens across the demo,
// economics and reach sections, and it is why those stops come back "unsettled".
// Reading the canvas directly removes the page from the measurement entirely.
//
//   node tools/field-path.mjs [from] [to] [step] [settle-ms]
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const FROM = Number(process.argv[2] || 0);
const TO = Number(process.argv[3] || 0) || null;
const STEP = Number(process.argv[4] || 20);
const WAIT = Number(process.argv[5] || 380);

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.evaluateOnNewDocument(() => {
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type.startsWith('webgl')) attrs = { ...(attrs || {}), preserveDrawingBuffer: true };
    return real.call(this, type, attrs);
  };
});
await p.setViewport({ width: 1440, height: 900 });
await p.goto((process.env.ALPHE_BASE || 'http://localhost:4322') + '/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));

const maxScroll = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const to = Math.min(TO ?? maxScroll, maxScroll);

const sample = () =>
  p.evaluate(() => {
    const c = document.querySelector('canvas.field-scroll');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const a = px[(y * w + x) * 4 + 3];
        if (a <= 24) continue;
        n++;
        sx += x;
        // readPixels is bottom-up; flip so y reads like the page.
        sy += h - y;
      }
    }
    const scale = c.width / c.clientWidth;
    return n
      ? { n, cx: Math.round(sx / n / scale), cy: Math.round(sy / n / scale) }
      : { n: 0, cx: 0, cy: 0 };
  });

const rows = [];
for (let y = FROM; y <= to; y += STEP) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, WAIT));
  rows.push({ y, ...(await sample()) });
}

const LIT = 300;
const moves = [];
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1];
  const c = rows[i];
  if (a.n < LIT || c.n < LIT) {
    moves.push(null);
    continue;
  }
  moves.push({ from: a.y, to: c.y, dx: c.cx - a.cx, dy: c.cy - a.cy });
}

// Size alone does not separate a cut from a fast leg. A leg that is short in
// scroll and long on screen — watch -> how is one — puts 80px of travel into a
// 20px step at the middle of its easing, and did so before there was anything
// here to blame it on. What that leg does not do is change direction: it slides
// one way, accelerating and then decelerating. A cut lands the cloud somewhere
// unrelated and the next step has to come back, so the step before or after
// points the other way. Flag on the turn, not on the distance.
let maxMove = 0;
const jumps = [];
for (let i = 0; i < moves.length; i++) {
  const m = moves[i];
  if (!m) continue;
  const move = Math.round(Math.hypot(m.dx, m.dy));
  if (move > maxMove) maxMove = move;
  if (move <= 60) continue;
  // -1 where there is no neighbour to compare against — the ends of the sweep
  // and either side of a dark stretch, which are the places a cut would hide.
  const along = (o) =>
    o ? (o.dx * m.dx + o.dy * m.dy) / (Math.hypot(o.dx, o.dy) * Math.hypot(m.dx, m.dy) || 1) : -1;
  const before = along(moves[i - 1]);
  const after = along(moves[i + 1]);
  // Continuous if either neighbour keeps within 60 degrees of this heading.
  if (before > 0.5 || after > 0.5) continue;
  jumps.push({ from: m.from, to: m.to, move, before, after });
}

writeFileSync('/tmp/alphe-path.json', JSON.stringify({ FROM, to, STEP, maxMove, jumps, rows }, null, 1));
console.log(`sampled ${rows.length} stops of ${STEP}px from ${FROM} to ${to}`);
console.log('largest centroid move between neighbouring stops:', maxMove, 'px');
if (jumps.length) {
  console.log('CUTS (>60px and not continuous with either neighbour):');
  for (const j of jumps)
    console.log(
      '  ',
      j.from,
      '->',
      j.to,
      j.move + 'px',
      'heading vs prev/next',
      j.before.toFixed(2) + '/' + j.after.toFixed(2)
    );
} else {
  console.log('no cuts');
}
await b.close();
