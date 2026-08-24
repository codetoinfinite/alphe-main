// Rebuilds the inline provider sprite in site/index.html from the vendors' own
// colour artwork.
//
//   node tools/sprite.mjs
//
// The sprite used to be the monochrome cut of every mark, which is why the
// console stream and the coverage wall both read as one grey texture. lobehub
// ships a `-color` file for 83 of the 119 marks; those carry the vendor's real
// fills and gradients. The remaining 36 are brands whose mark simply is
// monochrome (OpenAI, xAI, GitHub, Vercel, Notion, Anthropic…) — their files
// paint `currentColor`, so they take the consumer's ink and render white on a
// dark page, which is the vendor's own dark-background lockup.
//
// Two things have to be fixed on the way in:
//   * root presentation attributes are lost when a <svg> becomes a <symbol>
//     body, so they are hoisted onto a wrapping <g>;
//   * 23 of the colour files carry gradient/mask ids, and 23 files that each
//     call theirs "a" would collide in one document, so every id is namespaced.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(
  new URL('./node_modules/@lobehub/icons-static-svg/icons/', import.meta.url)
);
const PAGE = fileURLToPath(new URL('../site/index.html', import.meta.url));

const ROOT_DROP = new Set(['xmlns', 'xmlns:xlink', 'width', 'height', 'viewBox', 'class', 'id']);

function symbolFor(slug) {
  const colour = DIR + slug + '-color.svg';
  const file = fs.existsSync(colour) ? colour : DIR + slug + '.svg';
  const raw = fs.readFileSync(file, 'utf8');

  const open = raw.match(/<svg\b([^>]*)>/)[1];
  const viewBox = open.match(/viewBox="([^"]+)"/)[1];

  // Everything the root <svg> was carrying that children inherit.
  const carried = [];
  for (const [, name, value] of open.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) {
    if (!ROOT_DROP.has(name)) carried.push(`${name}="${value}"`);
  }

  let body = raw
    .replace(/^[\s\S]*?<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Namespace before referencing: collect first so a rename cannot be applied
  // twice to an id that happens to be a prefix of another.
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ids) {
    const tag = `${slug}-${id}`;
    body = body
      .split(`id="${id}"`)
      .join(`id="${tag}"`)
      .split(`url(#${id})`)
      .join(`url(#${tag})`)
      .split(`href="#${id}"`)
      .join(`href="#${tag}"`);
  }

  const inner = carried.length ? `<g ${carried.join(' ')}>${body}</g>` : body;
  return `          <symbol id="p-${slug}" viewBox="${viewBox}">${inner}</symbol>`;
}

const page = fs.readFileSync(PAGE, 'utf8');
const slugs = [...page.matchAll(/<symbol id="p-([^"]+)"/g)].map((m) => m[1]);
if (!slugs.length) throw new Error('no sprite found in index.html');

const first = page.indexOf('<symbol id="p-');
const last = page.lastIndexOf('</symbol>') + '</symbol>'.length;
const before = page.slice(0, page.lastIndexOf('\n', first) + 1);
const after = page.slice(last);

const built = slugs.map(symbolFor).join('\n');
fs.writeFileSync(PAGE, before + built + after);

const coloured = slugs.filter((s) => fs.existsSync(DIR + s + '-color.svg'));
console.log(
  `${slugs.length} symbols — ${coloured.length} in vendor colour, ${slugs.length - coloured.length} monochrome by brand`
);
console.log('old block', last - first, 'bytes → new', built.length);
