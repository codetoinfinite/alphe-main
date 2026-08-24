// Model benchmarks.
//
// Measured numbers, not marketing ones. Every figure below is copied verbatim
// from the Artificial Analysis public leaderboard, which runs the same eval
// harness against every model on the list rather than quoting each vendor's own
// card. Snapshot taken 6 August 2026 — see SOURCE, and re-take it rather than
// nudging a value, because the whole point of the section is that the numbers
// are somebody else's.
//
//   intelligence  Artificial Analysis Intelligence Index, 0–100. Four equal
//                 quarters: agentic tasks, coding, general capability and
//                 scientific reasoning.
//   cost          USD to run one Intelligence Index task end to end, so it
//                 prices reasoning tokens the model actually spent rather than
//                 a per-token rate that hides how much it thinks.
//   speed         Median output tokens per second.
//   latency       Seconds to the first chunk. On a reasoning model this
//                 includes the thinking it does before it says anything.
//   total         Seconds to a complete response.
//
// Eighteen of the 264 rows on the leaderboard. The cut keeps one entry per
// model family and spans the full spread — $0.03 to $3.26 a task, 38 to 364
// tokens a second — because a routing argument is only interesting across a
// range that wide.
//
// `board: true` marks the eight that get a column in the isometric chart. A 3D
// bar costs a screen-width slice, and eight is what fits legibly down to a
// phone. The eight were chosen so that each of the four columns has a different
// winner and the order visibly comes apart between tabs — which is the
// section's whole claim. The other ten stay here as the snapshot they were cut
// from, so a later re-take starts from the same eighteen rows.

export const SOURCE = {
  name: 'Artificial Analysis',
  url: 'https://artificialanalysis.ai/leaderboards/models',
  captured: '2026-08-06',
  label: 'Artificial Analysis Intelligence Index v3.0 · captured 6 Aug 2026',
};

export const MODELS = [
  { name: 'Claude Opus 5 (max)', board: true, creator: 'Anthropic', ctx: '1M', intelligence: 61, cost: 2.34, speed: 54, latency: 62.83, total: 72.15 },
  { name: 'Claude Fable 5', creator: 'Anthropic', ctx: '1M', intelligence: 60, cost: 3.15, speed: 71, latency: 112.28, total: 119.37 },
  { name: 'GPT-5.6 Sol (max)', creator: 'OpenAI', ctx: '1M', intelligence: 59, cost: 1.23, speed: 64, latency: 137.75, total: 145.55 },
  { name: 'Kimi K3 (max)', creator: 'Kimi', ctx: '1.05M', intelligence: 57, cost: 0.86, speed: 38, latency: 3.11, total: 68.69 },
  { name: 'Qwen3.8 Max', board: true, creator: 'Alibaba', ctx: '1M', intelligence: 56, cost: 3.26, speed: 62, latency: 2.56, total: 43.04 },
  { name: 'GPT-5.6 Terra (max)', creator: 'OpenAI', ctx: '1M', intelligence: 55, cost: 0.51, speed: 126, latency: 175.04, total: 179.01 },
  { name: 'Grok 4.5 (high)', board: true, creator: 'SpaceXAI', ctx: '500k', intelligence: 54, cost: 0.36, speed: 59, latency: 9.76, total: 18.17 },
  { name: 'Claude Sonnet 5 (max)', creator: 'Anthropic', ctx: '1M', intelligence: 53, cost: 1.72, speed: 74, latency: 196.38, total: 203.16 },
  { name: 'GPT-5.6 Luna (max)', board: true, creator: 'OpenAI', ctx: '1M', intelligence: 51, cost: 0.05, speed: 184, latency: 117.98, total: 120.7 },
  { name: 'GLM-5.2 (max)', creator: 'Z AI', ctx: '1M', intelligence: 51, cost: 0.57, speed: 148, latency: 1.48, total: 18.37 },
  { name: 'Muse Spark 1.1 (xhigh)', board: true, creator: 'Meta', ctx: '1.05M', intelligence: 51, cost: 0.29, speed: 216, latency: 2.91, total: 14.5 },
  { name: 'Gemini 3.6 Flash', board: true, creator: 'Google', ctx: '1M', intelligence: 50, cost: 0.56, speed: 188, latency: 17.27, total: 19.94 },
  { name: 'DeepSeek V4 Flash (max)', board: true, creator: 'DeepSeek', ctx: '1M', intelligence: 50, cost: 0.03, speed: 103, latency: 1.31, total: 25.51 },
  { name: 'MiniMax-M3', creator: 'MiniMax', ctx: '1M', intelligence: 44, cost: 0.14, speed: 89, latency: 1.49, total: 29.46 },
  { name: 'Gemini 3.5 Flash-Lite', creator: 'Google', ctx: '1M', intelligence: 36, cost: 0.1, speed: 344, latency: 10.59, total: 12.04 },
  { name: 'Step 3.7 Flash', board: true, creator: 'StepFun', ctx: '262k', intelligence: 30, cost: 0.09, speed: 364, latency: 0.96, total: 7.83 },
  { name: 'Mistral Medium 3.5', creator: 'Mistral', ctx: '256k', intelligence: 30, cost: 0.46, speed: 140, latency: 1.67, total: 19.53 },
  { name: 'Claude 4.5 Haiku', creator: 'Anthropic', ctx: '200k', intelligence: 30, cost: 0.22, speed: 99, latency: 15.71, total: 20.76 },
];

