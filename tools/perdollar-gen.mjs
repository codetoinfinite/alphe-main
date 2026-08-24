// Emits the static markup for the accuracy-per-dollar section.
//
//   node tools/perdollar-gen.mjs [out.html]   (default /tmp/alphe-perdollar-section.html)
//
// Sibling of bench-gen.mjs, and the same rule applies: every column height comes
// out of the same scale function the running page uses, so re-measuring means
// editing site/assets/js/data/perdollar.js and re-running this — never nudging a
// number in the markup.
//
// The output replaces the block between the `<!-- Accuracy per dollar ---`
// comment and its closing `</section>` in site/index.html.
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] || '/tmp/alphe-perdollar-section.html';

const { RUNS, PD_METRICS, perDollar } = await import(
  new URL('../site/assets/js/data/perdollar.js', import.meta.url).href
);
const { barScale } = await import(new URL('../site/assets/js/data/models.js', import.meta.url).href);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// The four labs are in the inline sprite already, so their marks cost one <use>
// and no request. Ours is not: the sprite is generated from @lobehub by
// tools/logos.mjs and anything hand-added to it disappears on the next run. The
// mark is lifted out of the footer instead, which is where the page's one copy
// of the artwork lives.
const MARK = {
  OpenAI: 'openai',
  Anthropic: 'anthropic',
  Google: 'google',
  SpaceXAI: 'xai',
};

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const glyph = html.match(/class="footer__glyph-path"[\s\S]*?\sd="([^"]+)"/);
if (!glyph) throw new Error('footer__glyph-path not found in site/index.html — cannot lift our mark');

const maker = (creator) => {
  if (creator === 'Alphe') {
    return `<i class="ib__maker"
                    ><svg class="ib__mark" viewBox="0 0 91.08 100" aria-hidden="true"><path
                        d="${glyph[1]}"
                      /></svg
                    >Alphe</i
                  >`;
  }
  const slug = MARK[creator];
  if (!slug) throw new Error(`no sprite mark for creator "${creator}" — add one to MARK`);
  return `<i class="ib__maker"
                    ><svg class="ib__mark" aria-hidden="true"><use href="#p-${slug}" /></svg
                    >${esc(creator)}</i
                  >`;
};

// ------------------------------------------------------------------- board
//
// Five columns rather than eight, and otherwise the same board: three flat
// faces per column in a 2:1 dimetric projection, one length carrying the data.
// It ships sorted by the metric the section is named after, best on the left.

const value = PD_METRICS[0];
const rows = RUNS.map((r) => ({ ...r, perdollar: perDollar(r) }));
const board = [...rows].sort((a, b) => b.perdollar - a.perdollar);
const k = barScale(
  value,
  rows.map((r) => r.perdollar)
);

const boardRows = board
  .map((r, i) => {
    const cls = ['ib', i === 0 ? 'is-lead' : '', i === board.length - 1 ? 'is-tail' : '']
      .filter(Boolean)
      .join(' ');
    return `              <li
                class="${cls}"
                style="--k: ${k(r.perdollar).toFixed(4)}"
                data-perdollar="${r.perdollar.toFixed(2)}"
                data-accuracy="${r.accuracy}"
                data-cost="${r.cost}"
              >
                <span class="ib__plot">
                  <span class="ib__box">
                    <b class="ib__value">${value.format(r.perdollar)}</b>
                    <i class="ib__face ib__face--top" aria-hidden="true"></i>
                    <i class="ib__face ib__face--left" aria-hidden="true"></i>
                    <i class="ib__face ib__face--right" aria-hidden="true"></i>
                  </span>
                </span>
                <span class="ib__meta">
                  <b class="ib__name">${esc(r.name)}</b>
                  ${maker(r.creator)}
                </span>
              </li>`;
  })
  .join('\n');

// Every multiple the prose quotes, read off the rows rather than typed into the
// sentence, so re-measuring moves the copy too.
const us = rows.find((r) => r.creator === 'Alphe');
const others = rows.filter((r) => r !== us);
const times = (r) => r.cost / us.cost;
const round = (n) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);

const top = [...others].sort((a, b) => b.accuracy - a.accuracy);
const frontier = top.filter((r) => r.accuracy === top[0].accuracy);
const byCost = [...others].sort((a, b) => a.cost - b.cost);
const dearest = byCost[byCost.length - 1];
const gain = top[0].accuracy - us.accuracy;
const lost = others.map((r) => us.accuracy - r.accuracy).filter((d) => d > 0);

