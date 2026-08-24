// Builds the #tools sprite and the chip field for the home page, the same way
// tools/logos.mjs builds the provider sprite for #coverage. Reads the same data
// module the site ships, so the markup in index.html and site/assets/js/data/
// tools.js can never drift apart.
//
//   node tools/tools-gen.mjs          # sprite + field, ready to paste
//   node tools/tools-gen.mjs --size   # just the byte cost
//
// Brand hexes are used as authored wherever they are legible. A handful of the
// marks are near-black — Notion, Vercel and GitHub ship black glyphs because
// they are drawn on white — and those disappear entirely on a #08090a page.
// Rather than invent a colour, this lifts the authored one until it clears a
// luminance floor: achromatic marks go to the page's own foreground (which is
// what those brands themselves do on dark backgrounds), coloured ones keep
// their hue and saturation and only gain lightness.

import { TOOLS } from '../site/assets/js/data/tools.js';

// The order the chips appear in. Deliberately not grouped by category: the
// point of the field is that it reads as one undifferentiated catalogue the
// selector has to search, and grouped logos read as a directory instead.
// Entries without a slug in TOOLS are wordmarks — see WORDMARKS below.
const ORDER = [
  'gmail', 'slack', 'github', 'stripe', 'notion', 'hubspot', 'zoom', 'twilio',
  'linear', 'googledrive', 'salesforce', 'sentry', 'figma', 'datadog', 'jira',
  'googlesheets', 'discord', 'letta', 'postgresql', 'zendesk', 'asana',
  'shopify', 'clickup', 'telegram', 'snowflake', 'trello', 'intercom',
  'googlecalendar', 'glean', 'docker', 'okta', 'airtable', 'mailchimp',
  'mongodb', 'whatsapp', 'gitlab', 'supabase', 'paypal', 'miro', 'box',
  'confluence', 'databricks', 'calendly', 'elasticsearch', 'dropbox',
  'quickbooks', 'postman', 'vercel', 'zapier',
];

// The icon set carries no mark for these, and guessing at a brand colour is
// worse than not using one, so they ship as their name set in the site's own
// type. Every catalogue has a long tail that has no logo to give you.
const WORDMARKS = [
  'slack', 'salesforce', 'letta', 'glean',
  'twilio', 'datadog', 'clickup', 'okta', 'box',
];

// --- colour -----------------------------------------------------------------

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

const luminance = ([r, g, b]) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

const toHex = ([r, g, b]) =>
  '#' +
  [r, g, b]
    .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
    .join('');

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

// Below this a mark is not so much dark as absent, at the 22px the chips draw
// it and the 78% opacity they draw it at.
const FLOOR = 0.16;
const FG = '#f4f5f6'; // --fg, so the greyscale marks match the type beside them

function legible(hex) {
  const rgb = parse(hex);
  if (luminance(rgb) >= FLOOR) return { hex, lifted: false };

  const [h, s] = rgbToHsl(rgb);
  if (s < 0.12) return { hex: FG, lifted: true };

  // Walk lightness up rather than solve for it: the luminance curve depends on
  // hue, and 100 steps is exact enough for a colour that ends up as an 8-bit
  // triple anyway.
  let out = rgb;
  for (let i = 1; i <= 100; i++) {
    out = hslToRgb([h, s, i / 100]);
    if (luminance(out) >= FLOOR) break;
  }
  return { hex: toHex(out), lifted: true };
}

// --- markup -----------------------------------------------------------------

const bySlug = new Map(TOOLS.map((t) => [t.slug, t]));
const NAMES = {
  slack: 'Slack', salesforce: 'Salesforce', letta: 'Letta', glean: 'Glean',
  twilio: 'Twilio', datadog: 'Datadog', clickup: 'ClickUp', okta: 'Okta',
  box: 'Box',
};

const missing = ORDER.filter((s) => !bySlug.has(s) && !WORDMARKS.includes(s));
if (missing.length) {
  console.error(`no path data and no wordmark for: ${missing.join(', ')}`);
  process.exit(1);
}

const iconSlugs = ORDER.filter((s) => bySlug.has(s));

const sprite = [
  '          <!--',
  '            Tool marks, one sprite for the whole field. Cross-document <use> is',
  '            blocked, so the symbols have to live in the page that draws them.',
  '            Regenerate with `node tools/tools-gen.mjs`.',
  '          -->',
  '          <svg class="u-sprite" aria-hidden="true" focusable="false">',
  '            <defs>',
  ...iconSlugs.map(
    (slug) =>
      `              <symbol id="t-${slug}" viewBox="0 0 24 24"><path d="${bySlug.get(slug).path}" /></symbol>`
  ),
  '            </defs>',
  '          </svg>',
].join('\n');

const lifted = [];

const chips = ORDER.map((slug) => {
  if (WORDMARKS.includes(slug)) {
    return (
      `              <span class="tool tool--word" data-tool="${slug}"` +
      `><span class="tool__name">${NAMES[slug]}</span></span>`
    );
  }
  const tool = bySlug.get(slug);
  const { hex, lifted: wasLifted } = legible(tool.hex);
  if (wasLifted) lifted.push(`${tool.name}: ${tool.hex} -> ${hex}`);
  return (
    `              <span class="tool" data-tool="${slug}" style="--tool: ${hex}"` +
    `><svg class="tool__glyph" aria-hidden="true"><use href="#t-${slug}" /></svg` +
    `><span class="tool__name">${tool.name}</span></span>`
  );
}).join('\n');

