# You should pay us less than we save you.

> Provider costs stay yours, routed through your keys or ours, at the same
> rates. Alphe charges for the decision layer, and the decision layer is only
> worth what it removes from your bill.

- Canonical URL: <https://alpheai.com/pricing/>
- Early-access pricing. Provider token costs are passed through at cost on both
  plans.

## Pay as you go — $0.20 per 1,000 routed queries

One rate, metered per query. No seats, no minimum, nothing to commit to before
you know what routing is worth to you.

- Full model catalogue, no tier gating
- Per-endpoint quality bars and rubrics
- Automatic escalation and failover
- Semantic cache and prompt compression
- Cost attribution by team, feature and customer
- Budgets and alerts enforced at the gateway
- Traces and OpenTelemetry export

## Custom — talk to us

A share of what you save, or a flat annual fee, whichever you would rather
defend to finance.

- Everything in pay as you go
- Volume rate below $0.20 / 1K
- Self-hosted proxy in your VPC
- Regional pinning and data residency guarantees
- SSO, SCIM and audit logging
- Custom rubrics and private model endpoints
- SLA, DPA and security review
- Named engineer, shared roadmap

## The only number that matters is the delta.

Move the slider on the page to your current spend. What Alphe costs is a
fraction of the line above it.

A team at $40K a month typically routes around 8 million requests. At $0.20 per
1,000 that is $1,600 in platform fees against roughly $28,000 in avoided
provider spend, and the rate comes down on a custom plan.

Three compounding levers:

- **Routing** — 75–85% reduction on traffic that routes down a tier
- **Semantic cache** — 30–50% on repetitive workloads
- **Context compression** — 20–40% fewer input tokens at equal output quality

At $45K/mo of current spend the calculator reads $13K/mo with Alphe and $376K
saved per year — a 70% reduction, measured against your current provider mix.

## Questions — the ones that come up on every call.

### Do I pay provider costs twice?

No. Token costs pass through at cost. If you bring your own provider keys, you
are billed by the provider exactly as you are today and Alphe never touches that
invoice, so your committed-spend discounts keep applying.

### What counts as a routed request?

One inbound call that Alphe classifies and routes. A cache hit is not billed. An
automatic escalation to a stronger model counts as one request, not two. You
should not pay us more for our own miss.

### How does share-of-savings work?

We measure your baseline in shadow mode for two weeks, agree it in writing, then
bill a percentage of the measured reduction against that baseline. If routing
saves nothing, the invoice is zero.

### What happens if Alphe is down?

The SDK falls back to your provider directly on a configurable timeout, so the
gateway cannot become a single point of failure for your product. Self-hosted
deployments run entirely inside your network and do not depend on our control
plane to serve traffic.

### Can I pin a model and skip routing?

Yes, per endpoint. Some paths need reproducibility more than they need savings.
Pinned endpoints still get caching, failover, attribution and PII redaction.

### Is there a startup discount?

Build covers most pre-seed and seed usage outright. If you have outgrown it and
the bill is the reason you are reading this page, tell us where you are and we
will make it work.

## Find out what you would have saved last month.

Early access is open: <https://alpheai.com/contact/>, or email
hello@alpheai.com.

## Related pages

- [Home](https://alpheai.com/) · `/index.md`
- [Platform](https://alpheai.com/platform/) · `/platform/index.md`
- [Docs](https://alpheai.com/docs/) · `/docs/index.md`
