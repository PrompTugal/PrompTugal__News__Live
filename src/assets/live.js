// live.promptugal.news: refresh each camera's status from data.promptugal.news's register in the browser.
// live.b@PrompTugal.dinis, 2026-11-18. Text only: textContent and className.
// (no HTML is ever parsed from the data.) The page as built is the fallback; if the register cannot be read nothing changes.
(function () {
  'use strict';
  var REGISTER = 'https://data.promptugal.news/api/v1/cameras/index.json';
  var STATES = { up: 'up', down: 'down', unknown: 'not known' };
  // One checked builder for every view: an iframe (the operator's player), a video or an image, only over https,
  // only from the named host and, when one was reviewed, under the named path. The page's CSP allows only those.
  function okUrl(src, host, prefix) {
    var u;
    try { u = new URL(src); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.hostname !== host || u.username || u.password || u.port) return null;
    if (prefix && u.pathname.indexOf(prefix) !== 0) return null;
    return u;
  }
  function makeView(v) {
    var u = okUrl(v.url || '', v.host || '', v.prefix || '');
    if (!u) return null;
    var el;
    if (v.kind === 'video') {
      el = document.createElement('video');
      el.setAttribute('controls', ''); el.setAttribute('muted', ''); el.muted = true;
      el.setAttribute('autoplay', ''); el.setAttribute('loop', ''); el.setAttribute('playsinline', ''); el.setAttribute('preload', 'auto');
      var p = v.poster ? okUrl(v.poster, v.host, v.prefix || '') : null;
      if (p) el.setAttribute('poster', p.href);
      el.setAttribute('src', u.href);
    } else if (v.kind === 'image') {
      el = document.createElement('img');
      el.setAttribute('src', u.href); el.setAttribute('alt', v.title || 'Live image'); el.setAttribute('referrerpolicy', 'no-referrer');
    } else if (v.kind === 'iframe') {
      el = document.createElement('iframe');
      el.setAttribute('src', u.href);
      el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
      el.setAttribute('referrerpolicy', 'no-referrer');
      el.setAttribute('allow', 'fullscreen'); el.setAttribute('allowfullscreen', '');
    } else return null;
    el.setAttribute('title', v.title || 'Live view');
    return el;
  }
  // Buttons on a camera page or an embed page: the press is the reader's choice to load the view.
  Array.prototype.forEach.call(document.querySelectorAll('.embed[data-embed-src]'), function (box) {
    var btn = box.querySelector('.embed-load');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var el = makeView({ url: box.getAttribute('data-embed-src'), host: box.getAttribute('data-embed-host'), kind: box.getAttribute('data-embed-kind') || 'iframe', prefix: box.getAttribute('data-embed-prefix'), poster: box.getAttribute('data-embed-poster'), title: box.getAttribute('data-embed-title') });
      if (!el) return;
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(el);
    });
  });
  // The maps: pressing a camera square loads its view in the panel above the maps, from /api/v1/views.json.
  var viewer = document.getElementById('viewer'), views = null;
  function show(id, link) {
    var v = views && Object.prototype.hasOwnProperty.call(views, id) ? views[id] : null;
    if (!v || !viewer) { window.location.href = link.getAttribute('href'); return; }
    var el = makeView({ url: v.url, host: v.host, kind: v.kind, prefix: v.path_prefix, poster: v.poster, title: (v.name || '') + ', ' + (v.operator || '') });
    if (!el) { window.location.href = link.getAttribute('href'); return; }
    while (viewer.firstChild) viewer.removeChild(viewer.firstChild);
    var h = document.createElement('h2'); h.textContent = v.name || 'Live view';
    var box = document.createElement('div'); box.className = 'embed'; box.appendChild(el);
    var p = document.createElement('p'); p.className = 'credit';
    p.appendChild(document.createTextNode('Live view: ' + (v.operator || 'the operator') + (v.credit ? '. ' + v.credit : '') + '. Never recorded. '));
    [[v.operator_page, "The operator's page"], [v.license && v.license.url, v.license && v.license.name]].forEach(function (pair) {
      try { var lu = new URL(pair[0]); if (lu.protocol === 'https:') { var la = document.createElement('a'); la.setAttribute('href', lu.href); la.setAttribute('rel', 'noopener noreferrer nofollow'); la.textContent = pair[1] || 'Link'; p.appendChild(la); p.appendChild(document.createTextNode(' · ')); } } catch (e) {}
    });
    var info = document.createElement('a'); info.setAttribute('href', link.getAttribute('href')); info.textContent = 'About this camera'; p.appendChild(info);
    viewer.appendChild(h); viewer.appendChild(box); viewer.appendChild(p);
    viewer.hidden = false;
    viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  Array.prototype.forEach.call(document.querySelectorAll('a.m-cam-link[data-view]'), function (link) {
    link.addEventListener('click', function (ev) {
      var id = link.getAttribute('data-view');
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id || '') || !window.fetch) return;
      ev.preventDefault();
      if (views) { show(id, link); return; }
      fetch('/api/v1/views.json', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { views = d && d.views && typeof d.views === 'object' ? d.views : {}; show(id, link); })
        .catch(function () { window.location.href = link.getAttribute('href'); });
    });
  });
  // Data in the browser (Dinis, 19 Nov 2026): the built figures stay unless the latest file from our own data host
  // passes its checks (its shape, a newer read time, values within bounds). Every figure says when it was read, and
  // anything older than its cadence is marked stale. Text only, by textContent. No cookie, no referrer.
  var DATA = 'https://data.promptugal.news';
  var ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/;
  function utc(s) { return s.slice(0, 10) + ' ' + s.slice(11, 16) + ' UTC'; }
  // data.promptugal.news collects twice a day (Dinis, about 16:30 UTC 19 Nov 2026, relayed by conductor.b@): a reading is
  // stale after STALE_H hours, a little more than the gap between two collections
  var STALE_H = 13;
  function old(s, hours) { var t = Date.parse(s); return !isFinite(t) || Date.now() - t > hours * 3600000; }
  function getJson(url) { return fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }); }
  var BOUNDS = { temp_c: [-30, 55], wind_kmh: [0, 300], humidity_pct: [0, 100], rain_mm: [0, 500], t_min_c: [-30, 55], t_max_c: [-30, 55], rain_prob_pct: [0, 100] };
  // A file's licence beside its figures: the name as text, the link only if it is https with no user info.
  function lic(l) {
    if (!l || typeof l !== 'object' || typeof l.name !== 'string' || typeof l.url !== 'string') return null;
    var u; try { u = new URL(l.url); } catch (e) { return null; }
    // the same rule as the build: https, no user info or port, and a known licence host only
    if (u.protocol !== 'https:' || u.username || u.password || u.port || l.url.length > 2000 || ['creativecommons.org', 'opendatacommons.org', 'www.ipma.pt', 'api.ipma.pt', 'www.nationalarchives.gov.uk', 'tfl.gov.uk', 'promptugal.news', 'data.promptugal.news'].indexOf(u.hostname) < 0) return null;
    var name = l.name.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 60);
    return name ? { name: name, url: u.href } : null;
  }
  function link(l) { var a = document.createElement('a'); a.href = l.url; a.rel = 'noopener noreferrer nofollow'; a.target = '_blank'; a.textContent = l.name; return a; }
  function inb(k, v) { return typeof v === 'number' && isFinite(v) && v >= BOUNDS[k][0] && v <= BOUNDS[k][1]; }
  function weather() {
    Array.prototype.forEach.call(document.querySelectorAll('.wx[data-wx]'), function (box) {
      var id = box.getAttribute('data-wx') || '';
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return;
      getJson(DATA + '/api/v1/by-place/now/' + id + '.json').then(function (d) {
        if (!d || typeof d !== 'object' || !d.station || typeof d.station !== 'object') return;
        var r = d.station.reading, fc = d.forecast && Array.isArray(d.forecast.days) ? d.forecast.days[0] : null;
        if (!r || typeof r !== 'object' || typeof r.at !== 'string' || !ISO.test(r.at)) return;
        var built = box.getAttribute('data-read') || '';
        if (built && ISO.test(built) && Date.parse(r.at) < Date.parse(built)) return; // never older than the built copy
        var vals = { temp_c: r.temp_c, wind_kmh: r.wind_kmh, humidity_pct: r.humidity_pct, rain_mm: r.rain_mm, t_min_c: fc && fc.t_min_c, t_max_c: fc && fc.t_max_c, rain_prob_pct: fc && fc.rain_prob_pct };
        Object.keys(vals).forEach(function (k) { var el = box.querySelector('[data-k="' + k + '"]'); if (el) el.textContent = inb(k, vals[k]) ? String(vals[k]) : 'not given'; });
        var st = box.querySelector('[data-k="station"]'); if (st && typeof d.station.name === 'string') st.textContent = d.station.name.slice(0, 80);
        var when = box.querySelector('.wx-when'); if (when) when.textContent = 'reading of ' + utc(r.at);
        var state = box.querySelector('.wx-state');
        if (state) state.textContent = old(r.at, STALE_H) ? 'stale: the latest file holds no reading from the last 13 hours' : 'the latest file, read when this page opened';
        box.setAttribute('data-read', r.at);
        try { // last, and on its own: a licence line must never stop the figures
          var ll = box.querySelector('.wx-lic'), own = lic(d.license), ip = d.license && d.license.sources ? lic(d.license.sources.ipma) : null;
          if (ll) { while (ll.firstChild) ll.removeChild(ll.firstChild);
            if (own) { ll.append('This file: ', link(own), " (PrompTugal.news's record); IPMA's values under "); } else { ll.append('The file read gives no licence we can link; IPMA\'s values under '); }
            ll.append(ip ? link({ name: "IPMA's terms", url: ip.url }) : link({ name: "IPMA's terms", url: 'https://api.ipma.pt/' })); }
        } catch (e) {}
      }).catch(function () {});
    });
  }
  weather(); setInterval(weather, 300000);
  // Camera status: the register, on open and every five minutes.
  var nodes = document.querySelectorAll('[data-cam]');
  if (!nodes.length || !window.fetch) return;
  var regState = document.getElementById('reg-state');
  function register() {
  getJson(REGISTER)
    .then(function (d) {
      if (!d || !Array.isArray(d.cameras) || typeof d.read_at !== 'string' || !ISO.test(d.read_at)) return;
      var built = regState ? regState.getAttribute('data-read') || '' : '';
      if (built && ISO.test(built) && Date.parse(d.read_at) < Date.parse(built)) return;
      if (regState) { regState.textContent = (old(d.read_at, STALE_H) ? 'stale: the register was last written at ' : "from data.promptugal.news's register, written at ") + utc(d.read_at); regState.setAttribute('data-read', d.read_at); }
      var by = Object.create(null);
      d.cameras.slice(0, 3000).forEach(function (c) {
        if (c && typeof c.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(c.id)) by[c.id] = c;
      });
      nodes.forEach(function (n) {
        var c = by[n.getAttribute('data-cam')];
        if (!c || !c.status) return;
        var st = Object.prototype.hasOwnProperty.call(STATES, c.status.state) ? c.status.state : 'unknown';
        var badge = n.querySelector('.st');
        if (badge) { badge.textContent = STATES[st]; badge.className = 'st st-' + st; }
        var when = n.querySelector('.muted');
        if (when && typeof c.status.checked_at === 'string' && ISO.test(c.status.checked_at)) when.textContent = utc(c.status.checked_at) + (old(c.status.checked_at, STALE_H) ? ' (stale)' : ' (latest)');
      });
      try { // last, and on its own
        var rl = document.getElementById('reg-lic'), rlic = lic(d.license);
        if (rl) { while (rl.firstChild) rl.removeChild(rl.firstChild);
          if (rlic) rl.append('The register: ', link(rlic), ", PrompTugal.news's record; each camera under its operator's terms");
          else rl.append("The register read gives no licence we can link; each camera under its operator's terms"); }
      } catch (e) {}
    })
    .catch(function () {});
  }
  register(); setInterval(register, 300000);
})();
