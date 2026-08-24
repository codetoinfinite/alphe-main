import { qs } from '../lib/dom.js';
import { onFrame, damp } from '../lib/raf.js';
import { motion } from '../lib/motion.js';

// Pointer light on the closing mark.
//
// The wordmark's fill is a radial gradient clipped to the letters, so moving
// the gradient moves a pool of light across them. The position is eased rather
// than assigned: a pool pinned to the pointer reads as a cursor artefact, one
// that lags slightly reads as light falling on the letters.
//
// The pointer is tracked over the whole footer, not just the mark's own strip.
// The mark is a couple of hundred pixels of type at the very bottom of the
// page, and a light that only exists once you are inside it is a light most
// people never find.
//
// The pool is never switched off. This module used to zero the radius as soon
// as it loaded and wait for a pointer to bring it back, which meant the desktop
// mark sat as bare outlines for anyone who scrolled to the bottom to read
// rather than to sweep the mouse across the wordmark — the lit mark the phones
// were getting from the stylesheet's resting value was the one thing scripting
// took away. The pointer moves the light now; it does not create it.

// Where the pool sits with no pointer in the footer, in the mark's own box.
// The same place the stylesheet's --fx / --fy put it, so a pointer that leaves
// hands the light back to exactly the state a page without scripting shows.
const REST_X = 0.5;
const REST_Y = 0.47;

export function initFooterMark(root = document) {
  const mark = qs('[data-footer-mark]', root);
  if (!mark) return;

  // The outline's length, in the space the browser dashes in.
  //
  // The path is non-scaling-stroke, and that makes the dash pattern screen
  // pixels while getTotalLength() answers in the viewBox's units. The glyph is
  // sized in vw, so the factor between the two is whatever the mark happens to
  // be wide right now — 1.54 at 1440. Measure it, and re-measure on resize: a
  // dash shorter than the outline stops drawing partway and leaves the mark
  // with a leg missing, which is exactly what a stale value gives you after the
  // window grows.
  const glyphPath = qs('.footer__glyph-path', mark);
  const measure = () => {
    if (!glyphPath) return;
    const svg = glyphPath.ownerSVGElement;
    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    if (!scale) return;
    mark.style.setProperty('--fd', `${(glyphPath.getTotalLength() * scale).toFixed(1)}px`);
  };
  measure();

  let sized = 0;
  window.addEventListener('resize', () => {
    clearTimeout(sized);
    sized = setTimeout(measure, 180);
  });

  // The mark reveals off its own observer rather than the shared one, which
  // pulls the root's bottom edge up by 12% so a reveal fires after the element
  // has properly arrived rather than as its first pixel appears. That is right
  // everywhere except here: this is the last element in the document, so it can
  // never sit further from the bottom of the viewport than its own height, and
  // on a tall window that height is less than the 12% — the element the whole
  // page ends on would stay at opacity 0 for good. No margin, no threshold.
  const reveal = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-revealed');
      reveal.disconnect();
    }
  });
  reveal.observe(mark);

  // Coarse pointers have no hover position to track, and the static pool the
  // stylesheet paints is the better answer for them.
  if (!motion.canHover) return;

  const zone = mark.closest('.footer') || mark;

  let clientX = 0;
  let clientY = 0;
  let inside = false;
  let x = 0;
  let y = 0;
  // Whether the pool has a position yet this visit. Without it the first frame
  // after the pointer arrives flies the light in from wherever it was last
  // left, which can be the far side of the page.
  let placed = false;
  let unsubscribe = null;

  function frame(dt) {
    // Read per frame rather than caching: the footer's box moves under a scroll
    // and resizes under a reflow, and this only runs while a pointer is in it.
    const box = mark.getBoundingClientRect();
    const restX = box.width * REST_X;
    const restY = box.height * REST_Y;
    const targetX = inside ? clientX - box.left : restX;
    const targetY = inside ? clientY - box.top : restY;

    if (!placed) {
      x = targetX;
      y = targetY;
      placed = true;
    }

    const k = damp(0.0016, dt);
    x += (targetX - x) * k;
    y += (targetY - y) * k;

    mark.style.setProperty('--fx', `${x.toFixed(1)}px`);
    mark.style.setProperty('--fy', `${y.toFixed(1)}px`);

    // Home again and nothing left to chase: hand the position back to the
    // stylesheet and park the loop rather than spin it for the life of the
    // page. Removing the properties rather than writing the rest position in
    // pixels is what keeps a resize correct while the loop is parked — the
    // percentages re-solve themselves, a pixel value would not.
    if (!inside && Math.abs(targetX - x) < 0.5 && Math.abs(targetY - y) < 0.5) {
      placed = false;
      mark.style.removeProperty('--fx');
      mark.style.removeProperty('--fy');
      unsubscribe?.();
      unsubscribe = null;
    }
  }

  function wake() {
    if (!unsubscribe) unsubscribe = onFrame(frame);
  }

  zone.addEventListener('pointermove', (event) => {
    // A touch that lands in the footer would otherwise leave the pool stranded
    // wherever the finger lifted.
    if (event.pointerType === 'touch') return;
    clientX = event.clientX;
    clientY = event.clientY;
    inside = true;
    wake();
  });

  zone.addEventListener('pointerleave', () => {
    inside = false;
    wake();
  });
}
