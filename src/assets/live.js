// live.promptugal.news: refresh each camera's status from data.promptugal.news's register in the browser.
// live.b@PrompTugal.dinis, 2026-11-18. Text only: textContent and className.
// (no HTML is ever parsed from the data.) The page as built is the fallback; if the register cannot be read nothing changes.
(function () {
  'use strict';
  var REGISTER = 'https://data.promptugal.news/api/v1/cameras/index.json';
  var STATES = { up: 'up', down: 'down', unknown: 'not known' };
  // Click-to-load: add the operator's player only when the reader asks. The page's CSP allows frames from
  // that one host only; the host and the https scheme are checked again here.
  Array.prototype.forEach.call(document.querySelectorAll('.embed[data-embed-src]'), function (box) {
    var btn = box.querySelector('.embed-load');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var src = box.getAttribute('data-embed-src') || '', host = box.getAttribute('data-embed-host') || '';
      var u;
      try { u = new URL(src); } catch (e) { return; }
      if (u.protocol !== 'https:' || u.hostname !== host || u.username || u.password) return;
      var f = document.createElement('iframe');
      f.setAttribute('src', u.href);
      f.setAttribute('title', box.getAttribute('data-embed-title') || 'Live view');
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.setAttribute('allow', 'fullscreen');
      f.setAttribute('allowfullscreen', '');
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(f);
    });
  });
  var nodes = document.querySelectorAll('[data-cam]');
  if (!nodes.length || !window.fetch) return;
  fetch(REGISTER, { redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !Array.isArray(d.cameras)) return;
      var by = Object.create(null);
      d.cameras.slice(0, 500).forEach(function (c) {
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
