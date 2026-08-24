import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// Same walk as stations.mjs, at a width below the placement breakpoint, to
// confirm the `reach` term collapses every offset back to centred.
const OUT = '/tmp/alphe-stations-narrow';
mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1600));

const stations = await p.evaluate(() =>
  Array.from(document.querySelectorAll('[data-field-shape]')).map((el) => ({
    shape: el.dataset.fieldShape,
    top: el.getBoundingClientRect().top + scrollY,
  }))
);

let i = 0;
for (const s of stations) {
  await p.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), Math.max(0, s.top - 100));
  await new Promise((r) => setTimeout(r, 2600));
  const name = String(i).padStart(2, '0') + '-' + s.shape.replace(/[^a-z0-9]/gi, '_');
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log(name);
  i++;
}

console.log(errors.length ? errors : 'no errors');
await b.close();
