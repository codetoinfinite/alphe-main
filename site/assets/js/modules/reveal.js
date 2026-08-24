import { qsa, splitText, groupIntoLines, debounce } from '../lib/dom.js';
import { motion } from '../lib/motion.js';

// Scroll reveals.
//
// One IntersectionObserver for the whole document rather than one per element,
// and every element is unobserved the moment it fires. A reveal that can only
// happen once has no business staying subscribed for the life of the page.

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    }
  },
  { rootMargin: '0px 0px -12% 0px', threshold: 0.05 }
);

export function initReveal(root = document) {
  for (const el of qsa('[data-reveal]', root)) {
    // Stagger reads from the DOM so markup controls rhythm, not JS.
    const stagger = Number(el.dataset.revealStagger || 0);
    if (stagger) el.style.setProperty('--reveal-delay', `${stagger}ms`);
    observer.observe(el);
  }

  for (const group of qsa('[data-reveal-group]', root)) {
    const step = Number(group.dataset.revealGroup) || 70;
    qsa(':scope > *', group).forEach((child, i) => {
      child.setAttribute('data-reveal', '');
      child.style.setProperty('--reveal-delay', `${i * step}ms`);
      observer.observe(child);
    });
  }
}

// Line-by-line headline reveal.
//
// Splitting before the webfont loads measures against the fallback, and the line
// boxes land in the wrong places — so this waits on document.fonts.ready every
// time, including after a resize re-split.
export async function initSplitReveal(root = document) {
  const targets = qsa('[data-split-lines]', root);
  if (!targets.length) return;

  await document.fonts.ready;

  function apply(el) {
    const chars = splitText(el);
    const lines = groupIntoLines(chars);
    lines.forEach((line, lineIndex) => {
      for (const ch of line) {
        ch.style.transitionDelay = `${lineIndex * 90}ms`;
      }
    });
    el.classList.add('split-ready');
  }

  for (const el of targets) {
    apply(el);
    observer.observe(el);
    el.setAttribute('data-reveal', '');
  }

  // Re-split on resize: line breaks are a layout result, so a width change
  // invalidates every grouping. Debounced, because resize fires continuously.
  const resplit = debounce(() => {
    for (const el of targets) {
      const wasRevealed = el.classList.contains('is-revealed');
      apply(el);
      if (wasRevealed) el.classList.add('is-revealed');
    }
  }, 220);

  window.addEventListener('resize', resplit);

  if (motion.prefersReducedMotion) {
    for (const el of targets) el.classList.add('is-revealed');
  }
}
