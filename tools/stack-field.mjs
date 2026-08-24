import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// Where is the cloud while the deck is on screen?
//
// The other field tools sample around a station's anchor, which is the right
// window for a section a screen and a half tall. This one is a 3000px section
// with five opaque cards holding the middle of the viewport for all of it, so
// what matters is the whole run: the cloud has to stay in the one band that
// stays clear, and it must not be sitting under a card unseen.
//
// Same two-shot diff as the rest — field visible minus field hidden — so an
// occluded particle counts as zero by construction.

const VW = Number(process.argv[2]) || 1440;
const VH = Number(process.argv[3]) || 900;
const STEP = Number(process.argv[4]) || 200;
const OUT = `/tmp/alphe-stackfield-${VW}`;
mkdirSync(OUT, { recursive: true });

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

const measure = (a, c) =>
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
      let x0 = 1e9;
      let y0 = 1e9;
      let x1 = -1e9;
      let y1 = -1e9;
      for (let i = 0; i < A.length; i += 4) {
        const d =
          Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d < thr * 3) continue;
        const px = (i / 4) % cv.width;
        const py = ((i / 4) / cv.width) | 0;
        n++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
      return n ? { n, box: [x0, y0, x1, y1].map(Math.round) } : { n: 0, box: null };
    },
    a,
    c,
    10
  );

const geo = await p.evaluate(() => {
  const sec = document.querySelector('[data-stack]');
  const r = sec.getBoundingClientRect();
  const rail = document.querySelector('.stack__rail-inner').getBoundingClientRect();
  const card = document.querySelector('.stack__slot .card').getBoundingClientRect();
  return {
    top: Math.round(r.top + scrollY),
    bottom: Math.round(r.bottom + scrollY),
    railL: Math.round(rail.left),
    railR: Math.round(rail.right),
    cardL: Math.round(card.left),
  };
});

console.log(`${VW}x${VH}  section ${geo.top}..${geo.bottom}  rail x ${geo.railL}..${geo.railR}  card left ${geo.cardL}`);

let worstUnder = 0;
let dark = 0;
let samples = 0;
for (let y = geo.top - VH; y <= geo.bottom; y += STEP) {
  await p.evaluate((v) => scrollTo({ top: Math.max(0, v), behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 800));
  await setField(true);
  const on = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
  await setField(false);
  const off = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
  await setField(true);
  const m = await measure(on, off);
  await p.screenshot({ path: `${OUT}/y-${y}.png` });

  // How far past the card's left edge does the visible cloud reach, and does it
  // run off the top of the window?
  const under = m.box ? Math.max(0, m.box[2] - geo.cardL) : 0;
  const clipTop = m.box && m.box[1] <= 0;
  samples++;
  if (under > worstUnder) worstUnder = under;
  if (m.n < 300) dark++;
  console.log(
    'y=' + String(y).padStart(5),
    'px=' + String(m.n).padStart(6),
    'box=' + JSON.stringify(m.box).padEnd(26),
    (under ? `past card by ${under}px ` : '') + (clipTop ? 'CLIPPED AT TOP' : '')
  );
}
console.log(`\n${dark}/${samples} samples near dark, worst reach past the card edge ${worstUnder}px`);
await b.close();
