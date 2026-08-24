import { qs, qsa } from '../lib/dom.js';
import { motion, onMotionChange } from '../lib/motion.js';

// The demo panel: four jobs, replayed one at a time.
//
// The transcripts live in the markup, not here. This module owns nothing but
// which run is showing and how far into it the replay has got, so editing the
// copy or the beats of a run never means touching JavaScript — the delay
// between two lines is `data-delay` on the second one.
//
// A step is applied, not transitioned into: painting index i means every step
// up to i is in and everything after it is not. The loop can therefore be
// entered, paused and restarted at any index without the panel drifting.

const HOLD = 3600; // beat at the end of a run before the next one takes over
const hex = (n) =>
  Array.from({ length: n }, () => '0123456789abcdef'[(Math.random() * 16) | 0]).join('');

export function initDemo(root = document) {
  const panel = qs('[data-demo]', root);
  if (!panel) return;

  const section = panel.closest('section') || root;
  const body = qs('.demo__body', panel);
  const routeEl = qs('[data-demo-route]', panel);
  const modelEl = qs('[data-demo-model]', panel);
  const picks = qsa('[data-demo-pick]', section);
  const runs = qsa('[data-run]', panel).map((el) => ({ el, steps: qsa('[data-step]', el) }));
  if (!runs.length) return;

  let current = 0;
  let index = 0;
  let timer = null;
  let visible = false;
  let pinned = false; // a card was clicked, so stop cycling on its own

  const run = () => runs[current];

  function stop() {
    clearTimeout(timer);
    timer = null;
  }

  // Cumulative: is-in for everything up to `upto`, is-working only on the tool
  // row that is the frontier, is-done on the tool rows already behind it.
  function paint(upto) {
    run().steps.forEach((step, i) => {
      const tool = step.hasAttribute('data-tool');
      step.classList.toggle('is-in', i <= upto);
      if (!tool) return;
      step.classList.toggle('is-working', i === upto);
      step.classList.toggle('is-done', i < upto);
    });
    if (body) body.scrollTop = body.scrollHeight;
  }

  function advance() {
    const { steps } = run();
    paint(index);

    const done = index >= steps.length - 1;
    const wait = done ? HOLD : Number(steps[index + 1].dataset.delay) || 1200;

    timer = setTimeout(() => {
      if (done) {
        if (pinned) {
          index = 0;
          advance();
        } else {
          select((current + 1) % runs.length);
        }
        return;
      }
      index += 1;
      advance();
    }, wait);
  }

  // Switching runs is a full reset: the outgoing transcript is hidden and
  // cleared, so coming back to it later replays from the first line rather than
  // flashing the tail of the previous visit.
  function select(next) {
    stop();
    current = next;
    index = 0;

    runs.forEach((r, i) => {
      r.el.hidden = i !== next;
      if (i === next) return;
      for (const step of r.steps) step.classList.remove('is-in', 'is-working', 'is-done');
    });

    picks.forEach((btn, i) => btn.setAttribute('aria-pressed', String(i === next)));
    if (modelEl) modelEl.textContent = run().el.dataset.model || '';
    if (routeEl) routeEl.textContent = `ROUTE: ${hex(8)}`;

    sync();
  }

  function sync() {
    stop();

    // Reduced motion gets the finished transcript rather than a frozen first
    // line: the point of the panel is the receipt at the end of it.
    if (!motion.shouldRunAnimations) {
      index = run().steps.length - 1;
      paint(index);
      return;
    }

    paint(index);
    if (visible) advance();
  }

  picks.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      pinned = true;
      select(i);
    });
  });

  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      sync();
    },
    { threshold: 0.15 }
  ).observe(panel);

  onMotionChange(sync);

  select(0);
}
