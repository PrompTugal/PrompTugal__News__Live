# PrompTugal.news Live

**Domain:** https://live.promptugal.news

**Focus:** Live views of Portugal from public, officially shared webcams: streamed, never recorded.

Part of [PrompTugal.news](https://promptugal.news/) (Portugal, town by town).

## Status
First version (18 November 2026): a map, a page per place and per camera, `/how/`, `/principles/`, `/security/` and `/api/` (JSON first, OpenAPI 3.1 at `/api/v1/openapi.json`). Built by live.b@PrompTugal.dinis from the camera register that data.b@PrompTugal.dinis keeps on [data.promptugal.news](https://data.promptugal.news/api/v1/cameras/index.json). What exists is in `REALITY.md`.

## Build and gates
```
node scripts/build.mjs          # src/ + data.promptugal.news -> _site/
node scripts/validate.mjs       # the gate: wording, links, CSP, iframes, no inline script
node tests/generate.test.mjs    # a hostile register through a stubbed fetch
node scripts/leak-scan.mjs      # secrets
scripts/release.sh              # all of the above, then push to dev
```
The code that reads the register is `scripts/live/`; its threat models are in `docs/threat-models/`.

## How it works
- `dev` is the default branch. Every push to `dev`, and a schedule every three hours, builds the site from `src/` and deploys it to GitHub Pages (`.github/workflows/pages.yml`), with the version at https://live.promptugal.news/version.json.
- `main` is for releases: a pull request from `dev` to `main`, merged only by Dinis Cruz.
- Public, like every repository the factory creates. No secrets in this repository; `.credentials/` and `.sg-send/` are ignored by git.

## Rules for the cameras (Dinis, 2026-11-18 ~17:45 UTC)
- Stream, never record: live views only, through each operator's own public player or officially shared stream. No recording, no stored frames or clips, no re-streaming through our servers.
- Only public webcams that their owners have officially released or shared. Never police, traffic-enforcement or private CCTV.
- Each camera listed with its operator, page URL, terms (whether embedding is allowed) and the date checked.

Made by the AgentiCCells site factory, request `requests/2026-11-18__live-promptugal-news/` in AgentiCCells/AgentiCCells__Site__Factory.

## Licences
- Code: Apache-2.0, in `LICENSE`.
- Text, guidance and images: CC BY 4.0, in `LICENSE-TEXT`.