// --- the section ------------------------------------------------------------

// Four requests, each naming the tools it ends up using, in the order they run.
// They live here rather than in the module for the same reason the demo
// transcripts do: they are copy, and copy belongs in the markup. The chips draw
// their own position in that order, so there is no chain markup to emit.
const RUNS = [
  {
    ask: 'Refund order 4471 and tell the customer why.',
    picked: ['stripe', 'gmail', 'zendesk'],
  },
  {
    ask: 'Every Monday, post last week’s pipeline to the team.',
    picked: ['hubspot', 'googlesheets', 'slack'],
  },
  {
    ask: 'Triage the new error with what we learned last time.',
    picked: ['sentry', 'letta', 'linear'],
  },
  {
    ask: 'Find the renewal contract, summarise it, file the summary.',
    picked: ['glean', 'googledrive', 'notion'],
  },
];

const unknown = RUNS.flatMap((r) => r.picked).filter((s) => !ORDER.includes(s));
if (unknown.length) {
  console.error(`a run picks a tool that is not in the field: ${unknown.join(', ')}`);
  process.exit(1);
}

const runMarkup = RUNS.map(
  (run) => `            <span hidden data-tools-run
              data-tools-picked="${run.picked.join(',')}"
              data-tools-text="${run.ask}"
            ></span>`
).join('\n');

const section = `      <!-- Tools -------------------------------------------------------------- -->
      <!-- Coverage of models, then coverage of tools. The difference is that a
           catalogue this size is not something you hand a model whole — 7,000
           schemas is a worse prompt than none — so what is worth showing here is
           the selection, not the inventory. A request arrives, the field is
           swept, three tools come back lit and the rest stay where they were.
           Regenerate the sprite and the chips with \`node tools/tools-gen.mjs\`.

           The station is placed the same way #coverage's is, and for the same
           reason: the head copy is one left column, so the well to its right —
           field x +54 to +596, section top +261 down to the panel at -154 — is
           542x415 of nothing. Centred at x 325/1440 = 0.226, y 53/900 = 0.059.
           TOOLS is a short word, so it rasterises taller than MODELS at the same
           scale; 0.64 puts it at roughly 415x98, which the well still swallows
           whole. Fades rather than pushes. -->
      <section
        class="section section--tight"
        id="tools"
        data-field-shape="text:TOOLS"
        data-field-x="0.226"
        data-field-y="0.059"
        data-field-scale="0.64"
        data-field-avoid="fade"
      >
        <div class="container">
          <div class="section-head">
            <span class="eyebrow" data-reveal>Tools</span>
            <h2 class="section-title" data-avoid data-reveal data-reveal-stagger="80">
              Each request gets the three it needs.
            </h2>
            <p class="section-lede" data-avoid data-reveal data-reveal-stagger="140">
              Handing a model the whole catalogue is how it picks the wrong thing. Alphe ranks
              7,000+ integrations against the request, passes on the shortlist, and runs the calls in
              order — the same selection it does for models, one layer down.
            </p>
          </div>

${sprite}

          <div class="tools" data-tools data-reveal>
            <div class="tools__bar">
              <p class="tools__ask">
                <span class="tools__caret" aria-hidden="true"></span>
                <span data-tools-ask>${RUNS[0].ask}</span>
              </p>
            </div>

            <!-- No cell walls and no order: the field is the catalogue as the
                 selector sees it, and structure only appears where the selector
                 puts it. -->
            <div class="tools__field" data-tools-field>
              <span class="tools__scan" aria-hidden="true"></span>
${chips}
              <span class="tool tool--more">+ 7,000 more</span>
            </div>

            <!-- The four requests, as data only. The step bar that used to
                 print each chain under the field is gone: the order a chain
                 runs in is now carried by the chips it picked, which is where a
                 reader is already looking. Nothing here renders — with
                 scripting off the field is simply the catalogue, whole. -->
${runMarkup}
          </div>
        </div>
      </section>
`;

const ANCHOR = '      <!-- Security --';

function report() {
  const bytes = Buffer.byteLength(section, 'utf8');
  console.error(
    `${iconSlugs.length} symbols, ${ORDER.length} chips, ${RUNS.length} runs — ${(bytes / 1024).toFixed(1)} kB`
  );
  for (const line of lifted) console.error(`  lifted ${line}`);
}

if (process.argv.includes('--size')) {
  report();
  process.exit(0);
}

// Splice mode. index.html is being edited by other hands at the same time, and
// 47 kB of generated path data is not something to carry around by hand, so the
// read and the write happen back to back inside one process and the whole thing
// refuses rather than guesses if the page is not in the shape it expects.
if (process.argv.includes('--insert')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const page = new URL('../site/index.html', import.meta.url);
  const html = readFileSync(page, 'utf8');

  if (html.includes('id="tools"')) {
    console.error('index.html already has a #tools section — remove it first');
    process.exit(1);
  }
  const at = html.indexOf(ANCHOR);
  if (at < 0) {
    console.error(`anchor not found: ${ANCHOR}`);
    process.exit(1);
  }

  writeFileSync(page, html.slice(0, at) + section + '\n' + html.slice(at));
  console.error(`inserted #tools at byte ${at}`);
  report();
  process.exit(0);
}

process.stdout.write(section);
report();
