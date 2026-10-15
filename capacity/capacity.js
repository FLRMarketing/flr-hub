/* ============================================================================
   FLR Hub: Fitter Capacity. A month calendar of how many fitters are booked
   each weekday, out of 23. The calendar is the approved page
   (flr-job-planner/index.html) with the same look and behaviour; this file
   adds the Hub's sign-in and access check.

   For now it shows SAMPLE data, labelled "Sample data" on the page: the jobs
   below are made up, placed around this week, and only their totals show
   (job names are never shown). Nothing is read from monday.com yet.

   Who can open it: the 'capacity' Hub tile (Estimator repo,
   20261015400000_flr_fitter_capacity.sql), Super Admins to start, switched on
   for others in Hub settings. The page asks public.hub_home(), which lists only
   the tiles the signed-in, active account may use, and shows the calendar only
   when 'capacity' is one of them. The sample data is in this public file
   anyway, so the check is about keeping the Hub tidy, not hiding data; when
   real data comes, it will need its own database function with the app check
   (private.require_app('capacity')), as the Order Tracker's orders_board() has.

   This page's CSP allows no inline styles: everything is built as elements, and
   each battery's fill is set with element.style.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';            // the one FLR sign-in for the whole site
  const SIGN_IN = '../?next=capacity';
  const TILE = 'capacity';
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
  /*
   * DATA: one record per job, used ONLY to work out each day's total. Nothing about a job is shown on the page.
   *   id       string             Monday item ID (unique key)
   *   name     string             job name (not displayed)
   *   start    "YYYY-MM-DD"       first day of the job
   *   end      "YYYY-MM-DD"       last day (same as start for a one-day job)
   *   fitters  number | null      supplied value; NEVER calculated here (the sub-item method is undecided)
   * Fitter names are not part of this shape on purpose.
   */
  const CAPACITY = 23;   // fitters available per day

  // Sample jobs, placed relative to this week's Monday so the totals always fall in the near future.
  // Their counts are chosen to produce every battery state: empty, part full, exactly full, over capacity, and missing counts.
  const USING_SAMPLE_DATA = true;
  function sampleJobs() {
    const d = (offset) => iso(addDays(mondayOf(startOfDay(new Date())), offset));
    return [
      { id: 's1',  name: 'Office refurbishment – Unit 4',                             start: d(-7), end: d(-3), fitters: 8 },
      { id: 's2',  name: 'School corridor vinyl',                                     start: d(0),  end: d(4),  fitters: 6 },
      { id: 's3',  name: 'Care home lounge carpet',                                   start: d(3),  end: d(3),  fitters: 4 },
      { id: 's4',  name: 'Retail unit LVT – ground floor',                            start: d(7),  end: d(11), fitters: 8 },
      { id: 's5',  name: 'Surgery waiting room safety flooring and entrance matting', start: d(8),  end: d(9),  fitters: 3 },
      { id: 's6',  name: 'Head office carpet tiles – floors 2–3',                     start: d(9),  end: d(22), fitters: 12 },
      { id: 's7',  name: 'Leisure centre changing rooms',                             start: d(14), end: d(16), fitters: null },
      { id: 's8',  name: 'Hospital ward safety flooring',                             start: d(15), end: d(17), fitters: 10 },
      { id: 's9',  name: 'Bank branch carpet',                                        start: d(16), end: d(16), fitters: 5 },
      { id: 's10', name: 'Student accommodation – block B',                           start: d(21), end: d(39), fitters: 9 },
      { id: 's11', name: 'Library mats',                                              start: d(24), end: d(24), fitters: 2 },
      { id: 's12', name: 'Hotel bedrooms phase 1',                                    start: d(28), end: d(39), fitters: 10 },
      { id: 's13', name: 'Nursery playroom',                                          start: d(36), end: d(37), fitters: null },
      { id: 's14', name: 'Warehouse office resin',                                    start: d(44), end: d(46), fitters: 3 },
      { id: 's15', name: 'Dental practice – surgery 3 and decontamination room',      start: d(51), end: d(51), fitters: 2 },
    ];
  }

  // Placeholder for the real source. Replace the body with the Monday.com read once the board fields are confirmed
  // (through a database function with the app check, not from this public page).
  async function loadJobs() {
    return sampleJobs();
  }

  /* ---------- date helpers ---------- */
  function startOfDay(dt) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
  function addDays(dt, n) { const x = new Date(dt); x.setDate(x.getDate() + n); return x; }
  function iso(dt) { return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
  function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function mondayOf(dt) { return addDays(dt, -((dt.getDay() + 6) % 7)); }
  function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
  const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
  const fmtDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  /* ---------- capacity ---------- */
  // Adds up the supplied counts only. Jobs without a count are reported as missing, never guessed.
  function capacityOn(d) {
    let jobs = 0, total = 0, missing = 0;
    for (const j of JOBS) {
      if (parse(j.start) > d || parse(j.end) < d) continue;
      jobs++;
      if (typeof j.fitters === 'number' && isFinite(j.fitters)) total += j.fitters; else missing++;
    }
    return { jobs, total, missing };
  }
  // Yellow (hue 48) at the bottom, blending to green (hue 130) when full; stays yellow longer, turns green as it fills.
  function battColour(total) {
    const r = Math.min(1, total / CAPACITY), k = Math.pow(r, 1.6);
    return `hsl(${Math.round(48 + k * 82)} ${Math.round(85 - r * 25)}% var(--batt-l))`;
  }
  function capLabel(c) {
    let s = c.jobs === 0 ? `No work booked: 0 of ${CAPACITY} fitters`
      : c.total > CAPACITY ? `Over capacity: ${c.total} of ${CAPACITY} fitters booked`
      : `${c.total} of ${CAPACITY} fitters booked`;
    if (c.missing) s += '. Incomplete: some work that day has no fitter count, so the real total may be higher';
    return s;
  }
  // The battery and the fitter badge. hidden: left out of what a screen reader reads (the day's label says it).
  function battery(c, hidden = true) {
    const over = c.total > CAPACITY, zero = c.jobs === 0;
    const cls = ['cap', zero ? 'zero' : over ? 'over' : '', c.missing ? 'partial' : ''].filter(Boolean).join(' ');
    const pct = zero ? 0 : Math.min(100, (c.total / CAPACITY) * 100);
    const fill = h('i');
    fill.style.width = pct + '%';
    if (!over) fill.style.background = battColour(c.total);
    return h('span', { class: cls, 'aria-hidden': hidden ? 'true' : null },
      h('span', { class: 'row' },
        over ? icon('i-warn', 'warn') : null,
        h('span', { class: 'batt' }, fill, over ? icon('i-warn', 'warn-in') : null)),
      h('span', { class: 'num' }, icon('i-person', 'pi'), String(c.total), h('span', { class: 'of' }, '/' + CAPACITY)));
  }

  /* ---------- state ---------- */
  let JOBS = [];
  const today = startOfDay(new Date());
  const todayIso = iso(today);
  let shown = new Date(today.getFullYear(), today.getMonth(), 1);

  /* ---------- the month ---------- */
  function render() {
    $('#sampleLabel').hidden = !USING_SAMPLE_DATA;
    const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
    const last = new Date(shown.getFullYear(), shown.getMonth() + 1, 0);
    $('#monthLabel').textContent = fmtMonth.format(first);
    const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => h('div', { class: 'dow', role: 'columnheader' }, d));
    const end = addDays(mondayOf(last), 6);
    for (let d = mondayOf(first); d <= end; d = addDays(d, 1)) {
      // Days from the previous or next month: a blank, shaded cell that only holds the weekday columns in place.
      if (d.getMonth() !== first.getMonth()) { cells.push(h('div', { class: 'day out', role: 'gridcell', 'aria-hidden': 'true' })); continue; }
      const we = isWeekend(d), isToday = iso(d) === todayIso;
      const cls = ['day', we ? 'we' : '', isToday ? 'today' : ''].filter(Boolean).join(' ');
      let body = [], label = fmtDay.format(d) + (isToday ? ', today' : '');
      if (we) { body = [h('span', { class: 'we-note' }, 'Weekend')]; label += ', weekend, not counted'; }
      else {
        const c = capacityOn(d);
        body = [battery(c), c.missing ? h('span', { class: 'unk', 'aria-hidden': 'true', title: 'Incomplete total: some work that day has no fitter count' }, '?') : null];
        label += '. ' + capLabel(c);
      }
      cells.push(h('div', { class: cls, role: 'gridcell', 'aria-label': label, title: label }, h('span', { class: 'dn', 'aria-hidden': 'true' }, String(d.getDate())), body));
    }
    $('#cal').replaceChildren(...cells);
  }

  function renderKey() {
    const item = (c, text) => [battery(c, false), h('span', null, text)];
    $('#key-zero').replaceChildren(...item({ jobs: 0, total: 0, missing: 0 }, 'Nothing booked'));
    $('#key-part').replaceChildren(...item({ jobs: 1, total: 12, missing: 0 }, 'Partly booked'));
    $('#key-full').replaceChildren(...item({ jobs: 1, total: CAPACITY, missing: 0 }, 'Full'));
    $('#key-over').replaceChildren(...item({ jobs: 1, total: 27, missing: 0 }, 'Over capacity'));
    $('#key-unk').replaceChildren(h('span', { class: 'unk' }, '?'), h('span', null, 'Incomplete: a fitter count is missing'));
  }

  $('#prev').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() - 1, 1); render(); });
  $('#next').addEventListener('click', () => { shown = new Date(shown.getFullYear(), shown.getMonth() + 1, 1); render(); });
  $('#thisMonth').addEventListener('click', () => { shown = new Date(today.getFullYear(), today.getMonth(), 1); render(); });

  /* ================================================================ the Hub: signed in, and Fitter Capacity is theirs */
  function gate(title, text, o = {}) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
    $('#gate-retry').hidden = !o.retry;
  }
  async function show() {
    renderKey();
    JOBS = await loadJobs();
    render();
    document.body.dataset.view = 'ready';
    $('#view').hidden = false;
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
    if (missingFunction(e)) return gate('Fitter Capacity isn’t ready yet', 'The FLR database doesn’t have the Hub’s apps yet.');
    if (offline(e)) return gate('Can’t reach the FLR database', 'Check your connection and try again.', { retry: true });
    return gate('Fitter Capacity didn’t load', 'Something went wrong checking your access. Try again in a moment.', { retry: true });
  }
  // hub_home() lists only the tiles this account may use (and refuses a switched-off account).
  async function check() {
    try {
      const { data, error } = await client().rpc('hub_home');
      if (error) return failGate(error);
      if (data && data.waiting) return gate('Your account is waiting for a Super Admin', 'An FLR Super Admin needs to check who you are before you can use the Hub’s apps.');
      const tiles = (data && Array.isArray(data.tiles)) ? data.tiles : [];
      if (!tiles.some(t => t && t.id === TILE)) return gate('You don’t have access to Fitter Capacity', 'It’s switched on for the FLR staff who need it. If you think you should have it, ask an FLR Super Admin.');
      await show();
    } catch (e) { failGate(e); }
  }
  $('#gate-retry').addEventListener('click', () => { document.body.dataset.view = 'loading'; $('#gate-message').hidden = true; check(); });

  async function boot() {
    const c = client();
    if (!c) return gate('Fitter Capacity isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) return location.replace(SIGN_IN);
    await check();
  }
  boot();
})();
