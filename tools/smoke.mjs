import puppeteer from 'puppeteer-core';

// Cheapest possible question, asked before any of the slow measuring tools run:
// does the page load and scroll without throwing? A syntax error or a dead
// reference in the field module shows up here in seconds instead of forty
// minutes into a sweep.

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// Every route, not only the home page: a page that ships its own section markup
// can break the shared modules on its own, and /docs/ is long enough to be the
// one that finds it.
const ROUTE = process.env.ALPHE_ROUTE || '/';
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
p.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
await p.goto((process.env.ALPHE_BASE || 'http://localhost:4322') + ROUTE, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));

const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
for (let y = 0; y <= max; y += 400) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 90));
}
for (let y = max; y >= 0; y -= 400) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 90));
}
await new Promise((r) => setTimeout(r, 600));

const state = await p.evaluate(() => ({
  maxScroll: document.documentElement.scrollHeight - innerHeight,
  canvases: Array.from(document.querySelectorAll('[data-particles]')).map((c) => ({
    cls: c.className,
    pos: getComputedStyle(c).position,
    w: c.width,
    h: c.height,
    opacity: +getComputedStyle(c).opacity,
  })),
  stations: Array.from(document.querySelectorAll('[data-field-shape]')).map((el) => el.dataset.fieldShape),
}));

console.log(JSON.stringify(state, null, 1));
console.log(errors.length ? errors.join('\n') : 'no errors');
await b.close();
