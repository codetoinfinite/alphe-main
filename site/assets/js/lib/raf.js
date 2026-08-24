// One rAF loop for the whole page. Nothing else in the codebase calls
// requestAnimationFrame — every animated thing subscribes here and receives a
// clamped delta. Two loops means two clocks, and two clocks drift.

const callbacks = new Set();
let running = false;
let last = 0;

function tick(now) {
  // Clamp: a backgrounded tab hands back a delta measured in seconds, which
  // makes every damp() call snap and every integrator explode.
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  for (const cb of callbacks) cb(dt, now);
  if (callbacks.size) requestAnimationFrame(tick);
  else running = false;
}

export function onFrame(cb) {
  callbacks.add(cb);
  if (!running) {
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }
  return () => callbacks.delete(cb);
}

// Frame-rate-independent exponential smoothing.
//
//   x += (target - x) * 0.1
//
// is wrong: it converges twice as fast at 120fps as at 60fps. This is the
// correct form — `smoothing` is the fraction of distance *remaining* after one
// full second, so the result is identical at any refresh rate.
export function damp(smoothing, dt) {
  return 1 - Math.pow(smoothing, dt);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function mapRange(v, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
}
