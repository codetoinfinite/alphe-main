# We got tired of writing the same routing hack.

> Across a hundred-odd agents, MCP servers and hackathon builds, the same file
> kept reappearing: a switch statement guessing which model was cheap enough for
> this particular call. Alphe is that file, taken seriously.

- Canonical URL: <https://alpheai.com/about/>
- Alphe AI · built in India · pre-launch, private early access as of August 2026
- Contact: hello@alpheai.com

## Why the company exists

Every team building on models arrives at the same three realisations, in the
same order.

First: the frontier model is astonishing and you should use it for everything.
Second: the bill arrives and most of that spend went on classification,
extraction and formatting — work a model a twentieth of the price does
identically well. Third: you start hand-routing, and discover that maintaining a
model-selection policy by hand is a full-time job that gets stale every three
weeks.

The third realisation is where teams stop. Not because the problem is hard to
understand, but because solving it properly means pricing every candidate model
on every request, measuring whether the cheap answer was actually good enough,
and re-benchmarking a catalogue that grows by a hundred models a month. Nobody
has that time. So the pinned model stays pinned, and the bill keeps growing.

Alphe exists so that nobody has to make that decision by hand again. One
endpoint, the cheapest model that clears your bar, and a written record of why,
on every single call.

## Six positions we are not going to move on.

### 01 · Cheap without quality is not savings

A router that only minimises cost will eventually ship a wrong answer to save
four cents. Verification is not a feature we added; it is the reason the routing
is trustworthy at all.

### 02 · The bar is yours

We will not tell you what "good enough" means for your product. You define it
per endpoint, and we optimise underneath it. Any vendor that sets the quality
threshold for you is optimising their margin.

### 03 · Every decision must be explainable

If you cannot see why a request went to a particular model and what it cost, you
have not removed the black box. You have added one. Every route is logged with
its reasoning and its rejected alternatives.

### 04 · Never a lock-in

Bring your own keys, self-host the proxy, export every trace. If leaving Alphe
is hard, we have stopped competing on the product and started competing on your
switching cost.

### 05 · Latency is part of correctness

A cheaper answer that arrives after the user gave up is not cheaper. The router
treats a degrading endpoint as a failing one, and moves before the timeouts
start.

### 06 · Small team, direct line

There are two of us. You will talk to the people who wrote the router, and the
thing you asked for will either ship or get an honest no.

## Two founders, shipping.

### Ankit Kumar Verma — Founder

Final-year B.Tech CSE. Built and deployed more than a hundred agents, MCP
servers and developer tools, won or placed in ten-plus hackathons, and ran
outreach for GDG on Campus. Owns classification, routing policy and the model
catalogue.

### Anant Gupta — Co-founder

Final-year B.Tech CSE. Scalable microservices and distributed systems,
thirty-plus full-stack applications delivered, GDG on Campus Cloud Lead in 2024.
Owns the data plane, caching and everything that has to stay up while the rest
changes.

## Honest about the stage.

### 2024 — The switch statement

Model selection hand-written into project after project. Same logic, same
staleness, never once reusable.

### Early 2025 — First real router

A classifier in front of four models, measured on our own workloads. It cut
spend by roughly seventy per cent, and the quality complaints we expected never
arrived.

### Late 2025 — Verification and caching

Escalation on quality misses, then semantic caching. Together they turned a
clever trick into something we were willing to put in front of someone else's
traffic.

### Now — Private early access

Working with a small number of teams, running shadow mode first, measuring the
delta before any traffic changes path. If you want to be one of them, say so.

### Next — Self-hosted data plane and SOC 2

The VPC deployment and the audit are the two things standing between us and the
teams whose prompts are not allowed to leave their network.

## Come and break it early.

Early access is small on purpose. Fewer teams, faster fixes, direct line to both
of us: <https://alpheai.com/contact/>.

## Related pages

- [Home](https://alpheai.com/) · `/index.md`
- [Platform](https://alpheai.com/platform/) · `/platform/index.md`
- [Docs](https://alpheai.com/docs/) · `/docs/index.md`
- [Contact](https://alpheai.com/contact/) · `/contact/index.md`
