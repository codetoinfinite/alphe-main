<?php
declare(strict_types=1);

/**
 * Alphe — the one endpoint every form on the site posts to.
 *
 * All five forms come here: the four early-access strips (email alone) and the
 * contact page (name, work email, phone, internship). They differ only in which
 * keys arrive, so there is one handler rather than one per page.
 *
 * Why PHP, on a site with no build step and no backend.
 * -----------------------------------------------------
 * The production CSP is `connect-src 'self'` and `form-action 'self'` with no
 * external origins at all — see site/.htaccess, and the warning at the end of
 * DEPLOY.md about what adding a third-party origin costs. Formspree, Web3Forms
 * and every other hosted form service is a cross-origin POST, so using one means
 * widening the policy in three files and putting a public key in the markup.
 * Hostinger runs PHP in public_html already. Same origin, no key, no new
 * dependency, and the policy is untouched.
 *
 * Delivery: authenticated SMTP to smtp.hostinger.com as hello@alpheai.com, the
 * mailbox itself. Hostinger caps unauthenticated mail() at 10 a minute and 100
 * a day and does not promise it lands, so the mailbox password — kept in a file
 * above the document root, never in this repo — is what makes a submission
 * arrive. mail() stays behind it as the fallback. From and To are both
 * hello@alpheai.com, which is the account that authenticated and therefore
 * passes SPF and DKIM, and Reply-To is whoever filled the form in, so replying
 * from the inbox goes straight to them.
 *
 * The record: mail is the notification, LEADS_CSV is the copy that keeps.
 * ---------------------------------------------------------------------
 * Every accepted submission is appended to a CSV outside the document root
 * before the mail goes out, so a lead survives a mailbox filter, a full inbox
 * and mail() itself being refused. Download it from hPanel -> File Manager or
 * over SFTP; it opens in Sheets and Excel as it is.
 *
 * Answers the page's fetch in JSON and a plain form POST in HTML, so a browser
 * that never ran the script still submits and still gets told what happened.
 * Never 200s on a submission it did not keep: the bug this replaces was a form
 * that told people they were on a list and then dropped them. Kept means written
 * to the CSV or handed to mail() -- both is the normal case, either one alone is
 * still a lead that exists somewhere.
 */

const TO        = 'hello@alpheai.com';
const FROM_MAIL = 'hello@alpheai.com';
const FROM_NAME = 'Alphe website';

// One address, one submission per MIN_GAP seconds and PER_HOUR an hour. A public
// unauthenticated mail endpoint is a spam relay for anyone who finds it.
//
// Both numbers are per IP, and an IP is not a person: a phone on mobile data
// sits behind carrier-grade NAT with thousands of other subscribers, and an
// office shares one address across the building. Tight limits there lock out
// real people who never sent anything, which is worse than the flood they
// prevent -- this endpoint mails one fixed address and nowhere else, so the
// worst a flood does is fill an inbox that is already being read.
const MIN_GAP  = 10;
const PER_HOUR = 40;

const MAX = ['name' => 120, 'email' => 190, 'phone' => 40, 'source' => 200];

// The SMTP account. Only the password is secret and it is never in this file;
// mailConfig() reads it from a PHP file that lives above the document root.
// Port 465 is TLS from the first byte, 587 upgrades with STARTTLS — both are
// Hostinger's own, and the config file can switch to 587 if 465 is blocked.
const MAIL_CONFIG  = 'alphe-mail.php';
const SMTP_HOST    = 'smtp.hostinger.com';
const SMTP_PORT    = 465;
const SMTP_TIMEOUT = 12;

