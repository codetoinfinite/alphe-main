import { qs, qsa, debounce } from '../lib/dom.js';
import { onFrame, damp, clamp, mapRange } from '../lib/raf.js';
import { motion, onMotionChange } from '../lib/motion.js';
import { inViewport } from '../lib/viewport.js';

// ---------------------------------------------------------------------------
// Coverage lanes
//
// Three rows of provider marks drifting at different speeds, alternate rows
// against each other. Three things drive the offset and they are deliberately
// different in kind:
//
//   - a constant per-lane speed, so the block is alive on a touch screen and on
//     a page nobody has touched yet
//   - the page's own scroll velocity, borrowed and decayed, so the lanes answer
//     the one gesture every device has
//   - a hover slow-down, so a pointer can hold a name still long enough to read
//
// The markup holds one copy of each lane. The clones that close the loop are
// made here, after fonts load — a set measured against the fallback face is a
// set whose seam gaps by twenty pixels once the real one arrives.

export function initCoverage(root = document) {
  for (const el of qsa('[data-coverage]', root)) {
    const lanes = qsa('[data-coverage-lane]', el)
      .map((lane, i) => ({
        lane,
        track: qs('.coverage__track', lane),
        set: qs('.coverage__set', lane),
        speed: Number(lane.dataset.laneSpeed) || 24,
        dir: lane.dataset.laneDir === 'right' ? 1 : -1,
        // Start each lane somewhere else in its own loop. Without this the three
        // rows begin perfectly aligned, which is the grid this replaced.
        phase: (i * 0.41) % 1,
        width: 0,
        offset: 0,
      }))
      .filter((l) => l.track && l.set);

    if (!lanes.length) continue;

    let hovering = false;
    let speedScale = 1;
    let scrollPush = 0;
    let lastY = window.scrollY;
    let visible = false;
    let reduced = motion.prefersReducedMotion;
    let stop = null;

    function fill() {
      for (const l of lanes) {
        for (const clone of qsa('.coverage__set', l.track).slice(1)) clone.remove();
        l.track.style.transform = '';
        l.width = 0;
      }

      // A reader who asked for no motion gets the list and none of the
      // machinery: no clones putting every provider name into the page twice,
      // and CSS wraps the single set instead of running it off the edge.
      if (motion.prefersReducedMotion) return;

      for (const l of lanes) {
        const setWidth = l.set.getBoundingClientRect().width;
        const laneWidth = l.lane.getBoundingClientRect().width;
        if (!setWidth || !laneWidth) continue;

        l.width = setWidth;
        l.offset = setWidth * l.phase;
        // One set to fill the lane, one to cover the wrap, one for the scroll
        // push overshooting a frame.
        const copies = Math.ceil(laneWidth / setWidth) + 2;
        for (let i = 1; i < copies; i++) {
          const clone = l.set.cloneNode(true);
          clone.setAttribute('aria-hidden', 'true');
          l.track.appendChild(clone);
        }
      }
    }

    function frame(dt) {
      const y = window.scrollY;
      const instant = dt > 0 ? (y - lastY) / dt : 0;
      lastY = y;

      // Borrowed momentum, not a second engine. Raw per-frame scroll deltas are
      // spiky enough to make a 26px/s drift stutter, so the push is clamped
      // first and then eased — a trackpad flick nudges the lanes, it does not
      // fire them across the viewport.
      scrollPush += (clamp(instant * 0.3, -480, 480) - scrollPush) * damp(0.0006, dt);
      speedScale += ((hovering ? 0.22 : 1) - speedScale) * damp(0.002, dt);

      for (const l of lanes) {
        if (!l.width) continue;
        l.offset += l.dir * (l.speed * speedScale + scrollPush) * dt;
        // Modulo, not a reset: a reset drops the sub-pixel remainder and the
        // lane visibly ticks once per loop.
        l.offset = ((l.offset % l.width) + l.width) % l.width;
        l.track.style.transform = `translate3d(${(l.offset - l.width).toFixed(2)}px, 0, 0)`;
      }
    }

    // Off screen or in a hidden tab, this costs nothing: the callback leaves the
    // shared loop entirely rather than returning early from it.
    function sync() {
      const run = visible && motion.shouldRunAnimations && lanes.some((l) => l.width);
      if (run && !stop) {
        lastY = window.scrollY;
        stop = onFrame(frame);
      } else if (!run && stop) {
        stop();
        stop = null;
      }
    }

    fill();
    document.fonts.ready.then(() => {
      fill();
      sync();
    });

    inViewport(el, (isVisible) => {
      visible = isVisible;
      sync();
    }, 0.05);

    // visibilitychange publishes through here too, so a backgrounded tab parks
    // the lanes without a second listener.
    onMotionChange(() => {
      if (motion.prefersReducedMotion !== reduced) {
        reduced = motion.prefersReducedMotion;
        fill();
      }
      sync();
    });

    // A width change invalidates every clone count and every wrap width.
    window.addEventListener(
      'resize',
      debounce(() => {
        fill();
        sync();
      }, 200)
    );

    el.addEventListener('pointerenter', () => {
      if (motion.canHover) hovering = true;
    });
    el.addEventListener('pointerleave', () => {
      hovering = false;
    });
  }
}