// The lede is assembled from those and then wrapped, because interpolating a
// number mid-sentence in a template literal leaves the line breaks wherever the
// expressions happened to fall. Nothing else in the file is generated prose, so
// this is the only place that needs it.
const wrap = (text, indent, width = 100) => {
  const lines = [];
  let line = indent;
  for (const word of text.split(/\s+/)) {
    if (line !== indent && line.length + 1 + word.length > width) {
      lines.push(line);
      line = indent;
    }
    line += line === indent ? word : ` ${word}`;
  }
  lines.push(line);
  return lines.join('\n');
};

// House prose spells small numbers and digits the measurements; the row count is
// prose, so it gets spelled.
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const spell = (n) => WORDS[n] ?? String(n);

const lede = wrap(
  `One task set, one grader, ${spell(board.length)} ways of answering it. Alphe routes a task for ` +
    `$${us.cost.toFixed(4)} and scores ${us.accuracy} out of 10. The two frontier models score ` +
    `${top[0].accuracy} — ${gain === 0.5 ? 'half a point' : `${gain} points`} more, for ` +
    `${frontier.map((r) => `${round(times(r))}×`).join(' and ')} the bill. Going cheap instead of ` +
    `routing costs ${round(times(byCost[0]))}× to ${round(times(byCost[1]))}× what routing costs ` +
    `and gives up ${Math.min(...lost)} to ${Math.max(...lost)} points doing it.`,
  ' '.repeat(14)
);

const section = `      <!-- Accuracy per dollar ---------------------------------------------- -->
      <!-- The board below is somebody else's measurement of the models. This is
           ours, of what routing does to them: the same task set answered five
           ways, graded 0–10 and billed end to end. Ours leads and links down to
           theirs, so the claim and the independent numbers it is made against
           are one scroll apart and never drawn as the same measurement.

           Same component deliberately — five columns instead of eight, three
           tabs instead of four, and every number checked in as data rather than
           typed into the markup. See assets/js/data/perdollar.js, and generate
           this block with tools/perdollar-gen.mjs rather than editing it.

           No field station, for the same reason the board below has none: the
           panel is opaque edge to edge and a shape behind it would be drawn and
           then covered. -->
      <section class="section" id="perdollar">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow" data-reveal>Accuracy per dollar</span>
            <h2 class="section-title" data-avoid data-reveal data-reveal-stagger="80">
              Half a point costs ${round(times(dearest))}× more.
            </h2>
            <p class="section-lede" data-avoid data-reveal data-reveal-stagger="140">
${lede}
            </p>
          </div>

          <div class="bench bench--own" data-bench="perdollar" data-reveal>
            <div class="bench__head">
              <div class="bench__tabs" role="group" aria-label="Sort the board by">
${PD_METRICS.map(
  (m, i) => `                <button
                  class="bench__tab${i === 0 ? ' is-on' : ''}"
                  type="button"
                  aria-pressed="${i === 0}"
                  data-bench-tab="${m.key}"
                >
                  ${m.label}
                </button>`
).join('\n')}
              </div>
              <p class="bench__caption" data-bench-caption aria-live="polite">
                ${value.caption}
              </p>
            </div>

            <ol class="bench__stage" data-bench-rows>
${boardRows}
            </ol>

            <div class="bench__strip" aria-hidden="true">
              <i></i><i></i><i></i><i></i><i></i>
            </div>
            <p class="bench__src">
              Alphe's own measurement — one task set, one grader, ${spell(board.length)} ways of answering it.
              Accuracy is a 0–10 grade; cost is the whole bill for a task, provider tokens included.
              The independent numbers are in <a href="#bench">the board below</a>.
            </p>
          </div>
        </div>
      </section>
`;

writeFileSync(OUT, section);

console.log('board', board.length, '·', board.map((r) => `${r.name} k=${k(r.perdollar).toFixed(2)}`).join(' / '));
console.log('per dollar', rows.map((r) => `${r.name} ${Math.round(perDollar(r))}`).join(' / '));
console.log('vs ours', others.map((r) => `${r.name} ${round(times(r))}x cost ${r.accuracy - us.accuracy >= 0 ? '+' : ''}${r.accuracy - us.accuracy} acc`).join(' / '));
console.log('spread', 'perdollar', Math.round(Math.max(...rows.map(perDollar)) / Math.min(...rows.map(perDollar))) + '×', '· cost', Math.round(dearest.cost / us.cost) + '×');
console.log('written', OUT, '·', section.length, 'bytes');
