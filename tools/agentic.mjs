// What an agent gets when it asks for this site.
//
//   node tools/agentic.mjs
//   ALPHE_BASE=http://localhost:4399 node tools/agentic.mjs
//   ALPHE_PHP=http://127.0.0.1:8899 node tools/agentic.mjs   also test negotiate.php
//   ALPHE_XFP=1 node tools/agentic.mjs                       local Apache reading .htaccess
//
// The readiness audit that prompted this file checked five things a browser
// never exercises: whether `Accept: text/markdown` gets Markdown, whether the
// response says `Vary: Accept`, whether a wrong path fails usefully, whether
// the HTML carries content before the JavaScript runs, and whether anything on
// the site says when to use the product. All five are invisible in a browser
// and all five broke silently, so they get a gate.
//
// serve.mjs is the reference implementation here: it mirrors negotiate.php,
// which is what production runs, and tools/headers.mjs already fails on drift
// between the four copies of the header policy. Set ALPHE_PHP to a
// `php -S 127.0.0.1:8899 -t site` and the same matrix runs against the PHP
// negotiator directly, which is the code Hostinger actually executes.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = (process.env.ALPHE_BASE || 'http://localhost:4322').replace(/\/$/, '');
const PHP = process.env.ALPHE_PHP ? process.env.ALPHE_PHP.replace(/\/$/, '') : null;

const ROUTES = ['/', '/platform/', '/pricing/', '/docs/', '/about/', '/contact/'];
const MD = {
  '/': '/index.md',
  '/platform/': '/platform/index.md',
  '/pricing/': '/pricing/index.md',
  '/docs/': '/docs/index.md',
  '/about/': '/about/index.md',
  '/contact/': '/contact/index.md',
};

// One node per page has to be about the page rather than about the site: the
// home page is the WebSite itself, every other route says which kind of page it
// is. BreadcrumbList alone is navigation, not content.
const PAGE_TYPES = ['WebSite', 'WebPage', 'AboutPage', 'ContactPage', 'TechArticle', 'SoftwareApplication'];

let failures = 0;
let checks = 0;

function ok(name, pass, detail = '') {
  checks++;
  if (!pass) failures++;
  const mark = pass ? '✓' : '✗';
  console.log(`${mark} ${name}${detail ? `  ${detail}` : ''}`);
}

// .htaccess redirects http to https on the first request, which a local Apache
// run over plain http would bounce forever. Production sits behind a proxy that
// terminates TLS and says so with this header, and the rule reads it, so the
// harness says the same thing rather than the rule being softened for the test.
const XFP = process.env.ALPHE_XFP ? { 'X-Forwarded-Proto': 'https' } : {};

async function get(url, accept, method = 'GET') {
  const res = await fetch(url, {
    method,
    headers: { ...XFP, ...(accept ? { Accept: accept } : {}) },
    redirect: 'manual',
  });
  const body = method === 'HEAD' ? '' : await res.text();
  return {
    status: res.status,
    type: (res.headers.get('content-type') || '').toLowerCase(),
    vary: (res.headers.get('vary') || '').toLowerCase(),
    link: res.headers.get('link') || '',
    server: (res.headers.get('server') || '').toLowerCase(),
    body,
  };
}

// A URL on the negotiating server. serve.mjs negotiates on the route itself;
// php -S has no rewrite engine, so the same request reaches negotiate.php the
// way .htaccess sends it in production.
// A Vary that came back without Accept is usually not this repo's fault — the
// origin sent it and an edge cache in front rewrote it. Naming the server that
// answered turns a bare "none" into somewhere to look; DEPLOY.md has the probe
// that asks the origin directly.
const varyDetail = (r) => r.vary || `none, from ${r.server || 'an unnamed server'}`;

const at = (base, route) =>
  base === PHP ? `${base}/negotiate.php?path=${encodeURIComponent(route)}` : `${base}${route}`;

// ---------------------------------------------------------------- negotiation

