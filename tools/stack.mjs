import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

// Does the deck actually deal?
//
// The stacking is CSS, so what is worth checking is the geometry it produces:
// where each card parks, that a parked card is fully on screen, that the one
// arriving covers the one below it rather than showing a seam of page through
// the gap, that the index on the left agrees with the card on top, and that the
// last card gets time parked before the section ends.
//
// It shoots each park point so the result can also be looked at.

const VW = Number(process.argv[2]) || 1440;
const VH = Number(process.argv[3]) || 900;
const OUT = `/tmp/alphe-stack-${VW}`;
mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: VW, height: VH });
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1400));

const geo = await p.evaluate(() => {
  const sec = document.querySelector('[data-stack]');
  const r = sec.getBoundingClientRect();
  const marks = [...document.querySelectorAll('[data-stack-mark]')];
  const slots = [...document.querySelectorAll('.stack__slot')];
  const stick = parseFloat(getComputedStyle(slots[0]).top);
  return {
    docH: document.documentElement.scrollHeight,
    secTop: Math.round(r.top + scrollY),
    secH: Math.round(r.height),
    stick,
    railSticky: getComputedStyle(document.querySelector('.stack__rail-inner')).position,
    slotSticky: getComputedStyle(slots[0]).position,
    zs: slots.map((s) => getComputedStyle(s).zIndex),
    cards: slots.map((s, i) => ({
      i,
      flow: Math.round(marks[i].getBoundingClientRect().top + scrollY),
      h: Math.round(s.getBoundingClientRect().height),
      opaque: getComputedStyle(s.querySelector('.card')).backgroundColor,
    })),
    tail: Math.round(document.querySelector('.stack__tail').getBoundingClientRect().height),
  };
});

console.log(`viewport ${VW}x${VH}   doc ${geo.docH}`);
console.log(`section  top ${geo.secTop}  height ${geo.secH}  stick ${geo.stick}`);
console.log(`sticky   rail=${geo.railSticky}  slot=${geo.slotSticky}  z=${geo.zs.join(',')}`);
console.log(`tail     ${geo.tail}px`);
console.log('cards:');
for (const c of geo.cards) console.log(`  ${c.i} flow=${c.flow} h=${c.h} bg=${c.opaque}`);

// Under 860 the deck deliberately flattens into a plain list — nothing sticks,
// so the whole park/overlap argument does not apply and only the layout is
// worth checking.
const FLAT = VW <= 860;
const problems = [];
if (FLAT) {
  if (geo.slotSticky !== 'static') problems.push('slots still stick on narrow screens');
  if (geo.tail !== 0) problems.push(`tail is ${geo.tail}px on a narrow screen`);
  const stacked = await p.evaluate(
    () => getComputedStyle(document.querySelector('.card')).gridTemplateColumns.split(' ').length
  );
  if (stacked !== 1) problems.push(`card is still ${stacked} columns wide`);
  console.log(`flat mode: slot=${geo.slotSticky} tail=${geo.tail} card columns=${stacked}`);
  await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  for (let i = 0; i < geo.cards.length; i++) {
    await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), geo.cards[i].flow - 40);
    await new Promise((r) => setTimeout(r, 500));
    await p.screenshot({ path: `${OUT}/flat-${i}.png` });
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify({ geo, problems, errors }, null, 1));
  console.log('\n' + (problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'no problems'));
  console.log(errors.length ? errors.join('\n') : 'no errors');
  await b.close();
  process.exit(0);
}
if (geo.slotSticky !== 'sticky') problems.push('slots are not sticky');
if (geo.railSticky !== 'sticky' && VW > 1040) problems.push('rail is not sticky');
for (let i = 1; i < geo.zs.length; i++) {
  if (Number(geo.zs[i]) <= Number(geo.zs[i - 1])) problems.push(`z-index ${i} does not rise`);
}
for (const c of geo.cards) {
  if (c.h + geo.stick > VH) problems.push(`card ${c.i} (${c.h}px) does not fit above the fold`);
}

