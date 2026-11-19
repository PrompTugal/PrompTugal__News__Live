// live.promptugal.news: the safety helpers every page and API file goes through.
// live.b@PrompTugal.dinis, 2026-11-18. Every value read from data.promptugal.news is untrusted text:
// it reaches HTML only through esc(), and a URL only through safeUrl(). Node built-ins only.

// Escape for HTML text and double-quoted attributes.
export const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

// Strip control characters, replace em dashes (the wording check), cap the length.
export const clean = (v, max = 300) => {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\u2014/g, ", ").replace(/\s+/g, " ").trim().slice(0, max);
};

// Only https URLs, no credentials, port, backslash or other scheme. Site-relative paths only where the caller
// asks (status_history on data.promptugal.news), never for links taken from the data.
export function safeUrl(v, { relative = false } = {}) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s || s.length > 2000 || /[\u0000-\u0020\\]/.test(s)) return "";
  if (s.startsWith("/") && !s.startsWith("//")) return relative ? s : "";
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.')) return '';
  return u.href;
}
export const hostOf = (v) => { const u = safeUrl(v); if (!u || u.startsWith('/')) return ''; return new URL(u).hostname.toLowerCase(); };
// host equals allowed, or is a subdomain of it
export const hostMatches = (host, allowed) => !!host && !!allowed && (host === allowed || host.endsWith('.' + allowed));

export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED = new Set(['api', 'assets', 'data', 'places', 'cameras', 'how', 'security', 'principles', 'map', 'index']);
export const slug = (v) => { const s = String(v ?? '').toLowerCase(); return SLUG.test(s) && !RESERVED.has(s) ? s : ''; };

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const iso = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) ? v : '');
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// Fetch JSON from data.promptugal.news only: https, no redirects, a timeout and a size cap.
export const DATA_HOST = 'data.promptugal.news';
// host: data.promptugal.news unless the caller names one of the estate's own hosts (the sites bar's registry on
// promptugal.news, and this site's own last bar); nothing else is ever read.
const READ_HOSTS = new Set([DATA_HOST, 'promptugal.news', 'live.promptugal.news']);
export async function fetchJson(url, { maxBytes = 5_000_000, timeoutMs = 15000, host = DATA_HOST } = {}) {
  const u = safeUrl(url);
  if (!u || !READ_HOSTS.has(host) || new URL(u).hostname !== host) return { ok: false, why: `not an https URL on ${host}` };
  let r;
  try { r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } }); }
  catch (e) { return { ok: false, why: `fetch failed (${clean(e.cause?.code || e.name, 40)})` }; }
  if (!r.ok) return { ok: false, status: r.status, why: `HTTP ${r.status}` };
  if (!/json/.test(r.headers.get('content-type') || '')) return { ok: false, why: 'not JSON' };
  const len = Number(r.headers.get('content-length') || 0);
  if (len > maxBytes) return { ok: false, why: 'too large' };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) return { ok: false, why: 'too large' };
  try { return { ok: true, status: r.status, data: JSON.parse(buf.toString('utf8')) }; }
  catch { return { ok: false, why: 'invalid JSON' }; }
}

