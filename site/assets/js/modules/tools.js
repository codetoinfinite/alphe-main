import { qs, qsa, debounce } from '../lib/dom.js';
import { motion, onMotionChange } from '../lib/motion.js';

// Tool selection.
//
// The requests and the tools each one resolves to live in the markup — this
// only decides which of them is on screen and when. Same split as the demo
// transcripts: copy stays in the page, timing stays here.
//
// The one thing worth measuring is where each chip sits across the field. The
// beam takes SWEEP to cross, so a chip two thirds of the way along should not
// change until two thirds of that has passed, and the field wraps differently
// at every width. That fraction is written once per resize as --d and the CSS
// spends it as a transition delay, which means the wave costs no frames at all.

const HOLD = 5200; // a resolved selection sits this long before the next request
const SWEEP = 720; // must match the tools-scan keyframe in sections.css

export function initTools(root = document) {
  const el = qs('[data-tools]', root);
  if (!el) return;

  const field = qs('[data-tools-field]', el);
  const runs = qsa('[data-tools-run]', el);
  if (!field || !runs.length) return;

  const chips = qsa('.tool', field);
  const askOut = qs('.tools__ask [data-tools-ask]', el);

  let index = 0;
  let started = false;
  let visible = false;
  let cycleTimer = 0;
  let resolveTimer = 0;

  function measure() {
    const box = field.getBoundingClientRect();
    const span = box.width || 1;
    for (const chip of chips) {
      const r = chip.getBoundingClientRect();
      const d = (r.left + r.width / 2 - box.left) / span;
      chip.style.setProperty('--d', Math.min(1, Math.max(0, d)).toFixed(3));
    }
  }

  function paint(i) {
    const run = runs[i];
    const picked = (run.dataset.toolsPicked || '').split(',');
    for (const chip of chips) {
      // Position in the chain, not just membership of it: the order the calls
      // run in is drawn on the chip itself, so the numeral is the chip's index
      // in the picked list rather than a class.
      const at = picked.indexOf(chip.dataset.tool);
      chip.classList.toggle('is-picked', at > -1);
      // Quoted, because this lands in `content` — an unquoted value there is a
      // parse error and the whole declaration is dropped.
      if (at > -1) chip.style.setProperty('--n', `'${String(at + 1).padStart(2, '0')}'`);
    }
    // The request is the state of the request, not the result of the sweep, so
    // it lands immediately. Only the field waits.
    if (askOut) askOut.textContent = run.dataset.toolsText || askOut.textContent;
  }

  function select(i, sweep) {
    index = i;
    clearTimeout(resolveTimer);
    el.classList.add('is-live');
    el.classList.remove('is-resolved');

    if (!sweep) {
      el.classList.remove('is-scanning');
      paint(i);
      el.classList.add('is-resolved');
      return;
    }

    // Restarting a CSS animation needs the class gone and the layout flushed
    // before it goes back on, otherwise the browser sees no change at all.
    el.classList.remove('is-scanning');
    void el.offsetWidth;
    el.classList.add('is-scanning');
    paint(i);
    resolveTimer = setTimeout(() => el.classList.add('is-resolved'), SWEEP);
  }

  function schedule() {
    clearTimeout(cycleTimer);
    if (!visible || !motion.shouldRunAnimations) return;
    cycleTimer = setTimeout(() => {
      select((index + 1) % runs.length, true);
      schedule();
    }, HOLD);
  }

  // Nothing runs until the field is actually on screen, and the first request
  // resolves without a sweep if motion is off — the section still ends up
  // saying the same thing, it just says it at once.
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !started) {
        started = true;
        measure();
        select(0, motion.shouldRunAnimations);
      }
      schedule();
    },
    { threshold: 0.15 }
  ).observe(el);

  // Chip widths are type, so they move when the font swaps in and again on
  // every reflow, and --d is wrong until they settle.
  if (document.fonts) document.fonts.ready.then(measure);
  window.addEventListener('resize', debounce(measure, 180));

  onMotionChange(() => {
    if (!started) return;
    if (!motion.shouldRunAnimations) {
      clearTimeout(cycleTimer);
      clearTimeout(resolveTimer);
      el.classList.remove('is-scanning');
      el.classList.add('is-resolved');
      return;
    }
    schedule();
  });
}
