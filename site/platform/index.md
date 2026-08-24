# Routing is a decision, not a config file.

> Most gateways move bytes and hand you a dashboard. Alphe reads the request,
> prices the options, picks one, checks the answer, and writes down why, on
> every call, in under ten milliseconds of added latency.

- Canonical URL: <https://alpheai.com/platform/>
- Part of: [Alphe AI](https://alpheai.com/)

## 01 · Classification — every request is scored before it is spent

A small resident classifier reads task type, required reasoning depth, context
length, tool surface and output contract. This is the only place Alphe adds
meaningful latency, and it is the reason every downstream decision is cheap.

- Runs on-path, in-region, on the same hop as the proxy
- ~4 ms added, below the noise floor of any provider call
- Scores are attached to the trace, so a bad route is explainable after the fact

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

## 02 · Routing — the cheapest model that clears your bar

Not the cheapest model. The cheapest one that still passes. You set the bar per
endpoint. A support summariser and a contract analyser should not share a
quality threshold, and on Alphe they do not.

- Live token pricing per provider, refreshed continuously
- Measured quality per task class, not a single leaderboard number
- Latency-aware: a degrading endpoint loses traffic before it starts timing out
- Deterministic mode when you need the same model every time for reproducibility

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

## 03 · Verification — cheap answers are checked, not assumed

A router that only optimises cost eventually ships a wrong answer to save four
cents. Alphe scores outputs against your rubric and escalates the misses to a
stronger model automatically, and the routing table learns, so the same class of
request does not miss twice.

- Rubrics defined per endpoint, in plain language or as a schema
- Escalation is automatic and logged, not a manual retry in your code
- Quality regressions raise an alert before they reach a customer

```text
# verify.log
14:02:11  pass  llama-3.3-70b     0.94  $0.0002
14:02:11  pass  llama-3.3-70b     0.91  $0.0002
14:02:12  miss  llama-3.3-70b     0.71  $0.0002
14:02:12  esc   claude-sonnet-4   0.96  $0.0038
14:02:13  pass  llama-3.3-70b     0.93  $0.0002
14:02:13  learn bar +0.03 for class:legal-cite
```

## 04 · Caching — stop paying twice for the same question

Exact-match caching catches almost nothing in production. Real users never
phrase it identically. Semantic caching matches on meaning above a threshold you
control, and on repetitive workloads it removes 30–50% of billable calls
outright.

- Per-endpoint similarity threshold, so precision-critical paths can opt out
- Tenant-scoped by default: one customer's answer never serves another's
- Prompt compression trims context that never influenced the answer

```text
# cache.stats — rolling 24h, one production tenant
requests        1,412,908
semantic_hits     482,004  (34.1%)
exact_hits         61,220  (4.3%)
tokens_avoided       2.9B
usd_avoided        18,441
```

## 05 · Observability — cost attributed to a feature, not a bill

"Inference: $41,208" is not an answer. Alphe attributes every call to a team, a
feature and a customer as a property of the request path, so unit economics
exist without anyone instrumenting them later.

- Per-request cost, latency, model, decision and escalation in one trace
- Budgets and alerts at team level, enforced at the gateway
- OpenTelemetry export into whatever you already run

```text
# spend.by-feature
onboarding-agent  $4,120
support-summary   $2,884
search-rerank     $1,902
doc-extraction      $744
internal-evals      $318
```

## Compatibility — it has to fit what you already built.

### SDKs — your client, unchanged

OpenAI and Anthropic SDKs work by changing the base URL. Streaming, tool calls,
structured output and vision all pass through.

### Frameworks

Anything that accepts a custom base URL is already compatible — LangChain,
LlamaIndex, the Vercel AI SDK. No adapter, no fork, no wrapper package to keep
in sync.

### Keys — bring your own, or use ours

Route through your existing provider contracts to keep your committed-spend
discounts, or take a single Alphe invoice. Both, per tenant, is fine.

### Deployment — cloud, VPC or self-hosted

The proxy is a single binary. Run it in your own VPC when prompts cannot leave
your network and keep the control plane hosted.

### Failover — provider outages stop being your outage

When a provider degrades, traffic moves to the next candidate that clears the
bar. Your error rate does not move with theirs.

### Migration — shadow mode first

Mirror production traffic, compare Alphe's choice against your current model,
and read the delta before a single user request changes path.

## Run it in shadow mode for a week.

No path change, no risk. Mirror your traffic and read what routing would have
cost. Sign up at <https://alpheai.com/contact/>.

## Related pages

- [Home](https://alpheai.com/) · `/index.md`
- [Docs](https://alpheai.com/docs/) · `/docs/index.md`
- [Pricing](https://alpheai.com/pricing/) · `/pricing/index.md`
