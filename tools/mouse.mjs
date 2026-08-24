import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

// Does the hole sit under the pointer, and does it stay there when the page
// scrolls but the hand does not?
//
// Photographing the field with the pointer present and with it off-screen and
// diffing the two isolates the particles the pointer displaced — but only if
// nothing else in the frame moves between the two shots. The first version of
// this tool ignored that, and the ambient drift alone changed ~6300 pixels
// across the whole cloud while the repulsion changed a few hundred. Every
// alignment figure it produced was the cloud's own centroid, which is why the
// pointer could be moved 600px, or taken off-screen entirely, without the
// "hole" moving at all.
//
// So the field is frozen for measurement. uTime pins to 0 under reduced motion
// and the ambient term vanishes with it, while uAttract is a plain constant and
// the cursor block is not gated — the repulsion is left as the only thing in the
// frame that can move. STILLNESS and CONTROL below are the checks that this
// actually held, and they run before any alignment number is believed.

const VW = 1440;
const VH = 900;
const THRESHOLD = 10;
const OUT = '/tmp/alphe-mouse';
mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: VW, height: VH });
// Before the load, so the module sees it when it first reads the query.
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1600);

await p.evaluate(() => {
  for (const sel of ['.grain', '.cursor', '.marquee', '.nav', 'canvas:not([data-particles])']) {
    for (const el of document.querySelectorAll(sel)) el.style.visibility = 'hidden';
  }
});
{
  const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= max; y += 300) {
    await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
    await wait(110);
  }
  await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await wait(2000);
  await p.evaluate(() => {
    const css = document.createElement('style');
    css.textContent = '[data-reveal]{transition:none!important}';
    document.head.appendChild(css);
    for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-revealed');
  });
}

// Synthetic rather than page.mouse, so the pointer can be put genuinely
// off-screen — the fixed canvas covers the whole viewport, and there is no
// in-viewport position that counts as outside it.
//
// Dispatched on the element under the point and allowed to bubble, because a
// real pointermove always carries an element as its target and handlers on the
// page reasonably call e.target.closest().
const setPointer = (x, y) =>
  p.evaluate(
    (cx, cy) =>
      new Promise((r) => {
        const t = document.elementFromPoint(cx, cy) || document.documentElement;
        t.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true }));
        requestAnimationFrame(() => requestAnimationFrame(r));
      }),
    x,
    y
  );

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
      let n = 0, sx = 0, sy = 0;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const grid = new Int32Array(Math.ceil(cv.width / 60) * Math.ceil(cv.height / 60));
      for (let i = 0; i < A.length; i += 4) {
        const d =
          Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d < thr * 3) continue;
        const px = (i / 4) % cv.width;
        const py = ((i / 4) / cv.width) | 0;
        n++;
        sx += px;
        sy += py;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        grid[((py / 60) | 0) * Math.ceil(cv.width / 60) + ((px / 60) | 0)]++;
      }
      // Densest 60px cell, and its centre. Aiming at the middle of the bounding
      // box puts the pointer wherever the shape happens to be hollow — inside the
      // superellipse the text is carved out of, or in the gap of a ring — and a
      // pointer with no particles around it displaces nothing and measures n=0.
      const CELL = 60;
      const cols = Math.ceil(cv.width / CELL);
      let best = -1, bx = 0, by = 0;
      for (let k = 0; k < grid.length; k++) {
        if (grid[k] <= best) continue;
        best = grid[k];
        bx = (k % cols) * CELL + CELL / 2;
        by = ((k / cols) | 0) * CELL + CELL / 2;
      }
      return n
        ? {
            n,
            cx: Math.round(sx / n),
            cy: Math.round(sy / n),
            box: [x0, y0, x1, y1].map(Math.round),
            peak: [Math.round(bx), Math.round(by)],
          }
        : { n: 0, cx: null, cy: null, box: null, peak: null };
    },
    a,
    c,
    THRESHOLD
  );

const shot = async () => 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
const goto = (v) => p.evaluate((n) => scrollTo({ top: n, behavior: 'instant' }), v);

