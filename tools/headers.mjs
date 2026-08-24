// The same security policy is written in four places, because three servers
// have to be told, none of them reads the others' file, and the negotiator
// writes its own headers rather than trusting whichever one is in front of it:
//
//   site/.htaccess     Hostinger (LiteSpeed, public_html)
//   vercel.json        Vercel
//   serve.mjs          localhost
//   site/negotiate.php every negotiated response, on any host
//
// One source with two generated copies would be the tidier answer, but this
// site has no build step by design and adding one to emit two config files is a
// worse trade than checking them. So: no generation, no drift either.
//
//   node tools/headers.mjs
//
// Exits non-zero on any disagreement. Run it before every deploy.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

const [htaccess, vercel, serve, php] = await Promise.all([
  readFile(at('site/.htaccess'), 'utf8'),
  readFile(at('vercel.json'), 'utf8'),
  readFile(at('serve.mjs'), 'utf8'),
  readFile(at('site/negotiate.php'), 'utf8'),
]);

// Every header vercel.json's catch-all block declares, lower-cased, since that
// is the file where the list is a list rather than a run of directives.
const declared = JSON.parse(vercel)
  .headers.find((h) => h.source === '/(.*)')
  .headers.map((h) => [h.key.toLowerCase(), h.value]);

// `Header always set X-Frame-Options "DENY"` → the value between the quotes.
function fromHtaccess(name) {
  const re = new RegExp(`Header always set ${name} "([^"]*)"`, 'i');
  return htaccess.match(re)?.[1] ?? null;
}

// serve.mjs writes them as an object literal, single- or double-quoted, and the
// CSP is long enough that prettier has broken it onto its own line.
function fromServe(name) {
  const re = new RegExp(`'${name}':\\s*\\n?\\s*(['"])([^]*?)\\1`, 'i');
  return serve.match(re)?.[2] ?? null;
}

// `header('X-Frame-Options: DENY');`, or double-quoted where the value contains
// the apostrophes that CSP is made of.
function fromPhp(name) {
  const re = new RegExp(`header\\((['"])${name}:\\s*([^]*?)\\1\\)`, 'i');
  return php.match(re)?.[2] ?? null;
}

const problems = [];

for (const [name, want] of declared) {
  const got = fromHtaccess(name);
  if (got === null) problems.push(`site/.htaccess is missing ${name}`);
  else if (got !== want) problems.push(`site/.htaccess ${name}\n    want ${want}\n    got  ${got}`);

  // HSTS is the one header localhost has no business sending — the dev server
  // is http, and a browser told to pin https for a year against 127.0.0.1 stays
  // told long after the session that did it.
  if (name === 'strict-transport-security') continue;

  const local = fromServe(name);
  if (local === null) problems.push(`serve.mjs is missing ${name}`);
  else if (local !== want) problems.push(`serve.mjs ${name}\n    want ${want}\n    got  ${local}`);
}

// The negotiator answers on every host, including the two that would otherwise
// have added the policy for it, so it carries the whole list — HSTS included,
// which the localhost exception above skips for serve.mjs alone.
for (const [name, want] of declared) {
  const got = fromPhp(name);
  if (got === null) problems.push(`site/negotiate.php is missing ${name}`);
  else if (got !== want) problems.push(`site/negotiate.php ${name}\n    want ${want}\n    got  ${got}`);
}

// The other half of the policy: what may be held, and for how long. Named files
// rather than paths, because .htaccess matches on names.
const CACHE = [
  ['\\.woff2?$', 'public, max-age=31536000, immutable'],
  ['^three\\..*\\.js$', 'public, max-age=31536000, immutable'],
];

// The pattern is itself a regex, and it is being looked for as literal text
// inside another one, so every metacharacter in it has to be escaped — `?` and
// `.` included, which is most of what these patterns are made of.
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [pattern, want] of CACHE) {
  const re = new RegExp(`<FilesMatch "${literal(pattern)}">\\s*[^]*?"([^"]*)"`);
  const got = htaccess.match(re)?.[1] ?? null;
  if (got !== want) {
    problems.push(`site/.htaccess cache for ${pattern}\n    want ${want}\n    got  ${got}`);
  }
}

if (problems.length) {
  console.log(problems.map((p) => `  ✗ ${p}`).join('\n'));
  console.log(`\n${problems.length} disagreement(s) between .htaccess, vercel.json, serve.mjs and negotiate.php`);
  process.exit(1);
}

console.log(`${declared.length} headers agree across .htaccess, vercel.json, serve.mjs and negotiate.php`);
