// Visual + behavioural check for the benchmarks section.
//
//   node tools/bench.mjs [width] [height]
//
// Shoots the section at rest and on each metric tab, reporting the geometry it
// measures rather than only saving pictures.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const W = Number(process.argv[2] || 1440);
const H = Number(process.argv[3] || 900);
const DIR = `/tmp/alphe-bench-${W}`;
mkdirSync(DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 700));

const sect = await page.$('#bench');
if (!sect) {
  console.log('FAIL: no #bench');
  await browser.close();
  process.exit(1);
}

// Scroll it into view and let the reveal + fill settle.
await page.evaluate(() => {
  document.querySelector('#bench').scrollIntoView({ block: 'start' });
});
await new Promise((r) => setTimeout(r, 1400));

// One probe, run on every tab. Everything it reports is a distance that has to
// stay positive: a column's ink must clear its neighbour's, the number over a
// column must stay inside the plot, and the front corner must sit on the rule
// the labels hang from.
const PROBE = () => {
  const stage = document.querySelector('[data-bench-rows]');
  const items = [...document.querySelectorAll('.ib')];
  const sr = stage.getBoundingClientRect();

  const cols = items.map((el) => {
    const faces = [...el.querySelectorAll('.ib__face')].map((f) => f.getBoundingClientRect());
    const meta = el.querySelector('.ib__meta').getBoundingClientRect();
    const plot = el.querySelector('.ib__plot').getBoundingClientRect();
    const value = el.querySelector('.ib__value').getBoundingClientRect();
    return {
      name: el.querySelector('.ib__name').textContent.trim(),
      v: el.querySelector('.ib__value').textContent.trim(),
      cell: el.getBoundingClientRect(),
      ink: {
        left: Math.min(...faces.map((f) => f.left)),
        right: Math.max(...faces.map((f) => f.right)),
        top: Math.min(...faces.map((f) => f.top)),
        bottom: Math.max(...faces.map((f) => f.bottom)),
      },
      value,
      meta,
      plot,
      lead: el.classList.contains('is-lead'),
      tail: el.classList.contains('is-tail'),
    };
  });

  // Reading order across the board: left to right, then down.
  const seen = [...cols].sort((a, b) => a.cell.top - b.cell.top || a.cell.left - b.cell.left);

  let gap = Infinity; // narrowest space between two columns' ink on one line
  let bleed = 0; // ink crossing another column's ink
  let labelGap = Infinity; // narrowest space between two printed numbers
  for (let i = 1; i < seen.length; i++) {
    const a = seen[i - 1];
    const b = seen[i];
    if (Math.abs(a.cell.top - b.cell.top) > 1) continue; // different line
    gap = Math.min(gap, b.ink.left - a.ink.right);
    bleed = Math.max(bleed, a.ink.right - b.ink.left);
    labelGap = Math.min(labelGap, b.value.left - a.value.right);
  }

  return {
    stageH: Math.round(sr.height),
    lines: new Set(cols.map((c) => Math.round(c.cell.top))).size,
    gap: Math.round(gap),
    bleed: Math.round(bleed),
    labelGap: Math.round(labelGap),
    // Space left above the tallest column's printed number.
    headroom: Math.round(Math.min(...cols.map((c) => c.value.top - c.plot.top))),
    // The front corner should land on the rule; positive means it hangs below.
    footFall: Math.round(Math.max(...cols.map((c) => c.ink.bottom - c.meta.top))),
    // Ink outside the stage's own box, either side.
    spill: Math.round(
      Math.max(0, sr.left - Math.min(...cols.map((c) => c.ink.left)), Math.max(...cols.map((c) => c.ink.right)) - sr.right)
    ),
    // A name clipped by its own clamp is fine; one taller than the label slot
    // is not, because the slot is what holds the columns to a common floor.
    metaOver: Math.round(
      Math.max(...cols.map((c) => c.meta.bottom - c.cell.bottom))
    ),
    marked: cols.filter((c) => c.lead).length + '/' + cols.filter((c) => c.tail).length,
    order: seen.map(
      (c) => `${c.v.padStart(8)}  ${c.lead ? '▲' : c.tail ? '▼' : ' '} ${c.name.padEnd(24)} ${Math.round(c.ink.bottom - c.ink.top)}px`
    ),
  };
};

const line = (g) =>
  `stage ${g.stageH} · ${g.lines} line(s) · gap ${g.gap} · bleed ${g.bleed} · labelGap ${g.labelGap} · headroom ${g.headroom} · foot ${g.footFall} · spill ${g.spill} · metaOver ${g.metaOver} · lead/tail ${g.marked}`;

const geo = await page.evaluate(PROBE);
const frame = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('.bench__tab')].map(
    (t) => `${Math.round(t.getBoundingClientRect().width)}/${t.scrollWidth}`
  ),
  benchW: Math.round(document.querySelector('.bench').getBoundingClientRect().width),
  docOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
}));

console.log(`— ${W}×${H} —`);
console.log('intelligence:', line(geo));
console.log('bench', frame.benchW, '| doc overflow', frame.docOverflow);
// A tab whose label is wider than its cell either clips or pushes the control
// past the panel, and both only show up at one width.
console.log('tabs box/text', frame.tabs.join(' '));
for (const l of geo.order) console.log('  ', l);

await page.screenshot({ path: `${DIR}/00-intelligence.png` });

for (const key of ['cost', 'speed', 'latency']) {
  await page.click(`[data-bench-tab="${key}"]`);
  await new Promise((r) => setTimeout(r, 1200));
  const state = await page.evaluate(PROBE);
  const on = await page.evaluate(() => ({
    on: [...document.querySelectorAll('.bench__tab.is-on')].map((t) => t.dataset.benchTab),
    caption: document.querySelector('[data-bench-caption]').textContent.trim().slice(0, 44),
  }));
  console.log(`\n${key}: on=${on.on}`);
  console.log('  ', line(state));
  console.log('  caption:', on.caption + '…');
  for (const l of state.order) console.log('   ', l);
  await (await page.$('.bench')).screenshot({ path: `${DIR}/01-${key}.png` });
}

// The whole panel, not a viewport crop: two rows of columns do not always fit
// on one screen and the part that falls off is the part nobody checks.
await page.click('[data-bench-tab="intelligence"]');
await new Promise((r) => setTimeout(r, 900));
await (await page.$('.bench')).screenshot({ path: `${DIR}/02-board-full.png` });

console.log('\nerrors:', errors.length ? errors : 'none');
console.log('shots in', DIR);
await browser.close();
