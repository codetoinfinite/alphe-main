// Drives every interactive control on every page and asserts it did something.
//
// The static audit proves the markup is sound; this proves the behaviour is.
// Each check states what it expected, so a failure line is a bug report rather
// than a red dot.
//
//   node tools/interact.mjs [width]

import puppeteer from 'puppeteer-core';

// Base URL of the dev server. Overridable so a second checkout can run the
// gates against its own `PORT=4323 node serve.mjs` instead of whichever tree
// happens to hold port 4322.
const BASE = (process.env.ALPHE_BASE || 'http://localhost:4322');
const W = Number(process.argv[2]) || 1440;
const H = W < 500 ? 812 : 900;

const results = [];
const ok = (page, what) => results.push({ page, what, pass: true });
const bad = (page, what, detail) => results.push({ page, what, pass: false, detail });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

async function open(route, width = W, height = H) {
  const p = await browser.newPage();
  await p.setViewport({ width, height, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message || e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 30000 });
  await p.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  return { p, errs };
}

const settle = (p, ms = 500) => p.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);

// --- nav toggle (mobile) ---------------------------------------------------
for (const route of ['/', '/pricing/']) {
  const { p, errs } = await open(route, 375, 812);
  const has = await p.$('[data-nav-toggle]');
  if (!has) bad(route, 'nav toggle', 'no [data-nav-toggle] in DOM');
  else {
    const before = await p.evaluate(() => {
      const t = document.querySelector('[data-nav-toggle]');
      const links = document.querySelector('.nav__links');
      return {
        expanded: t.getAttribute('aria-expanded'),
        visible: getComputedStyle(t).display !== 'none',
        linksH: links.getBoundingClientRect().height,
      };
    });
    if (!before.visible) bad(route, 'nav toggle', 'hidden at 375px — no way to reach the menu on mobile');
    await p.click('[data-nav-toggle]');
    await settle(p, 450);
    const after = await p.evaluate(() => {
      const t = document.querySelector('[data-nav-toggle]');
      const links = document.querySelector('.nav__links');
      const r = links.getBoundingClientRect();
      return {
        expanded: t.getAttribute('aria-expanded'),
        linksH: r.height,
        // The panel is laid out at full height whether it is open or not; it
        // is clip-path that hides it. Height never changes, so measuring
        // height reports every open as a failure.
        shown: getComputedStyle(links).visibility === 'visible',
        onScreen: r.top >= -1 && r.left >= -1 && r.right <= window.innerWidth + 1,
        firstLinkClickable: (() => {
          const a = document.querySelector('.nav__links a');
          if (!a) return false;
          const b = a.getBoundingClientRect();
          const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return Boolean(el && (el === a || a.contains(el)));
        })(),
        bodyLocked: getComputedStyle(document.body).overflow === 'hidden',
      };
    });
    if (after.expanded !== 'true') bad(route, 'nav toggle', `aria-expanded stayed "${after.expanded}" after click`);
    else ok(route, 'nav toggle sets aria-expanded');
    if (!after.shown) bad(route, 'nav panel', 'panel did not open (still visibility:hidden)');
    else ok(route, 'nav panel opens');
    if (!after.onScreen) bad(route, 'nav panel', 'panel opens partly off-screen');
    if (!after.firstLinkClickable) bad(route, 'nav panel', 'first menu link is covered by another element — not clickable');
    else ok(route, 'nav links hit-testable');

    await p.click('[data-nav-toggle]');
    await settle(p, 450);
    const closed = await p.evaluate(() => document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded'));
    if (closed !== 'false') bad(route, 'nav toggle', `does not close (aria-expanded "${closed}")`);
    else ok(route, 'nav toggle closes');

    // Escape and route change are the two ways a user leaves an open menu
    // without tapping the button again.
    await p.click('[data-nav-toggle]');
    await settle(p, 300);
    await p.keyboard.press('Escape');
    await settle(p, 300);
    const esc = await p.evaluate(() => document.querySelector('[data-nav-toggle]').getAttribute('aria-expanded'));
    if (esc !== 'false') bad(route, 'nav toggle', 'Escape does not close the open menu');
    else ok(route, 'Escape closes menu');
  }
  for (const e of errs) bad(route, 'console', e);
  await p.close();
}

// --- accordion -------------------------------------------------------------
for (const route of ['/', '/platform/', '/pricing/', '/docs/']) {
  const { p, errs } = await open(route);
  const count = await p.$$eval('[data-accordion] .accordion__item', (n) => n.length).catch(() => 0);
  if (count) {
    const r = await p.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const items = [...document.querySelectorAll('[data-accordion] .accordion__item')];
      const out = { opened: 0, heights: [], stuck: [], single: null, aria: true };
      for (const item of items) {
        const t = item.querySelector('.accordion__trigger');
        const panel = item.querySelector('.accordion__panel');
        const was = panel.getBoundingClientRect().height;
        t.click();
        await wait(520);
        const now = panel.getBoundingClientRect().height;
        if (item.classList.contains('is-open')) {
          if (now <= was) out.stuck.push(t.innerText.trim().slice(0, 40));
          else out.opened++;
          if (t.getAttribute('aria-expanded') !== 'true') out.aria = false;
        }
        out.heights.push([Math.round(was), Math.round(now)]);
      }
      // Single-open accordions must have exactly one panel open after clicking
      // every trigger in turn.
      const acc = document.querySelector('[data-accordion]');
      if (acc && acc.dataset.accordion !== 'multi') {
        out.single = document.querySelectorAll('[data-accordion] .accordion__item.is-open').length;
      }
      return out;
    });
    if (r.stuck.length) bad(route, 'accordion', `panel marked open but height did not grow: ${r.stuck.join(', ')}`);
    else ok(route, `accordion opens (${r.opened}/${count})`);
    if (!r.aria) bad(route, 'accordion', 'aria-expanded not set to true on open item');
    if (r.single !== null && r.single > 1) bad(route, 'accordion', `single-open accordion left ${r.single} panels open`);
    else if (r.single !== null) ok(route, 'accordion single-open honoured');

    // Reopening a panel that was closed mid-transition is where height:auto
    // handoffs usually break.
    const dbl = await p.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const t = document.querySelector('[data-accordion] .accordion__trigger');
      const panel = t.closest('.accordion__item').querySelector('.accordion__panel');
      t.click(); await wait(60); t.click(); await wait(60); t.click();
      await wait(700);
      const item = t.closest('.accordion__item');
      return { open: item.classList.contains('is-open'), h: Math.round(panel.getBoundingClientRect().height) };
    });
    if (dbl.open && dbl.h < 5) bad(route, 'accordion', `rapid re-click left panel open but collapsed (h=${dbl.h})`);
    else ok(route, 'accordion survives rapid clicking');
  }
  for (const e of errs) bad(route, 'console', e);
  await p.close();
}

