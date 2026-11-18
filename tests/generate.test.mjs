// A hostile register, served through a stubbed fetch: checks escaping, link rules and the embed decision.
// Run: node tests/generate.test.mjs   (live.b@PrompTugal.dinis, 2026-11-18)
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../scripts/live/generate.mjs';

const base = { place: 'faro', operator: { name: 'Câmara Municipal de Faro', kind: 'camara', url: 'https://www.cm-faro.pt/' }, terms: { url: 'https://www.cm-faro.pt/terms', checked_at: '2026-11-18T10:00:00Z', embedding: 'allowed' }, status: { state: 'up', checked_at: '2026-11-18T18:00:00Z', http_status: 200 } };
const cameras = [
  { ...base, id: 'good-embed', name: 'Praia <b>test</b>', page_url: 'https://www.cm-faro.pt/cam', embed: { allowed: true, url: 'https://player.cm-faro.pt/e/1', host: 'player.cm-faro.pt', how: 'iframe' }, status_history: '/api/v1/cameras/good-embed/status.json' },
  { ...base, id: 'not-listed-host', name: 'x" onmouseover="alert(1)', page_url: 'javascript:alert(1)', operator: { ...base.operator, url: 'https://www.cm-faro.pt/' }, embed: { allowed: true, url: 'https://evil.example/e', host: 'evil.example', how: 'iframe' } },
  { ...base, id: 'host-mismatch', name: 'Mismatch', page_url: 'https://www.cm-faro.pt/m', embed: { allowed: true, url: 'https://evil.example/e', host: 'player.cm-faro.pt', how: 'iframe' } },
  { ...base, id: '../etc', name: 'traversal', page_url: 'https://www.cm-faro.pt/t' },
  { ...base, id: 'no-terms', name: 'no terms', page_url: 'https://www.cm-faro.pt/n', terms: {} },
  { ...base, id: 'elsewhere', place: 'lisboa', name: 'not ours', page_url: 'https://x.pt/' },
  { ...base, id: 'terms-unclear', name: 'Unclear — dash', page_url: 'https://www.cm-faro.pt/u', terms: { ...base.terms, embedding: 'unclear' }, embed: { allowed: true, url: 'https://player.cm-faro.pt/e/2', host: 'player.cm-faro.pt', how: 'iframe' } },
];
cameras.push({ ...base, id: 'own-site', name: 'own site', page_url: 'https://www.cm-faro.pt/o', embed: { allowed: true, url: 'https://live.promptugal.news/x', host: 'live.promptugal.news', how: 'iframe' } });
cameras.push({ ...base, id: 'relative-link', name: 'relative', page_url: '/api/v1/cameras.json', operator: { ...base.operator, url: 'https://www.cm-faro.pt:8443/' } });
const routes = {
  'https://data.promptugal.news/api/v1/cameras/index.json': { cameras },
  'https://data.promptugal.news/api/v1/cameras/good-embed/status.json': [{ at: '2026-11-18T15:00:00Z', state: 'up' }, { at: '2026-11-18T16:00:00Z', state: 'down' }, { at: '2026-11-18T17:00:00Z', state: 'up' }, { at: 'bad', state: 'up' }],
};
globalThis.fetch = async (u) => {
  const body = routes[u];
  if (!body) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const out = process.env.KEEP_OUT || join(tmpdir(), `live-test-${process.pid}`);
const state = await generate(out, { allowHosts: [{ host: 'player.cm-faro.pt' }, { host: 'live.promptugal.news' }], now: '2026-11-18T18:00:00Z' });
const read = (p) => readFileSync(join(out, p), 'utf8');
let failed = 0;
const check = (ok, what) => { if (!ok) { failed++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };

check(state.cameras === 6, `6 cameras kept (got ${state.cameras})`);
check(state.skipped.length === 3, `3 skipped: traversal id, terms not checked, no safe operator page (got ${state.skipped.length})`);
const g = read('cameras/good-embed/index.html');
check(g.includes('data-embed-src="https://player.cm-faro.pt/e/1" data-embed-host="player.cm-faro.pt"') && !g.includes('<iframe') && g.includes('frame-src https://player.cm-faro.pt;'), 'reviewed host: click-to-load, and in frame-src');
check(g.includes('Praia &lt;b&gt;test&lt;/b&gt;') && !g.includes('<b>test</b>'), 'name escaped');
check(g.includes('Up 67% of the 3.0 hours with a known state'), 'history: bad dates dropped, uptime time-weighted from changes');
const n = read('cameras/not-listed-host/index.html');
check(!n.includes('data-embed-src') && n.includes("frame-src 'none'"), 'unreviewed host: no embed, no frames');
check(!n.includes('javascript:') && !/onmouseover="/.test(n) && n.includes('x&quot; onmouseover=&quot;alert(1)'), 'javascript: dropped, attribute injection escaped');
check(!read('cameras/host-mismatch/index.html').includes('data-embed-src'), 'embed host differing from the register: link only');
check(!read('cameras/terms-unclear/index.html').includes('data-embed-src'), 'terms unclear: link only');
check(!read('cameras/terms-unclear/index.html').includes('—'), 'em dash replaced');
check(!existsSync(join(out, 'etc')) && !existsSync(join(out, '..', 'etc', 'index.html')), 'no path traversal');
check(existsSync(join(out, 'places/lisboa/index.html')), 'a place named only by the register gets a page');
check(JSON.parse(read('api/v1/places/algarve.json')).place.cameras.length === 5, 'the Algarve holds only Algarve cameras');
check(!read('cameras/own-site/index.html').includes('data-embed-src'), 'no embed from our own sites, even if allow-listed');
check(!existsSync(join(out, 'cameras/relative-link')), 'a site-relative or port URL from the data is not a link');
check(JSON.parse(read('api/v1/cameras/good-embed.json')).camera.status_history.startsWith('https://data.promptugal.news/'), 'API: status_history absolute');
const home = read('index.html');
check(/<path class="m-coast" d="M[0-9. LM-]+"><\/path>/.test(home), 'coastline drawn as numbers-only paths');
const api = JSON.parse(read('api/v1/places/faro.json'));
check(api.place.camera_here && api.place.camera_here.id === 'good-embed', 'the camera here is the embedded one that is up');
const c = JSON.parse(read('api/v1/cameras/not-listed-host.json'));
check(c.camera.provenance && c.camera.provenance.source.startsWith('https://data.promptugal.news/'), 'API: provenance on the item');
check(c.camera.view.how === 'link' && c.camera.license.url === 'https://www.cm-faro.pt/terms', 'API: link view, licence falls back to the terms link');
if (!process.env.KEEP_OUT) rmSync(out, { recursive: true, force: true });
if (failed) { console.error(`FAILED (${failed})`); process.exit(1); }
console.log('OK');
