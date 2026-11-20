#!/usr/bin/env node
// Tests for scripts/check-signatures.mjs: security@'s five controls and live's pre-review findings (19 Nov 2026).
// live.b@PrompTugal.dinis. Adapted from data.b@PrompTugal.dinis's scripts/test-check-signatures.mjs
// (PrompTugal__News__Data f68beb3, Apache-2.0). Builds throwaway repositories with throwaway keys made for the test and
// deleted after; no agent's key is read. Each test repository sets gpg.ssh.program=ssh-keygen itself (the machine's
// global config names another signer: data.b@'s pitfall), and a failing case passes only when the check fails for the
// expected reason. Prints OK or the failing cases and exits 1.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
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
// security@'s control 8: skipping is by ancestry only, so a commit that deletes the checker skips nothing
{ const r = setup('deleted'); mkdirSync(join(r.d, 'scripts'), { recursive: true });
  r.commit('the check, signed', { key: A, files: { 'scripts/check-signatures.mjs': readFileSync(r.script, 'utf8') } });
  r.g('rm', '-q', 'scripts/check-signatures.mjs'); r.commit('removes the check, unsigned change', { files: { 'x.txt': '1' } });
  expect('(8) a commit that removes the checker and adds an unsigned change fails', r.check(r.base, 'HEAD'), false, 'not signed by a key'); }
// security@'s control 6: a shallow clone is refused
{ const r = setup('shallowsrc'); r.commit('signed', { key: A, files: { 'x.txt': '1' } }); r.commit('signed 2', { key: A, files: { 'x.txt': '2' } });
  const d = join(tmp, 'shallow'); execFileSync('git', ['clone', '-q', '--depth', '1', `file://${r.d}`, d]);
  expect('(6) a shallow clone is refused', spawnSync('node', [r.script, '', 'HEAD'], { cwd: d, encoding: 'utf8' }), false, 'shallow clone'); }
