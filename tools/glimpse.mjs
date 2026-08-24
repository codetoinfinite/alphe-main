// What the cloud is doing across one leg of the journey, as the reader sees it.
//
//   node tools/glimpse.mjs [fromStation] [toStation] [frames] [width]
//
// Steps the scroll from one station's hold to the next's and shoots the viewport
// at each step, so the question "is the logo ever actually visible on the way
// out of the hero" has a picture rather than an opinion. The holds are read out
// of the page's own layout the same way particle-field measures them, so the
// range is exactly the leg and not a guess at it.
import puppeteer from 'puppeteer-core';

const FROM = Number(process.argv[2] || 0);
const TO = Number(process.argv[3] || 1);
const FRAMES = Number(process.argv[4] || 7);
const W = Number(process.argv[5] || 1440);
const H = 900;

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
await p.setViewport({ width: W, height: H });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1400));

// The same measurement particle-field makes: offsetTop up the chain, and the
// headline held at HOLD_REF unless the station locks to its section's top edge.
const holds = await p.evaluate((ref) => {
  const top = (el) => {
    let y = 0;
    for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
    return y;
  };
  return [...document.querySelectorAll('[data-field-shape]')].map((el) => {
    const anchor =
      el.querySelector('[data-field-anchor]') ||
      el.querySelector('[data-avoid], .section-title, h1, h2') ||
      el;
    return {
      id: el.id || el.className.split(' ')[0],
      hold:
        el.dataset.fieldLock === 'section' ? top(el) : top(anchor) - innerHeight * ref,
    };
  });
}, 0.354);

console.log(holds.map((h, i) => `${i} ${h.id} @${Math.round(h.hold)}`).join('\n'));

const a = holds[FROM].hold;
const z = holds[TO].hold;
for (let i = 0; i < FRAMES; i++) {
  const t = i / (FRAMES - 1);
  const y = Math.round(a + (z - a) * t);
  await p.evaluate((v) => scrollTo({ top: Math.max(0, v), behavior: 'instant' }), y);
  // Long enough for the opacity damp to land; the morph itself is a pure
  // function of scroll and is already correct on the first frame.
  await new Promise((r) => setTimeout(r, 700));
  const file = `/tmp/alphe-glimpse-${FROM}${TO}-${String(i).padStart(2, '0')}-${W}.png`;
  await p.screenshot({ path: file });
  console.log(`${String(Math.round(t * 100)).padStart(3)}%  y=${y}  ${file}`);
}

console.log(errs.length ? 'ERRORS: ' + [...new Set(errs)].join(' | ') : 'no console errors');
await b.close();
