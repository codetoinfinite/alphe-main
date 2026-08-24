import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// Screenshots one section at a time. Full-page captures of a 10k-pixel document
// are unreadable; scrolling each section into view also lets its reveal and
// in-view animations actually run before the shutter.

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || '/tmp/alphe-sections';
const URL = process.env.URL || 'http://localhost:4322/';
const WIDTH = Number(process.env.WIDTH || 1440);
const HEIGHT = Number(process.env.HEIGHT || 900);
const TAG = process.env.TAG || 'home';

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto(URL, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));

const count = await page.evaluate(() => document.querySelectorAll('main > section').length);

for (let i = 0; i < count; i++) {
  await page.evaluate((n) => {
    document.querySelectorAll('main > section')[n].scrollIntoView({ block: 'start' });
  }, i);
  await new Promise((r) => setTimeout(r, 1400));
  await page.screenshot({ path: `${OUT}/${TAG}-${String(i).padStart(2, '0')}.png` });
}

console.log(`${TAG}: ${count} sections → ${OUT}`);
await browser.close();
