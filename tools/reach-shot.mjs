// Reach stage, sampled across one turn of the sweep. Checks the core mark, and
// that the lit ring travels — the chip that is brightest has to move round with
// the wedge rather than all of them pulsing together.
//
//   node tools/reach-shot.mjs [width]
import puppeteer from 'puppeteer-core';

const W = Number(process.argv[2] || 1440);

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));
await p.setViewport({ width: W, height: 900, deviceScaleFactor: 2 });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });

await p.evaluate(() => {
  document.querySelector('#reach').scrollIntoView({ block: 'center', behavior: 'instant' });
});
await new Promise((r) => setTimeout(r, 1200));

const geom = await p.evaluate(() => {
  const stage = document.querySelector('.reach__stage');
  const core = document.querySelector('.reach__core');
  const mark = document.querySelector('.reach__core-mark');
  const label = document.querySelector('.reach__core-label');
  const r = (el) => {
    const x = el.getBoundingClientRect();
    return { w: Math.round(x.width), h: Math.round(x.height) };
  };
  const nodes = [...document.querySelectorAll('.reach__node')];
  return {
    label: !!label,
    stage: r(stage),
    core: r(core),
    mark: r(mark),
    markPct: Math.round((mark.getBoundingClientRect().width / core.getBoundingClientRect().width) * 100),
    nodes: nodes.length,
    // Every chip must carry an angle, or its light never gets timed.
    noAngle: nodes.filter((n) => !n.style.getPropertyValue('--a')).map((n) => n.textContent.trim()),
    delays: nodes.map((n) => ({
      t: n.textContent.trim(),
      a: n.style.getPropertyValue('--a').trim(),
      d: getComputedStyle(n, '::after').animationDelay,
      name: getComputedStyle(n, '::after').animationName,
    })),
  };
});

console.log('core label removed:', geom.label === false);
console.log('stage', geom.stage, 'core', geom.core, 'mark', geom.mark, `(${geom.markPct}% of core)`);
console.log('nodes', geom.nodes, 'without --a:', geom.noAngle.length ? geom.noAngle : 'none');
const bad = geom.delays.filter((d) => d.name !== 'reach-lit');
console.log('chips wired to reach-lit:', geom.delays.length - bad.length, bad.length ? bad : '');
for (const d of geom.delays.slice(0, 4)) console.log('  ', d.t, 'a=' + d.a, 'delay=' + d.d);

// Which chip is lit, five times across one 18s turn. The brightest --a should
// climb by roughly 360/5 = 72 degrees each sample.
for (let i = 0; i < 5; i++) {
  const lit = await p.evaluate(() => {
    let best = null;
    for (const n of document.querySelectorAll('.reach__node')) {
      const o = parseFloat(getComputedStyle(n, '::after').opacity) || 0;
      if (!best || o > best.o) best = { t: n.textContent.trim(), a: n.style.getPropertyValue('--a').trim(), o: +o.toFixed(2) };
    }
    return best;
  });
  console.log(`t+${i * 3.6}s brightest:`, lit.t, 'a=' + lit.a, 'opacity=' + lit.o);
  if (i < 4) await new Promise((r) => setTimeout(r, 3600));
}

await p.screenshot({ path: `/tmp/alphe-reach-${W}.png` });
console.log('shot /tmp/alphe-reach-' + W + '.png');
console.log(errs.length ? 'ERRORS: ' + [...new Set(errs)].join(' | ') : 'no console errors');
await b.close();
