// Close-up of single columns so the edge treatment can actually be judged.
// node tools/bench-zoom.mjs [width] [scale]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const W = Number(process.argv[2] || 1440);
const SCALE = Number(process.argv[3] || 3);
const OUT = `/tmp/alphe-bench-zoom-${W}`;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: 900, deviceScaleFactor: SCALE });
await page.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await page.evaluate(() => document.querySelector('#bench').scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 1600));
// The cursor follower renders in headless because puppeteer reports a fine
// pointer; it is not part of the chart.
await page.evaluate(() => {
  document.querySelectorAll('.cursor').forEach((el) => (el.style.display = 'none'));
});

const picks = [
  ['lead', '.ib.is-lead'],
  ['tail', '.ib.is-tail'],
  ['plain', '.bench__stage .ib:nth-child(4)'],
];
for (const [name, sel] of picks) {
  const el = await page.$(sel);
  if (!el) continue;
  // The .ib is a full column pitch wide, so an element shot already carries
  // margin around the prism.
  await el.screenshot({ path: `${OUT}/${name}.png` });
}
console.log(`shots in ${OUT}`);
await browser.close();
