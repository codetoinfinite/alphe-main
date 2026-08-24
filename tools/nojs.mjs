// What the site looks like when the JavaScript never runs.
//
// Not a hypothetical: a module that 404s after a bad deploy, a CSP header that
// blocks the bundle, an older browser that chokes on the syntax, or a corporate
// proxy stripping scripts all land here. The question is whether the page is
// degraded or blank.
//
// It is a gate, not a report: a route that loses its headline or comes back
// close to empty exits 1. The floor is deliberately low — this catches a page
// that renders nothing without JavaScript, not one that renders less.
//
//   node tools/nojs.mjs

import puppeteer from 'puppeteer-core';

// Base URL of the dev server. Overridable so a second checkout can run the
// gates against its own `PORT=4323 node serve.mjs` instead of whichever tree
// happens to hold port 4322.
const BASE = (process.env.ALPHE_BASE || 'http://localhost:4322');
const ROUTES = ['/', '/platform/', '/pricing/', '/docs/', '/about/', '/contact/', '/nope'];

// The thinnest route is the 404 at 79 visible elements, and the next one up is
// 96. A page that has fallen back to nothing but chrome lands an order of
// magnitude below either.
const FLOOR = 40;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const problems = [];
console.log('route         visible-text  hidden-els  headline-visible');
for (const route of ROUTES) {
  const p = await browser.newPage();
  await p.setJavaScriptEnabled(false);
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(BASE + route, { waitUntil: 'networkidle0' });
  await p.evaluate(() => new Promise((r) => setTimeout(r, 400))).catch(() => {});

  const r = await p.evaluate(() => {
    let visible = 0;
    let hidden = 0;
    for (const el of document.querySelectorAll('h1,h2,h3,h4,p,li,span,a,button')) {
      const t = (el.textContent || '').trim();
      if (!t) continue;
      const s = getComputedStyle(el);
      const op = parseFloat(s.opacity);
      const box = el.getBoundingClientRect();
      if (op < 0.05 || s.visibility === 'hidden' || s.display === 'none' || box.width === 0) hidden++;
      else visible++;
    }
    const h1 = document.querySelector('h1');
    const h1vis = h1 ? parseFloat(getComputedStyle(h1).opacity) >= 0.05 : null;
    return { visible, hidden, h1vis };
  });
  console.log(
    `${route.padEnd(14)}${String(r.visible).padEnd(14)}${String(r.hidden).padEnd(12)}${r.h1vis}`
  );
  if (r.h1vis !== true) problems.push(`${route} has no visible h1 without JavaScript`);
  if (r.visible < FLOOR) problems.push(`${route} shows ${r.visible} visible elements, under ${FLOOR}`);
  await p.screenshot({ path: `/tmp/alphe-nojs${route.replace(/\//g, '_')}.png` });
  await p.close();
}

await browser.close();
console.log('\nscreenshots: /tmp/alphe-nojs*.png');

if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  \u2717 ${p}`);
  console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log(`${ROUTES.length} routes readable with scripting off`);
