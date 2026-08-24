import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// Width is an argument because placement is a function of it: the offsets ramp
// in between the single-column breakpoint and the settled two-column layout, and
// the in-between widths are exactly where a shape can end up half in the copy.
const VW = Number(process.argv[2]) || 1440;
const VH = Number(process.argv[3]) || 900;

const OUT = `/tmp/alphe-stations${VW === 1440 ? '' : '-' + VW}`;
mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const p = await b.newPage();
await p.setViewport({ width: VW, height: VH });
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1600));

const stations = await p.evaluate(() =>
  Array.from(document.querySelectorAll('[data-field-shape]')).map((el) => {
    const a = el.querySelector('[data-field-anchor], [data-avoid], .section-title, h1, h2') || el;
    return {
      shape: el.dataset.fieldShape,
      anchorTop: a.getBoundingClientRect().top + scrollY,
    };
  })
);

let i = 0;
for (const s of stations) {
  // The hold position: where the headline sits at the viewport fraction every
  // data-field-x/y was tuned against, so this is the shape at its composed spot.
  await p.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), Math.max(0, s.anchorTop - VH * 0.354));
  await new Promise((r) => setTimeout(r, 2600));
  const active = await p.evaluate(() => document.documentElement.scrollTop);
  const name = String(i).padStart(2, '0') + '-' + s.shape.replace(/[^a-z0-9]/gi, '_');
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name, 'scrollY', active);
  i++;
}

console.log(errors.length ? errors : 'no errors');
await b.close();
