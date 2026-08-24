import puppeteer from 'puppeteer-core';

// Which canvas is drawing what, at one scroll position, approached from above
// and from below. The whole-page diff says the frame differs by direction but
// cannot say which of the three canvases is responsible, so this isolates each
// one: hide the other two, diff, repeat.

const VW = 1440;
const VH = 900;
const THRESHOLD = 10;
const TARGETS = process.argv.slice(2).map(Number);

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: VW, height: VH });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1600));

await p.evaluate(() => {
  for (const sel of ['.grain', '.cursor', '.marquee', 'canvas:not([data-particles])']) {
    for (const el of document.querySelectorAll(sel)) el.style.visibility = 'hidden';
  }
  const css = document.createElement('style');
  css.textContent = '[data-reveal]{transition:none!important}';
  document.head.appendChild(css);
  for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-revealed');
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (only) =>
  p.evaluate((idx) => {
    const cs = document.querySelectorAll('[data-particles]');
    cs.forEach((c, i) => {
      c.style.visibility = idx === -2 ? 'hidden' : idx === -1 || i === idx ? '' : 'hidden';
    });
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, only);

const measure = (a, c) =>
  p.evaluate(
    async (aSrc, bSrc, thr) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(aSrc), load(bSrc)]);
      const cv = document.createElement('canvas');
      cv.width = ia.width;
      cv.height = ia.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(ia, 0, 0);
      const A = g.getImageData(0, 0, cv.width, cv.height).data;
      g.clearRect(0, 0, cv.width, cv.height);
      g.drawImage(ib, 0, 0);
      const B = g.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      let x0 = 1e9;
      let y0 = 1e9;
      let x1 = -1e9;
      let y1 = -1e9;
      for (let i = 0; i < A.length; i += 4) {
        const d =
          Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d < thr * 3) continue;
        const px = (i / 4) % cv.width;
        const py = ((i / 4) / cv.width) | 0;
        n++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
      return n ? { n, box: [x0, y0, x1, y1].map(Math.round) } : { n: 0, box: null };
    },
    a,
    c,
    THRESHOLD
  );

const names = await p.evaluate(() =>
  Array.from(document.querySelectorAll('[data-particles]')).map((c) => c.className)
);

async function at(y, from) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), from);
  await wait(900);
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await wait(900);
  await show(-2);
  const off = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
  const out = [];
  for (let i = 0; i < names.length; i++) {
    await show(i);
    const on = 'data:image/png;base64,' + (await p.screenshot({ encoding: 'base64' }));
    out.push(await measure(on, off));
  }
  await show(-1);
  return out;
}

for (const y of TARGETS) {
  const above = await at(y, Math.max(0, y - 800));
  const below = await at(y, y + 800);
  console.log('\n=== y=' + y + ' ===');
  for (let i = 0; i < names.length; i++) {
    console.log(
      names[i].padEnd(28),
      'fromAbove n=' + String(above[i].n).padStart(6),
      JSON.stringify(above[i].box).padEnd(26),
      'fromBelow n=' + String(below[i].n).padStart(6),
      JSON.stringify(below[i].box)
    );
  }
}
await b.close();
