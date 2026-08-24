import * as THREE from '../../vendor/three.module.js';
import { viewport, onViewport } from './viewport.js';

// Shared WebGL harness.
//
// Every scene on this site draws in *pixel space*: an orthographic camera whose
// frustum spans the canvas 1:1, origin at the centre, +y up. That means a shader
// can compute a position in CSS pixels and write it straight to gl_Position with
// no unit juggling, and a CPU mirror of the same maths lands on the same pixel —
// which is what makes hit-testing against a GPU-positioned point possible at all.

export { THREE };

export function createScene(canvas, { alpha = true, antialias = false } = {}) {
  // antialias stays off deliberately: MSAA does nothing for point sprites and
  // costs a full multisampled buffer. The discs anti-alias themselves in the
  // fragment shader instead.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha,
    antialias,
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);

  const size = { width: 0, height: 0, dpr: 1 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === size.width && height === size.height && viewport.dpr === size.dpr) return false;
    size.width = width;
    size.height = height;
    size.dpr = viewport.dpr;
    renderer.setPixelRatio(viewport.dpr);
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    return true;
  }

  resize();
  const offViewport = onViewport(resize);

  return {
    renderer,
    scene,
    camera,
    size,
    resize,
    dispose() {
      offViewport();
      renderer.dispose();
    },
  };
}

// Pointer position in the same centred pixel space the shaders use, tracked
// against a specific element. Returns null-ish coordinates far off-screen when
// the pointer has never entered, so distance tests fail cleanly rather than
// snapping to the origin.
// Where the pointer is, in the canvas's own coordinates: origin at the centre,
// +y up, matching the orthographic camera.
//
// The client position is what is stored, and the conversion is redone every
// frame rather than once per event. The canvas can move while the pointer does
// not — an absolutely positioned one travels with the page on every scroll — and
// coordinates converted at the event are stale from that moment on, by the
// entire scroll distance. That is the hole drifting away from the cursor while
// the reader scrolls with their hand still.
export function trackPointer(el) {
  const state = { x: -99999, y: -99999, inside: false, down: false, cx: -99999, cy: -99999 };

  function sync(rect = el.getBoundingClientRect()) {
    state.x = state.cx - rect.left - rect.width / 2;
    state.y = rect.height / 2 - (state.cy - rect.top);
    state.inside =
      state.cx >= rect.left &&
      state.cx <= rect.right &&
      state.cy >= rect.top &&
      state.cy <= rect.bottom;
  }

  function move(e) {
    state.cx = e.clientX;
    state.cy = e.clientY;
    sync();
  }

  window.addEventListener('pointermove', move, { passive: true });
  el.addEventListener('pointerleave', () => {
    state.cx = -99999;
    state.cy = -99999;
    sync();
  });

  return {
    state,
    sync,
    dispose() {
      window.removeEventListener('pointermove', move);
    },
  };
}
