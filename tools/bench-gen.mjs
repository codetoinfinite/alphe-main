// Emits the static markup for the benchmarks section.
//
//   node tools/bench-gen.mjs [out.html]      (default /tmp/alphe-bench-section.html)
//
// The section is generated rather than hand-written because every column height
// has to come out of the same scale function the running page uses. It imports
// site/assets/js/data/models.js directly, so re-taking the Artificial Analysis
// snapshot means editing that file and re-running this — never nudging a number
// in the markup.
//
// The output replaces the block between the `<!-- Benchmarks ---` comment and its
// closing `</section>` in site/index.html.
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || '/tmp/alphe-bench-section.html';

const { BOARD, METRICS, barScale } = await import(
  new URL('../site/assets/js/data/models.js', import.meta.url).href
);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// The lab behind each row, as its own mark. The sprite is already inline on the
// page for the coverage wall and the console's intake stream, so a maker line
// costs one <use> and no request. Every creator in models.js is here, not only
// the eight currently on the board, so re-taking the snapshot cannot silently
// drop a logo when the board changes hands.
const MARK = {
  Anthropic: 'anthropic',
  OpenAI: 'openai',
  Google: 'google',
  Meta: 'meta',
  DeepSeek: 'deepseek',
  Alibaba: 'alibaba',
  SpaceXAI: 'xai',
  StepFun: 'stepfun',
  Kimi: 'kimi',
  'Z AI': 'zai',
  MiniMax: 'minimax',
  Mistral: 'mistral',
};

const maker = (creator) => {
  const slug = MARK[creator];
  if (!slug) throw new Error(`no sprite mark for creator "${creator}" — add one to MARK`);
  return `<i class="ib__maker"
                    ><svg class="ib__mark" aria-hidden="true"><use href="#p-${slug}" /></svg
                    >${esc(creator)}</i
                  >`;
};

// ------------------------------------------------------------------- board
//
// Eight isometric columns, shipped in the state the page loads in: sorted by
// intelligence, best on the left. Each column is three flat faces put where a
// 2:1 dimetric projection wants them by CSS transforms — the only thing script
// changes is --k, the column's height as a fraction of the plot, and where the
// column sits. Both are transforms or a height, so both animate.

const intelligence = METRICS[0];
const board = [...BOARD].sort((a, b) => b.intelligence - a.intelligence);
const k = barScale(intelligence, BOARD.map((m) => m.intelligence));

const boardRows = board
  .map((r, i) => {
    // Best and worst on the metric the board ships sorted by — the same two
    // marks the runtime moves when the sort changes.
    const cls = ['ib', i === 0 ? 'is-lead' : '', i === board.length - 1 ? 'is-tail' : '']
      .filter(Boolean)
      .join(' ');
    return `              <li
                class="${cls}"
                style="--k: ${k(r.intelligence).toFixed(4)}"
                data-intelligence="${r.intelligence}"
                data-cost="${r.cost}"
                data-speed="${r.speed}"
                data-latency="${r.latency}"
              >
                <span class="ib__plot">
                  <span class="ib__box">
                    <b class="ib__value">${r.intelligence}</b>
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

// The two spreads the lede quotes, both read off the eight columns rather than
// written into the prose, so re-taking the snapshot moves the sentence too.
const cheap = [...BOARD].sort((a, b) => a.cost - b.cost)[0];
const quick = [...BOARD].sort((a, b) => b.speed - a.speed)[0];
const costGap = Math.round(board[0].cost / cheap.cost);
const speedGap = Math.round(quick.speed / board[0].speed);

const section = `      <!-- Benchmarks ------------------------------------------------------ -->
      <!-- No field station: the panel is opaque edge to edge, so a shape behind
           it would be drawn and then covered.

           Every number here is Artificial Analysis's, measured with one harness
           across every model, and it is checked in as data rather than typed
           into the markup — see assets/js/data/models.js. Column heights are
           generated from that file by the same scale function the page runs on,
           so re-taking the snapshot means re-generating this block, never
           nudging a value by hand — tools/bench-gen.mjs.

           The board ships in its finished state. Script re-sorts it; it is not
           what draws it.

           The columns are isometric by CSS transform, not by an image or a 3D
           context: three flat faces per column, skewed to a 2:1 projection. Only
           one length ever changes — the column's height — so a re-sort is a
           height and a translate, and the whole board still exists with no
           script and no WebGL. -->
      <!-- The section is named by the pill above the headline, like every other
           section: a word station here would be a second label saying the same
           thing, and BENCHMARKS is ten letters — a text shape is fitted by its
           longest side, so ten of them leaves a 67px letter against SAVINGS's
           110. With no shape declared the section is not a station at all and
           the field keeps its ambient drift across it. -->
      <section class="section section--tight" id="bench">
        <div class="container">
          <div class="section-head">
            <span class="eyebrow" data-reveal>Benchmarks</span>
            <h2 class="section-title" data-avoid data-reveal data-reveal-stagger="80">
              No model wins every column.
            </h2>
            <p class="section-lede" data-avoid data-reveal data-reveal-stagger="140">
              Independent measurements from Artificial Analysis, one harness across every model.
              Change what you sort by and the ranking comes apart: the model at the top of the
              quality index costs ${costGap}× the cheapest column here and writes at a
              ${speedGap === 7 ? 'seventh' : `${speedGap}th`} of the fastest one's speed. Routing
              is what you do about that.
            </p>
          </div>

          <div class="bench" data-bench="models" data-reveal>
            <div class="bench__head">
              <!-- Which tab is on is otherwise only said in colour. aria-pressed
                   says it as well, and the caption below is live, so the change
                   is announced rather than just repainted. -->
              <div class="bench__tabs" role="group" aria-label="Sort the board by">
                <button
                  class="bench__tab is-on"
                  type="button"
                  aria-pressed="true"
                  data-bench-tab="intelligence"
                >
                  Intelligence
                </button>
                <button class="bench__tab" type="button" aria-pressed="false" data-bench-tab="cost">
                  Cost per task
                </button>
                <button class="bench__tab" type="button" aria-pressed="false" data-bench-tab="speed">
                  Output speed
                </button>
                <button
                  class="bench__tab"
                  type="button"
                  aria-pressed="false"
                  data-bench-tab="latency"
                >
                  Time to first token
                </button>
              </div>
              <p class="bench__caption" data-bench-caption aria-live="polite">
                Artificial Analysis Intelligence Index: agentic tasks, coding, general capability
                and scientific reasoning, weighted equally.
              </p>
            </div>

            <ol class="bench__stage" data-bench-rows>
${boardRows}
            </ol>

            <div class="bench__strip" aria-hidden="true">
              <i></i><i></i><i></i><i></i><i></i>
            </div>
            <p class="bench__src">
              Source:
              <a
                href="https://artificialanalysis.ai/leaderboards/models"
                rel="noreferrer noopener"
                target="_blank"
                >Artificial Analysis</a
              >, Intelligence Index v3.0. Snapshot 6 Aug 2026, ${board.length} families off a 264-row board.
            </p>
          </div>
        </div>
      </section>
`;

writeFileSync(OUT, section);

console.log('board', board.length, '·', board.map((m) => `${m.name} k=${k(m.intelligence).toFixed(2)}`).join(' / '));
console.log('lede', costGap + '× cost', '·', speedGap + '× speed', '· bytes', section.length);
console.log('written', OUT);
