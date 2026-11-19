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
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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
const commits = lines(git('rev-list', before ? `${before}..${after}` : after));

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
for (const c of commits) {
  const short = c.slice(0, 8);
  if (ok('merge-base', '--is-ancestor', c, BASE)) { skipped++; continue; } // BASE or older: before the check
  checked++;
  const parent = git('log', '-1', '--format=%P', c).split(' ')[0] || '';
  if (!parent) { failures.push(`${short}: a root commit after the pinned base (no parent to take keys from)`); continue; }
  const keys = keysAt(parent);
  if (!keys.length) { failures.push(`${short}: no usable key in its parent's team/keys.json`); continue; }
  const agents = lines(git('log', '-1', '--format=%(trailers:key=Agent,valueonly)', c)).map((s) => s.trim());
  const sessions = lines(git('log', '-1', '--format=%(trailers:key=Claude-Session,valueonly)', c)).map((s) => s.trim());
  if (agents.length !== 1) { failures.push(`${short}: needs exactly one Agent: trailer (has ${agents.length})`); continue; }
  if (sessions.length !== 1) { failures.push(`${short}: needs exactly one Claude-Session: trailer (has ${sessions.length})`); continue; }
  const v = spawnSync('git', ['-c', 'gpg.format=ssh', '-c', `gpg.ssh.allowedSignersFile=${allowedFile(keys)}`, '-c', 'gpg.ssh.program=ssh-keygen', 'verify-commit', '--raw', c], { encoding: 'utf8' });
  if (v.error) { failures.push(`${short}: could not run git verify-commit (${v.error.code})`); continue; }
  const out = String(v.stderr || '') + String(v.stdout || '');
  const good = v.status === 0 && /Good "git" signature for (\S+) with \S+ key (SHA256:[A-Za-z0-9+/]+)/.exec(out);
  if (!good) { failures.push(`${short}: not signed by a key in its parent's team/keys.json`); continue; }
  const [, principal, fp] = good;
  const key = keys.find((k) => k.fp === fp);
  if (!key || !key.principals.includes(principal)) { failures.push(`${short}: signed by a key its parent's team/keys.json does not list for ${principal}`); continue; }
  if (!key.principals.includes(agents[0])) { failures.push(`${short}: signed by ${principal}, but its Agent: is ${agents[0]}`); continue; }
  // superseded means unusable for any commit checked here, whatever its date (a committer date can be set by the signer;
  // the AppSec post-review): commits signed before a supersession are older than the range or were checked when made
  if (key.superseded) { failures.push(`${short}: signed with a key superseded on ${new Date(key.superseded).toISOString()}`); continue; }
  const now = afterKeys.find((k) => k.fp === fp);
  if (!now) { failures.push(`${short}: its key is not listed in team/keys.json at ${after.slice(0, 8)}`); continue; }
  if (now.superseded) { failures.push(`${short}: its key is superseded in team/keys.json at ${after.slice(0, 8)}`); continue; }
  if (sessions[0] !== key.session) { failures.push(`${short}: Claude-Session: ${sessions[0]} is not the session published with the key`); continue; }
}
rmSync(dir, { recursive: true, force: true });
if (failures.length) fail(`${failures.length} commit(s) fail\n` + failures.join('\n'));
console.log(`OK (${checked} commits checked, ${skipped} at or before the pinned base)`);
