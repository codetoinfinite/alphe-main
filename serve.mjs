import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Static host for the alphe site. Directory requests resolve to index.html so
// /platform/ works without a build step or a router.
//
// It also sends the same security headers production does, so a policy that
// would break the page there breaks it here first. Production is site/.htaccess
// on Hostinger and vercel.json on Vercel; `node tools/headers.mjs` checks that
// this file and both of those still say the same thing.

const ROOT = resolve(fileURLToPath(new URL('./site', import.meta.url)));
const PORT = Number(process.env.PORT || 4322);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// Kept in step with the "/(.*)" block in vercel.json.
const SECURITY = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  // Two representations per document URL — see negotiate() below and the
  // rewrite rules in site/.htaccess. Production sends this on every response,
  // so development does too or the gate that compares them fails.
  'vary': 'Accept, Accept-Encoding',
};

// Markdown content negotiation ---------------------------------------------
// The node mirror of site/negotiate.php. Production runs the PHP; this exists
// so `node tools/agentic.mjs` exercises the same decisions against localhost,
// and so a rule that changes in one place fails here before it ships.
const MD_ROUTES = {
  '/': ['/index.md', 200],
  '/platform/': ['/platform/index.md', 200],
  '/pricing/': ['/pricing/index.md', 200],
  '/docs/': ['/docs/index.md', 200],
  '/about/': ['/about/index.md', 200],
  '/contact/': ['/contact/index.md', 200],
};

// RFC 9110 12.5.1. spec: 3 = type/subtype, 2 = type/*, 1 = */*.
function acceptRanges(header) {
  return String(header || '')
    .split(',')
    .map((part) => {
      const bits = part.split(';');
      const range = (bits.shift() || '').trim().toLowerCase();
      if (!range.includes('/')) return null;
      const [type, sub] = range.split('/', 2).map((x) => x.trim());
      if (!type || !sub) return null;

      let q = 1;
      for (const param of bits) {
        const m = /^\s*q\s*=\s*([0-9]*\.?[0-9]+)\s*$/i.exec(param);
        if (m) {
          q = Number(m[1]);
          break;
        }
        // q= present but not a number: unusable, so read as unwanted.
        if (/^\s*q\s*=/i.test(param)) {
          q = 0;
          break;
        }
      }
      q = Math.min(1, Math.max(0, q));

      const spec = type !== '*' && sub !== '*' ? 3 : type !== '*' ? 2 : 1;
      return { type, sub, q, spec };
    })
    .filter(Boolean);
}

// The quality this Accept gives one concrete type, and how specifically it was
// named. Most specific match wins; equal specificity, highest q wins.
function quality(ranges, type, sub) {
  let best = { spec: 0, q: 0 };
  for (const r of ranges) {
    let spec = 0;
    if (r.type === '*' && r.sub === '*') spec = 1;
    else if (r.type === type && r.sub === '*') spec = 2;
    else if (r.type === type && r.sub === sub) spec = 3;
    else continue;
    if (spec > best.spec || (spec === best.spec && r.q > best.q)) best = { spec, q: r.q };
  }
  return best;
}

// 'markdown' | 'html' | 'none'. Markdown only when text/markdown is named
// exactly and wanted at least as much as HTML, so a browser, a bare */* and a
// missing Accept all keep the HTML they have always had.
function chooseType(header) {
  let ranges = acceptRanges(header);
  if (ranges.length === 0) ranges = [{ type: '*', sub: '*', q: 1, spec: 1 }];
  const md = quality(ranges, 'text', 'markdown');
  const html = quality(ranges, 'text', 'html');
  if (md.q <= 0 && html.q <= 0) return 'none';
  return md.spec === 3 && md.q > 0 && md.q >= html.q ? 'markdown' : 'html';
}

function notAcceptable(res, path, method) {
  res.writeHead(406, {
    ...SECURITY,
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-cache',
    link: `<${path}>; rel="alternate"; type="text/html", <${path}>; rel="alternate"; type="text/markdown"`,
  });
  res.end(
    method === 'HEAD'
      ? undefined
      : '406 Not Acceptable\n\n' +
          'This URL has two representations:\n' +
          '  text/html            the page\n' +
          '  text/markdown        the same page as Markdown\n\n' +
          'Send an Accept header naming one of them, or */*.\n' +
          'See https://acceptmarkdown.com and https://alpheai.com/agents.md\n'
  );
}

