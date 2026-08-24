// One element, shot at a given width, plus its console errors.
//
//   node tools/clip.mjs <selector> [width] [route] [pad]
import puppeteer from 'puppeteer-core';

const SEL = process.argv[2] || '#reach';
const W = Number(process.argv[3] || 1440);
const ROUTE = process.argv[4] || '/';
const PAD = Number(process.argv[5] || 24);

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));
await p.setViewport({ width: W, height: 900, deviceScaleFactor: 2 });
await p.goto('http://localhost:4322' + ROUTE, { waitUntil: 'networkidle0' });
// Centred by measured position rather than by offsetTop: the page has sticky
// cards and pinned sections, and two passes converge where one guess does not.
for (let i = 0; i < 3; i++) {
  const off = await p.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    const want = (innerHeight - r.height) / 2;
    scrollTo({ top: Math.max(0, scrollY + r.top - want), behavior: 'instant' });
    return Math.round(r.top - want);
  }, SEL);
  await new Promise((r) => setTimeout(r, 500));
  if (Math.abs(off) < 4) break;
}
await new Promise((r) => setTimeout(r, 1200));
console.log('scrollY', await p.evaluate(() => Math.round(scrollY)));

const el = await p.$(SEL);
if (!el) {
  console.log('no element for', SEL);
  await b.close();
  process.exit(1);
}
const box = await el.boundingBox();
const file = `/tmp/alphe-clip-${SEL.replace(/[^a-z0-9]+/gi, '-')}-${W}.png`;
// ElementHandle.screenshot, not page.screenshot({clip}): a page clip is taken in
// document coordinates once captureBeyondViewport is on, so a viewport-relative
// box lands somewhere else entirely on a scrolled page.
await el.screenshot({ path: file });
console.log(file, JSON.stringify({ w: Math.round(box.width), h: Math.round(box.height) }));
console.log(errs.length ? 'ERRORS: ' + [...new Set(errs)].join(' | ') : 'no console errors');
await b.close();
