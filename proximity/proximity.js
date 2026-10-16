/* ============================================================================
   FLR Hub: Nearby (Hub tile 'proximity'). Enter a site postcode and see:
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
  const fmtMins = t => { t = Math.max(1, Math.round(t)); return t < 60 ? `${t} min` : `${Math.floor(t / 60)} h${t % 60 ? ` ${t % 60} min` : ''}`; };
  // A distance: the best road route (Esri) once it has come back, else the straight line with an estimated drive.
  const milesTxt = d => `${d.road ? '' : '≈'}${fmtMiles(d.miles)} mi`;
  const timeTxt = d => d.road ? fmtMins(d.mins) : `~${fmtMins(driveMins(d.miles))}`;
  const farLine = d => d.road
    ? [h('span', { class: 'miles' }, `${fmtMiles(d.miles)} miles`), ` by road · ${fmtMins(d.mins)} drive${d.traffic ? ' now' : ''}`]
    : [h('span', { class: 'miles' }, `${fmtMiles(d.miles)} miles`), ` in a straight line · about ${fmtMins(driveMins(d.miles))} drive`];

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
  // Fleet Management's look: a yellow UK plate (FLR - Fleet's plate when the van is on the board, else FleetView's reg),
  // the staff photo (Fleet Management's photos) and the top-down vehicle picture.
  const plateOf = v => v.plate || v.reg;
  function plateEl(text, big) { return h('span', { class: `plate${big ? ' big' : ''}` }, h('span', { class: 'sr' }, 'Registration '), text); }
  function codeBadge(b, big) {
    const v = vanForBooking(b);
    if (v) return plateEl(plateOf(v), big);
    return b.code ? h('span', { class: 'plate code', title: 'Vehicle code on the Work Programme label (not seen in FleetView)' }, b.code) : null;
  }
  const slug = n => String(n || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let PHOTOS = {};
  function face(name, cls) {
    const src = PHOTOS[slug(name)];
    if (src && /^data:image\//.test(src)) return h('img', { class: `face ${cls || ''}`, src, alt: '' });
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('class', `face ${cls || ''}`); s.setAttribute('viewBox', '0 0 48 48'); s.setAttribute('aria-hidden', 'true');
    for (const [tag, at] of [['rect', { width: 48, height: 48, fill: 'var(--ph-bg)' }], ['circle', { cx: 24, cy: 19, r: 8, fill: 'none', stroke: 'var(--ph-line)', 'stroke-width': 2 }],
      ['path', { d: 'M9 46c0-9 6.7-15 15-15s15 6 15 15', fill: 'none', stroke: 'var(--ph-line)', 'stroke-width': 2 }]]) {
      const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(at)) e.setAttribute(k, v); s.append(e);
    }
    return s;
  }
  const VEH = window.FLR_VEH_IMG || {};
  // The vehicle picture, as Fleet Management's vehKind(): from the FLR - Fleet make and model.
  function vehKind(v) {
    const t = `${v.make || ''} ${v.model || ''}`.toLowerCase();
    if (/dispatch/.test(t)) return 'dispatch';
    if (/crafter|relay|transit|sprinter|vivaro|trafic/.test(t)) return 'van';
    if (/bmw/.test(t)) return /ix3/.test(t) ? 'bmw-ix3' : /\bi4\b/.test(t) ? 'bmw-i4' : /x5/.test(t) ? 'bmw-x5' : /x1|\b1\d\d\b/.test(t) ? 'bmw-x1' : /5 series|\b5\d\de?\b/.test(t) ? 'bmw-530e' : 'bmw-330e';
    return VEH.van ? 'van' : '';
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
  let DATA = null, BOOKINGS = [], VANS = [], TODAY = iso(new Date()), lastSearch = null, LAST = null;

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
      seenAt: v.seenAt, stopAt: v.stopAt || null, stopSeen: v.stopSeen === true, make: str(v.make), model: str(v.model), plate: str(v.plate) })) : [];
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
      fv.title = 'Vehicle positions from FleetView, checked every 2 minutes from 06:00 to 21:00';
      fv.classList.toggle('stale', !ok || DATA.fleetview.failing || (Date.now() - ok) > 15 * 60000);
    }
    const notes = [];
    if (DATA.failingSince) notes.push(`Couldn’t read Monday since ${when(new Date(DATA.failingSince))}.${DATA.readAt ? ` Showing the bookings from ${when(new Date(DATA.readAt))}.` : ''}`);
    if (DATA.vansAllowed && DATA.fleetview && DATA.fleetview.failing) notes.push('FleetView isn’t answering at the moment: vehicle positions may be out of date.');
    $('#notice').textContent = notes.join(' ');
    $('#notice').hidden = !notes.length;
  }

  /* ---------------------------------------------------------------- the search */
  function nearestOn(day, site) {
    const best = new Map();
    for (const b of BOOKINGS) {
      if (!b.pos || b.start > day || b.end < day) continue;
      const d = distTo(b.pos, site, false), k = b.fitter.toLowerCase();
      if (!best.has(k) || d.mins < best.get(k).d.mins) best.set(k, { ...b, d });
    }
    return [...best.values()].sort((a, z) => a.d.mins - z.d.mins);
  }
  const tbc = b => b.status === 'TBC' ? h('span', { class: 'tbc' }, 'TBC') : null;
  const jobLink = b => b.url ? h('a', { href: b.url, target: '_blank', rel: 'noopener' }, b.job) : b.job;
  const hint = (text, bad) => { $('#hint').textContent = text || ''; $('#hint').classList.toggle('bad', !!bad); };

  async function search(text, quiet) {
    const pc = parsePostcode(text);
    if (!pc) { hint('Enter a UK postcode, for example CV22 5DJ.', true); $('#results').hidden = true; return; }
    const district = DISTRICTS.get(pc.outcode);
    if (!district) { hint(`${pc.full || pc.outcode} isn’t a postcode district we recognise. Check the postcode and try again.`, true); $('#results').hidden = true; return; }
    const line = ($('#line').value || '').trim();
    let site = null, known = null, lineMissed = false;
    // The first line of the address, when given: the exact address (Esri), kept to this postcode.
    if (line && pc.full) {
      if (!quiet) hint('Finding the address…');
      const a = await addressFor(line, pc.full);
      if (a) site = { lat: a.lat, lon: a.lon, how: 'address', address: a.address };
      else lineMissed = true;
    }
    if (!site) {
      known = pc.full && BOOKINGS.find(b => b.postcode === pc.full && b.pos && !b.rough);
      if (known) site = { ...known.pos, how: 'job' };
    }
    if (!site && pc.full) {
      if (!quiet) hint('Finding the postcode…');
      const c = await postcodeCentre(pc.full);
      if (c) site = { lat: c.lat, lon: c.lon, how: 'postcode', area: c.area };
    }
    if (!site) site = { lat: district.lat, lon: district.lon, how: 'district' };
    lastSearch = text;
    hint(lineMissed ? `Couldn’t find “${line}” in ${pc.full}, so this uses the postcode.`
      : site.how === 'district' && pc.full ? 'postcodes.io didn’t answer, so this uses the centre of the postcode district.' : '', lineMissed);
    LAST = { pc, district, site, known };
    render(pc, district, site, known, quiet);
  }

  /* ---------------------------------------------------------------- addresses and road routes (Esri, FLR's map key) */
  const GEO = 'https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer';
  const ROUTE = 'https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World/solve';
  const KEY = String(window.FLR_MAP_KEY || '').trim();
  const pcKey = s => String(s || '').toUpperCase().replace(/\s+/g, '');
  async function esriGet(url, params) {
    const q = new URLSearchParams({ f: 'json', ...params, token: KEY });
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
    try { const r = await fetch(`${url}?${q}`, { signal: ctl.signal }); return await r.json(); } finally { clearTimeout(tm); }
  }
  // Suggestions for the first line of the address, kept to the postcode typed (Esri can't list a postcode's addresses).
  const SUGGEST = new Map();   // suggestion text -> magicKey
  let suggestTimer = 0, suggestSeq = 0;
  function suggestLines() {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      const pc = parsePostcode($('#postcode').value), line = $('#line').value.trim(), seq = ++suggestSeq;
      if (!KEY || !pc || !pc.full || line.length < 2 || SUGGEST.has(line)) return;
      const c = DISTRICTS.get(pc.outcode);
      try {
        const r = await esriGet(`${GEO}/suggest`, { text: `${line}, ${pc.full}`, countryCode: 'GBR', maxSuggestions: 8, ...(c ? { location: `${c.lon},${c.lat}` } : {}) });
        if (seq !== suggestSeq) return;
        const list = (r.suggestions || []).filter(x => pcKey(x.text).includes(pcKey(pc.full)));
        SUGGEST.clear();
        $('#lineList').replaceChildren(...list.map(x => { const t = x.text.replace(/, GBR$/, ''); SUGGEST.set(t, x.magicKey); return h('option', { value: t }); }));
      } catch (e) { /* no suggestions: typing still works */ }
    }, 250);
  }
  // The exact address: a picked suggestion, or the line + postcode; only kept when it is in that postcode.
  async function addressFor(line, full) {
    if (!KEY) return null;
    try {
      const mk = SUGGEST.get(line);
      const r = await esriGet(`${GEO}/findAddressCandidates`, mk ? { singleLine: line, magicKey: mk, maxLocations: 1, outFields: 'Addr_type' }
        : { singleLine: `${line}, ${full}`, countryCode: 'GBR', maxLocations: 1, outFields: 'Addr_type' });
      const c = (r.candidates || [])[0];
      if (!c || c.score < 80 || !pcKey(c.address).includes(pcKey(full))) return null;
      if (!['PointAddress', 'Subaddress', 'StreetAddress', 'POI', 'StreetInt'].includes(c.attributes && c.attributes.Addr_type)) return null;
      return { lat: c.location.y, lon: c.location.x, address: c.address.replace(/, (England|Wales|Scotland|Northern Ireland)(?=, [A-Z0-9 ]+$)/, '') };
    } catch (e) { return null; }
  }
  // Road routes: one Esri route each (from the van or job to the site), kept for the page's life. Vans "right now" use
  // live traffic; booked days use typical times. Up to 4 at a time; as they come back, the page re-ranks by drive time.
  const ROAD = new Map();   // "lat,lon>lat,lon[L]" -> {miles, mins} | 'fail' | null (asked)
  const rk = (a, b) => `${a.lat.toFixed(5)},${a.lon.toFixed(5)}>${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;
  let roadsOff = false;
  function distTo(pos, site, live) {
    const r = ROAD.get(rk(pos, site) + (live ? 'L' : ''));
    if (r && r !== 'fail') return { road: true, miles: r.miles, mins: r.mins, traffic: !!live };
    const m = miles(site, pos);
    return { road: false, miles: m, mins: (m * 1.25 / 40) * 60 };   // exact for ranking; shown rounded (driveMins)
  }
  let roadQueue = [], roadBusy = 0, rerender = 0;
  function roads(list) {
    if (!KEY || roadsOff) return;
    for (const [from, to, live] of list) {
      const k = rk(from, to) + (live ? 'L' : '');
      if (ROAD.has(k)) continue;
      ROAD.set(k, null); roadQueue.push({ k, from, to, live });
    }
    pump();
  }
  function pump() {
    while (roadBusy < 4 && roadQueue.length) {
      const q = roadQueue.shift(); roadBusy++;
      esriGet(ROUTE, { stops: `${q.from.lon},${q.from.lat};${q.to.lon},${q.to.lat}`, returnDirections: false, returnRoutes: true,
        outputLines: 'esriNAOutputLineNone', returnStops: false, ...(q.live ? { startTime: 'now', startTimeIsUTC: true } : {}) })
        .then(r => {
          if (r.error) {
            if ([403, 498, 499].includes(r.error.code)) { roadsOff = true; roadQueue = []; roadNote(); }
            ROAD.set(q.k, 'fail'); return;
          }
          const a = r.routes && r.routes.features && r.routes.features[0] && r.routes.features[0].attributes;
          const mi = a ? (a.Total_Miles ?? (a.Total_Kilometers != null ? a.Total_Kilometers * 0.621371 : null)) : null;
          const mins = a ? (a.Total_TravelTime ?? a.Total_Time) : null;
          ROAD.set(q.k, Number.isFinite(mi) && Number.isFinite(mins) ? { miles: mi, mins } : 'fail');
          clearTimeout(rerender);
          rerender = setTimeout(() => { if (LAST) render(LAST.pc, LAST.district, LAST.site, LAST.known, true); }, 150);
        })
        .catch(() => ROAD.set(q.k, 'fail'))
        .finally(() => { roadBusy--; pump(); });
    }
  }
  const FOOT0 = () => $('#foot').dataset.base || ($('#foot').dataset.base = $('#foot').textContent);
  function roadNote() { $('#foot').textContent = 'Road routes aren’t available at the moment, so distances are straight lines with an estimated drive time. ' + FOOT0(); }

  /* ---------------------------------------------------------------- the map (Fleet Management's satellite and street maps) */
  const ESRI_KEY = String(window.FLR_MAP_KEY || '').trim();
  const tok = ESRI_KEY ? `?token=${encodeURIComponent(ESRI_KEY)}` : '';
  const esri = path => ESRI_KEY ? `https://ibasemaps-api.arcgis.com/arcgis/rest/services/${path}/MapServer/tile/{z}/{y}/{x}${tok}`
    : `https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`;
  const esriStyle = style => `https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/${style}/static/tile/{z}/{y}/{x}${tok}`;
  const ESRI_CREDIT = 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, HERE, Garmin, © OpenStreetMap contributors and the GIS User Community';
  const darkMode = () => matchMedia('(prefers-color-scheme: dark)').matches;
  let MAP = null, base = (() => { try { return localStorage.getItem('flr-map-base') === 'streets' ? 'streets' : 'sat'; } catch (e) { return 'sat'; } })();
  function mapInit() {
    if (MAP || !window.L) return MAP;
    const map = L.map($('#map'), { zoomControl: true, attributionControl: true, minZoom: 5, maxZoom: 19, zoomSnap: 0.5 });
    map.zoomControl.setPosition('bottomright');
    map.attributionControl.setPrefix('Leaflet');
    const tl = (path, o = {}) => L.tileLayer(esri(path), { maxZoom: 19, crossOrigin: true, attribution: ESRI_CREDIT, ...o });
    const ts = style => L.tileLayer(esriStyle(style), { tileSize: 512, zoomOffset: -1, maxZoom: 19, crossOrigin: true });
    const bases = ESRI_KEY
      ? { sat: L.layerGroup([tl('World_Imagery'), ts('arcgis/imagery/labels')]), streets: L.layerGroup([L.tileLayer(esriStyle(darkMode() ? 'arcgis/streets-night' : 'arcgis/streets'), { tileSize: 512, zoomOffset: -1, maxZoom: 19, crossOrigin: true, attribution: ESRI_CREDIT })]) }
      : { sat: L.layerGroup([tl('World_Imagery'), tl('Reference/World_Transportation'), tl('Reference/World_Boundaries_and_Places')]), streets: L.layerGroup([tl('World_Street_Map')]) };
    const Switch = L.Control.extend({ options: { position: 'bottomright' }, onAdd() {
      const d = h('div', { class: 'mbase', role: 'group', 'aria-label': 'Map style' },
        [['sat', 'Satellite'], ['streets', 'Streets']].map(([k, t]) => h('button', { type: 'button', 'data-base': k, 'aria-pressed': String(k === base) }, t)));
      L.DomEvent.disableClickPropagation(d);
      d.addEventListener('click', e => { const b = e.target.closest('button[data-base]'); if (b) setBase(b.dataset.base); });
      return d;
    } });
    function setBase(k) {
      base = k; try { localStorage.setItem('flr-map-base', k); } catch (e) { /* not kept */ }
      for (const [n, g] of Object.entries(bases)) { if (n === k) g.addTo(map); else g.remove(); }
      map.getContainer().querySelectorAll('.mbase button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.base === k)));
    }
    new Switch().addTo(map);
    setBase(base);
    MAP = { map, layer: L.layerGroup().addTo(map), marks: new Map() };
    return MAP;
  }
  function vanIcon(v, sel) {
    const kind = vehKind(v), im = VEH[kind];
    const ageMin = (Date.now() - new Date(v.seenAt)) / 60000, moving = v.ignition && (v.speed || 0) > 3;
    const cls = ['vmark', moving ? 'moving' : 'parked', ageMin > 30 ? 'old' : '', sel ? 'sel' : ''].filter(Boolean).join(' ');
    const html = h('div', null, h('span', { class: 'halo' }), im ? h('img', { class: `vimg vk-${kind}`, src: im[1], alt: '' }) : icon('i-van', 'vimg'));
    return L.divIcon({ className: cls, html, iconSize: [0, 0] });
  }
  function drawMap(site, list, todays, keepView) {
    const M = mapInit();
    if (!M) return;
    M.layer.clearLayers(); M.marks.clear();
    // The site as a radar: rings, a sweeping beam and a pulse, centred on the site (transform and opacity only, so the
    // map stays smooth; still with reduced motion)
    const radar = h('div', { class: 'radar' }, h('span', { class: 'r-ring r1' }), h('span', { class: 'r-ring r2' }), h('span', { class: 'r-ring r3' }),
      h('span', { class: 'r-sweep' }), h('span', { class: 'r-pulse' }), h('span', { class: 'r-dot' }));
    L.marker([site.lat, site.lon], { icon: L.divIcon({ className: 'sitemark', html: radar, iconSize: [0, 0] }), zIndexOffset: -1000, keyboard: false, interactive: false }).addTo(M.layer);
    const pts = [[site.lat, site.lon]];
    if (DATA.vansAllowed) {
      list.forEach((v, i) => {
        const m = L.marker([v.pos.lat, v.pos.lon], { icon: vanIcon(v, false), title: `${v.who || 'Unassigned'} · ${plateOf(v)}` }).addTo(M.layer);
        m.bindTooltip(`${v.who || 'Unassigned'} · ${plateOf(v)} · ${milesTxt(v.d)} · ${timeTxt(v.d)}`, { className: 'vt', direction: 'top', offset: [0, -22] });
        m.on('click', () => pick(v.reg, false));
        M.marks.set(v.reg, { m, v });
        if (i < 4) pts.push([v.pos.lat, v.pos.lon]);
      });
    } else {
      // No live positions for this account: where today's bookings are, with each fitter's photo.
      todays.slice(0, 12).forEach((b, i) => {
        const m = L.marker([b.pos.lat, b.pos.lon], { icon: L.divIcon({ className: 'jobmark', html: h('div', null, face(b.fitter, 'sm')), iconSize: [0, 0] }), title: b.fitter }).addTo(M.layer);
        m.bindTooltip(`${b.fitter} · ${b.job}`, { className: 'vt', direction: 'top', offset: [0, -20] });
        if (i < 4) pts.push([b.pos.lat, b.pos.lon]);
      });
    }
    M.fit = L.latLngBounds(pts).pad(0.15);
    if (!keepView) frame();   // a refresh every 2 minutes moves the vans, not the view
  }
  // Frame the site and the nearest few, leaving room for the panel on the left (on phones the panel sits under the map).
  function frame() {
    if (!MAP || !MAP.fit) return;
    const narrow = matchMedia('(max-width:760px)').matches;
    MAP.map.invalidateSize();
    MAP.map.fitBounds(MAP.fit, { paddingTopLeft: narrow ? [20, 30] : [350, 30], paddingBottomRight: [40, 40], maxZoom: 13, animate: false });
  }
  let framed = 0;
  new ResizeObserver(() => { clearTimeout(framed); framed = setTimeout(frame, 150); }).observe(document.getElementById('map'));
  function pick(reg, fly = true) {
    if (!MAP) return;
    for (const [r, o] of MAP.marks) o.m.setIcon(vanIcon(o.v, r === reg));
    document.querySelectorAll('.mp-row').forEach(b => b.setAttribute('aria-current', String(b.dataset.reg === reg)));
    const o = MAP.marks.get(reg);
    if (o && fly) MAP.map.flyTo([o.v.pos.lat, o.v.pos.lon], Math.max(MAP.map.getZoom(), 13), { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.6 });
    if (o) o.m.openTooltip();
  }

  /* ---------------------------------------------------------------- the results */
  function person(name, plate, extra, cls) {
    return h('span', { class: 'person' }, face(name, cls), h('span', { class: 'pt' }, h('span', { class: 'pn' }, name, plate), extra));
  }
  function render(pc, district, site, known, quiet) {
    const label = pc.full || pc.outcode;
    $('#site').replaceChildren(
      h('span', { class: 'eyebrow' }, site.how === 'address' ? 'Site · exact address' : known ? 'Site · on the Work Programme' : site.how === 'district' ? 'Site · postcode district' : 'Site · postcode centre'),
      h('span', { class: 'site-name' }, site.how === 'address' ? site.address.split(',')[0] : known ? (known.address || known.job) : (site.area || district.area)),
      h('span', { class: 'site-meta' }, h('span', { class: 'pc' }, label), ` · ${district.area}`));

    const todays = nearestOn(TODAY, site);
    const vans = VANS.map(v => ({ ...v, d: distTo(v.pos, site, true), who: whoInVan(v) })).sort((a, z) => a.d.mins - z.d.mins);

    // The map's panel: the nearest vans right now (FleetView) or, without live positions, who is working nearest today
    const panel = $('#mappanel');
    if (DATA.vansAllowed && vans.length) {
      const [top, ...rest] = vans;
      panel.replaceChildren(
        h('div', { class: 'mp-head' }, h('span', { class: 'eyebrow' }, 'Right now · FleetView'), h('h2', null, 'Nearest vehicle'),
          h('p', null, `${vans.length} vehicles with a position`)),
        h('div', { class: 'mp-first' },
          person(top.who || 'Unassigned vehicle', plateEl(plateOf(top), true), vanState(top), 'lg'),
          h('span', { class: 'far' }, farLine(top.d))),
        h('ul', { class: 'mp-list', 'aria-label': 'Next nearest vehicles' }, rest.slice(0, 12).map(v => h('li', null,
          h('button', { type: 'button', class: 'mp-row', 'data-reg': v.reg },
            person(v.who || 'Unassigned', plateEl(plateOf(v)), vanState(v), 'sm'),
            h('span', { class: 'mi' }, milesTxt(v.d), h('span', null, timeTxt(v.d))))))));
      panel.querySelectorAll('.mp-row').forEach(b => b.addEventListener('click', () => pick(b.dataset.reg)));
    } else if (DATA.vansAllowed) {
      panel.replaceChildren(h('div', { class: 'mp-head' }, h('span', { class: 'eyebrow' }, 'Right now · FleetView'), h('h2', null, 'No vehicle positions yet')));
    } else {
      panel.replaceChildren(
        h('div', { class: 'mp-head' }, h('span', { class: 'eyebrow' }, `Today · ${fmtWeekday(TODAY)} ${fmtDate(TODAY)}`), h('h2', null, 'Working nearest'),
          h('p', null, 'From the Work Programme. Live vehicle positions are for Admins.')),
        h('ul', { class: 'mp-list' }, todays.slice(0, 12).map(b => h('li', null, h('div', { class: 'mp-row' },
          person(b.fitter, codeBadge(b), h('span', { class: 'then' }, b.job), 'sm'),
          h('span', { class: 'mi' }, milesTxt(b.d), h('span', null, timeTxt(b.d))))))));
    }

    // Booked nearest today: the Work Programme
    const top = todays[0];
    $('#today').replaceChildren(
      h('span', { class: 'eyebrow' }, `Booked nearest today · ${fmtWeekday(TODAY)} ${fmtDate(TODAY)}`),
      ...(top ? [
        person(top.fitter, [codeBadge(top, true), tbc(top)], h('span', { class: 'detail' }, 'Working at ', jobLink(top), top.postcode ? [' (', h('span', { class: 'pc' }, top.postcode), ')'] : null), 'lg'),
        h('span', { class: 'far' }, farLine(top.d)),
        todays.length > 1 ? h('div', { class: 'also' }, h('span', { class: 'eyebrow' }, 'Also out today'),
          todays.slice(1, 6).map(b => h('div', { class: 'mate' }, person(b.fitter, [codeBadge(b), tbc(b)], null, 'sm'),
            h('span', { class: 'miles' }, `${milesTxt(b.d)} · ${timeTxt(b.d)}`)))) : null,
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
          person(n.fitter, [codeBadge(n), tbc(n)], h('span', { class: 'job' }, jobLink(n), n.postcode ? [' · ', h('span', { class: 'pc' }, n.postcode)] : null, ` · ${fmtRange(n)}`), 'sm'),
          rest.length ? h('span', { class: 'then' }, 'then ' + rest.slice(0, 2).map(b => `${b.fitter} ${milesTxt(b.d)}`).join(', ')) : null),
        h('div', { class: 'dist' }, h('span', { class: 'miles' }, milesTxt(n.d)), h('span', null, timeTxt(n.d)))));
    }
    $('#days').replaceChildren(...(rows.length ? rows : [h('li', { class: 'empty' }, `No bookings on the Work Programme in the next ${DAYS_AHEAD} days.`)]));
    $('#results').hidden = false;
    drawMap(site, vans, todays, quiet);
    // Road routes for what's on screen: the nearest vans, today's nearest and each day's nearest few.
    const want = [];
    if (DATA.vansAllowed) for (const v of vans.slice(0, 8)) want.push([v.pos, site, true]);
    for (const b of todays.slice(0, 6)) want.push([b.pos, site, false]);
    for (let i = 1; i <= DAYS_AHEAD; i++) for (const b of nearestOn(addDays(TODAY, i), site).slice(0, 3)) want.push([b.pos, site, false]);
    roads(want);
  }

  $('#search').addEventListener('submit', e => { e.preventDefault(); search($('#postcode').value); });
  $('#line').addEventListener('input', suggestLines);
  $('#postcode').addEventListener('input', () => { SUGGEST.clear(); $('#lineList').replaceChildren(); });

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
    if (code === 'FLR_FORBIDDEN') return gate('You don’t have access to Nearby', 'It’s switched on for the FLR staff who need it. If you think you should have it, ask an FLR Super Admin.');
    if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
    if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
    if (missingFunction(e)) return gate('Nearby isn’t ready yet', 'The FLR database doesn’t have it yet.');
    if (offline(e)) return gate('Can’t reach the FLR database', 'Check your connection and try again.', { retry: true });
    return gate('Nearby didn’t load', 'Something went wrong. Try again in a moment.', { retry: true });
  }
  async function check(quiet = false) {
    try {
      const { data, error } = await client().rpc('proximity_board');
      if (error) { if (!quiet || expired(error) || ['FLR_SIGN_IN_REQUIRED', 'FLR_FORBIDDEN'].includes(flrCode(error))) failGate(error); return; }
      const board = boardFrom(data);
      if (!board) { if (!quiet) failGate(new Error('The answer had no bookings in it')); return; }
      show(board);
      if (!quiet && !photosAsked) loadPhotos();
    } catch (e) { if (!quiet) failGate(e); }
  }
  // Staff photos (Fleet Management's), once: they are large, and only change when a new photo is added.
  let photosAsked = false;
  async function loadPhotos() {
    photosAsked = true;
    try {
      const { data, error } = await client().rpc('proximity_photos');
      if (error || !data || typeof data !== 'object') return;
      PHOTOS = data;
      if (lastSearch) search(lastSearch, true);
    } catch (e) { /* no photos: outlines stay */ }
  }
  $('#gate-retry').addEventListener('click', () => { document.body.dataset.view = 'loading'; $('#gate-message').hidden = true; check(); });

  async function boot() {
    const c = client();
    if (!c) return gate('Nearby isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* signed out */ }
    if (!session) return location.replace(SIGN_IN);
    await check();
  }
  boot();
})();
