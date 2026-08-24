# Alphe — website

Marketing site for **Alphe**, the decision layer for AI infrastructure: one endpoint in front of
4,500+ models, routing every call to the cheapest model that still clears your quality bar.

Static HTML, CSS and ES modules. No build step, no framework, no bundler. What is in `site/` is
exactly what gets served.

---

## Running it

```bash
node serve.mjs          # http://localhost:4322
PORT=8080 node serve.mjs
```

Requires Node 18+. The dev server resolves directory requests to `index.html`, serves the site's own
`404.html` on a miss, and sends the same security headers production does — so a policy that would
break the page there breaks it locally first.

There is nothing to install to run the site. Dependencies exist only for the checks in `tools/`.

---

## Layout

```
site/                     everything that ships — this directory IS the web root
  .htaccess               Apache/LiteSpeed config: headers, caching, redirects, negotiation, 404
  index.html              home
  platform/  pricing/  docs/  about/  contact/
  404.html
  index.md  404.md  <route>/index.md   the Markdown twin of every page
  negotiate.php           serves the twin to anything sending Accept: text/markdown
  contact.php             the one endpoint every form posts to
  agents.md               instructions for agents: when to use Alphe, when not to, how to call it
  llms.txt  llms-full.txt the index and the whole site's text, for model context
  robots.txt  sitemap.xml
  .well-known/security.txt   RFC 9116 — where to report a vulnerability
  <32-hex>.txt            the IndexNow key, proving this host to Bing and Yandex
  assets/
    css/                  tokens → base → components → sections, in that order
    js/
      lib/                viewport, rAF loop, motion prefs, WebGL harness, RNG, shape sampling
      modules/            nav, reveals, grain, section behaviour, UI widgets
      data/               models.js, tools.js — the numbers and the catalogue
      scenes/             particle-field.js
    fonts/                Geist Sans + Geist Mono, self-hosted (OFL)
    vendor/               three.js 0.185.1, pinned
  media/                  logo, favicon, social card
tools/                    headless-Chrome checks (dev only, never deployed)
  bundle.mjs              packs site/ into dist/ for upload
  headers.mjs             the four copies of the security policy still agree
  agentic.mjs             negotiation, 404s, raw HTML and the machine-readable files
  llms-full.mjs           regenerates llms-full.txt, and --check fails when it is stale
  indexnow.mjs            submits the sitemap's URLs to Bing, Yandex, Seznam, Naver
serve.mjs                 static dev server
vercel.json               Vercel configuration
DEPLOY.md                 Hostinger runbook
CHANGELOG.md              what changed in each tagged release
dist/                     build output, gitignored — `node tools/bundle.mjs` recreates it
```

CSS is four files loaded in order, each a layer: `tokens.css` (custom properties), `base.css`
(elements and resets), `components.css` (reusable pieces), `sections.css` (page-specific
composition). Nothing is scoped by a build tool, so the order is the cascade.

---

## The particle field

Two WebGL layers, both drawn with three.js in an orthographic camera that maps 1:1 to CSS pixels,
origin centred, +y up. A CPU mirror of the same maths lands on the same pixel, which is what makes
pointer interaction against GPU-positioned points possible.

The scroll field is **a pure function of `scrollY`**. Each station declares the shape it wants and
where in the frame it sits — `x` and `y` are fractions of a 1440×900 reference frame, origin centred,
+y up:

```html
<section data-field-shape="routing"
         data-field-x="-0.338" data-field-y="-0.244"
         data-field-scale="0.35" data-field-avoid="fade"> … </section>
```

`logo`, `logomark`, `engine`, `cursor`, `routing`, `shield`, `rings` and `grid` are built in;
`text:SAVINGS` and `words:SCORE|PRICE|SEND` sample type instead. Stations are harvested in document
order, so moving a section in the markup moves it in the sequence.

Each shape gets one number — the scroll position at which it sits where it was composed — and the
field asks only "where am I between mark *i* and mark *i+1*". There are no timers, no triggers and
no memory, so scrolling up is the exact reverse of scrolling down and a given scroll position always
looks the same. Morphs take a fixed scroll *distance* rather than a fraction of the gap, so a short
section and a long one transition at the same speed.

