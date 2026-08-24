// Shared viewport + device-pixel-ratio state.
//
// The DPR trap: `resize` does NOT fire when a window moves between a Retina and
// a non-Retina display. The size is unchanged, only the pixel density moved, so
// every canvas keeps its old backing store and renders at half or double
// resolution. matchMedia on the current resolution is the only reliable signal.

const listeners = new Set();

export const viewport = {
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
};

function measure() {
  viewport.width = window.innerWidth;
  viewport.height = window.innerHeight;
  viewport.dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const cb of listeners) cb(viewport);
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(measure, 120);
});

// Re-arm on every change: the query is pinned to one exact dppx value, so once
// it stops matching it will never fire again. A fresh listener has to be built
// around the new ratio each time.
let dprQuery = null;
function watchDpr() {
  if (dprQuery) dprQuery.removeEventListener('change', onDprChange);
  dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  dprQuery.addEventListener('change', onDprChange);
}
function onDprChange() {
  measure();
  watchDpr();
}
watchDpr();

export function onViewport(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// True while any part of `el` is on screen. `threshold: 0.1` rather than 0 so a
// scene one pixel into view does not start and stop on every scroll jitter.
export function inViewport(el, cb, threshold = 0.1) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) cb(e.isIntersecting, e);
    },
    { threshold }
  );
  io.observe(el);
  return () => io.disconnect();
}
