// Layout alignment sweep.
//
// Three things this catches that the responsive and overflow gates do not:
//
//   escape  — a box whose left/right edge sits outside its own .container's
//             content box. Almost always an unscoped `position:absolute` rule
//             leaking onto a class that is also used as a plain card.
//   collapse— a grid/flex cell with content but zero height, which means its
//             children left the flow and are now painting over something else.
//   ragged  — siblings in the same row of a grid whose tops do not line up.
//
//   node tools/align.mjs [width]

import puppeteer from 'puppeteer-core';

// Base URL of the dev server. Overridable so a second checkout can run the
// gates against its own `PORT=4323 node serve.mjs` instead of whichever tree
// happens to hold port 4322.
const BASE = (process.env.ALPHE_BASE || 'http://localhost:4322');
const ROUTES = ['/', '/platform/', '/pricing/', '/docs/', '/about/', '/contact/'];
const WIDTH = Number(process.argv[2] || 1440);
const TOL = 2;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let bad = 0;

for (const route of ROUTES) {
  const p = await browser.newPage();
  await p.setViewport({ width: WIDTH, height: 900 });
  await p.goto(BASE + route, { waitUntil: 'networkidle0' });
  await p.evaluate(async () => {
    const step = window.innerHeight * 0.7;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll('[data-reveal]')) el.classList.add('is-revealed');
    await Promise.race([
      Promise.allSettled(document.getAnimations().map((a) => a.finished)),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  });

  const rows = await p.evaluate((TOL) => {
    const out = [];
    const name = (el) =>
      el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '');
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top + window.scrollY, w: r.width, h: r.height };
    };

    for (const c of document.querySelectorAll('.container')) {
      const cs = getComputedStyle(c);
      const cb = box(c);
      const inner = {
        l: cb.l + parseFloat(cs.paddingLeft),
        r: cb.r - parseFloat(cs.paddingRight),
      };
      for (const el of c.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        // Anything deliberately taken out of flow relative to a positioned
        // ancestor inside the container is its own business — decorations,
        // masks, crosshairs. Only flag boxes that are still meant to be laid
        // out by the container.
        if (s.position === 'fixed') continue;
        const b = box(el);
        if (b.w < 4 || b.h < 4) continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        // Anything under a box that manages its own horizontal overflow is meant
        // to run past the gutter: a scroller because the reader drags it (the
        // bleed-to-edge snapping rows on narrow screens), a clipper because the
        // content is wider than the frame on purpose (the coverage marquee).
        // Either way the overflow is contained and is not an alignment defect.
        let bleeds = false;
        for (let n = el; n && n !== c; n = n.parentElement) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') {
            bleeds = true;
            break;
          }
        }
        if (bleeds) continue;
        if (b.l < inner.l - TOL || b.r > inner.r + TOL) {
          out.push({
            kind: 'escape',
            sel: name(el),
            detail: `l ${Math.round(b.l)} r ${Math.round(b.r)} vs container ${Math.round(inner.l)}..${Math.round(inner.r)} (${s.position})`,
          });
        }
      }
    }

    // A closed accordion is a height of 0 on purpose. Anything under a
    // max-height:0 clamp is collapsed by design, not by accident.
    const clamped = (el, stop) => {
      for (let n = el; n && n !== stop; n = n.parentElement) {
        if (parseFloat(getComputedStyle(n).maxHeight) === 0) return true;
      }
      return false;
    };

    for (const g of document.querySelectorAll('*')) {
      const s = getComputedStyle(g);
      if (s.display !== 'grid' && s.display !== 'flex') continue;
      const kids = [...g.children].filter((k) => {
        const ks = getComputedStyle(k);
        return ks.display !== 'none' && ks.position !== 'absolute';
      });
      if (kids.length < 2) continue;
      for (const k of kids) {
        const b = box(k);
        if (b.h >= 1 || !k.textContent.trim()) continue;
        if (clamped(k, g.parentElement)) continue;
        // The outermost zero-height box is the one worth naming; its children
        // are zero for the same reason.
        if (k.parentElement && box(k.parentElement).h < 1) continue;
        out.push({ kind: 'collapse', sel: name(k), detail: `inside ${name(g)} — height 0 with content` });
      }
      // Rows only. A column stacks by definition, and children on the text
      // baseline sit where the font puts them.
      if (s.display === 'flex' && !s.flexDirection.startsWith('row')) continue;
      if (s.alignItems === 'center' || s.alignItems === 'baseline') continue;
      if (kids.some((k) => getComputedStyle(k).display.startsWith('inline'))) continue;
      // Wrapped, so more than one line: two cells that do not overlap
      // vertically at all are stacked, and comparing their tops is meaningless.
      const bs = kids.map(box);
      const stacked = bs.some((a) => bs.some((b) => a.t >= b.t + b.h - TOL));
      if (stacked) continue;
      // Offset by the child's own margin: an icon nudged down 8px to sit on the
      // cap height of the label next to it is aligned, not ragged.
      const tops = kids.map((k) => box(k).t - parseFloat(getComputedStyle(k).marginTop));
      const spread = Math.max(...tops) - Math.min(...tops);
      if (spread > TOL && spread < 40) {
        out.push({
          kind: 'ragged',
          sel: name(g),
          detail: `${kids.length} cells, tops spread ${Math.round(spread)}px (align-items: ${s.alignItems})`,
        });
      }
    }

    const seen = new Set();
    return out.filter((r) => {
      const k = r.kind + r.sel + r.detail;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, TOL);

  console.log(`\n  ${route}  ${rows.length ? rows.length + ' issue(s)' : 'clean'}`);
  for (const r of rows) console.log(`    ${r.kind.padEnd(9)} ${r.sel.padEnd(30)} ${r.detail}`);
  bad += rows.length;
  await p.close();
}

await browser.close();
console.log(`\n${bad} alignment issue(s) @${WIDTH}px`);
