// Builds site/llms-full.txt out of the Markdown twins.
//
//   node tools/llms-full.mjs           writes the file
//   node tools/llms-full.mjs --check   fails if the file is stale
//
// llms.txt is the index — one paragraph per page and a link. llms-full.txt is
// the other half of the convention: every page's actual text in one request, so
// a model that wants the whole site does not have to fetch seven URLs and guess
// at what it missed between them.
//
// It is generated rather than written because the twins are the source of
// truth. A hand-maintained copy drifts, and a stale copy of a pricing page is
// worse than no copy at all — nobody notices it is wrong until someone quotes
// it back at us. The --check mode runs in the same place the header gate does,
// so drift fails the bundle instead of shipping.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = join(ROOT, 'site');
const OUT = join(SITE, 'llms-full.txt');

// Order is reading order, not file order: what the product is, then how it
// works, then what it costs, then how to call it, then who builds it and how to
// reach them. agents.md last because it is instructions about the rest.
const PAGES = [
  ['https://alpheai.com/', 'index.md'],
  ['https://alpheai.com/platform/', 'platform/index.md'],
  ['https://alpheai.com/pricing/', 'pricing/index.md'],
  ['https://alpheai.com/docs/', 'docs/index.md'],
  ['https://alpheai.com/about/', 'about/index.md'],
  ['https://alpheai.com/contact/', 'contact/index.md'],
  ['https://alpheai.com/agents.md', 'agents.md'],
];

// The date the content last changed, not the date this ran: a header that moves
// on every build teaches a cache that the file is always new.
const REVIEWED = '2026-08-23';

async function build() {
  const parts = [
    `# Alphe AI — full site text`,
    ``,
    `> Every page of alpheai.com in one file, generated from the Markdown twins`,
    `> that the site serves at each URL. Index: https://alpheai.com/llms.txt`,
    `> Agent instructions: https://alpheai.com/agents.md`,
    ``,
    `Last reviewed ${REVIEWED}. Alphe AI is pre-launch; figures in this file are`,
    `measured on the current build and are not a published SLA.`,
    ``,
  ];
  for (const [url, file] of PAGES) {
    const body = (await readFile(join(SITE, file), 'utf8')).trim();
    parts.push(
      `${'='.repeat(78)}`,
      `Source: ${url}`,
      `Markdown: https://alpheai.com/${file}`,
      `${'='.repeat(78)}`,
      ``,
      body,
      ``,
    );
  }
  return parts.join('\n');
}

const built = await build();

if (process.argv.includes('--check')) {
  const current = await readFile(OUT, 'utf8').catch(() => null);
  if (current === null) {
    console.error('site/llms-full.txt is missing — run node tools/llms-full.mjs');
    process.exit(1);
  }
  if (current !== built) {
    console.error('site/llms-full.txt is stale — run node tools/llms-full.mjs');
    process.exit(1);
  }
  console.log(`llms-full.txt current, ${PAGES.length} pages, ${(built.length / 1024).toFixed(1)} KB`);
} else {
  await writeFile(OUT, built);
  console.log(`site/llms-full.txt  ${PAGES.length} pages, ${(built.length / 1024).toFixed(1)} KB`);
}
