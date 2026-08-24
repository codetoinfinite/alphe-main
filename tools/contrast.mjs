// WCAG contrast sweep over rendered text.
//
// Computed colour, not the token table: a token can be fine and still fail once
// it lands on a card, a gradient panel, or a hover state. The background is
// resolved by walking up for the first non-transparent ancestor, which is what
// the eye does too.
//
//   node tools/contrast.mjs [--mobile]

import puppeteer from 'puppeteer-core';

// Base URL of the dev server. Overridable so a second checkout can run the
// gates against its own `PORT=4323 node serve.mjs` instead of whichever tree
// happens to hold port 4322.
const BASE = (process.env.ALPHE_BASE || 'http://localhost:4322');
const ROUTES = ['/', '/platform/', '/pricing/', '/docs/', '/about/', '/contact/'];
const MOBILE = process.argv.includes('--mobile');

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const all = [];

for (const route of ROUTES) {
  const p = await browser.newPage();
  if (MOBILE) {
    await p.emulate({
      viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
  } else {
    await p.setViewport({ width: 1440, height: 900 });
  }
  await p.goto(BASE + route, { waitUntil: 'networkidle0' });
  await p.evaluate(async () => {
    const step = window.innerHeight * 0.7;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    window.scrollTo(0, 0);
    // A fast programmatic scroll outruns IntersectionObserver delivery, so some
    // [data-reveal] sections are still at opacity 0 when measured and get
    // skipped entirely. Force them open — the point is to grade the colours,
    // not the reveal timing.
    for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-revealed');
    // Some arrivals are keyframe animations on a stagger — the constellation
    // chips run 0.55s each behind delays that reach past a second. Sampling
    // before they land grades a fading element against its own destination and
    // reports every intermediate opacity as a failure. Wait for the animations
    // themselves, with a ceiling so an infinite one cannot hang the sweep.
    await Promise.race([
      Promise.allSettled(document.getAnimations().map((a) => a.finished)),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    await new Promise((r) => setTimeout(r, 300));
  });

  const rows = await p.evaluate(() => {
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const parse = (s) => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const n = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 };
    };
    const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));

    // Every painting layer from the element up to the first opaque one, then
    // composited bottom-up. Stopping at the first non-transparent layer is
    // wrong: a chip with rgba(brand,.14) on a dark card is not brand-coloured,
    // and treating it that way reports brand-on-brand at 1:1.
    const bgOf = (el) => {
      const layers = [];
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 0.999) break;
        }
        n = n.parentElement;
      }
      let base = [8, 9, 10];
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i].rgb, base, layers[i].a);
      return base;
    };

    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,span,a,button,label,td,th,figcaption,strong,em,code')) {
      if (el.children.length && ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (s.visibility === 'hidden' || s.display === 'none') continue;

      // Effective opacity, including every ancestor — a 0.4 wrapper halves the
      // contrast of perfectly good tokens underneath it.
      let op = 1;
      let n = el;
      while (n && n !== document.documentElement) {
        op *= parseFloat(getComputedStyle(n).opacity);
        n = n.parentElement;
      }
      if (op < 0.05) continue;

      // Text painted through background-clip:text has color:transparent by
      // definition — the ink is the gradient behind the glyphs, which this gate
      // cannot sample. Grading it compares the background against itself and
      // always reports 1:1. Walk up: the clip is set on the wordmark, the text
      // nodes are in its children.
      let clipText = false;
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        // One value per background layer, so a two-layer mark computes to
        // "text, text" — match the keyword, not the whole string.
        if (/\btext\b/.test(cs.webkitBackgroundClip || cs.backgroundClip || '')) {
          clipText = true;
          break;
        }
      }
      if (clipText) continue;

      const fg = parse(s.color);
      if (!fg) continue;
      // Start at the element, not its parent: a button paints its own
      // background, and skipping it compares white-on-white and reports 1:1.
      const bg = bgOf(el);
      const eff = over(fg.rgb, bg, fg.a * op);
      const l1 = lum(eff);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

      const size = parseFloat(s.fontSize);
      const weight = Number(s.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      if (ratio >= need) continue;

      const key = `${s.color}|${text.slice(0, 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ratio: Math.round(ratio * 100) / 100,
        need,
        size: Math.round(size),
        sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''),
        text: text.replace(/\s+/g, ' ').slice(0, 44),
        fg: s.color,
        op: Math.round(op * 100) / 100,
      });
    }
    return out.sort((a, b) => a.ratio - b.ratio);
  });

  for (const r of rows) all.push({ route, ...r });
  await p.close();
}

await browser.close();

console.log(`\n=== contrast below WCAG AA ${MOBILE ? '(mobile, coarse pointer)' : '(desktop)'} ===\n`);
let last = '';
for (const r of all) {
  if (r.route !== last) {
    console.log(`\n  ${r.route}`);
    last = r.route;
  }
  console.log(`    ${String(r.ratio).padStart(5)}:1 (need ${r.need})  ${r.size}px  ${r.sel.padEnd(24)} "${r.text}"${r.op < 1 ? `  [opacity ${r.op}]` : ''}`);
}
console.log(`\n${all.length} failing text runs`);
