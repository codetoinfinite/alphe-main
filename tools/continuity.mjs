import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

// Is the field smooth, and is it a function of the scroll position?
//
// "Smooth" is not a thing you can eyeball from five screenshots at five
// stations — a jump is precisely the frame you did not sample. So this walks the
// whole page in small scroll steps and measures the visible cloud at each one,
// then looks at the differences between neighbouring steps. A cloud that moves
// continuously produces small, bounded deltas everywhere. A cloud that teleports
// produces one enormous delta at the step where it teleported, and that step is
// reported with the scroll position that caused it.
//
// The second question is settled by walking back up: if every visible property
// is a function of scrollY alone, the up-walk reproduces the down-walk sample
// for sample. Anything with its own timeline — a flight that has to land, a
// morph on a clock, a trigger that only fires one way — shows up here as
// hysteresis and nowhere else.
//
// Same two-shot diff as field-sweep: field visible minus field hidden, so what
// is measured is exactly what a reader can see.

const VW = Number(process.argv[2]) || 1440;
const VH = Number(process.argv[3]) || 900;
const STEP = Number(process.argv[4]) || 120;
const OUT = `/tmp/alphe-continuity${VW === 1440 ? '' : '-' + VW}`;
mkdirSync(OUT, { recursive: true });

const THRESHOLD = 10;
// A cloud drifting with a 120px scroll step moves by at most the step itself
// plus its own travel. Anything past this is not drift, it is a cut.
const JUMP_PX = 140;

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
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1800));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Everything that animates on its own is hidden for the whole run: the two
// frames of a sample are milliseconds apart and a marquee or a grain tile that
// advanced between them diffs just as brightly as a particle.
//
// The nav goes with them, and not because it moves on its own. It hides itself
// while the reader scrolls down and comes back when they scroll up, so it covers
// the top of the field in one direction and not the other. That is a real and
// deliberate thing the site does, but it is not the field, and left in it lands
// as a 67px band of pure direction-dependence in the column this run exists to
// read.
await p.evaluate(() => {
  const noise = ['.grain', '.cursor', '.marquee', '.nav', 'canvas:not([data-particles])'];
  for (const sel of noise) {
    for (const el of document.querySelectorAll(sel)) el.style.visibility = 'hidden';
  }

  // The console stage replays a request on a loop, which would land in the
  // stillness check as a page that will not sit still. It is frozen rather than
  // hidden, because its panels are opaque and sit above the field: hiding them
  // uncovers cloud that a reader never sees, which is the one thing this run is
  // measuring. Swapping in a clone leaves the module driving a node that is no
  // longer in the document while the page keeps a still, identical copy.
  const stage = document.querySelector('.console__stage');
  if (stage) stage.replaceWith(stage.cloneNode(true));
});

// Warm-up pass. Reveals and counters are one-shot: they fire the first time
// their section is seen and never again. Measured cold, the walk down catches
// them mid-flight and the walk back up finds them settled, which reads as the
// field disagreeing with itself when it is really the page that has changed
// underneath. One full pass fires every one of them before anything is
// measured, so both walks then see the same page.
{
  const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= max; y += 300) {
    await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
    await new Promise((r) => setTimeout(r, 120));
  }
  await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await new Promise((r) => setTimeout(r, 2500));
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
        if (py < y0) y0 = y0 < py ? y0 : py;
        if (py > y1) y1 = py;
      }
      return n
        ? { n, cx: Math.round(sx / n), cy: Math.round(sy / n), box: [x0, y0, x1, y1].map(Math.round) }
        : { n: 0, cx: null, cy: null, box: null };
    },
    a,
    c,
    THRESHOLD
  );

// Settle long enough for the opacity ramp — the one thing here that is still on
// a clock — to reach its target, so a sample is the field at rest at that scroll
// position rather than mid-fade.
//
// Then prove it. The whole method assumes the only thing that differs between
// the two frames is the particles; if anything else on the page moved between
// them it is counted as particles, and there is no way to tell from the number
// itself. So the field-off frame is taken twice, once either side, and the two
// are diffed against each other. That diff is everything the page did on its
// own while the sample was being taken, and it has to be nothing. When it is
// not, the sample is retried with a longer settle rather than believed.
const unsettled = [];

