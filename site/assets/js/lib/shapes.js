import { mulberry32 } from './random.js';

// Turn things that already exist on the page into particle targets.
//
// This is the whole trick behind the field taking the site's own shapes: rather
// than hand-authoring point clouds, rasterise the real artwork — the actual logo
// file, the actual glyphs in the actual typeface — into an offscreen canvas and
// sample the opaque pixels. The particles and the logo can never drift out of
// sync, because there is only one logo.

// What the sampler is allowed to read, in pixels. getImageData is the one call
// in here slow enough to land as a hitch and it costs by the pixel, so the
// budget is the thing that has to be held constant — 240² is the square case
// every shape here was tuned against.
const SAMPLE_BUDGET = 240 * 240;

function sampleAlpha(source, count, width, height, seed, { fit = 0.62, offsetY = 0, crop = false } = {}) {
  // Spend the budget by area, at the source's own aspect. Fitting the *longest*
  // side to a flat 240 instead is what turned every word to mush: a word canvas
  // is four to six times wider than it is tall, so capping its width at 240 left
  // BENCHMARKS 44 pixels high — a 24px cap height, a four-pixel stem, an edge
  // that is one pixel of antialiasing wide — and that raster was then blown back
  // up to 630px on screen, where each of those pixels is four. Same budget spent
  // by area gives it a 559×103 raster: identical cost, identical shape at an
  // identical size on screen, letterforms resolved 2.3x finer and a jitter step
  // that lands inside the stroke instead of across it. Square shapes come out at
  // exactly 240² and are untouched by this.
  //
  // Never upscale. A source already smaller than the budget is exact, and
  // interpolating it up only invents a soft edge for the threshold below to
  // wander along.
  const k = Math.min(1, Math.sqrt(SAMPLE_BUDGET / (source.width * source.height)));
  const sw = Math.max(1, Math.round(source.width * k));
  const sh = Math.max(1, Math.round(source.height * k));

  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, sw, sh);

  const { data } = ctx.getImageData(0, 0, sw, sh);
  const candidates = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] > 120) candidates.push(x, y);
    }
  }

  const out = new Float32Array(count * 2);
  if (!candidates.length) return out;

  // `crop` fits the ink rather than the raster. Artwork with its own padding —
  // a logo file, a diagram drawn inside a square box — otherwise arrives smaller
  // and off-centre by however much empty space its author left around it.
  let minX = 0;
  let minY = 0;
  let maxX = sw;
  let maxY = sh;
  if (crop) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (let i = 0; i < candidates.length; i += 2) {
      if (candidates[i] < minX) minX = candidates[i];
      if (candidates[i] > maxX) maxX = candidates[i];
      if (candidates[i + 1] < minY) minY = candidates[i + 1];
      if (candidates[i + 1] > maxY) maxY = candidates[i + 1];
    }
    maxX += 1;
    maxY += 1;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Scale so the longest side of the glyph occupies `fit` of the shorter side
  // of the canvas — the shape stays whole at any aspect ratio.
  const span = Math.min(width, height) * fit;
  const scale = span / Math.max(maxX - minX, maxY - minY);
  const random = mulberry32(seed);

  // Stratified, not random with replacement.
  //
  // There are at most 2600 particles for a ten-letter word — 260 a letter — so
  // where they land matters more than how many there are. Drawing each one
  // independently (`random() * n`) is sampling with replacement: it hands the
  // same pixel to three particles while leaving its neighbours bare, and the
  // clumps and holes that leaves are Poisson-sized, which on a stroke eleven
  // pixels wide is the difference between a stroke and a dotted line. Roughly a
  // quarter of the budget was landing on a pixel some other particle already
  // had.
  //
  // Walking the ink at a fixed stride and jittering inside each step gives every
  // stratum exactly one particle: the same count, spread evenly over the same
  // ink, no clumps and no gaps. `candidates` is in row-major order, so a stride
  // through it is a stride across the glyph. Same cost — one multiply instead of
  // one multiply.
  const n = candidates.length / 2;
  const stride = n / count;
  for (let i = 0; i < count; i++) {
    const pick = (Math.min(n - 1, (i + random()) * stride) | 0) * 2;
    // Jitter inside the source pixel, otherwise the cloud shows the raster grid.
    // Half a pixel, centred, rather than the whole of one: the raster now tracks
    // the size the shape is drawn at, so a source pixel is about a screen pixel,
    // and a full-pixel spread let the particles on an edge sit a pixel outside
    // the letter. Half of that is enough to break the grid up and keeps the edge
    // where the glyph put it.
    const px = candidates[pick] + 0.25 + random() * 0.5;
    const py = candidates[pick + 1] + 0.25 + random() * 0.5;
    out[i * 2] = (px - centerX) * scale;
    out[i * 2 + 1] = -(py - centerY) * scale + offsetY;
  }
  return out;
}

