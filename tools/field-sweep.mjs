import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

// Measures the particle field by difference, not by guesswork.
//
// Every sample is two screenshots of the identical scroll position — one with
// the field canvases visible, one with them hidden by CSS — diffed inside the
// page against a 2D canvas. What survives the diff is exactly the particles the
// viewer can see: anything an opaque card covers is absent from both frames and
// so is absent from the count. That makes three separate questions measurable:
//
//   lit      does the station light up in its own window, and go dark outside?
//   locked   does the shape hold still against the page while the page scrolls?
//            pageBox is the visible cloud in document coordinates: if the shape
//            rides its section, it stays put across samples. If it hangs in the
//            viewport, it slides by exactly the scroll delta.
//   clear    does the count survive the section's own content arriving, or does
//            an opaque card eat half the cloud?
//
// Film grain is hidden for both frames: it is re-randomised ten times a second
// and would otherwise dominate the diff.

const VW = Number(process.argv[2]) || 1440;
const VH = Number(process.argv[3]) || 900;

const OUT = `/tmp/alphe-sweep${VW === 1440 ? '' : '-' + VW}`;
mkdirSync(OUT, { recursive: true });
const THRESHOLD = 10; // 0-255 luminance; below this is JPEG-free PNG noise only

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: VW, height: VH });
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await p.goto((process.env.ALPHE_BASE || 'http://localhost:4322') + '/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1800));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const to = async (y) => p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), Math.max(0, Math.round(y)));

// Everything else on the page that moves on its own gets hidden for the whole
// run. The two frames of a sample are milliseconds apart, and a marquee or a
// grain tile that has advanced between them would diff just as brightly as a
// particle does.
await p.evaluate(() => {
  const noise = [
    '.grain',
    '.cursor',
    '.marquee',
    '.coverage__lane',
    'canvas:not([data-particles])',
  ];
  for (const sel of noise) {
    for (const el of document.querySelectorAll(sel)) el.style.visibility = 'hidden';
  }
});

const setField = (on) =>
  p.evaluate((visible) => {
    for (const c of document.querySelectorAll('[data-particles]')) {
      c.style.visibility = visible ? '' : 'hidden';
    }
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, on);

// Diff two PNG data URLs in the page and describe the surviving pixels.
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
      let sx = 0;
      let sy = 0;
      let x0 = 1e9;
      let y0 = 1e9;
      let x1 = -1e9;
      let y1 = -1e9;
      let sum = 0;
      for (let i = 0; i < A.length; i += 4) {
        const d =
          Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d < thr * 3) continue;
        const px = (i / 4) % cv.width;
        const py = ((i / 4) / cv.width) | 0;
        n++;
        sum += d / 3;
        sx += px;
        sy += py;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
      // CSS pixels, not device pixels: the shots are taken at deviceScaleFactor 1.
      return n
        ? {
            n,
            mean: +(sum / n).toFixed(1),
            cx: Math.round(sx / n),
            cy: Math.round(sy / n),
            box: [x0, y0, x1, y1].map(Math.round),
          }
        : { n: 0, mean: 0, cx: 0, cy: 0, box: [0, 0, 0, 0] };
    },
    a,
    c,
    THRESHOLD
  );

const rows = [];
async function sample(label, y, keep) {
  await to(y);
  await wait(2200);
  await setField(true);
  const on = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
  if (keep) writeFileSync(`${OUT}/${label}.png`, Buffer.from(on.split(',')[1], 'base64'));
  await setField(false);
  const off = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
  await setField(true);
  const m = await measure(on, off);
  const scrollY = await p.evaluate(() => Math.round(scrollY));
  const row = {
    label,
    scrollY,
    ...m,
    // Document coordinates. Constant across samples == the shape is riding the
    // page; sliding by the scroll delta == it is pinned to the viewport.
    pageTop: m.n ? m.box[1] + scrollY : null,
    pageCy: m.n ? m.cy + scrollY : null,
  };
  rows.push(row);
  console.log(
    label.padEnd(24),
    'y=' + String(scrollY).padStart(5),
    'px=' + String(m.n).padStart(6),
    'mean=' + String(m.mean).padStart(5),
    'box=' + JSON.stringify(m.box).padEnd(24),
    'pageTop=' + row.pageTop
  );
  return row;
}

const stations = await p.evaluate(() =>
  Array.from(document.querySelectorAll('[data-field-shape]')).map((el) => {
    const a = el.querySelector('[data-field-anchor], [data-avoid], .section-title, h1, h2') || el;
    return {
      shape: el.dataset.fieldShape,
      id: el.id || el.className.split(' ')[0],
      lock: el.dataset.fieldLock !== 'off',
      anchorTop: Math.round(a.getBoundingClientRect().top + scrollY),
      top: Math.round(el.getBoundingClientRect().top + scrollY),
      bottom: Math.round(el.getBoundingClientRect().bottom + scrollY),
    };
  })
);

// Named rather than derived, because the check is that a section *without* a
// station is dark, and a section that has quietly gained one would then be
// asserted against backwards. Filtered by what is on the page: a hard-coded id
// that outlives its section takes the whole sweep down instead of reporting on
// it, which is how this list came to name a #team that no longer exists.
const quiet = await p.evaluate(() =>
  ['coverage']
    .map((id) => document.getElementById(id))
    .filter((el) => el && !el.dataset.fieldShape)
    .map((el) => {
      const h = el.querySelector('[data-avoid], .section-title, h2');
      return { id: el.id, anchorTop: Math.round((h || el).getBoundingClientRect().top + scrollY) };
    })
);

console.log('\n--- per station: before / enter / hold / mid / past ---');
for (let i = 0; i < stations.length; i++) {
  const s = stations[i];
  const tag = i + '-' + s.shape;
  console.log(`\n[${tag}] ${s.id} anchor=${s.anchorTop} lock=${s.lock}`);
  await sample(`${tag}-0-before`, s.anchorTop - VH * 1.15, true);
  await sample(`${tag}-1-enter`, s.anchorTop - VH * 0.78, true);
  await sample(`${tag}-2-hold`, s.anchorTop - VH * 0.354, true);
  await sample(`${tag}-3-mid`, s.anchorTop - VH * 0.1, true);
  await sample(`${tag}-4-past`, s.anchorTop + VH * 0.3, true);
}

console.log('\n--- sections with no station (must be near dark) ---');
for (const q of quiet) {
  await sample(`quiet-${q.id}`, q.anchorTop - VH * 0.22, true);
}

console.log('\n--- fast scroll: hero to last station in ~1s ---');
const last = stations[stations.length - 1];
await to(0);
await wait(1500);
const target = last.anchorTop - VH * 0.354;
for (let k = 1; k <= 24; k++) {
  await to((target * k) / 24);
  await wait(40);
}
await wait(500);
await setField(true);
writeFileSync(`${OUT}/fast-0.5s.png`, await p.screenshot());
await wait(2000);
const fast = await sample('fast-settled', target, true);
const ref = rows.find((r) => r.label === `${stations.length - 1}-${last.shape}-2-hold`);
console.log(
  'fast settled pageCy=' + fast.pageCy,
  'slow reference pageCy=' + (ref ? ref.pageCy : 'n/a'),
  'delta=' + (ref && fast.pageCy !== null ? Math.abs(fast.pageCy - ref.pageCy) : 'n/a')
);

writeFileSync(`${OUT}/report.json`, JSON.stringify({ stations, quiet, rows }, null, 1));
console.log('\n' + (errors.length ? errors.join('\n') : 'no errors'));
await b.close();
