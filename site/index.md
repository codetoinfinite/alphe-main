# The decision layer for AI infrastructure

> One endpoint in front of 4,500+ models. Alphe picks the cheapest model that
> still clears your quality bar, and cuts up to 70% of your inference bill.

Alphe AI is an OpenAI-compatible API gateway that chooses the model for every
request instead of leaving it pinned in your code. Drop-in endpoint, no
rewrites, live in under five minutes. It routes across OpenAI, Anthropic,
Google DeepMind, Meta, Mistral, Cohere, DeepSeek, xAI, Groq, Together,
Fireworks, Perplexity, AWS Bedrock and Azure OpenAI.

- Canonical URL: <https://alpheai.com/>
- HTML version of this page: <https://alpheai.com/>
- Contact: hello@alpheai.com
- Status: pre-launch, private early access, as of August 2026

## Every way to answer this. One of them gets sent.

Which model, which tool, whether one of your own agents already does the job:
a space of answers, not a single choice. Alphe scores the whole space first and
calls the cheapest route that still clears your bar. The other routes are what
you would have paid for.

Worked example — *"Read the last 40 support tickets, group them by theme, and
open a Linear issue for each theme."* Scored against 4,500+ models, 7,000+
tools, and every agent and workflow you have registered:

| Route | Price | Verdict |
| --- | --- | --- |
| Claude Opus 5 (max) + `linear·create_issue` | $0.94 | Clears the bar. Seventy-eight times the price of one that also clears it. |
| GPT-5.6 Sol (max) + `linear·create_issue` | $0.51 | Clears the bar, and still buying reasoning this job never asks for. |
| **Gemini 3.6 Flash + `linear·create_issue`** | **$0.012** | **Cheapest route that clears the bar on clustering and on tool calls. Sent.** |
| Step 3.7 Flash + `linear·create_issue` | $0.004 | Cheaper, and misses the bar. It splits one theme into four. |
| Your ticket-triage agent | $0.03 | Already registered, already tags tickets. It cannot open issues. |

Scoring takes 9 ms. Nothing above has been called yet, so nothing above has
been billed.

## Watch one call find its model.

A real request, scored and priced in the open. Every number below is one the
router had to produce before it was allowed to send anything.

### alphe_classify

Query: `tag 12,000 tickets by intent` — 5 signals scored.

- `TASK_CLASS` — bulk classification, fixed label set
- `REASONING_DEPTH` — shallow: single pass, no chain
- `CONTEXT_LENGTH` — 1.2k tokens median, 4.1k p99
- Plan: score, price, send cheapest pass
- Holds: strict JSON · eu-west-1 only

### alphe_candidates

Quality bar 0.92, 39 models priced. `claude-haiku-4.5` at $0.80/M is picked;
`gpt-4o-mini` at $0.60/M scores 0.89 and falls under the bar.

### alphe_dispatch

`POST /v1/chat/completions` — 1,284 tokens, $0.0009, `200 OK` in 940 ms.

### route_policy

Quality bar 0.92 · fallback `gpt-4o` · region `eu-west-1`.

## Five things happen between your call and the answer.

### 01 · Ingest

Change the base URL. Nothing else. Alphe speaks the OpenAI, Anthropic and raw
HTTP shapes, so existing SDKs, agent frameworks and eval harnesses keep working.

```ts
const client = new OpenAI({
  baseURL: "https://api.alpheai.com/v1",
  apiKey: process.env.ALPHE_KEY,
});
```

- One line of config, no SDK swap, no rewrite
- OpenAI, Anthropic and raw HTTP on the same endpoint
- Under 8 ms of gateway overhead on the path

### 02 · Classify

A small resident classifier reads the request before anything expensive sees it:
task type, reasoning depth, context length, tool surface, output contract.

- Five signals scored on-path, about 4 ms added
- Resident, so classifying costs no extra provider call
- That score is the input to every decision after it

### 03 · Route

