import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

// Where does the field actually land on top of type?
//
// "Particles behind the text" is not a z-order question — the copy paints over
// the canvas — it is a contrast one: dots in the interline space of a muted
// paragraph cost more legibility than dots anywhere else. So the measurement is
// pixels-of-visible-particle inside the tight box of a run of text, swept down
// the whole page.
//
// Same two-shot diff as the other measuring tools: field visible minus field
// hidden, so an opaque card counts as zero by construction.

const STEP = Number(process.argv[2]) || 200;
const VW = Number(process.argv[3]) || 1440;
const VH = Number(process.argv[4]) || 900;
const OUT = '/tmp/alphe-legibility';
mkdirSync(OUT, { recursive: true });

const TEXT = 'p, h1, h2, h3, h4, li, blockquote, figcaption, .eyebrow, .card__point, .rail, .ledger__tag';
const THRESHOLD = 10;

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: VW, height: VH });
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1600));

// Everything that animates on its own would otherwise show up in the diff as
// particles. The field's own ambient term is handled by reduced motion in the
// tools that need it; here the field must move, so instead the page is settled
// once and the non-field animations are hidden or forced to their end state.
await p.evaluate(() => {
  for (const sel of ['.grain', '.cursor', '.marquee', 'canvas:not([data-particles])']) {
    for (const el of document.querySelectorAll(sel)) el.style.visibility = 'hidden';
  }

  // The console stage replays a request on a loop, so its borders and labels
  // change colour between the two frames of a sample and diff exactly as
  // brightly as a particle would. It cannot simply be hidden: its panels are
  // opaque and sit above the field, and hiding them uncovers the cloud behind
  // and invents overlaps on text that in reality can never be reached.
  //
  // So it is frozen instead. Swapping in a clone leaves the module holding a
  // node that is no longer in the document — its timers keep firing into
  // nothing — while the page keeps a pixel-identical, permanently still copy,
  // with every text run still where it was and still on an opaque surface.
  const stage = document.querySelector('.console__stage');
  if (stage) stage.replaceWith(stage.cloneNode(true));
});
const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
for (let y = 0; y <= max; y += 300) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 110));
}
await p.evaluate(() => {
  const css = document.createElement('style');
  css.textContent = '[data-reveal]{transition:none!important}';
  document.head.appendChild(css);
  for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-revealed');
});

const setField = (on) =>
  p.evaluate((visible) => {
    for (const c of document.querySelectorAll('[data-particles]')) {
      c.style.visibility = visible ? '' : 'hidden';
    }
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, on);

const hits = [];

for (let y = 0; y <= max; y += STEP) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 900));

  const rects = await p.evaluate((sel) => {
    const range = document.createRange();
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      if (!t.width || !t.height) continue;
      out.push({
        box: [t.left, t.top, t.right, t.bottom].map(Math.round),
        text: (el.textContent || '').trim().slice(0, 46),
      });
    }
    return out;
  }, TEXT);
  if (!rects.length) continue;

  await setField(true);
  const on = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
  await setField(false);
  const off = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
  await setField(true);

  const counts = await p.evaluate(
    async (aSrc, bSrc, boxes, thr) => {
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
      const dpr = cv.width / innerWidth;
      return boxes.map(({ box }) => {
        const [x0, y0, x1, y1] = box.map((v) => Math.round(v * dpr));
        let n = 0;
        for (let py = Math.max(0, y0); py < Math.min(cv.height, y1); py++) {
          for (let px = Math.max(0, x0); px < Math.min(cv.width, x1); px++) {
            const i = (py * cv.width + px) * 4;
            const d =
              Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
            if (d >= thr * 3) n++;
          }
        }
        return n;
      });
    },
    on,
    off,
    rects,
    THRESHOLD
  );

  for (let i = 0; i < rects.length; i++) {
    if (counts[i] > 0) hits.push({ y, n: counts[i], box: rects[i].box, text: rects[i].text });
  }
  const worst = Math.max(0, ...counts);
  console.log(`y=${String(y).padStart(4)} worst=${String(worst).padStart(5)}`);
}

hits.sort((a, b) => b.n - a.n);
console.log('\nworst overlaps (particle px inside a run of type):');
for (const h of hits.slice(0, 25)) {
  console.log(String(h.n).padStart(6), 'y=' + String(h.y).padStart(4), JSON.stringify(h.box).padEnd(24), h.text);
}
const total = hits.reduce((s, h) => s + h.n, 0);
console.log(`\n${hits.length} overlapping runs, ${total} px total`);
if (errors.length) console.log(errors.join('\n'));
writeFileSync(`${OUT}/report.json`, JSON.stringify(hits, null, 1));
await b.close();
