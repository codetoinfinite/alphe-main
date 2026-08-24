// Parks the page at each station's hold and samples the field over time.
// Proves a word run rewrites itself on a dwell timer and a mark stays still.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const W = Number(process.argv[2] || 1440);
const OUT = '/tmp/alphe-words';
fs.mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
// The field's context is created without preserveDrawingBuffer, so a readPixels
// from outside the render loop comes back cleared. Forced on for the probe only.
await p.evaluateOnNewDocument(() => {
  const real = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type.startsWith('webgl')) attrs = { ...(attrs || {}), preserveDrawingBuffer: true };
    return real.call(this, type, attrs);
  };
});
await p.setViewport({ width: W, height: 900, deviceScaleFactor: 1 });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));

const stations = await p.evaluate(() => {
  const top = (el) => {
    let y = 0;
    for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
    return y;
  };
  return [...document.querySelectorAll('[data-field-shape]')].map((el) => {
    const a =
      el.querySelector('[data-field-anchor]') ||
      el.querySelector('[data-avoid], .section-title, h1, h2') ||
      el;
    const lock = el.dataset.fieldLock || 'anchor';
    return {
      id: el.id || el.className.split(' ')[0],
      shape: el.dataset.fieldShape,
      hold: Math.round(lock === 'section' ? top(el) : top(a) - innerHeight * 0.354),
    };
  });
});

// A cheap fingerprint of the field: the fixed canvas, downsampled to a coarse
// occupancy grid. Two different words differ in tens of cells; the same word a
// frame apart differs in none, because the field is still between morphs.
async function fingerprint() {
  return p.evaluate(() => {
    const c = document.querySelector('canvas.field-scroll');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const GX = 48;
    const GY = 30;
    const cells = new Array(GX * GY).fill(0);
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const a = px[(y * w + x) * 4 + 3];
        if (a > 24) cells[((y * GY / h) | 0) * GX + ((x * GX / w) | 0)]++;
      }
    }
    return cells.map((v) => (v > 2 ? 1 : 0)).join('');
  });
}

const diff = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

for (const s of stations) {
  await p.evaluate((y) => window.scrollTo(0, y), s.hold);
  await new Promise((r) => setTimeout(r, 900));
  const shots = [];
  for (let i = 0; i < 14; i++) {
    shots.push(await fingerprint());
    await p.screenshot({ path: `${OUT}/${s.id}-${i}.png` });
    await new Promise((r) => setTimeout(r, 500));
  }
  const d = shots.slice(1).map((f, i) => diff(shots[i], f));
  const ink = shots.map((f) => [...f].filter((c) => c === '1').length);
  console.log(
    `${s.id.padEnd(10)} ${String(s.shape).padEnd(30)} hold ${String(s.hold).padStart(6)}  ink ${ink.join(',')}  step-diff ${d.join(',')}`
  );
}

await b.close();