// --- calculator ------------------------------------------------------------
for (const route of ['/', '/pricing/', '/platform/']) {
  const { p, errs } = await open(route);
  const has = await p.$('[data-calculator]');
  if (has) {
    const r = await p.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const root = document.querySelector('[data-calculator]');
      const slider = root.querySelector('input[type=range]');
      const read = () => ({
        spend: root.querySelector('[data-calc-spend]')?.textContent,
        after: root.querySelector('[data-calc-after]')?.textContent,
        saved: root.querySelector('[data-calc-saved]')?.textContent,
      });
      if (!slider) return { err: 'no range input inside [data-calculator]' };
      const before = read();
      slider.value = slider.max;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(900);
      const hi = read();
      slider.value = slider.min;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(900);
      const lo = read();
      return { before, hi, lo, min: slider.min, max: slider.max, labelled: Boolean(slider.labels?.length || slider.getAttribute('aria-label')) };
    });
    if (r.err) bad(route, 'calculator', r.err);
    else {
      if (JSON.stringify(r.hi) === JSON.stringify(r.lo)) bad(route, 'calculator', `output identical at min and max (${JSON.stringify(r.hi)})`);
      else ok(route, `calculator responds (${r.lo.spend} -> ${r.hi.spend})`);
      for (const [k, v] of Object.entries(r.hi)) {
        if (v == null) continue;
        if (/NaN|undefined|Infinity/.test(v)) bad(route, 'calculator', `${k} shows "${v}" at max`);
      }
      for (const [k, v] of Object.entries(r.lo)) {
        if (v == null) continue;
        if (/NaN|undefined|Infinity/.test(v)) bad(route, 'calculator', `${k} shows "${v}" at min`);
      }
      if (!r.labelled) bad(route, 'calculator', 'range input has no label or aria-label');
    }
  }
  for (const e of errs) bad(route, 'console', e);
  await p.close();
}

