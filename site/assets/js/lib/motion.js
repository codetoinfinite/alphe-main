// Motion capability, as live state rather than a one-shot boolean.
//
// prefers-reduced-motion can flip mid-session (macOS System Settings, a screen
// reader turning it on). Reading it once at load and caching the answer means
// the page keeps animating at someone who just asked it to stop.

const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
const hoverQuery = matchMedia('(hover: hover) and (pointer: fine)');

const listeners = new Set();

export const motion = {
  prefersReducedMotion: reduceQuery.matches,
  // Coarse pointers get no hover-driven effects at all — a cursor follower on
  // touch is a thing that chases a finger it cannot see.
  canHover: hoverQuery.matches,
  // Scenes read this instead of gating on `prefersReducedMotion` directly, so a
  // single flag can also park everything when the tab is hidden.
  shouldRunAnimations: !reduceQuery.matches && !document.hidden,
};

function publish() {
  motion.prefersReducedMotion = reduceQuery.matches;
  motion.canHover = hoverQuery.matches;
  motion.shouldRunAnimations = !reduceQuery.matches && !document.hidden;
  document.documentElement.classList.toggle('reduced-motion', motion.prefersReducedMotion);
  document.documentElement.classList.toggle('can-hover', motion.canHover);
  for (const cb of listeners) cb(motion);
}

reduceQuery.addEventListener('change', publish);
hoverQuery.addEventListener('change', publish);
document.addEventListener('visibilitychange', publish);
publish();

export function onMotionChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
