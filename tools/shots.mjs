// Element shots: screenshots one element per file, at a chosen width.
//
//   node tools/shots.mjs <width> <route> <selector>...
//
// mobile.mjs walks a whole route in viewport steps, which is right for finding
// problems and wrong for looking at one of them. This shoots the element itself,
// after scrolling it into view and letting whatever it runs settle, so a section
// that only assembles once it is on screen is captured assembled.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const WIDTH = Number(process.argv[2]) || 390;
const ROUTE = process.argv[3] || '/';
const SELECTORS = process.argv.slice(4);
const OUT = `/tmp/alphe-shots${WIDTH}`;
mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });

const p = await b.newPage();
await p.setViewport({ width: WIDTH, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.goto((process.env.ALPHE_BASE || 'http://localhost:4322') + ROUTE, { waitUntil: 'networkidle0' });

for (const sel of SELECTORS) {
  const el = await p.$(sel);
  if (!el) { console.log(`${sel}  MISSING`); continue; }
  await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  // Long enough for the reveals, the counters and the console run to finish.
  await new Promise((r) => setTimeout(r, 4000));
  const name = sel.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const box = await el.boundingBox();
  await el.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${sel}  ${Math.round(box.width)}x${Math.round(box.height)}`);
}
await b.close();