// Returns true when it has answered the request.
async function negotiate(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const path = decodeURIComponent((req.url || '/').split('?')[0]);
  const route = MD_ROUTES[path];
  const wanted = chooseType(req.headers.accept);

  if (!route) {
    // An unknown path asked for as markdown gets the 404 body as markdown.
    if (wanted !== 'markdown') return false;
    if (await resolveFile(path)) return false;
    const file = await resolveFile('/404.md');
    if (!file) return false;
    res.writeHead(404, { ...SECURITY, 'content-type': TYPES['.md'], 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
    return true;
  }

  if (wanted === 'none') {
    notAcceptable(res, path, req.method);
    return true;
  }
  if (wanted !== 'markdown') return false;

  const [target, status] = route;
  const file = await resolveFile(target);
  if (!file) {
    // The twin is missing. Say so rather than quietly serving HTML instead.
    res.writeHead(500, { ...SECURITY, 'content-type': 'text/plain; charset=utf-8' });
    res.end(`500 Missing markdown twin for ${path} (expected site${target})\n`);
    return true;
  }
  res.writeHead(status, {
    ...SECURITY,
    'content-type': TYPES['.md'],
    'cache-control': 'no-cache',
    link: `<${path}>; rel="alternate"; type="text/html", </llms.txt>; rel="index"; type="text/plain"`,
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

async function resolveFile(urlPath) {
  // normalize() collapses "..", and the prefix check rejects anything that
  // still points outside the site directory.
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0]));
  let target = join(ROOT, clean);
  if (!target.startsWith(ROOT)) return null;

  // site/.htaccess is server configuration that happens to live in the document
  // root. Apache and LiteSpeed refuse to serve it; so does this, or the one
  // place the policy is written down is downloadable in development and the
  // difference never shows up until someone points a scanner at production.
  // .well-known is the one exception, and it is one by definition: RFC 8615
  // reserves it for files that are meant to be fetched, which is where
  // security.txt lives.
  if (clean.split('/').some((part) => part.startsWith('.') && part.length > 1 && part !== '.well-known'))
    return null;

  // Same reasoning for the endpoint: node cannot run it, so serving the file is
  // publishing the source of the one script on the site that touches mail.
  if (clean.toLowerCase().endsWith('.php')) return null;

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      target = join(target, 'index.html');
      await stat(target);
    }
    return target;
  } catch {
    return null;
  }
}

// site/contact.php is the form endpoint. Hostinger executes it; node has no
// idea what it is and would hand the source over as a download, so this serves
// it the only two ways that are not wrong: a POST gets the shape of the real
// answer, and anything else gets a 404.
//
// It validates nothing and stores nothing. The real endpoint is the one that
// decides, and a dev stub that grew its own copy of the rules would be a second
// thing to keep in step. What this exists to exercise is the client half — in
// flight, disabled button, the JSON contract, the error branch when `?fail` is
// on the URL. To exercise the endpoint itself, including the lead CSV, run the
// site under PHP instead: `php -S 127.0.0.1:4341 -t site`.
async function devEndpoint(req, res) {
  if (req.method !== 'POST') return false;
  if ((req.url || '').split('?')[0] !== '/contact.php') return false;

  let raw = '';
  for await (const chunk of req) raw += chunk;
  const fields = Object.fromEntries(new URLSearchParams(raw));
  // Load any page with ?fail on it to see what a submit does when the send
  // fails. The fetch goes to /contact.php with no query of its own, so the
  // switch has to come off the page that made it.
  const bad = /fail/.test((req.url || '') + (req.headers.referer || ''));

  console.log(`form ${bad ? '(forced failure) ' : ''}${JSON.stringify(fields)}`);
  res.writeHead(bad ? 502 : 200, { ...SECURITY, 'content-type': 'application/json; charset=utf-8' });
  res.end(
    JSON.stringify(
      bad ? { ok: false, error: 'Could not send — please email hello@alpheai.com' } : { ok: true }
    )
  );
  return true;
}

// The AGENTS.md convention spells the file in capitals; this site stores it
// lowercase, alongside llms.txt and robots.txt. Linux tells the two apart, so
// the capitalised probe is answered by rewriting it here, in .htaccess and in
// vercel.json rather than by keeping a second copy that can drift.
const ALIASES = { '/AGENTS.md': '/agents.md' };

const server = createServer(async (req, res) => {
  const [aliasPath, aliasQuery] = (req.url || '/').split('?');
  if (ALIASES[aliasPath]) req.url = ALIASES[aliasPath] + (aliasQuery ? '?' + aliasQuery : '');

  if (await devEndpoint(req, res)) return;
  if (await negotiate(req, res)) return;

  const file = await resolveFile(req.url || '/');

  if (!file) {
    // Same as production: unmatched paths get the site's own 404 page.
    console.log(`404 ${req.url}`);
    const page = await resolveFile('/404.html');
    res.writeHead(404, { ...SECURITY, 'content-type': 'text/html; charset=utf-8' });
    if (page) {
      createReadStream(page).pipe(res);
    } else {
      res.end('404 Not Found');
    }
    return;
  }

  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  const immutable = /\/assets\/(fonts|vendor)\//.test(file);

  res.writeHead(200, {
    ...SECURITY,
    'content-type': type,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });

  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`alphe → http://localhost:${PORT}/`);
});
