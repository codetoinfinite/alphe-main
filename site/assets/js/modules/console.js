import { qs, qsa } from '../lib/dom.js';
import { motion, onMotionChange } from '../lib/motion.js';

// The routing console: one request replayed on a loop.
//
// The run is a list of cumulative states, not a list of transitions — each step
// declares everything that should be true at that moment, and applying a step
// is a diff against the markup. That means the loop can be entered, paused and
// restarted at any index without the panels drifting out of sync, which is what
// happens if you animate by mutating whatever the previous step left behind.
//
// Timing is setTimeout rather than rAF: these are second-scale beats, and the
// page already has exactly one rAF loop that has no business waking up 60 times
// a second to check whether 2.8 seconds have passed.

// items: how many chat lines are in. working: which one is still thinking.
// live: panels lit right now. wires: connectors drawn (they stay drawn).
// intake: panels currently filled with the catalogue rather than their copy.

// The opening. Every model, host, framework and tool the router can reach,
// rising through all three cards at once — the whole catalogue in front of the
// reader from the first beat, rather than dealt card by card.
//
// The cards then drop out of the stream one at a time, in the order the router
// works in: classify settles first and its wire goes over to the transcript
// while candidates and dispatch are still streaming, then candidates, then
// dispatch. So the sweep is not a separate act that finishes before the run
// starts — it is what each card is doing until the moment it has an answer, and
// what is still streaming is exactly what has not answered yet.
const OPEN = [
  {
    intake: ['classify', 'candidates', 'dispatch'],
    items: 1,
    working: -1,
    live: [],
    wires: [],
    delay: 2600,
  },
  // classify lands: its stream hands the card back to its own copy.
  {
    intake: ['candidates', 'dispatch'],
    items: 2,
    working: 1,
    live: ['classify'],
    wires: [],
    delay: 1100,
  },
  // …and connects.
  {
    intake: ['candidates', 'dispatch'],
    items: 3,
    working: -1,
    live: ['classify'],
    wires: ['classify'],
    delay: 2200,
  },
  { intake: ['dispatch'], items: 4, working: 3, live: ['candidates'], wires: ['classify'], delay: 1200 },
  {
    intake: ['dispatch'],
    items: 5,
    working: -1,
    live: ['candidates'],
    wires: ['classify', 'candidates'],
    delay: 2200,
  },
  {
    intake: [],
    items: 5,
    working: -1,
    live: ['dispatch'],
    wires: ['classify', 'candidates', 'dispatch'],
    routed: true,
    delay: 1600,
  },
  {
    intake: [],
    items: 6,
    working: -1,
    live: [],
    wires: ['classify', 'candidates', 'dispatch'],
    routed: true,
    delay: 2800,
  },
];

// The request itself, and the only part that repeats.
const RUN = [
  { items: 1, working: -1, live: [], wires: [], delay: 750 },
  { items: 2, working: 1, live: ['classify'], wires: [], delay: 900 },
  { items: 3, working: -1, live: ['classify'], wires: ['classify'], delay: 2600 },
  { items: 4, working: 3, live: ['candidates'], wires: ['classify', 'candidates'], delay: 1400 },
  { items: 5, working: -1, live: ['candidates'], wires: ['classify', 'candidates'], delay: 2600 },
  {
    items: 5,
    working: -1,
    live: ['dispatch'],
    wires: ['classify', 'candidates', 'dispatch'],
    routed: true,
    delay: 1600,
  },
  {
    items: 6,
    working: -1,
    live: [],
    wires: ['classify', 'candidates', 'dispatch'],
    routed: true,
    delay: 2800,
  },
];

const STEPS = [...OPEN, ...RUN];
// Where the loop restarts, which is past the catalogue rather than at it: the
// sweep is an establishing shot and an establishing shot is not something you
// play every twelve seconds. Seen once, the reader knows what the router had to
// choose from; seen on repeat it stops being information and starts being a
// screensaver sitting on top of the answer. OPEN and RUN tell the same story
// beat for beat — the difference is only whether the cards that have not
// answered yet are streaming while they wait.
const LOOP_FROM = OPEN.length;