// --- early-access form -----------------------------------------------------
for (const route of ['/', '/pricing/', '/contact/', '/docs/']) {
  const { p, errs } = await open(route);
  const has = await p.$('[data-form]');
  if (has) {
    const r = await p.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const form = document.querySelector('[data-form]');
      const inputs = [...form.querySelectorAll('.form__input')];
      // The CTA forms ask for an email; /contact/ asks for a name and a number
      // as well, and the validator stops at the first empty field. Fill every
      // field so what is under test is the email rule, not field count.
      const input = inputs.find((i) => i.type === 'email') || inputs[0];
      const status = form.querySelector('.form__status');
      const submit = form.querySelector('button[type=submit]');
      const fill = (email) => {
        for (const i of inputs) {
          i.value = i.type === 'email' ? email : i.type === 'tel' ? '+91 98765 43210' : 'Test Name';
        }
      };
      const out = {};

      fill('not-an-email');
      submit.click();
      await wait(200);
      out.invalid = { text: status.textContent.trim(), cls: status.className, kept: input.value };

      fill('someone@example.com');
      submit.click();
      await wait(200);
      out.valid = {
        text: status.textContent.trim(),
        cls: status.className,
        cleared: inputs.every((i) => i.value === ''),
      };

      out.novalidate = form.hasAttribute('novalidate');
      out.statusRole = status.getAttribute('role');
      out.inputLabelled = Boolean(input.labels?.length || input.getAttribute('aria-label') || input.getAttribute('aria-labelledby'));
      out.inputType = input.type;
      out.autocomplete = input.getAttribute('autocomplete');
      return out;
    });
    if (!r.invalid.text) bad(route, 'form', 'invalid email produced no message');
    else if (!/is-err/.test(r.invalid.cls)) bad(route, 'form', `invalid email message "${r.invalid.text}" not styled as an error`);
    else ok(route, 'form rejects invalid email');
    if (!/is-ok/.test(r.valid.cls)) bad(route, 'form', `valid email did not reach the success state (${r.valid.cls})`);
    else ok(route, 'form accepts valid email');
    if (!r.valid.cleared) bad(route, 'form', 'input not cleared after success');
    if (!r.inputLabelled) bad(route, 'form', 'email input has no <label> or aria-label — placeholder is not a label');
    if (!r.autocomplete) bad(route, 'form', 'email input has no autocomplete attribute');
    if (r.statusRole !== 'status') bad(route, 'form', `status region role="${r.statusRole}", expected "status"`);
  }
  for (const e of errs) bad(route, 'console', e);
  await p.close();
}

// --- coverage filter / tabs ------------------------------------------------
{
  const route = '/platform/';
  const { p, errs } = await open(route);
  const has = await p.$('[data-coverage]');
  if (has) {
    const r = await p.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const root = document.querySelector('[data-coverage]');
      const list = root.querySelector('[data-coverage-list]') || root;
      const buttons = [...root.querySelectorAll('button')];
      const visible = () => [...list.children].filter((c) => c.getBoundingClientRect().height > 0).length;
      const out = { buttons: buttons.length, counts: [], empty: [] };
      for (const b of buttons) {
        b.click();
        await wait(350);
        const n = visible();
        out.counts.push([b.innerText.trim().slice(0, 20), n]);
        if (n === 0) out.empty.push(b.innerText.trim().slice(0, 20));
      }
      return out;
    });
    if (!r.buttons) bad(route, 'coverage', 'no filter buttons found');
    else {
      if (r.empty.length) bad(route, 'coverage', `filters showing zero results: ${r.empty.join(', ')}`);
      else ok(route, `coverage filters return results (${r.counts.map(([n, c]) => `${n}:${c}`).join(' ')})`);
    }
  }
  for (const e of errs) bad(route, 'console', e);
  await p.close();
}

// --- orbit rings / agents --------------------------------------------------
{
  const route = '/';
  const { p, errs } = await open(route);
  const has = await p.$('[data-agents]');
  if (has) {
    const r = await p.evaluate(async () => {
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      const root = document.querySelector('[data-agents]');
      root.scrollIntoView({ block: 'center' });
      await wait(700);
      const items = [...root.querySelectorAll('[data-agent-value], li, button')].slice(0, 8);
      const out = { items: items.length, activeAfter: [], canvas: null };
      const c = document.querySelector('[data-orbit]');
      if (c) out.canvas = { w: c.width, h: c.height };
      for (const it of items) {
        (it.querySelector('button') || it).click();
        await wait(250);
        out.activeAfter.push(root.querySelectorAll('.is-active, [aria-selected=true], [aria-current]').length);
      }
      return out;
    });
    if (r.canvas && (!r.canvas.w || !r.canvas.h)) bad(route, 'orbit', `orbit canvas is ${r.canvas.w}x${r.canvas.h}`);
    else if (r.canvas) ok(route, `orbit canvas sized ${r.canvas.w}x${r.canvas.h}`);
    if (r.items && r.activeAfter.every((n) => n === 0)) bad(route, 'agents', 'clicking an agent never marks anything active');
    else if (r.items) ok(route, 'agent selection marks active state');
  }
  for (const e of errs) bad(route, 'console', e);
  await p.close();
}