Other behaviour worth knowing:

- **Placement** is computed against a 1440×900 reference frame and clamped, so shapes hold the same
  position relative to the content column from 1100px up to ultrawide.
- **Pointer repulsion** re-reads the canvas rect every frame. Two of the three canvases are
  positioned in the page rather than the viewport, so coordinates converted once at the event go
  stale by the whole scroll distance.
- **Type is never drawn over.** Elements marked `data-avoid` are sent to the shader as boxes: with
  `data-field-avoid="fade"` the cloud dims behind each one, with `"push"` they union into a single
  hole the points are displaced around. A word sliding under a card fades out rather than clipping.
- **Reduced motion** is a design state, not a switch: the ambient term pins to zero and the shapes
  are shown composed and still, rather than the effect being removed.
- Rendering is on demand — an `IntersectionObserver` parks the rAF loop when the canvas is off
  screen.

`data-particle-mode="attract"`, `data-particle-texts="…"` and `data-particle-cycle="off"` control the
per-canvas variants; see the header comment in `assets/js/scenes/particle-field.js`.

---

## What agents get

A browser is not the only client. Every route ships a hand-written Markdown twin next to its HTML —
`site/index.md`, `site/docs/index.md`, and so on — and a request that names Markdown gets the twin
instead of the page:

```bash
curl -sI https://alpheai.com/docs/ -H 'Accept: text/markdown'   # text/markdown; charset=utf-8
```

