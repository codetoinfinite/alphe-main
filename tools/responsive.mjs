// Responsive gate: every route at every device class the site claims to
// support. Fails on horizontal overflow, on any element wider than the
// viewport, on script errors, and on tap targets under 40 px at phone widths.
//
// node responsive.mjs [--shots]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = '/tmp/alphe-responsive';

const VIEWPORTS = [
  { name: 'phone-se', w: 375, h: 667, dsf: 2, touch: true },
  { name: 'phone', w: 390, h: 844, dsf: 3, touch: true },
  { name: 'phone-xl', w: 430, h: 932, dsf: 3, touch: true },
  { name: 'tablet', w: 768, h: 1024, dsf: 2, touch: true },
  { name: 'ipad-air', w: 820, h: 1180, dsf: 2, touch: true },
  { name: 'ipad-pro', w: 1024, h: 1366, dsf: 2, touch: true },
  { name: 'ipad-land', w: 1180, h: 820, dsf: 2, touch: true },
  { name: 'laptop-13', w: 1280, h: 800, dsf: 2 },
  { name: 'laptop-13-scaled', w: 1440, h: 900, dsf: 2 },
  { name: 'laptop-156', w: 1366, h: 768, dsf: 1 },
  { name: 'laptop-16', w: 1512, h: 945, dsf: 2 },
  { name: 'laptop-17', w: 1728, h: 1117, dsf: 2 },
  { name: 'desktop', w: 1920, h: 1080, dsf: 1 },
];

const ROUTES = ['/', '/platform/', '/pricing/', '/docs/', '/about/', '/contact/'];

if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const fails = [];

// --only=phone,tablet narrows the sweep while iterating on one device class.
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

for (const v of VIEWPORTS) {
  if (ONLY.length && !ONLY.some((o) => v.name.includes(o))) continue;
  for (const route of ROUTES) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
    await page.setViewport({
      width: v.w,
      height: v.h,
      deviceScaleFactor: v.dsf,
      hasTouch: !!v.touch,
      isMobile: !!v.touch,
    });
    await page.goto((process.env.ALPHE_BASE || 'http://localhost:4322') + route, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 700));

    const out = await page.evaluate((isPhone) => {
      const vw = document.documentElement.clientWidth;
      const wide = [];
      const small = [];
      const seen = new Set();
      // A marquee track, a code block and a card rail are all meant to be wider
      // than the screen — they live inside something that clips or scrolls them.
      // Only overflow that nothing catches is a bug.
      const clipped = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const o = getComputedStyle(p);
          if (o.overflowX !== 'visible' || o.overflow !== 'visible') return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.height <= 0 || r.width <= 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.opacity === '0') continue;
        if (r.right > vw + 1.5 && style.position !== 'fixed' && !clipped(el)) {
          const key = el.tagName + '.' + (el.className || '');
          if (!seen.has(key)) {
            seen.add(key);
            wide.push(`${key} w=${Math.round(r.width)} r=${Math.round(r.right)}`);
          }
        }
        // A link set in the middle of a sentence cannot be 40px tall without
        // tearing the sentence apart, and WCAG exempts it for exactly that
        // reason. It still owes the 24px minimum.
        const inline =
          style.display === 'inline' &&
          el.parentElement &&
          (el.parentElement.textContent || '').trim().length >
            (el.textContent || '').trim().length + 3;
        if (
          isPhone &&
          (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY') &&
          (r.height < (inline ? 24 : 40) || r.width < 24) &&
          el.offsetParent !== null
        ) {
          small.push(
            `${el.tagName}.${el.className || ''}"${(el.textContent || '').trim().slice(0, 22)}" ${Math.round(r.width)}x${Math.round(r.height)}`
          );
        }
      }
      return {
        scrollW: document.documentElement.scrollWidth,
        vw,
        docH: document.documentElement.scrollHeight,
        wide: wide.slice(0, 10),
        small: [...new Set(small)].slice(0, 16),
      };
    }, !!v.touch && v.w < 500);

    const bad = [];
    if (out.scrollW > out.vw + 1) bad.push(`h-scroll ${out.scrollW}>${out.vw}`);
    if (out.wide.length) bad.push('wide: ' + out.wide.join(' | '));
    if (out.small.length) bad.push('tap<40: ' + out.small.join(' | '));
    if (errors.length) bad.push('err: ' + [...new Set(errors)].slice(0, 3).join(' | '));
    if (bad.length) {
      fails.push(`${v.name} ${v.w}x${v.h} ${route}`);
      console.log(`FAIL ${v.name} ${v.w}x${v.h} ${route}\n      ${bad.join('\n      ')}`);
    } else {
      console.log(`ok   ${v.name} ${v.w}x${v.h} ${route} docH=${out.docH}`);
    }

    if (SHOTS && route === '/') {
      await page.screenshot({ path: `${SHOT_DIR}/${v.name}-top.png` });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await new Promise((r) => setTimeout(r, 600));
      await page.screenshot({ path: `${SHOT_DIR}/${v.name}-bottom.png` });
    }
    await page.close();
  }
}

console.log(fails.length ? `\n${fails.length} FAILED: ` + fails.join(', ') : '\nALL PASS');
await browser.close();