export const BOARD = MODELS.filter((m) => m.board);

// The four views the leaderboard offers.
//
// `high` says which end is good, which is the only thing the chart needs to
// know to sort a column it has never seen: intelligence and throughput want the
// big number, money and waiting want the small one.
//
// `log` says how tall to draw it. Index and throughput are read straight off a
// linear scale — top to bottom they differ by 2× and 7×, which a column shows
// honestly. Money and waiting differ by 109× and 123×, and on a linear scale
// seven of the eight columns would be a sliver at the floor while one filled the
// panel: the reader would learn that Qwen is expensive and nothing else. A log
// height keeps every step between neighbours visible. The caption says so, and
// the number printed over each column is always the measured one.

export const METRICS = [
  {
    key: 'intelligence',
    label: 'Intelligence',
    unit: 'index',
    high: true,
    log: false,
    format: (v) => String(v),
    caption: 'Artificial Analysis Intelligence Index: agentic, coding, general and scientific reasoning, weighted equally.',
  },
  {
    key: 'cost',
    label: 'Cost per task',
    unit: 'USD',
    high: false,
    log: true,
    format: (v) => `$${v.toFixed(2)}`,
    caption: 'What one Intelligence Index task costs end to end, reasoning tokens included. Column height is logarithmic: the spread is 109×.',
  },
  {
    key: 'speed',
    label: 'Output speed',
    unit: 'tok/s',
    high: true,
    log: false,
    format: (v) => `${Math.round(v)}`,
    caption: 'Median output tokens per second once the model starts writing.',
  },
  {
    key: 'latency',
    label: 'Time to first token',
    unit: 'sec',
    high: false,
    log: true,
    format: (v) => `${v.toFixed(2)}s`,
    caption: 'Seconds before the first chunk arrives: on a reasoning model, everything it thinks before it speaks. Column height is logarithmic: the spread is 123×.',
  },
];

// Column height, 0–1.
//
// One definition, used by the generator that ships the chart and by the runtime
// that re-sorts it, so a static column and a re-sorted one can never disagree.
// The log branch lands its shortest column at 0.15 rather than 0: a zero-height
// prism has no top face and stops being a bar.
export function barScale(metric, values) {
  const max = Math.max(...values);
  if (!metric.log) return (v) => v / max;
  const min = Math.min(...values);
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  if (hi - lo < 1e-9) return () => 1;
  return (v) => 0.15 + 0.85 * ((Math.log10(v) - lo) / (hi - lo));
}

