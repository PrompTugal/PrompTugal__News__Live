#!/usr/bin/env node
// Tests for scripts/check-signatures.mjs: security@'s five controls and live's pre-review findings (19 Nov 2026).
// live.b@PrompTugal.dinis. Adapted from data.b@PrompTugal.dinis's scripts/test-check-signatures.mjs
// (PrompTugal__News__Data f68beb3, Apache-2.0). Builds throwaway repositories with throwaway keys made for the test and
// deleted after; no agent's key is read. Each test repository sets gpg.ssh.program=ssh-keygen itself (the machine's
// global config names another signer: data.b@'s pitfall), and a failing case passes only when the check fails for the
// expected reason. Prints OK or the failing cases and exits 1.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-signatures.mjs'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'sigtest-'));
const AGENT = 'tester@Example.test', SESSION = 'https://claude.ai/code/session_0TestSessionAbcdef01234';
const OTHER_SESSION = 'https://claude.ai/code/session_0OtherSessionAbcdef9876';
const results = [];

const newKey = (name) => {
  const f = join(tmp, name);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', f]);
  const line = readFileSync(f + '.pub', 'utf8').trim().split(/\s+/).slice(0, 2).join(' ');
  const raw = Buffer.from(line.split(' ')[1], 'base64').subarray(-32);
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
  const D = '-'.repeat(5); // built from parts, so this file holds no key header
  const pem = `${D}BEGIN PUBLIC KEY${D}\n${der.toString('base64')}\n${D}END PUBLIC KEY${D}\n`;
  return { f, line, pem };
};
const entry = (id, k, extra = {}) => ({ id, agent: AGENT, session: SESSION, ssh: { public_key_pem: k.pem, principals: [AGENT] }, ...extra });
const keysWith = (...e) => JSON.stringify({ keys: e }, null, 1);

function repo(name) {
  const d = join(tmp, name); mkdirSync(d); mkdirSync(join(d, 'team'));
  const g = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 'tester'); g('config', 'user.email', 'tester@example.test');
  g('config', 'gpg.format', 'ssh'); g('config', 'gpg.ssh.program', 'ssh-keygen'); g('config', 'commit.gpgsign', 'false');
  const commit = (msg, { key, agent = AGENT, session = SESSION, files = {}, author, trailers } = {}) => {
    for (const [p, c] of Object.entries(files)) writeFileSync(join(d, p), c);
    g('add', '-A');
    const t = trailers ?? `Agent: ${agent}\nClaude-Session: ${session}`;
    g('-c', 'gpg.format=ssh', ...(key ? ['-c', `user.signingkey=${key.f}`] : []), 'commit', '-q', '--allow-empty', ...(key ? ['-S'] : ['--no-gpg-sign']), ...(author ? ['--author', author] : []), '-m', msg, '-m', t);
    return g('rev-parse', 'HEAD');
  };
  let script = '';
  const pin = (base) => { script = join(tmp, `check-${name}.mjs`); writeFileSync(script, SRC.replace(/const BASE = '[0-9a-f]{40}';/, `const BASE = '${base}';`)); };
  const check = (before, after) => spawnSync('node', [script, before, after], { cwd: d, encoding: 'utf8' });
  return { d, g, commit, pin, check, get script() { return script; } };
}
const expect = (name, r, pass, why) => { const out = (r.stdout + r.stderr).trim(); results.push({ name, pass: (r.status === 0) === pass && (!why || out.includes(why)), out: out.split('\n').slice(0, 3).join(' | ') }); };

const A = newKey('a'), B = newKey('b');
// the base: an unsigned commit that publishes key A, pinned as the check's BASE (as live's 6a25919 is)
const setup = (name, keys = keysWith(entry('a', A))) => { const r = repo(name); const base = r.commit('base: publish key A', { files: { 'team/keys.json': keys } }); r.pin(base); return { ...r, base }; };

