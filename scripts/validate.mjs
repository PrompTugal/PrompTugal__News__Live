// Gate: fails the build on any problem. Never weaken a check to get a release out.
// From scripts/validate.mjs in the site repositories made by sites@AgentiCCells.dinis
// (2026-11-16); factory@ added the hub.json fields, the description check and the
// placeholder check (a seeded site must hold no __SITE_*__ placeholder).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const problems = [];
const fail = m => problems.push(m);
const hype = /\b(revolutionary|cutting[- ]edge|seamless(?:ly)?|world[- ]class|game[- ]changing)\b/i;
const isTemplate = existsSync('.factory-template');
if (!existsSync('_site')) { console.error('FAILED: _site/ is not built: run node scripts/build.mjs'); process.exit(1); }
const files = walk('_site');
for (const f of [...files, 'hub.json', 'README.md']) {
  if (!existsSync(f) || !/\.(html|js|css|json|md)$/.test(f)) continue;
  const s = readFileSync(f, 'utf8');
  s.split('\n').forEach((line, i) => {
    if (line.includes('—')) fail(`${f}:${i + 1}: em dash`);
    const m = line.match(hype); if (m) fail(`${f}:${i + 1}: hype word "${m[0]}"`);
    if (!isTemplate && /__SITE_[A-Z]+__/.test(line)) fail(`${f}:${i + 1}: template placeholder left in a seeded site`);
  });
  if (f.endsWith('.html')) {
    if (!/<title>[^<]+<\/title>/.test(s)) fail(`${f}: no <title>`);
    if (!/<meta name="description" content="[^"]+"/.test(s)) fail(`${f}: no description`);
    if (!/<html lang="/.test(s)) fail(`${f}: no lang on <html>`);
    for (const m of s.matchAll(/<script[^>]+src="([^"]+)"/g)) if (/^(https?:)?\/\//.test(m[1])) fail(`${f}: third-party script ${m[1]}`);
    for (const m of s.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) if (/^(https?:)?\/\//.test(m[1])) fail(`${f}: third-party stylesheet ${m[1]}`);
    for (const m of s.matchAll(/(?:href|src)="([^"#?]+)/g)) {
      const u = m[1]; if (/^(https?:|mailto:|data:|\/\/)/.test(u)) continue;
      const target = u.startsWith('/') ? join('_site', u) : join(dirname(f), u);
      if (!existsSync(target) && !existsSync(join(target, 'index.html'))) fail(`${f}: broken link ${u}`);
    }
  }
}
// The exact hosts in a page's CSP frame-src.
const frameHosts = (s) => ((s.match(/frame-src ([^;"]*)/) || [])[1] || '').trim().split(/\s+/).map((t) => t.replace(/^https:\/\//, ''));
// live.b@PrompTugal.dinis, 2026-11-18: the AppSec checks from the security pre-review of the first version.
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  if (f.endsWith('.html')) {
    if (!/<meta http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*script-src 'self';[^"]*base-uri 'none'/.test(s)) fail(`${f}: no strict Content Security Policy`);
    if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(s)) fail(`${f}: inline script`);
    const tags = s.replace(/"[^"]*"/g, '""'); // attribute values blanked: an escaped value cannot open an attribute
    if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(tags)) fail(`${f}: inline event handler`);
    if (/<[a-z][^>]*\sstyle\s*=/i.test(tags)) fail(`${f}: inline style attribute`);
    if (/<style[\s>]/i.test(s)) fail(`${f}: inline style element`);
    for (const m of s.matchAll(/(?:href|src)="([^"]*)"/g)) if (/^\s*(javascript|data|vbscript|blob|http):/i.test(m[1])) fail(`${f}: unsafe link scheme`);
    for (const m of s.matchAll(/<iframe\b[^>]*>/g)) {
      const t = m[0];
      if (!/\ssandbox="allow-scripts allow-same-origin allow-presentation"/.test(t)) fail(`${f}: iframe without the sandbox`);
      if (!/\sreferrerpolicy="no-referrer"/.test(t)) fail(`${f}: iframe without referrerpolicy="no-referrer"`);
      const src = (t.match(/\ssrc="https:\/\/([^/"]+)/) || [])[1];
      if (!src || !frameHosts(s).includes(src)) fail(`${f}: iframe host not in the page's frame-src`);
    }
    for (const m of s.matchAll(/data-embed-src="https:\/\/([^/"]+)[^"]*" data-embed-host="([^"]+)"/g)) {
      if (m[1] !== m[2]) fail(`${f}: click-to-load host differs from its URL`);
      if (!frameHosts(s).includes(m[1])) fail(`${f}: click-to-load host not in the page's frame-src`);
      if (m[1] === 'promptugal.news' || m[1].endsWith('.promptugal.news')) fail(`${f}: an embed from our own sites`);
    }
    if (/data-embed-src="(?!https:\/\/)/.test(s)) fail(`${f}: click-to-load URL not https`);
  }
  if (f.endsWith('.js') && /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function)\b/.test(s)) fail(`${f}: unsafe DOM or eval API`);
}
for (const f of ['_site/api/v1/index.json', '_site/api/v1/cameras.json', '_site/api/v1/places/index.json', '_site/api/v1/openapi.json']) if (!existsSync(f)) fail(`missing ${f}`);
for (const f of files.filter((x) => /^_site\/api\/v1\/(cameras|places)\/.+\.json$/.test(x.split(sep).join('/')))) {
  try { const d = JSON.parse(readFileSync(f, 'utf8')); if (!d.license || !d.license.url) fail(`${f}: no license link`); } catch { fail(`${f}: not JSON`); }
}
if (!existsSync('_site/version.json')) fail('no version.json');
if (!existsSync('_site/index.html')) fail('no index.html');
try {
  const h = JSON.parse(readFileSync('hub.json', 'utf8'));
  for (const k of ['name', 'what_it_does', 'owner', 'repository', 'live_address', 'version_from']) if (typeof h[k] !== 'string' || !h[k].trim()) fail(`hub.json: ${k} must be a non-empty string`);
  if (h.version_from !== `${h.live_address}/version.json`) fail(`hub.json: version_from must be ${h.live_address}/version.json (the hub copies it verbatim)`);
  if (h.owner !== 'AgentiCCells') fail('hub.json: owner must be AgentiCCells');
  if (!h.licence || h.licence.code !== 'Apache-2.0' || h.licence.text !== 'CC BY 4.0') fail('hub.json: licence must be code Apache-2.0, text CC BY 4.0');
} catch (e) { fail(`hub.json is missing or not JSON (${e.message})`); }
if (problems.length) { console.error(problems.join('\n')); console.error(`FAILED: ${problems.length} problem(s)`); process.exit(1); }
console.log(`OK${isTemplate ? ' (template)' : ''}`);
