// One hard question.
//
// The accuracy-per-dollar board that opens the run is an aggregate: a task set,
// averaged. This is a single question put to five answerers, because an average
// hides the thing the section is about — what a long, live, badly-sourced
// question does to a model that has to answer it in one pass.
//
// The question, verbatim:
//
//   "tell me all about assam flood update from its starting till today, like
//    the tragedy, the people suffering, the aid they got, and any big highlight
//    or event"
//
// Six weeks of a running disaster, no fixed answer key, and every clause of it
// wants a different source: casualty counts move daily, relief figures come out
// of state bulletins, and "any big highlight" is not a retrievable fact at all.
// Graded twice for that reason —
//
//   accuracy  0–10. Are the numbers, dates and places right, and does the
//             timeline actually run from the first breach to the day it was
//             asked. Wrong figures and missing weeks come off here.
//   quality   0–10. Is the answer worth reading: structure, coverage of all
//             four clauses, and whether the human cost is reported or skipped.
//             An answer can be accurate and still score badly by being thin.
//
// and measured twice:
//
//   cost      USD for the whole run, provider tokens included. On the Alphe row
//             that is the routed bill — every model the router actually called,
//             plus our fee.
//   wallclock Seconds from the question to the finished answer.
//
// The source table also carries cost and speed as 0–10 scores. Those are these
// same two measurements rescaled, not extra evidence, so they are kept beside
// the rows they came from and never charted — the board prints measured numbers
// or it prints nothing.
//
// Before this goes out under a claim it wants the grader named and the run
// dated the way models.js carries Artificial Analysis's. One question is an
// anecdote until somebody else can ask it too.

export const RS_SOURCE = {
  name: 'Alphe',
  captured: '2026-08-10',
  label: "Alphe's own measurement · one question, one grader",
};

export const RESEARCH = [
  { name: 'Alphe',                  creator: 'Alphe',     accuracy: 6.5, quality: 7.5, cost: 0.0074, wallclock: 71,  costScore: 10, speedScore: 7  },
  { name: 'GPT-5.6 Sol',            creator: 'OpenAI',    accuracy: 8.5, quality: 8.5, cost: 0.48,   wallclock: 124, costScore: 4,  speedScore: 3  },
  { name: 'Claude Opus 5',          creator: 'Anthropic', accuracy: 8,   quality: 9,   cost: 0.7,    wallclock: 84,  costScore: 2,  speedScore: 6  },
  { name: 'Grok 4.20',              creator: 'SpaceXAI',  accuracy: 6.5, quality: 7,   cost: 0.05,   wallclock: 42,  costScore: 9,  speedScore: 8  },
  { name: 'Gemini 3.1 Pro Preview', creator: 'Google',    accuracy: 5,   quality: 3,   cost: 0.05,   wallclock: 18,  costScore: 9,  speedScore: 10 },
];

// Derived, never stored — the same definition the section above uses, so the two
// boards are quoting one measure of value rather than two that happen to share a
// name. A third number checked in beside accuracy and cost is a number that
// eventually disagrees with them.
export const accPerDollar = (r) => r.accuracy / r.cost;

// The five views of the same five rows.
//
// `high` says which end is good — points and points-per-dollar want the big
// number, money and waiting want the small one — and is the only thing the chart
// needs to know to sort a metric it has never seen.
//
// `log` says how tall to draw it. Both grades are 3 to 9 and wall clock is 18 to
// 124, under 7× top to bottom, which a column shows honestly on a linear scale.
// Cost spans 95× and value spans 77×: linear, four of the five columns would be
// a sliver on the floor and the reader would learn that Alphe is cheap and
// nothing about the four rows it is being compared with. A log height keeps
// every step between neighbours visible, the caption says so, and the number
// printed over each column is always the measured one.
//
// Four different rows win the five tabs. That is not arrangement — it is what a
// question with this many clauses does to a field of models, and it is the
// reason the routed row is worth having.
//
// The multiples quoted in the captions are printed by tools/research-gen.mjs on
// every run — re-measure, re-run it, and correct any line it disagrees with.

export const RS_METRICS = [
  {
    key: 'perdollar',
    label: 'Accuracy per dollar',
    unit: 'points/USD',
    high: true,
    log: true,
    format: (v) => Math.round(v).toLocaleString('en-US'),
    caption:
      'Accuracy points returned per dollar spent on this question. Alphe returns 878 of them; the best single model returns 130. Column height is logarithmic: the spread is 77×.',
  },
  {
    key: 'accuracy',
    label: 'Accuracy',
    unit: '0–10',
    high: true,
    log: false,
    format: (v) => v.toFixed(1),
    caption:
      'Are the figures, dates and places right, and does the timeline reach today. Alphe scores 6.5. The best single answer scores 8.5 — two points more, for 65× the money.',
  },
  {
    key: 'quality',
    label: 'Quality',
    unit: '0–10',
    high: true,
    log: false,
    format: (v) => v.toFixed(1),
    caption:
      'Whether the answer is worth reading: structure, all four clauses covered, the human cost reported rather than skipped. The cheapest fast answer scores 3 here.',
  },
  {
    key: 'cost',
    // Four places under a tenth of a dollar and two above it. One format for
    // both ends would either round $0.0074 to $0.01 — the number the section
    // exists to show — or print the others as $0.7000.
    label: 'Cost per task',
    unit: 'USD',
    high: false,
    log: true,
    format: (v) => `$${v >= 0.1 ? v.toFixed(2) : v.toFixed(4)}`,
    caption:
      'What the whole run costs end to end, provider tokens included. Alphe routes it for $0.0074; the cheapest single model is 6.8× that and the most expensive is 95×. Column height is logarithmic: the spread is 95×.',
  },
  {
    key: 'wallclock',
    label: 'Wall clock',
    unit: 'sec',
    high: false,
    log: false,
    format: (v) => `${Math.round(v)}s`,
    caption:
      'Seconds from the question to the finished answer. The fastest row is also the worst-graded one: 18 seconds buys an answer that scores 3 for quality.',
  },
];