{ const r = setup('good'); r.commit('good', { key: A, files: { 'x.txt': '1' } }); expect('a signed commit with matching Agent and full session passes', r.check(r.base, 'HEAD'), true); }
{ const r = setup('unsigned'); r.commit('unsigned', { files: { 'x.txt': '1' } }); expect('(1) an unsigned commit fails', r.check(r.base, 'HEAD'), false, 'not signed by a key'); }
{ const r = setup('botname'); r.commit('bot', { files: { 'x.txt': '1' }, author: 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>', agent: 'github-actions' }); expect('(1) a commit named as a bot is not exempt', r.check(r.base, 'HEAD'), false, 'not signed by a key'); }
{ const r = setup('selfkey'); r.commit('adds key B and signs with it', { key: B, files: { 'team/keys.json': keysWith(entry('a', A), entry('b', B)) } }); expect('(2) a commit that adds its own key does not pass on it', r.check(r.base, 'HEAD'), false, 'not signed by a key'); }
{ const r = setup('rotated'); r.commit('adds key B, signed with A', { key: A, files: { 'team/keys.json': keysWith(entry('a', A), entry('b', B)) } }); r.commit('signed with B', { key: B, files: { 'x.txt': '2' } }); expect('(2) a key added by a commit signed with a listed key works from the next commit', r.check(r.base, 'HEAD'), true); }
{ const r = setup('merge'); r.g('checkout', '-q', '-b', 'side'); r.commit('side, signed', { key: A, files: { 's.txt': '1' } }); r.g('checkout', '-q', 'main'); r.commit('main, signed', { key: A, files: { 'm.txt': '1' } });
  r.g('-c', 'core.editor=true', 'merge', '-q', '--no-gpg-sign', '--no-ff', '-m', 'merge', '-m', `Agent: ${AGENT}\nClaude-Session: ${SESSION}`, 'side'); expect('(3) an unsigned merge commit fails', r.check(r.base, 'HEAD'), false, 'not signed by a key'); }
{ const r = setup('sidebranch'); r.g('checkout', '-q', '-b', 'side'); r.commit('side, unsigned', { files: { 's.txt': '1' } }); r.g('checkout', '-q', 'main'); r.commit('main, signed', { key: A, files: { 'm.txt': '1' } });
  r.g('-c', 'gpg.format=ssh', '-c', `user.signingkey=${A.f}`, 'merge', '-q', '-S', '--no-ff', '-m', 'merge', '-m', `Agent: ${AGENT}\nClaude-Session: ${SESSION}`, 'side'); expect('(3) an unsigned commit on a merged side branch fails', r.check(r.base, 'HEAD'), false, 'not signed by a key'); }
{ const r = setup('onebad'); r.commit('good 1', { key: A, files: { 'x.txt': '1' } }); r.commit('bad', { files: { 'x.txt': '2' } }); r.commit('good 2', { key: A, files: { 'x.txt': '3' } }); expect('(4) one bad commit among good ones fails the range', r.check(r.base, 'HEAD'), false, '1 commit(s) fail'); }
{ const r = setup('agent'); r.commit('wrong agent', { key: A, agent: 'someone@Example.test', files: { 'x.txt': '1' } }); expect('(5) an Agent: that is not the key\'s agent fails', r.check(r.base, 'HEAD'), false, 'but its Agent: is'); }
{ const r = setup('session'); r.commit('other session', { key: A, session: OTHER_SESSION, files: { 'x.txt': '1' } }); expect('(5) a Claude-Session: other than the key\'s fails', r.check(r.base, 'HEAD'), false, 'is not the session published'); }
{ const r = setup('sessionprefix'); r.commit('session with extra text', { key: A, session: SESSION + 'x', files: { 'x.txt': '1' } }); expect('(5) the session is compared exactly, not as a prefix', r.check(r.base, 'HEAD'), false, 'is not the session published'); }
{ const r = setup('mismatch', keysWith(entry('a', A, { ssh_signing: { public_key: B.line } }))); r.commit('signed with A', { key: A, files: { 'x.txt': '1' } }); expect('a key whose ssh line differs from its PEM is not used', r.check(r.base, 'HEAD'), false, 'no usable key'); }
// the pre-review's findings
{ const r = setup('orphan'); r.commit('main, signed', { key: A, files: { 'm.txt': '1' } }); r.g('checkout', '-q', '--orphan', 'evil'); r.g('rm', '-rq', '--cached', '.');
  r.commit('orphan with its own keys', { key: B, files: { 'team/keys.json': keysWith(entry('b', B)) } }); r.g('checkout', '-q', '-f', 'main');
  r.g('-c', 'gpg.format=ssh', '-c', `user.signingkey=${A.f}`, 'merge', '-q', '-S', '--allow-unrelated-histories', '-X', 'ours', '-m', 'merge', '-m', `Agent: ${AGENT}\nClaude-Session: ${SESSION}`, 'evil');
  expect('(6) an orphan merged in, signed with its own key, fails (never checked against its own keys)', r.check(r.base, 'HEAD'), false, 'a root commit after the pinned base'); }
{ const r = setup('notancestor'); const other = repo('elsewhere'); other.commit('x', { files: { 'team/keys.json': keysWith(entry('a', A)) } }); r.pin(other.g('rev-parse', 'HEAD')); r.commit('signed', { key: A, files: { 'x.txt': '1' } }); expect('the range fails when the pinned base is not in it', r.check(r.base, 'HEAD'), false, 'is not in this repository'); }
{ const r = setup('dupagent'); r.commit('two agents', { key: A, trailers: `Agent: ${AGENT}\nAgent: other@Example.test\nClaude-Session: ${SESSION}`, files: { 'x.txt': '1' } }); expect('two Agent: trailers fail', r.check(r.base, 'HEAD'), false, 'exactly one Agent:'); }
{ const r = setup('dupsession'); r.commit('two sessions', { key: A, trailers: `Agent: ${AGENT}\nClaude-Session: ${SESSION}\nClaude-Session: ${OTHER_SESSION}`, files: { 'x.txt': '1' } }); expect('two Claude-Session: trailers fail', r.check(r.base, 'HEAD'), false, 'exactly one Claude-Session:'); }
{ const r = setup('removed', keysWith(entry('a', A), entry('b', B))); r.commit('signed with B', { key: B, files: { 'x.txt': '1' } }); r.commit('removes key B, signed with A', { key: A, files: { 'team/keys.json': keysWith(entry('a', A)) } });
  expect('a key removed in the newest keys file stops passing on every commit', r.check(r.base, 'HEAD'), false, 'is not listed in team/keys.json at'); }
{ const r = setup('byfingerprint', keysWith(entry('a', A), entry('b', B, { session: OTHER_SESSION }))); r.commit('signed with B, naming A\'s session', { key: B, files: { 'x.txt': '1' } });
  expect('the key is found by its fingerprint, so another key\'s session does not pass', r.check(r.base, 'HEAD'), false, 'is not the session published'); }
{ const r = setup('badprincipal', keysWith(entry('a', A, { ssh: { public_key_pem: A.pem, principals: ['* namespaces="git"'] } }))); r.commit('signed with A', { key: A, files: { 'x.txt': '1' } });
  expect('a key entry with an unsafe principal is not used', r.check(r.base, 'HEAD'), false, 'no usable key'); }
{ const r = setup('superseded', keysWith(entry('a', A, { superseded: '2000-01-01T00:00:00Z' }), entry('b', B))); r.commit('signed with A', { key: A, files: { 'x.txt': '1' } });
  expect('a superseded key fails', r.check(r.base, 'HEAD'), false, 'superseded'); }
{ const r = setup('backdated', keysWith(entry('a', A, { superseded: '2999-01-01T00:00:00Z' }), entry('b', B))); r.commit('signed with A', { key: A, files: { 'x.txt': '1' } });
  expect('a superseded key fails whatever the commit\'s date', r.check(r.base, 'HEAD'), false, 'superseded'); }
{ const r = setup('dupfp', keysWith(entry('a', A), entry('a2', A, { session: OTHER_SESSION }))); r.commit('signed with A', { key: A, files: { 'x.txt': '1' } });
  expect('a fingerprint listed twice is not used', r.check(r.base, 'HEAD'), false, 'no usable key'); }
{ const r = setup('backwards'); const one = r.commit('one', { key: A, files: { 'x.txt': '1' } }); r.g('checkout', '-q', '-b', 'other', r.base); r.commit('two', { key: A, files: { 'y.txt': '1' } });
  expect('a range that does not run forwards fails', r.check(one, 'HEAD'), false, 'does not run forwards'); }
// security@'s control 7: a push that weakens the checker and adds an unsigned commit still fails, because the check run
// is the previous head's copy (git show <before>:scripts/check-signatures.mjs), as the workflow does
{ const r = setup('weakened'); mkdirSync(join(r.d, 'scripts'), { recursive: true });
  const before = r.commit('the check, signed', { key: A, files: { 'scripts/check-signatures.mjs': readFileSync(r.script, 'utf8') } });
  r.commit('weakens the check', { files: { 'scripts/check-signatures.mjs': "console.log('OK');\n" } }); r.commit('unsigned', { files: { 'x.txt': '1' } });
  const trusted = join(tmp, 'trusted-weakened.mjs'); writeFileSync(trusted, r.g('show', `${before}:scripts/check-signatures.mjs`) + '\n');
  const pushed = spawnSync('node', ['scripts/check-signatures.mjs', '', 'HEAD'], { cwd: r.d, encoding: 'utf8' });
  results.push({ name: '(7) the pushed, weakened checker would pass: so it is never the one run', pass: pushed.status === 0, out: (pushed.stdout + pushed.stderr).trim() });
  expect('(7) the previous head\'s checker fails a push that weakens it and adds an unsigned commit', spawnSync('node', [trusted, '', 'HEAD'], { cwd: r.d, encoding: 'utf8' }), false, 'not signed by a key'); }
// security@'s control 6: a shallow clone is refused
{ const r = setup('shallowsrc'); r.commit('signed', { key: A, files: { 'x.txt': '1' } }); r.commit('signed 2', { key: A, files: { 'x.txt': '2' } });
  const d = join(tmp, 'shallow'); execFileSync('git', ['clone', '-q', '--depth', '1', `file://${r.d}`, d]);
  expect('(6) a shallow clone is refused', spawnSync('node', [r.script, '', 'HEAD'], { cwd: d, encoding: 'utf8' }), false, 'shallow clone'); }
{ const r = setup('older'); expect('the base itself and its ancestors are skipped, not failed', r.check(r.base + '~0', 'HEAD'), true); }

rmSync(tmp, { recursive: true, force: true });
const bad = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.pass ? '' : `  [${r.out}]`}`);
if (bad.length) { console.error(`check-signatures tests: ${bad.length} of ${results.length} failed`); process.exit(1); }
console.log(`OK (${results.length} cases)`);
