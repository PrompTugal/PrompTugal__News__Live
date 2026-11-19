# Threat model: signed commits

live.b@PrompTugal.dinis, 19 November 2026. At Dinis's word (PrompTugal__News__Website
board/guidance/2026-11-19-signed-commits-paid-search-and-free-embeds.md, section 2): every agent signs its commits with the
key it published in the repository it maintains, and names its session.

## What it is
- live.b@'s key: Ed25519, made in its own session with ssh-keygen. The public half is in `team/keys.json` (entry
  `live-b-ssh-signing`, with the full session URL and the principal `live.b@PrompTugal.dinis`). The private half is in the
  session only (a 0600 file outside the repository), never in a commit, page, log or message, and ends with the session.
- Every commit after the pinned base (6a25919, the commit that published the key) is signed. `scripts/check-signatures.mjs`
  checks every commit in the pushed range, in `scripts/release.sh` before each push and in CI before anything deploys.
- Tests: `tests/check-signatures.test.mjs` (43 cases in throwaway repositories with throwaway keys; each failing case must
  fail for its stated reason).

## Threats and controls
| Threat | Control |
|---|---|
| An unsigned commit, or one signed by an unlisted key | Fails: the signature must verify against the keys in the commit's parent's `team/keys.json`. One failure fails the whole range and nothing deploys. |
| A commit named as a bot or CI to be waved through | No exemption by name or author. CI makes no commits here. |
| A commit that adds its own key and signs with it | Keys come from the parent, never from the commit's own tree; there is no self-keyed bootstrap (the key was published in an unsigned commit, the base, before the check existed). |
| A root (orphan) commit carrying its own keys, merged in | Fails: a commit with no parent after the base has no keys to be checked against. |
| Deleting the check file to skip the check | Skipping is by ancestry (the base and its ancestors only), not by whether the tree holds the file (control 8; tested: a commit that removes the checker and adds an unsigned change fails). |
| A push that weakens a check that judges it | In CI every security check runs from the anchor's tree, with its config. The anchor is the last commit a passing run verified, as GitHub records it: the head of the latest successful push run of this workflow on dev, read with the run's own token. Only GitHub Actions creates runs; a deployment record can be made by anyone with write access, so it is not used (security@'s ruling 0ba439611, from 948820a7e's deployment sha). That covers the signature check, the trailer check (and its exemptions file) and the leak scan (with its allow list). No anchor, an anchor missing any of them, or an anchor that is not an ancestor of the push stops the deploy; there is no fallback (security@'s control 7, widened, 19 Nov 2026). The pinned base cannot be overridden by any setting. The functional build uses the pushed tree. The workflow file itself can still be changed by a push; branch protection is Dinis's to add later (19 Nov, about 03:15 UTC), so until then a person reviewing pushes is the remaining control. |
| A side branch keeping a removed or superseded key alive | The key must also be listed, and not superseded, in the pushed head's `team/keys.json`; a superseded key fails whatever the commit's date. |
| A tag or a dropped CI run narrowing what is checked | No tag is trusted. The signature check covers the whole history after the base on every push, and the trailer check covers the anchor to the push, so commits from dropped runs are checked. |
| A force-push (a range that does not run forwards) | A start that is not an ancestor of the end fails, in the check and in the workflow step that takes the checks from the previous head (which also fails on a zero or missing previous head). A release tag counts only if it is an ancestor of the previous head (security@'s ruling 3724c9ca2). Branch protection against force-pushes is the real control, and is Dinis's to add. |
| One key listed twice with different sessions | A fingerprint listed twice is not used. |
| Two keys for one agent, one judged by the other's session | The key is found by its fingerprint from the signature, not by the principal. |
| Principals that inject options into the allowed-signers file | Only plain agent names are accepted; any other entry is not used. Only Ed25519 keys are used. |
| Duplicate or conflicting trailers | Exactly one `Agent:` and one `Claude-Session:`; the session is compared in full. |
| A shallow clone hiding history (and orphans) | Refused by the check and by the workflow step (security@'s control 6, 19 Nov 2026). |
| A pushed build step tampering with the checks' job (GITHUB_ENV, GITHUB_PATH, NODE_OPTIONS, replace objects, symlinks) | The checks run in their own job, which runs no pushed code: it checks the push out as data, takes the checks from the anchor into RUNNER_TEMP, and runs them with node by its absolute path, NODE_OPTIONS cleared and GIT_NO_REPLACE_OBJECTS=1; a symlink on the checks' paths is refused; the built site reaches it only as an artifact; deploy and the release tag need it (security@'s control 9, ruling 16402a95c). |
| A symlink in the built site, a pushed .gitattributes or .gitignore, or deployed bytes other than the scanned ones | The security job refuses a symlink or special file in the downloaded site before any trusted file exists; turns attributes off (below); runs the leak scan on the tree as pushed, deleting or replacing nothing first, so every pushed file is read; then gives the trailer check the anchor's exemptions in place of the pushed ones (a pushed .gitignore can hide only untracked files, and the only untracked paths are the built site, which the scan walks itself, and the trusted copy; the 16:30 AppSec review); and makes the Pages artifact itself from the site it scanned. The leak scan never follows a symlink and fails on any binary file not on its list (only the preview PNG, still scanned for key shapes). (events.b@, library.b@ and signals.b@'s findings, 19 Nov 2026.) |
| A pushed `_site` symlink that the artifact download would write through (into .git or a cached action) | The site is downloaded outside the checkout, vetted for symlinks and special files, and only then moved in; a push that carries any `_site` path is refused; pushed .gitattributes are turned off (next row). |
| A pushed .gitattributes (`* -diff` or similar) that hides blobs from the leak scan's `git log -p`; removing it from the working tree leaves the index copy in force | The security job reads attributes from the empty tree (`GIT_ATTR_SOURCE`, in the job and in every step), refuses a git older than 2.42, and checks that no tracked file has any attribute set before any check runs. The pushed copies stay on disk, so the leak scan reads them. Tested with a push carrying `* -diff` in the index, a git reporting 2.41, and a git that ignores the variable (events.b@'s finding e774ff9, via conductor.b@, 19 Nov 16:25 UTC). |
| A quoting slip in a workflow run block (an apostrophe in a single-quoted `node -e`) that breaks or changes a step | A test parses every run block of every workflow with `bash -n` (cyber.b@'s finding 4dd8500, via conductor.b@). |
| A pushed workflow without the security job becoming the anchor | The anchor run must have run and passed a job named security. A pushed rewrite that keeps a job of that name but weakens it is still possible: only branch protection with a required check closes it (Dinis's). |
| A manual run on another branch deploying | The security, deploy and tag jobs run only for refs/heads/dev. |
| ssh-keygen missing in CI | The check stops at once and says so, rather than reporting every commit as unsigned. |
| The private key leaking | It is never read by any script here; the leak scan fails any private key header in any file, with no exemption. |

## What is left
- Branch protection (Dinis's, later) to stop a push changing the workflow.
- A new session taking over the role publishes its own key in a commit signed by a listed key (or a person's), and the old
  entry is marked superseded.
