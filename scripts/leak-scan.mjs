// The leak scan. Must print OK before every commit and in the Pages workflow.
// Node built-ins only. Written by security@agenticcells.dinis, 2026-11-15.
// Site template version (factory@AgentiCCells.dinis, 2026-11-16): scans _site/ instead
// of site/, skips the vault's ciphertext under .sg_vault/bare/, fails on any tracked
// file from .sg_vault/local/, and fails if this checkout's own vault key or token
// appears anywhere (the last two from the site repositories made by sites@).
//
// Scans every file git knows about (tracked, plus untracked files that are not
// ignored, so a new file is caught before its first commit) and the built _site/.
// It looks for secret shapes and reports the file, the line and the kind of
// shape. It never prints the matched text: a finding is described, never quoted.
//
// Usage:
//   node scripts/leak-scan.mjs            scan the working tree and _site/
//   node scripts/leak-scan.mjs --history    scan every commit reachable in this
//                                         clone (git log -p --all); fetch more
//                                         history first in a shallow clone
//
// Public keys are allowed only in team/keys.json and team/keys/*.json, and only
// when those files hold no private part. Any change to the allowlist below must
// be narrow (one path, one kind) and say why.
import { readFileSync, existsSync, statSync, lstatSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Built from parts so that this file does not match its own patterns.
const DASHES = '-'.repeat(5);
const PRIVATE_BLOCK = new RegExp(`${DASHES}BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?${DASHES}`);
const PUBLIC_BLOCK = new RegExp(`${DASHES}BEGIN (?:RSA |EC )?PUBLIC KEY${DASHES}[\\s\\S]*?${DASHES}END (?:RSA |EC )?PUBLIC KEY${DASHES}`, 'g');
const PUBLIC_BEGIN = new RegExp(`${DASHES}BEGIN (?:RSA |EC |PGP )?PUBLIC KEY( BLOCK)?${DASHES}`);

// Exact shapes: [kind, regex]. Order matters only for the report.
const SHAPES = [
  ['private key block', PRIVATE_BLOCK],
  ['AWS access key id', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/],
  ['AWS secret access key assignment', /aws_?secret_?(?:access_?)?key\s*["']?\s*[:=]\s*["']?[A-Za-z0-9\/+]{40}(?![A-Za-z0-9\/+])/i],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ['sgit vault or read key', /\bsgit_(?:private_vault|private_read|vk1|rk1)_[A-Za-z0-9:]{8,}/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['Google OAuth access token', /\bya29\.[A-Za-z0-9_-]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Anthropic or OpenAI API key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
  // security@'s ruling (Website 1acd10498, 19 Nov 2026): an SSH public key outside its published field is flagged by
  // shape, because the entropy rule alone missed about 1 in 75 (library.b@). Its one published field is
  // ssh_signing.public_key in team/keys.json and its served copy, once live signs its commits.
  ['SSH public key outside its published field', /\b(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) AAAA[A-Za-z0-9+\/]{16,}/],
];
// A private key header fails everywhere, with no exemption of any kind (security@, 19 Nov 2026).
const NEVER_ALLOWED = new Set(['private key block', 'web-flow key file is not exactly one public key block']);
// GitHub's web-flow signing key (pull-request releases; security@'s ruling 8667c27ce, 21 Nov 2026): allowed in this one
// file only, and only when the whole file is exactly one armored PGP public key block (an optional checksum line,
// base64 lines and blank lines inside, LF line ends, nothing before or after). Anything else there fails, never allowed.
const WEBFLOW_KEY_FILE = 'team/github-web-flow.asc';
const PGP_PUB = ['PGP', 'PUBLIC', 'KEY', 'BLOCK'].join(' ');
const WEBFLOW_SHAPE = new RegExp(`^${DASHES}BEGIN ${PGP_PUB}${DASHES}\n\n((?:[A-Za-z0-9+/]{1,76}\n)*[A-Za-z0-9+/]{1,76}={0,2}\n)(=[A-Za-z0-9+/]{4}\n)?${DASHES}END ${PGP_PUB}${DASHES}\n?$`); // padding on the last body line only (the post-review)
// The packets inside, decoded: only a public key (tag 6), user IDs (13), public subkeys (14) and signatures (2). A secret
// key or subkey (5, 7), or anything else, fails (the pre-review: a PUBLIC header proves nothing about its packets).
const WEBFLOW_TAGS = new Set([2, 6, 13, 14]);
function pgpTagsOk(b64) {
  const flat = b64.replace(/\n/g, '');
  let buf; try { buf = Buffer.from(flat, 'base64'); } catch { return false; }
  // every character decoded: the bytes must re-encode to exactly the text, so nothing hides after a stray '='
  if (!buf.length || buf.length > 32768 || buf.toString('base64') !== flat) return false;
  let i = 0, n = 0;
  while (i < buf.length) {
    const h = buf[i++]; if (!(h & 0x80)) return false;
    let tag, len;
    if (h & 0x40) { // new format
      tag = h & 0x3f; const o = buf[i++];
      if (o === undefined) return false;
      if (o < 192) len = o; else if (o < 224) { if (i >= buf.length) return false; len = ((o - 192) << 8) + buf[i++] + 192; } else if (o === 255) { if (i + 4 > buf.length) return false; len = buf.readUInt32BE(i); i += 4; } else return false; // partial lengths are not used in keys
    } else { // old format
      tag = (h >> 2) & 0x0f; const lt = h & 3;
      if (lt === 0) len = buf[i++]; else if (lt === 1) { if (i + 2 > buf.length) return false; len = buf.readUInt16BE(i); i += 2; } else if (lt === 2) { if (i + 4 > buf.length) return false; len = buf.readUInt32BE(i); i += 4; } else return false;
      if (len === undefined) return false;
    }
    if (!WEBFLOW_TAGS.has(tag) || i + len > buf.length) return false;
    // each packet's size capped, so no packet body can carry a payload: a key 1100 bytes (RSA 4096 is about 530), a
    // signature 2048, a user ID 256 bytes of printable text
    if ((tag === 6 || tag === 14) && len > 1100) return false;
    if (tag === 2 && len > 2048) return false;
    if (tag === 13 && (len > 256 || !/^[\x20-\x7e]*$/.test(buf.subarray(i, i + len).toString('latin1')))) return false;
    if (n === 0 && tag !== 6) return false; // the first packet is the public key itself
    i += len; n++;
  }
  return n > 0;
}

// sgit vault key without its prefix: {passphrase}:{vault_id}. sgit generates a
// 24-character lowercase alphanumeric passphrase and an 8-character vault id.
// The passphrase side must mix letters and digits and not be pure hex, so that
// "sha256:<fingerprint>" and "<commit>:<path>" do not count.
const VAULT_PAIR = /(?<![A-Za-z0-9_\/.-])([a-z0-9]{16,64}):([a-z0-9]{4,24})(?![A-Za-z0-9_\/.-])/g;
function vaultPair(line) {
  for (const m of line.matchAll(VAULT_PAIR)) {
    const p = m[1];
    if (/[a-z]/.test(p) && /[0-9]/.test(p) && !/^[0-9a-f]+$/.test(p)) return true;
  }
  return false;
}

// A secret-looking value assigned to a secret-looking name.
const ASSIGN = /\b(?:pass(?:word|phrase)|secret|token|api_?key|private_?key|access_?key)\w*["']?\s*[:=]\s*["']?([A-Za-z0-9\/+_=.-]{16,})/gi;

function entropy(s) {
  const n = {};
  for (const c of s) n[c] = (n[c] || 0) + 1;
  let h = 0;
  for (const k in n) { const p = n[k] / s.length; h -= p * Math.log2(p); }
  return h;
}

// Long high-entropy strings. Pure hex of 40 characters is a git object id and
// is allowed (pinned actions, commit references); longer hex is flagged.
const LONG = /[A-Za-z0-9+\/_-]{32,}={0,2}/g;
function highEntropy(line) {
  for (const m of line.matchAll(LONG)) {
    const s = m[0].replace(/=+$/, '');
    if (/^[0-9a-f]+$/i.test(s)) { if (s.length >= 48 && entropy(s) >= 3.5) return true; continue; }
    if (s.includes('/') && !/[+=]/.test(m[0]) && s.split('/').some((seg) => /^[a-z][a-z.-]*$/.test(seg))) continue; // a path or URL
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((r) => r.test(s)).length;
    if (classes >= 3 && entropy(s) >= 4.3) return true;
  }
  return false;
}

// Narrow allowlist: [path, kind, reason]. Keep each entry to one file and one kind.
const ALLOW = [
  // live.b@PrompTugal.dinis, 2026-11-18: the build copies team/keys.json to _site/keys.json so the public keys
  // are served on the site (Dinis, 18 Nov 2026, about 14:55 UTC: "publishing their keys, public keys, into the
  // website"). The source file is checked as a public key file; this allows the copy's public blocks only.
  ['_site/keys.json', 'public key outside team/keys', 'served copy of team/keys.json'],
  // live.b@PrompTugal.dinis, 2026-11-18: a detached ECDSA signature (public by design) over the first release's manifest,
  // checked with sgit pki verify against live.b-promptugal in team/keys.json.
  // live.b@PrompTugal.dinis, 2026-11-18: live's observability config, at Dinis's word in live.b@'s session ("yes, allow
  // assets/obs/obs.json in the leak scan"): four append-only lane tokens and the drain's public encryption key, public by
  // design as on promptugal.news and civic. A token can only append to its lane; the key can only encrypt. The vault key,
  // enum key and drain private key are never here (they are in ~/.sg-send/obs-live/, sealed to conductor.b@).
  ['src/assets/obs/obs.json', 'long high-entropy string', "live's observability config (append-only tokens, public by design)"],
  ['src/assets/obs/obs.json', 'public key outside team/keys', "live's observability config (the drain's public key)"],
  ['_site/assets/obs/obs.json', 'long high-entropy string', 'the built copy of src/assets/obs/obs.json'],
  ['_site/assets/obs/obs.json', 'public key outside team/keys', 'the built copy of src/assets/obs/obs.json'],
  ['board/team/live/signatures/2026-11-18-first-version.txt.sig', 'long high-entropy string', 'detached signature, public'],
];
const allowed = (path, kind) => ALLOW.some(([p, k]) => p === path && k === kind);

const PUBLIC_KEY_FILES = (p) => p === 'team/keys.json' || p === '_site/keys.json' || /^team\/keys\/[a-z0-9-]+\.json$/.test(p);

// Returns a list of {line, kind} for one file's text. Never returns the match.
export function scanText(path, text) {
  const found = [];
  const add = (line, kind) => { if (NEVER_ALLOWED.has(kind) || !allowed(path, kind)) found.push({ line, kind }); };
  let body = text;
  if (path === WEBFLOW_KEY_FILE) {
    // the key shapes run on the original text first, so nothing hides inside the block that is then blanked
    for (const [kind, re] of SHAPES) if (re.test(text)) found.push({ line: 0, kind });
    const m = WEBFLOW_SHAPE.exec(text);
    if (!m || text.length > 48000 || text.split(`${DASHES}BEGIN `).length !== 2 || !pgpTagsOk(m[1])) { found.push({ line: 0, kind: 'web-flow key file is not exactly one public key block' }); return found; }
    return found; // exactly one public key block and nothing else: no line rule applies
  }
  if (PUBLIC_KEY_FILES(path)) {
    if (/private|passphrase|secret|seed/i.test(text)) add(0, 'public key file mentions a private part');
    // Blank the allowed public key blocks, keeping line numbers.
    body = text.replace(PUBLIC_BLOCK, (b) => b.replace(/[^\n]/g, ' '));
  }
  body.split('\n').forEach((line, i) => {
    const n = i + 1;
    for (const [kind, re] of SHAPES) if (re.test(line)) add(n, kind);
    if (PUBLIC_BEGIN.test(line)) add(n, 'public key outside team/keys');
    if (vaultPair(line)) add(n, 'sgit vault key shape (passphrase:vault_id)');
    for (const m of line.matchAll(ASSIGN)) {
      const v = m[1];
      if (/[0-9]/.test(v) && /[A-Za-z]/.test(v) && entropy(v) >= 3.5) { add(n, 'secret-looking value assigned to a secret name'); break; }
    }
    if (highEntropy(line)) add(n, 'long high-entropy string');
  });
  return found;
}

function isBinary(buf) { return buf.subarray(0, 8000).includes(0); }
// The only binary files allowed, each still scanned for the exact key and token shapes (library.b@'s LIB-2026-067: a NUL
// byte must not let a file skip the scan). Any other binary file fails.
const BINARY_ALLOWED = new Set(['src/preview.png', '_site/preview.png']);

// Never follows a symlink: a link is listed as itself, and fails (LIB-2026-067).
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const st = lstatSync(p);
    return st.isDirectory() ? walk(p) : [p];
  });
}

function scanTree() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root })
    .toString().split('\0').filter(Boolean);
  const siteDir = join(root, '_site');
  if (!existsSync(join(siteDir, 'index.html'))) return { errors: ['_site/ is not built: run node scripts/build.mjs first'], count: 0 };
  const paths = [...new Set([...files, ...walk(siteDir).map((p) => p.slice(root.length + 1))])];
  const errors = [];
  let count = 0, skipped = 0;
  // The vault's own secrets, when this checkout holds them, must appear nowhere.
  const secrets = [];
  for (const k of ['.sg_vault/local/vault_key', '.sg_vault/local/token']) {
    const f = join(root, k);
    if (existsSync(f)) { const v = readFileSync(f, 'utf8').trim(); secrets.push(v, v.split(':')[0]); }
  }
  for (const p of paths) {
    if (p.startsWith('.sg_vault/local/')) { errors.push(`${p}: a file from .sg_vault/local/ is in the tree (it holds vault keys)`); continue; }
    if (p.startsWith('.sg_vault/bare/')) { skipped++; continue; } // ciphertext, protected by the vault key
    const full = join(root, p);
    let st; try { st = lstatSync(full); } catch { continue; } // deleted in the working tree
    if (st.isSymbolicLink()) { errors.push(`${p}: a symlink (never followed by the scan)`); continue; }
    if (st.isDirectory()) continue;
    const buf = readFileSync(full);
    if (isBinary(buf)) {
      if (!BINARY_ALLOWED.has(p)) { errors.push(`${p}: a binary file not on the scan's allowed list`); continue; }
      const raw = buf.toString('latin1');
      for (const [kind, re] of SHAPES) if (re.test(raw)) errors.push(`${p}: ${kind}`);
      skipped++; continue;
    }
    count++;
    const t = buf.toString('utf8');
    for (const f of scanText(p, t)) errors.push(`${p}:${f.line}: ${f.kind}`);
    for (const x of secrets) if (x && x.length >= 8 && t.includes(x)) errors.push(`${p}: holds this checkout's vault key or token`);
  }
  return { errors, count, skipped };
}

