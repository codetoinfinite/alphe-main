import { THREE, createScene, trackPointer } from '../lib/gl.js';
import { onFrame, damp, clamp } from '../lib/raf.js';
import { motion } from '../lib/motion.js';
import { inViewport } from '../lib/viewport.js';
import { mulberry32 } from '../lib/random.js';
import {
  loadImage,
  shapeCursor,
  shapeEngine,
  shapeFromImage,
  shapeFromText,
  shapeGrid,
  shapeRings,
  shapeRouting,
  shapeScatter,
  shapeShield,
  wordBoxWidth,
} from '../lib/shapes.js';

// The interactive field.
//
// Two instances run over the hero, one behind the headline and one in front,
// splitting the same particle population by depth sign — so the type sits
// *inside* the field instead of on top of a backdrop.
//
// Scene changes are not crossfades. Each particle flies along its own quadratic
// Bézier, with its own delay and its own arc bias, so the cloud reforms the way
// a flock reforms: leading edge first, stragglers last, everything curving.
//
// A field can run in one of two modes. Left alone it cycles its own shape list
// on a timer. Given `stations` it becomes scroll-driven, and then every visible
// property of the cloud — which two shapes it is between, how far between them,
// where it sits, how bright it is — is a pure function of window.scrollY. No
// timers, no triggers, no state that remembers which section fired last. That is
// what makes it track the scrollbar: the same scroll position always produces
// the same frame, scrolling back up is the exact reverse of scrolling down, and
// there is nothing left that can fire early, lag behind, or jump.

// Cycling fields only: a scroll-driven field's morph is measured in scroll, not
// in seconds, so it has no duration to set.
const MORPH_DURATION = 1.15;
const BURST_DURATION = 0.9;
const CYCLE_SECONDS = 5.5;

// Must match MAX_DELAY in the vertex shader: the CPU mirror below reproduces
// the same flight to hand off from mid-air. Cycling fields only.
const MAX_DELAY = 0.34;

// Where a placed shape sits relative to its headline, and therefore the scroll
// position every station's data-field-x/y was tuned at. Changing it re-tunes
// every station at once.
const HOLD_REF = 0.354;

// How much scrolling one transition takes, in viewport heights, and how much of
// the leg is kept clear at each end so the shape settles on its composed
// position before the pair is relabelled.
//
// A fixed distance rather than a share of the leg, because the legs are nowhere
// near equal: the hero sits 762 px above the first section and the mesh sits
// 2788 px above the last. Spending the same *fraction* of each on the morph
// makes the first transition run 3.7x faster than the last, and that unevenness
// is what reads as snapping from one section to the next. At a fixed distance
// every transition is paced the same, whatever the sections below it do — the
// span only shortens when a leg is too short to hold it.
const MORPH_SPAN = 0.8;
const MORPH_MARGIN = 0.08;

// A fixed distance paces every transition the same in *scroll*, which is only
// the same in *motion* while the stations sit near one another — as they did
// while every shape was placed in the same empty column. The lifecycle deck owns
// the whole right of the frame, so its shape lives in the left gutter and the
// legs either side of it carry the cloud the width of the page. Spending 720 px
// of scroll on 790 px of travel makes the cloud outrun the page by half again,
// and a cloud moving faster than the scrollbar is the thing that reads as a
// jump rather than a drift.
//
// So a leg that has further to carry the shape gets proportionally more room:
// enough that the fastest point of the blend still moves no faster than the
// page. 1.5 is the peak slope of the smoothstep, so span = 1.5 * travel holds
// the peak at one pixel of cloud per pixel of scroll. Legs whose stations are
// close ask for less than MORPH_SPAN and keep exactly the pacing they had.
const TRAVEL_PACE = 1.5;

// A word run answers to the clock, not the scrollbar. Its section owns one
// station like any other; what changes while the reader sits in front of it is
// which word that station is drawing. Two seconds is long enough to read a
// single word twice over and short enough that a reader who has stopped sees a
// field that is alive rather than one that is stuck.
const WORD_DWELL = 2;

// How long the rewrite itself takes. Close to MORPH_DURATION, because it is the
// same event — a cloud changing its mind about what it is — and the two happen
// within a screen of each other.
const WORD_SWAP = 1;

// How much of the ambient wander a word keeps. The wander is a fixed number of
// pixels — up to about five in each axis — which is the right unit for a mark
// whose thinnest stroke is twenty across, and the wrong one for a word. Every
// word is fitted to the same width, so a nine-letter one draws its stems at
// eleven pixels and a five-pixel per-particle offset is not life, it is the
// difference between reading ALPHE and reading a smudge. Sub-pixel to a pixel
// and a half still shimmers, and a word has motion of its own anyway: the run
// rewrites itself where it stands and the journey carries it in and out.
//
// Held below half a pixel of travel at the far end of the per-particle range
// (`(1.6 + 3.2) * 0.1`). A pixel and a half was already the second-largest thing
// happening to an eleven-pixel stem, and the whole point of everything else on
// this shape — one radius, one brightness, a one-pixel edge — is that the stem
// has a definite boundary. A boundary that wanders a pixel and a half is not one.
const WORD_DRIFT = 0.1;

function isWord(shape) {
  return shape.startsWith('text:') || shape.startsWith('words:');
}

// How far the cloud may drift from its composed position while travelling, as a
// fraction of viewport height. The drift is what makes the field read as
// attached to the page rather than to the glass. The cap is what keeps it inside
// the frame when two stations are three screens apart — without it the drift
// scales with the gap and the mesh-to-trust leg alone would throw the shape 268
// px off its column. Saturating rather than clamping, so there is no kink where
// the limit is reached.
const DRIFT_LIMIT = 0.18;

// A section that owns a station is lit; one that does not is dark, with this
// much viewport either side to fade across. Measured against the viewport's
// centre line against static section boxes, so — like everything else here —
// the answer depends on nothing but the scroll position.
const LIT_FADE = 0.33;

// How much of the leg out of its own section a canvas that scrolls with the page
// gets before it is fully faded. It is clipped to its section's box, so it has
// to be gone before the travelling shape reaches the edge of that box.
const HOME_EXIT = 0.5;

// Past the hero the field is a background, not a subject: the same particles at
// full strength sit too close to body copy.
const AWAY_OPACITY = 0.72;

// The composition the placed offsets were tuned against. The layout's content
// column is capped at --container: 1240px, so an offset taken as a fraction of
// the raw viewport keeps walking outward on a wide display and ends up in the
// window margin, beside the content instead of composed against it — at 2560 the
// trust square lands 46px outside the column. Building and placing against a
// fixed frame reproduces the tuned composition inside the column at every width
// above it, and is a no-op at every width below it.
const FRAME_WIDTH = 1440;
const FRAME_HEIGHT = 900;

// The width at which the layout's two-column sections have settled and left a
// genuinely empty column for a placed shape to park in. Measured, not guessed:
// at 1100 every station clears its copy, at 960 the square crosses the trust
// headline and the first accordion row.
//
// Deliberately a switch and not a ramp. A partial offset is the worst of both —
// it walks the shape out of the empty column and into the middle of the copy
// while leaving it lit, which is the overlap this whole pass exists to remove.
// So placement and lighting turn off together, and below this width the journey
// is the hero field alone. That is the honest answer for a narrow window: there
// is nowhere to put a shape that is not on top of the text.
const PLACE_MIN_WIDTH = 1100;

function canPlace(width) {
  return width >= PLACE_MIN_WIDTH;
}

