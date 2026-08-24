// Seeded randomness. Every scatter in the site is deterministic: the same page
// looks identical on every load and on every machine, which is the difference
// between a composition and a mess that happens to be different each time.

export function mulberry32(seed) {
  let t = seed | 0;
  return () => {
    let e = Math.imul((t = (t + 0x6d2b79f5) | 0) ^ (t >>> 15), 1 | t);
    return ((((e = (e + Math.imul(e ^ (e >>> 7), 61 | e)) ^ e) ^ (e >>> 14)) >>> 0) / 0x100000000);
  };
}

// Angles around a circle that read as "scattered" rather than "random".
//
// Pure Math.random() clumps — it produces visible pairs and visible gaps.
// Perfectly even spacing reads as a machine part. So: half the points land on
// an even lattice, half land randomly, then the random half is relaxed apart
// until no two are closer than `minGap`. Structure underneath, life on top.
export function scatterAngles(count, seed) {
  const TAU = Math.PI * 2;
  const evenCount = Math.floor(count / 2);
  const randomCount = count - evenCount;
  const minGap = (TAU / randomCount) * 0.4;
  const angles = new Float32Array(count);
  const random = mulberry32(seed);

  for (let i = 0; i < evenCount; i++) angles[i] = (i / evenCount) * TAU;
  for (let i = 0; i < randomCount; i++) angles[evenCount + i] = random() * TAU;

  const scattered = angles.subarray(evenCount);
  scattered.sort();

  // Lloyd relaxation. 15 passes is where the gaps stop visibly changing.
  for (let pass = 0; pass < 15; pass++) {
    for (let i = 0; i < randomCount; i++) {
      const next = (i + 1) % randomCount;
      let gap = scattered[next] - scattered[i];
      if (next === 0) gap += TAU;
      if (gap < minGap) {
        const push = (minGap - gap) * 0.5;
        scattered[i] = (scattered[i] - push + TAU) % TAU;
        scattered[next] = (scattered[next] + push) % TAU;
      }
    }
  }

  angles.sort();
  return angles;
}
