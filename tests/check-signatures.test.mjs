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
  const jobIf = (name) => { const i = lines.indexOf(`  ${name}:`); return lines.slice(i + 1, i + 4).find((l) => /^    if: /.test(l)) || ''; };
  results.push({ name: 'the security, deploy and tag jobs run only for dev (a manual run on another branch never deploys)', pass: ['security', 'deploy', 'tag'].every((j) => jobIf(j).includes("github.ref == 'refs/heads/dev'")), out: ['security', 'deploy', 'tag'].map(jobIf).join(' | ') });
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
{ const r = setup('older'); expect('the base itself and its ancestors are skipped, not failed', r.check(r.base + '~0', 'HEAD'), true); }

rmSync(tmp, { recursive: true, force: true });
const bad = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.pass ? '' : `  [${r.out}]`}`);
if (bad.length) { console.error(`check-signatures tests: ${bad.length} of ${results.length} failed`); process.exit(1); }
console.log(`OK (${results.length} cases)`);
