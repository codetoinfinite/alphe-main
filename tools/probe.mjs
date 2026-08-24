import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2000));

console.log(
  JSON.stringify(
    await page.evaluate(() => {
      return [...document.querySelectorAll('canvas')].map((c) => {
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return {
          cls: c.className,
          attr: [c.width, c.height],
          rect: [Math.round(r.width), Math.round(r.height)],
          pos: cs.position,
          inset: [cs.top, cs.right, cs.bottom, cs.left],
          display: cs.display,
          parent: c.parentElement.className || c.parentElement.tagName,
          parentPos: getComputedStyle(c.parentElement).position,
        };
      });
    }),
    null,
    1
  )
);

await browser.close();
