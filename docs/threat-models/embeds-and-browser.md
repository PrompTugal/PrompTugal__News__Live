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
| A video or image from a shared host (TfL's JamCams sit on Amazon S3, which serves every AWS customer) | Exact host and path prefix (`/jamcams.tfl.gov.uk/`), in `src/data/operator-hosts.json`, checked by the build (`embedDecision`), by `live.js` before each view and by the validator; each page's `media-src` and `img-src` name the host with that path, so another bucket is refused by the browser. |
| A redirect on the shared host escaping the path | CSP ignores the path after a redirect (the spec), so an object under TfL's path that redirected elsewhere on S3 would load. Accepted: the path is TfL's own folder; the build, `live.js` and the validator check the first URL. Recorded, not fixable in a meta CSP. |
| `/embed/<id>/` framed by any site | Meant for the PrompTugal.news sites, but GitHub Pages cannot send `frame-ancestors`, so anyone can frame it. It holds no state, form or action: at most a play button that loads the operator's public player. Its links open a new tab. |
| The map loading a player on a press | The press on a camera square is the reader's choice to load it; nothing loads before it. The URL and exact host are checked again in `live.js`. |
| The sites bar (1.2.1, vendored) | Its code is a byte-for-byte pinned copy (a hash prefix checked by the validator, and every build checks each file against the registry's full pin for that version, stopping on a mismatch; a version the registry no longer lists while it names a newer one leaves the bar out, never shipped unchecked), never loaded from another site; the last deployed bar is reused only if the same version rendered it; the registry is data, rendered at build with escaping and https links to *.promptugal.news only; its pop-ups load other sites' `/preview.svg` as images and read their `/version.json` (img-src and connect-src allow `*.promptugal.news`, nothing wider). The registry is the trust root: plain HTTPS to promptugal.news. |
| What a meta CSP cannot do | It cannot set `frame-ancestors` or reporting, and GitHub Pages does not let us set headers, so another site could frame our pages. There is nothing to click-jack: no forms, sign-ins or actions. |
| A camera showing people | We never analyse what a camera shows and never store it; the reader sees the operator's own player, under the operator's terms and responsibility. Take-down on request. |
| A loaded file's licence block carrying a hostile name or link | Beside the weather and the register line the page shows the licence of the file it read (security@'s low point, 19 Nov 2026). The name is text (textContent, control and direction characters stripped, 60 characters); the link is used only if it is https, with no user info or port, on a known licence host (Creative Commons, Open Data Commons, IPMA, the National Archives, TfL, our own), the same rule at build and in the browser; otherwise the page says the file gives no licence we can link. The step runs last and on its own, so it cannot stop the figures. Tested in a browser with a javascript: link, credentials, a port, an unknown host, no licence and markup in the name. |
