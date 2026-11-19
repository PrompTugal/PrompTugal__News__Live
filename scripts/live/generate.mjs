// live.promptugal.news: builds the pages and the API from data.promptugal.news's camera register
// and its by-place weather. live.b@PrompTugal.dinis, 2026-11-18. Node built-ins only.
// We keep metadata only: no frame, snapshot or stream is ever fetched, stored or re-hosted here.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { esc, clean, safeUrl, fetchJson, normaliseCamera, embedDecision, normaliseHistory, DATA_HOST } from './lib.mjs';
import { previewNumbers, previewJson, previewSvg } from './preview.mjs';
// The sites bar: the version pinned in scripts/vendor/sites-bar/pin.json (checked against the registry by build.mjs).
const BAR_PIN = JSON.parse(readFileSync(new URL('../vendor/sites-bar/pin.json', import.meta.url), 'utf8'));
const BAR_V = /^\d+\.\d+\.\d+$/.test(BAR_PIN.version) ? BAR_PIN.version : '0.0.0';
const { render: renderSitesBar } = await import(`../vendor/sites-bar/${BAR_V}/sites-bar-render.mjs`);
let BAR_ON = true; // false when the build leaves the bar out (the registry names a newer version than we pin)

const SITE = 'https://live.promptugal.news';
const DATA = `https://${DATA_HOST}`;
const REGISTER = `${DATA}/api/v1/cameras/index.json`;
const REPO = 'https://github.com/PrompTugal/PrompTugal__News__Live';
const CC = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' };
const IPMA_LICENSE = { name: "the source's terms", url: 'https://api.ipma.pt/', holder: 'IPMA, Instituto Português do Mar e da Atmosfera', note: 'Free use for personal or public use without profit-making purpose, IPMA named as the source.' };
const MAX_CAMERAS = 3000; // the register held 911 on 18 Nov 2026 (889 TfL JamCams); 5 MB read cap
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
// The policy for one page: frames only from the reviewed iframe sources, video and images only from the reviewed
// media sources (host and path), each a CSP source expression built by embedDecision().
// Observability (assets/obs/obs.js, at Dinis's word, 18 Nov 2026): its endpoint, the shared config on promptugal.news and
// nothing else (no place lookup since 19 Nov 2026, at Dinis's word).
const OBS_CONNECT = 'https://dev.send.sgraph.ai https://promptugal.news';
// The sites bar: each pop-up shows that site's /preview.svg as an image and reads its /version.json.
const BAR_SRC = 'https://promptugal.news https://*.promptugal.news';
let BAR = ''; // the bar's HTML for this build, from renderSitesBar() or the last deployed bar
const cspFor = ({ frameSrc = [], mediaSrc = [], connect = `'self' ${DATA} ${OBS_CONNECT} https://*.promptugal.news` }) => {
  const f = [...new Set(frameSrc)].sort(), m = [...new Set(mediaSrc)].sort();
  return `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: ${BAR_SRC}${m.length ? ' ' + m.join(' ') : ''}; media-src ${m.length ? m.join(' ') : "'none'"}; connect-src ${connect}; frame-src ${f.length ? f.join(' ') : "'none'"}; base-uri 'none'; form-action 'none'; object-src 'none'`;
};
const srcsOf = (cams) => ({ frameSrc: cams.filter((c) => c.decision.embed && c.decision.kind === 'iframe').map((c) => c.decision.src), mediaSrc: cams.filter((c) => c.decision.embed && c.decision.kind !== 'iframe').map((c) => c.decision.src) });
// The view of one camera, loaded when the reader presses its button (live.js checks every attribute again).
const viewBox = (c, label) => { const d = c.decision; return `<div class="embed" data-embed-src="${esc(d.url)}" data-embed-host="${esc(d.host)}" data-embed-kind="${esc(d.kind)}" data-embed-prefix="${esc(d.path_prefix)}" data-embed-poster="${esc(d.poster)}" data-embed-title="${esc(c.name)}, ${esc(c.operator.name)}'s own ${d.kind === 'iframe' ? 'player' : d.kind}"><button type="button" class="embed-load">${esc(label)}</button><p class="embed-note">${esc(c.operator.name)}'s own ${d.kind === 'iframe' ? 'player' : d.kind === 'video' ? 'latest clip' : 'latest image'}, loaded from ${esc(d.host)} when you press the button; we never record or store it.</p></div>`; };
const creditHtml = (c) => `<p class="credit">Live view: ${a(c.page_url || c.operator.url, c.operator.name)} · ${a(c.license.url, c.license.name)}${c.credit ? ` · ${esc(c.credit)}` : ''}. Shown under the operator's terms; this does not suggest the operator's endorsement.</p>`;

