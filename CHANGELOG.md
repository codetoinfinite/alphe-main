# Changelog

Every release of this site is recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) as it applies to a website rather than a
library — see *Versioning* in README.md for what each position means here.

## [1.0.1] — 2026-08-24

### Removed

- `_unused/img-brands/`, 93 vendor logo SVGs that nothing in the repo read. The provider marks the
  site actually draws are inline `<symbol>` sprites in the markup, and `tools/logos.mjs` pulls its
  source paths from the installed `@lobehub/icons-static-svg` package — the directory was a stale
  copy of both.

## [1.0.0] — 2026-08-24

First tagged release: the site as it is deployed at <https://alpheai.com>.

### Added

- Six pages — home, platform, pricing, docs, about, contact — as hand-written HTML, CSS and ES
  modules. No build step, no framework, no bundler: what is in `site/` is what gets served.
- The particle field, the live routing console, the benchmarks board, the comparison board and the
  reach constellation, all drawn on canvas and all degrading to readable static content with
  scripting off.
- Six contact forms posting to `site/contact.php`, which appends each lead to a CSV above the
  document root and mails `hello@alpheai.com` over authenticated SMTP, falling back to PHP `mail()`.
  The mailbox password lives outside the repo and outside the deploy bundle.
- One security policy — seven headers — written into `site/.htaccess`, `vercel.json`, `serve.mjs`
  and `site/negotiate.php`, with `tools/headers.mjs` failing the build if the four ever disagree.
- Machine-readable surface for agents: `llms.txt`, `llms-full.txt`, `agents.md` (aliased at
  `/AGENTS.md`), a Markdown twin of every page, `robots.txt` naming the crawler and assistant
  user-agents separately, `sitemap.xml`, JSON-LD on every page, and
  `/.well-known/security.txt` per RFC 9116.
- Markdown content negotiation to the acceptmarkdown.com rules: `Accept: text/markdown` returns
  `text/markdown; charset=utf-8`, quality values are honoured, unsatisfiable Accept headers get a
  `406`, and every negotiated response carries `Vary: Accept`. Served by `site/negotiate.php` on
  Apache/LiteSpeed and by rewrite rules on Vercel.
- An agent-friendly `404.html` that names the site, lists the real routes and returns a true 404.
- `tools/agentic.mjs`, a 222-check gate that runs the whole agent-facing contract against the local
  Node server, the local PHP endpoint and — with `ALPHE_BASE` — the live domain.
- `tools/indexnow.mjs` and an IndexNow key file, for pushing URL changes to Bing and Yandex.
- `tools/bundle.mjs`, which builds `dist/alphe-public_html.zip` for upload and filters the mailbox
  credentials and the lead store out of it.

### Fixed

- The charset on static text responses. `AddCharset` is an Apache directive that LiteSpeed ignores
  without reporting anything, so the live host served `.md`, `.txt` and `.xml` with no charset while
  every local check stayed green. The charset now rides inside `AddType` and `AddDefaultCharset`,
  which both servers honour.

### Known

- Hostinger's CDN rewrites `Vary: Accept, Accept-Encoding` down to `Accept-Encoding` on every
  response, which breaks the negotiation contract at the edge even though the origin is correct.
  Disable the CDN in hPanel → Performance → CDN. DEPLOY.md carries the probe that tells the two
  apart.

[1.0.1]: https://github.com/codetoinfinite/alphe-main/releases/tag/v1.0.1
[1.0.0]: https://github.com/codetoinfinite/alphe-main/releases/tag/v1.0.0
