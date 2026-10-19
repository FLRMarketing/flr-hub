/* ============================================================================
   FLR Hub: the Surveyor Calendar (Hub tile 'surveyors').

   Survey appointments from HubSpot (Sales Pipeline deals): the surveyor is the
   deal's owner, the day and time its "Appointment Date & Time", the place its
   Site Postcode and Site Address Line 1. Read-only: bookings are still made in
   HubSpot, and each one links back to its deal. Everyone with the app sees the
   whole team (the user's choice, 19 Oct 2026). A month of day tiles, each surveyor
   in their own colour (chips above filter to one), and the chosen day's surveys
   listed beside it.

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
        b('b12', 'Parkside Surgery - Waiting room - PS', 's2', at(-14, 9, 0), 'B12 8QR', 'Parkside Surgery', 'Quoted'),
        b('b13', 'Canal Wharf Offices - Reception - ME', 's5', at(-13, 13, 30), 'B1 2JP', 'Canal Wharf', 'Quoted'),
        b('b14', 'Hillcrest Academy - Sports hall - DO', 's3', at(-11, 10, 0), 'CV34 5AA', 'Hillcrest Academy', 'Quoted'),
        b('b15', 'Residential - Hallway carpet - LH', 's4', at(-7, 15, 0), 'B93 9AA', '2 Mill Lane', 'Quoted'),
        b('b16', 'Moor Street Bank - Branch carpet - ST', 's1', at(9, 9, 0), 'B4 7UL', 'Moor Street'),
        b('b17', 'Abbey Care - Corridors - PS', 's2', at(9, 11, 30), 'WR1 2AA', 'Abbey Care Home'),
        b('b18', 'Lakeside Hotel - Function room - ME', 's5', at(9, 14, 0), 'TF1 1AA', 'Lakeside Hotel'),
        b('b19', 'Elmwood Nursery - Toilets - DO', 's3', at(10, 10, 0), 'B44 9AA', 'Elmwood Nursery'),
        b('b20', 'Kings Park - Unit 4 resin - LH', 's4', at(14, 9, 30), 'DY4 7AA', 'Kings Park Ind. Est.'),
        b('b21', 'Orchard School - Classrooms - ST', 's1', at(15, 12, 0), 'B47 6AA', 'Orchard School'),
        b('b22', 'Victoria Flats - Communal areas - PS', 's2', at(16, 10, 0), 'ST1 1AA', 'Victoria Flats'),
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
  let shown = (d => new Date(d.getFullYear(), d.getMonth(), 1))(parse(todayIso));
  let selected = todayIso;
  let who = '';
  try { who = localStorage.getItem(WHO_KEY) || ''; } catch (e) { /* per-viewer only */ }
  const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
  const byId = () => new Map((DATA.surveyors || []).map((s, i) => [String(s.id), Object.assign({ c: 'c' + (i % 8) }, s)]));
  const colour = id => (byId().get(String(id)) || { c: 'c7' }).c;
  const visible = () => (DATA.bookings || []).filter(b => !who || String(b.surveyor) === who)
    .map(b => ({ b, day: isoDay(new Date(b.at)) })).sort((x, y) => new Date(x.b.at) - new Date(y.b.at));

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

  /* ---------------------------------------------------------------- who to show */
  function renderLegend() {
    const chip = (id, name, c) => h('button', { class: 'lg ' + c, type: 'button', 'aria-pressed': String(who === id),
      onclick: () => { who = id; try { localStorage.setItem(WHO_KEY, who); } catch (x) { /* fine */ } render(); } }, h('i'), name);
    $('#legend').replaceChildren(chip('', 'Everyone', ''), ...[...byId().values()].map(s => chip(String(s.id), s.name, s.c)));
  }

  /* ---------------------------------------------------------------- the month */
  function render() {
    $('#sampleLabel').hidden = !DATA.sample;
    const ra = DATA.readAt ? new Date(DATA.readAt) : null, late = !ra || DATA.failing || (Date.now() - ra) > 45 * 60e3;
    $('#readAt').className = late ? 'late' : '';
    $('#readAt').textContent = DATA.sample ? '' : ra ? `Last read ${fmtAgo.format(ra)}${late ? ' (late: HubSpot hasn’t been read for a while)' : ''}.` : 'Not read from HubSpot yet.';
    renderLegend();

    const first = shown, last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    $('#monthLabel').textContent = fmtMonth.format(first);
    const all = visible(), S = byId();
    const cells = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      .map(d => h('div', { class: 'dow', role: 'columnheader', 'aria-label': d }, h('span', { class: 'long' }, d.slice(0, 3))));
    const end = addDays(mondayOf(last), 6);
    for (let d = mondayOf(first); d <= end; d = addDays(d, 1)) {
      const di = iso(d);
      if (d.getMonth() !== first.getMonth()) { cells.push(h('div', { class: 'tile out', 'aria-hidden': 'true' }, h('span', { class: 'dn' }, String(d.getDate())))); continue; }
      const here = all.filter(x => x.day === di), we = d.getDay() === 0 || d.getDay() === 6;
      const cls = ['tile', we ? 'we' : '', di === todayIso ? 'today' : '', di === selected ? 'sel' : ''].filter(Boolean).join(' ');
      const shownEv = here.slice(0, 2).map(x => {
        const s = S.get(String(x.b.surveyor)), tm = timeOf(new Date(x.b.at));
        return h('span', { class: 'ev ' + colour(x.b.surveyor) }, h('span', { class: 'n' }, s ? s.name.split(' ')[0] : 'No surveyor'),
          h('span', { class: 'p' }, [tm, x.b.postcode || 'No postcode'].filter(Boolean).join(' · ')));
      });
      cells.push(h('button', { class: cls, type: 'button', role: 'gridcell', 'aria-pressed': String(di === selected),
        'aria-label': `${fmtLong.format(d)}${di === todayIso ? ', today' : ''}: ${here.length ? here.length + (here.length === 1 ? ' survey' : ' surveys') : 'no surveys'}`,
        onclick: () => { selected = di; render(); } },
        h('span', { class: 'dn' }, String(d.getDate())), shownEv,
        here.length > 2 ? h('span', { class: 'more' }, `+${here.length - 2} more`) : null,
        here.length ? h('span', { class: 'dots', 'aria-hidden': 'true' }, here.slice(0, 6).map(x => h('i', { class: colour(x.b.surveyor) }))) : null));
    }
    $('#cal').replaceChildren(...cells);
    renderDay(all);
    renderTrays();
  }

  /* the chosen day's surveys, as event cards */
  function renderDay(all) {
    const d = parse(selected), here = all.filter(x => x.day === selected), S = byId();
    $('#dayTitle').textContent = selected === todayIso ? 'Today’s surveys' : 'Surveys';
    $('#dayNote').textContent = fmtLong.format(d) + (who && S.get(who) ? ' · ' + S.get(who).name : '');
    $('#dayList').replaceChildren(...(here.length ? here.map(x => {
      const b = x.b, s = S.get(String(b.surveyor)), tm = timeOf(new Date(b.at)), c = colour(b.surveyor);
      return h('li', null, h('button', { class: 'evc ' + c, type: 'button', onclick: () => openSheet(b),
        'aria-label': `${tm || 'Time not set'}, ${short(b.name)}, ${b.postcode || 'no postcode'}${s ? ', ' + s.name : ''}` },
        h('span', { class: 'd' }, fmtShort.format(d) + (s ? ' · ' + s.name : '')),
        h('span', { class: 't' }, short(b.name)),
        h('span', { class: 'pc' + (b.postcode ? '' : ' miss') }, b.postcode || 'No postcode'),
        h('span', { class: 'meta' }, icon('i-clock'), tm || 'Time not set', b.address ? ' · ' + b.address : ''),
        h('span', { class: 'who' }, h('span', { class: 'mini' }, initials(s ? s.name : '?')), h('span', { class: 'bar' }, h('i')), b.stage || '')));
    }) : [h('li', { class: 'none' }, 'No surveys booked.')]));
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

  const fillWho = () => { if (who && !(DATA.surveyors || []).some(s => String(s.id) === who)) who = ''; };
  const moveMonth = n => { shown = new Date(shown.getFullYear(), shown.getMonth() + n, 1); render(); };
  $('#prev').addEventListener('click', () => moveMonth(-1));
  $('#next').addEventListener('click', () => moveMonth(1));
  $('#thisMonth').addEventListener('click', () => { const t = parse(todayIso); shown = new Date(t.getFullYear(), t.getMonth(), 1); selected = todayIso; render(); });

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