// security@'s control 8 (ruling 3724c9ca2): a backdated orphan fails too; no skip is decided by date
{ const r = setup('backdated-orphan'); r.commit('main, signed', { key: A, files: { 'm.txt': '1' } }); r.g('checkout', '-q', '--orphan', 'old'); r.g('rm', '-rq', '--cached', '.');
  const env = { ...process.env, GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z' };
  writeFileSync(join(r.d, 'o.txt'), '1'); execFileSync('git', ['add', '-A'], { cwd: r.d }); execFileSync('git', ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${B.f}`, 'commit', '-q', '-S', '-m', 'old orphan', '-m', `Agent: ${AGENT}\nClaude-Session: ${SESSION}`], { cwd: r.d, env });
  r.g('checkout', '-q', '-f', 'main'); r.g('-c', 'gpg.format=ssh', '-c', `user.signingkey=${A.f}`, 'merge', '-q', '-S', '--allow-unrelated-histories', '-m', 'merge', '-m', `Agent: ${AGENT}\nClaude-Session: ${SESSION}`, 'old');
  expect('(8) a backdated orphan merged in fails', r.check(r.base, 'HEAD'), false, 'a root commit after the pinned base'); }
// security@'s control 7 (rulings 3724c9ca2 and 948820a7e): the workflow step that takes the checks from the anchor A, the
// last successful github-pages deployment, run as pages.yml has it, with a stand-in for gh that answers as GitHub would
{ const yml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'pages.yml'), 'utf8').split('\n');
  const at = yml.findIndex((l) => l === '      - name: Take the security checks from the last verified commit');
  const run = []; let inRun = false;
  for (const l of yml.slice(at + 1)) { if (/^      - /.test(l)) break; if (/^        run: \|/.test(l)) { inRun = true; continue; } if (inRun) run.push(l.replace(/^          /, '')); }
  const step = join(tmp, 'take-checks.sh'); writeFileSync(step, 'set -e\n' + run.join('\n') + '\n');
  const bin = join(tmp, 'fakebin'); mkdirSync(bin, { recursive: true });
  // the stand-in gh: the latest successful push run of the workflow on dev has head_sha $FAKE_DEPLOYED (none when empty)
  // and that run's jobs include a passed security job ($FAKE_SECURITY_JOBS, default 1)
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\ncase "$2" in\n  */actions/workflows/pages.yml/runs*) [ -n "$FAKE_DEPLOYED" ] && echo "7 $FAKE_DEPLOYED" ;;\n  */actions/runs/7/jobs*) echo "${FAKE_SECURITY_JOBS:-1}" ;;\nesac\nexit 0\n', { mode: 0o755 });
  const r = setup('workflow'); mkdirSync(join(r.d, 'scripts'), { recursive: true });
  const partial = r.commit('only one check', { key: A, files: { 'scripts/check-signatures.mjs': '//\n' } });
  const full = r.commit('all three checks', { key: A, files: { 'scripts/check-commits.mjs': '//\n', 'scripts/leak-scan.mjs': '//\n' } });
  const unverified = r.commit('an unverified commit', { files: { 'z.txt': '1' } }); r.g('tag', 'v0.1.999', unverified);
  const head = r.commit('a change', { key: A, files: { 'x.txt': '1' } });
  r.g('checkout', '-q', '-b', 'forced', r.base); const forced = r.commit('a rewritten history', { key: A, files: { 'y.txt': '1' } }); r.g('checkout', '-q', 'main');
  const rt = join(tmp, 'rt');
  const runStep = (deployed, after, extra = {}, plant) => { rmSync(rt, { recursive: true, force: true }); mkdirSync(join(rt, 'site-download'), { recursive: true }); writeFileSync(join(rt, 'site-download', 'index.html'), 'x');
    rmSync(join(r.d, '_site'), { recursive: true, force: true }); if (plant) plant(join(rt, 'site-download'));
    return spawnSync('bash', [step], { cwd: r.d, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AFTER: after, REPO: 'x/y', GH_TOKEN: 'none', FAKE_DEPLOYED: deployed, RUNNER_TEMP: rt, ...extra } }); };
  const good = runStep(full, head);
  const anchor = good.status === 0 ? readFileSync(join(rt, 'trusted', 'anchor'), 'utf8').trim() : '';
  results.push({ name: '(7) the checks come from the latest successful run, not from a pushed tag on an unverified commit', pass: good.status === 0 && anchor === full, out: (good.stdout + good.stderr).trim() });
  expect('(7) a missing anchor (no successful run) fails', runStep('', head), false, 'no last verified commit');
  expect('(7) an anchor with no copy of a check fails, with no fallback', runStep(partial, head), false, 'has no scripts/check-commits.mjs');
  expect('(7) an anchor that is not an ancestor of AFTER (a force push) fails', runStep(full, forced), false, 'not an ancestor of this push');
  // control 9: a symlink on a path the checks write is refused
  { const real = join(r.d, 'scripts-real'); execFileSync('mv', [join(r.d, 'scripts'), real]); execFileSync('ln', ['-s', real, join(r.d, 'scripts')]);
    expect('(9) a symlink on the checks\' paths is refused', runStep(full, head), false, 'is a symlink');
    rmSync(join(r.d, 'scripts')); execFileSync('mv', [real, join(r.d, 'scripts')]); }
  // events.b@'s finding: a symlink in the downloaded site is refused before any trusted file is written
  expect('a symlink in the downloaded site is refused', runStep(full, head, {}, (dl) => execFileSync('ln', ['-s', '/etc/passwd', join(dl, 'x.txt')])), false, 'symlink or special file');
  // the 16:08 AppSec review: a _site path in the push (a symlink that the download would write through) is refused
  { const rs = runStep(full, head); rmSync(join(r.d, '_site'), { recursive: true, force: true }); execFileSync('ln', ['-s', '.git', join(r.d, '_site')]);
    rmSync(rt, { recursive: true, force: true }); mkdirSync(join(rt, 'site-download'), { recursive: true });
    expect('a _site symlink in the push is refused before the site is moved in', spawnSync('bash', [step], { cwd: r.d, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AFTER: head, REPO: 'x/y', GH_TOKEN: 'none', FAKE_DEPLOYED: full, RUNNER_TEMP: rt } }), false, 'carries a _site path');
    rmSync(join(r.d, '_site'), { force: true }); results.push({ name: 'the step moves the vetted site into _site', pass: rs.status === 0, out: (rs.stdout + rs.stderr).trim() }); }
  expect('an anchor run that did not pass the security job is not used', runStep(full, head, { FAKE_SECURITY_JOBS: '0' }), false, 'no last verified commit');
  // pull-request releases: for a pull request the range runs from merge-base(base, head), and the base must lie on dev's
  // verified line (either side of A)
  { const pr = runStep(full, head, { EVENT: 'pull_request', PR_BASE: full }); const from = pr.status === 0 ? readFileSync(join(rt, 'trusted', 'range_from'), 'utf8').trim() : '';
    results.push({ name: '(PR) a pull request is checked from merge-base(base, head)', pass: pr.status === 0 && from === full, out: (pr.stdout + pr.stderr).trim() }); }
  expect('(PR) a pull request whose base is off dev\'s verified history fails', runStep(full, head, { EVENT: 'pull_request', PR_BASE: forced }), false, 'not on the verified history');
  // events.b@'s finding (e774ff9, via conductor.b@ 19 Nov 16:25): rm leaves a pushed .gitattributes in force through the
  // index; the step reads attributes from the empty tree, needs git 2.42 or later, and checks that git honours it
  { rmSync(join(r.d, '_site'), { recursive: true, force: true }); rmSync(join(r.d, 'scripts', 'leak-scan.trusted.mjs'), { force: true }); rmSync(join(r.d, 'scripts', 'commit-exemptions.json'), { force: true });
    const attrHead = r.commit('pushed attributes', { key: A, files: { '.gitattributes': '* -diff\n', 'scripts/commit-exemptions.json': '[]\n' } });
    const inIndex = spawnSync('git', ['check-attr', 'diff', '--', 'x.txt'], { cwd: r.d, encoding: 'utf8' }).stdout;
    const ok = runStep(full, attrHead);
    results.push({ name: 'pushed .gitattributes (also in the index) are turned off, not just deleted', pass: /diff: unset/.test(inIndex) && ok.status === 0, out: inIndex + (ok.stdout + ok.stderr).trim() });
    // the 16:30 AppSec review: nothing pushed is deleted or replaced before the leak scan, so the scan reads it
    const kept = ['.gitattributes', 'scripts/commit-exemptions.json'].every((f) => { try { readFileSync(join(r.d, f)); return true; } catch { return false; } });
    results.push({ name: 'the pushed .gitattributes and exemptions are still on disk for the leak scan', pass: ok.status === 0 && kept, out: (ok.stdout + ok.stderr).trim() });
    // and the trailer step, after the scan, puts A's exemptions (here none) in place of the pushed ones
    { const at2 = yml.findIndex((l) => l.startsWith('      - name: Every commit from the last verified commit carries an Agent trailer'));
      const run2 = []; let in2 = false;
      for (const l of yml.slice(at2 + 1)) { if (/^      - /.test(l)) break; if (/^        run: \|/.test(l)) { in2 = true; continue; } if (in2) run2.push(l.replace(/^          /, '')); }
      const st2 = join(tmp, 'trailer-step.sh'); writeFileSync(st2, 'set -e\n' + run2.join('\n') + '\n');
      writeFileSync(join(rt, 'trusted', 'check-commits.mjs'), "console.log(require('fs').existsSync('scripts/commit-exemptions.json') ? 'pushed exemptions used' : 'no exemptions');\n".replace('require(\'fs\')', "(await import('node:fs'))"));
      const o2 = spawnSync('bash', [st2], { cwd: r.d, encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: rt, AFTER: attrHead } });
      results.push({ name: 'the trailer check runs with the anchor\'s exemptions, not the pushed ones', pass: o2.status === 0 && /no exemptions/.test(o2.stdout), out: (o2.stdout + o2.stderr).trim() });
      r.g('checkout', '-q', '--', 'scripts/commit-exemptions.json'); }
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const fake = (name, body) => { const d = join(tmp, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'git'), `#!/bin/sh\n${body}\nexec ${real} "$@"\n`, { mode: 0o755 }); return `${d}:${bin}:${process.env.PATH}`; };
    expect('a git older than 2.42 (no GIT_ATTR_SOURCE) is refused', runStep(full, attrHead, { PATH: fake('oldgit', 'if [ "$1" = version ]; then echo "git version 2.41.0"; exit 0; fi') }), false, 'older than 2.42');
    expect('a git that ignores GIT_ATTR_SOURCE is refused', runStep(full, attrHead, { PATH: fake('deafgit', 'unset GIT_ATTR_SOURCE') }), false, 'still reads attributes');
  }
  // (1) of ruling 948820a7e: an unsigned commit from a dropped run, between the anchor and the previous head, fails
  expect('(1) an unsigned commit between the anchor and the previous head (a dropped run) fails', spawnSync('node', [r.script, full, head], { cwd: r.d, encoding: 'utf8' }), false, 'not signed by a key'); }
// security@'s control 9 (ruling 16402a95c): the checks run in a job that runs no pushed code; the build reaches it as data
{ const lines = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'pages.yml'), 'utf8').split('\n');
  const from = lines.indexOf('  security:'), to = lines.findIndex((l, i) => i > from && /^  [a-z]+:$/.test(l));
  const job = lines.slice(from, to);
  const uses = job.filter((l) => /^      - (if: .*\n)?uses: /.test(l) || /^        uses: /.test(l) || /^      - uses: /.test(l)).map((l) => l.trim().replace(/^- /, '').slice(6));
  const runsPushed = job.some((l) => /(^|\s|")node\s+(scripts|tests)\//.test(l) || /\bnpm\b|\bnpx\b/.test(l));
  const deploy = lines.slice(lines.indexOf('  deploy:'), lines.indexOf('  deploy:') + 3).join('\n');
  results.push({ name: '(9) the security job uses only checkout, setup-node, download-artifact and upload-pages-artifact, and runs no pushed script', pass: from > 0 && uses.length === 4 && uses.every((u) => /^actions\/(checkout|setup-node|download-artifact|upload-pages-artifact)@v\d+$/.test(u)) && !runsPushed, out: uses.join(', ') });
  const jobIf = (name) => { const i = lines.indexOf(`  ${name}:`); return lines.slice(i + 1, i + 7).find((l) => /^    if: /.test(l)) || ''; };
  results.push({ name: 'the security, deploy and tag jobs run only for dev (a manual run on another branch never deploys)', pass: ['security', 'deploy', 'tag'].every((j) => jobIf(j).includes("github.ref == 'refs/heads/dev'")), out: ['security', 'deploy', 'tag'].map(jobIf).join(' | ') });
  results.push({ name: '(PR) the security job runs on a pull request only into dev, and deploy and tag never on one', pass: /github\.event_name == 'pull_request' && github\.event\.pull_request\.base\.ref == 'dev'/.test(jobIf('security')) && !/pull_request/.test(jobIf('deploy')) && !/pull_request/.test(jobIf('tag')), out: jobIf('security') });
  results.push({ name: '(PR) the security job runs (and fails) when the build fails, never skips: !cancelled() and a build-result step', pass: /!cancelled\(\)/.test(jobIf('security')) && lines.some((l) => l.trim() === "if: needs.build.result != 'success'"), out: jobIf('security') });
  results.push({ name: '(PR) the workflow never uses pull_request_target', pass: !lines.some((l) => /pull_request_target/.test(l) && !/^\s*#/.test(l)), out: '' });
  results.push({ name: '(9) deploy needs the security job', pass: /needs: \[build, security\]/.test(deploy), out: deploy });
  // a pushed build step can set NODE_OPTIONS for later steps of its own job only; each security step clears it anyway
  const at = lines.findIndex((l) => l === '      - name: Signed commits (every commit after the pinned base; the trusted check)');
  const run = []; let inRun = false;
  for (const l of lines.slice(at + 1)) { if (/^      - /.test(l)) break; if (/^        run: \|/.test(l)) { inRun = true; continue; } if (inRun) run.push(l.replace(/^          /, '')); }
  const rt = join(tmp, 'rt9'); mkdirSync(join(rt, 'trusted'), { recursive: true }); writeFileSync(join(rt, 'trusted', 'check-signatures.mjs'), "console.log('ran');\n");
  const marker = join(tmp, 'injected'), evil = join(tmp, 'evil.cjs'); writeFileSync(evil, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
  const step = join(tmp, 'sig-step.sh'); writeFileSync(step, 'set -e\n' + run.join('\n') + '\n');
  const out = spawnSync('bash', [step], { encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: rt, AFTER: 'HEAD', NODE_OPTIONS: `--require ${evil}` } });
  let injected = true; try { readFileSync(marker); } catch { injected = false; }
  results.push({ name: '(9) NODE_OPTIONS set by a pushed step does not reach the trusted check', pass: out.status === 0 && /ran/.test(out.stdout) && !injected, out: (out.stdout + out.stderr).trim() }); }
// Pull-request releases (cells.b@'s request; security@'s ruling a4e915600, 20 Nov 2026): a merge commit made by GitHub
// passes only under (a) to (e), with the web-flow key read from a trusted tree ($WEBFLOW_KEYS_FROM). A stand-in key plays
// GitHub's here; no real key is used.
{ const gh = join(tmp, 'gnupg-webflow'); mkdirSync(gh, { mode: 0o700 }); const genv = { ...process.env, GNUPGHOME: gh };
  const gen = (uid) => { execFileSync('gpg', ['--batch', '--passphrase', '', '--quick-gen-key', uid, 'ed25519', 'sign', 'never'], { env: genv, stdio: 'ignore' });
    return execFileSync('gpg', ['--batch', '--with-colons', '--list-keys', uid], { env: genv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').find((l) => l.startsWith('fpr:')).split(':')[9]; };
  const WF = gen('GitHub (stand-in web-flow) <noreply@github.com>'), OTHER = gen('Someone else <other@example.test>');
  const armor = (fpr) => execFileSync('gpg', ['--batch', '--armor', '--export', fpr], { env: genv, encoding: 'utf8' });
  const pinFiles = { 'team/github-web-flow.json': JSON.stringify({ keys: [{ fingerprint: WF, file: 'team/github-web-flow.asc' }] }), 'team/github-web-flow.asc': armor(WF) };
  const ghMerge = (r, branch, { key = WF, extra } = {}) => {
    r.g('merge', '-q', '--no-commit', '--no-ff', branch); if (extra) { writeFileSync(join(r.d, 'extra.txt'), extra); r.g('add', '-A'); }
    execFileSync('git', ['-c', 'gpg.format=openpgp', '-c', 'gpg.program=gpg', '-c', `user.signingkey=${key}`, 'commit', '-q', '-S', '-m', `Merge pull request #1 from x/${branch}`], { cwd: r.d, env: { ...genv, GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com', GIT_AUTHOR_NAME: 'live.b', GIT_AUTHOR_EMAIL: 'live.b@example.test' } });
    return r.g('rev-parse', 'HEAD'); };
  const run = (r, from, env = {}) => spawnSync('node', [r.script, '', 'HEAD'], { cwd: r.d, encoding: 'utf8', env: { ...process.env, WEBFLOW_KEYS_FROM: from, ...env } });
  const mk = (name, { pinKey = true } = {}) => { const r = setup(name); const trusted = r.commit('pins the web-flow key', { key: A, files: pinKey ? pinFiles : { 'x.txt': '0' } });
    r.g('checkout', '-q', '-b', 'pr'); r.commit('the change', { key: A, files: { 'p.txt': '1' } }); r.g('checkout', '-q', 'main'); return { r, trusted }; };
  { const { r, trusted } = mk('wf-good'); const m = ghMerge(r, 'pr'); const out = join(tmp, 'wf-out.txt');
    const o = run(r, trusted, { WEBFLOW_OUT: out }); expect('(PR) a clean GitHub merge of agent-signed commits passes', o, true);
    let listed = ''; try { listed = readFileSync(out, 'utf8'); } catch {} results.push({ name: '(PR) ... and it is listed for the attestation step (f, g)', pass: listed.startsWith(m + ' '), out: listed.trim() }); }
  { const { r, trusted } = mk('wf-nokey', { pinKey: false }); ghMerge(r, 'pr'); expect('(PR) with no pinned web-flow key, every GitHub merge fails', run(r, trusted), false, 'no web-flow key is pinned'); }
  { const { r } = mk('wf-notrust'); ghMerge(r, 'pr'); expect('(PR) without a trusted tree for the keys, it fails', run(r, ''), false, 'no trusted tree'); }
  { const { r, trusted } = mk('wf-other'); ghMerge(r, 'pr', { key: OTHER }); expect('(PR) a merge signed by another gpg key fails', run(r, trusted), false, 'not signed by a pinned web-flow key'); }
  { const { r, trusted } = mk('wf-extra'); ghMerge(r, 'pr', { extra: 'hand edit' }); expect('(PR) a GitHub merge with an extra edit fails (merge-tree)', run(r, trusted), false, 'not the clean merge'); }
  { const { r, trusted } = mk('wf-unsigned'); r.g('checkout', '-q', 'pr'); r.commit('unsigned in the PR', { files: { 'q.txt': '1' } }); r.g('checkout', '-q', 'main'); ghMerge(r, 'pr');
    expect('(PR) a merge that brings in an unsigned commit fails', run(r, trusted), false, 'not signed by a key'); }
  { const { r, trusted } = mk('wf-webedit'); writeFileSync(join(r.d, 'w.txt'), 'edited in the browser'); r.g('add', '-A');
    execFileSync('git', ['-c', 'gpg.format=openpgp', '-c', 'gpg.program=gpg', '-c', `user.signingkey=${WF}`, 'commit', '-q', '-S', '-m', 'Update w.txt'], { cwd: r.d, env: { ...genv, GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' } });
    expect('(PR) a web edit signed by web-flow (one parent) fails', run(r, trusted), false, 'not a two-parent merge'); }
  { const r = setup('wf-retired'); const ret = { 'team/github-web-flow.json': JSON.stringify({ keys: [{ fingerprint: WF, file: 'team/github-web-flow.asc', retired: true }] }), 'team/github-web-flow.asc': armor(WF) };
    const trusted = r.commit('pins a retired key', { key: A, files: ret }); r.g('checkout', '-q', '-b', 'pr'); r.commit('the change', { key: A, files: { 'p.txt': '1' } }); r.g('checkout', '-q', 'main'); const m = ghMerge(r, 'pr');
    expect('(PR) a retired web-flow key does not verify a new merge', run(r, trusted), false, 'not signed by a pinned web-flow key');
    expect('(PR) ... but still verifies a merge attested before (an ancestor of WEBFLOW_SINCE)', run(r, trusted, { WEBFLOW_SINCE: m }), true); }
  { const { r, trusted } = mk('wf-swap'); r.g('checkout', '-q', 'pr'); r.commit('swaps in its own key', { key: A, files: { 'team/github-web-flow.json': JSON.stringify({ keys: [{ fingerprint: OTHER, file: 'team/github-web-flow.asc' }] }), 'team/github-web-flow.asc': armor(OTHER) } });
    r.g('checkout', '-q', 'main'); ghMerge(r, 'pr', { key: OTHER }); expect('(PR) a key swapped in by a pushed commit is not used (keys come from the trusted tree)', run(r, trusted), false, 'not signed by a pinned web-flow key'); } }
// The attestation of GitHub-made merges (f, g), scripts/attest-webflow.sh, with a stand-in for gh
{ const att = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'attest-webflow.sh'); const bin = join(tmp, 'fakebin-att'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\ncase "$2" in\n  */commits/*/pulls) echo "${FAKE_PR:-1}" ;;\n  */actions/workflows/pages.yml/runs*) echo "${FAKE_RUN-42}" ;;\n  */actions/runs/*/jobs*) echo "${FAKE_SEC:-1}" ;;\nesac\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const list = join(tmp, 'att.txt'); writeFileSync(list, `${'a'.repeat(40)} ${'b'.repeat(40)}\n`);
  const runA = (env) => spawnSync('bash', [att, list], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, REPO: 'x/y', GH_TOKEN: 'none', ...env } });
  expect('(PR) attestation passes for a merged pull request whose head passed security', runA({}), true, 'passed the security job');
  expect('(PR) attestation fails when no merged pull request has this merge commit (f)', runA({ FAKE_PR: '0' }), false, '(f)');
  expect('(PR) attestation fails when the head has no successful pull_request run (g)', runA({ FAKE_RUN: '' }), false, '(g)');
  expect('(PR) attestation fails when the security job was red on the head (g)', runA({ FAKE_SEC: '0' }), false, 'did not pass');
  const empty = join(tmp, 'att-empty.txt'); writeFileSync(empty, '');
  expect('(PR) with no GitHub-made merge, attestation has nothing to do', spawnSync('bash', [att, empty], { encoding: 'utf8' }), true, 'no GitHub-made merge'); }
// security@'s control 10, no symlinks (ed70bd996), and its pre-review: the step refuses a symlink in any commit from the
// anchor, in the pushed tree or in the checkout, unless the anchor's exceptions list its exact path and target
{ const A_KEY = A; const yml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'pages.yml'), 'utf8').split('\n');
  const at = yml.findIndex((l) => l === '      - name: Take the security checks from the last verified commit');
  const run = []; let inRun = false;
  for (const l of yml.slice(at + 1)) { if (/^      - /.test(l)) break; if (/^        run: \|/.test(l)) { inRun = true; continue; } if (inRun) run.push(l.replace(/^          /, '')); }
  const step = join(tmp, 'take-checks-c10.sh'); writeFileSync(step, 'set -e\n' + run.join('\n') + '\n');
  const bin = join(tmp, 'fakebin10'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\ncase "$2" in\n  */actions/workflows/pages.yml/runs*) echo "7 $FAKE_DEPLOYED" ;;\n  */actions/runs/7/jobs*) echo 1 ;;\nesac\nexit 0\n', { mode: 0o755 });
  const checks = { 'scripts/check-signatures.mjs': '//\n', 'scripts/check-commits.mjs': '//\n', 'scripts/leak-scan.mjs': '//\n' };
  const mk = (name, extra = {}) => { const r = setup(name); mkdirSync(join(r.d, 'scripts'), { recursive: true }); const A = r.commit('the anchor', { key: A_KEY, files: { ...checks, ...extra } }); return { r, A }; };
  const link = (r, target, path) => { mkdirSync(dirname(join(r.d, path)), { recursive: true }); symlinkSync(target, join(r.d, path)); };
  const runIt = (r, anchor) => { const rt = join(tmp, 'rt10-' + Math.random().toString(36).slice(2)); mkdirSync(join(rt, 'site-download'), { recursive: true }); writeFileSync(join(rt, 'site-download', 'index.html'), 'x');
    return spawnSync('bash', [step], { cwd: r.d, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AFTER: r.g('rev-parse', 'HEAD'), REPO: 'x/y', GH_TOKEN: 'none', FAKE_DEPLOYED: anchor, RUNNER_TEMP: rt } }); };
  const ex = (list) => ({ 'scripts/symlink-exceptions.json': JSON.stringify(list) });
  { const { r, A } = mk('c10-clean'); r.commit('a file', { key: A_KEY, files: { 'x.txt': '1' } }); expect('(10) a push with no symlink passes', runIt(r, A), true); }
  { const { r, A } = mk('c10-pushed'); link(r, 'x.txt', 'l.txt'); r.commit('a symlink', { key: A_KEY, files: { 'x.txt': '1' } }); const o = runIt(r, A); expect('(10) a pushed symlink fails in the commit scan', o, false, ': "l.txt" is a symlink'); expect('(10) ... and in the pushed tree', o, false, 'is a symlink in the pushed tree'); expect('(10) ... and in the checkout', o, false, 'is a symlink in the checkout'); }
  { const { r, A } = mk('c10-listed', ex([{ path: 'l.txt', target: 'x.txt', reason: 'test' }])); link(r, 'x.txt', 'l.txt'); r.commit('a listed symlink', { key: A_KEY, files: { 'x.txt': '1' } }); expect('(10) a symlink the anchor lists, with its target, passes', runIt(r, A), true); }
  { const { r, A } = mk('c10-pushlist'); link(r, 'x.txt', 'l.txt'); r.commit('lists its own symlink', { key: A_KEY, files: { 'x.txt': '1', ...ex([{ path: 'l.txt', target: 'x.txt', reason: 'test' }]) } }); expect('(10) a symlink listed only in the pushed tree fails', runIt(r, A), false, 'is a symlink in the pushed tree'); }
  { const { r, A } = mk('c10-repoint', ex([{ path: 'l.txt', target: 'x.txt', reason: 'test' }])); link(r, '/etc', 'l.txt'); r.commit('a listed path, another target', { key: A_KEY }); expect('(10) a listed symlink pointed somewhere else fails', runIt(r, A), false, 'is a symlink in the checkout'); }
  { const { r, A } = mk('c10-newline', ex([{ path: 'x', target: 'x.txt', reason: 'test' }])); link(r, 'x.txt', 'x\nevil'); r.commit('a name with a newline', { key: A_KEY, files: { 'x.txt': '1' } }); expect('(10) an exception for "x" does not cover a symlink named "x\\nevil"', runIt(r, A), false, '"x\\nevil" is a symlink in the pushed tree'); }
  { const { r, A } = mk('c10-gone'); link(r, 'x.txt', 'l.txt'); r.commit('a symlink', { key: A_KEY, files: { 'x.txt': '1' } }); rmSync(join(r.d, 'l.txt')); r.commit('and gone again', { key: A_KEY }); expect('(10) a symlink added and removed inside the range still fails', runIt(r, A), false, ': "l.txt" is a symlink'); }
  { const { r, A } = mk('c10-names'); mkdirSync(join(r.d, 'é dir'), { recursive: true }); r.commit('names with accents, a space and a tab', { key: A_KEY, files: { 'é dir/ç\tx.txt': '1', 'Olhão.txt': '1' } }); expect('(10) non-ASCII, space and tab names pass the walk (the post-review)', runIt(r, A), true); }
  { const { r, A } = mk('c10-utf8link'); link(r, 'x.txt', 'é/l.txt'); r.commit('a symlink under a non-ASCII name', { key: A_KEY, files: { 'x.txt': '1' } }); expect('(10) a symlink under a non-ASCII directory fails in the checkout too', runIt(r, A), false, '"é/l.txt" is a symlink in the checkout'); }
  { const { r, A } = mk('c10-typechange', { 'l.txt': 'a file' }); rmSync(join(r.d, 'l.txt')); link(r, 'x.txt', 'l.txt'); r.commit('a file becomes a symlink', { key: A_KEY, files: { 'x.txt': '1' } }); expect('(10) a file changed into a symlink fails', runIt(r, A), false, ': "l.txt" is a symlink'); }
  { const { r, A } = mk('c10-merge'); r.g('checkout', '-q', '-b', 'side'); r.commit('side', { key: A_KEY, files: { 's.txt': '1' } }); r.g('checkout', '-q', 'main'); r.commit('main', { key: A_KEY, files: { 'm.txt': '1' } });
    r.g('merge', '-q', '--no-commit', '--no-ff', 'side'); link(r, 'x.txt', 'l.txt'); r.g('add', '-A'); r.g('-c', 'gpg.format=ssh', '-c', `user.signingkey=${A_KEY.f}`, 'commit', '-q', '-S', '-m', 'merge with a symlink', '-m', `Agent: ${AGENT}\nClaude-Session: ${SESSION}`);
    rmSync(join(r.d, 'l.txt')); r.commit('and gone again', { key: A_KEY }); expect('(10) a symlink introduced only by a merge fails', runIt(r, A), false, ': "l.txt" is a symlink'); }
  { const { r, A } = mk('c10-gitmodules'); r.commit('a .gitmodules', { key: A_KEY, files: { '.gitmodules': '[submodule "x"]\n\tpath = x\n\turl = https://example.test/x\n' } }); expect('(10) a .gitmodules file fails', runIt(r, A), false, 'is a .gitmodules file'); }
  { const { r, A } = mk('c10-oldmodules', { '.gitmodules': '[submodule "x"]\n' }); r.commit('a file', { key: A_KEY, files: { 'x.txt': '1' } }); expect('(10) a .gitmodules already in the anchor fails in the pushed tree', runIt(r, A), false, 'is a .gitmodules file in the pushed tree'); }
  { const { r, A } = mk('c10-badlist', { 'scripts/symlink-exceptions.json': '{"not":"a list"}' }); r.commit('a file', { key: A_KEY, files: { 'x.txt': '1' } }); expect('(10) an exceptions file that is not a list fails', runIt(r, A), false, 'not a JSON list'); } }
// cyber.b@'s finding (4dd8500, via conductor.b@ 19 Nov 16:25): a quoting slip in a run block breaks the run, so every
// run block of every workflow must parse (bash -n; GitHub expressions are replaced first)
{ const wdir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
  for (const f of readdirSync(wdir).filter((n) => /\.ya?ml$/.test(n))) {
    const ls = readFileSync(join(wdir, f), 'utf8').split('\n'); let n = 0;
    for (let i = 0; i < ls.length; i++) {
      const m = /^(\s*)(?:- )?run: (\|)?(.*)$/.exec(ls[i]); if (!m) continue;
      let body;
      if (m[2]) { const ind = m[1].length; const b = []; for (let j = i + 1; j < ls.length && (ls[j].trim() === '' || ls[j].search(/\S/) > ind); j++) b.push(ls[j]); const pad = Math.min(...b.filter((l) => l.trim()).map((l) => l.search(/\S/))); body = b.map((l) => l.slice(pad)).join('\n'); }
      else body = m[3];
      body = body.replace(/\$\{\{[^}]*\}\}/g, 'X'); n++;
      const sh = join(tmp, `run-${f}-${n}.sh`); writeFileSync(sh, body + '\n');
      const v = spawnSync('bash', ['-n', sh], { encoding: 'utf8' });
      results.push({ name: `${f} run block ${n} (line ${i + 1}) parses`, pass: v.status === 0, out: (v.stderr || '').trim() }); } } }
{ const r = setup('older'); expect('the base itself and its ancestors are skipped, not failed', r.check(r.base + '~0', 'HEAD'), true); }

rmSync(tmp, { recursive: true, force: true });
const bad = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.pass ? '' : `  [${r.out}]`}`);
if (bad.length) { console.error(`check-signatures tests: ${bad.length} of ${results.length} failed`); process.exit(1); }
console.log(`OK (${results.length} cases)`);
