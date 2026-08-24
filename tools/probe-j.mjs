import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise(r=>setTimeout(r,1500));
const out = await p.evaluate(() => {
  const pageTop = (el) => { let y=0; for (let n=el;n;n=n.offsetParent) y+=n.offsetTop; return y; };
  const VH = innerHeight, HOLD = 0.354;
  const st = Array.from(document.querySelectorAll('[data-field-shape]')).map((el) => {
    const a = el.querySelector('[data-field-anchor], [data-avoid], .section-title, h1, h2') || el;
    const lock = el.dataset.fieldLock || 'anchor';
    const ref = lock === 'section' ? el : a;
    return {
      shape: el.dataset.fieldShape, id: el.id || el.className.split(' ')[0], lock,
      anchorTag: a.tagName + '.' + a.className,
      avoid: el.querySelectorAll('[data-avoid]').length,
      offTop: pageTop(ref),
      rectTop: Math.round(ref.getBoundingClientRect().top + scrollY),
      J: Math.round(pageTop(ref) - (lock === 'section' ? 0 : VH * HOLD)),
      secTop: pageTop(el), secH: el.offsetHeight,
    };
  });
  // Derived, not listed: a section is quiet exactly when it declares no station.
  // A hard-coded list goes stale the moment a section gains one or is deleted.
  const quiet = [...document.querySelectorAll('section[id]')]
    .filter((el) => !el.dataset.fieldShape)
    .map((el) => ({ id: el.id, top: pageTop(el), h: el.offsetHeight }));
  return { VH, docH: document.documentElement.scrollHeight, st, quiet,
    cta: (() => { const c=document.querySelector('.cta__canvas'); return c? {top: pageTop(c), h:c.offsetHeight}:null; })() };
});
console.log(JSON.stringify(out, null, 1));
const J = out.st.map(s=>s.J);
console.log('J =', J.join(', '));
console.log('gaps =', J.slice(1).map((v,i)=>v-J[i]).join(', '));
await b.close();