function page({ path, title, description, body, frameSrc = [], mediaSrc = [], scripts = [], current = '' }) {
  const csp = cspFor({ frameSrc, mediaSrc });
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
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/preview.png">
<link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/brand/brand-tokens.css">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/live.css">
${BAR_ON ? `<link rel="stylesheet" href="/assets/sites-bar/${BAR_V}/sites-bar.css">\n` : ''}${[...scripts, ...(BAR_ON ? [`/assets/sites-bar/${BAR_V}/sites-bar.js`] : []), '/assets/obs/obs.js'].map((s) => `<script src="${s}" defer></script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
${BAR}
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

function embedPage(c, d, placeName) {
  const csp = cspFor({ ...srcsOf([c]), connect: "'none'" });
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.name)}: live view, PrompTugal.news Live</title>
<meta name="description" content="${esc(c.name)} in ${esc(placeName)}, ${esc(c.operator.name)}'s own live view, for embedding on PrompTugal.news sites.">
<link rel="canonical" href="${SITE}/cameras/${c.id}/">
<link rel="stylesheet" href="/assets/brand/brand-tokens.css">
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/live.css">
<script src="/assets/live.js" defer></script>
</head>
<body class="embed-body">
${viewBox(c, `Watch ${c.name} live`)}
${creditHtml(c)}
<p class="credit"><a href="${SITE}/cameras/${c.id}/" target="_blank" rel="noopener">About this camera on PrompTugal.news Live</a></p>
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
    lic: licOf(now.license), ipma_lic: licOf(now.license && typeof now.license === 'object' && now.license.sources && typeof now.license.sources === 'object' ? now.license.sources.ipma : null),
  };
}
// A file's own licence block, checked: a short name and an https link, or nothing (security@'s low point: show each
// loaded file's licence beside its figures).
// Licence links only to known licence hosts (the AppSec post-review, 19 Nov 2026: a free-text name over any link could
// mislead); live.js keeps the same list.
const LICENCE_HOSTS = new Set(['creativecommons.org', 'opendatacommons.org', 'www.ipma.pt', 'api.ipma.pt', 'www.nationalarchives.gov.uk', 'tfl.gov.uk', 'promptugal.news', 'data.promptugal.news']);
function licOf(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
  const name = clean(l.name, 60), url = safeUrl(l.url);
  return name && url && !url.startsWith('/') && LICENCE_HOSTS.has(new URL(url).hostname) ? { name, url } : null;
}
const licLine = (lic, ipma) => `${lic ? `This file: ${a(lic.url, lic.name)} (PrompTugal.news's record)` : `The file read gives no licence we can link; we publish our record under ${a('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}`}; IPMA's values under ${a(ipma ? ipma.url : IPMA_LICENSE.url, "IPMA's terms")}`;
// The weather block: the build writes the last known figures (the fallback); live.js replaces them in the browser with
// data.promptugal.news's latest file for the place when it passes its checks (data in the browser, Dinis, 19 Nov 2026).
function weatherHtml(w, placeId, placeName) {
  const from = `${DATA}/api/v1/by-place/now/${placeId}.json`;
  const v = (x) => (x === null || x === undefined ? 'not given' : esc(x));
  const has = w && w.station;
  return `<div class="wx" data-wx="${placeId}" data-read="${esc(has ? w.at : '')}">
<table class="kv"><tbody>
<tr><td>Temperature</td><td><span data-k="temp_c">${v(has ? w.temp_c : null)}</span> °C</td></tr>
<tr><td>Wind</td><td><span data-k="wind_kmh">${v(has ? w.wind_kmh : null)}</span> km/h</td></tr>
<tr><td>Humidity</td><td><span data-k="humidity_pct">${v(has ? w.humidity_pct : null)}</span> %</td></tr>
<tr><td>Rain, last hour</td><td><span data-k="rain_mm">${v(has ? w.rain_mm : null)}</span> mm</td></tr>
<tr><td>Today</td><td><span data-k="t_min_c">${v(has ? w.t_min_c : null)}</span> °C to <span data-k="t_max_c">${v(has ? w.t_max_c : null)}</span> °C, rain <span data-k="rain_prob_pct">${v(has ? w.rain_prob_pct : null)}</span> % likely</td></tr>
</tbody></table>
<p class="src">Source: IPMA station <span data-k="station">${esc(has ? w.station : 'not known')}</span>, <span class="wx-when">${has && w.at ? `reading of ${fmtTime(w.at)}` : 'no reading at build time'}</span> (<span class="wx-state">the copy built with this page</span>), as collected by <a href="${esc(from)}">data.promptugal.news</a>. <span class="wx-lic">${licLine(has ? w.lic : null, has ? w.ipma_lic : null)}</span>. The weather is for the place, not the camera's exact spot. Not a warning service: follow ${a('https://www.ipma.pt/', 'IPMA')}.</p>
</div>`;
}

// A place's point from data.promptugal.news's now file (Wikidata P625, CC0), checked; else null and the IPMA
// list stays. Only own numeric fields, inside the Algarve and Lisbon with a margin, 4 decimals.
function coordsOf(now, inPortugal = true) {
  const c = now && typeof now === 'object' && now.coords && typeof now.coords === 'object' && !Array.isArray(now.coords) ? now.coords : null;
  if (!c || !Object.prototype.hasOwnProperty.call(c, 'lat') || !Object.prototype.hasOwnProperty.call(c, 'lon')) return null;
  const { lat, lon } = c;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const portugal = lat >= 36.8 && lat <= 39.0 && lon >= -9.6 && lon <= -7.2, london = lat >= 51.2 && lat <= 51.8 && lon >= -0.6 && lon <= 0.4;
  if (inPortugal ? !portugal : !london) return null; // a place's point must fall in its own country's box
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
}

// ---------- the maps (self-drawn SVG: no tiles, no third party), one per area ----------
const AREAS = [
  { id: 'algarve', title: 'The Algarve', box: { w: 900, h: 340, lon0: -9.1, lon1: -7.05, lat0: 36.93, lat1: 37.53 }, coast: true },
  { id: 'london', title: 'Beyond Portugal: London', box: { w: 900, h: 560, lon0: -0.53, lon1: 0.31, lat0: 51.28, lat1: 51.70 }, coast: false },
];
const xy = (box, lat, lon) => [((lon - box.lon0) / (box.lon1 - box.lon0)) * box.w, ((box.lat1 - lat) / (box.lat1 - box.lat0)) * box.h];
const inBox = (box, lat, lon) => {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  const [x, y] = xy(box, lat, lon);
  return x >= 0 && x <= box.w && y >= 0 && y <= box.h;
};
// The coastline (src/data/coastline.json, Natural Earth): numbers only, each coerced and checked; the path is built
// from the letters M and L and toFixed numbers, never from text in the file.
function coastPaths(box) {
  let doc;
  try { doc = JSON.parse(readFileSync('src/data/coastline.json', 'utf8')); } catch { return ''; }
  const lines = Array.isArray(doc.lines) ? doc.lines.slice(0, 200) : [];
  return lines.map((line) => {
    const pts = (Array.isArray(line) ? line.slice(0, 5000) : []).map((p) => [Number(p?.[0]), Number(p?.[1])]).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
    if (pts.length < 2) return '';
    const d = pts.map(([lon, lat], i) => { const [x, y] = xy(box, lat, lon); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
    return `<path class="m-coast" d="${d}"></path>`;
  }).join('\n');
}
const LABEL_DY = { lagoa: 18 }; // Lagoa's label below its dot, clear of Portimão's
function mapSvg(area, places, cameras) {
  const box = area.box;
  const dots = places.filter((p) => inBox(box, p.lat, p.lon)).map((p) => {
    const [x, y] = xy(box, p.lat, p.lon);
    const end = x > box.w * 0.8; // labels near the right edge sit to the left of their dot
    const dy = LABEL_DY[p.id] || 4;
    return `<a href="/places/${p.id}/"><circle class="m-place" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"></circle><text class="m-label${end ? ' m-end' : ''}" x="${(end ? x - 8 : x + 8).toFixed(1)}" y="${(y + dy).toFixed(1)}">${esc(p.name)}</text></a>`;
  }).join('\n');
  const shown = cameras.filter((c) => c.decision.embed && inBox(box, c.lat, c.lon));
  const r = shown.length > 200 ? 3 : 7;
  const cams = shown.map((c) => {
    const [x, y] = xy(box, c.lat, c.lon);
    return `<a class="m-cam-link" href="/cameras/${c.id}/" data-view="${c.id}"><rect class="m-cam m-${c.status.state}" x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}"><title>${esc(c.name)}: press to watch</title></rect></a>`;
  }).join('\n');
  const how = area.coast ? ` Coastline: <a href="/data/coastline.json">Natural Earth's 1:10m coastline</a> (public domain), coarse at this scale.` : ' Positions only: no streets or river are drawn.';
  return `<figure class="map" id="map-${area.id}"><p class="map-title">${esc(area.title)}: ${shown.length} camera${shown.length === 1 ? '' : 's'} to watch</p><svg viewBox="0 0 ${box.w} ${box.h}" role="img" aria-labelledby="map-t-${area.id}"><title id="map-t-${area.id}">${esc(area.title)}: the places we cover (circles) and the cameras you can watch here (squares)</title>
<rect class="m-sea" x="0" y="0" width="${box.w}" height="${box.h}"></rect>
${area.coast ? coastPaths(box) : ''}
${dots}
${cams}
</svg><figcaption>Press a square to watch that camera here, in its operator's own view.${how} Places from data.promptugal.news (Wikidata) where it gives a point${area.id === 'algarve' ? ", else IPMA's list of forecast locations" : ''}; cameras from data.promptugal.news's register. Green square: up at the last check; red: down; grey: not known.</figcaption></figure>`;
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

  // 0. the sites bar (the pinned version): the registry from promptugal.news, rendered by the vendored renderer; if the
  // registry cannot be read or is refused, the bar this site last deployed, if it was rendered by the same version; if
  // neither, no bar (never a hand-made one). opts.barOff (build.mjs: the registry names a newer version) leaves it out.
  BAR = ''; STATE.bar = 'none'; BAR_ON = !opts.barOff;
  const sr = BAR_ON ? await fetchJson('https://promptugal.news/api/v1/sites.json', { host: 'promptugal.news', maxBytes: 200_000 }) : { ok: false };
  if (!BAR_ON) STATE.bar = 'off';
  else if (sr.ok) { BAR = renderSitesBar(sr.data, { here: 'live.promptugal.news' }); if (BAR) STATE.bar = 'from the registry'; }
  if (BAR_ON && !BAR && !opts.noFallback) {
    const last = await fetchJson('https://live.promptugal.news/assets/sites-bar/bar.json', { host: 'live.promptugal.news', maxBytes: 100_000 });
    const h = last.ok && last.data?.version === BAR_V && typeof last.data?.html === 'string' ? last.data.html : '';
    if (h.length < 60000 && /^<nav class="ptsb" aria-label="The PrompTugal\.news sites">[\s\S]*<\/nav>$/.test(h) && !/<script|\son[a-z]+=|javascript:/i.test(h)) { BAR = h; STATE.bar = 'the last deployed bar'; }
  }

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
    STATE.register_written = typeof reg.data?.read_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(reg.data.read_at) ? reg.data.read_at : '';
    STATE.register_status = 200;
    STATE.register_license = licOf(reg.data?.license);
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
  const histCache = new Map();
  for (const c of cameras) {
    c.decision = embedDecision(c, allowHosts);
    c.history = [];
    if (c.status_history && Date.now() < deadline) {
      const hu = c.status_history.startsWith('/') ? `${DATA}${c.status_history}` : c.status_history;
      // one read per URL: a place's history file serves all its cameras
      if (!histCache.has(hu)) histCache.set(hu, await fetchJson(hu, { maxBytes: 3_000_000 }));
      const h = histCache.get(hu);
      if (h.ok) c.history = normaliseHistory(h.data, c.id);
    }
  }

  // 3. weather by place
  const weather = {};
  for (const p of places) {
    if (Date.now() > deadline) { weather[p.id] = null; continue; }
    const r = await fetchJson(`${DATA}/api/v1/by-place/now/${p.id}.json`, { maxBytes: 1_000_000 });
    weather[p.id] = r.ok ? weatherOf(r.data) : null;
    const k = r.ok ? coordsOf(r.data, !p.from_register || p.id !== 'london') : null;
    if (k) { p.lat = k.lat; p.lon = k.lon; p.coords_label = 'Wikidata (P625), CC0, as collected by data.promptugal.news'; }
    else if (p.lat) p.coords_label = "IPMA's list of forecast locations";
  }

  const algarve = new Set(placesDoc.places.filter((p) => p.lat).map((p) => p.id));
  const camsIn = (id) => cameras.filter((c) => c.place === id || (id === 'algarve' && algarve.has(c.place)));
  const pub = (c) => ({
    id: c.id, name: c.name, place: c.place, lat: c.lat, lon: c.lon, coords_source: c.coords_source,
    operator: c.operator, page_url: c.page_url,
    view: c.decision.embed ? { how: 'embed', kind: c.decision.kind, url: c.decision.url, poster: c.decision.poster || null, host: c.decision.host, path_prefix: c.decision.path_prefix || null, embed_page: `${SITE}/embed/${c.id}/` } : { how: 'link', url: c.page_url || c.operator.url, why: c.decision.why },
    terms: c.terms, license: c.license, credit: c.credit || null, status: c.status,
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
    return { id: p.id, name: p.name, lat: p.lat ?? null, lon: p.lon ?? null, coords_from: p.coords_label || null, page: `${SITE}/places/${p.id}/`, camera_here: here ? pub(here) : null, cameras: list.map((c) => c.id), weather_from: `${DATA}/api/v1/by-place/now/${p.id}.json` };
  };
  json('api/v1/places/index.json', { license: { ...licence, coords: placesDoc.coords_source }, about: 'The places live.promptugal.news covers, each with "the camera here" (an embedded camera up at the last check, else any camera up, else the first, or null) for the weather, travel and place pages.', ...meta, places: places.map(placeApi) });
  for (const p of places) json(`api/v1/places/${p.id}.json`, { license: { ...licence, coords: placesDoc.coords_source }, ...meta, place: placeApi(p) });
  json('api/v1/index.json', {
    license: licence, about: 'The API of live.promptugal.news: GET only, plain JSON files, rebuilt on every release; the changing figures load in the browser. Metadata only: no frame, snapshot or stream.', ...meta,
    openapi: `${SITE}/api/v1/openapi.json`,
    endpoints: ['/api/v1/index.json', '/api/v1/views.json', '/api/v1/cameras.json', '/api/v1/cameras/{id}.json', '/api/v1/places/index.json', '/api/v1/places/{place}.json', '/api/v1/openapi.json', '/version.json'].map((p) => `${SITE}${p}`),
  });
  json('api/v1/openapi.json', openapi());
  // The map's viewer reads this (same origin): one entry per camera that can be watched here.
  json('api/v1/views.json', { license: licence, about: "For the map on live.promptugal.news: how to show each camera that can be watched here. Each view is loaded from its operator on the reader's press, never stored.", ...meta,
    views: Object.fromEntries(cameras.filter((c) => c.decision.embed).map((c) => [c.id, { name: c.name, operator: c.operator.name, operator_page: c.page_url || c.operator.url, kind: c.decision.kind, url: c.decision.url, poster: c.decision.poster || '', host: c.decision.host, path_prefix: c.decision.path_prefix || '', credit: c.credit || '', license: { name: c.license.name, url: c.license.url }, page: `/cameras/${c.id}/` }])) });

  // ---------- pages ----------
  const intro = `<p>Live views of the places we cover, from cameras that public bodies and operators share themselves. Each view is the operator's own player, embedded here with the credit and a link to them: we never record, store or re-host a picture, and we never analyse what a camera shows. Beside each camera: who runs it, its terms, whether it was up at the last check, and the weather in that place.</p>`;
  const watchable = cameras.filter((c) => c.decision.embed), linkOnly = cameras.filter((c) => !c.decision.embed);
  const noWatchable = () => `<div class="empty"><p><strong>No camera can be watched here yet.</strong> We show a camera only where its operator offers an embed whose terms let us use it, from the operator's own site. data.promptugal.news registers the cameras and checks their terms; ${cameras.length} are registered, and none has such an embed yet.</p></div>`;
  const areaOf = (c) => AREAS.find((ar) => inBox(ar.box, c.lat, c.lon));
  const maps = AREAS.filter((ar) => ar.id === 'algarve' || watchable.some((c) => areaOf(c) === ar)).map((ar) => mapSvg(ar, places, cameras)).join('\n');
  const london = watchable.filter((c) => areaOf(c)?.id === 'london'), rest = watchable.filter((c) => areaOf(c)?.id !== 'london');
  write('index.html', page({ path: '/', current: '/', ...srcsOf(watchable), title: 'PrompTugal.news Live: public cameras in the places we cover', description: 'A map of the public cameras that public bodies and operators share in the places PrompTugal.news covers: press one to watch it live in the operator\'s own player, never recorded.', scripts: ['/assets/live.js'],
    body: `<h1>Public cameras in the places we cover</h1>
${intro}
<section id="viewer" class="viewer" aria-live="polite" hidden></section>
${maps}
<h2>Cameras you can watch here</h2>
${watchable.length ? (rest.length ? camTable(rest, placeName) : '') : noWatchable()}
${london.length ? `<details class="pending"><summary>Beyond Portugal: London, ${london.length} cameras</summary>${camTable(london, placeName)}</details>` : ''}
${linkOnly.length ? `<details class="pending"><summary>${linkOnly.length} more cameras are registered but cannot be shown here yet</summary><p>Their operators have not yet offered an embed we may use, so we do not show them on the map. We are asking them. Until then, each links to the operator's own page.</p>${camTable(linkOnly, placeName)}</details>` : ''}
<p class="muted">Up or down: <span id="reg-state" data-read="${esc(STATE.register_written || '')}">as at this page's build, from the register written at ${fmtTime(STATE.register_written || '')}</span>. <span id="reg-lic">${STATE.register_license ? `The register: ${a(STATE.register_license.url, STATE.register_license.name)}, PrompTugal.news's record` : `The register gives no licence we can link; we publish our record under ${a('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0')}`}; each camera under its operator's terms</span>. Your browser reads <a href="${REGISTER}">data.promptugal.news's register</a> when the page opens and every five minutes; data.promptugal.news collects twice a day, so a check older than 13 hours is marked stale. <a href="/api/v1/cameras.json">The data</a> (CC BY 4.0; each camera under its operator's terms).</p>` }));

  write('places/index.html', page({ path: '/places/', current: '/places/', title: 'Places: PrompTugal.news Live', description: 'The places PrompTugal.news Live covers, each with its cameras and the weather there.',
    body: `<h1>Places</h1><ul class="places">${places.map((p) => `<li><a href="/places/${p.id}/">${esc(p.name)}</a> <span class="muted">${camsIn(p.id).length} camera${camsIn(p.id).length === 1 ? '' : 's'}</span></li>`).join('')}</ul>` }));
  for (const p of places) {
    const list = camsIn(p.id);
    write(`places/${p.id}/index.html`, page({ path: `/places/${p.id}/`, current: '/places/', title: `${p.name}: public cameras, PrompTugal.news Live`, description: `The public cameras shared by public bodies and operators in ${p.name}, and the weather there.`, scripts: ['/assets/live.js'],
      body: `<p class="crumb"><a href="/places/">Places</a></p><h1>${esc(p.name)}</h1>
<h2>Cameras</h2>${list.length ? camTable(list, placeName) : noCameras()}
${p.lat ? `<p class="muted">Position on the map: ${esc(p.lat)}, ${esc(p.lon)}, from ${esc(p.coords_label || '')}.</p>` : ''}
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
      ? `${viewBox(c, `Load the live view from ${d.host}`)}${creditHtml(c)}<p class="src">Embed it on another PrompTugal.news site: <a href="/embed/${c.id}/">/embed/${c.id}/</a>.</p>`
      : `<p class="view-link">${a(c.page_url || c.operator.url, `Watch on ${c.operator.name}'s own page`)}</p><p class="muted">A link, not an embed: ${esc(d.why)}.</p>`;
    write(`cameras/${c.id}/index.html`, page({ path: `/cameras/${c.id}/`, current: '/cameras/', title: `${c.name}: PrompTugal.news Live`, description: `${c.name} in ${placeName(c.place)}, a public camera run by ${c.operator.name}: the operator's own view, its terms and its status.`, ...srcsOf([c]), scripts: ['/assets/live.js'],
      body: `<p class="crumb"><a href="/places/${c.place}/">${esc(placeName(c.place))}</a></p>
<h1 data-cam="${esc(c.id)}">${esc(c.name)} <span class="st st-${c.status.state}">${stateText[c.status.state]}</span></h1>
${view}
<h2>About this camera</h2>
<table class="kv"><tbody>
<tr><td>Operator</td><td>${a(c.operator.url, c.operator.name)}</td></tr>
<tr><td>Place</td><td><a href="/places/${c.place}/">${esc(placeName(c.place))}</a>${c.lat !== null ? ` · ${esc(c.lat)}, ${esc(c.lon)}${c.coords_source ? ` (${esc(c.coords_source)})` : ''}` : ''}</td></tr>
<tr><td>Terms</td><td>${c.terms.url ? a(c.terms.url, 'The operator\'s terms') : 'No terms found on the operator\'s page'}, checked ${fmtTime(c.terms.checked_at)}: embedding ${esc(c.terms.embedding)}.${c.terms.summary ? ` ${esc(c.terms.summary)}` : ''}</td></tr>
<tr><td>Licence</td><td>${a(c.license.url, c.license.name)}, commercial use ${esc(c.license.commercial_use)}${c.credit ? `; credit: ${esc(c.credit)}` : ''}</td></tr>
<tr><td>Last check</td><td>${stateText[c.status.state]}, ${fmtTime(c.status.checked_at)}${c.status.http_status ? ` (HTTP ${esc(c.status.http_status)})` : ''}</td></tr>
<tr><td>Registered</td><td>${fmtTime(c.registered_at)}${c.by ? ` by ${esc(c.by)}` : ''}</td></tr>
<tr><td>Provenance</td><td>Read from <a href="${REGISTER}">data.promptugal.news's camera register</a> at ${fmtTime(STATE.read_at)} by this site's build (code, no model), for live.b@PrompTugal.dinis; the status check is data.promptugal.news's, a request to the operator's page only.</td></tr>
</tbody></table>
<h2>Uptime</h2>${historyHtml(c.history, STATE.read_at)}
<h2>The weather in ${esc(placeName(c.place))}</h2>${weatherHtml(weather[c.place], c.place, placeName(c.place))}
<p class="takedown">Run this camera? <a href="${REPO}/issues/new?title=${encodeURIComponent(`Camera ${c.id}`)}">Claim or correct this entry, or ask us to take it down</a>: we take it down while we talk.</p>
<p class="muted"><a href="/api/v1/cameras/${c.id}.json">This camera's data</a>.</p>` }));
  }
  // /embed/<id>/: one camera's player and its credit, for the other PrompTugal.news sites to frame (Dinis,
  // 18 Nov 2026: "embed this in the multiple websites"). The operator's player loads when pressed.
  for (const c of watchable) {
    const d = c.decision;
    write(`embed/${c.id}/index.html`, embedPage(c, d, placeName(c.place)));
  }
  // the written pages: scripts/live/content/<name>.html, first two lines the title and description
  for (const name of ['how', 'principles', 'security', 'api']) {
    const text = readFileSync(`scripts/live/content/${name}.html`, 'utf8');
    const [, title] = text.match(/^<!-- title: (.+) -->/m);
    const [, description] = text.match(/^<!-- description: (.+) -->/m);
    const body = text.replace(/^<!-- (title|description): .+ -->\n/gm, '');
    write(`${name}/index.html`, page({ path: `/${name}/`, current: `/${name}/`, title, description, body }));
  }
  if (BAR) json('assets/sites-bar/bar.json', { license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' }, about: `The sites bar this build rendered (sites bar ${BAR_V}), kept so the next build can use it if the registry is down; used only by a build of the same version.`, version: BAR_V, from: STATE.bar, at: STATE.read_at, html: BAR });
  // the preview for the sites bar
  const pn = previewNumbers(cameras, STATE.read_at);
  write('preview.svg', previewSvg(pn));
  json('preview.json', previewJson(pn));
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
      Place: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, lat: { type: ['number', 'null'] }, lon: { type: ['number', 'null'] }, coords_from: { type: ['string', 'null'] }, page: { type: 'string' }, camera_here: { oneOf: [ref('Camera'), { type: 'null' }] }, cameras: { type: 'array', items: { type: 'string' } }, weather_from: { type: 'string' } } },
    } },
  };
}
