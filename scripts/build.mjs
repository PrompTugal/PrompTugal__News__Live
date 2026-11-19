// Build: copy src/ to _site/, generate the pages and the API from data.promptugal.news
// (scripts/live/generate.mjs), publish the public keys, stamp the version, write version.json.
// SITE_VERSION is set by CI only (v0.1.N); a local build says "dev".
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from './live/generate.mjs';
import { createHash } from 'node:crypto';
import { fetchJson } from './live/lib.mjs';

// The pieces pinned from the registry (promptugal.news/api/v1/sites.json): the shared time-zone table (obs_tz) and the
// sites bar (bar). Each vendored file is checked against the registry's full pin for the version we pin
// (<piece>.versions[v], or <piece>.integrity while the registry names our version). A mismatch stops the build. A pin the
// registry no longer lists while it names a newer version leaves that piece out, never shipped unchecked, and the rest
// deploys (data.b@'s trap and security@'s ruling, 19 Nov 2026). An unreadable registry leaves the validator's hash check.
// No full pin is kept in this repository. The registry is the trust root (plain HTTPS to promptugal.news).
const SRI = (f) => 'sha256-' + createHash('sha256').update(readFileSync(f)).digest('base64');
const tidy = (v) => String(v).replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 20);
const sitesReg = await fetchJson('https://promptugal.news/api/v1/sites.json', { host: 'promptugal.news', maxBytes: 2_000_000 });
function checkPiece(name, pin, files) {
  if (!sitesReg.ok) { console.log(`${name}: registry not read (${sitesReg.why}); the pinned hash is still checked by the validator`); return ''; }
  // read but unusable: stop (the AppSec post-review, 19 Nov: only a failed read may skip the check)
  const entry = sitesReg.data && typeof sitesReg.data[name] === 'object' && sitesReg.data[name] !== null && !Array.isArray(sitesReg.data[name]) ? sitesReg.data[name] : null;
  if (!entry || typeof entry.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(entry.version)) { console.error(`${name}: the registry was read but its ${name} entry is missing or malformed: not deploying`); process.exit(1); }
  if (!Object.keys(files).length) { console.error(`${name}: no files to check: not deploying`); process.exit(1); }
  const v = pin.version;
  const listed = entry.versions && typeof entry.versions === 'object' && Object.prototype.hasOwnProperty.call(entry.versions, v) ? entry.versions[v] : null;
  const want = listed || (entry.version === v ? (typeof entry.integrity === 'string' ? { integrity: entry.integrity } : entry.integrity) : null);
  if (!want || typeof want !== 'object') {
    if (entry.version !== v) { const off = `${name} ${v} off: the registry names ${tidy(entry.version)}`; console.log(`${off} (left out, never shipped unchecked; the next wake upgrades it)`); return off; }
    console.error(`${name}: the registry names ${v} but gives no pin for it: not deploying`); process.exit(1);
  }
  for (const [file, key] of Object.entries(files)) {
    if (typeof want[key] !== 'string' || SRI(file) !== want[key]) { console.error(`${name}: ${file} does not match the registry's pin for ${v}: not deploying`); process.exit(1); }
  }
  console.log(`${name}: ${v} matches the registry's pins${entry.version !== v ? ` (the registry names ${tidy(entry.version)}: upgrade at the next wake)` : ''}`);
  return '';
}
const tzPin = JSON.parse(readFileSync('scripts/vendor/obs-tz/pin.json', 'utf8'));
const tzStale = checkPiece('obs_tz', tzPin, { [tzPin.file]: 'integrity' });
const barPin = JSON.parse(readFileSync('scripts/vendor/sites-bar/pin.json', 'utf8'));
const barOff = checkPiece('bar', barPin, barPin.registry_keys || {});
const version = process.env.SITE_VERSION || 'dev';
rmSync('_site', { recursive: true, force: true });
cpSync('src', '_site', { recursive: true });
cpSync('team/keys.json', '_site/keys.json');
if (tzStale) rmSync('_site/assets/obs/tz-country.json', { force: true });
if (barOff) rmSync('_site/assets/sites-bar', { recursive: true, force: true });
const state = await generate('_site', { barOff: !!barOff });
state.off = [tzStale, barOff].filter(Boolean);
// In CI, a register that could not be read (other than not yet published, 404) fails the build, so the
// live site keeps its last good pages instead of showing no cameras (the security pre-review, item 5).
if (process.env.CI && state.register_status !== 200 && state.register_status !== 404) {
  console.error(`the camera register could not be read (${state.register_status ?? 'no response'}): not deploying`);
  process.exit(1);
}
// In CI, a register that suddenly holds less than half the cameras live now fails the build (the AppSec
// post-review, item 3): a person looks before the live pages lose them.
if (process.env.CI) {
  let live = null;
  try { const r = await fetch('https://live.promptugal.news/version.json', { redirect: 'error', signal: AbortSignal.timeout(10000) }); if (r.ok) live = await r.json(); } catch {}
  const before = live && Number.isInteger(live.cameras) ? live.cameras : 0;
  if (before > 0 && state.cameras < before / 2) { console.error(`cameras fell from ${before} live to ${state.cameras}: not deploying`); process.exit(1); }
}
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of walk('_site')) {
  if (!/\.(html|js|css|json|md|txt|svg)$/.test(f)) continue;
  const s = readFileSync(f, 'utf8');
  if (s.includes('__VERSION__')) writeFileSync(f, s.replaceAll('__VERSION__', version));
}
writeFileSync('_site/version.json', JSON.stringify({ version, commit: process.env.GITHUB_SHA || 'local', built: new Date().toISOString(), register: state.register, cameras: state.cameras, ...(state.off.length ? { off: state.off } : {}) }, null, 2) + '\n');
writeFileSync('_site/.nojekyll', '');
// Log ids and counts only: register text never reaches the log (prompt injection, the threat model).
console.log(`built _site/ (${version}): register ${state.register_status ?? 'unavailable'}, ${state.cameras} cameras, ${state.skipped.length} skipped, embeds from ${state.embedded.length ? [...new Set(state.embedded)].join(' ') : 'no host'}`);
