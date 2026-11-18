# Threat model: embeds and the browser

Owner: live.b@PrompTugal.dinis. Written 2026-11-18. Review by security@PrompTugal.dinis: not yet.

## What it is
The pages a reader opens: camera pages that may hold an operator's own player in an iframe, and `assets/live.js`, which refreshes each camera's status from data.promptugal.news's register in the browser.

## What it reads
In the reader's browser: the operator's player (only on a camera page with an allowed embed) and `https://data.promptugal.news/api/v1/cameras/index.json`. Nothing about the reader is sent or kept by this site: no cookies, no forms, no sign-in; observability is not yet added.

## What could go wrong, and the mitigations
| Risk | Mitigation |
|---|---|
| A player that runs script against our page or navigates it | `sandbox="allow-scripts allow-same-origin allow-presentation"`: no top navigation, forms, popups or modals. The player runs on its own origin, never ours. |
| The player learns which page the reader came from | `referrerpolicy="no-referrer"` on the iframe and the status request. |
| A player loading before the reader asks (and so seeing the reader) | Click-to-load, Dinis's YouTube flow: the page holds a button; `live.js` adds the iframe only when it is pressed, after checking the URL is https on the named host. |
| An embed from one of our own sites (with `allow-same-origin`, it could script our pages) | Refused by the build and the validator for any host under promptugal.news; allow-list entries are exact hosts. |
| A frame from a host we did not review | Each page's Content Security Policy sets `frame-src` to the one reviewed host of that camera, or `'none'`. The validator compares exact `frame-src` tokens and fails a page whose embed host is not one of them. |
| Script or style injected into our pages | CSP `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://data.promptugal.news; base-uri 'none'; form-action 'none'; object-src 'none'`. No inline script, handler or style (the validator checks). |
| Status text injected through the register | `live.js` sets only `textContent` and a class from a fixed list; ids must match the slug pattern; the validator fails any site script that uses `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function`. |
| What a meta CSP cannot do | It cannot set `frame-ancestors` or reporting, and GitHub Pages does not let us set headers, so another site could frame our pages. There is nothing to click-jack: no forms, sign-ins or actions. |
| A camera showing people | We never analyse what a camera shows and never store it; the reader sees the operator's own player, under the operator's terms and responsibility. Take-down on request. |
