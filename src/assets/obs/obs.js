// Copied for live.promptugal.news by live.b@PrompTugal.dinis on 18 November 2026 from PrompTugal/PrompTugal__News__Civic@dev src/assets/obs/obs.js (same estate, Apache-2.0), itself from PrompTugal__News__Website@f261682.
// Changes here, at Dinis's word of 18 November 2026 ("add observability to all the other sites"): each event says its lane
// (obs.json `lane`, "live"); it is written to that lane's tokens when observability@ has issued them (obs.json
// `lanes.civic`), until then to the shared site lanes read from promptugal.news's obs.json (`config_from`); the footer note finds this site's footer and links the report on
// promptugal.news.
// PrompTugal.news's page views and reads (observability@PrompTugal.dinis, 6 November 2026, at Dinis Cruz's word:
// "replicate what we have on web-summit.sgit.ai"). The team site's sender (its assets/obs-dinis.js, by
// observability@web-summit.dinis, after Jose's assets/telemetry.js and the observability pack), into this site's own
// vault (assets/obs/obs.json). Two events per page load:
//   view  when the page loads;
//   read  the first time the tab is hidden or closed: seconds the page was visible and the deepest scroll (percent).
// Each says: the page, the referring site (host only), the time to the minute, the site version, a random id that
// ends with the tab, the screen size class, the browser's language and time zone, an automation class if a bot
// declares itself, and the country, worked out in the browser from its own time zone through the fixed table below,
// with no network call (Dinis, 19 Nov 2026, about 03:15 UTC: "remove the IP base. So we're going to keep the country
// still."; no region, city or map position, and no third-party lookup). No IP address, no cookie, no user-agent
// string, no browser fingerprint. Sealed here to the drain key (sgit hybrid
// envelope v2: RSA-OAEP-SHA256 + AES-256-GCM) and written to a write-only append lane; on 507 (a lane full) the next.
// Do Not Track, Global Privacy Control and the footer's Pause switch stop it. Never blocks, never shows an error.
// The drain (newsroom/tools/obs/obs_drain.py) publishes counts only; the report is /newsroom/observability/.
(() => {
    'use strict'
    try {
        const nav = navigator
        const dnt = nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.globalPrivacyControl === true
        const LS = { get: k => { try { return localStorage.getItem('pt.obs.' + k) } catch { return null } }, set: (k, v) => { try { v === null ? localStorage.removeItem('pt.obs.' + k) : localStorage.setItem('pt.obs.' + k, v) } catch { } } }
        const SS = { get: k => { try { return sessionStorage.getItem('pt.obs.' + k) } catch { return null } }, set: (k, v) => { try { sessionStorage.setItem('pt.obs.' + k, v) } catch { } }, del: k => { try { sessionStorage.removeItem('pt.obs.' + k) } catch { } } }
        const paused = () => LS.get('off') === '1'
        const script = document.currentScript, base = script ? script.src.replace(/obs\.js(\?.*)?$/, '') : '/assets/obs/'

        // the disclosure and the pause switch, in the footer of every page
        const footer = () => {
            const row = document.querySelector('footer .row p.small') || document.querySelector('footer .row') || document.querySelector('footer .wrap') || document.querySelector('footer.foot p:last-of-type'); if (!row || row.querySelector('.obs-note')) return
            const s = document.createElement('span'); s.className = 'obs-note'
            const a = document.createElement('a'); a.href = 'https://promptugal.news/newsroom/observability/index.html'; a.textContent = 'what is counted'
            if (dnt) { s.append(' · Page views: off (Do Not Track or Global Privacy Control is on). ', a); row.appendChild(s); return }
            const b = document.createElement('button'); b.type = 'button'; b.style.cssText = 'font:inherit;background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;color:inherit'
            const t = document.createTextNode('')
            const draw = () => { t.textContent = paused() ? ' · Page views: paused on this device. ' : ' · Page views, reading time and your country are counted, publicly. The country comes from your browser\'s time zone, worked out here with no lookup; we keep no IP and set no cookie. '; b.textContent = paused() ? 'Resume' : 'Pause' }
            b.onclick = () => { LS.set('off', paused() ? null : '1'); draw() }
            s.append(t, b, ' · ', a); draw(); row.appendChild(s)
        }
        const safeFooter = () => { try { footer() } catch { } }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeFooter); else safeFooter()
        if (dnt || paused()) return

        let sid = SS.get('sid'); if (!sid) { sid = [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join(''); SS.set('sid', sid) }
        const path = location.pathname, done = new Set()

        const b64 = bytes => { let s = ''; for (const x of new Uint8Array(bytes)) s += String.fromCharCode(x); return btoa(s) }
        const unpem = pem => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), c => c.charCodeAt(0))
        async function seal(pem, text) {
            const S = crypto.subtle
            const pub = await S.importKey('spki', unpem(pem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
            const aes = await S.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
            const iv = crypto.getRandomValues(new Uint8Array(12))
            const c = await S.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, new TextEncoder().encode(text))
            const w = await S.encrypt({ name: 'RSA-OAEP' }, pub, await S.exportKey('raw', aes))
            return btoa(btoa(JSON.stringify({ v: 2, w: b64(w), i: b64(iv), c: b64(c) })))   // the lane takes base64 of the .enc text
        }
        // automation by class only, never the user-agent string itself
        const ua = nav.userAgent || ''
        const agent = nav.webdriver ? 'webdriver' : /HeadlessChrome|PhantomJS/.test(ua) ? 'headless'
            : /Googlebot/i.test(ua) ? 'googlebot' : /bingbot/i.test(ua) ? 'bingbot' : /bot|crawl|spider|slurp/i.test(ua) ? 'bot' : ''
        const w = window.innerWidth || 1024
        let ref = ''; try { ref = document.referrer ? new URL(document.referrer).host : '' } catch { }
        // the country, once per tab, from the browser's own time zone through this fixed table (Dinis, 19 Nov 2026, about
        // 03:15 UTC): no network call, no region, city or position. A zone not listed gives an empty country.
        const TZ_COUNTRY = {
            PT: ['Portugal', 'Europe/Lisbon Atlantic/Madeira Atlantic/Azores'],
            GB: ['United Kingdom', 'Europe/London Europe/Belfast'],
            IE: ['Ireland', 'Europe/Dublin'],
            ES: ['Spain', 'Europe/Madrid Atlantic/Canary Africa/Ceuta'],
            FR: ['France', 'Europe/Paris'],
            DE: ['Germany', 'Europe/Berlin Europe/Busingen'],
            NL: ['Netherlands', 'Europe/Amsterdam'],
            BE: ['Belgium', 'Europe/Brussels'],
            LU: ['Luxembourg', 'Europe/Luxembourg'],
            CH: ['Switzerland', 'Europe/Zurich'],
            AT: ['Austria', 'Europe/Vienna'],
            IT: ['Italy', 'Europe/Rome'],
            DK: ['Denmark', 'Europe/Copenhagen'],
            SE: ['Sweden', 'Europe/Stockholm'],
            NO: ['Norway', 'Europe/Oslo'],
            FI: ['Finland', 'Europe/Helsinki'],
            PL: ['Poland', 'Europe/Warsaw'],
            CZ: ['Czechia', 'Europe/Prague'],
            GR: ['Greece', 'Europe/Athens'],
            RO: ['Romania', 'Europe/Bucharest'],
            UA: ['Ukraine', 'Europe/Kyiv Europe/Kiev'],
            BR: ['Brazil', 'America/Sao_Paulo America/Fortaleza America/Recife America/Bahia America/Belem America/Manaus America/Cuiaba America/Campo_Grande America/Porto_Velho America/Boa_Vista America/Rio_Branco America/Maceio America/Araguaina America/Santarem America/Noronha'],
            AO: ['Angola', 'Africa/Luanda'],
            MZ: ['Mozambique', 'Africa/Maputo'],
            CV: ['Cabo Verde', 'Atlantic/Cape_Verde'],
            US: ['United States', 'America/New_York America/Chicago America/Denver America/Phoenix America/Los_Angeles America/Anchorage Pacific/Honolulu America/Detroit America/Boise America/Indiana/Indianapolis'],
            CA: ['Canada', 'America/Toronto America/Vancouver America/Edmonton America/Winnipeg America/Halifax America/St_Johns America/Regina'],
            AU: ['Australia', 'Australia/Sydney Australia/Melbourne Australia/Brisbane Australia/Perth Australia/Adelaide Australia/Hobart Australia/Darwin'],
            IN: ['India', 'Asia/Kolkata Asia/Calcutta'],
            JP: ['Japan', 'Asia/Tokyo'],
            CN: ['China', 'Asia/Shanghai'],
            SG: ['Singapore', 'Asia/Singapore'],
            AE: ['United Arab Emirates', 'Asia/Dubai'],
            ZA: ['South Africa', 'Africa/Johannesburg'],
            MA: ['Morocco', 'Africa/Casablanca'],
            MX: ['Mexico', 'America/Mexico_City'],
            AR: ['Argentina', 'America/Argentina/Buenos_Aires America/Buenos_Aires']
        }
        const place = () => {
            let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { }
            for (const [cc, [name, list]] of Object.entries(TZ_COUNTRY)) if (list.split(' ').includes(tz)) return { country: name, country_code: cc }
            return { country: '', country_code: '' }
        }
        // a link's tag (Dinis, 6 November: "I just sent a link to somebody ... I would like to see if they open it ... and
        // forward it"): ?via=<tag> (or utm_source / utm_campaign) on the link you send. Kept for the tab, so the pages read
        // after arriving count too; a tag names the link, never the person. Letters, digits, '.', '_' and '-', 40 at most.
        const tagOf = () => { try { const q = new URLSearchParams(location.search); const t = q.get('via') || q.get('utm_campaign') || q.get('utm_source') || ''; return /^[A-Za-z0-9._-]{1,40}$/.test(t) ? t.toLowerCase() : '' } catch { return '' } }
        let via = tagOf(); if (via) SS.set('via', via); else via = SS.get('via') || ''
        const common = () => {
            const e = { v: 1, src: 'promptugal', site: location.host, ver: ((document.querySelector('a.ver') || {}).textContent || '').trim(),
                ts: new Date().toISOString().slice(0, 16) + 'Z', sid, path, ref, lang: nav.language || '',
                screen: w < 600 ? 'phone' : w < 1000 ? 'tablet' : 'desktop', tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '') }
            if (agent) e.agent = agent
            if (via) e.via = via
            // an A/B test (Dinis, 6 November 2026, 13:20: "A/B testing when needed ... on the website"): the variant this page
            // was shown, from <html data-variant> or <meta name="variant">, set by whoever runs the test; no new identifier
            const H = document.documentElement.dataset, vr = H.variant || (document.querySelector('meta[name="variant"]') || {}).content || (H.top ? 'top-' + H.top : '')   // dev@'s A/B of the top: <html data-top="c|a">
            if (/^[A-Za-z0-9._-]{1,40}$/.test(vr)) e.variant = vr
            return e
        }

        let visibleMs = 0, since = document.visibilityState === 'visible' ? performance.now() : null, maxScroll = 0
        const scrolled = () => { const h = document.documentElement, top = window.scrollY || h.scrollTop, all = Math.max(1, h.scrollHeight - window.innerHeight); maxScroll = Math.max(maxScroll, Math.min(100, Math.round(100 * top / all))) }
        window.addEventListener('scroll', scrolled, { passive: true })

        let cfgP = null
        // civic: this site's obs.json holds civic's own vault, lanes and drain key (since 18 Nov 2026); promptugal.news's obs.json
        // (config_from) is no longer read when this file names its own vault (no lookup list since 19 Nov 2026). Without a vault_id here, it falls back to that file's vault,
        // the drain's public key and the shared lanes, so no token is copied here and a rotation there reaches this site
        const cfg = () => cfgP || (cfgP = fetch(base + 'obs.json', { cache: 'no-cache' }).then(r => r.json()).then(own => !own.config_from ? own
            : own.vault_id ? own
            : fetch(own.config_from, { cache: 'no-cache', credentials: 'omit' }).then(r => r.json()).then(shared => Object.assign({}, shared,
                { enabled: own.enabled !== false && shared.enabled, lane: own.lane, lanes: Object.assign({}, shared.lanes, own.lanes || {}) }))))
        const send = async ev => {
            if (paused()) return false
            const c = await cfg(); const L = (c.lanes && c.lane && c.lanes[c.lane] && c.lanes[c.lane].length) ? c.lanes[c.lane] : (c.lanes && c.lanes.site) || []
            if (!c.enabled || !L.length) return false
            if (c.lane) ev.lane = c.lane
            if (!('country' in ev)) Object.assign(ev, place())
            const payload = await seal(c.recipient.encrypt, JSON.stringify(ev))
            const start = Math.floor(Math.random() * L.length)   // a random first lane spreads the load
            for (const token of L.map((_, i) => L[(start + i) % L.length])) {
                const r = await fetch(`${c.endpoint}/api/vault/append/write/${c.vault_id}`, { method: 'POST', keepalive: true,
                    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ append_token: token, payload }) })
                if (r.status !== 507) return r.ok
            }
            return false
        }
        const resend = () => {                                            // reads an earlier page in this tab could not finish sending
            try {
                for (const k of Object.keys(sessionStorage).filter(k => k.startsWith('pt.obs.pending.'))) {
                    const ev = JSON.parse(sessionStorage.getItem(k)); sessionStorage.removeItem(k)
                    send(ev).catch(() => { })
                }
            } catch { }
        }
        // a yes or no on a page (assets/talk/talk.js, dev.places@PrompTugal.dinis, 15 Nov 2026): one more event on this
        // lane, with no identity: the same fields as a view, plus the vote; absent under Do Not Track or the pause
        window.PTObs = { vote: (v, path) => send(Object.assign(common(), { type: 'vote', vote: v > 0 ? 1 : -1 }, path ? { voted_on: String(path).slice(0, 200) } : {})).catch(() => false) }
        const view = () => { resend(); if (done.has('view')) return; done.add('view'); send(Object.assign(common(), { type: 'view' })).catch(() => { }) }
        const finish = () => {
            if (since !== null) { visibleMs += performance.now() - since; since = null }
            if (done.has('read')) return
            scrolled(); done.add('read')
            const ev = Object.assign(common(), { type: 'read', visible_s: Math.min(3600, Math.round(visibleMs / 1000)), scroll: maxScroll })
            const key = 'pending.' + ev.path + '.' + Date.now()
            SS.set(key, JSON.stringify(ev))                                   // kept until written: leaving can cut the send short
            send(ev).then(ok => { if (ok) SS.del(key) }).catch(() => { })
        }
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') since = performance.now(); else finish() })
        window.addEventListener('pagehide', finish)
        cfg().catch(() => { })
        if (document.readyState === 'complete') setTimeout(view, 0); else window.addEventListener('load', view)
    } catch { }
})()
