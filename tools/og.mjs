import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

// Renders the social preview card to site/media/og.png at 1200x630.
// Run it after changing the card source; the output is committed so the page
// needs no image service at runtime.

const CARD = process.argv[2] || resolve(import.meta.dirname, 'og-card.html');
const OUT = resolve(import.meta.dirname, '../site/media/og.png');

const b = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox'],
});
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await p.goto(CARD.startsWith('http') ? CARD : 'file://' + CARD, { waitUntil: 'networkidle0' });
await p.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 300));
await p.screenshot({ path: OUT });
console.log('wrote', OUT);
await b.close();
