<?php

/**
 * Alphe — the mailbox site/contact.php sends through.
 *
 * This is the template, and the only copy that belongs in the repository. The
 * real one is called alphe-mail.php, lives ON THE SERVER in the directory that
 * *contains* public_html — never inside it, where a URL could reach it — and
 * holds the password of the hello@alpheai.com mailbox:
 *
 *     /home/uXXXXXXXX/alphe-mail.php      <- here
 *     /home/uXXXXXXXX/public_html/        <- the site
 *
 * After creating it, set its permissions to 600 (hPanel -> File Manager ->
 * right-click -> Permissions, owner read+write only, nothing for group or
 * world). .gitignore keeps a filled-in copy out of git and tools/bundle.mjs
 * keeps it out of the deploy zip, but the password still belongs on the server
 * and nowhere else.
 *
 * Without this file the form still works: it stores every lead and falls back
 * to PHP mail(), which Hostinger rate limits and does not authenticate.
 */

return [
    // The password of the hello@alpheai.com mailbox itself — the one used to
    // sign in at mail.hostinger.com. Not the hPanel account password.
    'pass' => 'PUT THE MAILBOX PASSWORD HERE',

    // Defaults, listed so they can be changed without touching contact.php.
    // Uncomment the port line and use 587 if 465 turns out to be blocked: 465
    // is TLS from the first byte, 587 starts plain and upgrades with STARTTLS.
    // 'host' => 'smtp.hostinger.com',
    // 'port' => 465,
    // 'user' => 'hello@alpheai.com',
];