const hex = (n) =>
  Array.from({ length: n }, () => '0123456789abcdef'[(Math.random() * 16) | 0]).join('');

// Intake stream ------------------------------------------------------------
// Six columns of provider marks per card, rising at slightly different speeds.
//
// A column is one animated element carrying its marks, not one animated mark
// each: the browser gets eighteen transforms to composite for the whole stage
// instead of six hundred and forty-eight.
//
// Each column holds the same POOL_ROWS marks twice and travels exactly half its
// own height, so the frame it ends on is the frame it started on. That is what
// makes the stream width-independent: it cannot run out at the bottom of the
// card whatever the card's height, so the layout is free to reflow the marks
// into two or three columns of their own on a stacked phone or tablet without
// the pace having to be re-derived for every breakpoint. The one thing that
// does have to be re-derived is duration — a column reflowed three-up is a
// third as tall, and the same duration would crawl — so it is measured from
// laid-out height rather than written down here.
const POOL_COLS = 6;
const POOL_ROWS = 18;
// px/s, and the reason POOL_ROWS is 18: reflowed three-up the column is six
// rows tall, which still has to cover the tallest card it appears in.
//
// A card now holds its catalogue for seconds, not for under one, and three of
// them run at once: at 240 that was a wall of marks moving fast enough that no
// single logo could be read out of it. Slow enough to pick individual vendors
// out of the stream, quick enough that it still reads as flowing.
const POOL_SPEED = 150;
const POOL_VARY = [1, 1.22, 0.95, 1.34, 1.06, 1.16];
const SVG_NS = 'http://www.w3.org/2000/svg';

// Duration from measured height, so every column moves at one pace no matter
// how the marks wrapped. Columns are the same height in all three cards, which
// is what keeps the cards in step with each other.
function pacePools(stage) {
  for (const col of qsa('.pool__col', stage)) {
    const half = col.getBoundingClientRect().height / 2;
    if (!half) continue;
    const vary = POOL_VARY[Number(col.dataset.poolCol) % POOL_VARY.length];
    col.style.animationDuration = `${((half / POOL_SPEED) * vary).toFixed(2)}s`;
  }
}

function buildPools(panels) {
  // The sheet is already in the document for the coverage wall; the stream is
  // its third reader. No sheet (any page but the home page) means no stream.
  const ids = qsa('.u-sprite symbol').map((s) => s.id);
  if (ids.length < POOL_COLS * 2) return;

  panels.forEach((panel, p) => {
    const pool = document.createElement('div');
    pool.className = 'pool';
    pool.setAttribute('aria-hidden', 'true');

    // The card's own label, repeated at the same place in the same style, so
    // the only thing the crossfade moves is the body of the card.
    const head = document.createElement('div');
    head.className = 'pool__head';
    const name = document.createElement('span');
    name.className = 'panel__label';
    name.textContent = qs('.panel__label', panel)?.textContent ?? '';
    head.append(name);
    if (p === 0) {
      const meta = document.createElement('span');
      meta.className = 'panel__meta';
      meta.textContent = '4,500+ MODELS';
      head.append(meta);
    }

    const grid = document.createElement('div');
    grid.className = 'pool__grid';
    for (let c = 0; c < POOL_COLS; c += 1) {
      const col = document.createElement('div');
      col.className = 'pool__col';
      col.dataset.poolCol = String(c);
      // Negative, so the columns are already mid-flight on the first frame
      // rather than sliding up into an empty card.
      col.style.animationDelay = `${(-c * 0.19).toFixed(2)}s`;
      const half = [];
      for (let r = 0; r < POOL_ROWS; r += 1) {
        // A fixed stride rather than a shuffle: the sheet is grouped by vendor,
        // 37 walks across the groups so no two neighbours are siblings, and the
        // same order every run keeps runs comparable when checking them.
        const id = ids[(p * 41 + (c * POOL_ROWS + r) * 37) % ids.length];
        const glyph = document.createElementNS(SVG_NS, 'svg');
        glyph.setAttribute('class', 'pool__glyph');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', `#${id}`);
        glyph.append(use);
        half.push(glyph);
      }
      // Twice, in the same order: the second half is what the first half rises
      // into, so the seam never arrives.
      col.append(...half, ...half.map((g) => g.cloneNode(true)));
      grid.append(col);
    }

    pool.append(head, grid);
    panel.append(pool);
  });
}