The rules are [acceptmarkdown.com](https://acceptmarkdown.com): Markdown only when it is named
exactly and its q-value is above zero and not below the HTML's, `Vary: Accept` on every negotiated
response so caches keep the two apart, and `406` when nothing on offer is acceptable. A browser's
`Accept` header, a wildcard, or no header at all all get HTML, unchanged. `.htaccess` routes the
request to `site/negotiate.php`, which does the parsing; `serve.mjs` reimplements the same rules so
localhost behaves like production, and `tools/agentic.mjs` runs the whole matrix against either.

Point that gate at the live domain as well as at localhost — `ALPHE_BASE=https://alpheai.com node
tools/agentic.mjs`. Two of these rules survive the origin and die at the edge or in LiteSpeed rather
than in this repo, and DEPLOY.md, *What the live host does that localhost does not*, is where they
are written down.

Alongside the twins:

- `agents.md` — what Alphe is, when to use it, when not to, and how to reach a human. Also served at
  `/AGENTS.md`, which is how the convention spells it, by a rewrite rather than a second copy.
- `llms.txt` — the index; `llms-full.txt` — every page's text in one file, generated by
  `node tools/llms-full.mjs`. `--check` fails when it no longer matches the pages, so it cannot rot
  silently.
- `404.html` and `404.md` — the 404 is a real 404 in both representations, and both list the routes.
- `.well-known/security.txt` — RFC 9116. It carries an `Expires` date, and `tools/agentic.mjs` fails
  once that date is inside the past or more than a year out, so it cannot rot unnoticed.

The pages themselves carry their content in the HTML, not in JavaScript: `tools/nojs.mjs` loads every
route with scripting disabled and fails on a route that loses its headline or its text.

---

## Deploying

There is nothing to build. `site/` is the web root, wherever it is served from.

**Hostinger** — the live target. LiteSpeed reading `site/.htaccess` out of `public_html`.
`node tools/bundle.mjs` packs `dist/alphe-public_html.zip` for the File Manager and
`dist/public_html/` for SFTP. Full runbook, including the domain and TLS steps: **[DEPLOY.md](DEPLOY.md)**.

**Vercel** — zero build. Import the repo and deploy; no environment variables, no settings to change.
`vercel.json` sets `framework: null` and no build command (the repo has no root `package.json`, so
nothing installs and nothing compiles), `outputDirectory: "site"`, and `trailingSlash: true` — every
internal link is written as `/platform/`, and `/platform` redirects to it. On Hostinger, mod_dir does
that redirect natively.

Vercel cannot run PHP, so it negotiates Markdown with routing rules instead of `negotiate.php`: a
`has` on `Accept` picks the twin, and a `missing` on the same header takes it back when the client
wrote `text/markdown;q=0`. Two things `negotiate.php` does are out of reach there, because
`has.value` is a Rust regex with no lookahead and no arithmetic — comparing the Markdown q-value
against the HTML one, and answering `406`. Hostinger is the live target and does both;
`tools/agentic.mjs` asserts the Vercel rules keep the q=0 refusal so the gap cannot widen unnoticed.

Both servers are configured to the same policy: CSP, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` and HSTS on every response including the 404; immutable
caching for the fonts and the pinned three.js; everything unhashed revalidates.

### One policy, four files

| file                 | server                              |
| -------------------- | ----------------------------------- |
| `site/.htaccess`     | Hostinger — LiteSpeed               |
| `vercel.json`        | Vercel                              |
| `serve.mjs`          | localhost                           |
| `site/negotiate.php` | every negotiated response, any host |

None of them reads the others, so all four carry a copy — the negotiator included, because it
answers on whichever host is in front of it and sets its own headers rather than trusting that one.
`node tools/headers.mjs` fails if they drift, which is the only reason it is safe to keep four — run
it before every deploy (`bundle.mjs` runs it for you).

The CSP is `default-src 'self'` with no external origins at all — every font, script and image is
served from the same host. `'unsafe-inline'` is present for `style-src` only, because the markup uses
inline `style` attributes for one-off layout. **If you add a third-party script, analytics tag or
embed, it will be blocked until you widen the policy in all four files.**

### Changing the domain

Absolute URLs appear in the canonical / Open Graph tags, `robots.txt` and `sitemap.xml`, currently
pointing at `https://alpheai.com` with no www. To move to another domain:

```bash
grep -rl 'https://alpheai.com' site/ | xargs sed -i '' 's|https://alpheai\.com|https://your-domain|g'
```

(drop the `''` after `-i` on GNU sed.)

---

## Checks

`tools/` holds headless-Chrome scripts used while building the site. They are development-only and
never deployed.

```bash
cd tools && npm install     # puppeteer-core, uses your installed Chrome
node serve.mjs              # in another shell, from the repo root

node tools/smoke.mjs        # page errors, canvas inventory, station list
node tools/continuity.mjs   # the field moves smoothly and is scroll-position-pure
node tools/fit.mjs 1440 1920 2560   # shapes stay in frame and beside the content column
node tools/mouse.mjs        # pointer repulsion tracks the cursor at every scroll position
node tools/strip.mjs 0 4000 6       # frames across a scroll range, for looking at
node tools/bench.mjs 1440    # the benchmarks board, at one width
node tools/og.mjs           # re-render media/og.png from tools/og-card.html
node tools/mobile.mjs 320   # walks each route in phone-sized steps and names what overflows
node tools/shots.mjs 320 / .bench__stage    # one element per file, after it has settled
```

The gates run before anything ships:

```bash
node tools/headers.mjs      # .htaccess, vercel.json, serve.mjs and negotiate.php agree
node tools/agentic.mjs      # Accept: text/markdown, 406s, 404 bodies, raw HTML, agents.md
node tools/verify.mjs       # console errors, broken assets and dead links, all six routes
node tools/nojs.mjs         # every route still readable with scripting switched off
node tools/align.mjs 1440   # boxes that escape their container, collapse, or sit ragged
node tools/contrast.mjs     # every text run against WCAG AA at its own size
node tools/interact.mjs     # every control, tab, accordion and form on the page
node tools/responsive.mjs   # phone, tablet and the three laptop widths
node tools/field-sweep.mjs 1440 900   # each station lights, holds, and clears the content
node tools/field-path.mjs   # the cloud never jumps between neighbouring scroll positions
```

`headers.mjs` is the exception in that list: it reads four text files and needs neither Chrome nor a
running server, so it costs nothing to run and there is no reason to skip it. `agentic.mjs` is the
second exception — it uses `fetch` and no browser at all, so it runs against anything that serves the
site:

```bash
node serve.mjs                                             # localhost, the node mirror
php -S 127.0.0.1:8899 -t site                              # the PHP negotiator itself
ALPHE_PHP=http://127.0.0.1:8899 node tools/agentic.mjs     # both, in one run
```

`php -S` has no rewrite engine, so that run reaches `negotiate.php` the way `.htaccess` sends it —
`?path=/docs/`. To exercise the rewrite rules themselves, point a local Apache at `site/` with
`AllowOverride All` and run `ALPHE_XFP=1 node tools/agentic.mjs` against it; the env var supplies the
`X-Forwarded-Proto: https` that production's proxy sends, without which the first rule redirects
every request to https.

The benchmarks section is generated, not hand-written — its SVG coordinates come from the same
scale functions the page runs on. After editing `site/assets/js/data/models.js`:

```bash
node tools/bench-gen.mjs    # writes /tmp/alphe-bench-section.html
```

and replace the `<!-- Benchmarks --- … </section>` block in `site/index.html` with the result.

The tools section is generated the same way — the sprite sheet is 50-odd inline `<symbol>`
definitions and is not editable by hand. After editing `site/assets/js/data/tools.js`:

```bash
node tools/tools-gen.mjs --insert   # rewrites the #tools block in site/index.html in place
```

Set `CHROME_PATH` if Chrome is not at the macOS default location.

Two traps these scripts encode, both of which produce confident and wrong numbers if ignored:

1. **The field drifts on its own.** Two screenshots taken at different moments differ by thousands of
   pixels across the whole cloud, which swamps any effect you are trying to measure. Freeze it with
   `prefers-reduced-motion: reduce` before measuring anything about the pointer.
2. **Reveals and counters fire once.** Scroll the whole page first, then measure, or a counter
   ticking between two frames is counted as particles.

---

## Versioning

Releases are annotated Git tags, `vMAJOR.MINOR.PATCH`, and every one of them gets an entry in
CHANGELOG.md. There is no build and nothing is published to a registry, so the tag is the artefact:
`git checkout v1.0.0` gives you exactly the tree that was deployed.

Semver applies to what the site promises other people, not to the size of the diff:

- **MAJOR** — a promise breaks. A URL stops resolving, the negotiation rules change shape, the
  security policy drops a header, or the form endpoint changes its contract.
- **MINOR** — something is added and nothing breaks. A new page, a new machine-readable file, a new
  section, a new check.
- **PATCH** — copy, styling, data refreshes and fixes that leave every promise where it was.

Cutting one:

```bash
node tools/headers.mjs && node tools/agentic.mjs   # both must be green
# write the entry in CHANGELOG.md, then commit it
git tag -a v1.1.0 -m "Alphe website 1.1.0"
git push origin main --follow-tags
```

Tag after the checks pass and after the changelog entry is committed, so the tag points at a tree
that documents itself. The deployed bundle is built from a tagged commit — `node tools/bundle.mjs`,
then DEPLOY.md.

---

## Content status

The site is production-ready as a site; some of the copy is illustrative and should be reviewed
before it is treated as a claim:

- Pricing figures, latency numbers and the savings calculator's ratios are indicative.
- The coverage lanes and the tools grid show representative names and marks, not a live catalogue.
  Provider marks are inline `<symbol>` sprites in the markup, each drawn from the vendor's own
  wordmark; they are used nominatively and confer no endorsement.
- The benchmarks board is a dated snapshot, not a feed — 18 of 264 rows, one per family, from
  Artificial Analysis. The date is printed under the board and lives in
  `assets/js/data/models.js` alongside the numbers. Re-take it and re-run `tools/bench-gen.mjs`.
- The forms are wired. All six post to `site/contact.php`, which is same-origin — the CSP has no
  external origins, so a hosted form service would mean widening it in four files. The endpoint
  appends every submission to `alphe-leads/leads.csv` above `public_html`, then mails
  `hello@alpheai.com` over authenticated SMTP to `smtp.hostinger.com`, falling back to PHP `mail()`;
  the CSV is the copy that keeps, so a lead survives both being refused. The mailbox password lives
  in `alphe-mail.php` beside `public_html` on the server — see `alphe-mail.example.php` and
  DEPLOY.md. PHP is Hostinger only — on Vercel the endpoint is a static file that does nothing.

---

## Licence

Not open source. All rights reserved. Fonts are Geist Sans and Geist Mono, used under the SIL Open
Font License; three.js is MIT.
