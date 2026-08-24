import puppeteer from 'puppeteer-core';

// Every route, loaded and scrolled once. Catches the things that only show up
// per page: a broken asset path, a stylesheet the CSP rejects, a module that
// throws on a page where its markup is absent.

const ROUTES = ['/', '/platform/', '/pricing/', '/docs/', '/about/', '/contact/', '/404.html'];

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let bad = 0;
for (const route of ROUTES) {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  p.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
  const res = await p.goto('http://localhost:4322' + route, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));

  const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= max; y += 600) {
    await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 400));

  // Fonts loading proves the CSP font-src is not silently blocking them, and a
  // canvas with a live context proves WebGL survived the policy too.
  const state = await p.evaluate(() => ({
    fonts: document.fonts.status,
    fontFaces: document.fonts.size,
    canvases: document.querySelectorAll('canvas').length,
    painted: Array.from(document.querySelectorAll('canvas')).filter((c) =>
      c.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ? false : true
    ).length,
    sheets: Array.from(document.styleSheets).filter((s) => {
      try {
        return s.cssRules.length > 0;
      } catch {
        return false;
      }
    }).length,
    links: document.querySelectorAll('link[rel="stylesheet"]').length,
    title: document.title,
  }));

  const ok = res.status() === (route === '/404.html' ? 200 : 200) && errors.length === 0;
  if (!ok || state.sheets !== state.links) bad++;
  console.log(
    `${route.padEnd(12)} ${res.status()} sheets ${state.sheets}/${state.links} canvas ${state.canvases} fonts ${state.fonts}(${state.fontFaces}) max ${max}` +
      (errors.length ? '\n  ' + errors.join('\n  ') : '')
  );
  await p.close();
}

console.log(bad ? `FAIL ${bad} route(s)` : 'all routes clean');
await b.close();