// Rasterise a 2D path and sample it, so a shape can be authored as drawing code
// instead of as a point list. Everything below is drawn into a square box and
// cropped to its ink, which is what lets a wide diagram and a tall arrow use the
// same helper without either of them having to know the canvas aspect.
const RASTER = 256;

function shapeFromPath(draw, count, width, height, seed, opts = {}) {
  const c = document.createElement('canvas');
  c.width = RASTER;
  c.height = RASTER;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(ctx, RASTER);
  return sampleAlpha(c, count, width, height, seed, { fit: 0.62, crop: true, ...opts });
}

// The classic pointer, filled. An outline reads as an arbitrary polygon at this
// particle density; the solid silhouette is the thing everyone recognises.
const CURSOR_PATH = [
  [0, 0],
  [0, 0.74],
  [0.2, 0.56],
  [0.32, 0.84],
  [0.45, 0.785],
  [0.33, 0.515],
  [0.55, 0.5],
];

export function shapeCursor(count, width, height, seed) {
  return shapeFromPath(
    (ctx, s) => {
      ctx.beginPath();
      for (let i = 0; i < CURSOR_PATH.length; i++) {
        const x = CURSOR_PATH[i][0] * s;
        const y = CURSOR_PATH[i][1] * s;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    },
    count,
    width,
    height,
    seed,
    { fit: 0.46 }
  );
}

// The router itself: one prompt in, a decision node, five candidate models out,
// one edge thick because that is the one the decision picked. The weight of the
// stroke is the whole message — sampling is uniform over opaque pixels, so a
// four-times-wider edge simply gets four times the particles.
//
// The fan is deliberately shallow. This shape lives above the lifecycle cards,
// in a band that is far wider than it is tall, and a square diagram either
// overflows that band or has to be shrunk until it reads as noise. Spread wide
// and short, it fills the space it actually has — and a long horizontal run with
// a tight fan is what a router looks like anyway.
export function shapeRouting(count, width, height, seed) {
  return shapeFromPath(
    (ctx, s) => {
      const inX = s * 0.06;
      const hubX = s * 0.4;
      const outX = s * 0.9;
      const cy = s * 0.5;
      const hubR = s * 0.1;
      const rows = [-0.26, -0.13, 0, 0.13, 0.26].map((v) => cy + v * s);
      // The picked candidate sits on the centre row, so in → hub → out is one
      // straight line through the middle and the four alternatives fan away from
      // it. Off-centre, the winning edge and its halo crowd whichever neighbour
      // they sit next to and that corner of the fan turns back into a smudge.
      const chosen = 2;

      ctx.lineWidth = s * 0.022;
      ctx.beginPath();
      ctx.moveTo(inX, cy);
      ctx.lineTo(hubX - hubR, cy);
      ctx.stroke();

      // Straight edges, not curves. Béziers out of a single hub share their first
      // control point, so all five leave the node along the same tangent and only
      // separate near the end — at particle density that reads as one smear with
      // dots on it. Straight lines diverge from the first pixel and each keeps its
      // own angle, which is the thing that makes a fan look like a fan.
      for (let i = 0; i < rows.length; i++) {
        ctx.lineWidth = i === chosen ? s * 0.03 : s * 0.009;
        ctx.beginPath();
        ctx.moveTo(hubX + hubR, cy);
        ctx.lineTo(outX - s * 0.05, rows[i]);
        ctx.stroke();
      }

      ctx.lineWidth = s * 0.022;
      ctx.beginPath();
      ctx.moveTo(hubX, cy - hubR);
      ctx.lineTo(hubX + hubR, cy);
      ctx.lineTo(hubX, cy + hubR);
      ctx.lineTo(hubX - hubR, cy);
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(inX, cy, s * 0.035, 0, Math.PI * 2);
      ctx.fill();

      // Candidates are filled dots, not outlines: a 2px ring at this raster size
      // samples to four or five particles and disappears. The picked one is bigger
      // and carries a halo, so which model won is legible before the edges are.
      for (let i = 0; i < rows.length; i++) {
        ctx.beginPath();
        ctx.arc(outX, rows[i], i === chosen ? s * 0.045 : s * 0.022, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = s * 0.012;
      ctx.beginPath();
      ctx.arc(outX, rows[chosen], s * 0.07, 0, Math.PI * 2);
      ctx.stroke();
    },
    count,
    width,
    height,
    seed,
    { fit: 0.86 }
  );
}

// The routing engine, read top to bottom: a request arrives, the router opens
// it into every route that could serve it — a model, a tool, one of your own
// agents, a workflow — and exactly one of them leaves for the answer.
//
// It is the scoresheet beside it drawn instead of written, down to the shape of
// the markup: a rail with a stub per candidate, one row marked sent. Vertical
// because the column it is placed in is one, and a horizontal diagram in a
// 400×660 slot has to be shrunk until it reads as dust. It is also the one
// picture that says the whole product — the fan in "How it works" routes
// between models, this routes between kinds of thing.
//
// Five candidates, not nine: the particle budget divided by nine leaves each
// stub too sparse to be a line. Weight is the argument, since sampling is
// uniform over opaque pixels — the taken route is drawn three times heavier
// than the four it beat and is the only one that carries on past the rail.
export function shapeEngine(count, width, height, seed) {
  return shapeFromPath(
    (ctx, s) => {
      const rail = s * 0.1;
      const inY = s * 0.032;
      const hubY = s * 0.155;
      const hubR = s * 0.058;
      // Where a candidate sits, and where the one that wins runs down. Far
      // enough apart that the winner's descent clears the two nodes below it —
      // a crossing samples to a blob at this density and reads as a mistake.
      const nodeX = s * 0.42;
      const outX = s * 0.6;
      const outY = s * 0.955;
      const rows = [0.28, 0.405, 0.53, 0.655, 0.78].map((v) => v * s);
      // Third of five, which is where the sheet beside it sends from: the two
      // above clear the bar and cost more, the two below are cheaper and miss.
      const chosen = 2;

      // In.
      ctx.lineWidth = s * 0.022;
      ctx.beginPath();
      ctx.moveTo(rail, inY);
      ctx.lineTo(rail, hubY - hubR);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rail, inY, s * 0.028, 0, Math.PI * 2);
      ctx.fill();

      // The router. A diamond rather than a dot, so the point where the request
      // stops being one thing is legible as a node and not as a thick spot on
      // the line.
      ctx.lineWidth = s * 0.02;
      ctx.beginPath();
      ctx.moveTo(rail, hubY - hubR);
      ctx.lineTo(rail + hubR, hubY);
      ctx.lineTo(rail, hubY + hubR);
      ctx.lineTo(rail - hubR, hubY);
      ctx.closePath();
      ctx.stroke();

      // The rail, one line past every candidate — the same border the sheet
      // draws down its left edge.
      ctx.lineWidth = s * 0.016;
      ctx.beginPath();
      ctx.moveTo(rail, hubY + hubR);
      ctx.lineTo(rail, rows[rows.length - 1] + s * 0.055);
      ctx.stroke();

      // The candidates. Filled nodes, not rings: a hairline ring at this raster
      // size samples to five particles and disappears. The node has to be big
      // enough to land as a node — under about six raster pixels across it is
      // indistinguishable from the stub that leads to it, and the row reads as a
      // dashed line rather than as a route with an end.
      for (let i = 0; i < rows.length; i++) {
        if (i === chosen) continue;
        ctx.lineWidth = s * 0.011;
        ctx.beginPath();
        ctx.moveTo(rail, rows[i]);
        ctx.lineTo(nodeX - s * 0.03, rows[i]);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(nodeX, rows[i], s * 0.026, 0, Math.PI * 2);
        ctx.fill();
      }

      // The one that is sent, drawn as a single path from the rail to the
      // answer: out along its row, round the corner, down past the routes it
      // beat. One path rather than three strokes, so the round join carries the
      // corner and the turn does not read as two lines meeting.
      ctx.lineWidth = s * 0.026;
      ctx.beginPath();
      ctx.moveTo(rail, rows[chosen]);
      ctx.lineTo(outX, rows[chosen]);
      ctx.lineTo(outX, outY - s * 0.03);
      ctx.stroke();
      // Size alone marks it, with no ring around it. A ring is about twenty
      // raster pixels of radius and the cloud resolves detail at roughly four —
      // so it arrived as a handful of loose dots either side of the node and
      // took the two rows next to it down with them. The node is simply twice
      // the width of the ones it beat, which is legible at any density.
      ctx.beginPath();
      ctx.arc(nodeX, rows[chosen], s * 0.045, 0, Math.PI * 2);
      ctx.fill();

      // The answer.
      ctx.beginPath();
      ctx.arc(outX, outY, s * 0.036, 0, Math.PI * 2);
      ctx.fill();
    },
    count,
    width,
    height,
    seed,
    { fit: 0.98 }
  );
}

// The trust station. Redaction, encryption and proof are three words for one
// idea, and at particle density the plainest mark for it beats a clever one: a
// crest with a lock inside it.
//
// The crest is drawn with two quadratics rather than a polygon because the sides
// have to fall away and then turn in — a straight-edged version reads as a
// pentagon, and a pentagon is a road sign, not a shield. The lock is drawn at
// nearly a third of the crest's width for the same reason the routing diagram's
// candidates are filled dots: a hairline glyph inside another glyph samples to a
// dozen particles and disappears.
export function shapeShield(count, width, height, seed) {
  return shapeFromPath(
    (ctx, s) => {
      const cx = s * 0.5;
      const top = s * 0.09;
      const bottom = s * 0.93;
      const half = s * 0.31;
      // Where the straight flank ends and the taper begins. Above it the crest
      // is a box, below it everything runs to the point.
      const waist = s * 0.46;

      ctx.lineWidth = s * 0.024;
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + half, top + s * 0.11);
      ctx.lineTo(cx + half, waist);
      ctx.quadraticCurveTo(cx + half, bottom - s * 0.16, cx, bottom);
      ctx.quadraticCurveTo(cx - half, bottom - s * 0.16, cx - half, waist);
      ctx.lineTo(cx - half, top + s * 0.11);
      ctx.closePath();
      ctx.stroke();

      // Big for a lock — a third of the crest wide. A glyph inside another glyph
      // gets the particles left over from the outline, and at this density a
      // correctly-proportioned padlock samples to a smudge. Same reason the
      // routing diagram's candidates are filled dots rather than rings.
      const lockW = s * 0.115;
      const lockY = s * 0.47;
      const lockH = s * 0.2;
      ctx.lineWidth = s * 0.024;
      ctx.beginPath();
      ctx.rect(cx - lockW, lockY, lockW * 2, lockH);
      ctx.stroke();
      // Shackle: a half turn standing on the body's top edge, so the two read as
      // one object rather than an arc floating over a box.
      ctx.beginPath();
      ctx.arc(cx, lockY, lockW * 0.6, Math.PI, 0);
      ctx.stroke();
    },
    count,
    width,
    height,
    seed,
    { fit: 0.9 }
  );
}

export function shapeFromImage(img, count, width, height, seed, opts) {
  return sampleAlpha(img, count, width, height, seed, opts);
}

export const TEXT_FONT = '600 200px Geist, sans-serif';

// The widest word in a set, at the raster font size. A run of words is only
// legible as one voice if the letters stay the same size through it, and the
// sampler scales the raster rather than the ink — so equal canvas widths are
// equal letters, and one measurement of the set is all it takes to get there.
export function wordBoxWidth(texts, font = TEXT_FONT) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = font;
  let w = 1;
  for (const t of texts) w = Math.max(w, Math.ceil(ctx.measureText(t).width));
  return w;
}

