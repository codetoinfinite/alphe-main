// Mobile survey: walks a route in viewport-sized steps and shoots each one.
//
//   node tools/mobile.mjs [width] [outDir] [route...]
//
// Full-page screenshots of this site are 17,000px tall and unreadable. Stepping
// the scroll instead gives frames that look like what a thumb actually sees, and
// the particle field only settles when the page has actually been scrolled there.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const WIDTH = Number(process.argv[2]) || 390;
const OUT = process.argv[3] || `/tmp/alphe-m${WIDTH}`;
const ROUTES = process.argv.slice(4).length
  ? process.argv.slice(4)
  : ['/', '/platform/', '/pricing/', '/docs/', '/about/', '/contact/'];
mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });

const HEIGHT = 844;
for (const route of ROUTES) {
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto((process.env.ALPHE_BASE || 'http://localhost:4322') + route, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));

  const slug = route.replace(/[^a-z0-9]+/gi, '') || 'home';
  const { docHeight, overflow } = await p.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    // Anything sticking out past the viewport horizontally, named, so a report
    // says which element is doing it rather than that something is.
    overflow: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 12)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(r.right)}`;
      }),
  }));

  const steps = Math.ceil(docHeight / HEIGHT);
  for (let i = 0; i < steps; i++) {
    await p.evaluate((y) => window.scrollTo(0, y), i * HEIGHT);
    await new Promise((r) => setTimeout(r, 900));
    await p.screenshot({ path: `${OUT}/${slug}-${String(i).padStart(2, '0')}.png` });
  }
  console.log(`${route} h=${docHeight} frames=${steps}` +
    (overflow.length ? `\n  OVERFLOW: ${overflow.join(', ')}` : '') +
    (errs.length ? `\n  ERRORS: ${errs.join(' | ')}` : ''));
  await p.close();
}
await b.close();
