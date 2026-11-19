// A hostile register, served through a stubbed fetch: checks escaping, link rules and the embed decision.
// Run: node tests/generate.test.mjs   (live.b@PrompTugal.dinis, 2026-11-18)
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../scripts/live/generate.mjs';
import { embedDecision } from '../scripts/live/lib.mjs';
const embedDecisionShared = () => !embedDecision({ embed: { allowed: true, how: 'iframe', url: 'https://bucket.s3.amazonaws.com/p', host: 'bucket.s3.amazonaws.com' }, terms: { embedding: 'allowed', url: 'https://x.pt/t' }, license: { commercial_use: 'allowed' } }, [{ host: 'bucket.s3.amazonaws.com' }]).embed;

const base = { license: { name: 'the operator\'s terms', url: 'https://www.cm-faro.pt/terms', commercial_use: 'allowed' }, place: 'faro', operator: { name: 'Câmara Municipal de Faro', kind: 'camara', url: 'https://www.cm-faro.pt/' }, terms: { url: 'https://www.cm-faro.pt/terms', checked_at: '2026-11-18T10:00:00Z', embedding: 'allowed' }, status: { state: 'up', checked_at: '2026-11-18T18:00:00Z', http_status: 200 } };
const cameras = [
  { ...base, id: 'good-embed', lat: 37.01, lon: -7.93, name: 'Praia <b>test</b>', page_url: 'https://www.cm-faro.pt/cam', embed: { allowed: true, url: 'https://player.cm-faro.pt/e/1', host: 'player.cm-faro.pt', how: 'iframe' }, status_history: '/api/v1/cameras/good-embed/status.json' },
  { ...base, id: 'not-listed-host', name: 'x" onmouseover="alert(1)', page_url: 'javascript:alert(1)', operator: { ...base.operator, url: 'https://www.cm-faro.pt/' }, embed: { allowed: true, url: 'https://evil.example/e', host: 'evil.example', how: 'iframe' } },
  { ...base, id: 'host-mismatch', name: 'Mismatch', page_url: 'https://www.cm-faro.pt/m', embed: { allowed: true, url: 'https://evil.example/e', host: 'player.cm-faro.pt', how: 'iframe' } },
  { ...base, id: '../etc', name: 'traversal', page_url: 'https://www.cm-faro.pt/t' },
  { ...base, id: 'no-terms', name: 'no terms', page_url: 'https://www.cm-faro.pt/n', terms: {} },
  { ...base, id: 'elsewhere', place: 'lisboa', name: 'not ours', page_url: 'https://x.pt/' },
  { ...base, id: 'terms-unclear', name: 'Unclear — dash', page_url: 'https://www.cm-faro.pt/u', terms: { ...base.terms, embedding: 'unclear' }, embed: { allowed: true, url: 'https://player.cm-faro.pt/e/2', host: 'player.cm-faro.pt', how: 'iframe' } },
];
const jamBase = { status_history: 'https://data.promptugal.news/api/v1/cameras/history/london.json', place: 'london', lat: 51.5, lon: -0.1, operator: { name: 'Transport for London (TfL)', kind: 'ip', url: 'https://tfl.gov.uk/' }, page_url: 'https://tfl.gov.uk/traffic/status/', credit: 'Powered by TfL Open Data', terms: { url: 'https://tfl.gov.uk/terms', checked_at: '2026-11-18', embedding: 'allowed' }, license: { name: 'TfL', url: 'https://tfl.gov.uk/terms', commercial_use: 'allowed' }, status: { state: 'up' } };
const jamEmbed = (u) => ({ allowed: true, how: 'video', host: 's3-eu-west-1.amazonaws.com', path_prefix: '/jamcams.tfl.gov.uk/', video_url: u, image_url: u.replace('.mp4', '.jpg') });
cameras.push({ ...jamBase, id: 'london-jam-1', name: 'A2 test', embed: jamEmbed('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.1.mp4') });
cameras.push({ ...jamBase, id: 'london-jam-2', name: 'A3 test', lat: 51.45, license: { name: 'TfL', url: 'https://tfl.gov.uk/terms' }, terms: { ...jamBase.terms, commercial_use: 'allowed' }, embed: jamEmbed('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.2.mp4') });
cameras.push({ ...jamBase, id: 'london-jam-other-bucket', name: 'other bucket', embed: { ...jamEmbed('https://s3-eu-west-1.amazonaws.com/evil-bucket/x.mp4'), path_prefix: '/evil-bucket/' } });
cameras.push({ ...jamBase, id: 'london-jam-no-commercial', name: 'no commercial', license: { ...jamBase.license, commercial_use: 'not-allowed' }, embed: jamEmbed('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.3.mp4') });
cameras.push({ ...base, id: 'own-site', name: 'own site', page_url: 'https://www.cm-faro.pt/o', embed: { allowed: true, url: 'https://live.promptugal.news/x', host: 'live.promptugal.news', how: 'iframe' } });
cameras.push({ ...base, id: 'relative-link', name: 'relative', page_url: '/api/v1/cameras.json', operator: { ...base.operator, url: 'https://www.cm-faro.pt:8443/' } });
// 900 London records with unread terms, ahead of ours (as TfL JamCams arrived on 18 Nov): skipped, ours kept.
const tfl = Array.from({ length: 900 }, (_, i) => ({ id: `london-tfl-${i}`, name: `JamCam ${i}`, place: 'london', operator: { name: 'Transport for London (TfL)', kind: 'ip', url: 'https://tfl.gov.uk/' }, page_url: 'https://tfl.gov.uk/traffic/status/', terms: { url: 'https://tfl.gov.uk/terms', checked_at: null, embedding: 'unclear' }, embed: { allowed: false }, status: { state: 'up' } }));
cameras.unshift(...tfl);
const routes = {
  'https://data.promptugal.news/api/v1/cameras/index.json': { cameras },
  'https://data.promptugal.news/api/v1/by-place/now/faro.json': { coords: { lat: 37.0194, lon: -7.9304 } },
  'https://data.promptugal.news/api/v1/by-place/now/tavira.json': { coords: { lat: '37.1', lon: -7.6 } },
  'https://data.promptugal.news/api/v1/by-place/now/lagos.json': { coords: { lat: 51.5, lon: -0.1 } },
  'https://data.promptugal.news/api/v1/cameras/history/london.json': { cameras: { 'london-jam-1': [{ at: '2026-11-18T16:00:00Z', state: 'down' }, { at: '2026-11-18T17:00:00Z', state: 'up' }, { at: '2026-11-18T17:30:00Z', state: 'not listed' }] } },
  'https://data.promptugal.news/api/v1/cameras/good-embed/status.json': [{ at: '2026-11-18T15:00:00Z', state: 'up' }, { at: '2026-11-18T16:00:00Z', state: 'down' }, { at: '2026-11-18T17:00:00Z', state: 'up' }, { at: 'bad', state: 'up' }],
};
globalThis.fetch = async (u) => {
  const body = routes[u];
  if (!body) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const out = process.env.KEEP_OUT || join(tmpdir(), `live-test-${process.pid}`);
const state = await generate(out, { allowHosts: [{ host: 'player.cm-faro.pt' }, { host: 'live.promptugal.news' }, { host: 's3-eu-west-1.amazonaws.com', path_prefix: '/jamcams.tfl.gov.uk/', kinds: ['video', 'image'] }], now: '2026-11-18T18:00:00Z' });
const read = (p) => readFileSync(join(out, p), 'utf8');
let failed = 0;
const check = (ok, what) => { if (!ok) { failed++; console.error(`FAIL ${what}`); } else console.log(`ok   ${what}`); };

check(state.cameras === 10, `10 cameras kept (got ${state.cameras})`);
check(state.skipped.length === 903, `903 skipped: 900 with terms not checked, traversal id, terms not checked, no safe operator page (got ${state.skipped.length})`);
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
const views = JSON.parse(read('api/v1/views.json')).views;
check((home.match(/class="m-cam-link"/g) || []).length === 4 && home.includes('data-view="good-embed"') && views['good-embed'].url === 'https://player.cm-faro.pt/e/1', 'the maps show only the embeddable cameras (Faro and three London), views.json holds each view');
check(home.includes('id="viewer"') && /<details class="pending"><summary>6 more cameras/.test(home), 'link-only cameras are listed apart, not on the map');
check(home.includes('frame-src https://player.cm-faro.pt;') && home.includes('media-src https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/;'), 'the home page: frames only from the reviewed host, media only from the reviewed path');
const jam = read('cameras/london-jam-1/index.html');
check(jam.includes('data-embed-kind="video"') && jam.includes('data-embed-prefix="/jamcams.tfl.gov.uk/"') && jam.includes('Powered by TfL Open Data') && jam.includes("frame-src 'none'"), 'a JamCam: a video view under its reviewed path, with its credit');
check(!!views['london-jam-2'], 'commercial use recorded on the terms counts');
check(embedDecisionShared(), 'a shared storage host without a reviewed path is refused for every kind');
check(!views['london-jam-other-bucket'], 'another bucket on the shared host: not shown');
check(!!views['london-jam-no-commercial'], 'no commercial use: still shown here (no billing on this site), with its licence');
check(existsSync(join(out, 'embed/good-embed/index.html')) && !existsSync(join(out, 'embed/host-mismatch')), 'an embed page only for embeddable cameras');
const emb = read('embed/good-embed/index.html');
check(emb.includes("frame-src https://player.cm-faro.pt;") && emb.includes('Live view:') && emb.includes('href="https://www.cm-faro.pt/cam"'), 'embed page: one host, the credit and the link to the operator');
check(JSON.parse(read('api/v1/cameras/good-embed.json')).camera.view.embed_page === 'https://live.promptugal.news/embed/good-embed/', 'API: embed_page for other sites');
check(/<path class="m-coast" d="M[0-9. LM-]+"><\/path>/.test(home), 'coastline drawn as numbers-only paths');
check(read('cameras/london-jam-1/index.html').includes('Up 33% of the 1.5 hours with a known state'), 'a place history file: the camera picks its own list; not listed is unknown');
const pv = read('preview.svg');
check(!pv.includes('<b>') && !pv.includes('onmouseover') && !pv.includes('Praia') && /cameras to watch now/.test(pv) && /viewBox="0 0 320 180"/.test(pv) && !/\{\{/.test(pv), 'preview.svg: the 320 by 180 template, counts only, no register text');
check(JSON.parse(read('preview.json')).numbers.cameras === 10, 'preview.json counts the kept cameras');
const pl = JSON.parse(read('api/v1/places/index.json')).places;
const byId = Object.fromEntries(pl.map((p) => [p.id, p]));
check(byId.faro.lat === 37.0194 && /Wikidata/.test(byId.faro.coords_from), 'coords from data.promptugal.news when valid');
check(byId.tavira.lat === 37.13 && /IPMA/.test(byId.tavira.coords_from), 'a string latitude falls back to IPMA');
check(byId.lagos.lat === 37.1039, 'a point outside Portugal falls back to IPMA');
const api = JSON.parse(read('api/v1/places/faro.json'));
check(api.place.camera_here && api.place.camera_here.id === 'good-embed', 'the camera here is the embedded one that is up');
const c = JSON.parse(read('api/v1/cameras/not-listed-host.json'));
check(c.camera.provenance && c.camera.provenance.source.startsWith('https://data.promptugal.news/'), 'API: provenance on the item');
check(c.camera.view.how === 'link' && c.camera.license.url === 'https://www.cm-faro.pt/terms', 'API: link view, licence falls back to the terms link');
if (!process.env.KEEP_OUT) rmSync(out, { recursive: true, force: true });
if (failed) { console.error(`FAILED (${failed})`); process.exit(1); }
console.log('OK');
