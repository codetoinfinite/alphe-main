// The benchmarks section with the script switched off.
//
// The board is generated into the HTML in its finished state, so the only thing
// that can go wrong here is the stylesheet hiding something the script was meant
// to reveal, or the columns collapsing into one another because nothing wrote
// their offsets — with no script they are laid out by a grid instead, and this
// is the check that the grid is what is actually running.
//
//   node tools/nojs-bench.mjs [width]

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const W = Number(process.argv[2] || 1440);
const DIR = `/tmp/alphe-nojs-bench-${W}`;
mkdirSync(DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setJavaScriptEnabled(false);
await page.setViewport({ width: W, height: 900 });
await page.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });

const r = await page.evaluate(() => {
  const seen = (el) => {
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return !(parseFloat(s.opacity) < 0.05 || s.visibility === 'hidden' || s.display === 'none' || b.width === 0);
  };

  const rows = [...document.querySelectorAll('.ib')];
  const ink = rows.map((el) => {
    const f = [...el.querySelectorAll('.ib__face')].map((x) => x.getBoundingClientRect());
    return {
      left: Math.min(...f.map((x) => x.left)),
      right: Math.max(...f.map((x) => x.right)),
      top: Math.min(...f.map((x) => x.top)),
      bottom: Math.max(...f.map((x) => x.bottom)),
    };
  });
  const boxes = rows.map((el) => el.getBoundingClientRect());
  const seenOrder = rows.map((el, i) => ({ i, b: boxes[i] })).sort((a, b) => a.b.top - b.b.top || a.b.left - b.b.left);
  let overlap = 0;
  for (let k = 1; k < seenOrder.length; k++) {
    const a = seenOrder[k - 1];
    const b = seenOrder[k];
    if (Math.abs(a.b.top - b.b.top) > 1) continue;
    overlap = Math.max(overlap, ink[a.i].right - ink[b.i].left);
  }

  const list = document.querySelector('[data-bench-rows]').getBoundingClientRect();
  const bars = ink.map((x) => x.bottom - x.top);

  return {
    // Everything the section says, and how much of it is on screen.
    hidden: [...document.querySelectorAll('#bench h2,#bench h3,#bench p,#bench li,#bench span,#bench a,#bench button')]
      .filter((el) => (el.textContent || '').trim() && !seen(el))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className || '-'}: ${el.textContent.trim().slice(0, 34)}`),
    rows: rows.length,
    listH: Math.round(list.height),
    rowsH: Math.round(Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top))),
    overlap: Math.round(overlap),
    barMin: Math.round(Math.min(...bars)),
    barMax: Math.round(Math.max(...bars)),
    order: rows.slice(0, 3).map((el) => el.querySelector('.ib__name').textContent.trim()),
  };
});

console.log(`— no script, ${W}px —`);
console.log('columns', r.rows, '| stage', r.listH, 'span', r.rowsH, '| ink overlap', r.overlap);
console.log('column ink height min', r.barMin, 'max', r.barMax);
console.log('top of board', r.order.join(' / '));
console.log('hidden in #bench:', r.hidden.length ? '\n  ' + r.hidden.join('\n  ') : 'none');

await (await page.$('.bench')).screenshot({ path: `${DIR}/board.png` });
console.log('shots in', DIR);
await browser.close();