// --- keyboard reachability + focus visibility ------------------------------
{
  const route = '/';
  const { p, errs } = await open(route);
  const r = await p.evaluate(() => {
    const focusables = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden');
    const out = { total: focusables.length, noFocusStyle: [], negTab: 0 };
    for (const el of focusables.slice(0, 40)) {
      el.focus();
      if (document.activeElement !== el) continue;
      const s = getComputedStyle(el);
      // A focus ring is an outline, a box-shadow, or a border change. If none of
      // the three differ under :focus-visible the control is invisible to
      // keyboard users.
      const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const shadow = s.boxShadow && s.boxShadow !== 'none';
      if (!ring && !shadow) {
        out.noFocusStyle.push(el.tagName.toLowerCase() + ':' + (el.innerText || el.name || '').trim().slice(0, 20));
      }
    }
    out.noFocusStyle = out.noFocusStyle.slice(0, 8);
    return out;
  });
  // .focus() alone does not always set :focus-visible in headless, so this is a
  // hint rather than a hard failure — the Tab-driven check below is the real one.
  const tabbed = await (async () => {
    await p.evaluate(() => document.body.focus());
    const seen = [];
    for (let i = 0; i < 12; i++) {
      await p.keyboard.press('Tab');
      // html has scroll-behavior: smooth, so focus scrolls its target into
      // view over ~400ms. Measuring before that lands reports controls as
      // off-screen that are on their way in.
      await p.evaluate(
        () =>
          new Promise((res) => {
            let last = -1;
            let still = 0;
            const tick = () => {
              if (window.scrollY === last) still++;
              else still = 0;
              last = window.scrollY;
              if (still > 6) res();
              else requestAnimationFrame(tick);
            };
            tick();
          })
      );
      seen.push(
        await p.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase(),
            name: (el.innerText || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 24),
            outline: parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== 'none',
            shadow: Boolean(s.boxShadow && s.boxShadow !== 'none'),
            inView: (() => {
              const b = el.getBoundingClientRect();
              return b.bottom > 0 && b.top < window.innerHeight;
            })(),
          };
        })
      );
    }
    return seen.filter(Boolean);
  })();
  const noRing = tabbed.filter((t) => !t.outline && !t.shadow);
  if (!tabbed.length) bad(route, 'keyboard', 'Tab reached no focusable element');
  else ok(route, `Tab reaches ${tabbed.length} controls`);
  if (noRing.length) bad(route, 'focus ring', `no visible focus indicator on: ${noRing.map((t) => `${t.tag} "${t.name}"`).join(', ')}`);
  else ok(route, 'every tabbed control shows a focus ring');
  const offscreen = tabbed.filter((t) => !t.inView);
  if (offscreen.length) bad(route, 'focus', `focus moved to off-screen control(s): ${offscreen.map((t) => t.name).join(', ')}`);
  const skip = await p.evaluate(() => Boolean(document.querySelector('a[href^="#"]:first-of-type')?.textContent.match(/skip/i)));
  if (!skip) bad(route, 'a11y', 'no skip-to-content link — keyboard users tab through the whole nav on every page');
  for (const e of errs) bad(route, 'console', e);
  await p.close();
}