export function shapeFromText(text, count, width, height, seed, opts = {}) {
  const font = opts.font || TEXT_FONT;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const ink = Math.max(1, Math.ceil(measure.measureText(text).width));
  // Padded out to the set's widest word rather than cropped to this one: the
  // canvas is what gets scaled to fit, so a short word in a wide box keeps the
  // letter height of its neighbours instead of being blown up to their width.
  // Padding is transparent, and sampling only ever picks ink, so the extra
  // width costs nothing but the centring it buys.
  const w = Math.max(ink, Math.round(opts.box || 0));
  const h = 260;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);

  return sampleAlpha(c, count, width, height, seed, { fit: 0.72, ...opts });
}

// A grid that reads as a grid: even spacing, tiny seeded jitter so it is not
// mechanical, aspect-correct cell count so cells stay square.
export function shapeGrid(count, width, height, seed) {
  const out = new Float32Array(count * 2);
  const aspect = width / height;
  const cols = Math.max(2, Math.round(Math.sqrt(count * aspect)));
  const rows = Math.max(2, Math.ceil(count / cols));
  const spanX = width * 0.72;
  const spanY = height * 0.6;
  const random = mulberry32(seed);

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols) % rows;
    out[i * 2] = (col / (cols - 1) - 0.5) * spanX + (random() - 0.5) * 5;
    out[i * 2 + 1] = (row / (rows - 1) - 0.5) * spanY + (random() - 0.5) * 5;
  }
  return out;
}

