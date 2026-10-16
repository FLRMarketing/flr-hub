/* ============================================================================
   FLR Hub: the Proximity Finder (Hub tile 'proximity'). Enter a site postcode and see:
     - Right now: the vans nearest the site, from FleetView's live positions (Admins and Super Admins only);
     - Booked today: the fitter booked nearest the site today, from the Monday Work Programme;
     - Then, day by day: who is booked nearest on each of the next 14 days.
   It is the Team Proximity Finder Claude page moved onto the Hub, where the live van positions already are.

   The data: public.proximity_board() (Estimator repo, 20261016400000_flr_proximity.sql) answers
     { readAt, firstDay, lastDay, bookings: [{fitter, code, job, url, address, postcode, lat, lon, status, start, end}],
       triedAt, failingSince, pageError,
       vansAllowed, fleetview: {okAt, failing} | null,
       vans: [{reg, driver, lat, lon, ignition, speed, seenAt, movingAt, stopAt, stopSeen}] | null }
   The flr-proximity Edge Function reads the Work Programme (read-only) every 15 minutes; flr-arrivals keeps the van
   positions (FleetView, every 2 minutes from 06:00 to 21:00 UK time). An open page asks again every 2 minutes.

   Which van is whose: the Fitter label's van ("Jim Foxall - P8" → P8 FLR, "Simon Swinbourne - P3 (GJ26 VDA)" → GJ26 VDA),
   as the Fitter Schedule arrivals match them, else the driver FleetView has on the van.

   Where the site is: the job's own position when the postcode is already on the Work Programme; else the full
   postcode's centre from postcodes.io; else (district only, or postcodes.io not answering) the district's centre from
   outcodes.js. Nothing typed here is saved or sent anywhere except the postcode to postcodes.io.

   Who can open it: proximity_board() makes the app check (private.require_app('proximity')): signed in, with a profile,
   not switched off, and on the 'proximity' list (Super Admins to start, switched on for others in Hub settings).
   This page's CSP allows no inline styles and nothing is parsed as HTML: everything is built as elements.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';
  const SIGN_IN = '../?next=proximity';
  const POSTCODES = 'https://api.postcodes.io';
  const DAYS_AHEAD = 14;
  const $ = s => document.querySelector(s);

  /* ---------------------------------------------------------------- building the page (text only) */
  const SVG = 'http://www.w3.org/2000/svg';
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, String(v));
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== '') n.append(k instanceof Node ? k : String(k));
    return n;
  }
  function icon(id, cls) {
    const s = document.createElementNS(SVG, 'svg');
    if (cls) s.setAttribute('class', cls);
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(SVG, 'use'); u.setAttribute('href', '#' + id); s.append(u);
    return s;
  }

  /* ---------------------------------------------------------------- dates, distance */
  const iso = d => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const addDays = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const fmtWeekday = s => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const fmtDate = s => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fmtRange = b => b.start === b.end ? fmtDate(b.start) : `${fmtDate(b.start)} – ${fmtDate(b.end)}`;
  const fmtTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const fmtDayTime = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const when = at => (iso(at) === iso(new Date()) ? fmtTime : fmtDayTime).format(at);
  function miles(a, b) {
    const rad = x => x * Math.PI / 180;
    const q = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return 2 * 3958.8 * Math.asin(Math.sqrt(q));
  }
  const driveMins = m => Math.max(5, Math.round(((m * 1.25) / 40) * 60 / 5) * 5);
  const fmtMiles = m => m < 10 ? m.toFixed(1) : String(Math.round(m));
  const fmtDrive = m => { const t = driveMins(m); return t < 60 ? `${t} min` : `${Math.floor(t / 60)} h${t % 60 ? ` ${t % 60} min` : ''}`; };

  /* ---------------------------------------------------------------- postcodes */
  const O = window.FLR_OUTCODES || { n: [], r: '' };
  const DISTRICTS = new Map(O.r.split(';').filter(Boolean).map(row => { const [oc, lat, lon, n] = row.split(','); return [oc, { lat: +lat, lon: +lon, area: O.n[+n] }]; }));
  function parsePostcode(text) {
    const s = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const full = s.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
    if (full) return { outcode: full[1], full: `${full[1]} ${full[2]}` };
    if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(s)) return { outcode: s, full: null };
    return null;
  }
  async function postcodeCentre(full) {
    try {
      const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(`${POSTCODES}/postcodes/${encodeURIComponent(full)}`, { signal: ctl.signal });
      clearTimeout(tm);
      if (!res.ok) return null;
      const r = (await res.json()).result;
      return r && Number.isFinite(r.latitude) ? { lat: r.latitude, lon: r.longitude, area: r.admin_district || null } : null;
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- vans */
  const regKey = s => String(s || '').replace(/\s+/g, '').toUpperCase();
  const regsOf = code => { const c = String(code || '').trim(); if (!c) return []; const b = /\(([^)]+)\)/.exec(c); return b ? [regKey(b[1])] : [regKey(c), regKey(c + 'FLR')]; };
  // The van a booking's fitter drives: the label's van first, else the van FleetView has them driving.
  function vanForBooking(b) {
    if (!VANS.length) return null;
    const regs = regsOf(b.code);
    return VANS.find(v => regs.includes(regKey(v.reg))) || VANS.find(v => v.driver && v.driver.toLowerCase() === b.fitter.toLowerCase()) || null;
  }
  // Who is in a van: today's booking whose label names the van, else FleetView's driver.
  function whoInVan(v) {
    const key = regKey(v.reg);
    const b = BOOKINGS.find(x => x.start <= TODAY && x.end >= TODAY && regsOf(x.code).includes(key))
      || BOOKINGS.find(x => regsOf(x.code).includes(key));
    return b ? b.fitter : (v.driver || null);
  }
  function vanBadge(reg, small) { return h('span', { class: `van${small ? ' small' : ''}`, title: `Van ${reg}` }, icon('i-van'), reg); }
  function codeBadge(b, small) {
    const v = vanForBooking(b);
    if (v) return vanBadge(v.reg, small);
    return b.code ? h('span', { class: `van code${small ? ' small' : ''}`, title: 'Van code on the Fitter label (not seen in FleetView)' }, b.code) : null;
  }
  // "Driving · seen 10:44", "Parked since 07:27", "Last seen Thu 15 Oct, 19:58"
  function vanState(v) {
    const seen = new Date(v.seenAt), ageMin = (Date.now() - seen) / 60000;
    if (ageMin > 30) return h('span', { class: 'state old' }, `Last seen ${when(seen)}`);
    if (v.ignition && (v.speed || 0) > 3) return h('span', { class: 'state moving' }, `Driving · seen ${fmtTime.format(seen)}`);
    if (v.ignition) return h('span', { class: 'state on' }, `Engine on · seen ${fmtTime.format(seen)}`);
    if (v.stopAt && v.stopSeen) return h('span', { class: 'state' }, `Parked since ${when(new Date(v.stopAt))}`);
    return h('span', { class: 'state' }, `Parked · seen ${fmtTime.format(seen)}`);
  }

  /* ---------------------------------------------------------------- state */
  let DATA = null, BOOKINGS = [], VANS = [], TODAY = iso(new Date()), lastSearch = null;

  // proximity_board()'s answer, checked; anything else counts as not loaded.
  const str = v => typeof v === 'string' ? v : '';
  const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const okDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  function boardFrom(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.bookings)) return null;
    const bookings = d.bookings.filter(b => b && str(b.fitter) && str(b.job) && okDate(b.start) && okDate(b.end)).map(b => ({
      fitter: b.fitter, code: str(b.code), job: b.job, url: /^https:\/\/[a-z0-9-]+\.monday\.com\//.test(str(b.url)) ? b.url : null,
      address: str(b.address) || null, postcode: str(b.postcode) || null, status: str(b.status),
      start: b.start, end: b.end, pos: num(b.lat) != null && num(b.lon) != null ? { lat: b.lat, lon: b.lon } : null }));
    for (const b of bookings) if (!b.pos && b.postcode) { const dd = DISTRICTS.get(b.postcode.split(' ')[0]); if (dd) { b.pos = { lat: dd.lat, lon: dd.lon }; b.rough = true; } }
    const vans = Array.isArray(d.vans) ? d.vans.filter(v => v && str(v.reg) && num(v.lat) != null && num(v.lon) != null && !isNaN(new Date(v.seenAt))).map(v => ({
      reg: v.reg, driver: str(v.driver) || null, pos: { lat: v.lat, lon: v.lon }, ignition: v.ignition === true, speed: num(v.speed),
      seenAt: v.seenAt, stopAt: v.stopAt || null, stopSeen: v.stopSeen === true })) : [];
    return { readAt: d.readAt || null, failingSince: d.failingSince || null, bookings, vansAllowed: d.vansAllowed === true,
      fleetview: d.fleetview && typeof d.fleetview === 'object' ? d.fleetview : null, vans };
  }

  function showSource() {
    const src = $('#source');
    if (DATA.readAt) {
      const at = new Date(DATA.readAt);
      src.textContent = `Monday · updated ${when(at)}`;
      src.title = `Bookings from the Monday Work Programme, read every 15 minutes. Last read ${fmtDayTime.format(at)}`;
    } else { src.textContent = 'Monday · not read yet'; }
    src.classList.toggle('stale', !!DATA.failingSince || !DATA.readAt);
    const fv = $('#fleetSource');
    fv.hidden = !DATA.vansAllowed;
    if (DATA.vansAllowed) {
      const ok = DATA.fleetview && DATA.fleetview.okAt ? new Date(DATA.fleetview.okAt) : null;
      fv.textContent = ok ? `FleetView · live ${when(ok)}` : 'FleetView · no positions yet';
      fv.title = 'Van positions from FleetView, checked every 2 minutes from 06:00 to 21:00';
      fv.classList.toggle('stale', !ok || DATA.fleetview.failing || (Date.now() - ok) > 15 * 60000);
    }
    const notes = [];
    if (DATA.failingSince) notes.push(`Couldn’t read Monday since ${when(new Date(DATA.failingSince))}.${DATA.readAt ? ` Showing the bookings from ${when(new Date(DATA.readAt))}.` : ''}`);
    if (DATA.vansAllowed && DATA.fleetview && DATA.fleetview.failing) notes.push('FleetView isn’t answering at the moment: van positions may be out of date.');
    $('#notice').textContent = notes.join(' ');
    $('#notice').hidden = !notes.length;
  }

  /* ---------------------------------------------------------------- the search */
  function nearestOn(day, site) {
    const best = new Map();
    for (const b of BOOKINGS) {
      if (!b.pos || b.start > day || b.end < day) continue;
      const m = miles(site, b.pos), k = b.fitter.toLowerCase();
      if (!best.has(k) || m < best.get(k).miles) best.set(k, { ...b, miles: m });
    }
    return [...best.values()].sort((a, z) => a.miles - z.miles);
  }
  const tbc = b => b.status === 'TBC' ? h('span', { class: 'tbc' }, 'TBC') : null;
  const jobLink = b => b.url ? h('a', { href: b.url, target: '_blank', rel: 'noopener' }, b.job) : b.job;
  const hint = (text, bad) => { $('#hint').textContent = text || ''; $('#hint').classList.toggle('bad', !!bad); };

  async function search(text, quiet) {
    const pc = parsePostcode(text);
    if (!pc) { hint('Enter a UK postcode, for example CV22 5DJ.', true); $('#results').hidden = true; return; }
    const district = DISTRICTS.get(pc.outcode);
    if (!district) { hint(`${pc.full || pc.outcode} isn’t a postcode district we recognise. Check the postcode and try again.`, true); $('#results').hidden = true; return; }
    const known = pc.full && BOOKINGS.find(b => b.postcode === pc.full && b.pos && !b.rough);
    let site = known ? { ...known.pos, how: 'job' } : null;
    if (!site && pc.full) {
      if (!quiet) hint('Finding the postcode…');
      const c = await postcodeCentre(pc.full);
      if (c) site = { lat: c.lat, lon: c.lon, how: 'postcode', area: c.area };
    }
    if (!site) site = { lat: district.lat, lon: district.lon, how: 'district' };
    lastSearch = text;
    hint(site.how === 'district' && pc.full ? 'postcodes.io didn’t answer, so this uses the centre of the postcode district.' : '');
    render(pc, district, site, known);
  }

  function render(pc, district, site, known) {
    const label = pc.full || pc.outcode;
    $('#site').replaceChildren(
      h('span', { class: 'eyebrow' }, known ? 'Site · on the Work Programme' : site.how === 'district' ? 'Site · postcode district' : 'Site'),
      h('span', { class: 'site-name' }, known ? (known.address || known.job) : (site.area || district.area)),
      h('span', { class: 'site-meta' }, h('span', { class: 'pc' }, label), ` · ${district.area}`));

    // Right now: FleetView
    const now = $('#now');
    if (!DATA.vansAllowed) now.replaceChildren();
    else if (!VANS.length) now.replaceChildren(h('span', { class: 'eyebrow' }, 'Right now · FleetView'), h('span', { class: 'none' }, 'No van positions from FleetView yet.'));
    else {
      const list = VANS.map(v => ({ ...v, miles: miles(site, v.pos), who: whoInVan(v) })).sort((a, z) => a.miles - z.miles);
      const top = list[0];
      now.replaceChildren(
        h('span', { class: 'eyebrow' }, 'Nearest van right now · FleetView'),
        h('span', { class: 'who' }, top.who || 'Unassigned van', vanBadge(top.reg)),
        h('span', { class: 'far' }, h('span', { class: 'miles' }, `${fmtMiles(top.miles)} miles`), ` away · about ${fmtDrive(top.miles)} drive`),
        vanState(top),
        list.length > 1 ? h('div', { class: 'also' }, h('span', { class: 'eyebrow' }, 'Next nearest vans'),
          list.slice(1, 6).map(v => h('div', { class: 'mate' },
            h('span', { class: 'nm' }, vanBadge(v.reg, true), h('b', null, v.who || 'Unassigned'), vanState(v)),
            h('span', { class: 'miles' }, `${fmtMiles(v.miles)} mi`)))) : null);
    }

    // Booked today: the Work Programme
    const todays = nearestOn(TODAY, site), top = todays[0];
    $('#today').replaceChildren(
      h('span', { class: 'eyebrow' }, `Booked nearest today · ${fmtWeekday(TODAY)} ${fmtDate(TODAY)}`),
      ...(top ? [
        h('span', { class: 'who' }, top.fitter, codeBadge(top), tbc(top)),
        h('span', { class: 'far' }, h('span', { class: 'miles' }, `${fmtMiles(top.miles)} miles`), ` away · about ${fmtDrive(top.miles)} drive`),
        h('span', { class: 'detail' }, 'Working at ', jobLink(top), top.postcode ? [' (', h('span', { class: 'pc' }, top.postcode), ')'] : null),
        todays.length > 1 ? h('div', { class: 'also' }, h('span', { class: 'eyebrow' }, 'Also out today'),
          todays.slice(1, 5).map(b => h('div', { class: 'mate' },
            h('span', { class: 'nm' }, codeBadge(b, true), h('b', null, b.fitter), tbc(b)),
            h('span', { class: 'miles' }, `${fmtMiles(b.miles)} mi`)))) : null,
      ] : [h('span', { class: 'none' }, 'Nobody is booked on the Work Programme today.')]));

    // Then, day by day
    const rows = [];
    for (let i = 1; i <= DAYS_AHEAD; i++) {
      const day = addDays(TODAY, i), list = nearestOn(day, site);
      if (!list.length) continue;
      const [n, ...rest] = list;
      rows.push(h('li', { class: 'row' },
        h('div', { class: 'dayname' }, i === 1 ? 'Tomorrow' : fmtWeekday(day), h('span', null, fmtDate(day))),
        h('div', { class: 'fit' },
          h('span', { class: 'name' }, n.fitter, codeBadge(n, true), tbc(n)),
          h('span', { class: 'job' }, jobLink(n), n.postcode ? [' · ', h('span', { class: 'pc' }, n.postcode)] : null, ` · ${fmtRange(n)}`),
          rest.length ? h('span', { class: 'then' }, 'then ' + rest.slice(0, 2).map(b => `${b.fitter} ${fmtMiles(b.miles)} mi`).join(', ')) : null),
        h('div', { class: 'dist' }, h('span', { class: 'miles' }, `${fmtMiles(n.miles)} mi`), h('span', null, `~${fmtDrive(n.miles)}`))));
    }
    $('#days').replaceChildren(...(rows.length ? rows : [h('li', { class: 'empty' }, `No bookings on the Work Programme in the next ${DAYS_AHEAD} days.`)]));
    $('#results').hidden = false;
  }

  $('#search').addEventListener('submit', e => { e.preventDefault(); search($('#postcode').value); });

  /* ================================================================ the Hub: signed in, and the app is theirs */
  function gate(title, text, o = {}) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
    $('#gate-retry').hidden = !o.retry;
  }
  function show(board) {
    DATA = board; BOOKINGS = board.bookings; VANS = board.vans; TODAY = iso(new Date());
    if (!refresher) refresher = setInterval(() => { if (document.visibilityState === 'visible' && document.body.dataset.view === 'ready') check(true); }, REFRESH_MS);
    showSource();
    document.body.dataset.view = 'ready';
    $('#view').hidden = false;
    if (lastSearch) search(lastSearch, true);
  }

  const REFRESH_MS = 2 * 60 * 1000;   // FleetView positions change every 2 minutes
  let refresher = null, sb = null;
  const client = () => {
    if (sb) return sb;
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY } });
    return sb;
  };
  const flrCode = e => { const m = /FLR_[A-Z_]+/.exec(e ? `${e.message || ''} ${e.details || ''}` : ''); return m ? m[0] : ''; };
  const missingFunction = e => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message || ''));
  const offline = e => !!e && /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(e.message || '');
  const expired = e => !!e && (e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT expired|invalid JWT/i.test(e.message || ''));
  function failGate(e) {
    const code = flrCode(e);
    if (expired(e) || code === 'FLR_SIGN_IN_REQUIRED') return location.replace(SIGN_IN);
    if (code === 'FLR_FORBIDDEN') return gate('You don’t have access to the Proximity Finder', 'It’s switched on for the FLR staff who need it. If you think you should have it, ask an FLR Super Admin.');
    if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
    if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
    if (missingFunction(e)) return gate('The Proximity Finder isn’t ready yet', 'The FLR database doesn’t have it yet.');
    if (offline(e)) return gate('Can’t reach the FLR database', 'Check your connection and try again.', { retry: true });
    return gate('The Proximity Finder didn’t load', 'Something went wrong. Try again in a moment.', { retry: true });
  }
  async function check(quiet = false) {
    try {
      const { data, error } = await client().rpc('proximity_board');
      if (error) { if (!quiet || expired(error) || ['FLR_SIGN_IN_REQUIRED', 'FLR_FORBIDDEN'].includes(flrCode(error))) failGate(error); return; }
      const board = boardFrom(data);
      if (!board) { if (!quiet) failGate(new Error('The answer had no bookings in it')); return; }
      show(board);
    } catch (e) { if (!quiet) failGate(e); }
  }
  $('#gate-retry').addEventListener('click', () => { document.body.dataset.view = 'loading'; $('#gate-message').hidden = true; check(); });

  async function boot() {
    const c = client();
    if (!c) return gate('The Proximity Finder isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* signed out */ }
    if (!session) return location.replace(SIGN_IN);
    await check();
  }
  boot();
})();
