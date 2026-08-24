// Tell the search engines the pages exist, without owning an account anywhere.
//
//   node tools/indexnow.mjs            what would be submitted, and to where
//   node tools/indexnow.mjs --submit   actually submit
//
// Google needs Search Console and a verified property; Bing, Yandex, Seznam and
// Naver share IndexNow, which authenticates with a key file on the site itself
// instead of a login. site/<key>.txt holds the key and nothing else, and the
// endpoint fetches it to prove whoever submitted the URLs controls the host.
//
// Run it after a deploy, never before: the key file has to be live at
// https://alpheai.com/<key>.txt or every submission comes back 403.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SITE = fileURLToPath(new URL('../site', import.meta.url));
const HOST = 'alpheai.com';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

// The key is the name of the file that holds it, which is the whole protocol.
// Finding it by shape rather than by a constant means the two can never
// disagree — rotating the key is renaming the file and rewriting its contents.
const keyFiles = readdirSync(SITE).filter((f) => /^[0-9a-f]{8,128}\.txt$/.test(f));
if (keyFiles.length !== 1) {
  console.error(`expected exactly one IndexNow key file in site/, found ${keyFiles.length}`);
  process.exit(1);
}
const key = keyFiles[0].replace(/\.txt$/, '');
if (readFileSync(join(SITE, keyFiles[0]), 'utf8').trim() !== key) {
  console.error(`site/${keyFiles[0]} does not contain its own name — the endpoint checks this`);
  process.exit(1);
}

// The sitemap is already the list of what is worth indexing, and it is the list
// the engines are told about in robots.txt. Reading it here keeps one source.
const sitemap = readFileSync(join(SITE, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!urlList.length) {
  console.error('sitemap.xml listed no URLs');
  process.exit(1);
}

console.log(`key       ${key}`);
console.log(`endpoint  ${ENDPOINT}`);
for (const u of urlList) console.log(`  ${u}`);

if (!process.argv.includes('--submit')) {
  console.log(`\n${urlList.length} URLs, not submitted — pass --submit to send them`);
  process.exit(0);
}

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${keyFiles[0]}`, urlList }),
});
const body = await res.text().catch(() => '');

// 200 is accepted, 202 is accepted-and-still-checking-the-key. Everything else
// is a refusal worth reading: 403 is the key file not being live yet, 422 is a
// URL that does not belong to the host the key authorises.
console.log(`\n${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
process.exit(res.status === 200 || res.status === 202 ? 0 : 1);