// ---------------------------------------------------------------------------
// Cost calculator

const money = (n) =>
  n >= 1000000
    ? `$${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}M`
    : n >= 1000
      ? `$${Math.round(n / 1000)}K`
      : `$${Math.round(n)}`;

export function initCalculator(root = document) {
  const calc = qs('[data-calculator]', root);
  if (!calc) return;

  const slider = qs('.calc__slider', calc);
  const spendOut = qs('[data-calc-spend]', calc);
  const afterOut = qs('[data-calc-after]', calc);
  const savedOut = qs('[data-calc-saved]', calc);
  const footOut = qs('[data-calc-foot]', calc);

  // Logarithmic, so the slider spends most of its travel in the range real
  // teams actually sit in ($2K–$80K/mo) rather than sprinting past it.
  function spendFor(t) {
    const min = Math.log(1000);
    const max = Math.log(2000000);
    return Math.exp(min + (max - min) * t);
  }

  // One number, the same one the rest of the site quotes. This used to taper
  // from 55% up to 70% across the slider, which meant the widget answered 61%
  // at its own default position while the headline three screens up said 70%.
  const RATE = 0.7;

  function update() {
    const t = Number(slider.value) / 1000;
    const spend = spendFor(t);
    const after = spend * (1 - RATE);

    spendOut.textContent = `${money(spend)}/mo`;
    afterOut.textContent = `${money(after)}/mo`;
    savedOut.textContent = money((spend - after) * 12);
    footOut.textContent = `${Math.round(RATE * 100)}% reduction: routing, semantic cache hits and prompt compression, measured against your current provider mix.`;
  }

  slider.addEventListener('input', update);
  update();
}

// ---------------------------------------------------------------------------
// Lifecycle stack
//
// The stacking itself is pure CSS: every card is sticky at the same offset with
// a rising z-index, so the browser deals the deck and there is nothing here to
// go out of step with the scroll. All this does is light the matching entry in
// the index on the left, and scroll to a card when one is clicked.
//
// Positions are read off the zero-height marks that sit beside each card in
// normal flow. Measuring the cards themselves would return wherever they happen
// to be parked, which is the same number for all five of them.

export function initStack(root = document) {
  const section = qs('[data-stack]', root);
  if (!section) return;

  const marks = qsa('[data-stack-mark]', section);
  const rails = qsa('[data-stack-jump]', section);
  if (!marks.length) return;

  // The offset the cards stick at, straight from the stylesheet so the two
  // cannot drift apart.
  const slot = qs('.stack__slot', section);
  const stick = parseFloat(getComputedStyle(slot).top) || 0;

  let offsets = [];
  let active = -1;

  // Distance from the top of the section to each card, which only changes when
  // the page reflows.
  function measure() {
    const base = section.getBoundingClientRect().top + window.scrollY;
    offsets = marks.map((m) => m.getBoundingClientRect().top + window.scrollY - base);
  }

  measure();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 180);
  });
  // Fonts land after first paint and move everything below them.
  if (document.fonts) document.fonts.ready.then(measure);

  function setActive(i) {
    if (i === active) return;
    active = i;
    rails.forEach((r, n) => {
      r.classList.toggle('is-on', n === i);
      if (n === i) r.setAttribute('aria-current', 'step');
      else r.removeAttribute('aria-current');
    });
  }

  onFrame(() => {
    const rect = section.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;

    // How far into the section the sticky line has travelled. The card on top
    // is the last one whose flow position that line has passed.
    const passed = stick - rect.top;
    let i = 0;
    for (let n = 0; n < offsets.length; n++) {
      if (offsets[n] <= passed + 1) i = n;
    }
    setActive(i);
  });

  rails.forEach((rail, i) => {
    rail.addEventListener('click', () => {
      const mark = marks[i];
      if (!mark) return;
      // Land the card exactly where it parks. scroll-behavior on the document
      // decides whether that is a glide or a cut, and reduced motion already
      // turns it off there.
      window.scrollTo({ top: mark.getBoundingClientRect().top + window.scrollY - stick });
    });
  });
}

// ---------------------------------------------------------------------------
// Ordered dithering
//
// An 8×8 Bayer matrix quantises a smooth gradient into two colours without the
// banding a naive threshold produces. Drawn once per resize — it is a texture,
// not an animation, and it has no business costing a frame.

const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

