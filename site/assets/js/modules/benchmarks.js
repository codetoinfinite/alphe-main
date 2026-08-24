import { qs, qsa } from '../lib/dom.js';
import { inViewport } from '../lib/viewport.js';
import { motion } from '../lib/motion.js';
import { onFrame } from '../lib/raf.js';
import { METRICS, barScale } from '../data/models.js';
import { PD_METRICS } from '../data/perdollar.js';
import { RS_METRICS } from '../data/research.js';

// Benchmarks.
//
// The board ships finished in the HTML, sorted by intelligence. Nothing here
// draws a chart; it re-sorts one. That is the whole reason the markup is
// generated rather than templated at runtime: the numbers are the point of the
// section and they should survive a module fetch that never lands.
//
// Three boards use it: the models board, the accuracy-per-dollar board below it
// and the one-question board below that. `data-bench` names which set of metrics
// a board is sorted by, and the board's own columns carry the values, so the
// code below never knows which one it is driving.

const SETS = {
  models: METRICS,
  perdollar: PD_METRICS,
  research: RS_METRICS,
};

// The stylesheet's --ease-out is cubic-bezier(.16,1,.3,1). This is the closest
// cheap curve to it, so a tweened number and the bar under it arrive together.
const easeOut = (t) => 1 - Math.pow(1 - t, 4);

const SORT = 0.62; // seconds — must match the transitions in sections.css

// ---------------------------------------------------------------- the board

export function initBenchmarks() {
  for (const root of qsa('[data-bench]')) initBoard(root);
}

function initBoard(root) {
  const metrics = SETS[root.dataset.bench];
  if (!metrics) return;

  const stage = qs('[data-bench-rows]', root);
  const caption = qs('[data-bench-caption]', root);
  const tabs = qsa('[data-bench-tab]', root);
  const bars = qsa('.ib', stage);
  if (!bars.length) return;

  const cells = bars.map((el) => ({
    el,
    value: qs('.ib__value', el),
    // Read once. A column's own dataset is the record for that model, so a
    // column added to the markup joins the sort without being registered
    // anywhere.
    v: Object.fromEntries(metrics.map((m) => [m.key, parseFloat(el.dataset[m.key])])),
  }));

  // The grid the stylesheet lays out without script — how many columns fit at
  // this width, and how tall a row of them is. Read from the stylesheet rather
  // than measured, because measuring a column reads back whatever transform the
  // last sort left on it, and because that is where they change per breakpoint.
  const css = (name, fallback) => {
    const v = parseFloat(getComputedStyle(stage).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };

  // Absolutely positioned children hang off the padding box, not the content
  // box, so every offset carries the padding it is inset by. Taking the columns
  // out of flow also leaves the stage with nothing to be as tall as.
  let grid = { cols: 8, colW: 0, rowH: 322, padL: 26, padT: 20 };

  const measure = () => {
    const s = getComputedStyle(stage);
    const padL = parseFloat(s.paddingLeft) || 0;
    const padT = parseFloat(s.paddingTop) || 0;
    const inner = stage.clientWidth - padL - (parseFloat(s.paddingRight) || 0);
    const cols = Math.max(1, Math.round(css('--cols', 8)));
    grid = { cols, colW: inner / cols, rowH: css('--iso-row', 322), padL, padT };

    stage.style.setProperty('--col-w', `${grid.colW.toFixed(2)}px`);
    const lines = Math.ceil(cells.length / cols);
    stage.style.height = `${padT + lines * grid.rowH + (parseFloat(s.paddingBottom) || 0)}px`;
  };

  let metric = metrics[0];
  let stopTween = null;

  const apply = (next, animate) => {
    const from = metric;
    metric = next;

    // One height scale, the same function the generator used to ship the board,
    // so a static column and a re-sorted one can never disagree.
    const k = barScale(
      metric,
      cells.map((c) => c.v[metric.key])
    );

    // Sort into the metric's own good-first order and place each column where
    // it landed. Nothing moves in the DOM, so tab order and screen-reader order
    // stay the order the numbers were published in.
    const order = [...cells].sort((a, b) =>
      metric.high ? b.v[metric.key] - a.v[metric.key] : a.v[metric.key] - b.v[metric.key]
    );

    order.forEach((c, i) => {
      c.el.style.setProperty('--x', `${(grid.padL + (i % grid.cols) * grid.colW).toFixed(2)}px`);
      c.el.style.setProperty('--y', `${grid.padT + Math.floor(i / grid.cols) * grid.rowH}px`);
      // The delay runs along the finished order, so the cascade reads as one
      // wave rather than eight columns leaving at once.
      c.el.style.setProperty('--i', animate ? String(i) : '0');
      c.el.style.setProperty('--k', k(c.v[metric.key]).toFixed(4));
      // Best and worst on whatever is being shown. Which end that is flips with
      // the metric, and the sort above has already done the flipping.
      c.el.classList.toggle('is-lead', i === 0);
      c.el.classList.toggle('is-tail', i === order.length - 1);
    });

    caption.textContent = metric.caption;
    for (const tab of tabs) {
      const on = tab.dataset.benchTab === metric.key;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-pressed', String(on));
    }

    // Numbers cross-fade by counting rather than swapping, on the same curve and
    // duration as the column under them. One subscription drives all eight.
    stopTween?.();
    if (!animate || from === metric) {
      for (const c of cells) c.value.textContent = metric.format(c.v[metric.key]);
      return;
    }

    let t = 0;
    stopTween = onFrame((dt) => {
      t = Math.min(1, t + dt / SORT);
      const e = easeOut(t);
      for (const c of cells) {
        const a = c.v[from.key];
        const b = c.v[metric.key];
        c.value.textContent = metric.format(a + (b - a) * e);
      }
      if (t >= 1) {
        stopTween?.();
        stopTween = null;
      }
    });
  };

  measure();
  apply(metric, false);

  // Columns are placed before they are allowed to move: on a slow module fetch
  // the first paint can land first, and without this the eight of them would be
  // seen stacked at the left edge and then slide apart.
  requestAnimationFrame(() => root.classList.add('is-ready'));

  // Columns are held at zero height by the stylesheet until the panel has been
  // seen, so the first thing it does on screen is build itself.
  inViewport(root, () => root.classList.add('is-live'), 0.15);

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const next = metrics.find((m) => m.key === tab.dataset.benchTab);
      if (next && next !== metric) apply(next, !motion.prefersReducedMotion);
    });
  }

  // A resize changes the column pitch, the row height and how many columns the
  // board folds to, and every offset is written in pixels.
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      measure();
      apply(metric, false);
    }, 200);
  });
}
