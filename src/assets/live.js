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
  var nodes = document.querySelectorAll('[data-cam]');
  if (!nodes.length || !window.fetch) return;
  fetch(REGISTER, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !Array.isArray(d.cameras)) return;
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
        if (when && typeof c.status.checked_at === 'string') when.textContent = c.status.checked_at.slice(0, 16).replace('T', ' ') + ' UTC (live)';
      });
    })
    .catch(function () {});
})();