function scanHistory() {
  // Added lines only: a removed line was already caught when it was added.
  const log = execFileSync('git', ['log', '-p', '--all', '--no-color', '--no-ext-diff', '--format=commit %H'], { cwd: root, maxBuffer: 1 << 30 }).toString();
  const errors = [];
  let commit = '', file = '', commits = 0;
  const byFile = new Map(); // commit+file -> added lines
  const flush = () => {
    for (const [key, lines] of byFile) {
      const [c, f] = key.split('\t');
      const found = scanText(f, lines.join('\n'));
      for (const x of found) errors.push(`${c.slice(0, 7)} ${f}: ${x.kind}`);
    }
    byFile.clear();
  };
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) { flush(); commit = line.slice(7); commits++; file = ''; continue; }
    if (line.startsWith('+++ ')) { file = line.startsWith('+++ b/') ? line.slice(6) : ''; continue; }
    if (file && line.startsWith('+')) {
      const k = `${commit}\t${file}`;
      if (!byFile.has(k)) byFile.set(k, []);
      byFile.get(k).push(line.slice(1));
    }
  }
  flush();
  return { errors: [...new Set(errors)], count: commits };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const history = process.argv.includes('--history');
  const { errors, count, skipped } = history ? scanHistory() : scanTree();
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`FAILED (${errors.length}) in ${count} ${history ? 'commits' : 'files'}`);
    process.exit(1);
  }
  console.log(history ? `OK (${count} commits)` : `OK (${count} files, ${skipped} binary skipped)`);
}
