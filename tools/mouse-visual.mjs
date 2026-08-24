import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// Is the hole under the pointer? Draws a crosshair at the exact client position
// the pointer was put at and photographs the field around it, so the answer is
// read rather than inferred from a centroid — which, in a cloud that is dense on
// one side of the pointer and empty on the other, is pulled off the pointer by
// the cloud and cannot answer this.
//
// Field frozen via reduced motion so the shape is the composed one and the only
// thing bending it is the cursor.

const OUT = '/tmp/alphe-mouse-visual';
mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1600);

await p.evaluate(() => {
  for (const sel of ['.grain', '.cursor', '.marquee', '.nav']) {
    for (const el of document.querySelectorAll(sel)) el.style.visibility = 'hidden';
  }
});
{
  const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= max; y += 300) {
    await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
    await wait(110);
  }
  await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await wait(2000);
  await p.evaluate(() => {
    const css = document.createElement('style');
    css.textContent = '[data-reveal]{transition:none!important}';
    document.head.appendChild(css);
    for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-revealed');
  });
}

const setPointer = (x, y) =>
  p.evaluate(
    (cx, cy) =>
      new Promise((r) => {
        const t = document.elementFromPoint(cx, cy) || document.documentElement;
        t.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true }));
        requestAnimationFrame(() => requestAnimationFrame(r));
      }),
    x,
    y
  );

const crosshair = (x, y) =>
  p.evaluate(
    (cx, cy) => {
      document.getElementById('__xh')?.remove();
      const d = document.createElement('div');
      d.id = '__xh';
      d.style.cssText =
        'position:fixed;z-index:99999;pointer-events:none;left:0;top:0;width:100%;height:100%';
      d.innerHTML =
        `<div style="position:absolute;left:${cx}px;top:0;width:1px;height:100%;background:#ff2d55;opacity:.85"></div>` +
        `<div style="position:absolute;top:${cy}px;left:0;height:1px;width:100%;background:#ff2d55;opacity:.85"></div>` +
        `<div style="position:absolute;left:${cx - 153}px;top:${cy - 153}px;width:306px;height:306px;border:1px dashed #ff2d55;border-radius:50%;opacity:.8"></div>`;
      document.body.appendChild(d);
    },
    x,
    y
  );

// Scroll position, pointer position, label. Pointer placed over each station's
// shape where the reader's hand would plausibly be.
const CASES = [
  [0, 720, 430, 'hero-logo'],
  [600, 980, 470, 'cursor-shape'],
  [300, 700, 400, 'hero-front-midleg'],
  [3626, 1000, 430, 'orbits'],
  [6414, 1080, 470, 'square'],
];

for (const [y, px, py, label] of CASES) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await wait(1500);
  // Pointer away first: the shape as composed. Without this pair a ring-shaped
  // station looks exactly like a repulsion void and the frame proves nothing.
  await setPointer(-9999, -9999);
  await wait(900);
  await crosshair(px, py);
  await wait(150);
  await p.screenshot({ path: `${OUT}/${label}-y${y}-a-away.png` });
  await setPointer(px, py);
  await wait(900);
  await crosshair(px, py);
  await wait(150);
  await p.screenshot({ path: `${OUT}/${label}-y${y}-b-under.png` });
  console.log(label, 'scroll=' + y, 'pointer=(' + px + ',' + py + ')');
}

console.log(errors.length ? errors.join('\n') : 'no errors');
await b.close();
