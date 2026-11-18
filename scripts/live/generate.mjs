// live.promptugal.news: builds the pages and the API from data.promptugal.news's camera register
// and its by-place weather. live.b@PrompTugal.dinis, 2026-11-18. Node built-ins only.
// We keep metadata only: no frame, snapshot or stream is ever fetched, stored or re-hosted here.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { esc, clean, safeUrl, fetchJson, normaliseCamera, embedDecision, normaliseHistory, DATA_HOST } from './lib.mjs';

const SITE = 'https://live.promptugal.news';
const DATA = `https://${DATA_HOST}`;
const REGISTER = `${DATA}/api/v1/cameras/index.json`;
const REPO = 'https://github.com/PrompTugal/PrompTugal__News__Live';
const CC = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' };
const IPMA_LICENSE = { name: "the source's terms", url: 'https://api.ipma.pt/', holder: 'IPMA, Instituto Português do Mar e da Atmosfera', note: 'Free use for personal or public use without profit-making purpose, IPMA named as the source.' };
const MAX_CAMERAS = 500;
const MAX_NEW_PLACES = 20; // places the register adds beyond ours
const FETCH_BUDGET_MS = 4 * 60 * 1000; // after this, optional reads (history, weather) are skipped

let OUT = '_site';
const write = (rel, text) => {
  const p = resolve(OUT, rel);
  if (!p.startsWith(resolve(OUT) + sep)) throw new Error(`path outside _site: ${rel}`);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, text);
};
const json = (rel, obj) => write(rel, JSON.stringify(obj, null, 1) + '\n');
const fmtTime = (s) => (s ? esc(s.replace('T', ' ').replace(/:\d{2}(\.\d+)?Z$/, ' UTC').replace(/Z$/, ' UTC')) : 'not given');
const a = (url, text, ext = true) => { const u = safeUrl(url); if (!u) return esc(text); return `<a href="${esc(u)}"${ext && !u.startsWith('/') ? ' rel="noopener noreferrer nofollow" target="_blank"' : ''}>${esc(text)}</a>`; };