async function negotiation(base, label) {
  console.log(`\n— content negotiation (${label}) —`);

  for (const route of ROUTES) {
    const md = await get(at(base, route), 'text/markdown');
    ok(`${route} Accept: text/markdown → markdown`,
      md.status === 200 && md.type.startsWith('text/markdown'),
      `${md.status} ${md.type}`);

    ok(`${route} markdown response varies on Accept`,
      md.vary.includes('accept'),
      varyDetail(md));

    // The body has to be the twin, not a stray file that happens to be text.
    const twin = await get(`${BASE}${MD[route]}`, '*/*');
    ok(`${route} markdown body matches ${MD[route]}`,
      md.body.trim() === twin.body.trim(),
      `${md.body.length} vs ${twin.body.length} bytes`);

    const html = await get(at(base, route), 'text/html');
    ok(`${route} Accept: text/html → html`,
      html.status === 200 && html.type.startsWith('text/html'),
      `${html.status} ${html.type}`);

    ok(`${route} html response varies on Accept`,
      html.vary.includes('accept'),
      varyDetail(html));
  }

  // q-values decide it, and a wildcard is not a request for Markdown. RFC 9110
  // §12.5.1: a range is more specific than a wildcard, and q=0 means "not
  // acceptable", not "last resort".
  const cases = [
    ['text/markdown;q=0.9, text/html;q=0.8', 200, 'text/markdown', 'markdown wins on q'],
    ['text/markdown;q=0.8, text/html;q=0.9', 200, 'text/html', 'html wins on q'],
    ['text/markdown, */*', 200, 'text/markdown', 'exact range beats wildcard'],
    ['*/*', 200, 'text/html', 'wildcard alone stays html'],
    ['text/*', 200, 'text/html', 'text/* stays html'],
    ['', 200, 'text/html', 'no Accept stays html'],
    ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 200, 'text/html', 'browser string stays html'],
    ['application/json', 406, 'text/plain', 'unsupported type is 406'],
    ['text/html;q=0', 406, 'text/plain', 'html refused with q=0 is 406'],
    ['text/markdown;q=0', 406, 'text/plain', 'markdown refused with q=0 is 406'],
    ['text/markdown;q=0, text/html', 200, 'text/html', 'markdown at q=0 falls to html'],
  ];
  for (const [accept, status, type, name] of cases) {
    const r = await get(at(base, '/'), accept);
    ok(`/ ${name}`,
      r.status === status && r.type.startsWith(type),
      `${accept || '(none)'} → ${r.status} ${r.type}`);
  }

  // 406 is only useful if it says what it does have.
  const r406 = await get(at(base, '/'), 'application/json');
  ok('406 body names both representations',
    r406.body.includes('text/html') && r406.body.includes('text/markdown'),
    `${r406.body.length} bytes`);
  ok('406 links the alternates',
    /rel="alternate"/.test(r406.link),
    r406.link.slice(0, 60) || 'no Link header');

  // HEAD is a GET without the body, including the negotiated headers.
  const head = await get(at(base, '/'), 'text/markdown', 'HEAD');
  ok('HEAD negotiates like GET',
    head.status === 200 && head.type.startsWith('text/markdown') && head.vary.includes('accept'),
    `${head.status} ${head.type}, vary ${varyDetail(head)}`);
}

// ------------------------------------------------------------------ 404 paths

async function notFound(base, label) {
  console.log(`\n— missing routes (${label}) —`);

  const md = await get(base === PHP ? `${base}/negotiate.php?path=/nope` : `${base}/nope`, 'text/markdown');
  ok('unknown path + markdown → 404 markdown',
    md.status === 404 && md.type.startsWith('text/markdown'),
    `${md.status} ${md.type}`);
  ok('404 markdown body lists the routes that exist',
    ROUTES.every((r) => md.body.includes(`alpheai.com${r}`)),
    `${md.body.length} bytes`);
  ok('404 markdown body points at the machine-readable index',
    md.body.includes('/llms.txt') && md.body.includes('/sitemap.xml') && md.body.includes('/agents.md'));

  const html = await get(base === PHP ? `${base}/negotiate.php?path=/nope` : `${base}/nope`, 'text/html');
  ok('unknown path + html → 404 html',
    html.status === 404 && html.type.startsWith('text/html'),
    `${html.status} ${html.type}`);
  ok('404 html body links every route',
    ROUTES.every((r) => html.body.includes(`href="${r}"`)),
    `${html.body.length} bytes`);
  ok('404 html is noindex',
    /<meta name="robots" content="noindex"/.test(html.body));
}