export function initConsole() {
  const stage = qs('[data-console]');
  if (!stage) return;

  const items = qsa('[data-chat-item]', stage);
  const panels = qsa('[data-panel]', stage);
  const wires = qsa('[data-wire]', stage);
  const chat = qs('[data-chat]', stage);
  const body = qs('.chat__body', stage);
  const routeId = qs('[data-route-id]', stage);

  // Decoration, and decoration that only makes sense in motion — so it is built
  // here rather than written into the markup, and a no-script render simply
  // never has it.
  buildPools(panels);
  pacePools(stage);
  if (typeof ResizeObserver !== 'undefined') {
    // The marks reflow into more columns of their own as a card widens, which
    // changes how far a column has to travel. Re-time it, or the stream crawls
    // on a tablet and races on a phone.
    let repace = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(repace);
      repace = requestAnimationFrame(() => pacePools(stage));
    }).observe(stage);
  }

  let index = 0;
  let timer = 0;
  let visible = false;
  // One id per run, minted when the loop comes back round — a request that
  // changed its own route id halfway through would be a bug, not a flourish.
  let runId = hex(8);

  function apply(step) {
    const intake = step.intake ?? [];
    stage.classList.toggle('is-intake', intake.length > 0);

    items.forEach((el, i) => {
      el.classList.toggle('is-in', i < step.items);
      el.classList.toggle('is-working', i === step.working);
    });

    for (const panel of panels) {
      const name = panel.dataset.panel;
      const live = step.live.includes(name);
      // All three cards can be in the sweep at once, and they leave it one at a
      // time — so this is a set membership test, not a hand-off.
      panel.classList.toggle('is-intake', intake.includes(name));
      panel.classList.toggle('is-live', live);
      // A panel counts as finished once its wire is drawn — the wire is the
      // record that the router actually reached it.
      panel.classList.toggle('is-done', !live && step.wires.includes(name));
    }

    for (const wire of wires) wire.classList.toggle('is-on', step.wires.includes(wire.dataset.wire));

    chat?.classList.toggle('is-routed', Boolean(step.routed));
    if (routeId) routeId.textContent = step.routed ? `ROUTE: r_${runId}` : 'ROUTE: none';

    // The transcript grows past the window it lives in on narrow desktops, so
    // follow it down. scrollTo rather than scrollTop so the reduced-motion
    // branch can ask for an instant jump.
    body?.scrollTo({
      top: body.scrollHeight,
      behavior: motion.prefersReducedMotion ? 'auto' : 'smooth',
    });
  }

  function advance() {
    apply(STEPS[index]);
    timer = setTimeout(() => {
      index = index + 1 < STEPS.length ? index + 1 : LOOP_FROM;
      if (index === LOOP_FROM) runId = hex(8);
      advance();
    }, STEPS[index].delay);
  }

  function stop() {
    clearTimeout(timer);
    timer = 0;
  }

  function sync() {
    stop();
    if (motion.prefersReducedMotion) {
      // No loop at all: show the finished run. Somebody who has asked for less
      // motion still gets the whole story, just not one beat at a time.
      apply(STEPS[STEPS.length - 1]);
      return;
    }
    // shouldRunAnimations, not just the reduce query: it also goes false when
    // the tab is backgrounded, and a hidden tab has no reason to keep beating.
    if (visible && motion.shouldRunAnimations) advance();
  }

  // Off-screen the run is invisible and the timers are pure waste. Resuming
  // from `index` rather than 0 means scrolling past and back does not restart
  // the story mid-sentence.
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      sync();
    },
    { threshold: 0.15 }
  ).observe(stage);

  // motion.js already republishes on visibilitychange, so this one subscription
  // covers both the reduced-motion switch and the tab going away.
  onMotionChange(sync);

  // Paint the opening beat before the observer has had a chance to fire, so the
  // section is never briefly blank, then let sync decide whether it runs.
  apply(STEPS[0]);
  sync();
}
