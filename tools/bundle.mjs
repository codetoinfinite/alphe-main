// Packs site/ into the archive Hostinger's File Manager expects.
//
//   node tools/bundle.mjs
//
// Hostinger has no git integration and no build container: deploying is putting
// the files in public_html, by File Manager upload-and-extract or over SFTP.
// The archive is therefore rooted at site/'s *contents* rather than at site/
// itself, so extracting it inside public_html puts index.html at the web root
// instead of at public_html/site/index.html.
//
// There is nothing to compile. This copies and zips, which is the whole of the
// build — the point of it is the checks either side of the copy, not the copy.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = join(ROOT, 'site');
const OUT = join(ROOT, 'dist');
const ZIP = join(OUT, 'alphe-public_html.zip');

// Files whose absence makes the deploy quietly wrong rather than obviously
// broken. A missing .htaccess is a live site with no CSP and no HSTS, and
// nothing about the page looks any different. A missing contact.php is six
// forms that 404 on submit, which nobody sees until a lead is gone. A missing
// negotiate.php or .md twin is a site that answers `Accept: text/markdown`
// with HTML, which is invisible to every human who looks at it and wrong to
// every agent that asks. The IndexNow key is the same shape of silence: without
// it every URL submission comes back 403 and nothing says why.
const REQUIRED = [
  '.htaccess',
  'index.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'contact.php',
  'negotiate.php',
  'agents.md',
  'llms.txt',
  'llms-full.txt',
  'index.md',
  '404.md',
  'platform/index.md',
  'pricing/index.md',
  'docs/index.md',
  'about/index.md',
  'contact/index.md',
  'docs/index.html',
  '.well-known/security.txt',
];

// Named by shape rather than spelt out: rotating the IndexNow key is renaming
// the file, and a constant here would have to be edited in step or it would
// fail the deploy that rotated it.
REQUIRED.push(
  readdirSync(SITE).find((f) => /^[0-9a-f]{8,128}\.txt$/.test(f)) ||
    'an-indexnow-key.txt (missing)'
);

// The policy has to agree with itself before it is worth shipping. Throws on a
// non-zero exit, which ends this script too.
execFileSync('node', [join(ROOT, 'tools/headers.mjs')], { stdio: 'inherit' });

// And the generated copy of the site has to match the pages it was generated
// from. A stale llms-full.txt is a wrong answer served confidently.
execFileSync('node', [join(ROOT, 'tools/llms-full.mjs'), '--check'], { stdio: 'inherit' });

for (const name of REQUIRED) {
  if (!(await stat(join(SITE, name)).catch(() => null))) {
    console.error(`site/${name} is missing — refusing to bundle`);
    process.exit(1);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
// Everything but the lead store and the mail password. contact.php falls back to
// a hidden directory inside the document root on a host that will not let it
// write above one, and that directory holds real names and numbers: copying it
// into dist/ puts it in the zip and sends it back up, and a local test run would
// overwrite the live rows with fake ones. alphe-mail.php is the same shape of
// mistake with the mailbox password in it — a local copy for testing must never
// leave the machine.
await cp(SITE, join(OUT, 'public_html'), {
  recursive: true,
  filter: (src) => !/\/\.alphe-leads(\/|$)/.test(src) && !src.endsWith('/alphe-mail.php'),
});

// Zipped from inside the directory, not from above it: the archive's own root is
// what gets extracted. zip includes dotfiles when it recurses `.`, which is the
// only reason .htaccess survives the trip.
// -X drops the macOS resource forks that otherwise arrive as ._ files in
// public_html and get served as garbage.
execFileSync('zip', ['-qr', '-X', ZIP, '.'], { cwd: join(OUT, 'public_html') });

// Read back rather than trust: the upload is the last step where a missing
// dotfile is still cheap to notice.
const listed = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).split('\n');
for (const name of REQUIRED) {
  if (!listed.includes(name)) {
    console.error(`${name} did not make it into the archive`);
    process.exit(1);
  }
}

const kb = (await stat(ZIP)).size / 1024;
console.log(`dist/public_html/               ${listed.filter(Boolean).length} entries, for SFTP`);
console.log(`dist/alphe-public_html.zip      ${kb.toFixed(0)} KB, for File Manager`);