const license = (v) => {
  const l = obj(v);
  const name = clean(l.name, 80), url = safeUrl(l.url);
  // commercial_use: Dinis, 18 Nov 2026, about 23:10 UTC: the sites show only data whose licence allows commercial use.
  return name || url ? { name: name || "the source's terms", url, commercial_use: pick(l.commercial_use, ['allowed', 'not-allowed', 'unclear'], 'unclear') } : null;
};
// A path prefix such as /jamcams.tfl.gov.uk/: starts and ends with a slash, no dot segments, safe characters only.
const prefixOf = (v) => (typeof v === 'string' && /^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*\/$/.test(v) && !/\/\.\.?\//.test(v) && v.length <= 200 ? v : '');

// Copy the known fields of one register record, checked; anything else is dropped.
// Returns { camera } or { skip: reason }.
export function normaliseCamera(raw, placeIds) {
  const c = obj(raw);
  const id = slug(c.id);
  if (!id) return { skip: 'id is not a safe slug' };
  // A place we list, or a new place the register names (it then gets a page of its own).
  const place = slug(c.place) || (placeIds.has(c.place) ? c.place : '');
  if (!place) return { skip: `${id}: place is not a safe slug` };
  const op = obj(c.operator), emb = obj(c.embed), t = obj(c.terms), st = obj(c.status);
  const camera = {
    id,
    name: clean(c.name, 120) || id,
    place,
    lat: num(c.lat, 30, 61), lon: num(c.lon, -32, 2), // Portugal and its islands, and the UK (London from 18 Nov 2026)
    coords_source: clean(c.coords_source, 200),
    operator: { name: clean(op.name, 120), kind: pick(op.kind, ['camara', 'ip', 'port', 'airport', 'park', 'operator'], 'operator'), url: safeUrl(op.url) },
    page_url: safeUrl(c.page_url),
    embed: { allowed: emb.allowed === true, url: safeUrl(emb.url), image_url: safeUrl(emb.image_url), video_url: safeUrl(emb.video_url), host: clean(emb.host, 120).toLowerCase(), path_prefix: prefixOf(emb.path_prefix), how: pick(emb.how, ['iframe', 'video', 'image', 'link'], 'link') },
    credit: clean(c.credit, 400),
    terms: { url: safeUrl(t.url), summary: clean(t.summary, 400), checked_at: iso(t.checked_at), embedding: pick(t.embedding, ['allowed', 'not-allowed', 'unclear'], 'unclear'), commercial_use: pick(t.commercial_use, ['allowed', 'not-allowed', 'unclear'], 'unclear') },
    license: license(c.license),
    status: { state: pick(st.state, ['up', 'down', 'unknown'], 'unknown'), checked_at: iso(st.checked_at), http_status: num(st.http_status, 100, 599) },
    status_history: safeUrl(c.status_history, { relative: true }),
    registered_at: iso(c.registered_at),
    by: clean(c.by, 120),
  };
  if (!camera.operator.name) return { skip: `${id}: no operator named` };
  if (!camera.page_url && !camera.operator.url) return { skip: `${id}: no operator page to link to` };
  // Terms must have been checked; a check that found none is kept, as a link out only.
  if (!camera.terms.checked_at) return { skip: `${id}: terms not checked` };
  if (!camera.license) camera.license = { name: "the source's terms", url: camera.terms.url || camera.page_url || camera.operator.url, commercial_use: 'unclear' };
  // Commercial use may be recorded on the licence or on the terms (data.promptugal.news uses both); a 'not-allowed'
  // on either wins, then an 'allowed' on either.
  const cu = [camera.license.commercial_use, camera.terms.commercial_use];
  camera.license.commercial_use = cu.includes('not-allowed') ? 'not-allowed' : cu.includes('allowed') ? 'allowed' : 'unclear';
  return { camera };
}

// May this camera be embedded? Every condition must hold; otherwise it is a link out.
export function embedDecision(cam, allowHosts) {
  const e = cam.embed;
  if (!e.allowed) return { embed: false, why: 'the register does not say embedding is allowed' };
  if (cam.terms.embedding !== 'allowed' || !cam.terms.url) return { embed: false, why: 'the operator terms, as checked, do not say embedding is allowed' };
  // No commercial-use gate here: only promptugal.news bills; live.promptugal.news carries no billing and may show any
  // data with its licence and provenance (Dinis, 18 Nov 2026, about 23:45 UTC). commercial_use stays recorded and shown.
  const kind = e.how;
  const url = kind === 'video' ? (e.video_url || e.url) : kind === 'image' ? (e.image_url || e.url) : kind === 'iframe' ? e.url : '';
  if (!url || url.startsWith('/')) return { embed: false, why: 'no https embed URL' };
  const h = hostOf(url);
  if (hostMatches(h, 'promptugal.news')) return { embed: false, why: 'an embed must come from the operator, never from our own sites' };
  if (!hostMatches(h, e.host)) return { embed: false, why: 'the embed URL is not on the host the register names' };
  const path = new URL(url).pathname;
  // A shared host (Amazon S3, Google Cloud Storage, Azure blobs) is never allowed without a reviewed path, for any kind.
  const shared = /(^|\.)(amazonaws\.com|storage\.googleapis\.com|blob\.core\.windows\.net)$/.test(h);
  const entry = allowHosts.find((a) => typeof a.host === 'string' && a.host === h && (a.path_prefix ? path.startsWith(a.path_prefix) : true)); // exact hosts only
  if (!entry) return { embed: false, why: 'the host is not yet on our reviewed list of operator hosts' };
  if (shared && !entry.path_prefix) return { embed: false, why: 'a shared storage host needs a reviewed path' };
  if (entry.path_prefix && (!e.path_prefix || e.path_prefix !== entry.path_prefix)) return { embed: false, why: 'the embed is not under the path we reviewed on that host' };
  if (Array.isArray(entry.kinds) && !entry.kinds.includes(kind)) return { embed: false, why: 'that kind of view was not reviewed for the host' };
  const src = `https://${h}${entry.path_prefix || ''}`; // the CSP source expression: host, and path when one was reviewed
  let poster = '';
  if (kind === 'video' && e.image_url && hostOf(e.image_url) === h && new URL(e.image_url).pathname.startsWith(entry.path_prefix || '/')) poster = e.image_url;
  return { embed: true, kind, host: h, url, poster, src, path_prefix: entry.path_prefix || '' };
}

export function normaliseHistory(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(obj(raw).history) ? raw.history : [];
  return list.slice(-500).map((x) => ({ at: iso(obj(x).at), state: pick(obj(x).state, ['up', 'down', 'unknown'], 'unknown') })).filter((x) => x.at);
}
