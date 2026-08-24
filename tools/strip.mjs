import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// A run of real frames across one stretch of scroll, as a reader would see them,
// with nothing hidden. The measuring tools strip the page down to isolate the
// particles; this one leaves it exactly as shipped, because the question it
// answers is the only one a number cannot: does it look right.

const FROM = Number(process.argv[2]) || 0;
const TO = Number(process.argv[3]) || 900;
const N = Number(process.argv[4]) || 8;
const VW = Number(process.argv[5]) || 1440;
const VH = Number(process.argv[6]) || 900;
const OUT = `/tmp/alphe-strip-${FROM}-${TO}`;
mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: VW, height: VH });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1600));

// Warm the one-shot reveals and counters so the strip shows the page in the
// state a reader who has scrolled here actually sees, not a half-built one.
const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
for (let y = 0; y <= max; y += 300) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 110));
}
await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
await new Promise((r) => setTimeout(r, 2000));

for (let i = 0; i < N; i++) {
  const y = Math.round(FROM + ((TO - FROM) * i) / (N - 1));
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 1400));
  await p.screenshot({ path: `${OUT}/${String(i).padStart(2, '0')}-y${y}.png` });
  console.log('y=' + y);
}
await b.close();