// Park each card and look at it.
for (let i = 0; i < geo.cards.length; i++) {
  const y = geo.cards[i].flow - geo.stick;
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 700));

  const s = await p.evaluate((stick) => {
    const slots = [...document.querySelectorAll('.stack__slot')];
    const on = document.querySelector('[data-stack-jump].is-on');
    const rails = [...document.querySelectorAll('[data-stack-jump]')];
    // Which card owns the pixel just under the sticky line, in the middle?
    const hit = document.elementFromPoint(innerWidth / 2, stick + 30);
    const owner = hit && hit.closest('.stack__slot');
    return {
      active: on ? rails.indexOf(on) : -1,
      activeText: on ? on.textContent.replace(/\s+/g, ' ').trim() : null,
      topCard: owner ? slots.indexOf(owner) : -1,
      tops: slots.map((s) => Math.round(s.getBoundingClientRect().top)),
      bottoms: slots.map((s) => Math.round(s.getBoundingClientRect().bottom)),
    };
  }, geo.stick);

  console.log(
    `park ${i}: y=${y}  index=${s.active} "${s.activeText}"  card under the line=${s.topCard}  top=${s.tops[i]} bottom=${s.bottoms[i]}`
  );
  if (s.active !== i) problems.push(`at card ${i} the index says ${s.active}`);
  if (s.topCard !== i) problems.push(`at card ${i} the visible card is ${s.topCard}`);
  if (Math.abs(s.tops[i] - geo.stick) > 2) problems.push(`card ${i} parked at ${s.tops[i]}`);
  if (s.bottoms[i] > VH) problems.push(`card ${i} bottom ${s.bottoms[i]} is below the fold`);

  await p.screenshot({ path: `${OUT}/park-${i}.png` });
}

// Halfway between two park points: the arriving card should overlap the parked
// one with no page showing between them.
for (let i = 1; i < geo.cards.length; i++) {
  const y = Math.round((geo.cards[i - 1].flow + geo.cards[i].flow) / 2 - geo.stick);
  await p.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
  await new Promise((r) => setTimeout(r, 500));
  const gap = await p.evaluate((n) => {
    const slots = [...document.querySelectorAll('.stack__slot')];
    const below = slots[n - 1].getBoundingClientRect();
    const above = slots[n].getBoundingClientRect();
    return Math.round(above.top - below.bottom);
  }, i);
  console.log(`between ${i - 1} and ${i}: y=${y} gap=${gap}px`);
  await p.screenshot({ path: `${OUT}/mid-${i}.png` });
}

// The tail: after the last card parks there has to be scroll left in the
// column, or it parks and leaves in the same frame. A sticky box stops sticking
// when its container's bottom reaches it, so that is what is measured — not
// where the section ends.
const last = geo.cards[geo.cards.length - 1];
const lastPark = last.flow - geo.stick;
const colBottom = await p.evaluate(
  () => Math.round(document.querySelector('.stack__cards').getBoundingClientRect().bottom + scrollY)
);
const dwell = colBottom - (geo.stick + last.h) - lastPark;
console.log(`\nlast card parks at ${lastPark}, unsticks at ${colBottom - geo.stick - last.h} → ${dwell}px parked`);
if (dwell < 120) problems.push(`last card only holds for ${dwell}px`);

// The index jump.
await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
await new Promise((r) => setTimeout(r, 400));
await p.evaluate(() => document.querySelectorAll('[data-stack-jump]')[3].click());
await new Promise((r) => setTimeout(r, 1600));
const jumped = await p.evaluate((stick) => {
  const slot = document.querySelectorAll('.stack__slot')[3];
  const on = document.querySelector('[data-stack-jump].is-on');
  return {
    top: Math.round(slot.getBoundingClientRect().top),
    stick,
    active: [...document.querySelectorAll('[data-stack-jump]')].indexOf(on),
  };
}, geo.stick);
console.log(`jump to 04: card top ${jumped.top} (want ${jumped.stick}), index ${jumped.active}`);
if (Math.abs(jumped.top - jumped.stick) > 3) problems.push(`jump landed at ${jumped.top}`);
if (jumped.active !== 3) problems.push(`jump left the index on ${jumped.active}`);

writeFileSync(`${OUT}/report.json`, JSON.stringify({ geo, problems, errors }, null, 1));
console.log('\n' + (problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'no problems'));
console.log(errors.length ? errors.join('\n') : 'no errors');
await b.close();
