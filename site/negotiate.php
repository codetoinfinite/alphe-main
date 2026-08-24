<?php
declare(strict_types=1);

/**
 * Alphe — Markdown content negotiation for agents.
 *
 * Implements acceptmarkdown.com: a page served as HTML to a browser is served
 * as Markdown to a client that asks for `text/markdown`, at the same URL, with
 * `Vary: Accept` so caches keep the two apart. Four conformance points, all
 * exercised by tools/agentic.mjs:
 *
 *   1. `Accept: text/markdown` returns `text/markdown; charset=utf-8`.
 *   2. Every response carries `Vary: Accept, Accept-Encoding`.
 *   3. An `Accept` this site cannot satisfy returns 406, not HTML.
 *   4. q-values decide: `text/markdown;q=0.8, text/html;q=0.9` gets HTML.
 *
 * Why a PHP script rather than a rewrite or MultiViews.
 * ----------------------------------------------------
 * Production is LiteSpeed reading site/.htaccess. mod_negotiation MultiViews is
 * not dependably available there and a type-map cannot express q-value
 * tie-breaks or a 406 body. PHP is already a live dependency of this site
 * (contact.php), so this adds no new one.
 *
 * Human traffic never reaches this file. .htaccess routes a request here only
 * when the Accept header actually asks for markdown, or asks for something this
 * site does not have at all. A browser, whose Accept names text/html ahead of
 * a q=0.8 wildcard, and curl, which sends no Accept at all, both take the
 * ordinary static path, byte for byte as before. The page's own form POST to contact.php sends
 * `Accept: application/json` and is excluded by path, so it is untouched.
 *
 * The path arrives as a query parameter, not from PATH_INFO, and is matched
 * against the table below. Anything not in the table is the 404 route. No
 * filesystem path is ever built from request input.
 */

// The routes that have a Markdown twin. Key is the request path as it appears
// in the URL; value is the file, relative to this script, and the status.
const ROUTES = [
    '/'          => ['index.md', 200],
    '/platform/' => ['platform/index.md', 200],
    '/pricing/'  => ['pricing/index.md', 200],
    '/docs/'     => ['docs/index.md', 200],
    '/about/'    => ['about/index.md', 200],
    '/contact/'  => ['contact/index.md', 200],
    '/404'       => ['404.md', 404],
];

const MD_TYPE   = 'text/markdown; charset=utf-8';
const HTML_TYPE = 'text/html; charset=utf-8';

/**
 * Parse an Accept header into ranges, most specific and highest quality first.
 * RFC 9110 section 12.5.1. Returns a list of
 * ['type' => 'text', 'sub' => 'markdown', 'q' => 1.0, 'spec' => 3].
 * spec: 3 = type/subtype, 2 = type/*, 1 = * / *.
 */
function accept_ranges(string $header): array
{
    $out = [];
    foreach (explode(',', $header) as $part) {
        $part = trim($part);
        if ($part === '') {
            continue;
        }
        $bits  = explode(';', $part);
        $range = strtolower(trim(array_shift($bits)));
        if (!str_contains($range, '/')) {
            continue; // Not a media range. Ignore rather than guess.
        }
        [$type, $sub] = explode('/', $range, 2);
        $type = trim($type);
        $sub  = trim($sub);
        if ($type === '' || $sub === '') {
            continue;
        }

        // q is the first parameter named q; parameters after it are extensions
        // and do not affect quality. Anything unparseable is q=1 per the spec's
        // default, but a malformed q is treated as 1 only when it is absent.
        $q = 1.0;
        foreach ($bits as $param) {
            $param = trim($param);
            if (preg_match('/^q\s*=\s*([0-9]*\.?[0-9]+)$/i', $param, $m)) {
                $q = (float) $m[1];
                break;
            }
            if (preg_match('/^q\s*=/i', $param)) {
                $q = 0.0; // q= present but not a number: unusable, so unwanted.
                break;
            }
        }
        if ($q < 0.0) {
            $q = 0.0;
        }
        if ($q > 1.0) {
            $q = 1.0;
        }

        $spec = 1;
        if ($type !== '*' && $sub !== '*') {
            $spec = 3;
        } elseif ($type !== '*') {
            $spec = 2;
        }

        $out[] = ['type' => $type, 'sub' => $sub, 'q' => $q, 'spec' => $spec];
    }

    usort($out, static function (array $a, array $b): int {
        return [$b['spec'], $b['q']] <=> [$a['spec'], $a['q']];
    });

    return $out;
}

/**
 * The quality this Accept assigns to one concrete media type, and how specific
 * the range that matched was. The most specific match wins, and among equally
 * specific matches the highest q wins — RFC 9110 section 12.5.1.
 */
