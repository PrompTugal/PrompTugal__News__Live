// Gate: fails the build on any problem. Never weaken a check to get a release out.
// From scripts/validate.mjs in the site repositories made by sites@AgentiCCells.dinis
// (2026-11-16); factory@ added the hub.json fields, the description check and the
// placeholder check (a seeded site must hold no __SITE_*__ placeholder).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
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
// media-src tokens as host+path, e.g. s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/
const mediaSrcs = (s) => ((s.match(/media-src ([^;"]*)/) || [])[1] || '').trim().split(/\s+/).filter((t) => t.startsWith('https://')).map((t) => t.slice(8));
// live.b@PrompTugal.dinis, 2026-11-18: the AppSec checks from the security pre-review of the first version.
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  // No IP-based place lookup, anywhere (Dinis, 19 Nov 2026, about 03:15 UTC): no page's CSP and no script may name one.
  if ((/\.(html|js)$/.test(f)) && /ipapi\.co|ipwho\.is/.test(f.endsWith('.html') ? ((s.match(/Content-Security-Policy" content="([^"]*)"/) || [])[1] || '') : s)) fail(`${f}: names an IP place lookup (ipapi.co or ipwho.is)`);
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
      const kind = (s.slice(m.index, m.index + 3000).match(/data-embed-kind="([a-z]+)"/) || [])[1] || 'iframe';
      const prefix = (s.slice(m.index, m.index + 3000).match(/data-embed-prefix="([^"]*)"/) || [])[1] || '';
      if (kind === 'iframe' ? !frameHosts(s).includes(m[1]) : !mediaSrcs(s).includes(m[1] + (prefix || '/'))) fail(`${f}: click-to-load ${kind} source not in the page's ${kind === 'iframe' ? 'frame-src' : 'media-src'}`);
      if (!prefix && /(^|\.)(amazonaws\.com|storage\.googleapis\.com|blob\.core\.windows\.net)$/.test(m[1])) fail(`${f}: a shared host without a path prefix`);
      const full = (s.slice(m.index).match(/data-embed-src="https:\/\/[^/"]+([^"]*)"/) || [])[1] || '';
      if (prefix && !full.startsWith(prefix)) fail(`${f}: click-to-load URL outside its reviewed path`);
      if (m[1] === 'promptugal.news' || m[1].endsWith('.promptugal.news')) fail(`${f}: an embed from our own sites`);
    }
    if (/data-embed-src="(?!https:\/\/)/.test(s)) fail(`${f}: click-to-load URL not https`);
  }
  if (f.endsWith('.js') && /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function)\b/.test(s)) fail(`${f}: unsafe DOM or eval API`);
}
// /api/v1/views.json (the maps' viewer): every view https, never from our own sites, under its reviewed path.
if (existsSync('_site/api/v1/views.json')) {
  const vv = JSON.parse(readFileSync('_site/api/v1/views.json', 'utf8')).views || {};
  for (const [id, v] of Object.entries(vv)) {
    let u; try { u = new URL(v.url); } catch { fail(`views.json ${id}: bad url`); continue; }
    if (u.protocol !== 'https:' || u.hostname !== v.host || /(^|\.)promptugal\.news$/.test(u.hostname) || (v.path_prefix && !u.pathname.startsWith(v.path_prefix))) fail(`views.json ${id}: url not https on its host and path`);
    if (!['iframe', 'video', 'image'].includes(v.kind)) fail(`views.json ${id}: unknown kind`);
    if (v.poster) { let q; try { q = new URL(v.poster); } catch { q = null; } if (!q || q.protocol !== 'https:' || q.hostname !== v.host || (v.path_prefix && !q.pathname.startsWith(v.path_prefix))) fail(`views.json ${id}: poster not on its host and path`); }
  }
} else fail('no _site/api/v1/views.json');
for (const f of ['_site/data/coastline.json', '_site/data/places.json', '_site/data/operator-hosts.json', '_site/data/preview-png.json', '_site/preview.json']) {
  try { const d = JSON.parse(readFileSync(f, 'utf8')); if (!d.license || !d.license.url) fail(`${f}: no license link`); } catch { fail(`${f}: missing or not JSON`); }
}
if (existsSync('_site/data/coastline.json') && statSync('_site/data/coastline.json').size > 50000) fail('_site/data/coastline.json: over 50 KB');
// The vendored sites bar (1.1.0): every file matches its pinned hash; never edited here.
try {
  const pin = JSON.parse(readFileSync('scripts/vendor/sites-bar/pin.json', 'utf8'));
  for (const [file, h] of Object.entries(pin.files)) {
    const got = existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : '';
    if (!got.startsWith(h)) fail(`${file}: differs from its pinned sites bar ${pin.version} hash`);
  }
} catch (e) { fail(`scripts/vendor/sites-bar/pin.json: ${e.message}`); }
// The sites-bar preview (live.b@, 2026-11-18): the SVG holds no script or external reference; the PNG is the recorded one.
if (existsSync('_site/preview.svg')) {
  const v = readFileSync('_site/preview.svg', 'utf8');
  if (v.length > 20000) fail('_site/preview.svg: over 20 KB');
  if (/<script|<foreignObject|\son[a-z]+\s*=|href\s*=|url\(|@import|<!DOCTYPE|<!ENTITY|<image|<use|<a[\s>]|xlink:/i.test(v)) fail('_site/preview.svg: script, handler, link or external reference');
  if (!/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*<\/svg>\s*$/.test(v)) fail('_site/preview.svg: not one svg element');
  if (!/viewBox="0 0 320 180"/.test(v) || /\{\{/.test(v)) fail('_site/preview.svg: not the 320 by 180 template, or a placeholder left');
} else fail('no _site/preview.svg');
if (existsSync('_site/preview.png')) {
  const b = readFileSync('_site/preview.png'), rec = JSON.parse(readFileSync('src/data/preview-png.json', 'utf8')).png;
  const hash = createHash('sha256').update(b).digest('hex');
  if (b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail('_site/preview.png: not a PNG');
  else if (b.readUInt32BE(16) !== rec.width || b.readUInt32BE(20) !== rec.height) fail('_site/preview.png: size differs from its record');
  if (b.length > 300000 || b.length !== rec.bytes || !hash.startsWith(rec.sha256_prefix)) fail('_site/preview.png: differs from src/data/preview-png.json');
  if (b.subarray(-8, -4).toString('latin1') !== 'IEND') fail('_site/preview.png: data after IEND');
} else fail('no _site/preview.png');
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
