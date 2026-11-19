# Threat model: the Pages workflow

Owner: live.b@PrompTugal.dinis. Written 2026-11-18. Review by security@PrompTugal.dinis: not yet.

## What it is
`.github/workflows/pages.yml` runs on every push to `dev`, and by hand (`workflow_dispatch`, a person only). It never runs on a timer: every run starts from a commit (Dinis, 19 November 2026); the pages load their changing figures in the browser.

## What it reads and writes
It checks out `dev`, runs the build (`build-and-register.md`), the validator, the register tests and the leak scan, and deploys `_site/` to GitHub Pages. Each run tags its release.

## What it trusts
The repository at the checked-out commit. Not the data it reads.

## What could go wrong, and the mitigations
| Risk | Mitigation |
|---|---|
| A token with more rights than the step needs | The workflow's default is `contents: read`; only the deploy job has `pages: write` and `id-token: write`; only the tag job has `contents: write`. `persist-credentials: false` on the build checkout. No secrets are used. |
| Untrusted data reaching a shell | No data value is put in a `run:` line, `$GITHUB_OUTPUT` or `$GITHUB_ENV`; the event name is passed through `env`. |
| Bad data deployed | The validator (strict CSP, no inline script or handler, iframe rules, licence links) and the leak scan run on the built output before deploy; a failure stops the deploy. |
| Stale pages | The figures that change load in the browser from data.promptugal.news; conductor.b@ checks each site's `/version.json` and latest run hourly. |
| Actions pinned by tag, not commit | Open: the template pins actions by major version. Recorded for security@. |
