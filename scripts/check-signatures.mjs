// Every commit after the pinned base is signed by the agent named in its Agent: trailer, with an SSH key that agent
// published in team/keys.json, and names the Claude-Session: published with that key (Dinis, 18 and 19 Nov 2026:
// PrompTugal__News__Website board/guidance/2026-11-19-signed-commits-paid-search-and-free-embeds.md, section 2).
// live.b@PrompTugal.dinis, 19 Nov 2026. Adapted from data.b@PrompTugal.dinis's scripts/check-signatures.mjs
// (PrompTugal__News__Data f68beb3, Apache-2.0, same estate), hardened after live's security pre-review (19 Nov, ~10:30 UTC).
// Usage: node scripts/check-signatures.mjs <before> <after>   (the pushed range, before..after)
//
// security@'s five controls: (1) no exemption by name; (2) keys from the parent's team/keys.json (a merge: its first
// parent); (3) every commit in the range, merges and side branches included; (4) one failure fails the whole range
// (exit 1, and nothing deploys); (5) Agent: and the full Claude-Session: match the key.
// And from the pre-review:
// - BASE is pinned here: the commit that published live.b@'s key. A commit that is BASE or one of its ancestors is older
//   than the check and skipped; every other commit is checked, whatever its tree holds (deleting this file skips nothing).
// - No commit is ever checked against keys in its own tree: a commit with no parent after BASE fails.
// - BASE must be an ancestor of <after>, or the whole range fails.
// - The key is found by its fingerprint, not by its principal; it must still be listed, and not superseded, in <after>'s
//   team/keys.json too, so a removed key stops working on every branch.
// - A key entry is used only if it is Ed25519, its principals are plain agent names, its session is a full session URL,
//   and any ssh_signing.public_key line it carries is the same key.
// - Exactly one Agent: and one Claude-Session: trailer.
// - A <before> that is not an ancestor of <after> fails; a fingerprint listed twice is not used; a superseded key fails
//   whatever the commit's date. (The AppSec post-review, 19 Nov 2026.)
// - A shallow clone is refused (security@'s control 6). Controls 6 and 7 are in the standard from 19 Nov 2026 (a21986a69).
// In CI the workflow checks the whole history after BASE, with this file as the previous head of dev had it.
// A merge commit made by GitHub (pull-request releases; cells.b@'s request and security@'s ruling a4e915600, 20 Nov 2026)
// passes without an agent signature only if (a) its gpg signature verifies against a web-flow key pinned in the trusted
// tree named by $WEBFLOW_KEYS_FROM (in CI the anchor A; team/github-web-flow.json lists every key, retired ones kept, each
// with its fingerprint and its .asc file; the pre-review: never the merge's own parents), (b) its committer is exactly
// GitHub <noreply@github.com>, (c) it has two parents and the first is verified, (d) every commit it brings in passed the
// agent check here, and (e) git merge-tree of its parents gives exactly its tree. Such a commit is written to $WEBFLOW_OUT
// for the workflow's attestation step, which checks (f) the merged pull request and (g) its green security check. With no
// pinned key, every such commit fails.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPublicKey, createHash } from 'node:crypto';

const BASE = '6a259197f52db7e78eb0d0d6eb035ac478b23d1e';
const PRINCIPAL = /^[a-z0-9.-]+@(?:[A-Za-z][A-Za-z0-9-]*\.)+[A-Za-z][A-Za-z0-9-]*$/; // role@Org.person: no space, quote, * or ?
const SESSION = /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]{8,64}$/;

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...a) => { try { return git(...a); } catch { return null; } };
const ok = (...a) => spawnSync('git', a, { stdio: 'ignore' }).status === 0;
const lines = (s) => (s ? s.split('\n').filter(Boolean) : []);
const fail = (msg) => { console.error(`check-signatures: ${msg}`); process.exit(1); };

const pre = spawnSync('ssh-keygen', ['-Y', 'help'], { encoding: 'utf8' });
if (pre.error) fail(`ssh-keygen is not available (${pre.error.code}): nothing can be verified, so nothing passes`);

