import { qs } from '../lib/dom.js';

// Header that hides on the way down and returns on the way up.
//
// Two guards that most implementations miss: it never hides while the mobile
// menu is open, and it never hides while focus is inside it — a keyboard user
// tabbing through the links must not have them slide off the top of the screen.

export function initNav() {
  const nav = qs('[data-nav]');
  if (!nav) return;

  const toggle = qs('[data-nav-toggle]', nav);
  const links = qs('.nav__links', nav);
  let lastY = window.scrollY;
  let open = false;

  function setOpen(next) {
    open = next;
    nav.classList.toggle('is-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }

  toggle?.addEventListener('click', () => setOpen(!open));

  links?.addEventListener('click', (e) => {
    if (open && e.target.closest('a')) setOpen(false);
  });

  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      nav.classList.toggle('is-stuck', y > 12);

      const focusInside = nav.contains(document.activeElement);
      const goingDown = y > lastY && y > 240;
      nav.classList.toggle('is-hidden', goingDown && !open && !focusInside);
      lastY = y;
    },
    { passive: true }
  );

  // The scroll handler can decline to hide the bar while focus is inside it, but
  // it cannot undo a hide that already happened — no scroll event fires when
  // focus moves into a fixed element. So a keyboard user who scrolls down and
  // then tabs back to the top lands on links sitting above the viewport, with
  // the focus ring drawn off-screen. Bring the bar back the moment focus enters.
  nav.addEventListener('focusin', () => nav.classList.remove('is-hidden'));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  matchMedia('(min-width: 901px)').addEventListener('change', (e) => {
    if (e.matches && open) setOpen(false);
  });
}
