// Build: copy src/ to _site/, generate the pages and the API from data.promptugal.news
// (scripts/live/generate.mjs), publish the public keys, stamp the version, write version.json.
// SITE_VERSION is set by CI only (v0.1.N); a local build says "dev".
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from './live/generate.mjs';
const version = process.env.SITE_VERSION || 'dev';
rmSync('_site', { recursive: true, force: true });
cpSync('src', '_site', { recursive: true });
cpSync('team/keys.json', '_site/keys.json');
const state = await generate('_site');
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
writeFileSync('_site/version.json', JSON.stringify({ version, commit: process.env.GITHUB_SHA || 'local', built: new Date().toISOString(), register: state.register, cameras: state.cameras }, null, 2) + '\n');
writeFileSync('_site/.nojekyll', '');
// Log ids and counts only: register text never reaches the log (prompt injection, the threat model).
console.log(`built _site/ (${version}): register ${state.register_status ?? 'unavailable'}, ${state.cameras} cameras, ${state.skipped.length} skipped, embeds from ${state.embedded.length ? state.embedded.join(' ') : 'no host'}`);
