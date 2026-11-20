#!/usr/bin/env bash
# The attestation of GitHub-made merges (security@'s ruling a4e915600, items f and g; the pre-review's hardening).
# Run in CI only, from the anchor's trusted copy, after the signature check has listed each GitHub merge that passed
# (a) to (e) as "<merge sha> <second parent>" in $1. For each one:
#  (f) GitHub's API shows a merged pull request into dev whose merge_commit_sha is the merge and whose head.sha is the
#      second parent;
#  (g) a pull_request run of this workflow (.github/workflows/pages.yml) on exactly that head succeeded, and its job named
#      "security" succeeded.
# Anything else fails. The push-time checks (a) to (e) remain the real gate: a pull request runs its own copy of the
# workflow, so (g) is evidence, not proof. Needs GH_TOKEN and REPO; reads only.
set -euo pipefail
list="$1"
[ -s "$list" ] || { echo "attestation: no GitHub-made merge in this push"; exit 0; }
while read -r merge head; do
  printf '%s %s' "$merge" "$head" | grep -Eq '^[0-9a-f]{40} [0-9a-f]{40}$' || { echo "attestation: a malformed line" >&2; exit 1; }
  pr=""
  for i in 1 2 3 4 5; do # the API can lag a merge by some seconds
    pr=$(gh api "repos/$REPO/commits/$merge/pulls" </dev/null --jq "[.[] | select(.base.ref == \"dev\" and .merged_at != null and .merge_commit_sha == \"$merge\" and .head.sha == \"$head\")] | length" || echo 0)
    [ "$pr" = "1" ] && break; sleep $((i * 3))
  done
  [ "$pr" = "1" ] || { echo "attestation: ${merge:0:8} is not the merge commit of exactly one merged pull request into dev from ${head:0:8} (f)" >&2; exit 1; }
  run=$(gh api </dev/null "repos/$REPO/actions/workflows/pages.yml/runs?head_sha=$head&event=pull_request&per_page=20" --jq "[.workflow_runs[] | select(.path == \".github/workflows/pages.yml\" and .head_sha == \"$head\" and .event == \"pull_request\" and .conclusion == \"success\")][0].id // empty" || true)
  printf '%s' "$run" | grep -Eq '^[0-9]+$' || { echo "attestation: no successful pull_request run of pages.yml on ${head:0:8} (g)" >&2; exit 1; }
  ok=$(gh api "repos/$REPO/actions/runs/$run/jobs?per_page=50" </dev/null --jq '[.jobs[] | select(.name == "security" and .conclusion == "success")] | length' || echo 0)
  [ "$ok" = "1" ] || { echo "attestation: the security job did not pass on ${head:0:8} (g)" >&2; exit 1; }
  echo "attestation: ${merge:0:8} merges a pull request whose head ${head:0:8} passed the security job"
done < "$list"