function sstep(x) {
  return x * x * (3 - 2 * x);
}

// Static layout position, walked up the offsetParent chain rather than read off
// getBoundingClientRect. Two reasons, both load-bearing. Every station headline
// is a [data-reveal] element, so its rect carries an 18px translate that
// animates away as the section enters — measured live, the whole journey wobbles
// by 18px exactly when a section arrives. And the lifecycle headline is inside a
// position:sticky pin, so its rect is wherever the pin has parked it rather than
// where the section actually is. offsetTop is immune to both.
function pageTop(el) {
  let y = 0;
  for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
  return y;
}

function seedFor(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// How many text regions the field can keep off at once. Three ledger rows are on
// screen together at 900px and each contributes a heading block and a paragraph,
// so six is already the exact worst case — ten leaves room for a denser section
// without the uniform block growing to something worth measuring. Regions past
// the limit are dropped in document order, which is the wrong order to drop in,
// so the headroom matters more than the handful of uniforms it costs.
const FADE_MAX = 10;

const VERT = /* glsl */ `
#define FADE_MAX ${FADE_MAX}

attribute vec2 aFrom;
attribute vec2 aTo;
attribute vec3 aSeed;

uniform float uMorph;
uniform float uTime;
uniform float uBurstTime;
uniform float uOpacity;
uniform float uPixelRatio;
uniform float uWidth;
uniform float uHeight;
uniform float uZSign;
uniform float uCursorR;
uniform float uAttract;
uniform float uDrift;
uniform float uSharp;
uniform vec2  uCursor;
uniform vec2  uBurstOrigin;
uniform vec2  uShift;
uniform vec2  uTextCenter;
uniform vec2  uTextHalf;
uniform vec4  uFadeBox[FADE_MAX];
uniform int   uFadeCount;

varying float vAlpha;
varying float vAlphaScale;
varying float vBurst;
varying float vSharp;
varying float vFeather;

const float MIN_POINT_SIZE = 2.0;
const float PREVIOUS_MIN_POINT_SIZE = 1.0;
const float MAX_DELAY = 0.34;

// What a particle looks like when the shape it belongs to is a word — see
// uSharp. A cloud and a word want opposite things from the same dots. A cloud
// wants variety: dots at every depth, every size, every brightness, so the field
// has air in it. A word wants none of that, because every one of those
// variations lands on the edge of a letter and the edge is the letter. A stem is
// eleven pixels across; a dot that is half the size of its neighbour and a third
// as bright reads as a nick out of the stroke, and ten nicks read as a fuzz.
//
// So a word draws itself in one ink: one radius, one brightness, both at the top
// of the range the cloud uses rather than across it. Depth still selects which
// canvas draws the particle, so the shape keeps its two planes — it just stops
// spending them on contrast.
const float WORD_RADIUS = 1.6;
const float WORD_ALPHA = 0.95;

// How far past a text region the fade reaches, in pixels. It used to be a
// fraction of the region's own size, which sounds equivalent and is not: a
// paragraph column is six hundred pixels wide, so a ramp of a third of its half
// extent threw a hundred-pixel shadow sideways onto whatever sat beside it — and
// what sits beside it, in every one of these sections, is the word. WHY ALPHE
// lost the whole of its W to a paragraph it does not overlap. Measured in pixels
// the ramp is the same softness on every region, and it stops where a reader
// looking at the gap between the two would expect it to.
const float FADE_RAMP = 34.0;

void main() {
  // Depth sign selects which of the two canvases draws this particle. The other
  // canvas gets point size zero, which costs a vertex and rasterises nothing.
  //
  // Unless the shape is a word, in which case every particle draws. The split
  // pays for itself on a cloud: two canvases, one in front of the content and
  // one behind it, each drawing half of one population, and the shape gains a
  // plane of depth for no extra dots. A word never collects that dividend —
  // every canvas that draws a word draws it alone, because the only paired
  // canvas on the site is the hero's and it goes dark the moment the journey
  // leaves the hero — so the half it discards is not spent on depth, it is
  // simply thrown away. On the letter that needed it most.
  float visible = max(step(0.0, uZSign * aSeed.z), uSharp);
  float depth   = abs(aSeed.z);

  // --- morph -------------------------------------------------------------
  float delay = aSeed.x * MAX_DELAY;
  float t = clamp((uMorph - delay) / (1.0 - MAX_DELAY), 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);

  vec2 dir  = aTo - aFrom;
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 ctrl = (aFrom + aTo) * 0.5 + perp * (aSeed.y - 0.5) * 0.45;
  vec2 pos  = mix(mix(aFrom, ctrl, t), mix(ctrl, aTo, t), t);

  // --- travel -------------------------------------------------------------
  // The journey offset. Both shapes in the blend above are stored at the
  // position each was composed at, and this carries the pair from one to the
  // other — plus the bounded drift that keeps the cloud attached to the page
  // between them. Derived entirely from scroll position on the CPU side.
  pos += uShift;

  // --- keep clear of the headline ----------------------------------------
  // After the travel, so the hole is cut in the frame the reader is looking at:
  // the region is handed down in canvas coordinates for this frame, and the
  // particles it displaces are the ones actually over the type right now.
  // Cutting it before the offset would pin the hole to the shape instead of to
  // the text, and the two no longer move together.
  //
  // A 6-norm superellipse, not a circle and not a box. A text block is neither:
  // a circle carves a hole far too round at the corners, a rectangle leaves a
  // visible hard edge. Six is where the boundary stops reading as a shape.
  if (uTextHalf.x > 1.0) {
    vec2 n = (pos - uTextCenter) / uTextHalf;
    float r6 = pow(pow(abs(n.x), 6.0) + pow(abs(n.y), 6.0), 1.0 / 6.0);
    // Monotone radial remap, not a projection onto the boundary. Projecting
    // stacks every interior particle on the same curve and the hole reads as a
    // drawn outline; spreading [0, OUTER] across [1, OUTER] keeps the gradient.
    const float OUTER = 1.7;
    if (r6 < OUTER) {
      float remapped = mix(1.0, OUTER, r6 / OUTER);
      pos = uTextCenter + (n / max(r6, 0.0001)) * uTextHalf * remapped;
    }
  }

  // --- keep off body copy --------------------------------------------------
  // The other way out of a text region, and the one the scroll journey needs.
  // Displacing works where the block is small against the shape: the cloud
  // closes around a headline and still reads. It cannot work against a column of
  // body copy taller than the shape itself — there is nowhere to displace to, so
  // every particle stacks on the boundary and the shape is gone. Here the
  // particles over the type simply stop being drawn, which costs the shape a few
  // dots and costs the reader nothing.
  //
  // One region per paragraph rather than one around the column, and only the
  // ones on screen, because those are the two things that keep the fade local:
  // the cloud loses the dots that are actually over a line of text and keeps
  // every dot in the space between paragraphs.
  //
  // Fading alone was not enough where the shape is a word. A word holds its
  // form all the way down to zero alpha, so what the reader sees is COST or
  // QUALITY printed through their paragraph, ghosting out over the sentence
  // they are trying to read — legible enough to compete with the type and never
  // legible enough to be worth it. So the region scatters as well as fades: it
  // pushes each particle out of itself along its own angle, hardest right where
  // the fade is deepest, and by the time a letter is dim it has already stopped
  // being a letter. Outward rather than in a free direction, because a random
  // walk carries dots *into* the region — which is the thing this exists to
  // prevent — and outward doubles as clearance.
  float textDim = 1.0;
  vec2 scatter = vec2(0.0);
  for (int i = 0; i < FADE_MAX; i++) {
    if (i >= uFadeCount) break;
    vec2 d = pos - uFadeBox[i].xy;
    vec2 n = d / uFadeBox[i].zw;
    float r6 = pow(pow(abs(n.x), 6.0) + pow(abs(n.y), 6.0), 1.0 / 6.0);
    // How far outside the region this particle is, in pixels rather than in
    // multiples of the region — see FADE_RAMP. length(d) / r6 is the region's own
    // half extent along this particle's direction, so (r6 - 1) times it is the
    // gap between the two. Zero or negative inside, where the fade is total.
    float edge = (r6 - 1.0) * length(d) / max(r6, 1e-4);
    textDim = min(textDim, smoothstep(0.0, FADE_RAMP, edge));

    // Tied to the fade, not wider than it: full inside the region and gone a
    // little past the edge, so a letter comes apart exactly over the span where
    // it is being dimmed. The first cut of this reached out 1.4 region-halves,
    // which around a 460px square is 330px of influence — the word never got
    // near the rings and was still torn up, and the whole cloud drifted off its
    // composed position because every particle was being pushed by a box it was
    // nowhere near.
    float loose = 1.0 - smoothstep(FADE_RAMP * 0.4, FADE_RAMP, edge);
    if (loose <= 0.0) continue;
    // Outward in the region's own aspect — each component divided by its own
    // half again, so a paragraph box three hundred pixels wide and twenty tall
    // throws its particles up and down rather than out along the line, and a
    // square one is radial. Turned by the particle's own seed and drifting with
    // the clock: a clean radial push reads as one more shape, and the point is
    // that there is no longer a shape here.
    float a = atan(n.y / uFadeBox[i].w + 1e-6, n.x / uFadeBox[i].z + 1e-6)
            + (aSeed.x - 0.5) * 1.7
            + sin(uTime * 0.6 + aSeed.y * 62.8) * 0.4;
    scatter += vec2(cos(a), sin(a)) * loose * (16.0 + aSeed.y * 42.0);
  }
  pos += scatter;

  // --- ambient drift ------------------------------------------------------
  // uTime is pinned to zero under reduced motion, so this term vanishes and the
  // field holds its shape. The burst clock below is deliberately not pinned.
  //
  // uDrift is how much of it this shape wants — see WORD_DRIFT. The wander is a
  // slow sinusoid, so on any one frame it is not motion, it is a fixed random
  // offset per particle, and a shape whose thinnest feature is comparable to
  // that offset is being drawn through noise.
  pos += vec2(
    sin(uTime * 0.5  + aSeed.x * 62.8),
    cos(uTime * 0.43 + aSeed.y * 62.8)
  ) * (1.6 + aSeed.x * 3.2) * uDrift;

  // --- cursor -------------------------------------------------------------
  vec2 toCursor = pos - uCursor;
  float dist = length(toCursor);
  float influence = smoothstep(uCursorR, 0.0, dist);
  pos += normalize(toCursor + vec2(0.0001)) * influence * uCursorR * 0.42 * uAttract;

  // --- burst --------------------------------------------------------------
  float bt = clamp(uBurstTime, 0.0, 1.0);
  float ease  = 1.0 - pow(1.0 - bt, 3.0);
  float decay = 1.0 - bt;
  float mag = (0.35 + aSeed.y * 1.15) * uCursorR;
  pos += normalize(pos - uBurstOrigin + vec2(0.0001)) * mag * ease * decay;
  vBurst = decay * decay * step(0.001, bt);

  float alpha = mix(0.22 + depth * 0.62, WORD_ALPHA, uSharp) * uOpacity * visible * textDim;
  vAlpha = alpha;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos.x, pos.y, 0.0, 1.0);

  float radius = mix(mix(0.75, 1.75, depth) * (0.75 + aSeed.x * 0.55), WORD_RADIUS, uSharp);
  float rawPointSize      = radius * 2.0 * uPixelRatio;
  float previousPointSize = max(PREVIOUS_MIN_POINT_SIZE, rawPointSize);
  float pointSize         = max(MIN_POINT_SIZE, rawPointSize);
  // The compensation exists to keep the cloud's weight where it was when the
  // floor was a pixel — it is a correction for a dot that had to be grown, and a
  // word's dots are one size on purpose. Faded out with uSharp so a letter is not
  // quietly dimmed by a rule about a different shape.
  vAlphaScale = mix((previousPointSize * previousPointSize) / (pointSize * pointSize), 1.0, uSharp);
  gl_PointSize = pointSize * visible;

  vSharp = uSharp;
  // One device pixel, in the sprite's own units, for the fragment shader to
  // antialias with. A fixed fraction of the sprite is a fixed *blur*: on a dot
  // three pixels wide, the 0.1 the cloud uses is a third of a pixel of feather
  // either side and reads as soft, which is what a background field wants. A
  // letter wants its dots to stop where they stop, and the narrowest edge that
  // is still not a staircase is exactly one pixel.
  vFeather = 1.0 / max(pointSize, 1.0);
}
`;

const FRAG = /* glsl */ `
precision mediump float;

uniform vec3 uColor;
uniform vec3 uBurstColor;

varying float vAlpha;
varying float vAlphaScale;
varying float vBurst;
varying float vSharp;
varying float vFeather;

void main() {
  // Feather width, not dot shape: both ends of this are a round dot, and the
  // only question is how many pixels it takes to get from ink to nothing. The
  // cloud gets a tenth of the sprite, which is soft by design. A word gets one
  // device pixel — see vFeather — which is as hard an edge as a raster can hold
  // without the dot turning into a little staircase.
  float edge = mix(0.1, vFeather, vSharp);
  float circleAlpha = 1.0 - smoothstep(0.5 - edge, 0.5, length(gl_PointCoord - vec2(0.5)));
  if (circleAlpha <= 0.0 || vAlpha <= 0.0) discard;
  vec3 color = mix(uColor, uBurstColor, vBurst);
  gl_FragColor = vec4(color, vAlpha * vAlphaScale * circleAlpha);
}
`;

// Sized by the hardest thing the field is asked to draw, which is not the cloud.
// A cloud reads at any density — fewer dots is just a thinner cloud. A word does
// not: it has a fixed amount of ink to cover and either there are enough dots to
// cover it or there is a dotted outline of a letter.
//
// 1500/megapixel spread 119 dots over each letter of WHY ALPHE, which is why it
// read as a smudge that no amount of per-dot sharpening could fix. A word now
// draws its whole population instead of the half its depth sign selects (see
// visible), so the rate that feeds a letter is this one undivided; the cloud
// still halves it, and 2600 leaves the cloud a little denser than the 1500 it
// was composed at without turning it into a sheet.
//
// The rate is per megapixel of canvas, which is right for a cloud and wrong for a
// word, because a word does not shrink with the canvas — it fills whatever box it
// is given. The sub-page hero fields are 520x501, a quarter of a megapixel, so
// they took the floor: ALPHE drew with 900 dots where the same word on the
// full-page field draws with 3291, and read as a dotted outline of itself. A field
// that draws words floors at what a word costs. A field that only ever draws cloud
// keeps the old floor, because a thinner cloud is only a thinner cloud.
function particleCount(width, height, words) {
  const area = width * height;
  const lowEnd = (navigator.hardwareConcurrency || 4) <= 4;
  const floor = words ? 2600 : 900;
  return Math.round(clamp((area / 1024000) * 2600, floor, 3900) * (lowEnd ? 0.5 : 1));
}

export function initParticleField(canvas, options = {}) {
  const {
    zSign = 1,
    textEls = [],
    attract = false,
    autoCycle = true,
    logoSrc = '/media/logo.png',
    texts = [],
    stations: declared = [],
  } = options;

  // A section can ask for a word run instead of a mark — `words:COST|QUALITY|…`
  // — and the section's own vocabulary stands in for a glyph. A diagram is only
  // worth drawing where the diagram is the meaning; where it is not, the words
  // say more than an invented mark does.
  //
  // One station either way. The run is a set of shapes the *station* holds, in
  // one place, swapped on a dwell timer while the reader is stopped in front of
  // it — not a set of stations strung down the section. The scroll says which
  // section the cloud is in; the clock says which word it is showing.
  //
  // Read into a new array rather than in place: one station list is shared by
  // every field on the page, and both of them have to see the same indices.
  function readRun(s) {
    if (!s.shape.startsWith('words:')) return s;
    const words = s.shape
      .slice(6)
      .split('|')
      .map((w) => w.trim())
      .filter(Boolean);
    if (words.length < 2) return s;
    // Every word is rasterised into the widest one's box, so the run keeps a
    // single letter height instead of blowing each word up to the same width.
    return { ...s, words, box: wordBoxWidth(words) };
  }

  const stations = declared.map(readRun);
  const scrollDriven = stations.length > 0;

  // A station canvas that scrolls with the page can only ever serve the section
  // it lives in. The hero's front layer sits inside the hero box, so once the
  // journey moves on it would draw its half of the population in a frame that
  // has itself scrolled away — the same shape rendered twice, hundreds of pixels
  // apart. It goes dark instead and the fixed canvas carries the journey alone.
  const isFixed = getComputedStyle(canvas).position === 'fixed';
  const homeStation =
    scrollDriven && !isFixed ? stations.findIndex((s) => s.el.contains(canvas)) : -1;

  const ctx = createScene(canvas);
  const { renderer, scene, camera, size } = ctx;

  const drawsWords = texts.length > 0 || stations.some((s) => s.words || isWord(s.shape));
  const count = particleCount(size.width, size.height, drawsWords);
  const random = mulberry32(7723 + Math.round(zSign) * 91);

  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = random();
    seeds[i * 3 + 1] = random();
    // Signed depth: sign chooses the canvas, magnitude drives size and alpha.
    seeds[i * 3 + 2] = (random() < 0.5 ? -1 : 1) * (0.15 + random() * 0.85);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute('aFrom', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  geometry.setAttribute('aTo', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uMorph: { value: 1 },
      uTime: { value: 0 },
      uBurstTime: { value: 1 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: 1 },
      uWidth: { value: size.width },
      uHeight: { value: size.height },
      uZSign: { value: zSign },
      uCursorR: { value: 120 },
      uAttract: { value: attract ? -0.85 : 1 },
      uDrift: { value: 1 },
      // 0 for a cloud, 1 for a word, and the blend between them across a morph —
      // see WORD_RADIUS. Everything that makes a dot field pleasant to look at
      // makes type hard to read, so a word turns all of it off at once rather
      // than one setting at a time: same size, same brightness, hard edge.
      uSharp: { value: 0 },
      uCursor: { value: new THREE.Vector2(-99999, -99999) },
      uBurstOrigin: { value: new THREE.Vector2(0, 0) },
      uShift: { value: new THREE.Vector2(0, 0) },
      uTextCenter: { value: new THREE.Vector2(0, 0) },
      uTextHalf: { value: new THREE.Vector2(0, 0) },
      uFadeBox: { value: Array.from({ length: FADE_MAX }, () => new THREE.Vector4(0, 0, 1, 1)) },
      uFadeCount: { value: 0 },
      uColor: { value: new THREE.Color(0xdfe4e8) },
      uBurstColor: { value: new THREE.Color(0x51a2ff) },
    },
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  // ---- targets -------------------------------------------------------------

  let logoImage = null;
  let shapes = [];
  // Whether each of those is a word, 1 or 0, in the same order. Two settings
  // hang off it — how much ambient wander it keeps (WORD_DRIFT) and whether it
  // is drawn as type or as cloud (uSharp) — and they are the same fact asked
  // twice, so it is stored once and both are derived from the blend. Carried per
  // shape rather than per station because the cycling field has no stations and
  // its word list needs the same treatment.
  let wordness = [];
  let shapeIndex = 0;

  // Word runs, by station index: every word of the run, built up front. The swap
  // has to be instant on the frame it happens, and rasterising a word mid-hold
  // would drop a frame in the one place on the page the reader is looking.
  const runShapes = new Map();

  // Which word each run is currently on. Outlives a resize, so a rebuild returns
  // the run to the word it was showing rather than to its first.
  const runAt = new Map();

  // The rewrite in progress: the station it belongs to, how long its current
  // word has been up, and how far through the change it is (t < 0 when none is
  // running). `buf` is the station's shape while it changes — see swapInto.
  const run = { station: -1, dwell: 0, t: -1, from: null, to: null, buf: null };

  // Every shape is sized against the *shorter* side of the frame, so it stays
  // whole at any aspect ratio. That is right for the shape and wrong for the two
  // stations that are composed full-bleed behind centred copy: the cloud is then
  // exactly as wide on a 1440 screen as on a 1024 one, and every extra pixel of
  // width becomes dead margin either side. Widen those with the frame — in x
  // only, because growing them in proportion runs them out of the section
  // vertically long before the margins close, and only above 1:1, so a portrait
  // window keeps the shape exactly as drawn.
  const FRAME_STRETCH_MAX = 1.6;

  function stretchToFrame(arr, width, height) {
    const k = Math.max(1, Math.min(FRAME_STRETCH_MAX, width / height));
    if (k === 1) return arr;
    for (let i = 0; i < arr.length; i += 2) arr[i] *= k;
    return arr;
  }

  // Stretched for the hero, where the cloud is the backdrop to the headline and
  // the only alternative to filling the width is dead margin either side. Not
  // stretched anywhere the mark is the subject: a logo widened by 1.6 is not the
  // logo, and a station that exists to be recognised has nothing else to trade.
  function logoShape(width, height, seed, stretch = true) {
    if (!logoImage) return shapeScatter(count, width, height, seed);
    const arr = shapeFromImage(logoImage, count, width, height, seed, { fit: 0.62 });
    return stretch ? stretchToFrame(arr, width, height) : arr;
  }

  // Named so the page can ask for a shape in markup. Seeds are derived from the
  // name, so the same station renders the same cloud on every load and a resize
  // rebuilds the shape it already had rather than a new arrangement of it.
  function buildShape(name, width, height, box = 0) {
    const seed = seedFor(name);
    if (name.startsWith('text:')) {
      return shapeFromText(name.slice(5), count, width, height, seed, { box });
    }
    switch (name) {
      case 'logo':
        return logoShape(width, height, seed);
      case 'logomark':
        return logoShape(width, height, seed, false);
      // Deliberately not stretched to the frame: this one is composed tall for a
      // tall column, and widening it with the window is the one change that
      // would put it back on the sheet it is meant to sit beside.
      case 'engine':
        return shapeEngine(count, width, height, seed);
      case 'cursor':
        return shapeCursor(count, width, height, seed);
      case 'routing':
        return shapeRouting(count, width, height, seed);
      case 'shield':
        return shapeShield(count, width, height, seed);
      case 'rings':
        return shapeRings(count, width, height, seed);
      case 'grid':
        return shapeGrid(count, width, height, seed);
      default:
        return shapeScatter(count, width, height, seed);
    }
  }

  // Every shape is built centred on the origin, so placing one is a translate
  // and sizing one is a multiply — no shape generator needs to know where on the
  // page it will end up.
  //
  // The offsets exist to park the cloud in the empty column beside a
  // left-aligned headline, so below the width where that column exists they are
  // dropped entirely — the same width at which the away-strength goes to zero,
  // so nothing unplaced is ever lit. Above FRAME_WIDTH they stop growing, since
  // the column they are aiming for stopped growing at --container.
  //
  // A station that asks for no offset is full-bleed by definition — the hero —
  // and is built against the real canvas so it keeps filling it.
  function placeShape(station, width, height) {
    const placed = canPlace(width) && (station.x !== 0 || station.y !== 0);
    const fw = placed ? Math.min(width, FRAME_WIDTH) : width;
    const fh = placed ? Math.min(height, FRAME_HEIGHT) : height;
    const arr = buildShape(station.shape, fw, fh, station.box);
    // A station can ask to be suggested rather than drawn. Every point is
    // knocked off the shape by up to `scatter` of the frame's short side, so
    // what the cloud holds here is the shape's distribution — its weight, its
    // lean, roughly where it is on screen — and not its outline. The mark is
    // sensed on the way past and never resolves.
    //
    // Done to the target, not to the blend: stopping the morph short of 1 would
    // read the same for one frame and then tear the field, because the station
    // pair only swaps invisibly while every particle is exactly on an endpoint.
    // Seeded off the shape name like the shape itself, so the fog is the same
    // fog on every load and a resize rebuilds it rather than reshuffling it.
    if (station.scatter) {
      const rand = mulberry32(seedFor(station.shape) ^ 0x5f356495);
      const r = station.scatter * Math.min(fw, fh);
      for (let i = 0; i < arr.length; i += 2) {
        const a = rand() * Math.PI * 2;
        // sqrt, so the offsets fall evenly over the disc instead of piling up
        // at its centre and leaving the outline still legible underneath.
        const d = Math.sqrt(rand()) * r;
        arr[i] += Math.cos(a) * d;
        arr[i + 1] += Math.sin(a) * d;
      }
    }
    const dx = placed ? station.x * fw : 0;
    const dy = placed ? station.y * fh : 0;
    if (station.scale === 1 && !dx && !dy) return arr;
    for (let i = 0; i < arr.length; i += 2) {
      arr[i] = arr[i] * station.scale + dx;
      arr[i + 1] = arr[i + 1] * station.scale + dy;
    }
    return arr;
  }

  // How far the cloud is carried by each leg, measured off the built shapes
  // rather than off the offsets that produced them: the centre of mass is what
  // travels, and it answers to the shape and its scale as much as to where the
  // shape was placed. Rebuilt with the shapes, since both depend on the size.
  const legTravel = [];

  function measureTravel() {
    legTravel.length = 0;
    const centres = shapes.map((arr) => {
      let x = 0;
      let y = 0;
      for (let i = 0; i < arr.length; i += 2) {
        x += arr[i];
        y += arr[i + 1];
      }
      const n = arr.length / 2 || 1;
      return [x / n, y / n];
    });
    for (let i = 0; i < centres.length - 1; i++) {
      legTravel.push(Math.hypot(centres[i + 1][0] - centres[i][0], centres[i + 1][1] - centres[i][1]));
    }
  }

  function buildShapes() {
    const { width, height } = size;
    if (scrollDriven) {
      runShapes.clear();
      // A rewrite cannot survive a rebuild: its endpoints were sampled at the
      // old size. Dropped, and the run resumes from whichever word it had
      // reached.
      run.t = -1;
      run.dwell = 0;
      shapes = stations.map((s, i) => {
        if (!s.words) return placeShape(s, width, height);
        const arrs = s.words.map((w) => placeShape({ ...s, shape: `text:${w}` }, width, height));
        runShapes.set(i, arrs);
        return arrs[Math.min(runAt.get(i) || 0, arrs.length - 1)];
      });
      wordness = stations.map((s) => (isWord(s.shape) ? 1 : 0));
      measureTravel();
      return;
    }
    const list = [];
    const words = [];
    if (logoImage) {
      list.push(logoShape(width, height, 4001));
      words.push(0);
    }
    const box = texts.length ? wordBoxWidth(texts) : 0;
    for (let i = 0; i < texts.length; i++) {
      list.push(shapeFromText(texts[i], count, width, height, 5100 + i * 37, { box }));
      words.push(1);
    }
    list.push(shapeRings(count, width, height, 6203));
    list.push(shapeGrid(count, width, height, 7307));
    words.push(0, 0);
    if (!list.length) {
      list.push(shapeScatter(count, width, height, 8101));
      words.push(0);
    }
    shapes = list;
    wordness = words;
  }

  // ---- the journey ---------------------------------------------------------
  //
  // One number per station: the scroll position at which its shape sits exactly
  // where it was composed. Between two of them the field is a straight blend, so
  // the whole animation collapses to "where am I between mark i and mark i+1".
  //
  // Measured once per layout, never per frame, and from static layout positions
  // — see pageTop. The mode only chooses the reference: 'anchor' is the
  // headline, held at the viewport fraction the offsets were tuned at; 'section'
  // is the section's own top edge, for a full-bleed field composed against the
  // whole block rather than parked beside a line of type.
  const marks = [];

  function measureStations() {
    marks.length = 0;
    const vh = window.innerHeight;
    for (const s of stations) {
      const top = pageTop(s.el);
      const hold = s.lock === 'section' ? top : pageTop(s.anchor) - vh * HOLD_REF;
      marks.push({ hold, top, bottom: top + s.el.offsetHeight });
    }
  }

  // Which pair, how far across it, and how far the cloud has drifted from the
  // composed position — all of it read off the scroll position alone.
  const journey = { pair: 0, x: 0, shift: 0, morph: 0 };

  function readJourney(y) {
    if (marks.length < 2) return;
    let i = 0;
    while (i < marks.length - 2 && y >= marks[i + 1].hold) i++;
    const from = marks[i].hold;
    const gap = Math.max(1, marks[i + 1].hold - from);
    const travelled = y - from;
    const x = clamp(travelled / gap, 0, 1);

    journey.pair = i;
    journey.x = x;
    // Riding the page and travelling between two stations are the same motion.
    // Each station's own offset is (scroll - its hold), so blending the pair
    // with a smoothstep leaves exactly gap * (x - smoothstep(x)): zero at both
    // ends, which is why a station always gets its shape at the position it was
    // composed at and why the frame where the pair changes is identical either
    // side of it. Past the last mark x pins at 1 and the term degenerates to the
    // plain ride, so the cloud leaves with the page instead of hanging.
    const cap = window.innerHeight * DRIFT_LIMIT;
    journey.shift = cap * Math.tanh((travelled - sstep(x) * gap) / cap);
    // The morph holds either side and blends across a fixed distance in the
    // middle. Reaching exactly 0 and exactly 1 inside the hold is what makes the
    // pair swap invisible: every particle is already on an endpoint when the
    // endpoints are relabelled. The margin is what guarantees the hold exists at
    // all — without it a leg shorter than the span would still be mid-morph when
    // its endpoints were relabelled, which is the one way this can tear.
    const span = Math.min(
      Math.max(window.innerHeight * MORPH_SPAN, TRAVEL_PACE * (legTravel[i] || 0)),
      gap * (1 - 2 * MORPH_MARGIN)
    );
    journey.morph = sstep(clamp((travelled - (gap - span) / 2) / span, 0, 1));

    // Riding is wrong where the section it belongs to does not move. Inside a
    // sticky pin the copy is held against the viewport while the page scrolls
    // under it, so a cloud that keeps riding walks off the top of the gap it was
    // placed in while the layout it was measured against has not moved at all.
    // Such a station asks for ride 0 and the leg loses its drift.
    //
    // One constant for the whole leg, taken from whichever end rides least. A
    // weight that varies across the leg adds its own slope to the drift's, and
    // that sum is steeper than either — a leg is short enough that a cloud
    // accelerating through the middle of it reads as a lurch. Continuity across
    // the swap does not depend on the weight: the drift is already zero at both
    // ends of every leg, so nothing here can move a station off its composed
    // position, whatever the neighbouring leg weights itself by.
    journey.shift *= Math.min(stationRide(i), stationRide(i + 1));
  }

  function stationRide(index) {
    const s = stations[Math.min(index, stations.length - 1)];
    return s ? s.ride : 1;
  }

  // Lit where a section owns a station, dark where none does, faded across the
  // boundary. Against section boxes rather than headlines because that is the
  // actual question — the lifecycle section runs 1900px past its headline and
  // has to stay lit for all of it, while the coverage run has no station and has
  // to go dark for all of it.
  function litAt(y) {
    const vh = window.innerHeight;
    const line = y + vh * 0.5;
    const fade = vh * LIT_FADE;
    let best = 0;
    for (const m of marks) {
      const d = Math.max(m.top - line, line - m.bottom, 0);
      const v = 1 - sstep(clamp(d / fade, 0, 1));
      if (v > best) best = v;
    }
    return best;
  }

  // The hero is the one station the field is the subject of, not a backdrop to;
  // it is full-bleed and unplaced, so it survives every width. Everywhere else
  // the field sits behind body copy and has to stay quieter, and below the width
  // where the empty column exists it is not drawn at all.
  function stationWeight(index, away) {
    const s = stations[Math.min(index, stations.length - 1)];
    return (index === 0 ? 1 : away) * (s ? s.dim ?? 1 : 1);
  }

  // Where every particle actually is at this instant, mirroring the shader's
  // Bézier exactly. Retargeting mid-flight without this snaps the cloud back to
  // the shape it left. The display-only terms — drift, cursor, burst, headline
  // avoidance — are re-applied from the new base every frame and are
  // deliberately not baked in.
  //
  // Cycling fields only. A scroll-driven field never retargets mid-flight: it is
  // always exactly between two named shapes, and the pair is only ever swapped
  // at a scroll position where the blend has already landed on an endpoint.
  function snapshotInto(out, dy) {
    const from = geometry.attributes.aFrom.array;
    const to = geometry.attributes.aTo.array;
    for (let i = 0; i < count; i++) {
      let t = clamp((morph - seeds[i * 3] * MAX_DELAY) / (1 - MAX_DELAY), 0, 1);
      t = t * t * (3 - 2 * t);
      const fx = from[i * 2];
      const fy = from[i * 2 + 1];
      const tx = to[i * 2];
      const ty = to[i * 2 + 1];
      const bias = (seeds[i * 3 + 1] - 0.5) * 0.45;
      const cx = (fx + tx) * 0.5 - (ty - fy) * bias;
      const cy = (fy + ty) * 0.5 + (tx - fx) * bias;
      const u = 1 - t;
      out[i * 2] = u * u * fx + 2 * u * t * cx + t * t * tx;
      out[i * 2 + 1] = u * u * fy + 2 * u * t * cy + t * t * ty + dy;
    }
  }

  function writeTarget(index, instant, dy = 0) {
    if (!shapes.length) return;
    const next = shapes[index % shapes.length];
    const from = geometry.attributes.aFrom;
    const to = geometry.attributes.aTo;
    if (instant) {
      from.array.set(next);
    } else if (morph < 1 || dy) {
      snapshotInto(from.array, dy);
    } else {
      from.array.set(to.array);
    }
    to.array.set(next);
    from.needsUpdate = true;
    to.needsUpdate = true;
    // Wordness is blended across the pair exactly as the positions are, so a
    // word settling out of a mark loses the wander and gains its hard edge as it
    // becomes readable rather than at the frame the pair is relabelled.
    // Retargeting mid-flight starts from whatever the blend is showing now, for
    // the same reason the positions are snapshotted rather than reset.
    wordFrom = instant ? wordness[index % shapes.length] : blendedWord();
    wordTo = wordness[index % shapes.length];
    morph = instant ? 1 : 0;
  }

  // The scroll-driven equivalent, and deliberately much less machinery: load the
  // pair the reader is currently between and let uMorph, which is a function of
  // scroll, say where between them. Safe to call at any moment the pair changes
  // because the morph is pinned to an endpoint throughout the hold either side.
  let pairLoaded = -1;
  let wordFrom = 0;
  let wordTo = 0;

  function blendedWord() {
    return wordFrom + (wordTo - wordFrom) * morph;
  }

  function writePair(index) {
    if (!shapes.length) return;
    const last = shapes.length - 1;
    const from = geometry.attributes.aFrom;
    const to = geometry.attributes.aTo;
    from.array.set(shapes[Math.min(index, last)]);
    to.array.set(shapes[Math.min(index + 1, last)]);
    from.needsUpdate = true;
    to.needsUpdate = true;
    wordFrom = wordness[Math.min(index, last)];
    wordTo = wordness[Math.min(index + 1, last)];
    pairLoaded = index;
  }

  // ---- word runs -----------------------------------------------------------
  //
  // A run rewrites itself where it stands, and that has to be able to happen
  // *while* the journey blend is running: a reader can start scrolling on any
  // frame, including the frame after a word began changing. So the rewrite is
  // not a second morph fighting the journey for the pair. It is folded into the
  // station's own shape, on the CPU, and the pair is reloaded from that shape
  // every frame it changes. Whatever the scroll is doing, the field stays
  // exactly the blend between two well-defined shapes — there is no state the
  // rewrite can be interrupted in that needs unwinding.
  //
  // The same per-particle delay and arc bias the shader uses, so a word
  // rewriting itself reads like every other change in the field rather than
  // like a slide.
  function swapInto(out, a, b, t) {
    for (let i = 0; i < count; i++) {
      let u = clamp((t - seeds[i * 3] * MAX_DELAY) / (1 - MAX_DELAY), 0, 1);
      u = u * u * (3 - 2 * u);
      const fx = a[i * 2];
      const fy = a[i * 2 + 1];
      const tx = b[i * 2];
      const ty = b[i * 2 + 1];
      const bias = (seeds[i * 3 + 1] - 0.5) * 0.45;
      const cx = (fx + tx) * 0.5 - (ty - fy) * bias;
      const cy = (fy + ty) * 0.5 + (tx - fx) * bias;
      const v = 1 - u;
      out[i * 2] = v * v * fx + 2 * v * u * cx + u * u * tx;
      out[i * 2 + 1] = v * v * fy + 2 * v * u * cy + u * u * ty;
    }
  }

  // The station the cloud is sitting still on, or -1 mid-journey. The morph
  // reaches exactly 0 and exactly 1 inside the hold either side of every leg,
  // so this is the whole test: a run only ever cycles while the scroll has it
  // pinned, which is to say while the reader has stopped in front of it.
  function heldStation() {
    if (journey.morph <= 0) return journey.pair;
    if (journey.morph >= 1) return Math.min(journey.pair + 1, stations.length - 1);
    return -1;
  }

  function advanceRun(dt) {
    const held = heldStation();
    if (held !== run.station) {
      // Scrolled off mid-rewrite. The word it was turning into becomes the one
      // it holds, so what the reader leaves behind is a finished word.
      if (run.t >= 0) {
        shapes[run.station] = run.to;
        run.t = -1;
        pairLoaded = -1;
      }
      run.station = held;
      run.dwell = 0;
    }

    const words = runShapes.get(held);
    if (!words || motion.prefersReducedMotion) return;

    if (run.t >= 0) {
      run.t = Math.min(1, run.t + dt / WORD_SWAP);
      if (run.t >= 1) {
        shapes[held] = run.to;
        run.t = -1;
        run.dwell = 0;
      } else {
        swapInto(run.buf, run.from, run.to, sstep(run.t));
      }
      // The station's shape moved under whichever end of the pair it is, so the
      // pair is stale by definition. Both words sit in the same place, so
      // nothing here changes how far a leg carries the cloud and legTravel does
      // not need remeasuring.
      pairLoaded = -1;
      return;
    }

    run.dwell += dt;
    if (run.dwell < WORD_DWELL) return;
    const next = ((runAt.get(held) || 0) + 1) % words.length;
    runAt.set(held, next);
    if (!run.buf) run.buf = new Float32Array(count * 2);
    run.from = shapes[held];
    run.to = words[next];
    run.t = 0;
    swapInto(run.buf, run.from, run.to, 0);
    shapes[held] = run.buf;
    pairLoaded = -1;
  }

  // ---- state ---------------------------------------------------------------

  const pointer = trackPointer(canvas);
  let morph = 1;
  let elapsed = 0;
  let burst = 1;
  let opacity = 0;
  let cycleTimer = 0;
  let inView = false;
  let pending = true;
  const cursor = { x: -99999, y: -99999 };

  const stopObserving = inViewport(canvas, (visible) => {
    inView = visible;
    if (visible) pending = true;
  });

  // The avoidance region is the union of every element handed in, not just the
  // headline: sub-copy, buttons and the mono note all have to stay legible, and
  // one superellipse over the whole block reads better than several holes.
  const range = document.createRange();

  // What one element occupies. A Range over the contents measures the type
  // itself; getBoundingClientRect on a block element returns the full column
  // width, which would carve a hole the width of the container around a centred
  // line.
  //
  // data-avoid="box" opts out of that, for the regions that are not type: a
  // diagram drawn on a canvas has no text for a Range to find at all, and what
  // has to stay clear of the cloud is its whole box.
  function regionRect(el) {
    if (el.dataset.avoid === 'box') return el.getBoundingClientRect();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  }

  // The union of a set of those, as a padded box.
  function textBox(els, padX = 26, padY = 22) {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const el of els) {
      const rect = regionRect(el);
      if (!rect.width) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }
    if (!(right > left)) return null;
    return {
      cx: (left + right) / 2,
      // Page coordinates for the vertical, so the region survives the page
      // moving under it. The horizontal never scrolls.
      cy: (top + bottom) / 2 + window.scrollY,
      hx: (right - left) / 2 + padX,
      hy: (bottom - top) / 2 + padY,
    };
  }

  // A scroll-driven field carries one region per station rather than one region
  // full stop: a hole measured against the hero would otherwise stay punched in
  // the cloud five screens further down, over nothing. Only stations that
  // declare [data-avoid] get an entry; the rest get the shape whole.
  //
  // A station asking to fade instead of displace keeps its regions apart rather
  // than unioned — see the shader. Page coordinates, so one measurement per
  // layout survives every scroll position the region is visible at.
  const avoidBoxes = [];
  const fadeBoxes = [];

  function measureText() {
    if (scrollDriven) {
      avoidBoxes.length = 0;
      fadeBoxes.length = 0;
      for (const s of stations) {
        const els = s.el.querySelectorAll('[data-avoid]');
        avoidBoxes.push(s.avoid === 'fade' ? null : textBox(els));
        fadeBoxes.push(
          s.avoid === 'fade'
            ? Array.from(els, (el) => textBox([el], 14, 10)).filter(Boolean)
            : null
        );
      }
      return;
    }
    // A local field and its text scroll together, so one measurement in canvas
    // coordinates holds for the life of the layout.
    const box = textEls.length ? textBox(textEls) : null;
    if (!box) {
      material.uniforms.uTextHalf.value.set(0, 0);
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    material.uniforms.uTextCenter.value.set(
      box.cx - (canvasRect.left + canvasRect.width / 2),
      canvasRect.top + canvasRect.height / 2 - (box.cy - window.scrollY)
    );
    material.uniforms.uTextHalf.value.set(box.hx, box.hy);
  }

  // The regions belonging to the pair the journey is currently on, preferring the
  // near end. Handed to the shader in this frame's canvas coordinates, which is
  // where the hole is now cut.
  function applyAvoid(rect) {
    const near = journey.x < 0.5 ? journey.pair : journey.pair + 1;
    const far = journey.x < 0.5 ? journey.pair + 1 : journey.pair;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const box = avoidBoxes[near] || avoidBoxes[far];
    if (box) {
      material.uniforms.uTextCenter.value.set(box.cx - cx, cy - (box.cy - window.scrollY));
      material.uniforms.uTextHalf.value.set(box.hx, box.hy);
    } else {
      material.uniforms.uTextHalf.value.set(0, 0);
    }

    // Both ends of the leg, not whichever one is nearer. On a short leg the
    // journey crosses the halfway mark while the station behind still has
    // paragraphs on screen, and taking only the near list drops their regions
    // mid-scroll — the cloud lands back on copy it had been keeping clear of.
    //
    // Only the regions on screen. An off-screen paragraph cannot be read over,
    // and the field is one shape spread across the viewport — spending a slot on
    // a paragraph two screens away would leave a real one unfaded. That test is
    // also what keeps the union inside FADE_MAX: no two adjacent stations have
    // that many regions visible at once.
    let n = 0;
    const slots = material.uniforms.uFadeBox.value;
    const scrollY = window.scrollY;
    const vh = window.innerHeight;
    for (const list of [fadeBoxes[near], fadeBoxes[far]]) {
      if (!list) continue;
      for (const b of list) {
        if (n === FADE_MAX) break;
        const top = b.cy - b.hy - scrollY;
        if (top > vh || top + b.hy * 2 < 0) continue;
        slots[n++].set(b.cx - cx, cy - (b.cy - scrollY), b.hx, b.hy);
      }
    }
    material.uniforms.uFadeCount.value = n;
  }

  function relayout() {
    if (scrollDriven) {
      measureStations();
      readJourney(window.scrollY);
      writePair(journey.pair);
    }
    measureText();
  }

  function rebuild() {
    if (!ctx.resize()) return;
    material.uniforms.uWidth.value = size.width;
    material.uniforms.uHeight.value = size.height;
    material.uniforms.uCursorR.value = clamp(Math.min(size.width, size.height) * 0.17, 80, 190);
    buildShapes();
    if (!scrollDriven) writeTarget(shapeIndex, true);
    relayout();
    pending = true;
  }

  material.uniforms.uCursorR.value = clamp(Math.min(size.width, size.height) * 0.17, 80, 190);
  buildShapes();
  if (scrollDriven) {
    // Deep links and reloads part-way down the page land on the right frame
    // directly, because the frame is a function of where the page already is.
    relayout();
  } else {
    writeTarget(shapeIndex, true);
    measureText();
  }

  loadImage(logoSrc)
    .then((img) => {
      logoImage = img;
      buildShapes();
      if (scrollDriven) {
        // The scroll position has not changed, so neither has the frame: reload
        // the same pair, now with the real logo in it.
        writePair(journey.pair);
      } else {
        // Land on the logo as the resting shape, arriving rather than appearing.
        shapeIndex = 0;
        writeTarget(shapeIndex, false);
      }
      cycleTimer = 0;
      pending = true;
    })
    .catch(() => {});

  // Words are rasterised from the real typeface, so a cloud built before Geist
  // arrives is a cloud shaped like the fallback. Rebuilt once, the same way the
  // logo is, and — as there — reloaded at the position the journey is already
  // at, which is an endpoint of the current pair long before anyone has
  // scrolled.
  if (document.fonts && (texts.length || stations.some((s) => s.words))) {
    document.fonts.ready.then(() => {
      buildShapes();
      if (scrollDriven) writePair(journey.pair);
      else writeTarget(shapeIndex, true);
      pending = true;
    });
  }

  const onScroll = () => {
    pending = true;
  };
  if (scrollDriven) window.addEventListener('scroll', onScroll, { passive: true });

  // On window rather than on the canvas: every field on the site is
  // pointer-events:none so the copy underneath stays selectable, which means the
  // canvas itself never receives a pointer event to burst from.
  function onPointerDown(e) {
    const rect = canvas.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      return;
    }
    material.uniforms.uBurstOrigin.value.set(
      e.clientX - rect.left - rect.width / 2,
      rect.height / 2 - (e.clientY - rect.top)
    );
    burst = 0;
    pending = true;
  }
  window.addEventListener('pointerdown', onPointerDown, { passive: true });

  const stopFrame = onFrame((dt) => {
    const running = inView && motion.shouldRunAnimations;
    if (!running && !pending) return;
    pending = false;

    rebuild();

    // Two clocks. The ambient clock stops dead under reduced motion; the burst
    // clock keeps running, because a burst is feedback for something the user
    // did and swallowing it silently is worse than the motion itself.
    if (running && !motion.prefersReducedMotion) {
      elapsed += dt;
      cycleTimer += dt;
    }

    if (!scrollDriven) {
      if (running && !motion.prefersReducedMotion) {
        if (morph < 1) morph = Math.min(1, morph + dt / MORPH_DURATION);
        if (autoCycle && morph >= 1 && shapes.length > 1 && cycleTimer > CYCLE_SECONDS) {
          cycleTimer = 0;
          shapeIndex = (shapeIndex + 1) % shapes.length;
          writeTarget(shapeIndex, false);
        }
      } else if (morph < 1) {
        morph = 1;
      }
    }

    if (burst < 1) burst = Math.min(1, burst + dt / BURST_DURATION);

    // One rect read per frame, shared by everything below that needs to know
    // where this canvas currently is: the pointer conversion, the travel offset
    // and the avoidance region. Two of the three canvases are positioned in the
    // page rather than the viewport, so the answer changes on every scroll even
    // when nothing else has.
    const rect = canvas.getBoundingClientRect();
    pointer.sync(rect);

    const targetX = pointer.state.inside ? pointer.state.x : -99999;
    const targetY = pointer.state.inside ? pointer.state.y : -99999;
    if (pointer.state.inside) {
      // Short enough that the hole reads as being under the pointer rather than
      // chasing it — about a 45ms time constant, roughly a frame and a half of
      // trail at 60Hz. Long enough to still absorb the jitter of a raw move.
      const k = damp(2e-10, dt);
      if (cursor.x < -9999) {
        cursor.x = targetX;
        cursor.y = targetY;
      } else {
        cursor.x += (targetX - cursor.x) * k;
        cursor.y += (targetY - cursor.y) * k;
      }
    } else {
      cursor.x = -99999;
      cursor.y = -99999;
    }

    let strength = 1;
    if (scrollDriven) {
      const y = window.scrollY;
      readJourney(y);
      // Only while the field is actually running: a word that turned over
      // behind a hidden canvas or under reduced motion is a word nobody saw.
      advanceRun(running && !motion.prefersReducedMotion ? dt : 0);
      // The pair only ever changes at a scroll position where the morph is
      // pinned to an endpoint, so this is a relabelling, not a jump. A run
      // invalidates it too, having just rewritten the shape at one end of it.
      if (journey.pair !== pairLoaded) writePair(journey.pair);
      morph = journey.morph;

      // The offset is computed for the viewport; a canvas that scrolls with the
      // page has to undo its own travel to land the shape on the same pixel the
      // fixed canvas puts it on. Without that the hero's front layer moves at
      // twice the page's speed and tears away from its own back half.
      const local = isFixed ? 0 : rect.top + rect.height / 2 - window.innerHeight / 2;
      material.uniforms.uShift.value.set(0, journey.shift + local);
      applyAvoid(rect);

      // Gated on the same width the placement is, so a station is never lit at a
      // width where its offset has been dropped and it would sit over the copy.
      const away = canPlace(size.width) ? AWAY_OPACITY : 0;
      const a = stationWeight(journey.pair, away);
      const b = stationWeight(journey.pair + 1, away);
      strength = (a + (b - a) * morph) * litAt(y);

      // A canvas clipped to its own section cannot follow the journey out of it.
      // It fades over the first half of the leg away — smoothly, and while the
      // shape is still well inside its box, so the fade is what is seen rather
      // than the shape being cut off at the section's edge.
      if (homeStation >= 0) {
        const { pair, x } = journey;
        let home = 0;
        if (pair === homeStation) home = 1 - sstep(clamp(x / HOME_EXIT, 0, 1));
        else if (pair + 1 === homeStation) home = sstep(clamp((x - 1) / HOME_EXIT + 1, 0, 1));
        strength *= home;
      }
    }
    const targetOpacity = inView ? strength : 0;
    opacity += (targetOpacity - opacity) * damp(0.002, dt);
    if (Math.abs(targetOpacity - opacity) < 0.0005) opacity = targetOpacity;

    points.visible = opacity > 0.001;
    material.uniforms.uMorph.value = morph;
    material.uniforms.uTime.value = motion.prefersReducedMotion ? 0 : elapsed;
    material.uniforms.uBurstTime.value = burst;
    const word = blendedWord();
    material.uniforms.uDrift.value = 1 + (WORD_DRIFT - 1) * word;
    material.uniforms.uSharp.value = word;
    material.uniforms.uOpacity.value = opacity;
    material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    material.uniforms.uCursor.value.set(cursor.x, cursor.y);

    renderer.render(scene, camera);

    if (opacity !== targetOpacity || morph < 1 || burst < 1) pending = true;
  });

  return {
    next() {
      if (!shapes.length || morph < 1) return;
      shapeIndex = (shapeIndex + 1) % shapes.length;
      cycleTimer = 0;
      writeTarget(shapeIndex, false);
      pending = true;
    },
    remeasure() {
      relayout();
      pending = true;
    },
    destroy() {
      stopFrame();
      stopObserving();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerdown', onPointerDown);
      pointer.dispose();
      geometry.dispose();
      material.dispose();
      ctx.dispose();
    },
  };
}
