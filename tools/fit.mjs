import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

// Does the shape fit the frame?
//
// Every earlier check ran at 1440. Placement is a fraction of viewport width and
// the shapes are sized from the canvas, so a wider window pushes a shape further
// out *and* makes it bigger — the two effects compound and can walk it off the
// right edge. This measures the visible cloud at each station across a range of
// widths and reports the margin to each viewport edge. A margin of 0 means the
// shape is being clipped by the frame.
//
// Same two-shot diff as field-sweep: field visible minus field hidden, so what
// is measured is exactly what a reader can see.

const OUT = '/tmp/alphe-fit';
mkdirSync(OUT, { recursive: true });

const WIDTHS = process.argv.length > 2
  ? process.argv.slice(2).map(Number)
  : [1280, 1440, 1728, 1920, 2560];
const RATIO = 16 / 10;
const THRESHOLD = 10;
const HOLD_REF = 0.354;

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const measure = (p, a, c) =>
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
      // Column and row occupancy at the four edges: a shape merely reaching the
      // edge is one stray particle, a shape being cut by it lights a whole run.
      let edgeL = 0;
      let edgeR = 0;
      let edgeT = 0;
      let edgeB = 0;
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
        if (px <= 2) edgeL++;
        if (px >= cv.width - 3) edgeR++;
        if (py <= 2) edgeT++;
        if (py >= cv.height - 3) edgeB++;
      }
      return n
        ? { n, box: [x0, y0, x1, y1].map(Math.round), edges: [edgeL, edgeT, edgeR, edgeB] }
        : { n: 0, box: null, edges: [0, 0, 0, 0] };
    },
    a,
    c,
    THRESHOLD
  );

const report = [];

for (const VW of WIDTHS) {
  const VH = Math.round(VW / RATIO);
  const p = await b.newPage();
  await p.setViewport({ width: VW, height: VH });
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p.goto((process.env.ALPHE_BASE || 'http://localhost:4322') + '/', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1800));
  // The nav joins the self-animating things: it hides on scroll down and returns
  // on scroll up, so it covers the top of the frame in one direction only.
  await p.evaluate(() => {
    for (const sel of ['.grain', '.cursor', '.marquee', '.nav', 'canvas:not([data-particles])']) {
      for (const el of document.querySelectorAll(sel)) el.style.visibility = 'hidden';
    }
  });

  // Reveals and counters fire once, the first time their section is seen. Caught
  // mid-flight they change between a sample's two frames and are counted as
  // particles — and a counter ticking at the foot of the page drags the measured
  // bounding box down to it. One full pass fires them all before measuring.
  {
    const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (let y = 0; y <= max; y += 300) {
      await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
      await new Promise((r) => setTimeout(r, 110));
    }
    await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await new Promise((r) => setTimeout(r, 2000));
    await p.evaluate(() => {
      const css = document.createElement('style');
      css.textContent = '[data-reveal]{transition:none!important}';
      document.head.appendChild(css);
      for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-revealed');
    });
  }
  const setField = (on) =>
    p.evaluate((visible) => {
      for (const c of document.querySelectorAll('[data-particles]')) {
        c.style.visibility = visible ? '' : 'hidden';
      }
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, on);

  const stations = await p.evaluate(() =>
    Array.from(document.querySelectorAll('[data-field-shape]')).map((el) => {
      const a = el.querySelector('[data-field-anchor], [data-avoid], .section-title, h1, h2') || el;
      return { shape: el.dataset.fieldShape, anchorTop: a.getBoundingClientRect().top + scrollY };
    })
  );

  console.log(`\n=== ${VW}x${VH} ===`);
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    await p.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), Math.max(0, s.anchorTop - VH * HOLD_REF));
    await new Promise((r) => setTimeout(r, 2400));
    await setField(true);
    const on = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
    writeFileSync(`${OUT}/${VW}-${i}-${s.shape}.png`, Buffer.from(on.split(',')[1], 'base64'));
    await setField(false);
    const off = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
    await setField(true);
    const m = await measure(p, on, off);
    const margins = m.box ? [m.box[0], m.box[1], VW - 1 - m.box[2], VH - 1 - m.box[3]] : null;
    const clipped = m.edges.some((e) => e > 20);
    // The frame that matters is not the window, it is the column the content is
    // laid out in: --container caps at 1240px, so past that width the window
    // keeps widening and the column does not. A shape can sit well inside the
    // window and still be stranded out in the margin beside the copy.
    const col = await p.evaluate(() => {
      const r = document.querySelector('.container').getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.right)];
    });
    const inCol = m.box ? [m.box[0] - col[0], col[1] - m.box[2]] : null;
    const stranded = inCol ? Math.min(inCol[0], inCol[1]) < -30 : false;
    report.push({ VW, VH, shape: s.shape, ...m, margins, clipped, col, inCol, stranded });
    console.log(
      (i + '-' + s.shape).padEnd(12),
      'px=' + String(m.n).padStart(6),
      'box=' + JSON.stringify(m.box).padEnd(26),
      'margins L/T/R/B=' + JSON.stringify(margins).padEnd(26),
      'col L/R=' + JSON.stringify(inCol).padEnd(14),
      clipped ? 'CLIPPED edges=' + JSON.stringify(m.edges) : '',
      stranded ? 'OUTSIDE COLUMN' : ''
    );
  }
  if (errors.length) console.log(errors.join('\n'));
  await p.close();
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
await b.close();
