import puppeteer from 'puppeteer-core';

// How fast does the cloud travel through one stretch of the page?
//
// continuity.mjs walks the whole document, which is the right check to ship on
// but too slow to tune against. This walks a range and prints the centroid step
// by step, so a placement can be changed and re-measured in a few seconds.

const FROM = Number(process.argv[2] ?? 1800);
const TO = Number(process.argv[3] ?? 7200);
const STEP = Number(process.argv[4] ?? 120);
const VW = Number(process.argv[5] ?? 1440);
const VH = Number(process.argv[6] ?? 900);
const LIMIT = 140;

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: VW, height: VH });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1600));

await p.evaluate(() => {
  for (const sel of ['.grain', '.cursor', '.marquee', 'canvas:not([data-particles])']) {
    for (const el of document.querySelectorAll(sel)) el.style.visibility = 'hidden';
  }
  const stage = document.querySelector('.console__stage');
  if (stage) stage.replaceWith(stage.cloneNode(true));
});

const setField = (on) =>
  p.evaluate((visible) => {
    for (const c of document.querySelectorAll('[data-particles]')) {
      c.style.visibility = visible ? '' : 'hidden';
    }
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, on);

const centroid = (a, c) =>
  p.evaluate(
    async (aSrc, bSrc, thr) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(aSrc), load(bSrc)]);
      const cv = document.createElement('canvas');
      cv.width = ia.width;
      cv.height = ia.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(ia, 0, 0);
      const A = g.getImageData(0, 0, cv.width, cv.height).data;
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(ib, 0, 0);
      const B = g.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < A.length; i += 4) {
        const d =
          Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d < thr * 3) continue;
        const px = (i / 4) % cv.width;
        const py = ((i / 4) / cv.width) | 0;
        n++;
        sx += px;
        sy += py;
      }
      return n ? { n, cx: Math.round(sx / n), cy: Math.round(sy / n) } : { n: 0 };
    },
    a,
    c,
    10
  );

let prev = null;
let worst = 0;
const jumps = [];
for (let y = FROM; y <= TO; y += STEP) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 480));
  await setField(true);
  const on = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
  await setField(false);
  const off = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
  await setField(true);
  const m = await centroid(on, off);

  let move = null;
  if (m.n > 200 && prev) move = Math.round(Math.hypot(m.cx - prev.cx, m.cy - prev.cy));
  if (move !== null && move > worst) worst = move;
  if (move !== null && move > LIMIT) jumps.push({ y, move });
  console.log(
    'y=' + String(y).padStart(5),
    'n=' + String(m.n).padStart(5),
    m.n > 200 ? `c=(${m.cx},${m.cy})` : 'dark        ',
    move === null ? '' : (move > LIMIT ? 'JUMP ' : 'move ') + move
  );
  prev = m.n > 200 ? m : null;
}
console.log(`\nworst ${worst} (limit ${LIMIT}), ${jumps.length} over`);
await b.close();
