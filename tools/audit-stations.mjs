import puppeteer from 'puppeteer-core';

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://localhost:4322/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));

const rows = await p.evaluate(() => {
  const vh = innerHeight;
  const opaque = (el) => {
    let n = el;
    while (n && n !== document.body) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(Number);
        const a = parts.length > 3 ? parts[3] : 1;
        if (a > 0.5) return `${n.className || n.tagName} ${bg}`;
      }
      n = n.parentElement;
    }
    return null;
  };
  return Array.from(document.querySelectorAll('[data-field-shape]')).map((el) => {
    const r = el.getBoundingClientRect();
    const head = el.querySelector('[data-avoid], .section-title, h1, h2');
    const hr = head ? head.getBoundingClientRect() : null;
    // Everything opaque inside the section that would occlude the fixed field.
    const blockers = Array.from(el.querySelectorAll('*'))
      .filter((n) => {
        const cs = getComputedStyle(n);
        const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
        if (!m) return false;
        const parts = m[1].split(',').map(Number);
        const a = parts.length > 3 ? parts[3] : 1;
        const b = n.getBoundingClientRect();
        return a > 0.35 && b.width > 180 && b.height > 90;
      })
      .map((n) => n.className.toString().split(' ')[0]);
    return {
      shape: el.dataset.fieldShape,
      id: el.id || el.className,
      top: Math.round(r.top + scrollY),
      h: Math.round(r.height),
      screens: +(r.height / vh).toFixed(2),
      headTop: hr ? Math.round(hr.top + scrollY) : null,
      headOffset: hr ? Math.round(hr.top - r.top) : null,
      sectionBg: getComputedStyle(el).backgroundColor,
      blockers: [...new Set(blockers)].slice(0, 5),
      ownCanvas: !!el.querySelector('[data-particles]'),
    };
  });
});
console.log(JSON.stringify(rows, null, 1));
console.log('docHeight', await p.evaluate(() => document.body.scrollHeight));
await b.close();
