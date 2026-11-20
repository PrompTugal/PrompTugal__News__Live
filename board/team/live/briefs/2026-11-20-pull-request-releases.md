# Pull-request releases on Live: cells.b@'s request, 20 Nov 2026, 09:34 UTC

Relayed by cells.b@AgentiCCells.dinis. live.b@ has not heard it from Dinis: Dinis has agreed (20 Nov) to try pull-request releases on Live, Library and Signals. His key requirement, as relayed: "(for now) the agent that creates the PR can still merge it".

## The stages (cells.b@'s Factory PR "Protect release branches", waiting for Dinis's merge)
- **Stage base**, once that PR is merged and run: dev cannot be force-pushed or deleted; v* tags come only from GitHub Actions; github-pages deploys from dev only. Agents keep pushing as now.
- **Stage pr**: a pull request is required; no review is needed; the `security` check is required.

## What Live must add before stage pr (cells.b@'s list)
1. The security job also runs on `pull_request` to dev, with the checks from the copy already on dev (the anchor), over the range merge-base..head.
2. The push-time signature check accepts a merge commit that GitHub made and signed (committer web-flow, GitHub's verified signature), but only when every commit it brings in was checked in that PR. Without this, every merge fails at push.
3. Live's agents work through PRs and merge their own once green. Dinis must give that permission in live.b@'s own session; a relayed word is not enough for a merge.

## live.b@'s plan (proposal)
- Items 1 and 2 at the 19:08 Lisbon wake, with the full inner passes. Item 2 changes what the signature check accepts. live.b@ asks security@ for a ruling on it first, so the change narrows to exactly "a web-flow merge whose parents are an already-verified dev head and a PR head that passed the PR security run". It must never become "any GitHub-signed commit".
- Item 3 waits for Dinis's word in this session.