// Which canvases may draw. Held here because cloudCentre has to hide everything
// to take its off-frame and then restore exactly what was showing, not all three.
let showing = null;
const only = (sel) => {
  showing = sel;
  return p.evaluate((s) => {
    for (const c of document.querySelectorAll('[data-particles]')) {
      c.style.visibility = s === null || c.matches(s) ? '' : 'hidden';
    }
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, sel);
};

async function cloudBox() {
  await setPointer(-9999, -9999);
  await wait(500);
  const on = await shot();
  await p.evaluate(() => {
    for (const c of document.querySelectorAll('[data-particles]')) c.style.visibility = 'hidden';
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const off = await shot();
  await only(showing);
  return measure(on, off);
}

// Two shots of the same thing, nothing touched in between. Under reduced motion
// this has to come back at essentially zero, or the field is still animating and
// nothing below this line means anything.
console.log('=== STILLNESS: is the frozen field actually still? ===');
await goto(0);
await wait(1500);
await setPointer(-9999, -9999);
await wait(800);
const s1 = await shot();
await wait(900);
const s2 = await shot();
const still = await measure(s1, s2);
console.log('two identical frames differ by', still.n, 'px');
const STILL_OK = still.n < 200;
if (!STILL_OK) console.log('!! field is not frozen — alignment figures below are meaningless');

// And the other half: with the field still, does moving the pointer actually move
// what is measured? Two positions 400px apart have to come back 400px apart.
console.log('\n=== CONTROL: does the measured hole follow the pointer? ===');
{
  await goto(600);
  await wait(1500);
  const cb = await cloudBox();
  const [midx, midy] = cb.peak;
  const pts = [
    [midx - 120, midy],
    [midx + 120, midy],
  ];
  const cents = [];
  await setPointer(-9999, -9999);
  await wait(700);
  const away = await shot();
  for (const [px, py] of pts) {
    await setPointer(-9999, -9999);
    await wait(500);
    await setPointer(px, py);
    await wait(800);
    const m = await measure(await shot(), away);
    cents.push(m);
    console.log('pointer=(' + px + ',' + py + ') n=' + m.n + ' centroid=(' + m.cx + ',' + m.cy + ')');
  }
  const moved = Math.round(Math.hypot(cents[1].cx - cents[0].cx, cents[1].cy - cents[0].cy));
  console.log('pointer moved 240px, measured hole moved ' + moved + 'px');
  if (moved < 120) console.log('!! the measurement does not track the pointer — do not trust it');
}

const rows = [];

// Accuracy: with the field frozen, put the pointer at a known point on the cloud
// and ask where the hole landed.
console.log('\n=== ALIGNMENT: hole vs pointer, pointer still ===');
for (const y of [0, 600, 3626, 6414]) {
  await only(null);
  await goto(y);
  await wait(1500);
  const cb = await cloudBox();
  if (!cb.n) {
    console.log('y=' + y, 'no cloud, skipped');
    continue;
  }
  const [px, py] = cb.peak;
  await setPointer(-9999, -9999);
  await wait(700);
  const away = await shot();
  await setPointer(px, py);
  await wait(800);
  const near = await shot();
  writeFileSync(`${OUT}/still-${y}.png`, Buffer.from(near.split(',')[1], 'base64'));
  const m = await measure(near, away);
  const off = m.n ? Math.round(Math.hypot(m.cx - px, m.cy - py)) : null;
  rows.push({ mode: 'still', y, at: [px, py], hole: [m.cx, m.cy], n: m.n, off });
  console.log(
    'y=' + String(y).padStart(5),
    'pointer=(' + px + ',' + py + ')',
    'hole=(' + m.cx + ',' + m.cy + ')',
    'n=' + String(m.n).padStart(5),
    'off=' + off + 'px'
  );
}

// The case the event-time conversion got wrong: pointer parked, page scrolled
// under it. Measured one canvas at a time, because .field-scroll is fixed — its
// rect is the viewport and scrolling never moves it, so it cannot fail this way
// and, carrying most of the particles, it outvotes the two that can.
// .hero__field--front and .cta__canvas are absolute and travel with the page.
console.log('\n=== STALENESS: parked pointer vs a fresh one in the same place ===');
for (const [sel, from, to] of [
  ['.hero__field--front', 0, 300],
  ['.hero__field--front', 0, 600],
  ['.cta__canvas', 8300, 8600],
  ['.field-scroll', 3626, 3900],
  ['.field-scroll', 6414, 6700],
  [null, 0, 300],
  [null, 6414, 6700],
]) {
  const tag = (sel || 'all') + ' ' + from + '->' + to;
  await only(sel);
  await goto(to);
  await wait(1500);
  // Aim at the cloud as it sits at the *final* scroll position — that is where
  // both photographs are taken, and a pointer aimed at where the cloud used to
  // be lands on empty background with nothing to displace.
  const cb = await cloudBox();
  if (!cb.n) {
    console.log(tag.padEnd(34), 'no cloud, skipped');
    continue;
  }
  const [px, py] = cb.peak;

  await setPointer(-9999, -9999);
  await wait(700);
  const away = await shot();

  // Parked: pointer arrives before the scroll and is never touched again.
  await goto(from);
  await wait(900);
  await setPointer(px, py);
  await wait(500);
  await goto(to);
  await wait(1100);
  const parked = await shot();
  writeFileSync(
    `${OUT}/parked-${(sel || 'all').replace(/\W/g, '')}-${from}-${to}.png`,
    Buffer.from(parked.split(',')[1], 'base64')
  );

  // Fresh: same place, but the pointer arrives after the scroll.
  await setPointer(-9999, -9999);
  await wait(600);
  await setPointer(px, py);
  await wait(800);
  const fresh = await shot();

  const mp = await measure(parked, away);
  const mf = await measure(fresh, away);
  const off =
    mp.n && mf.n ? Math.round(Math.hypot(mp.cx - mf.cx, mp.cy - mf.cy)) : null;
  const aim = mf.n ? Math.round(Math.hypot(mf.cx - px, mf.cy - py)) : null;
  rows.push({ mode: 'stale', sel, from, to, at: [px, py], parked: [mp.cx, mp.cy], fresh: [mf.cx, mf.cy], np: mp.n, nf: mf.n, off });
  console.log(
    tag.padEnd(24),
    'aim=(' + px + ',' + py + ')',
    'parked=(' + mp.cx + ',' + mp.cy + ') n=' + String(mp.n).padStart(5),
    'fresh=(' + mf.cx + ',' + mf.cy + ') n=' + String(mf.n).padStart(5),
    'parked-vs-fresh=' + off + 'px',
    'fresh-vs-aim=' + aim + 'px'
  );
}

const worst = rows.filter((r) => r.off !== null).reduce((a, r) => Math.max(a, r.off), 0);
console.log('\nworst misalignment:', worst + 'px');
writeFileSync(`${OUT}/report.json`, JSON.stringify(rows, null, 1));
console.log(errors.length ? errors.join('\n') : 'no errors');
await b.close();
