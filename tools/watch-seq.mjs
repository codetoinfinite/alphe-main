// Walks one full run of the routing console and reports what the stage was
// doing on every beat, then captures a frame of each intake step.
//
//   node tools/watch-seq.mjs [width]
//
// Two things are being checked. First the intake order: the catalogue arrives
// in classify, then candidates, then dispatch, one card at a time — two cards up
// at once is a failure, not a variation, and this is what proves the sweep is a
// series. Second that it is a sweep at all: it plays once, on the way in, and
// the ~12.6s loop after it must never deal the catalogue again.
//
// So pass 1 has to be watching before the observer starts the run — the whole
// sweep is over in under three seconds and there is no second take.
//
// The frames are captured in a second pass, one page load per card, because a
// screenshot of a ~3000px stage takes longer than the beat it is sampling:
// shooting inline lands on the hand-over instead, where the pool is mid-fade,
// and reads it as a missing catalogue. So the run is frozen on the wanted beat
// first and photographed at leisure.
import puppeteer from 'puppeteer-core';

const W = Number(process.argv[2] || 1440);

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const errs = [];

// One instant scroll and straight into sampling. The observer starts the run
// the moment the stage crosses into view, and the sweep is over inside three
// seconds and never comes back — so anything that settles the scroll first,
// however briefly, is watching a run that has already moved on. Framing is left
// to elementHandle.screenshot, which scrolls the shot into view by itself.
async function open() {
  const p = await b.newPage();
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
  await p.setViewport({ width: W, height: 900, deviceScaleFactor: 1 });
  await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
  await p.evaluate(() => {
    const r = document.querySelector('#watch .console__stage').getBoundingClientRect();
    scrollTo({ top: Math.max(0, scrollY + r.top - (innerHeight - r.height) / 2), behavior: 'instant' });
  });
  return p;
}

// Fully up, not merely classed: a card carries is-intake through its own fade
// out too, so the class alone cannot tell the sweep from the hand-over.
const state = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('[data-panel]')].map((el) => {
      const pool = el.querySelector('.pool');
      return {
        name: el.dataset.panel,
        intake: el.classList.contains('is-intake'),
        live: el.classList.contains('is-live'),
        opacity: pool ? Number(getComputedStyle(pool).opacity).toFixed(2) : 'none',
        running: pool ? getComputedStyle(pool.querySelector('.pool__col')).animationName : 'none',
      };
    })
  );

const key = (s) =>
  s.map((v) => `${v.name}:${v.intake ? 'I' : v.live ? 'L' : '-'}${v.opacity}`).join(' ');
const up = (s) => s.filter((v) => v.intake && v.opacity === '1.00').map((v) => v.name);

// Pass 1 — the order, sampled without ever blocking the page.
const walk = await open();
const t0 = Date.now();
const seen = [];
let last = '';
while (Date.now() - t0 < 22000) {
  const s = await state(walk);
  const k = key(s);
  if (k !== last) {
    last = k;
    seen.push(`${String(Date.now() - t0).padStart(5)}ms  ${k}`);
  }
  await new Promise((r) => setTimeout(r, 120));
}
console.log(seen.join('\n'));
await walk.close();

// Pass 2 — one frozen frame per step. clearTimeout across the whole id space is
// blunt, but it is exactly what is wanted here: every pending beat on the page
// stops and the DOM keeps the state it was in. CSS keeps animating, so the
// columns are still in motion in the frame.
const shots = [];
for (const name of ['classify', 'candidates', 'dispatch']) {
  const p = await open();
  const t = Date.now();
  let hit = false;
  while (Date.now() - t < 25000) {
    const lit = up(await state(p));
    // Exactly this one, and nothing else with it.
    if (lit.length === 1 && lit[0] === name) {
      await p.evaluate(() => {
        for (let i = 1; i < 5000; i += 1) clearTimeout(i);
      });
      hit = true;
      break;
    }
  }
  if (hit) {
    const file = `/tmp/alphe-watch-intake-${name}-${W}.png`;
    await (await p.$('#watch .console__stage')).screenshot({ path: file });
    shots.push(file);
    console.log(`${name.padEnd(11)} ${key(await state(p))}`);
  } else {
    console.log(`${name.padEnd(11)} NEVER REACHED ALONE`);
  }
  await p.close();
}

console.log('shots', shots.join(' '));
console.log(errs.length ? 'ERRORS: ' + [...new Set(errs)].join(' | ') : 'no console errors');
await b.close();
