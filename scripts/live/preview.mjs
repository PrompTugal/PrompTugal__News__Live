import { readFileSync } from 'node:fs';
// /preview.svg and /preview.json: live.promptugal.news's own numbers for the sites bar (Dinis, 18 Nov 2026, about
// 22:00 UTC, PrompTugal__News__Website board/guidance/2026-11-18-the-sites-bar.md). live.b@PrompTugal.dinis.
// A fixed template: only integers this code counted and a checked timestamp go in. No register text ever does.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/;
const int = (v) => (Number.isInteger(v) && v >= 0 && v <= 100000 ? v : 0);

export function previewNumbers(cameras, readAt) {
  const n = { cameras: cameras.length, up: 0, down: 0, unknown: 0, places: new Set(cameras.map((c) => c.place)).size, embeddable: 0 };
  for (const c of cameras) { n[c.status.state === 'up' ? 'up' : c.status.state === 'down' ? 'down' : 'unknown']++; if (c.decision && c.decision.embed) n.embeddable++; }
  for (const k of Object.keys(n)) n[k] = int(n[k]);
  return { ...n, read_at: ISO.test(readAt) ? readAt : '' };
}

export function previewJson(n) {
  return {
    license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', holder: 'PrompTugal.news' },
    about: "live.promptugal.news today, for the PrompTugal.news sites bar: counts made by this site's build from data.promptugal.news's camera register.",
    site: 'https://live.promptugal.news', version: '__VERSION__', preview: 'https://live.promptugal.news/preview.svg', card: 'https://live.promptugal.news/preview.png',
    numbers: { cameras: n.cameras, up: n.up, down: n.down, not_known: n.unknown, places_with_a_camera: n.places, can_be_embedded: n.embeddable },
    provenance: { source: 'https://data.promptugal.news/api/v1/cameras/index.json', read_at: n.read_at || null, made_by: 'scripts/live/preview.mjs (code, no model), for live.b@PrompTugal.dinis', note: 'Up, down and not known are the states at data.promptugal.news\'s last check of each operator\'s page; "not known" includes cameras that were not checked.' },
  };
}

// The 320 by 180 preview for the sites bar's pop-up (the sites bar), from designer@'s template, vendored from
// PrompTugal__News__Website design/sites-bar/preview-template.svg.txt: counts and fixed words only, system fonts, no
// script, no external reference. Every value is escaped; an unknown placeholder becomes empty.
const x = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function previewSvg(n) {
  const tpl = readFileSync(new URL('../vendor/sites-bar/preview-template.svg.txt', import.meta.url), 'utf8');
  const when = n.read_at ? `${n.read_at.slice(0, 10)} ${n.read_at.slice(11, 16)} UTC` : 'not read';
  const fill = { site: 'Live', line: 'public cameras to watch, never recorded', accent: '#0a7d4f', SITE: 'LIVE', n1: n.embeddable, label1: 'cameras to watch now', n2: n.up, label2: 'up at the last check', n3: n.places, label3: 'places with a camera', read_at: when, licence: 'CC BY 4.0' };
  return tpl.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(fill, k) ? x(fill[k]) : '')) + '\n';
}