// ---------- the page shell ----------
function page({ path, title, description, body, frameHosts = [], scripts = [], current = '' }) {
  const frames = frameHosts.length ? frameHosts.map((h) => `https://${h}`).join(' ') : "'none'";
  const csp = `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${DATA}; frame-src ${frames}; base-uri 'none'; form-action 'none'; object-src 'none'`;
  const nav = [['/', 'Map'], ['/places/', 'Places'], ['/cameras/', 'Cameras'], ['/api/', 'API'], ['/how/', 'How'], ['/principles/', 'Principles'], ['/security/', 'Security']]
    .map(([h, t]) => `<a href="${h}"${current === h ? ' aria-current="page"' : ''}>${t}</a>`).join('\n');
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${path}">
<link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/brand/brand-tokens.css">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/live.css">
${scripts.map((s) => `<script src="${s}" defer></script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="mast">
<div class="mast-in">
<a class="brand" href="/">
<picture>
<source srcset="/assets/brand/promptugal-wordmark-dark.svg" media="(prefers-color-scheme: dark)">
<img src="/assets/brand/promptugal-wordmark-light.svg" alt="PrompTugal.news" width="200" height="33">
</picture>
<span class="brand-data">· Live</span>
</a>
<nav aria-label="Main">
${nav}
</nav>
</div>
<div class="mast-meta">
<span class="ver">Version __VERSION__</span>
<span>register read ${fmtTime(STATE.read_at)}</span>
<a class="pay-chip" href="https://promptugal.news/account/" title="Pay for what you read. This site is free, outside the meter, until Dinis decides; the reading account is at https://promptugal.news/account/">Pay for what you read · <b>free here</b></a>
</div>
</header>
<nav class="em-net" aria-label="The PrompTugal.news sites">
<span>Also from PrompTugal.news</span>
<a href="https://weather.promptugal.news/">Weather</a>
<a href="https://civic.promptugal.news/">Civic</a>
<a href="https://startups.promptugal.news/">Startups</a>
<a href="https://travel.promptugal.news/">Travel</a>
<a href="https://data.promptugal.news/">Data</a>
<a href="https://live.promptugal.news/" aria-current="page">Live</a>
</nav>
<main id="main">
${body}
</main>
<footer class="foot">
<p class="takedown"><strong>Take-down:</strong> if you run a camera listed here, or think we should not list it, <a href="${REPO}/issues/new?title=Take-down%20request">open an issue</a> or use <a href="https://promptugal.news/report/">promptugal.news/report/</a>, and we take the entry down while we talk. An operator can also claim its entry the same way.</p>
<p>We never record, store or re-host a camera's pictures: each view is the operator's own player or a link to it. <a href="/principles/">Our camera rules</a> · <a href="https://promptugal.news/principles/">PrompTugal.news principles</a> · <a href="https://promptugal.news/report/">Report something</a> · <a href="/security/">Security</a> · <a href="/how/">How this site works</a></p>
<p>Independent: not an official or government site. Version __VERSION__ · Code Apache-2.0, text and our data CC BY 4.0; each camera's pictures and data stay under its operator's terms, linked on its page. <a href="${REPO}">Source</a>.</p>
</footer>
</body>
</html>
`;
}

const STATE = { read_at: '', register: 'not read', register_status: null, skipped: [] };

// ---------- weather by place ----------
function weatherOf(now) {
  if (!now || typeof now !== 'object') return null;
  const st = now.station && typeof now.station === 'object' ? now.station : {};
  const r = st.reading && typeof st.reading === 'object' ? st.reading : {};
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 2000 ? v : null);
  const fc = now.forecast && Array.isArray(now.forecast.days) ? now.forecast.days[0] || {} : {};
  return {
    station: clean(st.name, 80), km: n(st.km), at: clean(r.at, 30),
    temp_c: n(r.temp_c), humidity_pct: n(r.humidity_pct), wind_kmh: n(r.wind_kmh), rain_mm: n(r.rain_mm),
    t_min_c: n(fc.t_min_c), t_max_c: n(fc.t_max_c), rain_prob_pct: n(fc.rain_prob_pct),
    source: safeUrl(st.source), page: safeUrl(st.page),
  };
}
function weatherHtml(w, placeId, placeName) {
  const from = `${DATA}/api/v1/by-place/now/${placeId}.json`;
  if (!w || !w.station) return `<p class="muted">No weather for ${esc(placeName)} at build time. <a href="${esc(from)}">The data</a>.</p>`;
  const v = (x, u) => (x === null ? 'not given' : `${esc(x)} ${u}`);
  return `<table class="kv"><tbody>
<tr><td>Temperature</td><td>${v(w.temp_c, '°C')}</td></tr>
<tr><td>Wind</td><td>${v(w.wind_kmh, 'km/h')}</td></tr>
<tr><td>Humidity</td><td>${v(w.humidity_pct, '%')}</td></tr>
<tr><td>Rain, last hour</td><td>${v(w.rain_mm, 'mm')}</td></tr>
<tr><td>Today</td><td>${v(w.t_min_c, '°C')} to ${v(w.t_max_c, '°C')}, rain ${v(w.rain_prob_pct, '% likely')}</td></tr>
</tbody></table>
<p class="src">Source: IPMA station ${esc(w.station)}${w.km !== null ? `, ${esc(w.km)} km from ${esc(placeName)}` : ''}, ${w.at ? `reading of ${fmtTime(w.at)}` : 'no reading at build time'}, as collected by <a href="${esc(from)}">data.promptugal.news</a> (${a(IPMA_LICENSE.url, "IPMA's terms")}). The weather is for the place, not the camera's exact spot. Not a warning service: follow ${a('https://www.ipma.pt/', 'IPMA')}.</p>`;
}

// ---------- the map (self-drawn SVG: no tiles, no third party) ----------
const BOX = { w: 900, h: 340, lon0: -9.1, lon1: -7.05, lat0: 36.93, lat1: 37.53 };
const xy = (lat, lon) => [((lon - BOX.lon0) / (BOX.lon1 - BOX.lon0)) * BOX.w, ((BOX.lat1 - lat) / (BOX.lat1 - BOX.lat0)) * BOX.h];
function mapSvg(places, cameras) {
  const dots = places.filter((p) => p.lat).map((p) => {
    const [x, y] = xy(p.lat, p.lon);
    return `<a href="/places/${p.id}/"><circle class="m-place" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"></circle><text class="m-label" x="${(x + 8).toFixed(1)}" y="${(y + 4).toFixed(1)}">${esc(p.name)}</text></a>`;
  }).join('\n');
  const cams = cameras.filter((c) => c.lat !== null && c.lon !== null).map((c) => {
    const [x, y] = xy(c.lat, c.lon);
    if (x < 0 || x > BOX.w || y < 0 || y > BOX.h) return '';
    return `<a href="/cameras/${c.id}/"><rect class="m-cam m-${c.status.state}" x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10"><title>${esc(c.name)}</title></rect></a>`;
  }).join('\n');
  return `<figure class="map"><svg viewBox="0 0 ${BOX.w} ${BOX.h}" role="img" aria-labelledby="map-t"><title id="map-t">The Algarve: the places we cover (circles) and the registered cameras (squares)</title>
<rect class="m-sea" x="0" y="0" width="${BOX.w}" height="${BOX.h}"></rect>
${dots}
${cams}
</svg><figcaption>The Algarve; cameras elsewhere are in the list below. Positions only: no coastline is drawn. Places from IPMA's list of forecast locations; cameras from data.promptugal.news's register. Green square: up at the last check; red: down; grey: not known.</figcaption></figure>`;
}

const stateText = { up: 'up', down: 'down', unknown: 'not known' };
function camRow(c, placeName) {
  return `<tr data-cam="${esc(c.id)}"><td><a href="/cameras/${c.id}/">${esc(c.name)}</a></td><td>${esc(placeName)}</td><td>${esc(c.operator.name)}</td><td><span class="st st-${c.status.state}">${stateText[c.status.state]}</span> <span class="muted">${fmtTime(c.status.checked_at)}</span></td></tr>`;
}
function camTable(list, placeName) {
  if (!list.length) return '';
  return `<div class="scroll"><table><thead><tr><th>Camera</th><th>Place</th><th>Operator</th><th>Last check</th></tr></thead><tbody>
${list.map((c) => camRow(c, placeName(c.place))).join('\n')}
</tbody></table></div>`;
}
function noCameras() {
  return `<div class="empty"><p><strong>No cameras are registered yet.</strong> data.promptugal.news finds and registers the cameras, checks each operator's terms first, and checks whether each is up; this site lists only what that register holds. At the last build the register was ${esc(STATE.register)}.</p></div>`;
}

// The status history records changes only (data.b@, 18 Nov 2026), so uptime is time-weighted:
// each state lasts until the next change, the last until the time of this build.
function historyHtml(hist, nowIso) {
  if (!hist.length) return '<p class="muted">No status history yet.</p>';
  const now = Date.parse(nowIso);
  const spans = hist.map((h, i) => ({ ...h, from: Date.parse(h.at), to: i + 1 < hist.length ? Date.parse(hist[i + 1].at) : now })).filter((x) => x.to > x.from);
  const total = spans.reduce((t, x) => t + (x.state === 'unknown' ? 0 : x.to - x.from), 0);
  const up = spans.reduce((t, x) => t + (x.state === 'up' ? x.to - x.from : 0), 0);
  const hours = (ms) => (ms / 3600000).toFixed(ms < 36000000 ? 1 : 0);
  const rows = hist.slice(-20).reverse().map((h) => `<li><span class="st st-${h.state}">${stateText[h.state]}</span> from ${fmtTime(h.at)}</li>`).join('');
  return `<p>${total ? `Up ${Math.round((100 * up) / total)}% of the ${hours(total)} hours with a known state` : 'No known state yet'}, from ${fmtTime(hist[0].at)} to this build (${fmtTime(nowIso)}). Source: data.promptugal.news's status history, which records each change of state.</p>
<ul class="changes">${rows}</ul>`;
}

export async function generate(outDir = '_site', opts = {}) {
  OUT = outDir;
  const placesDoc = JSON.parse(readFileSync('src/data/places.json', 'utf8'));
  const allowHosts = opts.allowHosts || JSON.parse(readFileSync('src/data/operator-hosts.json', 'utf8')).hosts || [];
  const places = placesDoc.places;
  const placeIds = new Set(places.map((p) => p.id));
  const placeName = (id) => (places.find((p) => p.id === id) || {}).name || id;

  // 1. the register
  const reg = await fetchJson(REGISTER);
  STATE.read_at = (opts.now || new Date().toISOString()).replace(/\.\d+Z$/, 'Z');
  let cameras = [];
  if (reg.ok) {
    const list = Array.isArray(reg.data?.cameras) ? reg.data.cameras.slice(0, MAX_CAMERAS) : [];
    const seen = new Set();
    for (const raw of list) {
      const r = normaliseCamera(raw, placeIds);
      if (r.skip) { STATE.skipped.push(r.skip); continue; }
      if (seen.has(r.camera.id)) { STATE.skipped.push(`${r.camera.id}: duplicate id`); continue; }
      seen.add(r.camera.id);
      cameras.push(r.camera);
    }
    STATE.register = `read (${cameras.length} cameras kept, ${STATE.skipped.length} skipped)`;
    STATE.register_status = 200;
  } else {
    STATE.register = `not available (${reg.why})`;
    STATE.register_status = reg.status ?? null;
  }
  cameras.sort((x, y) => x.place.localeCompare(y.place) || x.name.localeCompare(y.name));
  // A place the register names that we do not list yet gets a page (no map dot: no position of our own).
  for (const id of new Set(cameras.map((c) => c.place))) {
    if (!placeIds.has(id)) {
      if (places.length >= placesDoc.places.length + MAX_NEW_PLACES) { cameras = cameras.filter((c) => c.place !== id); STATE.skipped.push(`${id}: too many new places`); continue; }
      places.push({ id, name: id.split('-').map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(' '), from_register: true }); placeIds.add(id); }
  }

  // 2. status history and the embed decision for each camera (optional reads stop at the budget)
  const deadline = Date.now() + FETCH_BUDGET_MS;
  for (const c of cameras) {
    c.decision = embedDecision(c, allowHosts);
    c.history = [];
    if (c.status_history && Date.now() < deadline) {
      const hu = c.status_history.startsWith('/') ? `${DATA}${c.status_history}` : c.status_history;
      const h = await fetchJson(hu, { maxBytes: 1_000_000 });
      if (h.ok) c.history = normaliseHistory(h.data);
    }
  }

  // 3. weather by place
  const weather = {};
  for (const p of places) {
    if (Date.now() > deadline) { weather[p.id] = null; continue; }
    const r = await fetchJson(`${DATA}/api/v1/by-place/now/${p.id}.json`, { maxBytes: 1_000_000 });
    weather[p.id] = r.ok ? weatherOf(r.data) : null;
  }

  const algarve = new Set(placesDoc.places.filter((p) => p.lat).map((p) => p.id));
  const camsIn = (id) => cameras.filter((c) => c.place === id || (id === 'algarve' && algarve.has(c.place)));
  const pub = (c) => ({
    id: c.id, name: c.name, place: c.place, lat: c.lat, lon: c.lon, coords_source: c.coords_source,
    operator: c.operator, page_url: c.page_url,
    view: c.decision.embed ? { how: 'embed', url: c.decision.url, host: c.decision.host } : { how: 'link', url: c.page_url || c.operator.url, why: c.decision.why },
    terms: c.terms, license: c.license, status: c.status,
    status_history: c.status_history.startsWith('/') ? `${DATA}${c.status_history}` : c.status_history, registered_at: c.registered_at,
    page: `${SITE}/cameras/${c.id}/`, api: `${SITE}/api/v1/cameras/${c.id}.json`,
    source: REGISTER,
    provenance: { source: REGISTER, read_at: STATE.read_at, read_by: 'scripts/live/generate.mjs (code, no model), for live.b@PrompTugal.dinis', registered_by: c.by || null, registered_at: c.registered_at || null, terms_checked_at: c.terms.checked_at || null, license: c.license },
  });
  const meta = { read_at: STATE.read_at, register: REGISTER, register_state: STATE.register };
  const licence = { ...CC, holder: 'PrompTugal.news', note: "Our record (structure, names, status as read). Each camera's pictures stay with its operator, under its terms (each item's license and terms); we never store them." };

  // ---------- API ----------
  json('api/v1/cameras.json', { license: licence, about: 'Every camera on live.promptugal.news: metadata only, from data.promptugal.news\'s register.', ...meta, count: cameras.length, cameras: cameras.map(pub) });
  for (const c of cameras) json(`api/v1/cameras/${c.id}.json`, { license: licence, ...meta, camera: pub(c), history: c.history });
  const placeApi = (p) => {
    const list = camsIn(p.id);
    const here = list.find((c) => c.status.state === 'up' && c.decision.embed) || list.find((c) => c.status.state === 'up') || list[0] || null;
    return { id: p.id, name: p.name, lat: p.lat ?? null, lon: p.lon ?? null, page: `${SITE}/places/${p.id}/`, camera_here: here ? pub(here) : null, cameras: list.map((c) => c.id), weather_from: `${DATA}/api/v1/by-place/now/${p.id}.json` };
  };
  json('api/v1/places/index.json', { license: { ...licence, coords: placesDoc.coords_source }, about: 'The places live.promptugal.news covers, each with "the camera here" (an embedded camera up at the last check, else any camera up, else the first, or null) for the weather, travel and place pages.', ...meta, places: places.map(placeApi) });
  for (const p of places) json(`api/v1/places/${p.id}.json`, { license: { ...licence, coords: placesDoc.coords_source }, ...meta, place: placeApi(p) });
  json('api/v1/index.json', {
    license: licence, about: 'The API of live.promptugal.news: GET only, plain JSON files, rebuilt every three hours and on every release. Metadata only: no frame, snapshot or stream.', ...meta,
    openapi: `${SITE}/api/v1/openapi.json`,
    endpoints: ['/api/v1/index.json', '/api/v1/cameras.json', '/api/v1/cameras/{id}.json', '/api/v1/places/index.json', '/api/v1/places/{place}.json', '/api/v1/openapi.json', '/version.json'].map((p) => `${SITE}${p}`),
  });
  json('api/v1/openapi.json', openapi());

  // ---------- pages ----------
  const intro = `<p>Live views of the places we cover, from cameras that public bodies and operators share themselves. Each view is the operator's own player or a link to it: we never record, store or re-host a picture, and we never analyse what a camera shows. Beside each camera: who runs it, its terms, whether it was up at the last check, and the weather in that place.</p>`;
  write('index.html', page({ path: '/', current: '/', title: 'PrompTugal.news Live: public cameras in the Algarve', description: 'A map and list of the public cameras that public bodies and operators share in the places PrompTugal.news covers: the operator\'s own player or a link, never recorded.', scripts: ['/assets/live.js'],
    body: `<h1>Public cameras in the places we cover</h1>
${intro}
${mapSvg(places, cameras)}
<h2>The cameras</h2>
${cameras.length ? camTable(cameras, placeName) : noCameras()}
<p class="muted">Status is refreshed in your browser from <a href="${REGISTER}">data.promptugal.news</a> when it can be read; otherwise it is as at the last build. <a href="/api/v1/cameras.json">The data</a>.</p>` }));

  write('places/index.html', page({ path: '/places/', current: '/places/', title: 'Places: PrompTugal.news Live', description: 'The places PrompTugal.news Live covers, each with its cameras and the weather there.',
    body: `<h1>Places</h1><ul class="places">${places.map((p) => `<li><a href="/places/${p.id}/">${esc(p.name)}</a> <span class="muted">${camsIn(p.id).length} camera${camsIn(p.id).length === 1 ? '' : 's'}</span></li>`).join('')}</ul>` }));
  for (const p of places) {
    const list = camsIn(p.id);
    write(`places/${p.id}/index.html`, page({ path: `/places/${p.id}/`, current: '/places/', title: `${p.name}: public cameras, PrompTugal.news Live`, description: `The public cameras shared by public bodies and operators in ${p.name}, and the weather there.`, scripts: ['/assets/live.js'],
      body: `<p class="crumb"><a href="/places/">Places</a></p><h1>${esc(p.name)}</h1>
<h2>Cameras</h2>${list.length ? camTable(list, placeName) : noCameras()}
<h2>The weather in ${esc(p.name)}</h2>${p.kind === 'region' ? '<p class="muted">The Algarve is a region: open a place for its weather.</p>' : weatherHtml(weather[p.id], p.id, p.name)}
<p class="muted">Also: <a href="https://promptugal.news/algarve/">PrompTugal.news on the Algarve</a> · <a href="/api/v1/places/${p.id}.json">this place's data</a>.</p>` }));
  }

  write('cameras/index.html', page({ path: '/cameras/', current: '/cameras/', title: 'Cameras: PrompTugal.news Live', description: 'Every public camera listed on PrompTugal.news Live, with its operator and its status at the last check.', scripts: ['/assets/live.js'],
    body: `<h1>Cameras</h1>${cameras.length ? camTable(cameras, placeName) : noCameras()}` }));
  for (const c of cameras) {
    const d = c.decision;
    // Click-to-load (the YouTube flow): nothing loads from the operator until the reader asks; live.js then adds
    // the sandboxed iframe. Without script, the link below is the way to watch.
    const view = d.embed
      ? `<div class="embed" data-embed-src="${esc(d.url)}" data-embed-host="${esc(d.host)}" data-embed-title="${esc(c.name)}, the operator's own player"><button type="button" class="embed-load">Load the live view from ${esc(d.host)}</button><p class="embed-note">The operator's own player loads from its own site when you press the button; we never record or store it.</p></div><p class="src">${a(c.page_url || c.operator.url, "Or watch on the operator's page")}.</p>`
      : `<p class="view-link">${a(c.page_url || c.operator.url, `Watch on ${c.operator.name}'s own page`)}</p><p class="muted">A link, not an embed: ${esc(d.why)}.</p>`;
    write(`cameras/${c.id}/index.html`, page({ path: `/cameras/${c.id}/`, current: '/cameras/', title: `${c.name}: PrompTugal.news Live`, description: `${c.name} in ${placeName(c.place)}, a public camera run by ${c.operator.name}: the operator's own view, its terms and its status.`, frameHosts: d.embed ? [d.host] : [], scripts: ['/assets/live.js'],
      body: `<p class="crumb"><a href="/places/${c.place}/">${esc(placeName(c.place))}</a></p>
<h1 data-cam="${esc(c.id)}">${esc(c.name)} <span class="st st-${c.status.state}">${stateText[c.status.state]}</span></h1>
${view}
<h2>About this camera</h2>
<table class="kv"><tbody>
<tr><td>Operator</td><td>${a(c.operator.url, c.operator.name)}</td></tr>
<tr><td>Place</td><td><a href="/places/${c.place}/">${esc(placeName(c.place))}</a>${c.lat !== null ? ` · ${esc(c.lat)}, ${esc(c.lon)}${c.coords_source ? ` (${esc(c.coords_source)})` : ''}` : ''}</td></tr>
<tr><td>Terms</td><td>${c.terms.url ? a(c.terms.url, 'The operator\'s terms') : 'No terms found on the operator\'s page'}, checked ${fmtTime(c.terms.checked_at)}: embedding ${esc(c.terms.embedding)}.${c.terms.summary ? ` ${esc(c.terms.summary)}` : ''}</td></tr>
<tr><td>Licence</td><td>${a(c.license.url, c.license.name)}</td></tr>
<tr><td>Last check</td><td>${stateText[c.status.state]}, ${fmtTime(c.status.checked_at)}${c.status.http_status ? ` (HTTP ${esc(c.status.http_status)})` : ''}</td></tr>
<tr><td>Registered</td><td>${fmtTime(c.registered_at)}${c.by ? ` by ${esc(c.by)}` : ''}</td></tr>
<tr><td>Provenance</td><td>Read from <a href="${REGISTER}">data.promptugal.news's camera register</a> at ${fmtTime(STATE.read_at)} by this site's build (code, no model), for live.b@PrompTugal.dinis; the status check is data.promptugal.news's, a request to the operator's page only.</td></tr>
</tbody></table>
<h2>Uptime</h2>${historyHtml(c.history, STATE.read_at)}
<h2>The weather in ${esc(placeName(c.place))}</h2>${weatherHtml(weather[c.place], c.place, placeName(c.place))}
<p class="takedown">Run this camera? <a href="${REPO}/issues/new?title=${encodeURIComponent(`Camera ${c.id}`)}">Claim or correct this entry, or ask us to take it down</a>: we take it down while we talk.</p>
<p class="muted"><a href="/api/v1/cameras/${c.id}.json">This camera's data</a>.</p>` }));
  }
  // the written pages: scripts/live/content/<name>.html, first two lines the title and description
  for (const name of ['how', 'principles', 'security', 'api']) {
    const text = readFileSync(`scripts/live/content/${name}.html`, 'utf8');
    const [, title] = text.match(/^<!-- title: (.+) -->/m);
    const [, description] = text.match(/^<!-- description: (.+) -->/m);
    const body = text.replace(/^<!-- (title|description): .+ -->\n/gm, '');
    write(`${name}/index.html`, page({ path: `/${name}/`, current: `/${name}/`, title, description, body }));
  }
  STATE.cameras = cameras.length;
  STATE.embedded = cameras.filter((c) => c.decision.embed).map((c) => c.decision.host);
  return STATE;
}

function openapi() {
  const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
  const ok = (desc, schema) => ({ 200: { description: desc, content: { 'application/json': { schema } } } });
  return {
    openapi: '3.1.0',
    info: { title: 'PrompTugal.news Live API', version: '__VERSION__', description: 'Public cameras in the places PrompTugal.news covers: metadata only (camera, operator, place, terms, licence, status). GET only, static JSON files. Never frames, snapshots or streams.', license: { name: 'CC BY 4.0', url: CC.url } },
    servers: [{ url: SITE }],
    paths: {
      '/api/v1/index.json': { get: { summary: 'The API catalogue', responses: ok('The catalogue', { type: 'object' }) } },
      '/api/v1/cameras.json': { get: { summary: 'Every camera', responses: ok('Every camera', { type: 'object', properties: { cameras: { type: 'array', items: ref('Camera') } } }) } },
      '/api/v1/cameras/{id}.json': { get: { summary: 'One camera with its status history', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' } }], responses: { ...ok('The camera', { type: 'object', properties: { camera: ref('Camera'), history: { type: 'array', items: ref('Check') } } }), 404: { description: 'No such camera' } } } },
      '/api/v1/places/index.json': { get: { summary: 'Every place, with the camera here', responses: ok('The places', { type: 'object', properties: { places: { type: 'array', items: ref('Place') } } }) } },
      '/api/v1/places/{place}.json': { get: { summary: 'One place, with the camera here', parameters: [{ name: 'place', in: 'path', required: true, schema: { type: 'string' } }], responses: { ...ok('The place', { type: 'object', properties: { place: ref('Place') } }), 404: { description: 'No such place' } } } },
    },
    components: { schemas: {
      Camera: { type: 'object', required: ['id', 'name', 'place', 'operator', 'terms', 'license', 'status'], properties: {
        id: { type: 'string' }, name: { type: 'string' }, place: { type: 'string' }, lat: { type: ['number', 'null'] }, lon: { type: ['number', 'null'] },
        operator: { type: 'object', properties: { name: { type: 'string' }, kind: { enum: ['camara', 'ip', 'port', 'airport', 'park', 'operator'] }, url: { type: 'string' } } },
        page_url: { type: 'string' },
        view: { type: 'object', properties: { how: { enum: ['embed', 'link'] }, url: { type: 'string' }, host: { type: 'string' }, why: { type: 'string' } } },
        terms: { type: 'object', properties: { url: { type: 'string' }, summary: { type: 'string' }, checked_at: { type: 'string' }, embedding: { enum: ['allowed', 'not-allowed', 'unclear'] } } },
        license: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' } } },
        status: ref('Check'), status_history: { type: 'string' }, registered_at: { type: 'string' }, page: { type: 'string' }, source: { type: 'string' } } },
      Check: { type: 'object', properties: { state: { enum: ['up', 'down', 'unknown'] }, at: { type: 'string' }, checked_at: { type: 'string' }, http_status: { type: ['integer', 'null'] } } },
      Place: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, lat: { type: ['number', 'null'] }, lon: { type: ['number', 'null'] }, page: { type: 'string' }, camera_here: { oneOf: [ref('Camera'), { type: 'null' }] }, cameras: { type: 'array', items: { type: 'string' } }, weather_from: { type: 'string' } } },
    } },
  };
}
