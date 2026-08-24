import puppeteer from 'puppeteer-core';

// What room is actually left for a placed shape at one scroll position: the
// viewport rects of the things it must not sit on top of. Placement offsets are
// tuned by hand, and tuning them against a guess at the layout is how a shape
// ends up half behind a card.
//
// node tools/space.mjs <scrollY> [selectors,comma,separated]

const Y = Number(process.argv[2]) || 0;
const SEL = (
  process.argv[3] ||
  '.section-title,.eyebrow,.stack__rail-inner,.card,.card__strip'
).split(',');

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));

const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
for (let y = 0; y <= max; y += 300) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 80));
}
await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), Y);
await new Promise((r) => setTimeout(r, 1200));

const rows = await p.evaluate((sels) => {
  const out = [];
  const range = document.createRange();
  for (const sel of sels) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > innerHeight + 200) continue;
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      out.push({
        sel,
        box: [r.left, r.top, r.right, r.bottom].map(Math.round),
        text: t.width ? [t.left, t.top, t.right, t.bottom].map(Math.round) : null,
      });
    }
  }
  return out;
}, SEL);

for (const r of rows) {
  console.log(
    r.sel.padEnd(22),
    'box=' + JSON.stringify(r.box).padEnd(26),
    r.text ? 'text=' + JSON.stringify(r.text) : ''
  );
}
await b.close();
