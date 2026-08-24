import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Base URL of the dev server. Overridable so a second checkout can run the
// gates against its own `PORT=4323 node serve.mjs` instead of whichever tree
// happens to hold port 4322.
const BASE = (process.env.ALPHE_BASE || 'http://localhost:4322');
const OUT = process.env.OUT || '/tmp/alphe-shots';
const ROUTES = ['/', '/platform/', '/pricing/', '/docs/', '/about/', '/contact/'];

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'shell' in globalThis ? true : 'new',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--hide-scrollbars',
  ],
});

let failures = 0;

for (const route of ROUTES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const consoleErrors = [];
  const pageErrors = [];
  const netFails = [];

  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('requestfailed', (r) => netFails.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) netFails.push(`${r.url()} HTTP ${r.status()}`);
  });

  await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));

  const report = await page.evaluate(() => {
    const canvasStat = (c) => {
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const two = !gl ? c.getContext('2d') : null;
      const out = { cls: c.className || c.dataset.dither !== undefined ? c.className : '(none)', w: c.width, h: c.height, ctx: gl ? 'webgl' : two ? '2d' : 'none', lit: null };
      if (gl) {
        const px = new Uint8Array(c.width * c.height * 4);
        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let lit = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 8) lit++;
        out.lit = lit;
      } else if (two) {
        const d = two.getImageData(0, 0, c.width, c.height).data;
        let lit = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
        out.lit = lit;
      }
      return out;
    };

    // Anything fixed/sticky, spanning the full width, sitting at the top of the
    // viewport and only a few pixels tall — i.e. a scroll-progress bar.
    const progressBars = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.top <= 4 && r.height > 0 && r.height <= 10 && r.width > innerWidth * 0.5) {
        progressBars.push(el.tagName + '.' + el.className);
      }
    }

    return {
      title: document.title,
      docHeight: document.documentElement.scrollHeight,
      hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      canvases: [...document.querySelectorAll('canvas')].map(canvasStat),
      progressBars,
      revealed: document.querySelectorAll('.is-revealed').length,
      splitChars: document.querySelectorAll('.split-char').length,
      marqueeGroups: document.querySelectorAll('.marquee__group').length,
      agents: document.querySelectorAll('.agent').length,
      activeAgent: document.querySelector('.agent.is-active')?.textContent.trim().slice(0, 20) || null,
      meshValue: document.querySelector('[data-mesh-value]')?.textContent || null,
      calcSpend: document.querySelector('[data-calc-spend]')?.textContent || null,
      calcSaved: document.querySelector('[data-calc-saved]')?.textContent || null,
      stackCards: document.querySelectorAll('[data-stack] .card').length,
      stackActive: document.querySelector('[data-stack-jump].is-on')?.textContent.replace(/\s+/g, ' ').trim() || null,
      fontsLoaded: document.fonts.status,
    };
  });

  await page.screenshot({ path: `${OUT}/${route.replace(/\//g, '_') || 'root'}.png` });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${OUT}/${route.replace(/\//g, '_') || 'root'}-bottom.png` });

  const bad = pageErrors.length || netFails.length || report.progressBars.length || report.hOverflow;
  if (bad) failures++;

  console.log(`\n=== ${route} ===`);
  console.log(JSON.stringify(report, null, 1));
  if (consoleErrors.length) console.log('CONSOLE:', consoleErrors);
  if (pageErrors.length) console.log('PAGE ERRORS:', pageErrors);
  if (netFails.length) console.log('NET FAILS:', netFails);

  await page.close();
}

await browser.close();
console.log(`\nroutes with problems: ${failures}/${ROUTES.length}`);