export function initDither(root = document) {
  for (const canvas of qsa('[data-dither]', root)) {
    const ctx = canvas.getContext('2d');

    function draw() {
      const rect = canvas.getBoundingClientRect();
      // Half resolution on purpose: the dot pattern wants to be visible, and at
      // 1:1 on a Retina display it disappears into the panel.
      const w = Math.max(1, Math.round(rect.width / 2));
      const h = Math.max(1, Math.round(rect.height / 2));
      canvas.width = w;
      canvas.height = h;

      const image = ctx.createImageData(w, h);
      const data = image.data;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // Radial falloff from the bottom-left corner.
          const nx = x / w;
          const ny = y / h;
          const d = Math.sqrt(nx * nx + (1 - ny) * (1 - ny)) / 1.414;
          const value = clamp(1 - d * 1.35, 0, 1);

          // The matrix contains a zero cell, so an unbiased comparison lights
          // that pixel even where the gradient is fully black. Bias it.
          const threshold = BAYER[y & 7][x & 7] / 64 + 0.001;
          const on = value > threshold;

          const i = (y * w + x) * 4;
          data[i] = 81;
          data[i + 1] = 162;
          data[i + 2] = 255;
          data[i + 3] = on ? 150 : 0;
        }
      }
      ctx.putImageData(image, 0, 0);
    }

    draw();
    let t = 0;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(draw, 220);
    });
  }
}

// ---------------------------------------------------------------------------
// Early-access form
//
// No backend to post to yet, so it validates, gives real feedback, and says
// plainly what it did. A form that silently pretends to submit is worse than
// one that admits it is a waitlist stub.

// One rule per input type, so the CTA strip (email alone) and the contact page
// (name, email, phone, internship) run through the same handler. `empty` is the
// message for a blank field, `bad` for one that was filled in wrongly.
const RULES = {
  email: {
    test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
    empty: 'Enter your work email',
    bad: 'Enter a valid work email',
  },
  text: {
    test: (v) => v.length >= 2,
    empty: 'Enter your name',
    bad: 'Enter your name',
  },
  // Digits only, after stripping the punctuation people actually type: spaces,
  // dashes, brackets, a leading +. Seven is the shortest real subscriber
  // number, fifteen the E.164 ceiling.
  tel: {
    test: (v) => /^\+?[\d\s\-().]+$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15,
    empty: 'Enter your contact number',
    bad: 'Enter a valid contact number',
  },
};

// Same origin, so `connect-src 'self'` covers it and the CSP does not have to be
// widened for a form service. See site/contact.php for why that mattered.
const ENDPOINT = '/contact.php';

export function initForm(root = document) {
  for (const form of qsa('[data-form]', root)) {
    const inputs = qsa('.form__input', form);
    const status = qs('.form__status', form);
    const submit = qs('button[type="submit"]', form);
    let sending = false;

    // The form carries novalidate: the browser's own bubble would swallow
    // submit for anything it dislikes, so this handler would only ever see
    // input that was already almost right, and whatever it last wrote would
    // still be sitting on screen. One validator, one message.
    const clear = () => {
      status.textContent = '';
      status.classList.remove('is-ok', 'is-err');
      for (const i of inputs) i.removeAttribute('aria-invalid');
    };

    for (const input of inputs) input.addEventListener('input', clear);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (sending) return;
      clear();

      // First failure wins: three messages at once is a wall, and the field
      // that gets focus is the one the person should fix next anyway.
      for (const input of inputs) {
        const rule = RULES[input.type] || RULES.text;
        const value = input.value.trim();
        if (rule.test(value)) continue;
        status.textContent = value ? rule.bad : rule.empty;
        status.classList.add('is-err');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }

      // Only what this form actually asks for. The endpoint requires a field it
      // was sent and ignores one it was not, so the email strip and the contact
      // page post the same way with different keys.
      const body = new URLSearchParams();
      for (const input of inputs) body.set(input.name, input.value.trim());
      for (const box of qsa('.form__checkbox', form)) body.set(box.name, box.checked ? 'yes' : 'no');
      const trap = qs('.form__trap', form);
      if (trap) body.set(trap.name, trap.value);
      body.set('source', location.pathname);

      sending = true;
      if (submit) submit.disabled = true;
      status.textContent = 'Sending…';

      try {
        // Accept is what the endpoint reads to decide between a JSON answer and
        // a whole HTML page. The page's own POST, the one below, sends the
        // browser's default Accept and gets the page — which is what a person
        // whose scripts did not run should see.
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            Accept: 'application/json',
          },
          body,
        });
        // A server that fell over serves an HTML error page, so the parse is
        // allowed to fail and the status line is what decides.
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `Could not send (${res.status})`);

        status.textContent = 'On the list, we will be in touch';
        status.classList.add('is-ok');
        for (const input of inputs) input.value = '';
        for (const box of qsa('.form__checkbox', form)) box.checked = false;
      } catch (err) {
        // Said out loud, and the fallback address said with it. The version of
        // this that reported success either way lost every lead it took.
        status.textContent = err?.message || 'Could not send — email hello@alpheai.com';
        status.classList.add('is-err');
      } finally {
        sending = false;
        if (submit) submit.disabled = false;
      }
    });
  }
}
