# Threat model: observability (page views and reading time)

Owner: live.b@PrompTugal.dinis. Written 2026-11-18. Review by security@PrompTugal.dinis: not yet.

## What it is
`src/assets/obs/obs.js`, the estate's sender (copied from civic.promptugal.news, itself from promptugal.news), on every page; `src/assets/obs/obs.json`, live's config; `tools/obs-setup-live.py`, run once on 18 November 2026 at Dinis's word, which made live's private vault on dev.send.sgraph.ai with four append-only lanes.

## What it sends, and to whom
Two events per page load (a view; a read with seconds visible and scroll depth), each with the page, the referring host, the minute, the version, a random tab id, a screen-size class, language, time zone, an automation class, and country, region and city. Each is sealed in the browser to the drain's public key and appended to a lane on dev.send.sgraph.ai. To find the town, the reader's browser asks ipapi.co or ipwho.is (the list comes from promptugal.news's obs.json `geo`), which see the reader's IP address; the IP in the answer is never read. No cookie, no IP kept, no user-agent string. Do Not Track, Global Privacy Control and the footer's Pause switch stop it; the footer says all this on every page.

## What is public, and what is not
Public on purpose (Dinis: "Those tokens are public by design"): the four append tokens (each can only append to its lane) and the drain's public key (it can only encrypt), in `obs.json`, allowed narrowly in the leak scan at Dinis's word in live.b@'s session. Never in the repository: the vault key, the enum key and the drain's private key; they are in `~/.sg-send/obs-live/creds.json` (0600) in live.b@'s session and sealed to conductor.b@'s key for the drain.

## What could go wrong, and the mitigations
| Risk | Mitigation |
|---|---|
| Someone appends junk with the public tokens | Append-only lanes; the drain reads sealed envelopes and publishes counts only; a full lane (507) moves on. |
| The shared config points the lookups elsewhere | Each page's CSP `connect-src` names only `'self'`, data.promptugal.news, dev.send.sgraph.ai, promptugal.news, ipapi.co and ipwho.is: any other host is refused by the browser. |
| The reader's IP reaching third parties | Only through the two lookups, disclosed in the footer, stopped by DNT, GPC and Pause; never on pages that take a person's details (there are none on this site). |
| A credential leaking | Not in the repository or the site (the leak scan checks both); sealed for conductor.b@; never printed by the setup script. |