// --- reduced motion --------------------------------------------------------
{
  const route = '/';
  const p = await browser.newPage();
  await p.setViewport({ width: W, height: H });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message || e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.goto(BASE + route, { waitUntil: 'networkidle0' });
  await settle(p, 800);
  const r = await p.evaluate(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const track = document.querySelector('.marquee__track');
    const t1 = track?.style.transform;
    await wait(700);
    const t2 = track?.style.transform;
    // Reveals must resolve to visible without motion, or the page reads blank.
    // Scroll the whole page first: reduced motion drops the travel, not the
    // reveal, so anything still below the fold is legitimately at opacity 0
    // and counting it here fails the site for behaving correctly.
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight * 0.6) {
      window.scrollTo(0, y);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      await wait(60);
    }
    await wait(600);
    const hidden = [...document.querySelectorAll('[data-reveal]')].filter(
      (el) => parseFloat(getComputedStyle(el).opacity) < 0.1
    ).length;
    const counters = [...document.querySelectorAll('[data-count]')].map((c) => c.textContent.trim());
    return { marqueeMoved: t1 !== t2, hiddenReveals: hidden, totalReveals: document.querySelectorAll('[data-reveal]').length, counters };
  });
  if (r.marqueeMoved) bad(route, 'reduced motion', 'marquee still animates under prefers-reduced-motion: reduce');
  else ok(route, 'reduced motion stops the marquee');
  if (r.hiddenReveals) bad(route, 'reduced motion', `${r.hiddenReveals}/${r.totalReveals} [data-reveal] elements stay at opacity 0 — content invisible`);
  else ok(route, 'reduced motion still reveals content');
  if (r.counters.some((c) => c === '0' || c === '')) bad(route, 'reduced motion', `counter stuck at "${r.counters.find((c) => c === '0' || c === '')}"`);
  for (const e of errs) bad(route, 'console', e);
  await p.close();
}

// --- resize storm + WebGL context loss -------------------------------------
{
  const route = '/';
  const { p, errs } = await open(route);
  for (const [w, h] of [[600, 800], [1900, 700], [375, 700], [1440, 900]]) {
    await p.setViewport({ width: w, height: h });
    await settle(p, 180);
  }
  await settle(p, 700);
  const afterResize = await p.evaluate(() => {
    const c = document.querySelector('[data-particles]');
    const r = c.getBoundingClientRect();
    return { cssW: Math.round(r.width), cssH: Math.round(r.height), bufW: c.width, bufH: c.height, dpr: window.devicePixelRatio };
  });
  const wantW = Math.round(afterResize.cssW * afterResize.dpr);
  if (Math.abs(afterResize.bufW - wantW) > 2) {
    bad(route, 'resize', `particle canvas buffer ${afterResize.bufW}px vs expected ${wantW}px after resize storm`);
  } else ok(route, 'canvas resizes cleanly under a resize storm');
  if (errs.length === 0) ok(route, 'no errors during resize storm');
  for (const e of errs) bad(route, 'console', e);

  const lost = await p.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const c = document.querySelector('[data-particles]');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_lose_context');
    if (!ext) return { skipped: true };
    let restored = false;
    c.addEventListener('webglcontextrestored', () => (restored = true));
    ext.loseContext();
    await wait(300);
    ext.restoreContext();
    await wait(900);
    return { skipped: false, restored, blank: c.width === 0 };
  });
  if (lost.skipped) ok(route, 'WEBGL_lose_context unavailable — context-loss check skipped');
  else if (!lost.restored) bad(route, 'webgl', 'context lost and never restored — canvas stays dead after a GPU reset');
  else ok(route, 'WebGL context restores after loss');
  await p.close();
}

// --- scroll storm ----------------------------------------------------------
{
  const route = '/';
  const { p, errs } = await open(route);
  await p.evaluate(async () => {
    const wait = () => new Promise((r) => requestAnimationFrame(r));
    const max = document.body.scrollHeight;
    for (let i = 0; i < 40; i++) {
      window.scrollTo(0, Math.random() * max);
      await wait();
    }
    window.scrollTo(0, 0);
  });
  await settle(p, 600);
  const alive = await p.evaluate(() => {
    const c = document.querySelector('[data-particles]');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { ctx: Boolean(gl && !gl.isContextLost()), h: document.body.scrollHeight };
  });
  if (!alive.ctx) bad(route, 'scroll storm', 'WebGL context lost after random scrolling');
  else ok(route, 'survives 40 random scroll jumps');
  for (const e of errs) bad(route, 'console', e);
  await p.close();
}

await browser.close();

const fails = results.filter((r) => !r.pass);
console.log('\n=== PASS ===');
for (const r of results.filter((x) => x.pass)) console.log(`  ok   ${r.page.padEnd(12)} ${r.what}`);
console.log('\n=== FAIL ===');
if (!fails.length) console.log('  (none)');
for (const r of fails) console.log(`  FAIL ${r.page.padEnd(12)} [${r.what}] ${r.detail}`);
console.log(`\n${results.length - fails.length} passed, ${fails.length} failed @${W}px`);
