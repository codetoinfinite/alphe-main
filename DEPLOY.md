# Deploying to Hostinger

The site is static: HTML, CSS, ES modules, fonts and images, with nothing to compile. Deploying is
copying `site/` into `public_html`. Everything below exists to make sure the copy is complete and
that the server is configured the same way the dev server is.

Hostinger shared hosting runs **LiteSpeed**, which reads `.htaccess`. That file is at
`site/.htaccess` and it carries the entire production policy — CSP, HSTS, caching, the 404 page, the
Markdown content negotiation and the https and www redirects. **`vercel.json` is not read on Hostinger at all.** A deploy that loses
`.htaccess` looks completely normal and has no security headers.

---

## Build the bundle

```bash
node tools/bundle.mjs
```

Writes two things, having first run `tools/headers.mjs` and refused to continue if the four copies
of the policy disagree:

- `dist/public_html/` — the tree, for SFTP or rsync
- `dist/alphe-public_html.zip` — the same tree with **its contents at the archive root**, for the
  hPanel File Manager

The zip is rooted at the contents, not at a `site/` folder, so extracting it inside `public_html`
puts `index.html` at the web root rather than at `public_html/site/index.html`. The script reads the
finished archive back and fails if `.htaccess`, `index.html`, `404.html`, `robots.txt` or
`sitemap.xml` is not in it.

`dist/` is gitignored. It is a copy of `site/`, and `site/` is the thing under version control.

---

## Upload

**File Manager.** Open `public_html`, delete what is already there, upload
`dist/alphe-public_html.zip`, extract it, delete the zip.

**SFTP.** Credentials are in hPanel under Files → FTP Accounts. Upload the contents of
`dist/public_html/` into `public_html/`. Most clients skip dotfiles by default — turn that off, or
`.htaccess` will not be sent and nothing will tell you.

Either way, **switch on hidden files in the File Manager afterwards and confirm `.htaccess` and
`.well-known/security.txt` are there.** Both start with a dot, both are invisible from the browser
when they are missing, and the second one is a whole directory a client that skips dotfiles will
skip silently.

---

## Domain and TLS

