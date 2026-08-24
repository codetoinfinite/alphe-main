import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

// A magnified crop of one region at one scroll position. For questions about a
// few square centimetres — is that dot in front of the glyph or behind it —
// where a full frame at 1440 is too coarse to answer.
//
// node tools/zoom.mjs <scrollY> <x> <y> <w> <h> [scale] [url]

const Y = Number(process.argv[2]) || 0;
const [X, TOP, W, H] = process.argv.slice(3, 7).map(Number);
const SCALE = Number(process.argv[7]) || 3;
const URL = process.argv[8] || 'http://localhost:4322/';
const OUT = '/tmp/alphe-zoom';
mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: SCALE });
await p.goto(URL, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1400));

const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
for (let y = 0; y <= max; y += 300) {
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 90));
}
await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), Y);
await new Promise((r) => setTimeout(r, 1600));

// screenshot clip is in page coordinates, not viewport coordinates, so the
// crop has to be offset by the scroll position the caller asked for.
const file = `${OUT}/y${Y}-${X}x${TOP}.png`;
await p.screenshot({ path: file, clip: { x: X, y: Y + TOP, width: W, height: H } });
console.log(file);
await b.close();
