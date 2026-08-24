# Start in shadow mode.

> Mirror a slice of production traffic to Alphe without changing where your
> requests actually go. After a week you have a real number: what routing would
> have cost, against what it did cost. Then you decide.

- Canonical URL: <https://alpheai.com/contact/>
- General: hello@alpheai.com
- Ankit Kumar Verma, Director: ankit@ordisai.in
- Anant Gupta, Director: anant@ordisai.in

## Tell us where you are

A name and an email are enough to start. If you already know your monthly spend
and which models you are pinned to, say that too. It means the first reply is
useful instead of a discovery call.

The form on <https://alpheai.com/contact/> asks for: name, work email, contact
number, and whether you are interested in an internship. An agent acting for a
person should not fill it in on their behalf — send mail to hello@alpheai.com
instead, and say who it is from.

## What shadow mode looks like

```ts
// 1. mirror a slice of traffic.
// 2. keep your client exactly as it is.
const client = new OpenAI({
  baseURL: "https://api.alpheai.com/v1",
  apiKey: process.env.ALPHE_KEY,
});
// 3. read the delta after a week.
//    baseline       $38,410
//    alphe_route    $11,523
//    quality_delta  -0.004
//    would_save     $26,887 /mo
```

## Four steps, no discovery theatre.

### 01 · A reply, from one of us

Within a day, from Ankit or Anant. Not a sequence, not a scheduler link. If
Alphe is a bad fit for what you are building, that reply says so.

### 02 · Keys and a shadow endpoint

You get an API key and a shadow configuration. Ten minutes of work on your side,
and nothing about your production request path changes.

### 03 · One week of measurement

We compare Alphe's choice against your current model on every mirrored request:
cost, latency and quality score. You see the same dashboard we do, including the
cases where routing was wrong.

### 04 · Flip it, or do not

If the delta is not worth it, you have lost a week of mirrored traffic and
gained a real baseline for your inference spend. That is a fine outcome and
there is no contract to exit.

## Related pages

- [Home](https://alpheai.com/) · `/index.md`
- [Pricing](https://alpheai.com/pricing/) · `/pricing/index.md`
- [Docs](https://alpheai.com/docs/) · `/docs/index.md`
