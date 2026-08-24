// Static + runtime audit of every route at every breakpoint.
//
// One page load per (route, width): loading is the slow part and every check
// here is a read of the settled DOM, so they share a load rather than each
// paying for their own. Findings are printed grouped by route so a failure
// reads as "this page is broken" rather than as a flat list of selectors.
//
//   node tools/audit.mjs [width ...]

import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:4322';
const ROUTES = ['/', '/platform/', '/pricing/', '/security/', '/about/', '/contact/', '/nope/'];
const WIDTHS = process.argv.slice(2).map(Number).filter(Boolean);
const SIZES = (WIDTHS.length ? WIDTHS : [375, 768, 1024, 1440, 2560]).map((w) => ({
  w,
  h: w < 500 ? 812 : w < 900 ? 1024 : 900,
}));

const findings = [];
const add = (route, size, level, kind, detail) =>
  findings.push({ route, size, level, kind, detail });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

for (const route of ROUTES) {
  for (const size of SIZES) {
    const tag = `${size.w}x${size.h}`;
    const p = await browser.newPage();
    await p.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 1 });

    const consoleErrors = [];
    const pageErrors = [];
    const failed = [];
    p.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`);
    });
    p.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    p.on('requestfailed', (r) => failed.push(`${r.url()} — ${r.failure()?.errorText}`));
    p.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });

    let status = 0;
    try {
      const res = await p.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 30000 });
      status = res?.status() ?? 0;
    } catch (e) {
      add(route, tag, 'ERROR', 'load', String(e.message));
      await p.close();
      continue;
    }

    // A full scroll pass before measuring: reveals, counters and the particle
    // field are all scroll-driven, so a page measured at rest is a page with
    // most of its behaviour never having run.
    await p.evaluate(async () => {
      const step = window.innerHeight * 0.7;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 250));
    });

    const expect404 = route === '/nope/';
    if (expect404 && status !== 404) add(route, tag, 'ERROR', 'status', `custom 404 route returned ${status}`);
    if (!expect404 && status !== 200) add(route, tag, 'ERROR', 'status', `returned ${status}`);

    const report = await p.evaluate(() => {
      const out = {
        overflow: null,
        wideEls: [],
        dupIds: [],
        emptyLinks: [],
        badAnchors: [],
        brokenImgs: [],
        noAltImgs: [],
        unlabelledFields: [],
        unnamedButtons: [],
        headingJumps: [],
        meta: {},
        canvases: [],
        smallTargets: [],
        h1Count: document.querySelectorAll('h1').length,
        langAttr: document.documentElement.lang || null,
        titleLen: (document.title || '').length,
      };

      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) {
        out.overflow = { scrollWidth: document.documentElement.scrollWidth, clientWidth: vw };
        // Blaming the widest element is not enough — an ancestor with a fixed
        // width makes every descendant look guilty. Report the shallowest
        // offenders instead, which is where the fix actually goes.
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1 || r.left < -1) {
            const parent = el.parentElement;
            const pr = parent?.getBoundingClientRect();
            if (pr && (pr.right > vw + 1 || pr.left < -1)) continue;
            out.wideEls.push({
              sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
              left: Math.round(r.left),
              right: Math.round(r.right),
            });
          }
        }
        out.wideEls = out.wideEls.slice(0, 8);
      }

      const seen = new Map();
      for (const el of document.querySelectorAll('[id]')) {
        seen.set(el.id, (seen.get(el.id) || 0) + 1);
      }
      out.dupIds = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `#${id} x${n}`);

      // Trim each candidate before falling through. innerText on a
      // display:none element returns textContent, so a control whose only child
      // is an empty <span> yields whitespace — truthy, which swallows the
      // aria-label that follows it and reports a labelled control as unnamed.
      // textContent last, because innerText returns '' for anything inside a
      // visibility:hidden subtree — a closed mobile menu, say — and its links
      // are perfectly well named, just not rendered right now.
      const accName = (el) =>
        (el.innerText || '').trim() ||
        (el.getAttribute('aria-label') || '').trim() ||
        (el.getAttribute('title') || '').trim() ||
        (el.textContent || '').trim();

      for (const a of document.querySelectorAll('a')) {
        const href = a.getAttribute('href');
        const name = accName(a) || (a.querySelector('img')?.alt || '').trim();
        if (!href || href === '#') out.emptyLinks.push(name || a.outerHTML.slice(0, 60));
        else if (href.startsWith('#')) {
          if (!document.querySelector(href)) out.badAnchors.push(href);
        }
        if (!name) out.emptyLinks.push(`(no accessible name) ${a.outerHTML.slice(0, 80)}`);
      }

      for (const img of document.querySelectorAll('img')) {
        if (img.complete && img.naturalWidth === 0) out.brokenImgs.push(img.currentSrc || img.src);
        if (img.getAttribute('alt') === null) out.noAltImgs.push(img.src);
      }

      for (const f of document.querySelectorAll('input, textarea, select')) {
        if (f.type === 'hidden') continue;
        const labelled =
          f.labels?.length ||
          f.getAttribute('aria-label') ||
          f.getAttribute('aria-labelledby') ||
          (f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`));
        if (!labelled) out.unlabelledFields.push(f.name || f.type || f.tagName);
      }

      for (const b of document.querySelectorAll('button')) {
        if (!accName(b)) out.unnamedButtons.push(b.outerHTML.slice(0, 80));
      }

      let prev = 0;
      for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
        const lvl = +h.tagName[1];
        if (prev && lvl > prev + 1) out.headingJumps.push(`h${prev} -> h${lvl}: ${h.innerText.slice(0, 40)}`);
        prev = lvl;
      }

      const m = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr) || null;
      out.meta = {
        title: document.title || null,
        description: m('meta[name="description"]'),
        canonical: m('link[rel="canonical"]', 'href'),
        ogTitle: m('meta[property="og:title"]'),
        ogImage: m('meta[property="og:image"]'),
        ogUrl: m('meta[property="og:url"]'),
        viewport: m('meta[name="viewport"]'),
        favicon: m('link[rel="icon"]', 'href'),
      };

      for (const c of document.querySelectorAll('canvas')) {
        out.canvases.push({
          id: c.id || c.dataset.particles !== undefined ? 'particles' : c.className || 'canvas',
          w: c.width,
          h: c.height,
          blank: c.width === 0 || c.height === 0,
        });
      }

      if (window.innerWidth < 500) {
        for (const el of document.querySelectorAll('a, button, input[type=submit]')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 24 || r.width < 24) {
            out.smallTargets.push(`${el.tagName.toLowerCase()} "${(el.innerText || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        out.smallTargets = out.smallTargets.slice(0, 10);
      }

      return out;
    });

    for (const e of pageErrors) add(route, tag, 'ERROR', 'js-exception', e);
    for (const e of consoleErrors) add(route, tag, 'ERROR', 'console', e);
    for (const f of [...new Set(failed)]) {
      if (expect404 && f.startsWith('404 ')) continue;
      add(route, tag, 'ERROR', 'request', f);
    }

    if (report.overflow) {
      add(route, tag, 'ERROR', 'h-overflow', `scrollWidth ${report.overflow.scrollWidth} > ${report.overflow.clientWidth}`);
      for (const w of report.wideEls) add(route, tag, 'ERROR', 'h-overflow-el', `${w.sel} [${w.left}..${w.right}]`);
    }
    for (const d of report.dupIds) add(route, tag, 'ERROR', 'duplicate-id', d);
    for (const a of [...new Set(report.badAnchors)]) add(route, tag, 'ERROR', 'dead-anchor', a);
    for (const i of report.brokenImgs) add(route, tag, 'ERROR', 'broken-img', i);
    for (const c of report.canvases) if (c.blank) add(route, tag, 'ERROR', 'blank-canvas', c.id);

    for (const l of [...new Set(report.emptyLinks)]) add(route, tag, 'WARN', 'link', l);
    for (const i of report.noAltImgs) add(route, tag, 'WARN', 'img-no-alt', i);
    for (const f of report.unlabelledFields) add(route, tag, 'WARN', 'unlabelled-field', f);
    for (const b of report.unnamedButtons) add(route, tag, 'WARN', 'unnamed-button', b);
    for (const h of report.headingJumps) add(route, tag, 'WARN', 'heading-jump', h);
    for (const t of report.smallTargets) add(route, tag, 'WARN', 'small-tap-target', t);

    // Metadata is a per-route property, so it only needs checking once.
    if (size === SIZES[0]) {
      const meta = report.meta;
      if (!meta.title) add(route, '-', 'ERROR', 'meta', 'no <title>');
      else if (report.titleLen > 60) add(route, '-', 'WARN', 'meta', `title ${report.titleLen} chars (>60 truncates in SERPs)`);
      if (!meta.description) add(route, '-', 'WARN', 'meta', 'no meta description');
      if (!meta.canonical && !expect404) add(route, '-', 'WARN', 'meta', 'no canonical');
      if (!meta.ogTitle) add(route, '-', 'WARN', 'meta', 'no og:title');
      if (!meta.ogImage) add(route, '-', 'WARN', 'meta', 'no og:image');
      if (!meta.viewport) add(route, '-', 'ERROR', 'meta', 'no viewport meta');
      if (!meta.favicon) add(route, '-', 'WARN', 'meta', 'no favicon link');
      if (!report.langAttr) add(route, '-', 'WARN', 'a11y', 'no <html lang>');
      if (report.h1Count !== 1) add(route, '-', 'WARN', 'a11y', `${report.h1Count} <h1> on page`);
      if (meta.canonical && !expect404) {
        const want = `https://alphe.in${route}`;
        if (meta.canonical !== want) add(route, '-', 'WARN', 'meta', `canonical ${meta.canonical} != ${want}`);
      }
      if (meta.ogUrl && !expect404) {
        const want = `https://alphe.in${route}`;
        if (meta.ogUrl !== want) add(route, '-', 'WARN', 'meta', `og:url ${meta.ogUrl} != ${want}`);
      }
    }

    await p.close();
  }
}

await browser.close();

const errors = findings.filter((f) => f.level === 'ERROR');
const warns = findings.filter((f) => f.level === 'WARN');

// Same defect at five widths is one defect, not five. Collapse on the text and
// list the widths it appeared at.
const group = (list) => {
  const m = new Map();
  for (const f of list) {
    const k = `${f.route} ${f.kind} ${f.detail}`;
    if (!m.has(k)) m.set(k, { ...f, sizes: [] });
    m.get(k).sizes.push(f.size);
  }
  return [...m.values()];
};

for (const [label, list] of [['ERRORS', group(errors)], ['WARNINGS', group(warns)]]) {
  console.log(`\n=== ${label} (${list.length} distinct) ===`);
  let last = '';
  for (const f of list) {
    if (f.route !== last) {
      console.log(`\n  ${f.route}`);
      last = f.route;
    }
    const at = f.sizes[0] === '-' ? '' : ` @${f.sizes.join(',')}`;
    console.log(`    [${f.kind}]${at} ${f.detail}`);
  }
}

console.log(`\n${errors.length} error rows, ${warns.length} warning rows across ${ROUTES.length} routes x ${SIZES.length} widths`);
