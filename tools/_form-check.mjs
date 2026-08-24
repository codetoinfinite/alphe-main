import puppeteer from 'puppeteer-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.URL || 'http://localhost:4399';
const OUT = process.env.OUT || '/tmp/alphe-form';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'alphe-chrome-')),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

const csp = [];
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('  [pageerror]', String(e)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') console.log('  [console]', t);
  if (/Content Security Policy/i.test(t)) csp.push(t);
});

const posts = [];
await page.setRequestInterception(true);
page.on('request', (r) => {
  if (r.method() === 'POST') posts.push({ url: r.url(), body: r.postData() });
  r.continue();
});

const status = () =>
  page.evaluate(() => {
    const s = document.querySelector('[data-form] .form__status');
    return { text: s.textContent.trim(), cls: s.className, disabled: !!document.querySelector('[data-form] button[type="submit"]')?.disabled };
  });

async function run(label, url, fill) {
  console.log(`\n=== ${label} ===`);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.querySelector('[data-form]').scrollIntoView({ block: 'center' }));
  await fill();
  await page.evaluate(() => document.querySelector('[data-form]').requestSubmit());
  await new Promise((r) => setTimeout(r, 900));
  console.log('  status', JSON.stringify(await status()));
  const last = posts.at(-1);
  console.log('  POST  ', last ? `${last.url} ${last.body}` : 'none');
  await page.screenshot({ path: `${OUT}/${label.replace(/\W+/g, '-')}.png` });
}

const type = (sel, v) =>
  page.evaluate((s, val) => { const el = document.querySelector(s); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, sel, v);

// 1. empty CTA — client-side validation, nothing posted
await run('cta-empty', `${BASE}/`, async () => {});

// 2. bad email — client-side validation, nothing posted
await run('cta-bad-email', `${BASE}/`, async () => type('[data-form] input[type=email]', 'nope'));

// 3. good email — posts
await run('cta-ok', `${BASE}/`, async () => type('[data-form] input[type=email]', 'lead@example.com'));

// 4. contact page, all fields
await run('contact-ok', `${BASE}/contact/`, async () => {
  await type('[data-form] input[name=name]', 'Ada Lovelace');
  await type('[data-form] input[name=email]', 'ada@example.com');
  await type('[data-form] input[name=phone]', '+91 98765 43210');
  await page.evaluate(() => { const b = document.querySelector('[data-form] input[name=internship]'); b.checked = true; });
});

// 5. server failure path
await run('cta-server-error', `${BASE}/?fail`, async () => type('[data-form] input[type=email]', 'lead@example.com'));

// 6. honeypot is invisible and out of the tab order
const trap = await page.evaluate(() => {
  const t = document.querySelector('.form__trap');
  const r = t.getBoundingClientRect();
  return { name: t.name, w: r.width, h: r.height, tabindex: t.tabIndex, hidden: t.getAttribute('aria-hidden'), scroll: document.documentElement.scrollWidth <= window.innerWidth };
});
console.log('\n=== honeypot ===\n ', JSON.stringify(trap));

console.log('\ncsp violations', csp.length, csp.slice(0, 3));
await browser.close();
