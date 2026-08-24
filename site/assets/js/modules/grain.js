import { onFrame } from '../lib/raf.js';
import { motion } from '../lib/motion.js';
import { viewport, onViewport } from '../lib/viewport.js';

// Film grain.
//
// Quantised to 10 steps per second. Faster reads as video noise and starts to
// shimmer; slower reads as a static texture someone forgot to animate. Ten is
// the number where it reads as grain.
//
// The noise itself is a 256px tile filled once per step and repeated with a
// canvas pattern — generating 65k pixels ten times a second is cheap, generating
// two million is not.

const TILE = 256;
const STEP = 1 / 10;

export function initGrain() {
  const canvas = document.createElement('canvas');
  canvas.className = 'grain';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');

  const tile = document.createElement('canvas');
  tile.width = TILE;
  tile.height = TILE;
  const tileCtx = tile.getContext('2d');
  const image = tileCtx.createImageData(TILE, TILE);

  function fillTile() {
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    tileCtx.putImageData(image, 0, 0);
  }

  function resize() {
    // Deliberately 1x. Grain rendered at device resolution is finer than the
    // eye resolves and the effect disappears.
    canvas.width = Math.max(1, viewport.width);
    canvas.height = Math.max(1, viewport.height);
    paint();
  }

  function paint() {
    const pattern = ctx.createPattern(tile, 'repeat');
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  fillTile();
  resize();
  onViewport(resize);

  let accumulator = 0;
  onFrame((dt) => {
    if (motion.prefersReducedMotion || document.hidden) return;
    accumulator += dt;
    if (accumulator < STEP) return;
    accumulator = 0;
    fillTile();
    paint();
  });
}
