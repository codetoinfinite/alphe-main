// Render-blocking on purpose, and the only script on the site that is.
//
// Every [data-reveal] block starts at opacity 0 and waits for the observer to
// let it in. That is fine while the modules run and catastrophic when they do
// not: a CSP header, a half-finished deploy, an old browser, or JavaScript
// simply turned off leaves a page of invisible text.
//
// So the whole reveal system is gated behind this class. Set it here, before
// first paint, and the gate closes only when scripting demonstrably works.
// Anything that stops this file from running also stops the gate from closing,
// and the page falls back to plain, visible content.
document.documentElement.classList.add('js');
