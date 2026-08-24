import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
for (const W of [360, 768, 1024, 1280]) for (const r of ['/', '/platform/', '/pricing/', '/docs/', '/about/', '/contact/']) {
  const p = await b.newPage();
  await p.setViewport({ width: W, height: 900 });
  await p.goto('http://localhost:4322' + r, { waitUntil: 'networkidle0' });
  await new Promise((x) => setTimeout(x, 800));
  const out = await p.evaluate(() => {
    const w = innerWidth;
    const wide = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width > w + 1 && rect.height > 0) {
        wide.push(el.tagName + '.' + (el.className || '') + ' w=' + Math.round(rect.width) + ' r=' + Math.round(rect.right));
      }
    }
    return { scrollW: document.documentElement.scrollWidth, innerW: w, wide: wide.slice(0, 12) };
  });
  console.log(W, r, JSON.stringify(out, null, 1));
  await p.close();
}
await b.close();
