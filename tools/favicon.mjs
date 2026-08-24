// Generates the tab icons from the alphe mark.
//
//   node tools/favicon.mjs
//
// Writes site/media/favicon.svg, favicon.ico and apple-touch-icon.png.
//
// The mark alone, unpadded and untinted, is a thin white diagonal figure: on a
// light tab strip it disappears, and at 16px its strokes close up. So the icon
// is the mark held on the site's own ground at a size that survives the smallest
// slot a browser will draw it in, which is also what makes it read as this site
// rather than as a generic glyph.
//
// Two rasters and one vector, because the three places an icon is asked for want
// different things: Safari and the older engines take the .ico, everything
// current prefers the .svg and scales it, and iOS takes a square PNG it masks
// itself, which is why the touch icon is full-bleed and the other two are
// rounded.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const MEDIA = fileURLToPath(new URL('../site/media/', import.meta.url));
const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const BG = '#08090a'; // --bg
const FG = '#f4f5f6'; // --fg

// The mark, straight out of media/logo-white.svg, in its own 910.73x1000 box.
const MARK =
  'M903.3 1000L719.03 1000L340.6 461.51C336.27 455.35 333.92 453.13 327.46 458.6L294.62 486.44C236.27 535.9 185.2 603.03 164.33 677.73C159.9 693.61 154.16 714.15 154.13 729.55L153.58 1000L0 1000L0.58 726C0.61 711.3 5.08 690.88 8 674.91C22.93 593.44 60.89 516.12 113.9 452.52C126.77 437.07 140.93 416.84 154.89 404.47L237.42 331.32C242.53 326.79 246.47 328.13 240.53 319.64L16.86 0L202.41 0L571.44 525.77C575.83 532.03 578.47 533.77 584.57 528.46L632.13 487.07C690.14 436.58 736.35 361.51 752.16 285.61C753.92 277.16 756.93 264.86 756.95 257.4L757.66 0L910.73 0L910.72 261.97C910.72 273.87 906.53 291.28 904.54 304.7C890.81 397.78 841.41 486.87 778.38 555.75C768.01 567.09 756.45 583.41 746.27 592.3L673.7 655.65C668.29 660.37 665.4 659.48 671.03 667.53L903.3 1000Z';

// 64% of the box: enough padding that the corner radius never crowds the mark,
// enough size that the diagonals still separate at 16px.
const H = 512 * 0.64;
const W = H * (910.73 / 1000);

const icon = (rx) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rx}" fill="${BG}"/>
  <g transform="translate(${((512 - W) / 2).toFixed(2)} ${((512 - H) / 2).toFixed(2)}) scale(${(H / 1000).toFixed(5)})">
    <path d="${MARK}" fill="${FG}"/>
  </g>
</svg>`;

const ROUNDED = icon(96);
const SQUARE = icon(0);

await writeFile(join(MEDIA, 'favicon.svg'), `${ROUNDED}\n`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

// Rasterise at the exact pixel size rather than scaling one big render down:
// the browser's own vector rasteriser is what the icon has to survive anyway.
async function raster(svg, size) {
  const p = await browser.newPage();
  await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await p.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    { waitUntil: 'load' },
  );
  const png = await p.screenshot({ omitBackground: true });
  await p.close();
  return png;
}

const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) pngs.push(await raster(ROUNDED, s));
await writeFile(join(MEDIA, 'apple-touch-icon.png'), await raster(SQUARE, 180));
await browser.close();

// ICO is a 6-byte header, one 16-byte directory entry per image, then the
// images. The entries carry PNG rather than BMP, which every engine still in
// use reads and which keeps the file a fraction of the size.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + pngs.length * 16;
const dir = [];
for (let i = 0; i < pngs.length; i++) {
  const e = Buffer.alloc(16);
  e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 0);
  e.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], 1);
  e.writeUInt8(0, 2); // palette size, 0 for truecolour
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  dir.push(e);
}
await writeFile(join(MEDIA, 'favicon.ico'), Buffer.concat([header, ...dir, ...pngs]));

console.log(execFileSync('ls', ['-l', join(MEDIA, 'favicon.svg'), join(MEDIA, 'favicon.ico'), join(MEDIA, 'apple-touch-icon.png')], { encoding: 'utf8' }));
console.log(execFileSync('file', [join(MEDIA, 'favicon.ico')], { encoding: 'utf8' }));
