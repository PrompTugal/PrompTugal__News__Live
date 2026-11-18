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

export function previewSvg(n) {
  const when = n.read_at ? `${n.read_at.slice(0, 10)} ${n.read_at.slice(11, 16)} UTC` : 'not read';
  const tile = (x, value, label, cls) => `<g transform="translate(${x} 320)"><text class="v ${cls}" x="0" y="0">${value}</text><text class="l" x="0" y="44">${label}</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-labelledby="t d">
<title id="t">PrompTugal.news Live: ${n.cameras} public cameras, ${n.up} up at the last check</title>
<desc id="d">Counts from data.promptugal.news's camera register, read ${when}, made by live.promptugal.news's build. Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Version __VERSION__.</desc>
<style>text{font-family:Inter,Arial,sans-serif;fill:#121317}.h{font-size:56px;font-weight:700}.s{font-size:30px;fill:#5c5e56}.v{font-size:96px;font-weight:700}.l{font-size:26px;fill:#5c5e56}.up{fill:#006600}.down{fill:#c52830}.unk{fill:#5c5e56}.f{font-size:22px;fill:#5c5e56}</style>
<rect width="1200" height="630" fill="#f6f3ec"/>
<rect width="1200" height="12" fill="#c52830"/>
<text class="h" x="64" y="110">PrompTugal.news Live</text>
<text class="s" x="64" y="160">Public cameras in the places we cover</text>
<text class="s" x="64" y="200">The operator's own view or a link: never recorded</text>
${tile(64, n.cameras, 'cameras listed', '')}
${tile(330, n.up, 'up', 'up')}
${tile(530, n.down, 'down', 'down')}
${tile(730, n.unknown, 'not known', 'unk')}
${tile(1000, n.places, 'places', '')}
<text class="f" x="64" y="440">${n.embeddable} can be embedded today; the rest are links to the operator's page.</text>
<text class="f" x="64" y="530">Source: data.promptugal.news camera register, read ${when}.</text>
<text class="f" x="64" y="562">Counts by live.promptugal.news's build, version __VERSION__.</text>
<text class="f" x="64" y="594">CC BY 4.0 · live.promptugal.news</text>
</svg>
`;
}
