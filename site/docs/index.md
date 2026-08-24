# One base URL, and the rest is your code.

> Alphe speaks the OpenAI wire format, so there is no SDK to install and no
> request shape to learn. This page is what an engineer — or an agent reading on
> their behalf — needs to integrate, operate and bill for the decision layer.

- Canonical URL: <https://alpheai.com/docs/>
- Part of: [Alphe AI](https://alpheai.com/)
- Agent instructions: <https://alpheai.com/agents.md>
- Status: private early access, August 2026. Figures below are measured on the
  current build and are not a published SLA.

## Quickstart — change the base URL, send `auto`

The client you already have, pointed somewhere else. Everything the SDK sends —
messages, temperature, tools, response format, images — is forwarded to whichever
model Alphe picks, and the response comes back in the shape your code already
parses.

- `baseURL` is the only line that changes
- `model: "auto"` hands the choice to the router
- Streaming, tool calls, structured output and vision pass through
- Read the key from the environment, never from source

```ts
// route.ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.alpheai.com/v1", // the only change
  apiKey: process.env.ALPHE_KEY,
});

const res = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: input }],
});
```

The Python SDK takes the same base URL. So does curl, so does the Anthropic SDK,
and so does every framework that lets you name your own endpoint. There is no
Alphe package on npm or PyPI to keep in sync with your dependency tree, because
there does not need to be one.

```bash
# python
client = OpenAI(
    base_url="https://api.alpheai.com/v1",
    api_key=os.environ["ALPHE_KEY"],
)

# curl
curl https://api.alpheai.com/v1/chat/completions \
  -H "Authorization: Bearer $ALPHE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}'
```

## The request — what `auto` means, and when not to use it

### `model: "auto"` — let the router decide

The default for anything where the right model differs per request. Alphe
classifies the call and sends it to the cheapest model that still clears the
quality bar set for that endpoint.

### `model: "<a name>"` — pin it, per endpoint

Name a model instead and Alphe sends the call there. Some paths need
reproducibility more than they need savings. Pinned endpoints still get caching,
failover, attribution and PII redaction.

### Policy is per endpoint

A support summariser and a contract analyser should not share a quality
threshold, a latency budget or a fallback list, and here they do not.

### Your parameters survive

Temperature, max tokens, stop sequences, tool definitions, JSON schemas and
images are forwarded to the chosen model. Alphe decides where the request goes,
not what is in it.

### Streaming

A streamed response streams. The routing decision is made before the first
token, so nothing buffers waiting for the router to make up its mind.

### Attribution is a request property

Tag a call with the team, feature and customer it belongs to and the cost
follows it into the trace, the budget and the invoice. Unit economics exist
without anyone instrumenting them later.

## Request lifecycle — five stages between your call and your answer

### 01 · Ingest

Your request lands on the proxy in the region you deploy it in. Nothing is
rewritten; the body you sent is the body the model receives, minus any field you
asked Alphe to redact.

### 02 · Classify

A small resident classifier reads task type, required reasoning depth, context
length, tool surface and output contract. It adds about 4 ms, on the same hop as
the proxy, and every downstream decision is cheap because of it.

### 03 · Route

Not the cheapest model — the cheapest one that still passes, priced against live
per-provider token rates and measured quality per task class, with a degrading
endpoint losing traffic before it starts timing out.

### 04 · Verify

The output is scored against your rubric. A miss escalates to a stronger model
automatically and the escalation is logged, so a router optimising for cost
cannot quietly ship a wrong answer to save four cents.

### 05 · Return

You get the response in the shape your SDK expects, and the trace gets the
reasoning: what was chosen, what was rejected, why, and what it saved against
your previous pin.

Classification and routing together stay under 8 ms of gateway overhead.
Provider latency dominates every call; the decision does not move the number
your users feel.

## Quality bars — you set the threshold, the router lives inside it

A quality bar is a number per endpoint between 0 and 1. It is the floor a model
has to clear on that class of request before it is allowed to answer it. Raise
it and routing gets more conservative and more expensive; lower it and more
traffic lands on small models. The bar is the only knob most teams ever touch.

- Rubrics are written per endpoint, in plain language or as a schema
- Escalation on a miss is automatic and logged, not a manual retry in your code
- The routing table learns, so a class of request does not miss twice
- A quality regression raises an alert before it reaches a customer
- Latency and region are part of the same policy, not a separate config

```yaml
# policy.yaml
endpoint: support-summary
quality_bar: 0.88
max_latency_ms: 1800
region: eu-west
fallback:
  - claude-haiku-4.5
  - gpt-4o-mini
cache:
  semantic: true
  threshold: 0.94
```

## Decisions — every route is explainable after the fact

The decision record is the part of Alphe you will read most often. It says what
the classifier thought the request was, which bar applied, which model won,
which models lost, the one-line reason, and the money the choice saved against
the model you used to pin. It is attached to the trace, so an argument about a
bad answer is a lookup rather than a reconstruction.

- Per-request cost, latency, model, decision and escalation in one trace
- Budgets and alerts at team level, enforced at the gateway
- OpenTelemetry export into whatever you already run

```json
// decision.json
{
  "task": "extraction",
  "reasoning_depth": 0.18,
  "context_tokens": 2841,
  "quality_bar": 0.92,
  "chosen": "llama-3.3-70b",
  "rejected": ["gpt-4o", "claude-sonnet-4"],
  "reason": "clears bar at 1/19th cost",
  "saved_usd": 0.0412
}
```

## Operations — caching, failover, and what happens without you

### Semantic cache

Exact-match caching catches almost nothing in production, because real users
never phrase it identically. Semantic caching matches on meaning above a
threshold you control and removes 30–50% of billable calls on repetitive
workloads. A cache hit is not billed.

### Cache isolation

One customer's cached answer never serves another's. Precision-critical
endpoints can set their own similarity threshold or opt out of the cache
entirely.

### Prompt compression

Compression trims the parts of a context window that did not influence the
answer, for 20–40% fewer input tokens on long-context workloads.

### Failover

When a provider degrades, traffic moves to the next candidate that clears the
bar, inside the request rather than after a timeout. Your error rate does not
move with theirs.

### Fallback — Alphe is not a single point of failure

The SDK falls back to your provider directly on a configurable timeout.
Self-hosted deployments serve traffic without reaching our control plane at all.

### Budgets

A team budget is a limit at the proxy, not a line on a dashboard read after the
money is gone. Alerts fire against the same numbers the invoice is built from.

## Deployment — three ways to run it, one of which changes nothing

### Shadow mode — measure before you move

Mirror a slice of production traffic to Alphe while your real requests keep
going where they go today. After a week you have a baseline and a delta: what
routing would have cost against what it did cost, and where routing was wrong.
Start there: <https://alpheai.com/contact/>.

### Hosted gateway — the base URL swap

Requests go to `api.alpheai.com` and Alphe holds the provider keys, or forwards
through yours. Nothing to deploy, nothing to operate, one invoice or none.

### Self-hosted — your VPC, your network

The proxy is a single binary. Run it inside your own network when prompts cannot
leave it, and keep the control plane hosted. Regional pinning and data-residency
guarantees are part of the custom plan.

## Limits and coverage

Alphe is pre-launch. These are measured figures for the current build, not a
published SLA, and the ones drawn from third parties say so.

- **Classification: ~4 ms.** Added on-path, in-region, below the noise floor of
  any provider call. The only place Alphe adds meaningful latency.
- **Gateway overhead: under 8 ms.** Classification, routing and verification
  bookkeeping together, before the provider call your users are waiting on.
- **Model catalogue: 4,500+ models.** One routing table across the frontier
  labs, the open-weight hosts and the specialist endpoints. No tier gating.
- **Tools: 7,000+ integrations.** Routing applies to tools, agents and
  workflows, not only to chat completions.
- **Savings: up to 70%,** from three levers measured separately — routing down
  on traffic that does not need a frontier model (75–85%), semantic cache hits
  (30–50%), prompt compression (20–40% fewer input tokens).
- **Leaderboard data is dated, and someone else's.** The model board on the home
  page is a snapshot of the public Artificial Analysis leaderboard captured
  6 August 2026 — their measurement, not ours. The accuracy-per-dollar boards
  are ours and are labelled as such.

## Security — what happens to the prompt

Alphe sits on the path between your application and a provider, which makes it
the one place worth being specific about. Prompts are used to classify, route,
verify and — if you turn it on — cache the request they belong to. They are not
training data for anyone, and a self-hosted deployment means they never leave
your network at all.

- PII redaction applies before a request is forwarded, pinned endpoints included
- Semantic cache entries are tenant-scoped; one customer's answer never serves
  another's
- Regional pinning and data-residency guarantees on the custom plan
- SSO, SCIM and audit logging on the custom plan
- Self-hosted proxy for networks where prompts cannot leave
- SOC 2 Type II is on the roadmap and not yet complete — ask for the current
  status rather than assuming it

## Billing mechanics — what counts as a request

- **$0.20 per 1,000 routed queries.** Metered, no seats, no minimum. Volume
  rates below that are part of a custom plan; see
  <https://alpheai.com/pricing/>.
- **Billable unit: one inbound call, classified and routed.** A cache hit is not
  billed. An automatic escalation to a stronger model counts as one request, not
  two — you should not pay us more for our own miss.
- **Provider costs pass through at cost,** on both plans. Bring your own
  provider keys and you are billed by the provider exactly as you are today, so
  committed-spend discounts keep applying and Alphe never touches that invoice.

## Status — what is not here yet

Alphe is in private early access as of August 2026. There is no self-serve
signup, so an API key comes from a conversation rather than a dashboard. There
is no endpoint-by-endpoint API reference either: the wire format is OpenAI's, so
your SDK already documents the request and response shapes, and a full reference
lands at general availability. SOC 2 Type II and the packaged self-hosted data
plane are roadmap, not shipped. Everything else on this page describes the build
that runs today. If a number here matters to a decision you are making, write to
<hello@alpheai.com> and ask what it is this week.

## Questions

### What do I actually change in my code?

The base URL and the API key. Point your OpenAI or Anthropic client at
`https://api.alpheai.com/v1`, send `model: "auto"`, and leave the rest of the
call exactly as it is. Streaming, tool calls, structured output and vision pass
through unchanged.

### How do I get an API key?

Keys are issued during early access; there is no self-serve signup yet. Ask at
<hello@alpheai.com> or through <https://alpheai.com/contact/>, and you get a key
and a shadow configuration back.

### Can I see why a request went where it went?

Yes. Every call carries a decision record — task class, reasoning depth, context
length, the quality bar it had to clear, the model chosen, the models rejected,
the reason, and the dollars saved against your previous pin. It is attached to
the trace, so a bad route is explainable after the fact rather than only at the
time.

### What happens when the cheap model gets it wrong?

The output is scored against the endpoint's rubric before it is returned. A miss
escalates to a stronger model automatically, under the same request id, and the
escalation is logged. The routing table learns from it, so the same class of
request does not miss twice. An escalation counts as one billable request, not
two.

### How much latency does Alphe add?

About 4 ms to classify and under 8 ms of gateway overhead in total, measured
on-path and in-region. These are indicative figures for a pre-launch product,
not a published SLA.

### Can prompts stay inside our network?

Yes. The proxy is a single binary and runs self-hosted or in your own VPC, with
the control plane hosted. Regional pinning and data-residency guarantees are
part of the custom plan: <https://alpheai.com/pricing/>.

### What if Alphe itself is unavailable?

The SDK falls back to your provider directly on a configurable timeout, so the
gateway cannot become a single point of failure for your product. Self-hosted
deployments serve traffic without depending on our control plane.

### Is there a full API reference?

Not yet. Alphe is OpenAI wire-compatible, so the request and response shapes are
the ones your SDK already implements. A complete endpoint-by-endpoint reference
lands at general availability; until then this page,
<https://alpheai.com/agents.md> and <hello@alpheai.com> are the documentation.

## For agents — this site is readable as Markdown

Every page here answers `Accept: text/markdown` with Markdown at the same URL,
sets `Vary: Accept`, honours q-values and returns `406` for an Accept it cannot
satisfy. Append `index.md` to any path to get the same file directly.

- [/agents.md](https://alpheai.com/agents.md) — when to use Alphe, when not to,
  and how to call it
- [/llms.txt](https://alpheai.com/llms.txt) — the site in one file, with links
- [/llms-full.txt](https://alpheai.com/llms-full.txt) — the full text of every page
- [/sitemap.xml](https://alpheai.com/sitemap.xml) — every indexable URL

## Get a key and a shadow endpoint.

Ten minutes of work on your side, and nothing about your production request path
changes. Sign up at <https://alpheai.com/contact/>.

## Related pages

- [Home](https://alpheai.com/) · `/index.md`
- [Platform](https://alpheai.com/platform/) · `/platform/index.md`
- [Pricing](https://alpheai.com/pricing/) · `/pricing/index.md`
- [Contact](https://alpheai.com/contact/) · `/contact/index.md`
