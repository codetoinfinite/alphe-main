// Emits the static markup for the one-hard-question section.
//
//   node tools/research-gen.mjs [out.html]   (default /tmp/alphe-research-section.html)
//
// Sibling of bench-gen.mjs and perdollar-gen.mjs, and the same rule applies:
// every column height comes out of the same scale function the running page
// uses, so re-measuring means editing site/assets/js/data/research.js and
// re-running this — never nudging a number in the markup.
//
// The output replaces the block between the `<!-- One hard question ---`
// comment and its closing `</section>` in site/index.html.
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] || '/tmp/alphe-research-section.html';

const { RESEARCH, RS_METRICS, accPerDollar } = await import(
  new URL('../site/assets/js/data/research.js', import.meta.url).href
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
// Five columns, the same as the accuracy-per-dollar board that opens the run
// and the same component as the eight-column one between them: three flat faces per column in a 2:1 dimetric
// projection, one length carrying the data. It ships sorted by the metric the
// first tab names, best on the left.

const value = RS_METRICS[0];
const rows = RESEARCH.map((r) => ({ ...r, perdollar: accPerDollar(r) }));
const board = [...rows].sort((a, b) => b.perdollar - a.perdollar);
const k = barScale(
  value,
  rows.map((r) => r.perdollar)
);

// Every metric the board can be sorted by needs its value on every column, or a
// tab silently sorts on NaN. The scores the source table carries are rescalings
// of cost and wall clock, so they ride along as data attributes without a tab.
const CHARTED = RS_METRICS.map((m) => m.key);

const boardRows = board
  .map((r, i) => {
    const cls = ['ib', i === 0 ? 'is-lead' : '', i === board.length - 1 ? 'is-tail' : '']
      .filter(Boolean)
      .join(' ');
    const data = CHARTED.map((key) => {
      const v = r[key];
      if (!Number.isFinite(v)) throw new Error(`${r.name} has no ${key}`);
      return `                data-${key}="${key === 'perdollar' ? v.toFixed(2) : v}"`;
    }).join('\n');
    return `              <li
                class="${cls}"
                style="--k: ${k(r.perdollar).toFixed(4)}"
${data}
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

const byAcc = [...others].sort((a, b) => b.accuracy - a.accuracy);
const byQual = [...others].sort((a, b) => b.quality - a.quality);
const byCost = [...others].sort((a, b) => a.cost - b.cost);
const byClock = [...others].sort((a, b) => a.wallclock - b.wallclock);
const sharpest = byAcc[0];
const richest = byQual[0];
const cheapest = byCost[0];
const fastest = byClock[0];

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
// Gaps come out in halves, so they get spelled the way the house spells them
// rather than printed as decimals mid-sentence. `verb` because "two points
// costs" is what a template that never asked the question would emit.
const pts = (n) =>
  n === 0.5 ? 'half a point'
  : n === 1 ? 'one point'
  : n === 1.5 ? 'a point and a half'
  : Number.isInteger(n) ? `${spell(n)} points`
  : `${n} points`;
const verb = (n) => (n === 1 || n === 0.5 ? 'costs' : 'cost');
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const accGap = Math.round((sharpest.accuracy - us.accuracy) * 10) / 10;
const qualGap = Math.round((richest.quality - us.quality) * 10) / 10;

const lede = wrap(
  `One question, ${spell(board.length)} answers, one grader. Six weeks of a running flood, asked ` +
    `from the first breach to the day of the run, and every clause of it wants a different source. ` +
    `Alphe routes it for $${us.cost.toFixed(4)} and grades ${us.accuracy} for accuracy and ` +
    `${us.quality} for how it reads. The sharpest answer is ${pts(accGap)} better on accuracy at ` +
    `${round(times(sharpest))}× the bill; the best-written one is ${pts(qualGap)} better at ` +
    `${round(times(richest))}×. The fastest answer lands in ${fastest.wallclock} seconds and ` +
    `scores ${fastest.quality} out of 10 for being worth reading.`,
  ' '.repeat(14)
);

const section = `      <!-- One hard question --------------------------------------------- -->
      <!-- The accuracy-per-dollar board that opens this run is a task set,
           averaged. This is one question, which is the case an average hides:
           six weeks of a live disaster, four clauses wanting four different
           sources, and no answer key.

           Same component again — five columns, five tabs, four different rows
           winning them, and every number checked in as data rather than typed
           into the markup. See assets/js/data/research.js, and generate this
           block with tools/research-gen.mjs rather than editing it.

           No field station, for the same reason the two boards above have none:
           the panel is opaque edge to edge and a shape behind it would be drawn
           and then covered. -->
      <section class="section section--tight" id="research">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow" data-reveal>One hard question</span>
            <h2 class="section-title" data-avoid data-reveal data-reveal-stagger="80">
              ${cap(pts(accGap))} ${verb(accGap)} ${round(times(sharpest))}× more.
            </h2>
            <p class="section-lede" data-avoid data-reveal data-reveal-stagger="140">
${lede}
            </p>
          </div>

          <div class="bench bench--own" data-bench="research" data-reveal>
            <div class="bench__head">
              <div class="bench__tabs" role="group" aria-label="Sort the board by">
${RS_METRICS.map(
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
              Alphe's own measurement — one question, one grader, ${spell(board.length)} ways of answering it.
              Accuracy and quality are 0–10 grades; cost is the whole bill for the run, provider tokens
              included; wall clock is time to the finished answer.
              The task set behind this one is in <a href="#perdollar">the accuracy-per-dollar
              board</a>.
            </p>
          </div>
        </div>
      </section>
`;

writeFileSync(OUT, section);

const win = (m) => {
  const s = [...rows].sort((a, b) => (m.high ? b[m.key] - a[m.key] : a[m.key] - b[m.key]));
  return `${m.label}: ${s[0].name}`;
};
console.log('board', board.length, '·', board.map((r) => `${r.name} k=${k(r.perdollar).toFixed(2)}`).join(' / '));
console.log('per dollar', rows.map((r) => `${r.name} ${Math.round(accPerDollar(r))}`).join(' / '));
console.log('winners', RS_METRICS.map(win).join(' / '));
console.log('vs ours', others.map((r) => `${r.name} ${round(times(r))}x cost ${r.accuracy - us.accuracy >= 0 ? '+' : ''}${r.accuracy - us.accuracy} acc ${r.quality - us.quality >= 0 ? '+' : ''}${r.quality - us.quality} qual`).join(' / '));
console.log('spread', 'perdollar', Math.round(Math.max(...rows.map(accPerDollar)) / Math.min(...rows.map(accPerDollar))) + '×', '· cost', Math.round(byCost[byCost.length - 1].cost / us.cost) + '×', '· clock', (Math.max(...rows.map((r) => r.wallclock)) / Math.min(...rows.map((r) => r.wallclock))).toFixed(1) + '×');
console.log('cheapest single', cheapest.name, round(times(cheapest)) + '× ours');
console.log('written', OUT, '·', section.length, 'bytes');
