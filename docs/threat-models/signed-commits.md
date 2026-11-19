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
- Tests: `tests/check-signatures.test.mjs` (27 cases in throwaway repositories with throwaway keys; each failing case must
  fail for its stated reason).

## Threats and controls
| Threat | Control |
|---|---|
| An unsigned commit, or one signed by an unlisted key | Fails: the signature must verify against the keys in the commit's parent's `team/keys.json`. One failure fails the whole range and nothing deploys. |
| A commit named as a bot or CI to be waved through | No exemption by name or author. CI makes no commits here. |
| A commit that adds its own key and signs with it | Keys come from the parent, never from the commit's own tree; there is no self-keyed bootstrap (the key was published in an unsigned commit, the base, before the check existed). |
| A root (orphan) commit carrying its own keys, merged in | Fails: a commit with no parent after the base has no keys to be checked against. |
| Deleting the check file to skip the check | Skipping is by ancestry (the base and its ancestors only), not by whether the tree holds the file. |
| A push that weakens the check that judges it | In CI the check runs as the previous head of dev had it (`git show <before>:scripts/check-signatures.mjs`); a previous head without the check stops the deploy, except the one push whose previous head is the base. The workflow file itself can still be changed by a push; branch protection is Dinis's to add later (19 Nov, about 03:15 UTC), so until then a person reviewing pushes is the remaining control. |
| A side branch keeping a removed or superseded key alive | The key must also be listed, and not superseded, in the pushed head's `team/keys.json`; a superseded key fails whatever the commit's date. |
| A tag or a dropped CI run narrowing what is checked | CI checks the whole history after the base on every push, not a range from a tag. |
| A force-push (a range that does not run forwards) | A start that is not an ancestor of the end fails. Branch protection against force-pushes is the real control, and is Dinis's to add. |
| One key listed twice with different sessions | A fingerprint listed twice is not used. |
| Two keys for one agent, one judged by the other's session | The key is found by its fingerprint from the signature, not by the principal. |
| Principals that inject options into the allowed-signers file | Only plain agent names are accepted; any other entry is not used. Only Ed25519 keys are used. |
| Duplicate or conflicting trailers | Exactly one `Agent:` and one `Claude-Session:`; the session is compared in full. |
| A shallow clone hiding history (and orphans) | Refused by the check and by the workflow step (security@'s control 6, 19 Nov 2026). |
| ssh-keygen missing in CI | The check stops at once and says so, rather than reporting every commit as unsigned. |
| The private key leaking | It is never read by any script here; the leak scan fails any private key header in any file, with no exemption. |

## What is left
- Branch protection (Dinis's, later) to stop a push changing the workflow.
- A new session taking over the role publishes its own key in a commit signed by a listed key (or a person's), and the old
  entry is marked superseded.