Every candidate model is priced against the live token cost, its measured
quality on that task class, and its current latency. The cheapest one that
clears your bar wins.

- 4,500+ candidates, repriced as providers move
- The quality bar is yours, set per endpoint
- Decision made in under 2 ms

### 04 · Verify

Outputs are scored against your rubric, not assumed correct. A response that
misses is escalated to a stronger model automatically and the routing table
learns from it.

- Rubrics per endpoint, not one global score
- Automatic escalation on a miss, same request id
- The table learns, so that class does not miss twice

### 05 · Return

The answer comes back with the semantic cache warmed, the trace written, and
cost attributed to a team, a feature and a customer. You can answer "what did
this feature cost last week" without instrumenting anything.

- Semantic cache absorbs 30–50% of repeat traffic
- Every call traced, with nothing to instrument
- Cost attributed by team, feature and customer

## One call, and all of it is already in range.

Models are the part everyone talks about. Alphe routes across agents, tools and
workflows on the same call, weighs what each candidate costs and how fast it
answers, then sends the request to whichever one clears your bar for the least
money.

- Routed over: models, agents, tools, workflows
- Weighed on: cost, latency, quality, context, fallbacks, region
- Task classes: chat, reasoning, search, extraction, embeddings, speech, code,
  vision

None of it is a separate integration to wire up. One endpoint, one key, and the
decision made per request.

## Watch Alphe actually do the work.

Four replays. One prompt each, several tools, more than one model, a receipt at
the end.

### Read 74 vendor contracts, flag the odd terms

Drive → two models → Notion register. 71 of 74 documents go to
`gemini-2.5-flash`; 3 with ambiguous indemnity escalate to `claude-sonnet-4.5`;
12 clauses are appended to a Notion contract-risk register.
**Receipt: $1.14 · 3 m 12 s · $47.60 if every page had gone to one frontier
model.**

### Post Monday's spend digest to #eng

Warehouse query → summary → Slack. Forty-one rows to summarise and nothing to
reason about, so it stays on `gpt-4o-mini`.
**Receipt: $0.0004 · 1.9 s · on a schedule, so nobody has to remember.**

### Migrate the monorepo off SDK v2

38 packages → two models → 38 pull requests. Mechanical rewrites go to
`qwen3-coder` at $0.30/M; four packages touching the auth surface are worth
`claude-opus-5`. Two suites fail on the same fixture, both re-route to Opus and
go green.
**Receipt: $18.90 · 24 m · $214 all-frontier. Same diff, same tests.**

### Answer docs questions under 400 ms

Search → `claude-haiku-4.5`, escalating the hard 6% to `claude-sonnet-4.5`.
Latency is the constraint here, not depth.
**Receipt: $0.0021 median · 210 ms p50 · 380 ms p95.**

## Every workload, every key, every budget, at once.

One request rarely means one kind of work. Alphe splits it: the images and video
one way, the documents another, the code a third. Each part is charged to the
workspace and provider account that owns it, before it picks a model.

## Stay on the best model.

Your tools, agents and workflows are connected to Alphe, not to a model. When
something new wins at code review or long-context extraction, switch. The whole
stack comes with it.

- Keys, scopes and budgets stay on Alphe, so there is nothing to re-wire per
  model.
- Every frontier and open model, your own agents, and whatever ships next month.
- Pilot a new model on 5% of traffic, then roll it out. Same tools, no
  migration.

## Half a point costs 108× more.

One task set, one grader, five ways of answering it. Alphe routes a task for
$0.0077 and scores 9 out of 10. The two frontier models score 9.5 — half a point
more, for 92× and 108× the bill. Going cheap instead of routing costs 7.5× to 9×
what routing costs and gives up 5 to 7 points doing it.

Accuracy points returned per dollar spent:

| Answer | Accuracy per dollar |
| --- | --- |
| Alphe | 1,169 |
| Grok (SpaceXAI) | 69 |
| Gemini (Google) | 29 |
| GPT-5.6 Sol (OpenAI) | 13 |
| Claude Opus 5 (Anthropic) | 11 |