// Concentric rings, dot count per ring proportional to circumference so the
// density does not spike in the middle.
export function shapeRings(count, width, height, seed, ringCount = 5) {
  const out = new Float32Array(count * 2);
  const random = mulberry32(seed);
  const maxR = Math.min(width, height) * 0.38;
  let weightTotal = 0;
  for (let r = 1; r <= ringCount; r++) weightTotal += r;

  let i = 0;
  for (let r = 1; r <= ringCount; r++) {
    const share = r === ringCount ? count - i : Math.round((r / weightTotal) * count);
    const radius = (r / ringCount) * maxR;
    for (let k = 0; k < share && i < count; k++, i++) {
      const a = (k / share) * Math.PI * 2 + random() * 0.08;
      out[i * 2] = Math.cos(a) * radius;
      out[i * 2 + 1] = Math.sin(a) * radius;
    }
  }
  return out;
}

export function shapeScatter(count, width, height, seed) {
  const out = new Float32Array(count * 2);
  const random = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    out[i * 2] = (random() - 0.5) * width * 0.98;
    out[i * 2 + 1] = (random() - 0.5) * height * 0.9;
  }
  return out;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    // Only when it is actually cross-origin. The HTTP cache keys on credentials
    // mode as well as URL, so setting this unconditionally gave the same file a
    // second cache entry from the one the <img> in the header already filled —
    // the logo came down twice, 219KB for a 107KB file, on every cold load. A
    // same-origin image needs no CORS to be readable by a canvas.
    if (new URL(src, location.href).origin !== location.origin) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
