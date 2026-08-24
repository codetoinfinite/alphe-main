import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || '/tmp/alphe-research';
const URL = process.env.URL || 'http://localhost:4322/';
const WIDTH = Number(process.env.WIDTH || 1440);
const HEIGHT = Number(process.env.HEIGHT || 900);

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await page.goto(URL, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));

await page.evaluate(() => document.querySelector('#research').scrollIntoView({ block: 'start' }));
await new Promise((r) => setTimeout(r, 1800));

const state = () =>
  page.evaluate(() => {
    const root = document.querySelector('[data-bench="research"]');
    return {
      ready: root.classList.contains('is-ready'),
      live: root.classList.contains('is-live'),
      on: root.querySelector('.bench__tab.is-on')?.textContent.trim(),
      caption: root.querySelector('[data-bench-caption]').textContent.trim().slice(0, 60),
      cols: [...root.querySelectorAll('.ib')]
        .map((el) => ({
          name: el.querySelector('.ib__name').textContent.trim(),
          v: el.querySelector('.ib__value').textContent.trim(),
          k: +el.style.getPropertyValue('--k'),
          x: +parseFloat(el.style.getPropertyValue('--x')),
          lead: el.classList.contains('is-lead'),
          tail: el.classList.contains('is-tail'),
        }))
        .sort((a, b) => a.x - b.x)
        .map((c) => `${c.x.toFixed(0)} ${c.name} ${c.v} k=${c.k.toFixed(2)}${c.lead ? ' LEAD' : ''}${c.tail ? ' TAIL' : ''}`),
    };
  });

const tabs = await page.$$('[data-bench="research"] [data-bench-tab]');
console.log('tabs', tabs.length);

for (let i = 0; i < tabs.length; i++) {
  if (i) {
    await tabs[i].click();
    await new Promise((r) => setTimeout(r, 1100));
  }
  const s = await state();
  console.log(`\n--- ${i}: ${s.on} · ready=${s.ready} live=${s.live}`);
  console.log('   ', s.caption);
  for (const c of s.cols) console.log('   ', c);
  const el = await page.$('#research');
  await el.screenshot({ path: `${OUT}/tab-${i}-${s.on.toLowerCase().replace(/\W+/g, '-')}.png` });
}

// Narrow fold: five columns become three-and-two under 880.
for (const w of [880, 560, 380]) {
  await page.setViewport({ width: w, height: 900 });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => document.querySelector('#research').scrollIntoView({ block: 'start' }));
  await new Promise((r) => setTimeout(r, 1200));
  const el = await page.$('#research');
  await el.screenshot({ path: `${OUT}/w${w}.png` });
  const cols = await page.evaluate(() =>
    getComputedStyle(document.querySelector('[data-bench="research"] .bench__stage')).getPropertyValue('--cols').trim()
  );
  console.log(`w${w} --cols ${cols}`);
}

await browser.close();
console.log('\nout', OUT);