async function sampleAt(y, keep) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  for (let attempt = 0; ; attempt++) {
    await wait(700 + attempt * 900);
    await setField(false);
    const off1 = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
    await setField(true);
    const on = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
    await setField(false);
    const off2 = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
    await setField(true);
    const still = await measure(off1, off2);
    if (still.n <= 40 || attempt === 2) {
      if (still.n > 40) unsettled.push({ y, n: still.n, box: still.box });
      if (keep) writeFileSync(`${OUT}/${keep}.png`, Buffer.from(on.split(',')[1], 'base64'));
      const m = await measure(on, off2);
      return { y, ...m, still: still.n };
    }
  }
}

const maxScroll = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const stops = [];
for (let y = 0; y <= maxScroll; y += STEP) stops.push(y);
if (stops[stops.length - 1] !== maxScroll) stops.push(maxScroll);

console.log(`walking ${stops.length} stops of ${STEP}px down to ${maxScroll} at ${VW}x${VH}`);

const down = [];
for (let i = 0; i < stops.length; i++) {
  down.push(await sampleAt(stops[i], null));
}

console.log('walking back up');
const up = [];
for (let i = stops.length - 1; i >= 0; i--) {
  up.push(await sampleAt(stops[i], null));
}
up.reverse();

// --- continuity ------------------------------------------------------------
// Only compare steps where the cloud is actually visible at both ends. A step
// from dark to lit has no centroid to compare and is not a jump.
const LIT = 400;
const jumps = [];
let maxMove = 0;
for (let i = 1; i < down.length; i++) {
  const a = down[i - 1];
  const c = down[i];
  if (a.n < LIT || c.n < LIT) continue;
  const dx = c.cx - a.cx;
  const dy = c.cy - a.cy;
  const move = Math.round(Math.hypot(dx, dy));
  if (move > maxMove) maxMove = move;
  if (move > JUMP_PX) jumps.push({ from: a.y, to: c.y, move, dx, dy });
}

// --- reversibility ---------------------------------------------------------
let maxHyst = 0;
const hyst = [];
for (let i = 0; i < down.length; i++) {
  const a = down[i];
  const c = up[i];
  if (a.n < LIT || c.n < LIT) continue;
  const move = Math.round(Math.hypot(c.cx - a.cx, c.cy - a.cy));
  if (move > maxHyst) maxHyst = move;
  if (move > 40) hyst.push({ y: a.y, move });
}

// --- lit map ---------------------------------------------------------------
const litRuns = [];
let run = null;
for (const s of down) {
  const on = s.n >= LIT;
  if (!run || run.on !== on) {
    run = { on, from: s.y, to: s.y };
    litRuns.push(run);
  } else {
    run.to = s.y;
  }
}

console.log('\nlit map (px of scroll):');
for (const r of litRuns) console.log(' ', r.on ? 'LIT ' : 'dark', r.from, '->', r.to);

console.log('\nlargest centroid move between neighbouring stops:', maxMove, 'px (limit ' + JUMP_PX + ')');
if (jumps.length) {
  console.log('JUMPS:');
  for (const j of jumps) console.log('  ', j.from, '->', j.to, 'moved', j.move, 'px', j);
} else {
  console.log('no jumps');
}

console.log('\nlargest down/up disagreement at the same scroll position:', maxHyst, 'px');
if (hyst.length) {
  console.log('HYSTERESIS:');
  for (const h of hyst) console.log('  y=' + h.y, h.move + 'px');
} else {
  console.log('no hysteresis: the frame is a function of scroll position');
}

writeFileSync(
  `${OUT}/report.json`,
  JSON.stringify({ VW, VH, STEP, maxMove, maxHyst, jumps, hyst, litRuns, down, up }, null, 1)
);
if (unsettled.length) {
  console.log('\nSAMPLES TAKEN WHILE THE PAGE WAS STILL MOVING (counts unreliable):');
  for (const u of unsettled) console.log('  y=' + u.y, u.n + 'px', JSON.stringify(u.box));
} else {
  console.log('\nevery sample taken against a still page');
}

console.log('\n' + (errors.length ? errors.join('\n') : 'no errors'));
await b.close();
