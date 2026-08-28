import { qs, qsa } from '../lib/dom.js';
import { onFrame, damp, mapRange } from '../lib/raf.js';
import { motion } from '../lib/motion.js';

// ---------------------------------------------------------------------------
// Cursor

export function initCursor() {
  if (!motion.canHover) return;

  const el = document.createElement('div');
  el.className = 'cursor';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);

  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let tx = x;
  let ty = y;

  window.addEventListener(
    'pointermove',
    (e) => {
      tx = e.clientX;
      ty = e.clientY;
      el.classList.add('is-active');
      const interactive = e.target.closest('a, button, input, [data-cursor-hover]');
      el.classList.toggle('is-hovering', Boolean(interactive));
    },
    { passive: true }
  );

  document.addEventListener('pointerleave', () => el.classList.remove('is-active'));

  onFrame((dt) => {
    const k = damp(0.0005, dt);
    x += (tx - x) * k;
    y += (ty - y) * k;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  });
}

// ---------------------------------------------------------------------------
// Marquee
//
// Speed is px/second, never a fixed duration. A fixed duration means a wider
// track moves faster, so two marquees of different content scroll at visibly
// different speeds — the single most common bug in this component.

export function initMarquee(root = document) {
  for (const marquee of qsa('[data-marquee]', root)) {
    const track = qs('.marquee__track', marquee);
    const group = qs('.marquee__group', track);
    if (!track || !group) continue;

    const speed = Number(marquee.dataset.marquee) || 45;
    const direction = marquee.dataset.marqueeDirection === 'right' ? 1 : -1;

    let groupWidth = 0;
    let offset = 0;
    let hovering = false;
    let speedScale = 1;

    function fill() {
      // Duplicate until the track is at least twice the viewport, so the seam is
      // always off-screen when the offset wraps.
      qsa('.marquee__group', track)
        .slice(1)
        .forEach((n) => n.remove());
      groupWidth = group.getBoundingClientRect().width;
      if (!groupWidth) return;
      const needed = Math.ceil((marquee.getBoundingClientRect().width * 2) / groupWidth) + 1;
      for (let i = 1; i < needed; i++) {
        const clone = group.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      }
    }

    fill();
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        offset = 0;
        fill();
      }, 200);
    });

    marquee.addEventListener('pointerenter', () => (hovering = true));
    marquee.addEventListener('pointerleave', () => (hovering = false));

    onFrame((dt) => {
      if (!groupWidth || motion.prefersReducedMotion || document.hidden) return;
      // Ease into the hover slow-down instead of snapping the velocity.
      speedScale += ((hovering ? 0.25 : 1) - speedScale) * damp(0.002, dt);
      offset += direction * speed * speedScale * dt;
      // Modulo, not a reset — a reset drops sub-pixel remainder and stutters.
      offset = ((offset % groupWidth) + groupWidth) % groupWidth;
      track.style.transform = `translate3d(${(offset - groupWidth).toFixed(2)}px, 0, 0)`;
    });
  }
}

// ---------------------------------------------------------------------------
// Counters

const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

export function initCounters(root = document) {
  const els = qsa('[data-count]', root);
  if (!els.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        run(entry.target);
      }
    },
    { threshold: 0.4 }
  );

  function run(el) {
    const to = Number(el.dataset.count);
    const decimals = Number(el.dataset.countDecimals || 0);
    const prefix = el.dataset.countPrefix || '';
    const suffix = el.dataset.countSuffix || '';
    const duration = Number(el.dataset.countDuration || 1500) / 1000;
    // Four-figure counts are written with a separator everywhere else on the
    // site, and a counter that lands on 4500 next to a sentence saying 4,500+
    // reads as a different number.
    const fmt = (v) =>
      prefix +
      v.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }) +
      suffix;

    if (motion.prefersReducedMotion) {
      el.textContent = fmt(to);
      return;
    }

    let t = 0;
    const stop = onFrame((dt) => {
      t = Math.min(1, t + dt / duration);
      el.textContent = fmt(to * easeOutExpo(t));
      if (t >= 1) stop();
    });
  }

  for (const el of els) io.observe(el);
}

// ---------------------------------------------------------------------------
// Accordion
//
// Height is animated from a measured pixel value, then released back to auto on
// completion so the panel reflows correctly if its content or the viewport
// changes while open.

export function initAccordion(root = document) {
  let panelId = 0;

  for (const accordion of qsa('[data-accordion]', root)) {
    const single = accordion.dataset.accordion !== 'multi';
    const items = qsa('.accordion__item', accordion);

    items.forEach((item) => {
      const trigger = qs('.accordion__trigger', item);
      const panel = qs('.accordion__panel', item);
      if (!trigger || !panel) return;

      trigger.setAttribute('aria-expanded', 'false');

      // aria-expanded was being announced against nothing: the panel it refers
      // to had no id and the trigger no aria-controls, so "collapsed" was said
      // without ever saying what was collapsed.
      if (!panel.id) panel.id = `accordion-panel-${++panelId}`;
      trigger.setAttribute('aria-controls', panel.id);

      // A closed panel is height:0 and overflow:hidden, which hides it from the
      // eye and from nothing else — its links stayed in the tab order and in the
      // accessibility tree, six of them across the site, each one focusing text
      // that is not on screen. inert closes the branch properly, and unlike
      // display:none or visibility it leaves the height transition alone.
      panel.inert = true;

      function close(el) {
        const p = qs('.accordion__panel', el);
        p.inert = true;
        p.style.height = `${p.scrollHeight}px`;
        requestAnimationFrame(() => {
          p.style.height = '0px';
        });
        el.classList.remove('is-open');
        qs('.accordion__trigger', el).setAttribute('aria-expanded', 'false');
      }

      trigger.addEventListener('click', () => {
        const isOpen = item.classList.contains('is-open');

        if (single) {
          for (const other of items) {
            if (other !== item && other.classList.contains('is-open')) close(other);
          }
        }

        if (isOpen) {
          close(item);
          return;
        }

        item.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        panel.inert = false;
        panel.style.height = `${panel.scrollHeight}px`;
        panel.addEventListener(
          'transitionend',
          (e) => {
            if (e.propertyName === 'height' && item.classList.contains('is-open')) {
              panel.style.height = 'auto';
            }
          },
          { once: true }
        );
      });
    });

    if (accordion.dataset.accordionOpen) {
      qs('.accordion__trigger', items[Number(accordion.dataset.accordionOpen)])?.click();
    }
  }
}

// ---------------------------------------------------------------------------
// Parallax
//
// Transform-only, driven by the shared loop, and gated on visibility — a
// parallax element that has scrolled past has nothing to compute.

export function initParallax(root = document) {
  const els = qsa('[data-parallax]', root);
  if (!els.length || motion.prefersReducedMotion) return;

  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target);
      else visible.delete(e.target);
    }
  });
  for (const el of els) io.observe(el);

  onFrame(() => {
    if (!visible.size) return;
    const vh = window.innerHeight;
    for (const el of visible) {
      const rect = el.getBoundingClientRect();
      const progress = mapRange(rect.top + rect.height / 2, vh, 0, -1, 1);
      const amount = Number(el.dataset.parallax || 40);
      el.style.transform = `translate3d(0, ${(progress * amount).toFixed(2)}px, 0)`;
    }
  });
}
