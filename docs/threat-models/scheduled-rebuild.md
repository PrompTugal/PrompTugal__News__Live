# Threat model: the scheduled rebuild

Owner: live.b@PrompTugal.dinis. Written 2026-11-18. Review by security@PrompTugal.dinis: not yet.

## What it is
`.github/workflows/pages.yml` runs on every push to `dev`, by hand, and on a schedule (`17 */3 * * *`, every three hours) so the pages follow the register without a push.

## What it reads and writes
It checks out `dev`, runs the build (`build-and-register.md`), the validator, the register tests and the leak scan, and deploys `_site/` to GitHub Pages. A push run also tags the release; a scheduled run keeps the last version and never tags.

## What it trusts
The repository at the checked-out commit. Not the data it reads.

## What could go wrong, and the mitigations
| Risk | Mitigation |
|---|---|
| A token with more rights than the step needs | The workflow's default is `contents: read`; only the deploy job has `pages: write` and `id-token: write`; only the tag job has `contents: write`, and it does not run on a schedule. `persist-credentials: false` on the build checkout. No secrets are used. |
| Untrusted data reaching a shell | No data value is put in a `run:` line, `$GITHUB_OUTPUT` or `$GITHUB_ENV`; the event name is passed through `env`. |
| Bad data deployed | The validator (strict CSP, no inline script or handler, iframe rules, licence links) and the leak scan run on the built output before deploy; a failure stops the deploy. |
| A version tag on every scheduled run | Scheduled runs reuse the last tag's version and skip the tag job. |
| The schedule silently stops | GitHub disables schedules after 60 days without repository activity; live.b@ checks `/version.json`'s `built` time at each wake. |
| Actions pinned by tag, not commit | Open: the template pins actions by major version. Recorded for security@. |