// ------------------------------------------------------- content without JS

async function rawHtml() {
  console.log('\n— raw html, before any script runs —');

  for (const route of ROUTES) {
    const r = await get(`${BASE}${route}`, 'text/html');
    const body = r.body;

    const text = body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const h1 = (body.match(/<h1[\s>]/g) || []).length;
    const levels = [...body.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    let jump = null;
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] > levels[i - 1] + 1) jump = `${levels[i - 1]}→${levels[i]}`;
    }

    ok(`${route} exactly one h1`, h1 === 1, `${h1}`);
    ok(`${route} has h2 and h3`,
      levels.includes(2) && levels.includes(3),
      `h2:${levels.filter((l) => l === 2).length} h3:${levels.filter((l) => l === 3).length}`);
    ok(`${route} heading depth never skips a level`, jump === null, jump || 'clean');
    ok(`${route} 500+ chars of text in the raw html`, text.length >= 500, `${text.length}`);
    ok(`${route} declares its markdown twin`,
      body.includes(`<link rel="alternate" type="text/markdown" href="${MD[route]}"`));
    ok(`${route} declares a canonical url`,
      new RegExp(`<link rel="canonical" href="https://alpheai\\.com${route}"`).test(body));

    // The audit read the site off meta descriptions because there was little
    // else to read. Structured data is the other half of that answer, and a
    // block that does not parse is worse than none — consumers drop the whole
    // graph, silently.
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => m[1]);
    let types = [];
    let bad = null;
    for (const block of blocks) {
      try {
        const doc = JSON.parse(block);
        types = types.concat((doc['@graph'] || [doc]).map((n) => n['@type']));
      } catch (e) {
        bad = e.message;
      }
    }
    ok(`${route} json-ld parses`, blocks.length > 0 && !bad, bad || types.join(', '));
    ok(`${route} json-ld describes the page itself`,
      types.some((t) => PAGE_TYPES.includes(t)), types.join(', '));
  }
}

// ------------------------------------------------- machine-readable surface