// a shallow clone hides commits, and with them orphans and unsigned history (security@'s control 6, 19 Nov 2026)
if (tryGit('rev-parse', '--is-shallow-repository') !== 'false') fail('this is a shallow clone (or not a repository): fetch the whole history first');
const [beforeArg, afterArg] = process.argv.slice(2);
const after = tryGit('rev-parse', '--verify', '--quiet', `${afterArg || 'HEAD'}^{commit}`);
if (!after) fail(`${afterArg || 'HEAD'} is not a commit`);
if (!tryGit('rev-parse', '--verify', '--quiet', `${BASE}^{commit}`)) fail(`the pinned base ${BASE.slice(0, 8)} is not in this repository`);
if (!ok('merge-base', '--is-ancestor', BASE, after)) fail(`the pinned base ${BASE.slice(0, 8)} is not an ancestor of ${after.slice(0, 8)}`);
const before = beforeArg && !/^0+$/.test(beforeArg) && tryGit('rev-parse', '--verify', '--quiet', `${beforeArg}^{commit}`);
// a range must run forwards: a <before> that is not an ancestor of <after> (a force-push) fails (the AppSec post-review)
if (before && !ok('merge-base', '--is-ancestor', before, after)) fail(`${before.slice(0, 8)} is not an ancestor of ${after.slice(0, 8)}: the range does not run forwards`);
// parents before children, so a merge's first parent is checked before the merge (the web-flow path, (c))
const commits = lines(git('rev-list', '--topo-order', '--reverse', before ? `${before}..${after}` : after));

// Ed25519 SPKI PEM -> the OpenSSH line and its SHA256 fingerprint, as ssh-keygen prints it
const len = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
function sshOf(pem) {
  const k = createPublicKey(pem);
  if (k.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
  const x = Buffer.from(k.export({ format: 'jwk' }).x, 'base64url');
  if (x.length !== 32) throw new Error('bad key');
  const t = Buffer.from('ssh-ed25519'), blob = Buffer.concat([len(t.length), t, len(x.length), x]);
  return { line: 'ssh-ed25519 ' + blob.toString('base64'), fp: 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '') };
}
function keysAt(rev) {
  let j; try { j = JSON.parse(git('show', `${rev}:team/keys.json`)); } catch { return []; }
  const all = (Array.isArray(j.keys) ? j.keys : []).flatMap((k) => {
    try {
      if (!k || !k.ssh || typeof k.ssh.public_key_pem !== 'string') return [];
      const principals = Array.isArray(k.ssh.principals) ? k.ssh.principals : [];
      if (!principals.length || !principals.every((p) => typeof p === 'string' && PRINCIPAL.test(p))) return [];
      if (typeof k.session !== 'string' || !SESSION.test(k.session)) return [];
      const s = sshOf(k.ssh.public_key_pem);
      if (k.ssh_signing && k.ssh_signing.public_key && k.ssh_signing.public_key !== s.line) return [];
      const superseded = k.superseded ? Date.parse(k.superseded) : null;
      if (k.superseded && !Number.isFinite(superseded)) return [];
      return [{ principals, session: k.session, superseded, ...s }];
    } catch { return []; }
  });
  // a fingerprint listed twice is ambiguous (which session, which supersession?): neither entry is used
  return all.filter((k) => all.filter((o) => o.fp === k.fp).length === 1);
}
const dir = mkdtempSync(join(tmpdir(), 'sigs-'));
let n = 0;
const allowedFile = (keys) => { const f = join(dir, `allowed_${n++}`); writeFileSync(f, keys.flatMap((k) => k.principals.map((p) => `${p} namespaces="git" ${k.line}`)).join('\n') + '\n'); return f; };
const afterKeys = keysAt(after);

