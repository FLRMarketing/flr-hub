/* ============================================================================
   FLR Hub: the Surveyor Calendar (Hub tile 'surveyors').

   Survey appointments from HubSpot (Sales Pipeline deals): the surveyor is the
   deal's owner, the day and time its "Appointment Date & Time", the place its
   Site Postcode and Site Address Line 1. Read-only: bookings are still made in
   HubSpot, and each one links back to its deal. Everyone with the app sees the
   whole team (the user's choice, 19 Oct 2026).

   Underneath, what is still to book:
     - Needs a surveyor: deals in Enquiry Received;
     - Needs a date: deals in Allocated to Surveyor or Appointment Scheduled
       with no Appointment Date & Time.

   Data: public.surveyor_board() (Estimator repo; app check 'surveyors'), filled
   by the flr-surveyors Edge Function every 15 minutes. Until that function is in
   the database the page shows made-up SAMPLE bookings, labelled on the page.

   Shape of surveyor_board():
     { readAt, failing,
       surveyors:    [{ id, name }],
       bookings:     [{ id, name, surveyor, at, postcode, address, stage, url }],
       needSurveyor: [{ id, name, postcode, createdAt, url }],
       needDate:     [{ id, name, surveyor, postcode, stage, url }] }
   at is an ISO time; HubSpot's 12:00 UTC default counts as "no time set".

   The page's CSP allows no inline styles: everything is built as elements.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';
  const SIGN_IN = '../?next=surveyors';
  const TILE = 'surveyors';
  const WHO_KEY = 'flr-surveyors-who';
  const $ = s => document.querySelector(s);

  /* ---------------------------------------------------------------- building the page (text only) */
  const SVG = 'http://www.w3.org/2000/svg';
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
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

  /* ---------------------------------------------------------------- dates (UK time) */
  const TZ = 'Europe/London';
  const ukDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const ukTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  const fmtDow = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
  const fmtLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
  const fmtAgo = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const isoDay = t => ukDay.format(t);                       // "2026-10-20"
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(dt, n) { const x = new Date(dt); x.setDate(x.getDate() + n); return x; }
  function iso(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
  function mondayOf(dt) { return addDays(dt, -((dt.getDay() + 6) % 7)); }
  // HubSpot fills 12:00 UTC when only a day is picked: that is "no time set", not noon.
  const noTime = t => t.getUTCHours() === 12 && t.getUTCMinutes() === 0;
  const timeOf = t => noTime(t) ? '' : ukTime.format(t);
  function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
  function short(name) {   // deal names end " - AK" (the surveyor's initials): drop that, it's on the row already
    return String(name || '').replace(/\s+-\s+[A-Z]{1,4}\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  }

  /* ---------------------------------------------------------------- sample data (made up; shown only before the database has the app) */
  function sample() {
    const mon = mondayOf(parse(isoDay(new Date())));
    const at = (d, hh, mm = 0) => { const x = addDays(mon, d); return new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate(), hh, mm)).toISOString(); };
    const S = [{ id: 's1', name: 'Sam Turner' }, { id: 's2', name: 'Priya Shah' }, { id: 's3', name: 'Dan Okafor' }, { id: 's4', name: 'Lucy Hart' }, { id: 's5', name: 'Mark Ellis' }];
    const b = (id, name, s, when, pc, addr, stage = 'Appointment Scheduled') => ({ id, name, surveyor: s, at: when, postcode: pc, address: addr, stage, url: '#sample' });
    return {
      sample: true, readAt: new Date(Date.now() - 6 * 60e3).toISOString(), failing: false, surveyors: S,
      bookings: [
        b('b1', 'Oakfield Primary - Hall LVT - ST', 's1', at(0, 8, 30), 'B30 2QY', '12 Oakfield Road'),
        b('b2', 'Riverside Dental - Surgery 2 - ST', 's1', at(0, 13, 0), 'CV1 4FS', 'Unit 3 Riverside Park'),
        b('b3', 'Halden Care Home - Lounge carpet - PS', 's2', at(1, 9, 0), 'WS1 1AA', 'Halden House'),
        b('b4', 'Northgate Offices - Floors 2-3 - DO', 's3', at(1, 12, 0), 'M1 2AB', '40 Northgate'),
        b('b5', 'Bramley Gym - Changing rooms - LH', 's4', at(2, 10, 0), 'DY1 3QR', 'Bramley Leisure Centre'),
        b('b6', 'Residential - Kitchen LVT - ST', 's1', at(2, 15, 30), 'B91 3DA', '7 Elm Close'),
        b('b7', 'Kingsway Hotel - Bedrooms phase 1 - ME', 's5', at(3, 9, 30), 'LE1 6XL', 'Kingsway Hotel'),
        b('b8', 'Westpoint Retail - Unit 9 - PS', 's2', at(3, 14, 0), '', 'Westpoint Retail Park'),
        b('b9', 'St Anne’s Library - Entrance matting - DO', 's3', at(4, 11, 0), 'NN1 2EF', 'Library Lane'),
        b('b10', 'Greenway Nursery - Playroom - LH', 's4', at(7, 9, 0), 'B90 1AA', 'Greenway Nursery'),
        b('b11', 'Fairfield School - Corridors - ST', 's1', at(8, 12, 0), 'B60 2HJ', 'Fairfield School'),
      ],
      needSurveyor: [
        { id: 'n1', name: 'Residential - Wetroom', postcode: 'WS9 8AA', createdAt: at(0, 9), url: '#sample' },
        { id: 'n2', name: 'Harbour Restaurant - Dining room', postcode: 'HP5 1AA', createdAt: at(-5, 14), url: '#sample' },
        { id: 'n3', name: 'Seaview Care Home - 8 flats refurb', postcode: '', createdAt: at(-6, 11), url: '#sample' },
      ],
      needDate: [
        { id: 'd1', name: 'Grange Church - New premises - ME', surveyor: 's5', postcode: '', stage: 'Appointment Scheduled', url: '#sample' },
        { id: 'd2', name: 'Fire Station - Dignity rooms - PS', surveyor: 's2', postcode: 'WV1 1AA', stage: 'Allocated to Surveyor', url: '#sample' },
        { id: 'd3', name: 'Vet Hospital - Grantham - LH', surveyor: 's4', postcode: '', stage: 'Allocated to Surveyor', url: '#sample' },
      ],
    };
  }

  /* ---------------------------------------------------------------- state */
  let DATA = null;
  const todayIso = isoDay(new Date());
  let monday = mondayOf(parse(todayIso));
  let who = '';
  try { who = localStorage.getItem(WHO_KEY) || ''; } catch (e) { /* per-viewer only */ }
  const byId = () => new Map((DATA.surveyors || []).map(s => [String(s.id), s]));

  /* ---------------------------------------------------------------- one booking */
  function chip(b, o = {}) {
    const t = new Date(b.at), tm = timeOf(t), past = t < new Date() && isoDay(t) !== todayIso;
    const s = byId().get(String(b.surveyor));
    return h('button', { class: 'bk' + (past ? ' past' : '') + (b.postcode ? '' : ' nopc'), type: 'button',
      'aria-label': `${tm || 'Time not set'}, ${b.postcode || 'no postcode'}, ${short(b.name)}${s ? ', ' + s.name : ''}`,
      onclick: () => openSheet(b) },
      h('span', { class: 't' + (tm ? '' : ' nt') }, tm || 'Time not set'),
      h('span', { class: 'pc' }, icon('i-pin'), b.postcode || 'No postcode'),
      h('span', { class: 'nm' }, short(b.name)),
      o.who && s ? h('span', { class: 'who' }, s.name) : null);
  }
  function openSheet(b) {
    const t = new Date(b.at), tm = timeOf(t), s = byId().get(String(b.surveyor));
    $('#sheetWhen').textContent = fmtLong.format(parse(isoDay(t))) + (tm ? ' · ' + tm : ' · time not set');
    $('#sheetTitle').textContent = short(b.name);
    $('#sheetWhere').replaceChildren(h('b', null, b.postcode || 'No postcode in HubSpot'), b.address ? ' · ' + b.address : '');
    $('#sheetWho').textContent = s ? 'Surveyor: ' + s.name : 'Surveyor: not set';
    $('#sheetStage').textContent = b.stage ? 'HubSpot stage: ' + b.stage : '';
    const a = $('#sheetLink');
    a.hidden = !/^https:\/\/app\.hubspot\.com\//.test(b.url || '');
    if (!a.hidden) a.href = b.url;
    $('#sheet').showModal();
  }
  $('#sheetClose').addEventListener('click', () => $('#sheet').close());
  $('#sheet').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  /* ---------------------------------------------------------------- the week */
  function render() {
    $('#sampleLabel').hidden = !DATA.sample;
    const days = [0, 1, 2, 3, 4].map(n => addDays(monday, n));
    const fri = days[4];
    $('#weekLabel').textContent = `${fmtShort.format(monday)} – ${fmtShort.format(fri)} ${fri.getFullYear()}`;

    // when HubSpot was last read
    const ra = DATA.readAt ? new Date(DATA.readAt) : null, late = !ra || DATA.failing || (Date.now() - ra) > 45 * 60e3;
    $('#readAt').className = late ? 'late' : '';
    $('#readAt').textContent = DATA.sample ? '' : ra ? `Last read ${fmtAgo.format(ra)}${late ? ' (late: HubSpot hasn’t been read for a while)' : ''}.` : 'Not read from HubSpot yet.';

    const people = (DATA.surveyors || []).filter(s => !who || String(s.id) === who);
    const inWeek = (DATA.bookings || []).filter(b => !who || String(b.surveyor) === who)
      .map(b => ({ b, day: isoDay(new Date(b.at)) }))
      .filter(x => x.day >= iso(monday) && x.day <= iso(fri))
      .sort((x, y) => new Date(x.b.at) - new Date(y.b.at));

    // desktop grid
    const cells = [h('div', { class: 'colhead', role: 'columnheader' }, 'Surveyor')];
    for (const d of days) {
      const isT = iso(d) === todayIso;
      cells.push(h('div', { class: 'colhead' + (isT ? ' today' : ''), role: 'columnheader', 'aria-label': fmtLong.format(d) + (isT ? ', today' : '') },
        fmtDow.format(d), h('b', null, String(d.getDate()))));
    }
    for (const s of people) {
      const mine = inWeek.filter(x => String(x.b.surveyor) === String(s.id));
      cells.push(h('div', { class: 'person', role: 'rowheader' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(s.name)),
        h('span', { class: 'nm' }, s.name, h('span', { class: 'ct' }, mine.length === 1 ? '1 survey' : `${mine.length} surveys`))));
      for (const d of days) {
        const here = mine.filter(x => x.day === iso(d));
        cells.push(h('div', { class: 'cell' + (here.length ? '' : ' empty') + (iso(d) === todayIso ? ' today' : ''), role: 'gridcell',
          'aria-label': here.length ? null : `${s.name}, ${fmtLong.format(d)}: free` }, here.map(x => chip(x.b))));
      }
    }
    $('#board').replaceChildren(...cells);

    // phones: a card per day
    $('#days').replaceChildren(...days.map(d => {
      const here = inWeek.filter(x => x.day === iso(d)), isT = iso(d) === todayIso;
      return h('section', { class: 'daycard' + (isT ? ' today' : '') },
        h('h3', null, fmtLong.format(d) + (isT ? ' · Today' : '')),
        h('ul', null, here.length ? here.map(x => h('li', null, chip(x.b, { who: true }))) : h('li', { class: 'none' }, 'No surveys booked')));
    }));

    renderTrays();
  }

  function renderTrays() {
    const S = byId();
    const row = (d, meta) => h('li', null, h('a', { href: /^https:\/\/app\.hubspot\.com\//.test(d.url || '') ? d.url : '#', target: '_blank', rel: 'noopener' },
      h('span', { class: 'nm' }, short(d.name)), h('span', { class: 'meta' }, meta),
      h('span', { class: 'pc' + (d.postcode ? '' : ' miss') }, d.postcode || 'No postcode')));
    const ns = (DATA.needSurveyor || []).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const nd = (DATA.needDate || []).filter(d => !who || String(d.surveyor) === who);
    const fill = (list, items, countEl, empty) => {
      $(countEl).textContent = String(items.length); $(countEl).classList.toggle('zero', !items.length);
      $(list).replaceChildren(...(items.length ? items : [h('li', { class: 'empty' }, empty)]));
    };
    fill('#listNoSurveyor', ns.map(d => row(d, 'Enquiry since ' + fmtShort.format(new Date(d.createdAt)))), '#countNoSurveyor', 'Every enquiry has a surveyor.');
    fill('#listNoDate', nd.map(d => row(d, (S.get(String(d.surveyor)) || { name: 'No surveyor' }).name + ' · ' + (d.stage || ''))), '#countNoDate', 'Nothing waiting for a date.');
  }

  function fillWho() {
    const sel = $('#who');
    sel.replaceChildren(h('option', { value: '' }, 'Everyone'), ...(DATA.surveyors || []).map(s => h('option', { value: String(s.id) }, s.name)));
    if (who && !(DATA.surveyors || []).some(s => String(s.id) === who)) who = '';
    sel.value = who;
  }
  $('#who').addEventListener('change', e => { who = e.target.value; try { localStorage.setItem(WHO_KEY, who); } catch (x) { /* fine */ } render(); });
  $('#prev').addEventListener('click', () => { monday = addDays(monday, -7); render(); });
  $('#next').addEventListener('click', () => { monday = addDays(monday, 7); render(); });
  $('#thisWeek').addEventListener('click', () => { monday = mondayOf(parse(todayIso)); render(); });

  /* ================================================================ the Hub: signed in, and the app is theirs */
  function gate(title, text, o = {}) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
    $('#gate-retry').hidden = !o.retry;
  }
  let sb = null;
  const client = () => {
    if (sb) return sb;
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY },
    });
    return sb;
  };
  const flrCode = e => { const m = /FLR_[A-Z_]+/.exec(e ? `${e.message || ''} ${e.details || ''}` : ''); return m ? m[0] : ''; };
  const missingFunction = e => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message || ''));
  const offline = e => !!e && /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(e.message || '');
  const expired = e => !!e && (e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT expired|invalid JWT/i.test(e.message || ''));
  function failGate(e) {
    const code = flrCode(e);
    if (expired(e) || code === 'FLR_SIGN_IN_REQUIRED') return location.replace(SIGN_IN);
    if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
    if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
    if (code === 'FLR_FORBIDDEN') return gate('You don’t have access to the Surveyor Calendar', 'If you think you should have it, ask an FLR Super Admin.');
    if (missingFunction(e)) return gate('The Surveyor Calendar isn’t ready yet', 'The FLR database doesn’t have the Hub’s apps yet.');
    if (offline(e)) return gate('Can’t reach the FLR database', 'Check your connection and try again.', { retry: true });
    return gate('The Surveyor Calendar didn’t load', 'Something went wrong. Try again in a moment.', { retry: true });
  }
  async function load() {
    const { data, error } = await client().rpc('surveyor_board');
    if (error && missingFunction(error)) return sample();   // the database doesn't have the app's data yet
    if (error) throw error;
    return data;
  }
  async function show() {
    DATA = await load();
    fillWho(); render();
    document.body.dataset.view = 'ready';
    $('#view').hidden = false;
  }
  async function check() {
    try {
      const { data, error } = await client().rpc('hub_home');
      if (error) return failGate(error);
      if (data && data.waiting) return gate('Your account is waiting for a Super Admin', 'An FLR Super Admin needs to check who you are before you can use the Hub’s apps.');
      const tiles = (data && Array.isArray(data.tiles)) ? data.tiles : [];
      if (!tiles.some(t => t && t.id === TILE)) return gate('You don’t have access to the Surveyor Calendar', 'It’s switched on for the FLR staff who need it. If you think you should have it, ask an FLR Super Admin.');
      await show();
    } catch (e) { failGate(e); }
  }
  $('#gate-retry').addEventListener('click', () => { document.body.dataset.view = 'loading'; $('#gate-message').hidden = true; check(); });
  // Read again every 5 minutes while open (the function reads HubSpot every 15).
  setInterval(async () => {
    if (document.hidden || document.body.dataset.view !== 'ready' || (DATA && DATA.sample)) return;
    try { const d = await load(); if (d) { DATA = d; fillWho(); render(); } } catch (e) { /* keep what's shown */ }
  }, 5 * 60e3);

  async function boot() {
    const c = client();
    if (!c) return gate('The Surveyor Calendar isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* signed out */ }
    if (!session) return location.replace(SIGN_IN);
    await check();
  }
  boot();
})();