Alphe's own measurement — one task set, one grader, five ways of answering it.
Accuracy is a 0–10 grade; cost is the whole bill for a task, provider tokens
included.

## No model wins every column.

Independent measurements from Artificial Analysis, one harness across every
model. Change what you sort by and the ranking comes apart: the model at the top
of the quality index costs 78× the cheapest column here and writes at a seventh
of the fastest one's speed. Routing is what you do about that.

Artificial Analysis Intelligence Index — agentic tasks, coding, general
capability and scientific reasoning, weighted equally:

| Model | Index |
| --- | --- |
| Claude Opus 5 (max), Anthropic | 61 |
| Qwen3.8 Max, Alibaba | 56 |
| Grok 4.5 (high), SpaceXAI | 54 |
| GPT-5.6 Luna (max), OpenAI | 51 |
| Muse Spark 1.1 (xhigh), Meta | 51 |
| Gemini 3.6 Flash, Google | 50 |
| DeepSeek V4 Flash (max), DeepSeek | 50 |
| Step 3.7 Flash, StepFun | 30 |

Source: [Artificial Analysis](https://artificialanalysis.ai/), Intelligence
Index v3.0. Snapshot 6 August 2026, 8 families off a 264-row board. Their
measurement, not Alphe's.

## Two points cost 65× more.

One question, five answers, one grader. Six weeks of a running flood, asked from
the first breach to the day of the run, and every clause of it wants a different
source. Alphe routes it for $0.0074 and grades 6.5 for accuracy and 7.5 for how
it reads. The sharpest answer is two points better on accuracy at 65× the bill;
the best-written one is a point and a half better at 95×. The fastest answer
lands in 18 seconds and scores 3 out of 10 for being worth reading.

| Answer | Accuracy per dollar |
| --- | --- |
| Alphe | 878 |
| Grok 4.20 | 130 |
| Gemini 3.1 Pro Preview | 100 |
| GPT-5.6 Sol | 18 |
| Claude Opus 5 | 11 |

## Everyone else owns one column.

A gateway gives you every model behind one key but no opinion about which one to
call. A framework gives you agents and workflows but leaves the model, the tool
and the bill to you. Going direct gives you neither. Alphe is the decision layer
over all four, and the price of the answer is part of the decision.

| Capability | Alphe | Model gateways (OpenRouter, Together) | Agent frameworks (LangChain, CrewAI) | Direct to provider (OpenAI, Anthropic) |
| --- | --- | --- | --- | --- |
| Route across models — pick the model per call, not per project | Yes | Yes | Partly, or by hand | No |
| Route across agents — hand the job to the agent that handles it | Yes | No | Yes | No |
| Route across tools — one catalogue, called on your behalf | Yes | No | Partly, or by hand | No |
| Route across workflows — multi-step runs picked the same way | Yes | No | Yes | No |
| Picks the tool for the job — selection, not a list you maintain | Yes | No | No | No |
| Price is part of the decision — cheapest route that still clears the bar | Yes | Partly, or by hand | No | No |
| Fails over mid-request — a provider going down is not your outage | Yes | Partly, or by hand | No | No |
| One key for every provider — no per-vendor accounts to keep alive | Yes | Yes | No | No |
| Drops into code you already wrote — same request shape, one base URL changed | Yes | Yes | No | Yes |

Marks describe the category, not any one product in it. The named examples are
there to say which category is meant.

## Put your own number in.

The savings are not a discount. They are the difference between what you paid
and what the request was worth. Three compounding levers:

- **Routing** — 75–85% reduction on the traffic that gets routed down
- **Semantic cache** — 30–50% on repetitive workloads
- **Context compression** — 20–40% fewer input tokens at equal output quality

At $24K a month of current inference spend, the calculator on the page reads
$7K/mo with Alphe and $205K saved per year — a 70% reduction measured against
your current provider mix.

## Four and a half thousand of them, behind one contract.

Models are benchmarked and added to the routing table as they ship, behind the
same key, the same bill and the same rate limit. You deploy nothing.

Providers on the table include OpenAI, Anthropic, Google Gemini, Meta Llama,
Mistral AI, Cohere, DeepSeek, xAI Grok, Alibaba Qwen, Microsoft Phi, Amazon
Bedrock, Google Gemma, AI21 Labs, Databricks, Perplexity, NVIDIA, IBM Granite,
Stability AI, Moonshot Kimi, Zhipu GLM, MiniMax, 01.AI Yi, Baichuan, Hugging
Face, Voyage AI, Groq, Together AI, Fireworks AI, Cerebras and Ollama — plus
4,500 models on the same routing table.

## Each request gets the three it needs.

Handing a model the whole catalogue is how it picks the wrong thing. Alphe ranks
7,000+ integrations against the request, passes on the shortlist, and runs the
calls in order — the same selection it does for models, one layer down.
Integrations include Gmail, Slack, GitHub, Stripe, Notion, HubSpot, Zoom,
Twilio, Linear, Google Drive, Salesforce, Sentry, Figma, Datadog, Jira, Google
Sheets, Discord, PostgreSQL, Zendesk, Asana, Shopify, Snowflake, Intercom,
Okta, Airtable, MongoDB, GitLab, Supabase, Confluence, Elasticsearch, Vercel and
Zapier.

## A gateway sees everything. Here is what ours does with it.

1. **Zero retention by default.** Prompts and completions are held only as long
   as the request is in flight. Nothing is written to durable storage unless you
   switch on tracing for a specific endpoint, and retention is set per endpoint
   rather than per account.
2. **SOC 2 Type II and AES-256.** Encrypted in transit and at rest. Access to
   production is broken-glass only, logged, and expires automatically. The full
   report is available under NDA.
3. **PII redaction on the path, not after.** Detection and redaction run before
   a request leaves our edge, so a provider never receives the raw value.
   Detected entities are replaced with stable tokens and rehydrated on the way
   back, which keeps the model output usable.
4. **Regional routing and data residency.** Pin a tenant to a region and Alphe
   will only consider models served from it, even when a cheaper candidate
   exists elsewhere. Residency is a routing constraint, not a policy document.
5. **Prompt injection screening.** Retrieved documents and tool output are
   treated as untrusted input. Instructions found inside them are flagged and
   stripped of authority before the model sees them, and the decision is written
   to the trace.
6. **Your keys, or ours.** Bring your own provider keys and Alphe routes through
   them, so your existing commitments, discounts and rate limits still apply. Or
   use ours and get a single invoice. Both can run side by side per tenant.

## Stop paying frontier prices for classification work.

Early access is open. Point one endpoint at Alphe, keep your code, and read the
difference off your own invoice. Sign up at <https://alpheai.com/contact/> or
email hello@alpheai.com.

## Pages

- [Platform](https://alpheai.com/platform/) — the five stages and what each one
  costs in latency. Markdown: `/platform/index.md`
- [Pricing](https://alpheai.com/pricing/) — both plans, the calculator, and six
  answers about how billing works. Markdown: `/pricing/index.md`
- [Docs](https://alpheai.com/docs/) — how to call Alphe, the routing contract,
  limits, and the FAQ. Markdown: `/docs/index.md`
- [About](https://alpheai.com/about/) — why the company exists, six principles,
  two founders. Markdown: `/about/index.md`
- [Contact](https://alpheai.com/contact/) — shadow-mode signup and the first four
  steps. Markdown: `/contact/index.md`
- [Agent instructions](https://alpheai.com/agents.md) — when to use Alphe and
  how an agent should call it.
- [llms.txt](https://alpheai.com/llms.txt) · [llms-full.txt](https://alpheai.com/llms-full.txt)