// The directory the CSV lives in. Tried above the document root first, where no
// URL can reach it at all; see storeDir() for what happens when the host will
// not allow that.
const STORE_DIR = 'alphe-leads';
const LEADS_CSV = 'leads.csv';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// Two ways in, one set of decisions. The page's fetch asks for JSON and gets it.
// A browser posting the form itself asks for HTML -- no JS, a module that did
// not load, an extension that broke it -- and that submission has to work too,
// because the alternative is a form that silently does nothing on the machines
// where the script did not run. Showing that person a line of raw JSON is how a
// submission that worked reads as a site that is broken, so it gets a page.
define('WANTS_JSON', strpos((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json') !== false);

/**
 * The response body, and the Content-Type that goes with it.
 *
 * Split out of out() so the early answer below can send exactly the same bytes
 * without a second copy of the page drifting away from this one.
 */
function responseBody(array $body): string {
    if (WANTS_JSON) {
        header('Content-Type: application/json; charset=utf-8');
        return (string) json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    $ok  = ($body['ok'] ?? false) === true;
    $msg = $ok ? 'On the list, we will be in touch.' : (string) ($body['error'] ?? 'Could not send');

    header('Content-Type: text/html; charset=utf-8');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<title>' . ($ok ? 'Thank you' : 'Not sent') . ' &mdash; Alphe</title>'
        . '<style>body{background:#08090a;color:#f2f3f5;margin:0;min-height:100vh;display:grid;'
        . 'place-items:center;padding:24px;text-align:center;font:16px/1.7 -apple-system,'
        . 'BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}a{color:#5b8cff}</style></head>'
        . '<body><main><p>' . htmlspecialchars($msg, ENT_QUOTES, 'UTF-8') . '</p>'
        . '<p><a href="/">Back to alpheai.com</a></p></main></body></html>';
}

function out(int $code, array $body): void {
    http_response_code($code);
    echo responseBody($body);
    exit;
}

/**
 * Answer now, keep running.
 *
 * Everything past the CSV write is already decided: a lead on disk is a 200
 * whatever the mail does next. So the person does not have to sit through the
 * send, and they were sitting through a lot of it -- SMTP_TIMEOUT applies to
 * the connect and to every read after it, so a mail server that accepts the
 * connection and then goes quiet costs twelve seconds of a form that reads as
 * stuck, and one that stalls on each step in turn costs considerably more.
 *
 * litespeed_finish_request() is the LiteSpeed SAPI's fastcgi_finish_request():
 * flush, let the connection go, carry on with the script. Hostinger runs
 * LiteSpeed. Where neither function exists -- mod_php, the built-in server --
 * this returns false without having sent anything, and the caller falls back to
 * sending the mail in front of the response exactly as it did before. The slow
 * path stays the old path rather than becoming a broken one.
 */
function finishRequest(int $code, array $body): bool {
    if (!function_exists('litespeed_finish_request') && !function_exists('fastcgi_finish_request')) {
        return false;
    }

    // The connection is about to close while there is still work to do, and the
    // work is the mail. Losing it to a disconnect is the thing being fixed.
    ignore_user_abort(true);

    http_response_code($code);
    $payload = responseBody($body);

    // An explicit length lets the client finish reading on its own instead of
    // waiting on a close, which is what makes the answer land immediately.
    header('Content-Length: ' . strlen($payload));
    echo $payload;

    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();

    return function_exists('litespeed_finish_request')
        ? litespeed_finish_request()
        : fastcgi_finish_request();
}

/** One accepted submission against this address's throttle window. */
function recordSend(string $store, array $seen, int $now): void {
    $seen['last'] = $now;
    $seen['n']    = (int) $seen['n'] + 1;
    @file_put_contents($store, json_encode($seen), LOCK_EX);
}

function fail(int $code, string $message): void {
    out($code, ['ok' => false, 'error' => $message]);
}

// Anything that reaches a mail header has its line breaks taken out first. A
// newline in a From or a Subject is a second header, and a second header on a
// mail endpoint is an open relay.
function oneLine(string $s): string {
    return trim(preg_replace('/[\r\n\t]+/', ' ', $s) ?? '');
}

// ------------------------------------------------------------------ the store

/**
 * Where the CSV goes. First choice is the directory above public_html: nothing
 * under it is served, so there is no URL that returns the lead list even if a
 * rule is later dropped from .htaccess.
 *
 * open_basedir on shared hosting sometimes pins PHP to the document root, and a
 * plan that does that would silently keep no records at all, so the fallbacks
 * are a hidden directory inside it and then the system temp dir. Both get an
 * .htaccess denying the lot on the way in, because the in-docroot one is
 * genuinely reachable and temp dirs have been inside a web root before.
 */
function storeDir(): ?string {
    $docroot = rtrim(str_replace('\\', '/', (string) ($_SERVER['DOCUMENT_ROOT'] ?? '')), '/');

    $tries = [];
    if ($docroot !== '') {
        $tries[] = dirname($docroot) . '/' . STORE_DIR;
        $tries[] = $docroot . '/.' . STORE_DIR;
    }
    $tries[] = sys_get_temp_dir() . '/' . STORE_DIR;

    foreach ($tries as $dir) {
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) continue;
        if (!is_writable($dir)) continue;
        if (!is_file($dir . '/.htaccess')) {
            @file_put_contents($dir . '/.htaccess', "Require all denied\n");
        }
        return $dir;
    }
    return null;
}

/**
 * A cell that a spreadsheet would run instead of showing. Excel, Sheets and
 * LibreOffice all treat a leading =, +, - or @ as the start of a formula, and
 * the fields here are typed by strangers -- so the value is quoted into a text
 * cell with a leading apostrophe rather than trusted to be inert.
 */
function csvCell(string $v): string {
    return preg_match('/^[=+\-@\t\r]/', $v) === 1 ? "'" . $v : $v;
}

/**
 * One row, always the same nine columns in the same order. The header is written
 * once, when the file is created, and every row after it for the life of the
 * file has to line up with that -- so rows are built here rather than at each
 * call site, where a missing key would shift every cell after it one column left.
 */
function leadRow(array $cells): array {
    return array_merge([
        'when'       => gmdate('Y-m-d H:i:s') . ' UTC',
        'form'       => '',
        'name'       => '',
        'email'      => '',
        'phone'      => '',
        'internship' => '',
        'page'       => '',
        'ip'         => '',
        'agent'      => '',
    ], $cells);
}

/**
 * Append one row under an exclusive lock, header first if the file is new.
 * fputcsv does the quoting; the lock is what makes two submissions landing in
 * the same second two rows rather than one mangled one.
 *
 * All five arguments, always. The default escape is a backslash, which turns a
 * value ending in one into `"b\"` -- a quote the parser reads as data and a row
 * that swallows the rest of the file -- and PHP 8.4 deprecates omitting it, so
 * on a host with display_errors on the notice lands in the JSON body and the
 * page reports a failure for a lead it just filed.
 */
function appendLead(string $dir, array $row): bool {
    $file = $dir . '/' . LEADS_CSV;
    $fh = @fopen($file, 'ab');
    if (!$fh) return false;

    $ok = false;
    if (flock($fh, LOCK_EX)) {
        // Size is read under the lock. Read before it and two first submissions
        // both see an empty file and both write a header.
        if (fstat($fh)['size'] === 0) {
            // Before the first row goes in, not after: the file is a list of
            // people's names, emails and phone numbers, and 0644 is the default.
            @chmod($file, 0600);
            fputcsv($fh, array_keys($row), ',', '"', '');
        }
        $ok = fputcsv($fh, array_map('csvCell', array_values($row)), ',', '"', '') !== false;
        fflush($fh);
        flock($fh, LOCK_UN);
    }
    fclose($fh);
    return $ok;
}

// ----------------------------------------------------------------- delivery

/**
 * The SMTP account, or null when there is no password on the box.
 *
 * Read from a PHP file that returns an array — never from this repo, never from
 * anything the request can influence. First choice is the directory above
 * public_html, which no URL reaches. The fallback is next to this file: a
 * request for it runs it and prints nothing, but the source would be readable
 * if the PHP handler were ever misconfigured, so DEPLOY.md says the first one.
 *
 * Everything but the password has a default, so the file on the server is two
 * lines and there is one place a mistake can be made.
 */
function mailConfig(): ?array {
    $docroot = rtrim(str_replace('\\', '/', (string) ($_SERVER['DOCUMENT_ROOT'] ?? '')), '/');

    $tries = [];
    if ($docroot !== '') $tries[] = dirname($docroot) . '/' . MAIL_CONFIG;
    $tries[] = __DIR__ . '/' . MAIL_CONFIG;

    foreach ($tries as $file) {
        if (!is_file($file) || !is_readable($file)) continue;

        $cfg = @include $file;
        if (!is_array($cfg)) continue;

        $cfg += ['host' => SMTP_HOST, 'port' => SMTP_PORT, 'user' => FROM_MAIL];
        if (!is_string($cfg['pass'] ?? null) || $cfg['pass'] === '') continue;

        return $cfg;
    }
    return null;
}

/**
 * Write one command, read the reply, return its code — or 0 when the socket
 * gave up, because a conversation that stops halfway is a failure and not a
 * send that quietly worked.
 *
 * A reply can run to several lines (250-PIPELINING, 250-STARTTLS, 250 AUTH):
 * the continuations carry a hyphen in the fourth column and the last one a
 * space, so that is what ends the read rather than the socket going quiet.
 */
function smtpCmd($fh, ?string $line, ?string &$reply = null): int {
    if ($line !== null && @fwrite($fh, $line . "\r\n") === false) return 0;

    $reply = '';
    while (($got = @fgets($fh, 8192)) !== false) {
        $reply .= $got;
        $got = rtrim($got, "\r\n");
        if (strlen($got) < 4 || $got[3] !== '-') return (int) substr($got, 0, 3);
    }
    return 0;
}

/**
 * A line that is a single dot is what ends DATA, so a line that starts with one
 * leaves with two and the receiving server takes the extra one back off. Skip
 * it and a message body containing "..." truncates the mail at that point.
 */
function smtpDotStuff(string $message): string {
    return preg_replace('/^\./m', '..', $message) ?? $message;
}

/** mail() writes To, Subject and Date itself. Over SMTP they are ours to add. */
function smtpMessage(string $to, string $subject, string $headers): string {
    $domain = substr(strrchr(FROM_MAIL, '@') ?: '@localhost', 1);

    return implode("\r\n", [
        'Date: ' . gmdate('D, d M Y H:i:s') . ' +0000',
        'To: ' . $to,
        'Subject: ' . $subject,
        // Unique per message, no randomness needed beyond that: a mail server
        // may drop a second copy of an ID it has already filed.
        'Message-ID: <' . str_replace('.', '', uniqid('', true)) . '@' . $domain . '>',
        $headers,
    ]);
}

/**
 * Hand the message to the SMTP server as the mailbox itself.
 *
 * Port 465 is TLS from the first byte; anything else opens in the clear and is
 * upgraded with STARTTLS before AUTH, so the password never crosses the wire
 * either way. The certificate is verified — an unverified TLS session to a mail
 * server is the mailbox password handed to whoever answered the connection.
 *
 * $err comes back with the server's own words on failure. It is written to the
 * error log, so it carries replies only: no command is ever logged, because two
 * of them are the username and the password in base64.
 */
function smtpSend(array $cfg, string $to, string $message, ?string &$err = null): bool {
    $host   = (string) $cfg['host'];
    $port   = (int) $cfg['port'];
    $direct = $port === 465;

    $ctx = stream_context_create(['ssl' => [
        'verify_peer'      => true,
        'verify_peer_name' => true,
        'SNI_enabled'      => true,
        'peer_name'        => $host,
    ]]);

    // A refused connection fills $errstr. A certificate the box does not trust
    // leaves it empty and says why in a warning instead, so the warnings are
    // collected rather than silenced: "certificate verify failed" is the whole
    // difference between a blocked port and a mail server that is not the one
    // it claims to be, and the log is the only place anyone will see it. The
    // handler also keeps the warning out of the JSON body, which is what an @
    // was doing before.
    $notes = [];
    set_error_handler(static function (int $no, string $msg) use (&$notes): bool {
        // oneLine because OpenSSL's is several lines long and a log entry that
        // wraps is a log entry that gets read as three unrelated ones.
        $notes[] = oneLine(preg_replace('/^stream_socket_client\(\): ?/', '', $msg) ?? $msg);
        return true;
    });
    $fh = stream_socket_client(
        ($direct ? 'ssl://' : 'tcp://') . $host . ':' . $port,
        $errno,
        $errstr,
        SMTP_TIMEOUT,
        STREAM_CLIENT_CONNECT,
        $ctx
    );
    restore_error_handler();

    if (!$fh) {
        $why = $errstr !== '' ? $errstr . ' (' . $errno . ')' : implode('; ', $notes);
        $err = 'connect ' . $host . ':' . $port . ' — ' . ($why !== '' ? $why : 'refused');
        return false;
    }
    stream_set_timeout($fh, SMTP_TIMEOUT);

    // The name in EHLO is the sending domain, not the web server's hostname,
    // which on shared hosting is a box number shared with strangers.
    $ehlo = 'EHLO ' . (substr(strrchr(FROM_MAIL, '@') ?: '@localhost', 1));

    $step = static function (?string $line, int $want, string $what) use ($fh, &$err): bool {
        $code = smtpCmd($fh, $line, $reply);
        if ($code === $want) return true;
        $err = $what . ' — ' . ($code === 0 ? 'no reply (timeout)' : trim((string) $reply));
        return false;
    };

    $ok = $step(null, 220, 'greeting') && $step($ehlo, 250, 'EHLO');

    if ($ok && !$direct) {
        $ok = $step('STARTTLS', 220, 'STARTTLS');
        if ($ok && @stream_socket_enable_crypto($fh, true, STREAM_CRYPTO_METHOD_TLS_CLIENT) !== true) {
            $err = 'TLS upgrade refused by ' . $host;
            $ok  = false;
        }
        // EHLO again: what the server offers before TLS and after it are two
        // different lists, and AUTH is normally only in the second.
        $ok = $ok && $step($ehlo, 250, 'EHLO after STARTTLS');
    }

    $ok = $ok
        && $step('AUTH LOGIN', 334, 'AUTH LOGIN')
        && $step(base64_encode((string) $cfg['user']), 334, 'AUTH username')
        && $step(base64_encode((string) $cfg['pass']), 235, 'AUTH password')
        && $step('MAIL FROM:<' . $cfg['user'] . '>', 250, 'MAIL FROM')
        && $step('RCPT TO:<' . $to . '>', 250, 'RCPT TO')
        && $step('DATA', 354, 'DATA')
        && $step(smtpDotStuff($message) . "\r\n.", 250, 'message body');

    if ($ok) smtpCmd($fh, 'QUIT');
    fclose($fh);

    return $ok;
}

// ---------------------------------------------------------------- the request

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    fail(405, 'Method not allowed');
}

// The browser sends Origin on every cross-origin fetch and on same-origin POSTs
// too. Absent is fine — curl and old clients omit it — but present and foreign
// is another site posting through this one.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    // Host only, both sides. HTTP_HOST carries the port whenever it is not the
    // default one and parse_url's host never does, so comparing them whole says
    // "cross-origin" to a perfectly ordinary POST on :4401.
    $host = preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')) ?? '';
    if (strcasecmp(parse_url($origin, PHP_URL_HOST) ?: '', $host) !== 0) {
        fail(403, 'Cross-origin request refused');
    }
}

$field = static function (string $key) : string {
    $v = $_POST[$key] ?? '';
    return is_string($v) ? trim($v) : '';
};

// Who is calling. Hostinger's CDN is in front of the document root, so
// REMOTE_ADDR is the edge and X-Forwarded-For is the caller. XFF is spoofable,
// so it identifies for the record and rations for the throttle and decides
// nothing on its own — the trap and the mailbox do the rest.
$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? ($_SERVER['REMOTE_ADDR'] ?? '');
$ip = trim(explode(',', (string) $ip)[0]);
$agent = substr(oneLine((string) ($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 200);

// ---------------------------------------------------------------------- trap
//
// `alphe_ref` is a real input in the markup, clipped out of the layout and
// hidden from assistive tech: a person is never shown a box to type in, so only
// something filling every field it can parse writes to it.
//
// The name is the point. It used to be `company`, which is a name Chrome and
// Edge recognise — their address autofill puts a saved company name in it while
// the person is filling in the email above, ignoring autocomplete="off" as it
// is documented to do, and password managers fill it for the same reason. Every
// submission that happened to came back a trap hit, was answered with a success
// and was thrown away, which is why mail arrived from Safari on a Mac and an
// iPhone and not from Chrome on Windows and Android. `alphe_ref` matches
// nothing any autofill looks for, and the input is readonly, which autofill
// skips outright.
//
// What is caught is recorded and not mailed, and answered with a success it
// cannot tell from the real one, because a bot told it failed comes back having
// learned why. What it is not is deleted. A trap that silently drops what it
// catches is a trap that costs real leads and leaves nothing behind to find
// them in.
if ($field('alphe_ref') !== '') {
    $dir = storeDir();
    if ($dir !== null) {
        appendLead($dir, leadRow([
            'form'  => 'trap',
            'name'  => substr(oneLine($field('name')), 0, MAX['name']),
            'email' => substr(oneLine($field('email')), 0, MAX['email']),
            'phone' => substr(oneLine($field('phone')), 0, MAX['phone']),
            'page'  => substr(oneLine($field('source')), 0, MAX['source']),
            'ip'    => $ip !== '' ? $ip : 'unknown',
            'agent' => $agent,
        ]));
    }
    error_log('alphe: trap fired — recorded in the CSV as trap, not mailed');
    out(200, ['ok' => true]);
}

// ------------------------------------------------------------------ throttle

$now   = time();
$store = sys_get_temp_dir() . '/alphe-form-' . sha1($ip !== '' ? $ip : 'unknown') . '.json';
$seen  = ['last' => 0, 'hour' => $now, 'n' => 0];

if (is_file($store)) {
    $prev = json_decode((string) @file_get_contents($store), true);
    if (is_array($prev)) $seen = $prev + $seen;
}
if ($now - (int) $seen['last'] < MIN_GAP) {
    fail(429, 'One moment — that was just sent');
}
if ($now - (int) $seen['hour'] > 3600) {
    $seen['hour'] = $now;
    $seen['n'] = 0;
}
if ((int) $seen['n'] >= PER_HOUR) {
    fail(429, 'Too many messages — email ' . TO);
}
// Counted after the send, not here. What is worth rationing is mail going out,
// and someone who mistypes their address and fixes it two seconds later should
// not be told to wait — they have not sent anything yet.

// ---------------------------------------------------------------- validation
//
// The same three rules the page runs in sections.js, run again here. The client
// copy is there to give someone a message next to the field they got wrong; this
// copy is the one that decides, because the client one is a suggestion to
// anything that is not a browser.

$email = $field('email');
if ($email === '')                                     fail(422, 'Enter your work email');
if (strlen($email) > MAX['email'])                     fail(422, 'That email is too long');
if (!filter_var($email, FILTER_VALIDATE_EMAIL))        fail(422, 'Enter a valid work email');

// Present only on the contact page. A key that arrived has to be right; a key
// that never arrived is a form that does not ask for it.
$has = static fn(string $k): bool => array_key_exists($k, $_POST);

// Flattened before anything else looks at it. It cannot reach a header intact
// anyway, but a name carrying its own line breaks reads in the body as a line
// the form printed — "Bcc: someone@example.com" under Name is alarming even
// when it is inert.
$name = oneLine($field('name'));
if ($has('name')) {
    if ($name === '')                  fail(422, 'Enter your name');
    if (mb_strlen($name) < 2)          fail(422, 'Enter your name');
    if (mb_strlen($name) > MAX['name']) fail(422, 'That name is too long');
}

$phone = oneLine($field('phone'));
if ($has('phone')) {
    $digits = preg_replace('/\D/', '', $phone) ?? '';
    if ($phone === '')                                        fail(422, 'Enter your contact number');
    if (!preg_match('/^\+?[\d\s\-().]+$/', $phone)
        || strlen($digits) < 7 || strlen($digits) > 15)       fail(422, 'Enter a valid contact number');
    if (strlen($phone) > MAX['phone'])                        fail(422, 'That number is too long');
}

// The page's own script sends yes/no; a browser posting the form itself sends
// the checkbox's value, which is "on" unless the markup says otherwise, and
// sends nothing at all when it is clear. Both spellings mean the same thing.
$internship = in_array(strtolower($field('internship')), ['yes', 'on', '1', 'true'], true);
$source     = substr(oneLine($field('source')), 0, MAX['source']);
if ($source === '' || $source[0] !== '/') $source = '/';

// -------------------------------------------------------------------- the mail

$who     = $name !== '' ? $name : $email;
$subject = 'Alphe — ' . ($has('name') ? 'contact form' : 'early access') . ' — ' . $who;
$subject = oneLine($subject);
if (function_exists('mb_encode_mimeheader')) {
    $subject = mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n");
}

$lines = [];
if ($name !== '')  $lines[] = 'Name        ' . $name;
$lines[] = 'Email       ' . $email;
if ($phone !== '') $lines[] = 'Phone       ' . $phone;
if ($has('internship')) $lines[] = 'Internship  ' . ($internship ? 'yes' : 'no');
$lines[] = '';
$lines[] = 'Page        ' . $source;
$lines[] = 'When        ' . gmdate('D, d M Y H:i:s') . ' UTC';
$lines[] = 'IP          ' . ($ip !== '' ? $ip : 'unknown');
$lines[] = 'Agent       ' . $agent;
$lines[] = '';
$lines[] = 'Reply to this mail to answer them directly.';

$body = implode("\r\n", $lines) . "\r\n";

$headers = implode("\r\n", [
    'From: ' . FROM_NAME . ' <' . FROM_MAIL . '>',
    'Reply-To: ' . oneLine($email),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: alphe-site',
]);

// ------------------------------------------------------------------ the record
//
// Written first. Whatever mail() does next, the lead exists on disk from here
// on, which is the difference between a slow reply and a lost one.
$dir = storeDir();
$kept = $dir !== null && appendLead($dir, leadRow([
    'form'       => $has('name') ? 'contact' : 'early access',
    'name'       => $name,
    'email'      => $email,
    'phone'      => $phone,
    'internship' => $has('internship') ? ($internship ? 'yes' : 'no') : '',
    'page'       => $source,
    'ip'         => $ip !== '' ? $ip : 'unknown',
    'agent'      => $agent,
]));

if (!$kept) {
    error_log('alphe: could not write the lead CSV' . ($dir === null ? ' (no writable directory)' : ' in ' . $dir));
}

// ------------------------------------------------------------------ the answer
//
// Sent here, before the mail, because by here it is already decided: a lead in
// the CSV is answered 200 no matter what the send does below. Waiting for the
// send only ever made the person wait -- it never changed what they were told.
//
// The throttle counter is written first for the same reason. Past the point the
// connection closes there is nobody left to tell that it did not get written.
//
// A CSV that could not be written is the one case the answer still depends on
// the mail, so that path stays in front of the response, unchanged.
$recorded = false;
$answered = false;

if ($kept) {
    recordSend($store, $seen, $now);
    $recorded = true;
    $answered = finishRequest(200, ['ok' => true]);
}

// -------------------------------------------------------------------- the mail
//
// Authenticated SMTP when the password file is on the box. mail() stays behind
// it, so a wrong password, a blocked port or a mail server having a bad minute
// is a mail that arrives by the slower route rather than a lead that only ever
// existed in the CSV.
$cfg   = mailConfig();
$sent  = false;
$route = 'none';

if ($cfg !== null) {
    $smtpErr = null;
    $sent = smtpSend($cfg, TO, smtpMessage(TO, $subject, $headers) . "\r\n\r\n" . $body, $smtpErr);
    if ($sent) {
        $route = 'smtp';
    } else {
        error_log('alphe: SMTP refused a submission from ' . $email . ' — ' . $smtpErr);
    }
}

if (!$sent) {
    // Envelope sender is a constant, never anything that came in with the
    // request: the fifth argument is passed to sendmail as a command-line flag.
    $sent = @mail(TO, $subject, $body, $headers, '-f' . FROM_MAIL);
    if ($sent) {
        $route = 'mail()';
    } else {
        error_log('alphe: mail() refused a submission from ' . $email);
    }
}

// One line per accepted submission, with no address in it. It is what answers
// "is the mailbox password actually on this box" from the hPanel error log
// without anyone having to reproduce a failure: route=smtp is the authenticated
// send, route=mail() is the fallback that Hostinger rate-limits and does not
// promise to deliver, and no config at all says so outright.
error_log('alphe: submission kept=' . ($kept ? 'yes' : 'no') . ' route=' . $route
    . ($cfg === null ? ' (no SMTP password file on this box)' : ''));

// Only both failing is a failure. A stored lead that could not be mailed is in
// the CSV and will be answered; saying "could not send" to that would send the
// person away from a form that in fact worked.
if ($answered) {
    exit;
}

if (!$sent && !$kept) {
    fail(502, 'Could not send — please email ' . TO);
}

if (!$recorded) {
    recordSend($store, $seen, $now);
}

out(200, ['ok' => true]);
