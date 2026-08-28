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

  // aria-expanded says the button opens something; aria-controls says what. The
  // id is set here rather than in the markup because the button is inert without
  // this file anyway — six pages carrying an id for a relationship that only
  // exists when the script runs is six places for it to go stale.
  if (links && toggle) {
    if (!links.id) links.id = 'nav-menu';
    toggle.setAttribute('aria-controls', links.id);
  }

  function setOpen(next) {
    open = next;
    nav.classList.toggle('is-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';

    // Everything the open menu covers. The panel is fixed over the whole page
    // below the bar, so the page under it was out of reach for the mouse and
    // still in reach for Tab: fifteen links and buttons behind an overlay, each
    // one focusing something nobody can see. inert closes the whole branch at
    // once and leaves the bar itself — the toggle included — alone.
    //
    // Read on every open rather than captured once at init: the cursor and the
    // grain canvas are appended to the body by modules that run after this one,
    // and a list taken here would never contain them.
    for (const el of document.body.children) {
      if (el !== nav) el.inert = open;
    }
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
    if (e.key !== 'Escape' || !open) return;

    // Escape from inside the menu has to put focus somewhere, and the only
    // sensible somewhere is the control that opened it. Left alone, focus sits
    // on a link that visibility:hidden has just taken out of the tree, and the
    // next Tab starts over from the top of the document.
    const inside = nav.contains(document.activeElement);
    setOpen(false);
    if (inside) toggle?.focus();
  });

  matchMedia('(min-width: 901px)').addEventListener('change', (e) => {
    if (e.matches && open) setOpen(false);
  });
}