function quality(array $ranges, string $type, string $sub): array
{
    $bestSpec = 0;
    $bestQ    = 0.0;
    foreach ($ranges as $r) {
        if ($r['type'] === '*' && $r['sub'] === '*') {
            $spec = 1;
        } elseif ($r['type'] === $type && $r['sub'] === '*') {
            $spec = 2;
        } elseif ($r['type'] === $type && $r['sub'] === $sub) {
            $spec = 3;
        } else {
            continue;
        }
        if ($spec > $bestSpec || ($spec === $bestSpec && $r['q'] > $bestQ)) {
            $bestSpec = $spec;
            $bestQ    = $r['q'];
        }
    }

    return ['spec' => $bestSpec, 'q' => $bestQ];
}

function security_headers(): void
{
    // Same policy as .htaccess, vercel.json and serve.mjs. mod_headers sets
    // these for static files; a PHP response is built here, so it repeats them
    // rather than trusting a directive it might sit outside of.
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    header('Strict-Transport-Security: max-age=31536000');
    header('Vary: Accept, Accept-Encoding');
    header('Cache-Control: no-cache');
}

// ---------------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'HEAD') {
    security_headers();
    header('Allow: GET, HEAD');
    http_response_code(405);
    header('Content-Type: text/plain; charset=utf-8');
    echo "405 Method Not Allowed. This URL answers GET and HEAD.\n";
    exit;
}

// The path .htaccess captured. Strip the query string and normalise a bare
// directory to its trailing-slash form, which is what the table holds.
$raw  = (string) ($_GET['path'] ?? '/');
$path = parse_url($raw, PHP_URL_PATH);
if (!is_string($path) || $path === '') {
    $path = '/';
}
$path = rawurldecode($path);
if ($path !== '/' && !str_ends_with($path, '/') && !str_contains(basename($path), '.')) {
    $path .= '/';
}

$isKnown = isset(ROUTES[$path]);
[$file, $status] = ROUTES[$isKnown ? $path : '/404'];

$ranges = accept_ranges((string) ($_SERVER['HTTP_ACCEPT'] ?? ''));
if ($ranges === []) {
    // No Accept, or nothing parseable in it: RFC 9110 says treat as */*.
    $ranges = [['type' => '*', 'sub' => '*', 'q' => 1.0, 'spec' => 1]];
}

$md   = quality($ranges, 'text', 'markdown');
$html = quality($ranges, 'text', 'html');

security_headers();

// Nothing this site can produce is acceptable: 406, with the list of what it
// has. RFC 9110 section 15.5.7.
if ($md['q'] <= 0.0 && $html['q'] <= 0.0) {
    http_response_code(406);
    header('Content-Type: text/plain; charset=utf-8');
    header('Link: <' . $path . '>; rel="alternate"; type="text/html", <' . $path . '>; rel="alternate"; type="text/markdown"');
    if ($method !== 'HEAD') {
        echo "406 Not Acceptable\n\n";
        echo "This URL has two representations:\n";
        echo "  text/html            the page\n";
        echo "  text/markdown        the same page as Markdown\n\n";
        echo "Send an Accept header naming one of them, or */*.\n";
        echo "See https://acceptmarkdown.com and https://alpheai.com/agents.md\n";
    }
    exit;
}

// Markdown wins only when `text/markdown` is named exactly, wanted, and wanted
// at least as much as HTML. A wildcard is never read as a request for Markdown:
// a bare `*/*`, a `text/*`, a browser's `text/html,...,*/*;q=0.8` and an absent
// Accept all land on HTML, so the human path cannot change.
$wantsMarkdown = $md['spec'] === 3 && $md['q'] > 0.0 && $md['q'] >= $html['q'];

if (!$wantsMarkdown) {
    // HTML was asked for and HTML is static. Hand it back from disk rather than
    // redirecting, so the URL and the status stay exactly what they were.
    // Derived from the same table row as the Markdown twin, so an unknown path
    // — which resolved to the /404 row above — hands back 404.html rather than
    // looking for an index.html under a directory that does not exist.
    $full = __DIR__ . '/' . substr($file, 0, -3) . '.html';
    if (is_file($full)) {
        http_response_code($status);
        header('Content-Type: ' . HTML_TYPE);
        header('Link: <' . $path . '>; rel="alternate"; type="text/markdown"');
        header('Content-Length: ' . (string) filesize($full));
        if ($method !== 'HEAD') {
            readfile($full);
        }
        exit;
    }
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    if ($method !== 'HEAD') {
        echo "404 Not Found\n";
    }
    exit;
}

$full = __DIR__ . '/' . $file;
if (!is_file($full)) {
    // A twin is missing on disk. Say so rather than pretending: a 500 is
    // findable, a silent HTML fallback is not.
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    if ($method !== 'HEAD') {
        echo "500 The Markdown representation of this page is missing.\n";
        echo "Report it to hello@alpheai.com. The HTML page is still at " . $path . "\n";
    }
    exit;
}

http_response_code($status);
header('Content-Type: ' . MD_TYPE);
header('Link: <' . $path . '>; rel="alternate"; type="text/html", <https://alpheai.com/llms.txt>; rel="index"; type="text/plain"');
header('Content-Length: ' . (string) filesize($full));
if ($method !== 'HEAD') {
    readfile($full);
}