async function machineReadable() {
  console.log('\n— machine-readable files —');

  const agents = await get(`${BASE}/agents.md`, '*/*');
  ok('/agents.md is served', agents.status === 200, `${agents.status} ${agents.type}`);
  ok('/agents.md is markdown', agents.type.includes('markdown'), agents.type);
  ok('/agents.md says when to use Alphe', /##\s*When to use Alphe/i.test(agents.body));
  ok('/agents.md says when not to', /##\s*When not to use Alphe/i.test(agents.body));
  ok('/agents.md says how to call the service', agents.body.includes('api.alpheai.com/v1'));

  // The convention spells the file AGENTS.md. The store is lowercase, so an
  // agent that probes the capitalised name has to be rewritten to it — and on a
  // case-insensitive filesystem this request answers itself, which is exactly
  // why the three rewrite declarations are asserted rather than only the fetch.
  const upper = await get(`${BASE}/AGENTS.md`, 'text/markdown');
  ok('/AGENTS.md resolves to the same file', upper.status === 200 && upper.body === agents.body,
    `${upper.status} ${upper.type}`);
  const htaccess = readFileSync(join(ROOT, 'site/.htaccess'), 'utf8');
  const vercel = readFileSync(join(ROOT, 'vercel.json'), 'utf8');
  const serve = readFileSync(join(ROOT, 'serve.mjs'), 'utf8');
  ok('AGENTS.md alias is declared for Hostinger', /RewriteRule \^AGENTS\\\.md\$ \/agents\.md/.test(htaccess));
  ok('AGENTS.md alias is declared for Vercel',
    /"source":\s*"\/AGENTS\.md",\s*"destination":\s*"\/agents\.md"/.test(vercel));
  ok('AGENTS.md alias is declared for localhost', /'\/AGENTS\.md':\s*'\/agents\.md'/.test(serve));
  // The charset itself is asserted by fetching the files, further down. This
  // asserts the mechanism, because the two servers do not implement the same
  // one: AddCharset is Apache-only, LiteSpeed ignores it without a word, and
  // the live site served bare text/plain and text/markdown for a full deploy
  // while every local gate stayed green. A parameter inside the media type and
  // AddDefaultCharset are the two both servers honour.
  ok('the charset is declared in a way LiteSpeed honours too',
    /AddType text\/markdown;charset=utf-8 \.md/.test(htaccess) &&
      /^AddDefaultCharset utf-8$/m.test(htaccess));

  const llms = await get(`${BASE}/llms.txt`, '*/*');
  ok('/llms.txt is served', llms.status === 200, `${llms.status}`);
  ok('/llms.txt lists every page',
    ROUTES.every((r) => llms.body.includes(`https://alpheai.com${r}`)));
  ok('/llms.txt has a when-to-use section', /##\s*When to use Alphe/i.test(llms.body));
  ok('/llms.txt points at agents.md and llms-full.txt',
    llms.body.includes('/agents.md') && llms.body.includes('/llms-full.txt'));

  const full = await get(`${BASE}/llms-full.txt`, '*/*');
  ok('/llms-full.txt is served', full.status === 200, `${full.status}`);
  ok('/llms-full.txt contains every page',
    ROUTES.every((r) => full.body.includes(`Source: https://alpheai.com${r}`)),
    `${(full.body.length / 1024).toFixed(0)} KB`);

  const map = await get(`${BASE}/sitemap.xml`, '*/*');
  ok('/sitemap.xml is served', map.status === 200, `${map.status}`);
  ok('/sitemap.xml lists every route',
    ROUTES.every((r) => map.body.includes(`<loc>https://alpheai.com${r}</loc>`)));
  // noindex and listed in a sitemap are contradictory instructions. Only the
  // <loc> elements count — the file's comment explains the omission and says
  // "404" while doing it.
  ok('/sitemap.xml omits the 404', !/<loc>[^<]*404/.test(map.body));

  const robots = await get(`${BASE}/robots.txt`, '*/*');
  ok('/robots.txt is served', robots.status === 200, `${robots.status}`);
  ok('/robots.txt names the sitemap', robots.body.includes('Sitemap: https://alpheai.com/sitemap.xml'));
  ok('/robots.txt disallows nothing', !/^Disallow:\s*\/\s*$/m.test(robots.body));

  for (const [route, md] of Object.entries(MD)) {
    const r = await get(`${BASE}${md}`, '*/*');
    ok(`${md} is served as markdown`,
      r.status === 200 && r.type.includes('markdown'),
      `${r.status} ${r.type}`);
    ok(`${md} starts with an h1`, /^#\s+\S/m.test(r.body.split('\n')[0] || ''));
    ok(`${md} names its canonical url`,
      r.body.includes(`https://alpheai.com${route}`) || route === '/');
  }

  // Every one of these is text and every one of them contains em dashes. A
  // text/* response with no charset is the client's guess, and the three
  // servers used to disagree about whether to name it: node and Vercel did,
  // Apache did not.
  for (const f of ['/agents.md', '/llms.txt', '/llms-full.txt', '/sitemap.xml', '/robots.txt', '/index.md',
                   '/.well-known/security.txt']) {
    const r = await get(`${BASE}${f}`, '*/*');
    ok(`${f} declares utf-8`, r.type.includes('charset=utf-8'), r.type);
  }
}


// ------------------------------------------------------- well-known and keys

// Two files that are not read by people and are only correct if a machine can
// fetch them byte-for-byte: the RFC 9116 disclosure address, and the IndexNow
// key that proves to Bing and Yandex that whoever submitted a URL controls the
// host. Both live under paths the dev server used to refuse on principle, so
// the same section checks that the refusal still applies to everything else.
async function wellKnown() {
  console.log('\n— well-known files —');

  const sec = await get(`${BASE}/.well-known/security.txt`, '*/*');
  ok('/.well-known/security.txt is served', sec.status === 200, `${sec.status} ${sec.type}`);
  ok('/.well-known/security.txt is text/plain', sec.type.startsWith('text/plain'), sec.type);

  const field = (name) => sec.body.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1].trim() ?? null;
  ok('security.txt has a Contact field', field('Contact') !== null, field('Contact') || 'missing');

  // RFC 9116 §2.5.5: Expires is mandatory, and a file whose date has passed is
  // to be treated as stale rather than as advice. A year is the recommended
  // ceiling, so the gate fails before the file goes quietly out of date.
  const expires = field('Expires');
  const when = expires ? Date.parse(expires) : NaN;
  const year = 366 * 24 * 3600 * 1000;
  ok('security.txt has an Expires field', !Number.isNaN(when), expires || 'missing');
  ok('security.txt has not expired', when > Date.now(), expires || 'missing');
  ok('security.txt expires inside a year', when < Date.now() + year, expires || 'missing');
  ok('security.txt names its canonical url',
    field('Canonical') === 'https://alpheai.com/.well-known/security.txt',
    field('Canonical') || 'missing');

  // The key file's name is the key, and its body has to be the same string:
  // that identity is the whole of the IndexNow handshake.
  const keys = readdirSync(join(ROOT, 'site')).filter((f) => /^[0-9a-f]{8,128}\.txt$/.test(f));
  ok('exactly one IndexNow key file exists', keys.length === 1, `${keys.length}`);
  if (keys.length === 1) {
    const r = await get(`${BASE}/${keys[0]}`, '*/*');
    ok(`/${keys[0]} is served`, r.status === 200, `${r.status}`);
    ok(`/${keys[0]} contains its own name`, r.body.trim() === keys[0].replace(/\.txt$/, ''));
  }

  // .well-known is an exception to the rule that a dotted path is server
  // furniture, not content. The rule itself still has to hold.
  for (const hidden of ['/.htaccess', '/.alphe-leads/leads.csv']) {
    const r = await get(`${BASE}${hidden}`, '*/*');
    ok(`${hidden} is not served`, r.status === 403 || r.status === 404, `${r.status}`);
  }

  // Vercel's matcher is a Rust regex with no lookahead, so "wants markdown" and
  // "refuses markdown" cannot be one pattern. `missing` is the negation, and it
  // is the only thing standing between a q=0 refusal and a Markdown response.
  const rewrites = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).rewrites;
  const md = rewrites.filter((r) => String(r.destination).endsWith('.md') && r.has);
  ok('Vercel negotiates every route', md.length === ROUTES.length, `${md.length}`);
  ok('Vercel refuses markdown at q=0',
    md.length > 0 && md.every((r) => r.missing?.some((m) => /q=0/.test(m.value))),
    md.map((r) => r.source).join(' '));

  // `vercel dev` ignores has/missing entirely, so the only way to test these
  // patterns before they are live is to run the same Accept headers through
  // them here. Vercel matches the whole value, hence the anchors. The engine
  // there is Rust's regex rather than JavaScript's; nothing below uses a
  // construct the two disagree about, which is itself the reason the patterns
  // avoid lookahead.
  if (md.length) {
    const wants = new RegExp(`^(?:${md[0].has[0].value})$`);
    const refuses = new RegExp(`^(?:${md[0].missing[0].value})$`);
    const table = [
      ['text/markdown', true],
      ['text/html, text/markdown', true],
      ['text/markdown, */*', true],
      ['text/markdown;q=0', false],
      ['text/markdown;q=0.0', false],
      ['text/markdown; q=0', false],
      ['text/html,text/markdown;q=0', false],
      ['text/html', false],
      ['*/*', false],
      ['text/*', false],
      ['text/x-markdown', false],
      ['application/markdown', false],
      ['text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8', false],
    ];
    for (const [accept, markdown] of table) {
      ok(`Vercel ${markdown ? 'serves' : 'withholds'} markdown for "${accept.slice(0, 40)}"`,
        (wants.test(accept) && !refuses.test(accept)) === markdown);
    }
  }
}

// ------------------------------------------------------------------- run

console.log(`base ${BASE}${PHP ? `  php ${PHP}` : ''}`);

await negotiation(BASE, 'serve.mjs');
await notFound(BASE, 'serve.mjs');
if (PHP) {
  await negotiation(PHP, 'negotiate.php');
  await notFound(PHP, 'negotiate.php');
}
await rawHtml();
await machineReadable();
await wellKnown();

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
