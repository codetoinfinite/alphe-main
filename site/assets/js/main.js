import { qs, qsa } from './lib/dom.js';
import { initNav } from './modules/nav.js';
import { initReveal, initSplitReveal } from './modules/reveal.js';
import { initGrain } from './modules/grain.js';
import { initConsole } from './modules/console.js';
import { initDemo } from './modules/demo.js';
import {
  initCursor,
  initMarquee,
  initCounters,
  initAccordion,
  initParallax,
} from './modules/ui.js';
import {
  initCoverage,
  initCalculator,
  initStack,
  initDither,
  initForm,
} from './modules/sections.js';
import { initBenchmarks } from './modules/benchmarks.js';
import { initTools } from './modules/tools.js';
import { initFooterMark } from './modules/footer.js';

// Everything here is tolerant of absent markup, so every page loads the same
// entry point and simply gets whatever it has elements for.

initNav();
initCursor();
initGrain();
initReveal();
initSplitReveal();
initMarquee();
initCounters();
initAccordion();
initParallax();
initConsole();
initDemo();
initCoverage();
initTools();
initCalculator();
initStack();
initBenchmarks();
initDither();
initForm();
initFooterMark();

// Mark the current page in the nav without hard-coding it into six templates.
const here = location.pathname.replace(/index\.html$/, '');
for (const link of qsa('.nav__link[href]')) {
  const href = link.getAttribute('href');
  if (href !== '/' && here.startsWith(href)) link.setAttribute('aria-current', 'page');
}

// "/" is excluded above because startsWith would match it from every page. It
// still needs marking, and the link that goes there is the brand — so the home
// page was the one page in the nav that announced no current location at all.
// The brand is not a .nav__link, so this says where you are without changing
// how anything looks.
if (here === '/') qs('.nav__brand[href="/"]')?.setAttribute('aria-current', 'page');

// WebGL is loaded only when a page actually has a canvas for it. three.js is
// the single largest asset on the site and the sub-pages that do not draw
// anything should never pay for it.
const glCanvases = qsa('[data-particles]');

if (glCanvases.length) {
  import('./scenes/particle-field.js').then(({ initParticleField }) => {
    const fields = [];

    // Avoidance is scoped to the canvas's own section: the CTA field must keep
    // clear of the CTA copy, not of the hero headline five screens above it.
    const avoidTargets = (canvas) =>
      qsa('[data-avoid]', canvas.closest('section, .cta, .page-head') || document);

    // The scroll journey is declared on the sections themselves, in document
    // order, so adding or reordering a section moves the field with it.
    // x and y are fractions of the viewport, +y up; scale multiplies the shape's
    // own natural size. Placement lives in the markup because it is a property
    // of the section's layout, not of the shape.
    const stations = qsa('[data-field-shape]').map((el) => ({
      el,
      // Both the trigger and the fade run off the headline, not off the section
      // box. Sections here range from 0.6 to 2.1 screens tall, so a box-relative
      // trigger fires hundreds of pixels earlier on the tall ones.
      //
      // Two queries rather than one selector list, because a list returns the
      // first match in *document order* — a declared anchor deeper in a section
      // would silently lose to the headline above it. The override has to win.
      anchor:
        qs('[data-field-anchor]', el) || qs('[data-avoid], .section-title, h1, h2', el) || el,
      shape: el.dataset.fieldShape,
      x: parseFloat(el.dataset.fieldX) || 0,
      y: parseFloat(el.dataset.fieldY) || 0,
      scale: parseFloat(el.dataset.fieldScale) || 1,
      // What the shape holds still against as the page moves: the headline it
      // was parked beside, or — for a full-bleed field composed against the
      // whole block — the section's own top edge.
      lock: el.dataset.fieldLock || 'anchor',
      // How much of the page's motion the cloud carries between stations. 1 is
      // the default drift; a section that pins itself against the viewport asks
      // for 0, because its layout stops moving and the gap the shape was placed
      // in stops moving with it.
      ride: el.dataset.fieldRide === undefined ? 1 : parseFloat(el.dataset.fieldRide) || 0,
      // How this section's [data-avoid] copy is kept clear: displaced around, or
      // faded out from under. Body copy takes the fade — see the shader.
      avoid: el.dataset.fieldAvoid || 'push',
      // A multiplier on the station's own opacity, for a shape that is meant to
      // be caught rather than read — a glimpse on the way past, not a logo the
      // page stops on.
      dim: el.dataset.fieldDim === undefined ? 1 : parseFloat(el.dataset.fieldDim) || 0,
      // How far off its own shape the cloud is allowed to sit here, as a
      // fraction of the frame's short side. dim's counterpart: dim decides how
      // loudly the mark is shown, this decides how much of it there is to show.
      // A glimpse wants both — a faint outline is still an outline.
      scatter: parseFloat(el.dataset.fieldScatter) || 0,
    }));

    for (const canvas of qsa('[data-particles]')) {
      const texts = (canvas.dataset.particleTexts || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);

      fields.push(
        initParticleField(canvas, {
          zSign: canvas.dataset.particles === 'back' ? -1 : 1,
          textEls: canvas.dataset.particleAvoid ? avoidTargets(canvas) : [],
          attract: canvas.dataset.particleMode === 'attract',
          autoCycle: canvas.dataset.particleCycle !== 'off',
          texts,
          stations: canvas.dataset.particleStations ? stations : [],
        })
      );
    }

    // The headline's box moves when the font swaps in or the text re-wraps, so
    // the avoidance region has to be re-measured rather than captured once.
    document.fonts.ready.then(() => {
      for (const f of fields) f.remeasure();
    });
    let t = 0;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        for (const f of fields) f.remeasure();
      }, 260);
    });
  })
    // three.js is the largest asset on the site and this import is the one here
    // that can fail on its own — a connection dropped mid-load rejects it. The
    // field is decorative, so the page is right to carry on without it; what it
    // was doing was carrying on without saying so, as an unhandled rejection
    // nobody sees. Catching on the tail covers the import and the setup after
    // it, and neither has anything the page needs.
    .catch((err) => {
      console.error('alphe: the particle field could not start —', err);
    });
}