1. Point the domain at Hostinger (registered there, or its nameservers changed to Hostinger's) and
   let DNS propagate.
2. hPanel → Security → SSL: issue the free certificate for the domain and for `www`. The certificate
   has to cover `www` even though the site redirects it away, because the redirect is served over
   TLS and the browser checks the certificate first.
3. Leave hPanel's **Force HTTPS** toggle off. `.htaccess` already does the redirect, with a condition
   on `X-Forwarded-Proto` that Hostinger's own rule does not have. Two rules doing the same job is
   how a redirect loop happens on the plans that terminate TLS in front of the document root.

The site is canonically **`https://alpheai.com`, no www** — that is what the canonical tags, `og:url`
and `sitemap.xml` say, and `.htaccess` 301s `www` to match. To move to a different domain, change the
markup first:

```bash
grep -rl 'https://alpheai.com' site/ | xargs sed -i '' 's|https://alpheai\.com|https://your-domain|g'
```

(drop the `''` after `-i` on GNU sed), then rebuild the bundle.

---

## Check the live site

```bash
curl -sI https://alpheai.com/ | grep -i -E 'content-security|strict-transport|x-frame|cache-control'
```

All four have to be there. If they are not, `.htaccess` did not make it into `public_html`, or it
landed one directory too deep.

Then:

- `https://alpheai.com/platform` — should 301 to `/platform/`, which is mod_dir doing it, not a rule
- `https://alpheai.com/nothing-here` — should be the site's own 404 page, not LiteSpeed's
- `http://alpheai.com/` — should 301 to https
- `https://www.alpheai.com/` — should 301 to the bare host
- The home page with devtools open — no console errors, and the particle canvases drawing

Then the agent-facing half, which is `negotiate.php` and the rewrite rules rather than the markup:

```bash
ALPHE_BASE=https://alpheai.com node tools/agentic.mjs
```

It asks for every route as Markdown and as HTML, checks `Vary: Accept` on both, the q-values, the
`406` on an unsatisfiable `Accept`, the 404 in both representations, and that `/AGENTS.md`,
`/llms.txt`, `/llms-full.txt`, `/robots.txt` and `/sitemap.xml` all come back with `charset=utf-8`.
A single-digit failure count usually means PHP is disabled on the plan or `negotiate.php` did not
upload; a wholesale failure means `.htaccess` is missing, same as above.

---

## What the live host does that localhost does not

Both of these were found by running the gate against `https://alpheai.com` after a deploy that every
local gate had passed. Run it against the live site every time, for exactly this reason.

**LiteSpeed ignores `AddCharset`.** It is an Apache directive with no LiteSpeed counterpart, and
LiteSpeed skips directives it does not implement without logging anything. The result was
`text/plain` and `text/markdown` with no charset on every static file — `llms.txt`, `robots.txt`,
`sitemap.xml`, `security.txt`, the IndexNow key and all six Markdown twins — while the same files
under Apache carried `charset=utf-8`. `site/.htaccess` now writes the charset into the media type
(`AddType text/markdown;charset=utf-8 .md`) and leans on `AddDefaultCharset utf-8` for `text/html`
and `text/plain`, which both servers honour. If bare types ever come back, those lines went missing.

**The Hostinger CDN rewrites `Vary`.** Responses arrive through `hcdn`, and whatever the origin sent
as `Vary` comes back as `Vary: Accept-Encoding` — the `Accept` is dropped. That is the one failure
the gate cannot fix from inside the repo, and it shows up as thirteen lines reading
`none, from hcdn`. Ask the origin directly to see the difference:

```bash
dig +short A ftp.alpheai.com                       # the origin server, not the edge
curl -sI --resolve alpheai.com:443:<that-ip> \
  -H 'Accept: text/markdown' https://alpheai.com/about/ | grep -i vary
# vary: Accept, Accept-Encoding      <- LiteSpeed is correct; the edge is not
```

Two representations live at each document URL, so `Vary: Accept` is what stops a shared cache from
handing an agent the HTML it cached for a browser. Nothing is being mis-served today — every
document is `Cache-Control: no-cache`, so the edge marks it `DYNAMIC` and re-asks the origin — but
the header a scanner reads is gone, and the protection would be gone too the moment anything here
became cacheable. There is no per-site `Vary` setting to fix it with. **Turn the CDN off in hPanel:
Performance → CDN → disable for the domain**, then re-run the gate; the site is 875 KB of static
files on LiteSpeed and does not need an edge.

---

## Getting indexed

A site nobody has linked to is not in the index, and an agent asked about "Alphe" searches the same
index everyone else does. Two of these need an account; one does not.

**IndexNow — no account, run it after every deploy.** `site/<32-hex>.txt` is the key, and its name is
its contents; hosting it is what proves to Bing, Yandex, Seznam and Naver that whoever submits a URL
controls the host. `tools/bundle.mjs` refuses to build without it.

```bash
node tools/indexnow.mjs             # what would be sent, and where
node tools/indexnow.mjs --submit    # send it — only after the key file is live
```

Submitting before the deploy lands returns `403`: the endpoint fetches the key file first. `200` is
accepted, `202` is accepted-with-the-key-check-pending; both are fine.

**Google Search Console — needs your login.** Add `alpheai.com` as a **Domain** property and verify
with the DNS TXT record it gives you, in the Hostinger DNS panel. That method needs no file in the
repo, survives every deploy, and covers `www` and both schemes at once. Then submit `sitemap.xml`
once under *Sitemaps*. (The HTML-file method also works — drop the `google*.html` file it hands you
into `site/` and redeploy — but it is one more file to lose.)

**Bing Webmaster Tools — needs your login, then two clicks.** Sign in and *Import from Google Search
Console*; it carries the verification and the sitemap across. IndexNow submissions start showing up
under the same property.

Neither Google nor Bing has a keyless "index this now" API — Google's Indexing API is limited to job
postings and livestreams, so Search Console is the only route for the rest.

---

## Reporting address

`site/.well-known/security.txt` is RFC 9116: `Contact: mailto:hello@alpheai.com` plus an `Expires`
date. **The date is not decorative** — a researcher is told to distrust an expired file, so
`tools/agentic.mjs` fails once the date has passed or moved more than a year out. When it fails, push
the date forward and redeploy; that is the whole maintenance story.

---

## The form, and where the leads go

All six forms — the five early-access strips and the contact page — post to `site/contact.php`,
same-origin, because the CSP has no external origins and a hosted form service would mean widening
it in all four files below.

The endpoint does three things with a submission, in this order, and stops caring about the rest
once the first one has worked:

1. **Appends it to `leads.csv`.** The file is written to `alphe-leads/` **beside `public_html`, not
   inside it** — no URL reaches it. Download it from hPanel → File Manager (go up one level from
   `public_html`) or over SFTP; it opens in Sheets and Excel as it is. If the plan's `open_basedir`
   refuses the parent directory, the endpoint falls back to `public_html/.alphe-leads/`, which it
   creates with an `.htaccess` denying everything. `tools/bundle.mjs` never copies either one.
2. **Mails `hello@alpheai.com` over authenticated SMTP**, signing in to `smtp.hostinger.com` as the
   mailbox itself. From is `hello@alpheai.com` — the account that authenticated, so SPF and DKIM
   pass — and Reply-To is whoever filled the form in, so replying from the inbox goes to them.
3. **Falls back to PHP `mail()`** if SMTP could not connect or the password was refused. Hostinger
   caps `mail()` at 10 a minute and 100 a day, does not authenticate it, and does not promise it
   lands, which is why it is the fallback and not the plan.

Only the store *and* the mail failing is a failure. A lead that was filed but could not be mailed
still gets a success, because it is on disk and will be answered; a lead that reached neither gets a
502 and the fallback address. Everything that fails is written to the PHP error log with the reason
the server gave — `AUTH password — 535 5.7.8 Authentication failed` is a wrong password,
`Connection refused` is a blocked port.

### The mailbox password

SMTP needs the password of the `hello@alpheai.com` mailbox — the one used to sign in at
`mail.hostinger.com`, not the hPanel account password. It is **not in the repository and not in the
deploy bundle**, and it must never be put in either.

Create it once, on the server, in the directory that *contains* `public_html`:

```
/home/uXXXXXXXX/alphe-mail.php      <- here
/home/uXXXXXXXX/public_html/        <- the site
```

```php
<?php
return ['pass' => 'the mailbox password'];
```

`alphe-mail.example.php` in this repo is that file with the password taken out and the options
commented; copy its contents rather than retyping. Then set the file's permissions to **600** —
hPanel → File Manager → right-click → Permissions, owner read and write, nothing for group or
world. `.gitignore` keeps a filled-in copy out of git and `tools/bundle.mjs` keeps it out of the
zip, but the password belongs on the server and nowhere else.

Without the file the site still works. Every lead is still stored, and the mail goes out through
`mail()` on Hostinger's terms.

**If mail stops arriving, port 465 is the first thing to check.** It is TLS from the first byte and
is what the endpoint uses by default. Some hosts block outbound 465 and allow 587, which starts
plain and upgrades with STARTTLS; the endpoint speaks both and picks by port number, so switching is
one line in the config file:

```php
<?php
return ['pass' => 'the mailbox password', 'port' => 587];
```

### Testing it

Test the endpoint locally with PHP rather than `serve.mjs` — the dev server's stub answers with the
right shape but stores nothing and mails nothing:

```bash
php -S 127.0.0.1:4341 -t site      # then submit at http://127.0.0.1:4341/contact/
cat alphe-leads/leads.csv
```

Local PHP has no `alphe-mail.php` unless one is put in `site/` for the purpose, so the mail half
takes the `mail()` fallback and usually fails there too; the CSV is what to check. A copy of the
config in the tree is gitignored, but delete it when finished anyway.

After a deploy, the endpoint is live when this says 405 rather than 404:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://alpheai.com/contact.php
```

404 means `contact.php` did not make it into `public_html`, and every form on the site is silently
dropping submissions. 405 is the endpoint refusing a GET, which is the endpoint answering.

Then submit the live form once and watch the `hello@alpheai.com` inbox. If nothing arrives within a
minute or two, the reason is in hPanel → Advanced → PHP Configuration → error log, on a line
starting `alphe:`.

**PHP is a Hostinger thing.** Vercel serves `contact.php` as a static file and every submission
fails there. The site can be previewed on Vercel; the forms only work on Hostinger.

---

## Before every deploy

```bash
node tools/headers.mjs      # .htaccess, vercel.json, serve.mjs and negotiate.php agree
node tools/agentic.mjs      # Accept: text/markdown, 406s, 404 bodies, raw HTML, agents.md
node tools/verify.mjs       # console errors, broken assets, dead links, all six routes
node tools/nojs.mjs         # every route still readable with scripting switched off
node tools/bundle.mjs       # builds dist/, and runs headers.mjs itself
```

---

## The thing that will bite you

The security policy is written in **four** files, because four things have to be told and none of
them reads the others':

| file                 | server                                     |
| -------------------- | ------------------------------------------ |
| `site/.htaccess`     | Hostinger — LiteSpeed                      |
| `vercel.json`        | Vercel                                     |
| `serve.mjs`          | localhost                                  |
| `site/negotiate.php` | every `Accept: text/markdown` response      |

The negotiator sets the headers itself instead of inheriting them, because it answers on whichever
host is in front of it and a PHP response can leave the `.htaccess` scope.

The CSP is `default-src 'self'` with no external origins at all. **Adding a third-party script,
analytics tag, font or embed means widening the policy in all four**, or it works locally and is
blocked in production — or, worse, works in production and is blocked locally, so nobody sees it
until launch. `node tools/headers.mjs` is what stops that; it is a gate, not a formality.
