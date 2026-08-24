// Accuracy per dollar.
//
// Our own numbers. The board below this one on the home page is Artificial
// Analysis's and says so; this one is a run of our own task set through Alphe
// and through four single models, graded the same way and billed end to end, so
// the only thing that differs between rows is what answered the question.
//
//   accuracy  0–10, graded on the same task set for every row.
//   cost      USD for one task end to end, provider tokens included. On the
//             Alphe row that is the routed bill — whatever the router actually
//             called, plus our own fee.
//
// Before this goes out under a claim, the eval wants a name, a date and a
// sample size in SOURCE below, the way models.js carries Artificial Analysis's.
// A benchmark nobody can re-run is a marketing number, and this section's whole
// argument is that it is not one.
//
// The two frontier rows are the point of the section: half a point of accuracy
// for two orders of magnitude of money. The two cheap rows are the other half —
// going cheap on one model is not the same as routing, and costs more than
// routing while losing five to seven points.

export const PD_SOURCE = {
  name: 'Alphe',
  captured: '2026-08-10',
  label: "Alphe's own measurement · one task set, one grader",
};

export const RUNS = [
  { name: 'Alphe', creator: 'Alphe', accuracy: 9, cost: 0.0077 },
  { name: 'GPT-5.6 Sol', creator: 'OpenAI', accuracy: 9.5, cost: 0.71 },
  { name: 'Claude Opus 5', creator: 'Anthropic', accuracy: 9.5, cost: 0.83 },
  { name: 'Gemini', creator: 'Google', accuracy: 2, cost: 0.069 },
  { name: 'Grok', creator: 'SpaceXAI', accuracy: 4, cost: 0.058 },
];

// Derived, never stored: accuracy and cost are the two things that were
// measured, and a third number checked in beside them is a number that
// eventually disagrees with them.
export const perDollar = (r) => r.accuracy / r.cost;

// The three views of the same five rows.
//
// `high` says which end is good — points and points-per-dollar want the big
// number, money wants the small one — and is the only thing the chart needs to
// know to sort a metric it has never seen.
//
// `log` says how tall to draw it. Accuracy is 2 to 9.5, under 5× top to bottom,
// which a column shows honestly on a linear scale. Cost spans 108× and value
// spans 102×: linear, four of the five columns would be a sliver on the floor
// and the reader would learn that Alphe is cheap and nothing about the four
// rows it is being compared with. A log height keeps every step between
// neighbours visible, the caption says so, and the number printed over each
// column is always the measured one.
//
// The multiples quoted in the captions are printed by tools/perdollar-gen.mjs
// on every run — re-measure, re-run it, and correct any line it disagrees with.

export const PD_METRICS = [
  {
    key: 'perdollar',
    label: 'Accuracy per dollar',
    unit: 'points/USD',
    high: true,
    log: true,
    format: (v) => Math.round(v).toLocaleString('en-US'),
    caption:
      'Accuracy points returned per dollar spent. Alphe returns 1,169 of them; the best single model returns 69. Column height is logarithmic: the spread is 102×.',
  },
  {
    key: 'accuracy',
    label: 'Accuracy',
    unit: '0–10',
    high: true,
    log: false,
    format: (v) => v.toFixed(1),
    caption:
      'Graded 0–10 on the same task set. Alphe scores 9. The two frontier models score 9.5 — half a point more, for 92× and 108× the money.',
  },
  {
    key: 'cost',
    // Four places under a tenth of a dollar and two above it. One format for
    // both ends would either round $0.0077 to $0.01 — the number the section
    // exists to show — or print the others as $0.7100. Trailing zeros come off
    // the short end too, so $0.058 is not padded to $0.0580 to keep $0.0077
    // company.
    label: 'Cost per task',
    unit: 'USD',
    high: false,
    log: true,
    format: (v) =>
      `$${v >= 0.1 ? v.toFixed(2) : v.toFixed(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}`,
    caption:
      'What one task costs end to end, provider tokens included. Alphe routes it for $0.0077; the cheapest single model is 7.5× that and the most accurate is 108×. Column height is logarithmic: the spread is 108×.',
  },
];
