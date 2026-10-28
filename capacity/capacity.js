/* ============================================================================
   FLR Hub: the Planner (Hub tile 'capacity'). A month calendar of how many fitters are booked
   each day, out of the capacity in the data (23). The calendar is the approved page
   (flr-job-planner/index.html) with the same look, behaviour and labels; this file
   adds the Hub's sign-in and access check, and reads the figures from the database.

   The figures: real daily totals from the Monday Work Programme, never names or jobs.
   public.planner_board() (Estimator repo, 20261016100000_flr_planner_data.sql) answers
     { capacity, readAt, source, days: { "YYYY-MM-DD": { b, u, t?, f? } },
       triedAt, failingSince, pageError,      (since Planner 1.2)
       closures: [{ date, name, kind }],      (since Planner 1.3)
       bookings, bookingsFrom, bookingsTo }   (since Planner 1.4: who is booked where, for the Week view, week.js)
       b  distinct fitters booked on fitting work that day
       u  fitting bookings that day still with no fitter (the gold number)
       t  fitters booked only on TBC bookings
       f  roster fitters free that day (weekdays)
   closures are the days FLR is closed, from the Annual Leave Diary's own board and named and
   classified as the Diary does: kind 'bh' bank holiday, 'shut' company close day, 'jeff' the
   Jeff Day. They're hatched in the Diary's colours, with the name under the date (in the day's
   label on phones). A day that isn't listed had no fitting work: it shows the date only. Since Planner 1.2 the
   flr-planner Edge Function reads the Work Programme (read-only) every 15 minutes and saves
   the totals; the label beside the heading says when ("Monday · updated 09:45"). If reads
   start failing, the last good read stays and a gold notice under the subtitle says since
   when. Before the first read (readAt null) the page says so and shows no days, so nothing
   looks free when it may not be. An open page asks again every 5 minutes.

   Who can open it: planner_board() makes the Order Tracker's app check
   (private.require_app('capacity')): signed in, with a profile, not switched off, and on
   the 'capacity' list (Super Admins to start, switched on for others in Hub settings).

   This page's CSP allows no inline styles: everything is built as elements, and
   each battery's fill is set with element.style.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';            // the one FLR sign-in for the whole site
  const SIGN_IN = '../?next=capacity';
  const $ = s => document.querySelector(s);

  /* ---------------------------------------------------------------- building the page (text only: nothing is parsed as HTML) */
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
    const u = document.createElementNS(SVG, 'use'); u.setAttribute('href', '#' + id); s.append(u);
    return s;
  }

  /* ================================================================ the calendar (as on the approved page) */
  let DATA = null;            // planner_board()'s answer, once it has loaded
  let CAPACITY = 23;          // fitters available per day (from the data)

  /* ---------- date helpers ---------- */
  function startOfDay(dt) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
  function addDays(dt, n) { const x = new Date(dt); x.setDate(x.getDate() + n); return x; }
  function iso(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
  function mondayOf(dt) { return addDays(dt, -((dt.getDay() + 6) % 7)); }
  function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
  const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
  const fmtDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtRead = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
  // A read time: "09:45" today, "15 Oct, 09:45" on any other day.
  const when = at => (iso(at) === iso(new Date()) ? fmtTime : fmtRead).format(at);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  /* ---------- capacity ---------- */
  // One day's figures from Monday, or null when the day had no dated fitting work.
  function dayOf(d) {
    const r = DATA && DATA.days[iso(d)];
    return r ? { booked: r.b, unassigned: r.u || 0, tbc: r.t || 0, free: r.f } : null;
  }
  // Yellow (hue 48) at the bottom, blending to green (hue 130) when full; stays yellow longer, turns green as it fills.
  function battColour(total) {
    const r = Math.min(1, total / CAPACITY), k = Math.pow(r, 1.6);
    return `hsl(${Math.round(48 + k * 82)} ${Math.round(85 - r * 25)}% var(--batt-l))`;
  }
  function capLabel(c) {
    let s = c.booked > CAPACITY ? `Over capacity: ${c.booked} of ${CAPACITY} fitters booked`
      : c.booked === 0 ? `Fitting work, but no fitter assigned yet: 0 of ${CAPACITY}`
      : `${c.booked} of ${CAPACITY} fitters booked`;
    if (c.tbc) s += `, ${c.tbc} of them on TBC bookings`;
    if (c.unassigned) s += `. ${plural(c.unassigned, 'booking still needs a fitter', 'bookings still need a fitter')}, so this total isn’t final`;
    if (typeof c.free === 'number') s += `. ${plural(c.free, 'fitter', 'fitters')} free after leave and other time off`;
    return s;
  }
  // The battery and the fitter badge. hidden: left out of what a screen reader reads (the day's label says it).
  function battery(c, hidden = true) {
    const over = c.booked > CAPACITY, zero = c.booked === 0;
    const cls = ['cap', zero ? 'zero' : over ? 'over' : '', c.unassigned ? 'partial' : ''].filter(Boolean).join(' ');
    const pct = zero ? 0 : Math.min(100, (c.booked / CAPACITY) * 100);
    const fill = h('i');
    fill.style.width = pct + '%';
    if (!over) fill.style.background = battColour(c.booked);
    return h('span', { class: cls, 'aria-hidden': hidden ? 'true' : null },
      h('span', { class: 'row' },
        over ? icon('i-warn', 'warn') : null,
        h('span', { class: 'batt' }, fill, over ? icon('i-warn', 'warn-in') : null)),
      h('span', { class: 'num' }, icon('i-person', 'pi'), String(c.booked), h('span', { class: 'of' }, '/' + CAPACITY)));
  }
  // A closed day, as the label and tooltip say it: "New Year's Day 2027 (bank holiday)", "Company close day", "Jeff Day …".
  function closureText(cl) {
    if (cl.kind === 'bh') return /bank holiday/i.test(cl.name) ? cl.name : `${cl.name} (bank holiday)`;
    if (cl.kind === 'jeff') return /jeff/i.test(cl.name) ? cl.name : `${cl.name} (Jeff Day)`;
    return cl.name;
  }
  const unassignedMark = n => h('span', { class: 'unk', 'aria-hidden': 'true' }, n > 9 ? '9+' : String(n));

  /* ---------- state ---------- */
  const today = startOfDay(new Date());
  const todayIso = iso(today);
  let shown = new Date(today.getFullYear(), today.getMonth(), 1);

  /* ---------- the month ---------- */
  function render() {
    const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
    const last = new Date(shown.getFullYear(), shown.getMonth() + 1, 0);
    $('#monthLabel').textContent = fmtMonth.format(first);
    if (!DATA) return;
    const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => h('div', { class: 'dow', role: 'columnheader' }, d));
    const end = addDays(mondayOf(last), 6);
    for (let d = mondayOf(first); d <= end; d = addDays(d, 1)) {
      // Days from the previous or next month: a blank, shaded cell that only holds the weekday columns in place.
      if (d.getMonth() !== first.getMonth()) { cells.push(h('div', { class: 'day out', role: 'gridcell', 'aria-hidden': 'true' })); continue; }
      const isToday = iso(d) === todayIso, c = dayOf(d), cl = DATA.closures.get(iso(d));
      const cls = ['day', isWeekend(d) ? 'we' : '', isToday ? 'today' : '', cl ? 'closed-' + cl.kind : '', cl && c ? 'has-cap' : ''].filter(Boolean).join(' ');
      let body = [], label = fmtDay.format(d) + (isToday ? ', today' : '');
      if (cl) label += '. FLR closed: ' + closureText(cl);
      if (!c) label += '. No fitting work booked';   // a day with no dated fitting work: the date only
      else { body = [battery(c), c.unassigned ? unassignedMark(c.unassigned) : null]; label += '. ' + capLabel(c); }
      cells.push(h('div', { class: cls, role: 'gridcell', 'aria-label': label, title: label },
        h('span', { class: 'dn', 'aria-hidden': 'true' }, String(d.getDate())),
        cl ? h('span', { class: 'closure', 'aria-hidden': 'true' }, h('span', { class: 'ct' }, cl.name)) : null, body));
    }
    $('#cal').replaceChildren(...cells);
  }

  function renderKey() {
    const item = (c, text) => [battery(c, false), h('span', null, text)];
    $('#key-zero').replaceChildren(...item({ booked: 0 }, 'Work booked, no fitter yet'));
    $('#key-part').replaceChildren(...item({ booked: 12 }, 'Partly booked'));
    $('#key-full').replaceChildren(...item({ booked: CAPACITY }, 'Full'));
    $('#key-over').replaceChildren(...item({ booked: 27 }, 'Over capacity'));
    $('#key-unk').replaceChildren(h('span', { class: 'unk' }, '2'), h('span', null, 'Bookings still needing a fitter'));
  }

  function showSource() {
    $('#subtitle').textContent = `Fitters booked each day, out of ${CAPACITY}.`;
    const at = new Date(DATA.readAt), src = $('#source');
    src.textContent = `Monday · updated ${when(at)}`;
    src.title = `Daily totals from the Monday Work Programme, read every 15 minutes. Last read ${fmtDay.format(at)} at ${fmtTime.format(at)}`;
    src.classList.toggle('stale', !!DATA.failingSince);
    // Reads failing: the last good read is still shown, and this says so.
    const note = $('#notice');
    if (DATA.failingSince) {
      note.textContent = `Couldn’t read Monday since ${when(new Date(DATA.failingSince))}. Showing the last good read from ${when(at)}.`;
      note.hidden = false;
    } else { note.textContent = ''; note.hidden = true; }
  }

  // planner_board()'s answer, checked: a whole number capacity, a read time, and days of {b, u, t?, f?}. Anything else is
  // treated as not loaded (the page shows no days rather than wrong ones).
  const whole = n => Number.isInteger(n) && n >= 0;
  const CLOSURE_KINDS = new Set(['bh', 'shut', 'jeff']);
  function planFrom(d) {
    if (!d || typeof d !== 'object' || !d.days || typeof d.days !== 'object' || Array.isArray(d.days)) return null;
    if (d.readAt == null) return { empty: true };
    if (isNaN(new Date(d.readAt))) return null;
    const days = {};
    for (const [k, r] of Object.entries(d.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !r || !whole(r.b)) return null;
      if ([r.u, r.t, r.f].some(v => v != null && !whole(v))) return null;
      days[k] = { b: r.b, u: r.u || 0, t: r.t || 0, f: r.f };
    }
    const failingSince = d.failingSince != null && !isNaN(new Date(d.failingSince)) ? d.failingSince : null;
    // Closed days (Planner 1.3; none from an older database): any entry that isn't a dated, named bh/shut/jeff is left out.
    const closures = new Map();
    for (const x of Array.isArray(d.closures) ? d.closures : []) {
      if (x && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && typeof x.name === 'string' && x.name.trim() && CLOSURE_KINDS.has(x.kind))
        closures.set(x.date, { name: x.name.trim(), kind: x.kind });
    }
    const wk = bookingsFrom(d);
    return { capacity: Number.isInteger(d.capacity) && d.capacity > 0 ? d.capacity : 23, readAt: d.readAt, source: d.source, days, failingSince, closures, ...wk };
  }
  // The Week view's bookings (Planner 1.4; none from an older database): checked again here, and any entry that isn't
  // as planner_save() allows is left out. No window = "No bookings loaded yet" on the Week view.
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/, ID_RE = /^\d{1,20}$/;
  const str = (v, max) => typeof v === 'string' && v.length <= max;
  function bookingsFrom(d) {
    if (!DAY_RE.test(d.bookingsFrom || '') || !DAY_RE.test(d.bookingsTo || '') || !Array.isArray(d.bookings)) return { bookings: [], bookingsFrom: null, bookingsTo: null };
    const out = [];
    for (const b of d.bookings) {
      if (!b || typeof b !== 'object') continue;
      if (b.kind === 'away') {
        if (DAY_RE.test(b.day || '') && Array.isArray(b.people)) out.push({ kind: 'away', day: b.day, people: b.people.filter(p => str(p, 80) && p.trim()).map(p => p.trim()) });
        continue;
      }
      const j = b.job, s = b.sub;
      if ((b.kind !== 'work' && b.kind !== 'unassigned') || !j || !s || !ID_RE.test(j.id || '') || !str(j.name, 200) || !j.name || !ID_RE.test(s.id || '')) continue;
      if (!Array.isArray(b.days) || !Array.isArray(b.people) || !b.days.every(x => DAY_RE.test(x))) continue;
      out.push({ kind: b.kind, status: str(b.status, 20) ? b.status : '',
        job: { id: j.id, name: j.name, site: str(j.site, 80) ? j.site : '', postcode: str(j.postcode, 16) ? j.postcode : '', address: str(j.address, 300) ? j.address : '', wfm: str(j.wfm, 32) ? j.wfm : '' },
        sub: { id: s.id, name: str(s.name, 200) ? s.name : '' }, days: b.days.slice(),
        people: b.people.filter(p => p && str(p.name, 80) && p.name.trim()).map(p => (p.tag === 'flr' || p.tag === 'sub') ? { name: p.name.trim(), tag: p.tag } : { name: p.name.trim() }) });
    }
    return { bookings: out, bookingsFrom: d.bookingsFrom, bookingsTo: d.bookingsTo };
  }

  /* ---------------------------------------------------------------- the tabs: Month | Week (#month / #week remembers it) */
  const TABS = ['month', 'week'];
  let tab = 'month';
  function setTab(t, o = {}) {
    if (!TABS.includes(t)) t = 'month';
    tab = t;
    document.body.dataset.tab = t;
    for (const b of document.querySelectorAll('.tabs [role="tab"]')) {
      const on = b.dataset.tab === t;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
      if (on && o.focus) b.focus();
    }
    $('#month-view').hidden = t !== 'month';
    $('#week-view').hidden = t !== 'week';
    if (o.hash !== false && location.hash !== '#' + t) history.replaceState(null, '', '#' + t);
  }
  const hashTab = () => { const x = location.hash.replace(/^#/, ''); return TABS.includes(x) ? x : null; };
  for (const b of document.querySelectorAll('.tabs [role="tab"]')) {
    b.addEventListener('click', () => setTab(b.dataset.tab));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setTab(TABS[(TABS.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length], { focus: true });
    });
  }
  window.addEventListener('hashchange', () => { const x = hashTab(); if (x && x !== tab) setTab(x, { hash: false }); });
  setTab(hashTab() || 'month', { hash: false });
  if (window.FLRPlannerWeek) window.FLRPlannerWeek.init({ h, icon, battery, battColour, capLabel, closureText });

  $('#prev').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1); render(); });
  $('#next').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1); render(); });
  $('#thisMonth').addEventListener('click', () => { shown = new Date(today.getFullYear(), today.getMonth(), 1); render(); });

  /* ================================================================ the Hub: signed in, and the Planner is theirs */
  function gate(title, text, o = {}) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
    $('#gate-retry').hidden = !o.retry;
  }
  function show(plan) {
    DATA = plan; CAPACITY = plan.capacity;
    if (!refresher) refresher = setInterval(() => { if (document.visibilityState === 'visible' && document.body.dataset.view === 'ready') check(true); }, REFRESH_MS);
    showSource();
    renderKey();
    render();
    if (window.FLRPlannerWeek) window.FLRPlannerWeek.update(plan);
    document.body.dataset.view = 'ready';
    $('#view').hidden = false;
  }

  const REFRESH_MS = 5 * 60 * 1000;   // an open page asks again every 5 minutes (Monday is read every 15)
  let refresher = null;
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
    if (code === 'FLR_FORBIDDEN') return gate('You don’t have access to the Planner', 'It’s switched on for the FLR staff who need it. If you think you should have it, ask an FLR Super Admin.');
    if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
    if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
    if (missingFunction(e)) return gate('The Planner isn’t ready yet', 'The FLR database doesn’t have the Planner’s figures yet.');
    if (offline(e)) return gate('Can’t reach the FLR database', 'Check your connection and try again.', { retry: true });
    return gate('The Planner didn’t load', 'Something went wrong getting the figures. Try again in a moment.', { retry: true });
  }
  // planner_board() checks this account may use the Planner (as orders_board() does), then gives the daily totals.
  // quiet: a refresh of an open page. It only ever replaces good figures with newer good figures; if anything goes
  // wrong it leaves the page as it is (a sign-in that has run out still goes to the sign-in).
  async function check(quiet = false) {
    if (quiet) {
      try {
        const { data, error } = await client().rpc('planner_board');
        if (error) { if (expired(error) || flrCode(error) === 'FLR_SIGN_IN_REQUIRED' || flrCode(error) === 'FLR_FORBIDDEN') failGate(error); return; }
        const plan = planFrom(data);
        if (plan && !plan.empty) show(plan);
      } catch (e) { /* offline for a moment: keep what's shown */ }
      return;
    }
    try {
      const { data, error } = await client().rpc('planner_board');
      if (error) return failGate(error);
      const plan = planFrom(data);
      if (!plan) return failGate(new Error('The answer had no daily totals in it'));
      if (plan.empty) return gate('No Monday totals yet', 'The Planner hasn’t been given a read of the Monday Work Programme yet.');
      show(plan);
    } catch (e) { failGate(e); }
  }
  $('#gate-retry').addEventListener('click', () => { document.body.dataset.view = 'loading'; $('#gate-message').hidden = true; check(); });

  async function boot() {
    const c = client();
    if (!c) return gate('The Planner isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) return location.replace(SIGN_IN);
    await check();
  }
  boot();
})();