const failures = [];
let checked = 0, skipped = 0;
const passedAgent = new Set(), passedAny = new Set(), webflow = [];
const WEBFLOW_COMMITTER = 'GitHub <noreply@github.com>';
const PGP_PUBLIC_BEGIN = ['-----BEGIN PGP', 'PUBLIC', 'KEY BLOCK-----'].join(' '); // in parts, so the leak scan's key rule stays as it is
const gitVer = (tryGit('version') || '').match(/(\d+)\.(\d+)/);
const mergeTreeOk = gitVer && (Number(gitVer[1]) > 2 || (Number(gitVer[1]) === 2 && Number(gitVer[2]) >= 38));
const verified = (p) => passedAny.has(p) || ok('merge-base', '--is-ancestor', p, BASE) || (before && ok('merge-base', '--is-ancestor', p, before));
// The web-flow path: null when it passes, else the reason
function webflowReason(c) {
  const committer = git('log', '-1', '--format=%cn <%ce>', c);
  if (committer !== WEBFLOW_COMMITTER) return null; // not GitHub's: the agent path's reason stands
  const ps = git('log', '-1', '--format=%P', c).split(' ').filter(Boolean);
  if (ps.length !== 2) return 'a GitHub-made commit that is not a two-parent merge (a web edit, a squash or a rebase)';
  const [p1, p2] = ps;
  if (!verified(p1)) return 'a GitHub-made merge whose first parent is not verified';
  const from = process.env.WEBFLOW_KEYS_FROM || '';
  const fromRev = from && tryGit('rev-parse', '--verify', '--quiet', `${from}^{commit}`);
  if (!fromRev) return 'a GitHub-made merge, but no trusted tree to read the web-flow keys from (WEBFLOW_KEYS_FROM)';
  let pin; try { pin = JSON.parse(git('show', `${fromRev}:team/github-web-flow.json`)); } catch { return 'a GitHub-made merge, but no web-flow key is pinned in the trusted tree'; }
  const keys = (Array.isArray(pin?.keys) ? pin.keys : []).filter((k) => k && typeof k.fingerprint === 'string' && /^[0-9A-F]{40}$/.test(k.fingerprint) && typeof k.file === 'string' && /^team\/[A-Za-z0-9._-]+\.asc$/.test(k.file));
  if (!keys.length) return 'a GitHub-made merge, but the pinned web-flow keys are malformed';
  if (spawnSync('gpg', ['--version'], { stdio: 'ignore' }).error) return 'a GitHub-made merge, but gpg is not available: nothing can be verified';
  let signedBy = null;
  for (const k of keys) {
    let armored = ''; try { armored = git('show', `${fromRev}:${k.file}`); } catch { continue; }
    if (!armored.startsWith(PGP_PUBLIC_BEGIN)) continue;
    const home = mkdtempSync(join(tmpdir(), 'wf-'));
    try {
      const env = { ...process.env, GNUPGHOME: home };
      const imp = spawnSync('gpg', ['--batch', '--quiet', '--import'], { input: armored + '\n', env, encoding: 'utf8' });
      const pubs = lines(spawnSync('gpg', ['--batch', '--with-colons', '--list-keys'], { env, encoding: 'utf8' }).stdout).filter((l) => l.startsWith('pub:'));
      if (imp.error || imp.status !== 0 || pubs.length !== 1) continue; // each file holds exactly one primary key
      const v = spawnSync('git', ['-c', 'gpg.program=gpg', 'verify-commit', '--raw', c], { env, encoding: 'utf8' });
      const st = String(v.stderr || '') + String(v.stdout || '');
      // git exits 0 for a good but untrusted signature: the status lines decide; an expired or revoked key never passes
      if (/^\[GNUPG:\] (EXPKEYSIG|REVKEYSIG|EXPSIG|BADSIG|ERRSIG) /m.test(st) || !/^\[GNUPG:\] GOODSIG /m.test(st)) continue;
      const vs = /^\[GNUPG:\] VALIDSIG ([0-9A-F]{40}) (?:\S+ ){8}([0-9A-F]{40})/m.exec(st); // the signing key, then its primary
      // a retired key (rotated out, or leaked) verifies only merges already attested in an earlier run, before
      // $WEBFLOW_SINCE (the AppSec post-review)
      const since = process.env.WEBFLOW_SINCE || '';
      if (vs && vs[2] === k.fingerprint && (!k.retired || (since && ok('merge-base', '--is-ancestor', c, since)))) { signedBy = k.fingerprint; break; }
    } finally { spawnSync('gpgconf', ['--kill', 'all'], { env: { ...process.env, GNUPGHOME: home }, stdio: 'ignore' }); rmSync(home, { recursive: true, force: true }); }
  }
  if (!signedBy) return 'a GitHub-made merge not signed by a pinned web-flow key';
  const brought = lines(git('rev-list', `${p1}..${p2}`));
  const unchecked = brought.filter((x) => !passedAgent.has(x));
  if (!brought.length || unchecked.length) return `a GitHub-made merge bringing in ${unchecked.length || 'no'} commit(s) that did not pass the agent check`;
  if (!mergeTreeOk) return 'a GitHub-made merge, but this git is older than 2.38 (no merge-tree --write-tree)';
  const mt = spawnSync('git', ['merge-tree', '--write-tree', p1, p2], { encoding: 'utf8' });
  if (mt.status !== 0 || String(mt.stdout).split('\n')[0].trim() !== git('rev-parse', `${c}^{tree}`)) return "a GitHub-made merge whose tree is not the clean merge of its parents";
  // only merges after the trusted start of this push go to the attestation step ($WEBFLOW_SINCE, in CI the range start)
  const since = process.env.WEBFLOW_SINCE || '';
  if (!since || !ok('merge-base', '--is-ancestor', c, since)) webflow.push(`${c} ${p2}`);
  return '';
}
for (const c of commits) {
  const short = c.slice(0, 8);
  if (ok('merge-base', '--is-ancestor', c, BASE)) { skipped++; continue; } // BASE or older: before the check
  checked++;
  const nBefore = failures.length;
  agentCheck(c, short);
  if (failures.length === nBefore) { passedAgent.add(c); passedAny.add(c); continue; }
  const w = webflowReason(c);
  if (w === '') { failures.length = nBefore; passedAny.add(c); continue; }
  if (w) failures[failures.length - 1] = `${short}: ${w}`;
}
function agentCheck(c, short) {
  const parent = git('log', '-1', '--format=%P', c).split(' ')[0] || '';
  if (!parent) { failures.push(`${short}: a root commit after the pinned base (no parent to take keys from)`); return; }
  const keys = keysAt(parent);
  if (!keys.length) { failures.push(`${short}: no usable key in its parent's team/keys.json`); return; }
  const agents = lines(git('log', '-1', '--format=%(trailers:key=Agent,valueonly)', c)).map((s) => s.trim());
  const sessions = lines(git('log', '-1', '--format=%(trailers:key=Claude-Session,valueonly)', c)).map((s) => s.trim());
  if (agents.length !== 1) { failures.push(`${short}: needs exactly one Agent: trailer (has ${agents.length})`); return; }
  if (sessions.length !== 1) { failures.push(`${short}: needs exactly one Claude-Session: trailer (has ${sessions.length})`); return; }
  const v = spawnSync('git', ['-c', 'gpg.format=ssh', '-c', `gpg.ssh.allowedSignersFile=${allowedFile(keys)}`, '-c', 'gpg.ssh.program=ssh-keygen', 'verify-commit', '--raw', c], { encoding: 'utf8' });
  if (v.error) { failures.push(`${short}: could not run git verify-commit (${v.error.code})`); return; }
  const out = String(v.stderr || '') + String(v.stdout || '');
  const good = v.status === 0 && /Good "git" signature for (\S+) with \S+ key (SHA256:[A-Za-z0-9+/]+)/.exec(out);
  if (!good) { failures.push(`${short}: not signed by a key in its parent's team/keys.json`); return; }
  const [, principal, fp] = good;
  const key = keys.find((k) => k.fp === fp);
  if (!key || !key.principals.includes(principal)) { failures.push(`${short}: signed by a key its parent's team/keys.json does not list for ${principal}`); return; }
  if (!key.principals.includes(agents[0])) { failures.push(`${short}: signed by ${principal}, but its Agent: is ${agents[0]}`); return; }
  // superseded means unusable for any commit checked here, whatever its date (a committer date can be set by the signer;
  // the AppSec post-review): commits signed before a supersession are older than the range or were checked when made
  if (key.superseded) { failures.push(`${short}: signed with a key superseded on ${new Date(key.superseded).toISOString()}`); return; }
  const now = afterKeys.find((k) => k.fp === fp);
  if (!now) { failures.push(`${short}: its key is not listed in team/keys.json at ${after.slice(0, 8)}`); return; }
  if (now.superseded) { failures.push(`${short}: its key is superseded in team/keys.json at ${after.slice(0, 8)}`); return; }
  if (sessions[0] !== key.session) { failures.push(`${short}: Claude-Session: ${sessions[0]} is not the session published with the key`); return; }
}
if (process.env.WEBFLOW_OUT) writeFileSync(process.env.WEBFLOW_OUT, webflow.map((l) => l + '\n').join(''));
rmSync(dir, { recursive: true, force: true });
if (failures.length) fail(`${failures.length} commit(s) fail\n` + failures.join('\n'));
console.log(`OK (${checked} commits checked, ${skipped} at or before the pinned base)`);
