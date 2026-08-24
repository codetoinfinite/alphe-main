import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// The sweep proves where the field ends up. This proves how it gets there.
//
// For each pair of neighbouring stations it jumps to the exact scroll position
// where the handoff fires and photographs the flight at 0.15s, 0.5s, 1.0s and
// 1.8s. A flight that is still in mid-air at 1.8s is too slow; one that is
// already landed at 0.15s snapped instead of flying; one that starts from the
// wrong place has lost its snapshot.
//
// Nothing is hidden here — grain, marquee and the orbit rings all render, so
// these frames are what a reader actually sees.

const OUT = '/tmp/alphe-handoff';
mkdirSync(OUT, { recursive: true });

const VW = 1440;
const VH = 900;
const ENTER_LINE = 0.75;

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: VW, height: VH });
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1800));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const to = (y) => p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), Math.max(0, Math.round(y)));

const stations = await p.evaluate(() =>
  Array.from(document.querySelectorAll('[data-field-shape]')).map((el) => {
    const a = el.querySelector('[data-field-anchor], [data-avoid], .section-title, h1, h2') || el;
    return { shape: el.dataset.fieldShape, anchorTop: Math.round(a.getBoundingClientRect().top + scrollY) };
  })
);

for (let i = 1; i < stations.length; i++) {
  const s = stations[i];
  const tag = `${i}-${stations[i - 1].shape}-to-${s.shape}`;
  // Two pixels past the line, so the frame that fires the handoff is the first
  // one after the jump rather than one lost to rounding.
  const y = s.anchorTop - VH * ENTER_LINE + 2;
  await to(0);
  await wait(900);
  await to(y);
  let t = 0;
  for (const at of [150, 500, 1000, 1800]) {
    await wait(at - t);
    t = at;
    await p.screenshot({ path: `${OUT}/${tag}-${at}ms.png` });
  }
  console.log(tag.padEnd(28), 'y=' + Math.round(y));
}

console.log(errors.length ? errors.join('\n') : 'no errors');
await b.close();
