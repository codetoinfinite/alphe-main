export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Mount a module against every element matching `sel`. Returns nothing when the
// page has no such element, so every page can load the same main.js.
export function mount(sel, init, root = document) {
  const els = qsa(sel, root);
  for (const el of els) init(el);
  return els.length;
}

// Split an element's text into word and character spans for staggered reveals.
//
// Two rules, both learned the hard way:
//   - never split before document.fonts.ready — measuring against a fallback
//     font produces line boxes that jump the moment the real font arrives
//   - keep the original text so a resize can re-split from a clean source
export function splitText(el) {
  // Collapse the source first. Markup indentation puts a newline inside the
  // element, and once the split emits it as its own text node between two
  // inline-blocks the browser no longer strips it — the first line ends up
  // indented by a space against every line below it.
  if (!el.dataset.originalText) {
    el.dataset.originalText = el.textContent.replace(/\s+/g, ' ').trim();
  }
  const source = el.dataset.originalText;
  const words = source.split(/(\s+)/);
  el.textContent = '';

  const chars = [];
  for (const word of words) {
    if (/^\s+$/.test(word)) {
      el.appendChild(document.createTextNode(word));
      continue;
    }
    const wordEl = document.createElement('span');
    wordEl.className = 'split-word';
    for (const ch of word) {
      const charEl = document.createElement('span');
      charEl.className = 'split-char';
      charEl.textContent = ch;
      wordEl.appendChild(charEl);
      chars.push(charEl);
    }
    el.appendChild(wordEl);
  }
  return chars;
}

// Group already-split characters by their vertical offset, so a reveal can
// animate whole lines. Line boxes are a layout result, not a source property —
// they have to be measured after the split, and re-measured after a resize.
export function groupIntoLines(chars) {
  const lines = new Map();
  for (const ch of chars) {
    const top = Math.round(ch.offsetTop);
    if (!lines.has(top)) lines.set(top, []);
    lines.get(top).push(ch);
  }
  return Array.from(lines.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group);
}

export function debounce(fn, ms = 150) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
