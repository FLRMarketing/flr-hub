/* ============================================================================
   FLR Order Tracker: what's arriving, when it's expected, and whether it has
   all arrived. This page is public; it holds nothing. It reads
   public.orders_board(), which only answers active accounts on the 'orders'
   Hub tile's list, from what the flr-orders function last read on the Monday
   "FLR - Goods In" board (20261012200000_flr_order_tracker.sql). Read-only:
   nothing here changes Monday. "Today" is always the day in Europe/London.

   It shows only what the board records: the order reference, the delivery
   date (and its moves), and what has been received. No supplier confirmation,
   dispatch, tracking or arrival estimate: the board doesn't have them.
   The rules (delayed, date moved, overdue, part received) are in rules.js.

   Screens: Today (due today, with a "Needs attention" strip for late orders),
   Coming up, Received. A tapped order opens on its own on a phone, and beside
   the list on a wide screen.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const R = window.FLR_ORDER_RULES;
  const AUTH_KEY = 'flr-estimator-auth';            // the one FLR sign-in for the whole site
  const SIGN_IN = '../?next=orders';
  const TZ = 'Europe/London';
  const POLL_MS = 60 * 1000;                        // the page asks the database every minute; Monday is read every 5
  const STALE_MIN = 20;                             // older than this with no reason given: say it may be out of date
  const ATTN_SHOWN = 3;                             // late orders shown before "Show all"
  const $ = (s, r = document) => r.querySelector(s);
  const wide = matchMedia('(min-width: 960px)');

  /* ---------------------------------------------------------------- building the page (text only: nothing is parsed as HTML) */
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, String(v));
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== '') n.append(k instanceof Node ? k : String(k));
    return n;
  }
  function icon(id, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u);
    return s;
  }

  /* ---------------------------------------------------------------- dates, always in Europe/London */
  const londonDay = d => R.londonDay(d);
  const daysBetween = R.daysBetween;
  const asDay = (day, o) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  const dayShort = day => asDay(day, { weekday: 'short', day: 'numeric', month: 'short' });
  const dayLong = day => asDay(day, { weekday: 'long', day: 'numeric', month: 'long' });
  const clock = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  function relDay(day, today) {
    const n = daysBetween(today, day);
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : dayShort(day);
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function when(iso, today) {             // "14:36", "Yesterday, 14:36", "Fri 9 Oct, 14:36"
    if (!iso) return '';
    const d = londonDay(new Date(iso));
    return d === today ? clock(iso) : `${cap(relDay(d, today))}, ${clock(iso)}`;
  }
  const timed = o => !!(o.at && o.day && londonDay(new Date(o.at)) === o.day);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

  /* ---------------------------------------------------------------- materials: a readable name, and a picture by kind */
  const KEEP = new Set(['LVT', 'CFS', 'ETR', 'UNV', 'ADH', 'C&F', 'PVC', 'UK']);
  const KINDS = [
    [/ADHESIVE|\bADH\b|ARDEX|FEATHER|LEVEL IT|COMPOUND|KE2000|UZIN|CONTACT|CANISTER|PRIMER|SMOOTHING|\bA45\b|\bNA X|\b\d+(\.\d+)?L\b/, 'tub'],
    [/TROWEL|BLADE/, 'tool'],
    [/TRIM|NOSING|CAPPING|COVING|RAMPED|EDGE|WELD ROD|STRIP|PROFILE|\bADM\d|\bT450\b/, 'trim'],
    [/TAPE|GAFFER|FLOORGUARD|\bPROT\b|PROTECTION/, 'tape'],
    [/MATTING|\bMATS?\b/, 'mat'],
    [/TILE|SUPACORD/, 'tile'],
    [/ALTRO|TARKETT|SAFETRED|POLYSAFE|TARASAFE|HIPPO|AQUARIUS|WALKWAY|ISAFE|SHEET|VINYL|SAFETY FLOOR|PENDANT|ZENITH/, 'roll'],
    [/LVT|PLANK|WOOD|OAK|AMTICO/, 'plank'],
    [/CARPET|UNDERLAY|CLOUD|SOUND CHOICE|RUBBER|SPORTS/, 'roll'],
  ];
  const kindOf = raw => (KINDS.find(([re]) => re.test(String(raw).toUpperCase())) || [null, 'box'])[1];
  // "ALTRO WALKWAY BLACK 64M2" → "Altro Walkway Black", "64 m²". A name it can't split stays whole.
  function product(name) {
    const raw = String(name || '').trim();
    const m = /\s+(X\s?\d+(?:\.\d+)?(?:\s?(?:M2|LM|KG|L|M))?|\d+(?:\.\d+)?\s?(?:M2|LM|KG|L|M))$/i.exec(raw);
    const base = m && m.index > 0 ? raw.slice(0, m.index) : raw;
    const qty = m && m.index > 0 ? m[1].replace(/^X\s?/i, '× ').replace(/M2$/i, ' m²').replace(/LM$/i, ' lin m').replace(/KG$/i, ' kg').replace(/(\d)L$/i, '$1 L') : '';
    const title = base.split(/\s+/).map(w => (/\d/.test(w) || KEEP.has(w.toUpperCase()) || (w.length <= 3 && !/[AEIOU]/i.test(w) && w !== '&')) ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return { title: title || 'Product', qty, kind: kindOf(raw) };
  }
  // What the delivery is called: its first product still to come (or its first product), and how many more.
  function titleOf(o, s) {
    const lines = o.items || [];
    if (!lines.length) return { title: 'Delivery', more: 0, kind: 'box' };
    const lead = (s && s.partial && s.outstanding.length ? s.outstanding : lines)[0];
    const p = product(lead.name);
    return { title: p.title, more: lines.length - 1, kind: p.kind };
  }
  const thumb = (kind, cls) => h('span', { class: `thumb ${cls || ''}`, 'aria-hidden': 'true' }, icon('m-' + kind));

  /* ---------------------------------------------------------------- what to say about an order (rules.js decides the state) */
  const status = R.status;
  // "Delivered" only once receipt is recorded; until then it's where the delivery is going.
  const DEST = { Warehouse: ['i-warehouse', 'Delivery to FLR warehouse', 'Delivered to FLR warehouse'], Site: ['i-site', 'Delivery to site', 'Delivered to site'],
    Collection: ['i-collect', 'For collection', 'Collected'] };
  const destText = (o, s) => { const d = DEST[o.destination]; return d ? d[s && s.kind === 'received' ? 2 : 1] : o.destination || 'Destination not set'; };
  const destIcon = o => (DEST[o.destination] || ['i-warehouse'])[0];
  const PROBLEM = { 'Item missing': 'item missing', 'Wrong colour': 'wrong colour', 'Wrong quantity': 'wrong quantity', Damaged: 'damage reported', 'Wrong location': 'wrong location' };
  const problems = o => (o.issues || []).map(i => PROBLEM[i] || i.toLowerCase());
  const stillToCome = s => s.outstanding.length ? `${plural(s.outstanding.length, 'item')} still to arrive` : 'Item missing reported';

  // The list's label, only for an exception: [tone, text] or null.
  function badge(o, s) {
    if (s.kind === 'received') return problems(o).length ? ['warn', cap(problems(o)[0])] : null;
    if (s.partial) return ['warn', 'Part received'];
    if (s.kind === 'overdue') return ['bad', 'Overdue'];
    if (s.delay === 'active') return ['warn', 'Delayed'];
    return null;
  }
  // The order's current status in one line, saying each fact once: [tone, text, exception?]
  function statusLine(o, s) {
    if (s.kind === 'received') return problems(o).length ? ['warn', `Received · ${problems(o).join(', ')}`, true] : ['good', 'Everything received', false];
    if (s.partial) return [s.kind === 'overdue' ? 'bad' : 'warn', [`Part received · ${stillToCome(s)}`, ...problems(o).filter(p => p !== 'item missing')].join(' · '), true];
    if (s.kind === 'overdue') return ['bad', 'Overdue · no new delivery date yet', true];
    if (s.delay === 'active') return ['warn', `Delayed · first due ${dayLong(o.firstDay)}`, true];
    if (s.delay === 'moved') return ['calm', `Date moved from ${dayLong(o.firstDay)} · not late`, true];
    if (s.kind === 'nodate') return ['calm', 'Awaiting a delivery date', false];
    return ['calm', 'Awaiting delivery', false];
  }
  // The arrival, as large text and a line under it: never more precise than Monday.
  // { label, big, small }: the label says what the big time or date is. A time is only ever the one set on Monday or
  // the recorded receipt, never an estimate; "Received" only with Received ticked (and nothing outstanding).
  function arrival(o, s, today) {
    if (s.kind === 'received') {
      if (!o.receivedAt) return { label: 'Ticked as received', big: 'Received', small: 'Time not recorded' };
      const d = londonDay(new Date(o.receivedAt));
      return { label: d === today ? 'Received today at' : `Received on ${dayShort(d)} at`, big: clock(o.receivedAt), small: null };
    }
    if (s.kind === 'nodate') return { label: null, big: 'No date yet', small: 'Awaiting a delivery date' };
    if (s.kind === 'overdue') return { label: 'Was due', big: dayLong(o.day), small: null, date: true };
    if (s.kind === 'today') return timed(o) ? { label: 'Expected today at', big: clock(o.at), small: null } : { label: null, big: 'Due today', small: 'Time not confirmed' };
    return { label: 'Expected arrival', big: dayLong(o.day), small: timed(o) ? `at ${clock(o.at)}` : 'Time not confirmed', date: true };
  }
  /* ---------------------------------------------------------------- state and routes: #/today, #/upcoming, #/received, each with /<order id> */
  const S = { data: null, gotAt: 0, err: null, busy: false, again: false, timer: 0, surveyors: null, photos: {}, answers: { replies: {}, seenAt: null }, tab: 'today', id: null, attnAll: false, scroll: {}, saving: new Map() };
  const TABS = [['today', 'Today', 'i-today'], ['upcoming', 'Coming up', 'i-calendar'], ['received', 'Received', 'i-inbox']];
  function parseRoute() {
    const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (p[0] === 'order' && p[1]) return { tab: 'today', id: decodeURIComponent(p[1]) };   // links from earlier versions
    const tab = TABS.some(t => t[0] === p[0]) ? p[0] : 'today';
    return { tab, id: p[1] ? decodeURIComponent(p[1]) : null };
  }
  const href = (tab, id) => `#/${tab}${id ? '/' + encodeURIComponent(id) : ''}`;

  /* ---------------------------------------------------------------- page furniture */
  function gate(title, text, o = {}) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#tabs').hidden = true; $('#gate').hidden = false; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
    $('#gate-retry').hidden = !o.retry;
    document.documentElement.style.setProperty('--tabbar-h', '0px');
  }
  let toastTimer = 0;
  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* ---------------------------------------------------------------- the orders as shown: Monday's, plus Hub receipts Monday hasn't caught up with */
  let shownCache = null, shownFor = null;
  function shown() {
    if (shownFor !== S.data) { shownCache = R.applyReceipts(S.data.orders, S.data.receipts || [], S.data.readAt, S.data.hub); shownFor = S.data; }
    return shownCache;
  }
  const findOrder = id => shown().find(o => o.id === id);

  /* ---------------------------------------------------------------- jobs: the tracker lists jobs, not products */
  // A job is Monday's WFM Number: the WorkflowMax job. Checked in WorkflowMax on 14 Oct 2026, these are one job each,
  // typed more than one way on Monday: 72967 (GLJ UNIT 1 HEMEL, UNIT 1 HORIZON), 73106 (107 LAKER ROAD, GLJ 107 LAKER RD)
  // and 73299 (THOMAS BULLOCK SCHOOL, THOMAS BULLOCK). Its orders keep their own reference, destination and date.
  // Except FLR's catch-all stock job, which many separate requests share: there each Monday name is its own card
  // (STOCK LP, JW LINDS, STOCK ST, Stock GL stay apart). Add next year's stock WFM number here when it's opened.
  // An order with no WFM Number is a job on its own: names alone never combine orders.
  const STOCK_WFM = new Set(['72508']);   // FLR - STOCK APR 2026 (1 Apr 2026 to 31 Mar 2027)
  const nameKey = n => String(n || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const jobKey = o => !o.wfm ? 'o' + o.id : STOCK_WFM.has(o.wfm) ? `s${o.wfm}-${nameKey(o.job)}` : 'w' + o.wfm;
  let jobsCache = null, jobsFor = null;
  function jobs() {
    const all = shown();
    if (jobsFor === all) return jobsCache;
    const m = new Map();
    for (const o of all) { const k = jobKey(o); if (!m.has(k)) m.set(k, { key: k, wfm: o.wfm || null, stock: STOCK_WFM.has(o.wfm), orders: [] }); m.get(k).orders.push(o); }
    for (const j of m.values()) {
      const n = new Map(); for (const o of j.orders) n.set(o.job, (n.get(o.job) || 0) + 1);
      j.names = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
      j.name = j.names[0];
    }
    jobsCache = m; jobsFor = all;
    return m;
  }
  // The job's surveyor(s): flr-orders gives each order the short capital words of its WFM number's Work Programme jobs
  // (surveyorCodes, one list per job); the last known code in each is the surveyor (orders_surveyors, 1.7), so a client
  // called "DH Scriven" doesn't count. Usually one person; none when the code isn't known or there's no Work Programme job.
  function surveyorsOf(job) {
    if (!S.surveyors) return [];
    const out = new Map();
    for (const o of job.orders) for (const codes of o.surveyorCodes || []) {
      const c = [...codes].reverse().find(x => S.surveyors[x]);
      if (c && !out.has(c)) out.set(c, { code: c, ...S.surveyors[c] });
    }
    return [...out.values()];
  }
  const initials = n => String(n || '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  // A photo (Annual Leave's, when it has one) or their initials.
  const face = (p, cls) => p.photo ? h('img', { class: `sv-face ${cls}`, src: p.photo, alt: '', width: '40', height: '40', decoding: 'async' })
    : h('span', { class: `sv-face sv-initials ${cls}`, 'aria-hidden': 'true' }, initials(p.name));
  // The fitters on the job (1.8): flr-orders gives each order its Work Programme job's visits (dates and fitters).
  // Shown: the visits from today on (each fitter once, with their first dates); with none to come, the last visit.
  function fittersOf(job, today) {
    const seen = new Map();
    for (const o of job.orders) for (const v of o.visits || []) { const k = `${v.from}|${v.to}|${v.fitters.join(',')}`; if (!seen.has(k)) seen.set(k, v); }
    const all = [...seen.values()].sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
    if (!all.length) return { people: [], last: false };
    const coming = all.filter(v => v.to >= today), use = coming.length ? coming : [all[all.length - 1]];
    const people = new Map();
    for (const v of use) for (const n of v.fitters) if (!people.has(n)) people.set(n, { name: n, from: v.from, to: v.to, photo: S.photos[n] || null });
    return { people: [...people.values()], last: !coming.length };
  }
  const visitWhen = (p, today, last) => {
    const span = p.from === p.to ? dayShort(p.from) : `${dayShort(p.from)} – ${dayShort(p.to)}`;
    if (last) return `Last visit ${span}`;
    if (p.from <= today) return p.to === today ? 'Today' : `On site until ${dayShort(p.to)}`;
    return span;
  };
  const findJob = key => key ? (jobs().get(key) || (findOrder(key) ? jobs().get(jobKey(findOrder(key))) : null)) : null;   // also old links to an order
  // The materials of an order as the checklist shows them; an order with no products listed is one line, the delivery.
  const linesOf = o => (o.items || []).length ? o.items : [{ id: 'order', name: 'The whole delivery', whole: true, received: !!o.received, receivedAt: o.receivedAt, issues: o.issues || [] }];

  /* ---------------------------------------------------------------- grouped by where they're going (Monday's Delivery Location) */
  // Monday records Warehouse, Site or Collection; for a site delivery the site is the job.
  function destKey(o) {
    if (o.destination === 'Warehouse') return ['0', 'FLR warehouse', 'i-warehouse', null];
    if (o.destination === 'Site') return ['1', 'To site', 'i-site', null];
    if (o.destination === 'Collection') return ['2', 'For collection', 'i-collect', null];
    return ['3', 'Destination not confirmed', 'i-alert', null];
  }
  // One card per job: the orders of a job in this list (and destination) together, in the order they came.
  function byJob(items) {
    const m = new Map();
    for (const x of items) { const k = jobKey(x.o); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return [...m.entries()].map(([k, xs]) => ({ job: jobs().get(k), xs }));
  }
  // The number of cards a list shows: one per job in each destination group (Received has no destination groups).
  const jobCount = (items, byDest = true) => new Set(items.map(x => (byDest ? destKey(x.o)[0] + '|' : '') + jobKey(x.o))).size;
  function grouped(items, today, o) {
    const groups = new Map();
    for (const x of items) { const k = destKey(x.o); if (!groups.has(k[0])) groups.set(k[0], { k, items: [] }); groups.get(k[0]).items.push(x); }
    return [...groups.values()].sort((a, b) => a.k[0].localeCompare(b.k[0])).map(({ k, items: xs }) =>
      h('div', { class: 'dest' },
        h('h3', { class: 'dest-head' }, icon(k[2]), h('span', { class: 'dest-name' }, k[1]), k[3] ? h('span', { class: 'dest-kind' }, k[3]) : null, h('span', { class: 'dest-n' }, String(jobCount(xs)))),
        list(xs, today, o)));
  }

  /* ---------------------------------------------------------------- sorting orders into the screens */
  function sorted(today) {
    const all = shown().map(o => ({ o, s: status(o, today) })).map(x => ({ ...x, b: R.bucket(x.o, x.s, today) }));
    const byTime = (x, y) => (x.o.at || '9').localeCompare(y.o.at || '9') || x.o.job.localeCompare(y.o.job);
    const pick = k => all.filter(x => x.b === k);
    return {
      due: pick('dueToday').sort(byTime),
      late: pick('late').sort((x, y) => Number(y.o.day < today) - Number(x.o.day < today) || x.o.day.localeCompare(y.o.day)),
      upcoming: pick('upcoming').sort((x, y) => x.o.day.localeCompare(y.o.day) || byTime(x, y)),
      nodate: pick('nodate'),
      gotToday: pick('receivedToday').sort((x, y) => (y.o.receivedAt || '').localeCompare(x.o.receivedAt || '')),
      gotEarlier: pick('receivedEarlier').sort((x, y) => (y.s.recDay || '').localeCompare(x.s.recDay || '') || (y.o.receivedAt || '').localeCompare(x.o.receivedAt || '')),
    };
  }

  /* ---------------------------------------------------------------- the header, the connection notices, the tabs */
  const sinceText = (iso, today) => { const w = when(iso, today); return w.includes(',') ? `on ${w}` : `at ${w}`; };
  function updated(today) {
    const d = S.data;
    if (!d.readAt) return h('span', { class: 'upd' }, 'Not read yet');
    const stale = !d.failing && Date.now() - Date.parse(d.readAt) > STALE_MIN * 60000;
    return h('span', { class: `upd${stale || d.failing ? ' upd-stale' : ''}` }, `Updated ${when(d.readAt, today)}`);
  }
  function header(title, sub, counts, today) {
    return h('header', { class: 'head' },
      h('div', { class: 'head-bar' },
        h('a', { class: 'brand', href: '../', 'aria-label': 'Back to the FLR Hub' }, icon('i-back', 'brand-back'), icon('flr-mark', 'brand-mark'), h('span', { class: 'brand-word' }, 'Hub')),
        h('div', { class: 'head-tools' }, updated(today),
          h('button', { class: 'round only-wide has-dot', type: 'button', 'aria-label': problemLabel(), title: 'Have a problem?', onclick: () => { const j = findJob(S.id); openProblem(j ? j.orders[0].id : null); } }, icon('i-help'), problemDot()),
          h('button', { class: 'round', type: 'button', id: 'refresh', 'aria-label': 'Check for updates now', title: 'Check for updates now', onclick: () => refresh(true) }, icon('i-refresh')))),
      h('div', { class: 'head-titles' }, h('h1', { class: 'head-title' }, title), sub ? h('p', { class: 'head-sub' }, sub) : null),
      h('nav', { class: 'seg', 'aria-label': 'Deliveries' }, TABS.map(([k, label]) =>
        h('a', { class: 'seg-item', href: href(k), 'aria-current': S.tab === k ? 'page' : null }, label, counts[k] ? h('span', { class: 'seg-n' }, String(counts[k])) : null))));
  }
  function notices(today) {
    const d = S.data, out = [];
    if (S.err) out.push(h('p', { class: 'notice notice-bad', role: 'status' }, icon('i-alert'),
      h('span', null, h('b', null, 'Couldn’t refresh. '), d.readAt ? `Showing deliveries as updated ${sinceText(d.readAt, today)}.` : 'Showing the deliveries already loaded.'),
      h('button', { class: 'notice-act', type: 'button', onclick: () => refresh(true) }, 'Retry')));
    if (d.failing) out.push(h('p', { class: 'notice notice-warn', role: 'status' }, icon('i-alert'),
      h('span', null, h('b', null, d.failingSince ? `monday.com hasn’t answered since ${when(d.failingSince, today)}` : 'monday.com isn’t answering'), '. ',
        d.readAt ? `Showing what it said ${sinceText(d.readAt, today)}.` : 'Nothing read yet.')));
    else if (d.readAt && Date.now() - Date.parse(d.readAt) > STALE_MIN * 60000) out.push(h('p', { class: 'notice notice-warn', role: 'status' }, icon('i-alert'),
      h('span', null, h('b', null, 'May be out of date. '), `Last read from monday.com ${sinceText(d.readAt, today)}.`)));
    return out.length ? h('div', { class: 'notices' }, out) : null;
  }
  // "Have a problem?" lives in the tab bar on phones, in the order's own bar, and next to Check for updates on wide
  // screens. It messages Georgia and Luke (openProblem, below).
  function tabbar(counts) {
    $('#tabs').replaceChildren(...TABS.map(([k, label, ic]) => h('a', { class: 'tab', href: href(k), 'aria-current': S.tab === k ? 'page' : null },
      h('span', { class: 'tab-ic' }, icon(ic), counts[k] ? h('span', { class: 'tab-n' }, String(counts[k])) : null), h('span', { class: 'tab-label' }, label))),
      h('button', { class: 'tab tab-problem has-dot', type: 'button', 'aria-label': problemLabel(), onclick: () => openProblem(null) }, h('span', { class: 'tab-ic' }, icon('i-help'), problemDot()), h('span', { class: 'tab-label' }, 'Have a problem?')));
  }

  /* ---------------------------------------------------------------- one job in a list */
  // The job's name; under it its materials in this list and how many are in; on the right a recorded time (or, for
  // late orders, the day they were or are now due); a label only for an exception (the worst of its orders).
  const RANK = { bad: 3, warn: 2 };
  function row({ job, xs }, today, o = {}) {
    const mats = xs.flatMap(x => linesOf(x.o)), got = mats.filter(i => i.received).length;
    const names = mats.map(i => i.whole ? 'Delivery' : product(i.name).title);
    const b = xs.map(x => badge(x.o, x.s)).filter(Boolean).sort((p, q) => (RANK[q[0]] || 0) - (RANK[p[0]] || 0))[0] || null;
    const lead = xs[0];
    let when = '';
    const late = o.late ? `${lead.s.kind === 'overdue' ? 'Was due' : 'Now due'} ${dayShort(lead.o.day)}` : '';
    if (lead.s.kind === 'received') when = lead.o.receivedAt ? clock(lead.o.receivedAt) : '';
    else if (!o.late && timed(lead.o)) when = clock(lead.o.at);
    const what = `${names.slice(0, 2).join(', ')}${names.length > 2 ? ` +${names.length - 2}` : ''}`;
    const count = got && got < mats.length ? `${got} of ${mats.length} in` : plural(mats.length, 'material');
    const label = [job.name, what, count, xs.length > 1 ? plural(xs.length, 'order') : '', late, b && b[1], when && `${lead.s.kind === 'received' ? 'received' : 'expected'} ${when}`].filter(Boolean).join('. ');
    const svLabel = () => (sv.length ? `. Surveyor ${sv.map(p => p.name).join(' and ')}` : '') +
      (ft.people.length ? `. ${ft.last ? 'Last fitters' : 'Fitters'} ${ft.people.map(p => p.name).join(', ')}` : '');
    const kind = (mats.find(i => !i.received) || mats[0]);
    const sv = surveyorsOf(job), ft = fittersOf(job, today);
    return h('li', null, h('a', { class: 'row', href: href(S.tab, job.key), 'aria-current': S.id === job.key ? 'true' : null, 'aria-label': label + svLabel() },
      thumb(kind && !kind.whole ? product(kind.name).kind : 'box', 'thumb-sm'),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, job.name),
        h('span', { class: 'row-job' }, what, h('span', { class: 'row-count' }, ` · ${count}${xs.length > 1 ? ` · ${plural(xs.length, 'order')}` : ''}`)),
        late ? h('span', { class: 'row-late' }, late) : null,
        sv.length || ft.people.length ? h('span', { class: 'row-sv', 'aria-hidden': 'true' },
          sv.length ? h('span', { class: 'row-person' }, sv.map(p => face(p, 'sv-sm')), h('span', { class: 'row-person-name' }, sv.map(p => p.name).join(', '))) : null,
          ft.people.length ? h('span', { class: `row-person row-fitters${ft.last ? ' row-fitters-last' : ''}` }, h('span', { class: 'sv-stack' }, ft.people.slice(0, 3).map(p => face(p, 'sv-sm'))),
            h('span', { class: 'row-person-name' }, ft.people.length === 1 ? ft.people[0].name : `${ft.people[0].name} +${ft.people.length - 1}`)) : null) : null,
        b ? h('span', { class: `pill pill-${b[0]} pill-in`, 'aria-hidden': 'true' }, b[1]) : null),
      h('span', { class: 'row-end' },
        b ? h('span', { class: `pill pill-${b[0]} pill-out`, 'aria-hidden': 'true' }, b[1]) : null,
        when ? h('span', { class: 'row-when' }, when) : null)));
  }
  const list = (items, today, o) => h('ul', { class: 'rows' }, byJob(items).map(x => row(x, today, o)));
  // Said once, beside the heading, when some rows have no time.
  const timeNote = items => items.some(x => !timed(x.o)) ? h('p', { class: 'block-note' }, items.some(x => timed(x.o)) ? 'Times show only where monday.com has one; the rest aren’t confirmed.' : 'Arrival times aren’t confirmed.') : null;
  const empty = (title, text) => h('div', { class: 'empty' }, thumb('box', 'thumb-lg'), h('p', { class: 'empty-title' }, title), text ? h('p', { class: 'empty-text' }, text) : null);

  /* ---------------------------------------------------------------- the three screens */
  function todayScreen(g, today) {
    const late = g.late, firstJobs = [...new Set(late.map(x => jobKey(x.o)))].slice(0, ATTN_SHOWN);
    const shown = S.attnAll ? late : late.filter(x => firstJobs.includes(jobKey(x.o)));
    return [
      late.length ? h('section', { class: 'block attn', 'aria-labelledby': 'attn-title' },
        h('h2', { class: 'block-title attn-title', id: 'attn-title' }, h('span', { class: 'attn-dot', 'aria-hidden': 'true' }), 'Needs attention', h('span', { class: 'block-n' }, String(jobCount(late)))),
        grouped(shown, today, { late: true }),
        jobCount(late) > ATTN_SHOWN ? h('button', { class: 'more-btn', type: 'button', 'aria-expanded': S.attnAll ? 'true' : 'false',
          onclick: () => { S.attnAll = !S.attnAll; render(); } }, S.attnAll ? 'Show fewer' : `Show all ${jobCount(late)}`) : null) : null,
      h('section', { class: 'block', 'aria-labelledby': 'due-title' },
        h('h2', { class: 'block-title', id: 'due-title' }, 'Still to arrive', g.due.length ? h('span', { class: 'block-n' }, String(jobCount(g.due))) : null),
        g.due.length ? [timeNote(g.due), grouped(g.due, today, {})] : empty(g.gotToday.length ? 'Everything due today is in' : 'Nothing due today')),
      g.gotToday.length ? h('a', { class: 'got-link', href: href('received') }, icon('i-check', 'got-ic'),
        h('span', null, `${plural(jobCount(g.gotToday, false), 'job')} with deliveries received today`), icon('i-chevron', 'got-chev')) : null,
    ];
  }
  function upcomingScreen(g, today) {
    const days = [...new Set(g.upcoming.map(x => x.o.day))];
    if (!days.length && !g.nodate.length) return [empty('Nothing booked in after today')];
    return [
      timeNote(g.upcoming),
      days.map(d => h('section', { class: 'block' }, h('h2', { class: 'block-title' }, daysBetween(today, d) === 1 ? 'Tomorrow' : dayLong(d)),
        grouped(g.upcoming.filter(x => x.o.day === d), today, { upcoming: true }))),
      g.nodate.length ? h('section', { class: 'block' }, h('h2', { class: 'block-title' }, 'No date yet'), grouped(g.nodate, today, { upcoming: true })) : null,
    ];
  }
  function receivedScreen(g, today) {
    const earlier = [...new Set(g.gotEarlier.map(x => x.s.recDay || ''))];
    if (!g.gotToday.length && !earlier.length) return [empty('Nothing received yet')];
    return [
      h('section', { class: 'block' }, h('h2', { class: 'block-title' }, 'Today'), g.gotToday.length ? list(g.gotToday, today, {}) : empty('Nothing received yet today')),
      earlier.map(d => h('section', { class: 'block' }, h('h2', { class: 'block-title' }, d ? (daysBetween(d, today) === 1 ? 'Yesterday' : dayLong(d)) : 'Date not recorded'),
        list(g.gotEarlier.filter(x => (x.s.recDay || '') === d), today, {}))),
    ];
  }

  /* ---------------------------------------------------------------- one order */
  const note = (u, today) => u ? h('p', { class: 'note' }, h('span', { class: 'note-quote' }, `“${u.text}”`), h('span', { class: 'note-by' }, [u.by, u.at ? when(u.at, today) : ''].filter(Boolean).join(' · '))) : null;
  function matRows(items, today, showGot) {
    return h('ul', { class: 'mats' }, items.map(i => {
      const p = product(i.name), probs = (i.issues || []).map(x => PROBLEM[x] || x.toLowerCase());
      return h('li', { class: 'mat' }, thumb(p.kind, 'thumb-xs'),
        h('span', { class: 'mat-main' }, h('span', { class: 'mat-name' }, p.title), p.qty ? h('span', { class: 'mat-qty' }, p.qty) : null,
          probs.length ? h('span', { class: 'mat-bad' }, cap(probs.join(', '))) : null),
        showGot && i.received ? h('span', { class: 'mat-got' }, icon('i-check'), i.receivedAt ? clock(i.receivedAt) : '', h('span', { class: 'sr' }, ' received')) : null);
    }));
  }
  const fold = (title, n, body) => h('details', { class: 'fold' }, h('summary', null, title, n != null ? h('span', { class: 'fold-n' }, String(n)) : null, icon('i-down', 'fold-ic')), body);
  // What monday.com recorded, newest first: the reference, date moves, receipt and the older updates.
  // Notes, newest first: the receiver's own note from the Hub, and Monday updates (not the ones the Hub posted itself,
  // which repeat its receipts).
  const HUB_UPDATE = /^(Delivery record(ed on| corrected on)|Ticked as arrived on) the FLR Hub by /;
  // For Admins and Super Admins the problems sent from the Hub have their own section, so their monday.com copy isn't repeated as a note.
  const HUB_PROBLEM = /^Problem reported on the FLR Hub by /;
  const hubPosted = u => HUB_UPDATE.test(u.text || '') || (!!(S.data && S.data.seesAllProblems) && HUB_PROBLEM.test(u.text || ''));
  const notesOf = o => [...(o.updates || []).filter(u => !hubPosted(u)),
    ...(o.hubNotes || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const condWord = c => c === 'good' ? 'good' : c === 'Wrong location' ? 'wrong place' : String(c).toLowerCase();
  // A receipt as it was recorded, and a correction: who, why and what changed. The receipt's own entry never changes.
  const isTick = r => (r.kind === 'receipt' || !r.kind) && (r.lines || []).every(l => l.condition === 'arrived');
  const isUndo = r => r.kind === 'correction' && /^Ticked by mistake/.test(r.reason || '') && (r.lines || []).every(l => l.to === 'outstanding');
  const mname = l => l.id === 'order' ? 'the whole delivery' : product(l.name).title;
  function hubEvent(r) {
    if (isTick(r)) return `Ticked as arrived by ${r.by}: ${r.lines.map(mname).join(', ')}`;
    if (isUndo(r)) return `Tick undone by ${r.by}: ${r.lines.map(mname).join(', ')} back to still to arrive`;
    if (r.kind === 'untick') return `Unticked by ${r.by}: ${r.lines.map(mname).join(', ')} (it had been ticked on monday.com) back to still to arrive`;
    if (r.kind !== 'correction') return `Recorded on the Hub by ${r.by}: ${r.lines.map(l => `${product(l.name).title}${l.condition === 'good' ? '' : ` (${condWord(l.condition)})`}`).join(', ')} arrived${r.remaining.length ? `; ${plural(r.remaining.length, 'item')} still to come` : ''}${r.note ? `. “${r.note}”` : ''}`;
    const what = r.lines.map(l => l.to === 'outstanding' ? `${product(l.name).title} back to still to arrive` : `${product(l.name).title} ${condWord(l.from)} → ${condWord(l.to)}`);
    if (r.noteChanged) what.push(r.note ? `note now “${r.note}”` : 'note removed');
    return `Receipt corrected by ${r.by}: ${what.join('; ')}. Reason: “${r.reason}”`;
  }
  function history(o, s, today, shownNote) {
    const ev = [];
    for (const m of o.moves || []) ev.push([m.at, `Delivery date moved from ${dayShort(m.from)} to ${dayShort(m.to)}`]);
    if (o.receivedAt) ev.push([o.receivedAt, s.partial ? 'Ticked as received, with items still to arrive' : 'Received']);
    for (const u of o.updates || []) if (!hubPosted(u) && !(shownNote && u.text === shownNote.text && u.at === shownNote.at)) ev.push([u.at, `“${u.text}”${u.by ? ` · ${u.by}` : ''}`]);
    for (const r of o.hubReceipts || []) ev.push([r.at, hubEvent(r), r.kind === 'correction' ? 'hist-fix' : null]);
    ev.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    const fixed = [o.day ? ['', `Delivery date on monday.com: ${dayLong(o.day)}${timed(o) ? `, ${clock(o.at)}` : ''}`] : null,
      o.ref ? ['', `Order reference recorded: ${o.ref}`] : ['', 'No order reference recorded yet']].filter(Boolean);
    return fold('History', null, h('ul', { class: 'hist' }, [...ev, ...fixed].map(([at, text, cls]) =>
      h('li', cls ? { class: cls } : null, h('span', { class: 'hist-when' }, at ? when(at, today) : 'Recorded'), h('span', { class: 'hist-text' }, text)))));
  }
  // One material in the checklist: a big tick box that ticks and unticks. Ticked on the Hub: who and when; tapping it
  // again undoes the tick. Ticked on monday.com: when; tapping it unticks it (on monday.com too). A condition an earlier
  // receipt recorded still shows.
  function tickRow(o, i, today) {
    const k = `${o.id}:${i.id}`, busy = S.saving.get(k);
    const x = o.hubState && o.hubState.lines ? o.hubState.lines[i.id] : null;
    const r = x && x.received && x.receipt ? (o.hubReceipts || []).find(e => e.id === x.receipt) : null;
    const on = busy === 'tick' ? true : busy === 'undo' ? false : !!i.received;
    const p = i.whole ? { title: 'The whole delivery', qty: 'No materials listed on monday.com', kind: 'box' } : product(i.name);
    const probs = (i.issues || []).map(v => PROBLEM[v] || v.toLowerCase());
    const sync = r && r.state !== 'sent' ? (r.state === 'failed' ? ' · not on monday.com yet, it will try again' : ' · saving to monday.com…') : '';
    const who = busy === 'tick' ? 'Saving…' : busy === 'undo' ? 'Undoing…'
      : r ? `Ticked by ${r.by === S.data.you ? 'you' : r.by}, ${when(r.at, today)}${sync}`
      : i.received ? `Received${i.receivedAt ? `, ${when(i.receivedAt, today)}` : ''} · ticked on monday.com` : '';
    const press = () => on ? (r ? untick(o, i, r) : untickMonday(o, i)) : tick(o, i);
    const label = `${p.title}${p.qty && !i.whole ? ', ' + p.qty : ''}`;
    return h('li', { class: `tick${on ? ' on' : ''}${busy ? ' busy' : ''}` },
      h('button', { type: 'button', class: 'tick-box', role: 'checkbox', 'aria-checked': on ? 'true' : 'false', disabled: !!busy,
        'aria-label': `${label}: ${on ? 'arrived. Tap to untick' : 'still to arrive. Tap to tick'}`, onclick: press },
        h('span', { class: 'tick-mark', 'aria-hidden': 'true' }, on ? icon('i-check') : null)),
      h('span', { class: 'tick-main' },
        h('span', { class: 'tick-name' }, p.title), p.qty ? h('span', { class: 'tick-qty' }, p.qty) : null,
        probs.length ? h('span', { class: 'mat-bad' }, cap(probs.join(', '))) : null,
        who ? h('span', { class: 'tick-who' }, who) : null));
  }
  // One order of the job: its reference, destination and date, its checklist, the help line, its details and history.
  function orderBlock(o, today, solo) {
    const s = status(o, today), [tone, line, exception] = statusLine(o, s);
    const latest = exception ? notesOf(o)[0] || null : null;
    const lines = linesOf(o), got = lines.filter(i => i.received).length;
    const date = s.kind === 'received' ? null : o.day ? (o.day === today ? `Due today${timed(o) ? ` at ${clock(o.at)}` : ''}` : `${s.kind === 'overdue' ? 'Was due' : 'Due'} ${dayLong(o.day)}${timed(o) ? ` at ${clock(o.at)}` : ''}`) : 'No delivery date yet';
    return h('section', { class: `jo jo-${tone}`, 'aria-label': `Order ${o.ref || 'with no reference'}` },
      h('div', { class: 'jo-head' },
        h('h2', { class: 'jo-ref' }, o.ref ? `Order ${o.ref}` : 'No order reference yet', o.supplier ? h('span', { class: 'jo-sup' }, ` · ${o.supplier}`) : null),
        h('span', { class: 'jo-count' }, `${got} of ${lines.length} in`)),
      h('div', { class: 'facts' },
        h('p', { class: 'fact' }, icon(destIcon(o)), solo ? destText(o, s) : `${destText(o, s)}${date ? ` · ${date}` : ''}`),
        solo && date ? h('p', { class: 'fact' }, icon('i-calendar'), date) : null,
        tone !== 'calm' || exception ? h('p', { class: `fact fact-${tone}` }, icon(tone === 'good' ? 'i-check' : tone === 'calm' ? 'i-calendar' : 'i-alert'), line) : null,
        latest ? note(latest, today) : null,
        o.hubMismatch ? h('p', { class: 'fact fact-warn' }, icon('i-alert'), 'Ticked on the Hub, but monday.com shows it differently. Check the order on monday.com.') : null),
      h('ul', { class: 'ticks', 'aria-label': 'Materials: tick each one when it arrives' }, lines.map(i => tickRow(o, i, today))),
      h('button', { class: 'od-problem', type: 'button', onclick: () => openProblem(o.id) }, icon('i-help'), 'Problem with a material? Contact the help line'),
      problemsAbout(o, today),
      h('div', { class: 'folds' },
        fold('Order details', null, [h('dl', { class: 'meta' },
          h('div', null, h('dt', null, 'Supplier'), h('dd', null, o.supplier || '—')),
          h('div', null, h('dt', null, 'Order ref'), h('dd', null, o.ref || 'None yet')),
          h('div', null, h('dt', null, 'WFM job'), h('dd', null, o.wfm || '—'))),
          o.url ? h('a', { class: 'mon', href: o.url, target: '_blank', rel: 'noopener' }, 'Open in monday.com', icon('i-external')) : null]),
        history(o, s, today, latest)));
  }
  function jobView(job, today, opt = {}) {
    const all = job.orders.map(o => ({ o, s: status(o, today) }));
    const open = all.filter(x => x.s.kind !== 'received').sort((x, y) => (x.o.day || '9').localeCompare(y.o.day || '9') || (x.o.at || '9').localeCompare(y.o.at || '9'));
    const done = all.filter(x => x.s.kind === 'received').sort((x, y) => (y.o.receivedAt || '').localeCompare(x.o.receivedAt || ''));
    const lead = open[0] || done[0], a = arrival(lead.o, lead.s, today);
    const mats = job.orders.flatMap(linesOf), got = mats.filter(i => i.received).length;
    const tone = open.some(x => x.s.kind === 'overdue') ? 'bad' : open.length ? (open.some(x => x.s.partial || x.s.delay === 'active') ? 'warn' : 'calm') : 'good';
    const first = mats.find(i => !i.received) || mats[0];
    const id = 'od-' + job.key, sv = surveyorsOf(job), ft = fittersOf(job, today);
    return h('article', { class: `od od-${tone}`, 'aria-labelledby': id },
      h('div', { class: 'od-hero' },
        opt.back ? h('div', { class: 'od-bar' }, h('a', { class: 'od-back', href: href(S.tab) }, icon('i-back'), TABS.find(x => x[0] === S.tab)[1]),
          h('span', { class: 'od-bar-end' },
            h('button', { class: 'round has-dot', type: 'button', 'aria-label': `Have a problem with this job? Message ${contactsText()}${unreadAnswers() ? ' (new answer)' : ''}`, onclick: () => openProblem(lead.o.id) }, icon('i-help'), problemDot()),
            h('a', { class: 'brand brand-solo', href: '../', 'aria-label': 'Back to the FLR Hub' }, icon('flr-mark', 'brand-mark')))) : null,
        h('div', { class: 'od-top' },
          h('div', { class: 'od-when' }, a.label ? h('p', { class: 'od-label' }, open.length > 1 ? `Next: ${a.label.toLowerCase()}` : a.label) : null,
            h('p', { class: `od-big${a.date ? ' od-big-date' : ''}` }, a.big), a.small ? h('p', { class: 'od-small' }, a.small) : null),
          thumb(first && !first.whole ? product(first.name).kind : 'box', 'thumb-hero')),
        h('h1', { class: 'od-title', id, tabindex: '-1' }, job.name),
        h('p', { class: 'od-job' }, [job.wfm ? `WFM ${job.wfm}${job.stock ? ' (FLR stock)' : ''}` : 'No WFM job number', plural(job.orders.length, 'order'), `${got} of ${plural(mats.length, 'material')} in`].join(' · '),
          job.names.length > 1 ? h('span', { class: 'od-aka' }, `Also on monday.com as ${job.names.slice(1).join(', ')}`) : null),
        sv.length ? h('div', { class: 'od-sv' }, sv.map(p => h('span', { class: 'sv-chip' }, face(p, 'sv-md'),
          h('span', { class: 'sv-text' }, h('span', { class: 'sv-role' }, 'Surveyor'), h('span', { class: 'sv-name' }, p.name))))) : null,
        ft.people.length ? h('div', { class: 'od-ft' }, h('p', { class: 'ft-head' }, ft.last ? 'Fitters on the last visit' : 'Fitters booked'),
          h('div', { class: 'od-sv' }, ft.people.map(p => h('span', { class: 'sv-chip' }, face(p, 'sv-md'),
            h('span', { class: 'sv-text' }, h('span', { class: 'sv-role' }, visitWhen(p, today, ft.last)), h('span', { class: 'sv-name' }, p.name)))))) : null),
      h('div', { class: 'od-body' },
        h('p', { class: 'tick-help' }, 'Tick each material as it arrives; tap again to untick. A tick records that it arrived, not its condition; anything wrong, use the help line.'),
        ...[...open, ...done].map(x => orderBlock(x.o, today, job.orders.length === 1))));
  }
  const placeholder = () => h('div', { class: 'pick' }, thumb('box', 'thumb-lg'), h('p', { class: 'pick-title' }, 'Choose a job'), h('p', { class: 'pick-text' }, 'Its orders and a checklist of its materials show here.'));

  /* ---------------------------------------------------------------- ticking materials off */
  // A tick is a receipt of one material with the condition 'arrived' (orders_record_receipt): the database stamps who
  // and when, flr-orders ticks it on monday.com, and the order is received once everything on it has arrived. Undo is a
  // correction back to still to arrive (orders_correct_receipt), so History keeps both. Problems go to the help line.
  async function tick(o, i) {
    const k = `${o.id}:${i.id}`;
    if (S.saving.has(k)) return;
    S.saving.set(k, 'tick'); render();
    try {
      const { error } = await client().rpc('orders_record_receipt', { p_order: o.id, p_lines: [{ id: i.id, condition: 'arrived' }], p_note: null });
      if (error) throw error;
      S.saving.delete(k); await refresh(false); later();
    } catch (x) { S.saving.delete(k); render(); toast(saveError(x, 'The tick wasn’t saved')); }
  }
  async function untick(o, i, r) {
    const k = `${o.id}:${i.id}`;
    if (S.saving.has(k)) return;
    S.saving.set(k, 'undo'); render();
    try {
      const { error } = await client().rpc('orders_correct_receipt', { p_receipt: r.id, p_changes: [{ id: i.id, to: 'outstanding' }], p_reason: 'Ticked by mistake (Undo on the Hub)' });
      if (error) throw error;
      S.saving.delete(k); await refresh(false); later(); toast('Unticked');
    } catch (x) { S.saving.delete(k); render(); toast(saveError(x, 'The tick wasn’t undone')); }
  }
  // A material ticked on monday.com itself (no Hub tick to undo): orders_untick (1.6) puts it back to still to arrive.
  async function untickMonday(o, i) {
    const k = `${o.id}:${i.id}`;
    if (S.saving.has(k)) return;
    S.saving.set(k, 'undo'); render();
    try {
      const { error } = await client().rpc('orders_untick', { p_order: o.id, p_line: i.id });
      if (error) throw error;
      S.saving.delete(k); await refresh(false); later(); toast('Unticked');
    } catch (x) { S.saving.delete(k); render(); toast(saveError(x, 'It wasn’t unticked')); }
  }
  // monday.com is written within seconds: look again shortly so "saving to monday.com" turns into the tick.
  let laterTimer = 0;
  const later = () => { clearTimeout(laterTimer); laterTimer = setTimeout(() => refresh(false), 5000); };
  const saveError = (x, what) => {
    const code = flrCode(x);
    return code === 'FLR_VALIDATION' && x.details ? `${what}: ${x.details}` : code === 'FLR_FORBIDDEN' ? 'You can’t tick deliveries.' : offline(x) ? `${what}: can’t reach the FLR database.` : `${what}. Try again.`;
  };

  /* ---------------------------------------------------------------- "Have a problem?" */
  // A chat with Georgia and Luke: the person writes what's wrong, about one delivery or in general. The database keeps
  // it with who sent it and when (orders_report_problem), and flr-orders tells Georgia and Luke on monday.com (and by
  // email when that's set up). The person's own messages from the last 30 days show as the chat, with whether each got through.
  const contacts = () => (S.data && S.data.contacts && S.data.contacts.length ? S.data.contacts : ['Georgia Latham', 'Luke Parker']);
  const firstNames = () => contacts().map(n => n.split(' ')[0]);
  const andList = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  const contactsText = () => andList(firstNames());
  const QUICK = ['Something’s missing', 'It arrived damaged', 'It’s the wrong delivery', 'I can’t find the delivery', 'The driver needs help'];
  let chatOpen = null;   // redraws the open chat when new data arrives
  function problemStatus(p) {
    if (p.state === 'sent') return [`Sent to ${contactsText()}${p.email === 'sent' ? ' · emailed' : ''}`, 'ok'];
    if (p.state === 'failed') return ['Saved. Not sent yet; it will try again in a few minutes', 'warn'];
    return ['Sending…', 'wait'];
  }
  // Answers from monday.com (1.9): replies to the problem's update, or updates that @mention the sender.
  const answersOf = id => (S.answers.replies || {})[id] || [];
  const unreadAnswers = () => Object.values(S.answers.replies || {}).flat()
    .filter(a => a.mine && (!S.answers.seenAt || a.at > S.answers.seenAt)).length;
  const answerMeta = (a, today) => `${a.by} · ${a.kind === 'mention' ? 'mentioned you on monday.com' : 'replied on monday.com'} · ${when(a.at, today)}`;
  const answerList = (p, today) => {
    const as = answersOf(p.id);
    return as.length ? h('ul', { class: 'prob-answers', 'aria-label': 'Answers' }, as.map(a =>
      h('li', { class: 'prob-answer' }, h('p', { class: 'prob-answer-head' }, h('b', null, a.by), h('span', null, `${a.kind === 'mention' ? 'mentioned' : 'replied'} · ${when(a.at, today)}`)),
        h('p', { class: 'prob-text' }, a.body)))) : null;
  };
  const problemDot = () => unreadAnswers() ? h('span', { class: 'ans-dot', 'aria-hidden': 'true' }) : null;
  const problemLabel = () => `Have a problem? Message ${contactsText()}${unreadAnswers() ? ` (${unreadAnswers()} new ${unreadAnswers() === 1 ? 'answer' : 'answers'})` : ''}`;
  // Admins and Super Admins: the problems sent about a delivery, on the delivery itself.
  function problemsAbout(o, today) {
    if (!S.data.seesAllProblems) return null;
    const ps = (S.data.allProblems || []).filter(p => p.order === o.id).reverse();
    if (!ps.length) return null;
    return h('section', { class: 'od-sec od-probs', 'aria-label': 'Problems reported' },
      h('h2', { class: 'od-h' }, 'Problems reported', h('span', { class: 'od-n' }, String(ps.length))),
      h('ul', { class: 'probs' }, ps.map(p => {
        const [st, tone] = problemStatus(p);
        return h('li', { class: 'prob' }, h('p', { class: 'prob-head' }, h('b', null, p.mine ? 'You' : p.by), h('span', null, when(p.at, today))),
          h('p', { class: 'prob-text' }, p.message), h('p', { class: `prob-st bub-st-${tone}` }, tone === 'ok' ? icon('i-check') : null, st), answerList(p, today));
      })));
  }
  async function markAnswersSeen() {
    try {
      const { data, error } = await client().rpc('orders_replies_seen');
      if (!error) { S.answers.seenAt = data || new Date().toISOString(); render(); }
    } catch (e) { /* the dot stays until next time */ }
  }
  function openProblem(orderId) {
    if (!S.data) return;
    let about = orderId ? findOrder(orderId) : null;
    const today = R.londonDay();
    const dlg = h('dialog', { class: 'rec chat', 'aria-labelledby': 'chat-title' });
    const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
    const err = h('p', { class: 'rec-err', role: 'alert', hidden: true });
    const box = h('textarea', { id: 'chat-text', class: 'chat-text', rows: 2, maxlength: 1000, placeholder: 'Write what’s wrong…', 'aria-label': `Message to ${contactsText()}` });
    const send = h('button', { class: 'chat-send', type: 'submit', 'aria-label': 'Send' }, icon('i-send'));
    const aboutRow = h('div', { class: 'chat-about' });
    const quick = h('div', { class: 'chat-quick', role: 'group', 'aria-label': 'Quick starts' });
    const all = !!S.data.seesAllProblems;
    let mode = 'mine';
    const seg = all ? h('div', { class: 'chat-seg', role: 'tablist', 'aria-label': 'Which messages' }) : null;
    const compose = h('div', { class: 'chat-compose' });
    const bubble = (who, text, meta, cls = '') => h('div', { class: `bub bub-${who} ${cls}` }, h('p', { class: 'bub-text' }, text), meta ? h('p', { class: 'bub-meta' }, meta) : null);
    function drawSeg() {
      if (!seg) return;
      const n = (S.data.allProblems || []).length;
      seg.replaceChildren(...[['mine', 'Your messages'], ['all', `Everyone’s${n ? ` (${n})` : ''}`]].map(([k, label]) =>
        h('button', { type: 'button', role: 'tab', class: 'chat-seg-b', 'aria-selected': mode === k ? 'true' : 'false', onclick: () => { mode = k; drawSeg(); drawLog(); } }, label)));
      compose.hidden = mode === 'all';
    }
    function drawAll() {
      const ps = [...(S.data.allProblems || [])].reverse();
      if (!ps.length) return log.replaceChildren(bubble('them', 'No problems have been sent in the last 60 days.'));
      log.replaceChildren(...ps.map(p => {
        const [st, tone] = problemStatus(p);
        const o = p.order ? findOrder(p.order) : null;
        const ab = p.order ? `${product(p.what || '').title || 'Delivery'} · ${p.job}` : 'Not about one delivery';
        return h('div', { class: 'prob' },
          h('p', { class: 'prob-head' }, h('b', null, p.mine ? 'You' : p.by), h('span', null, when(p.at, today))),
          o ? h('a', { class: 'prob-about', href: href(S.tab, o.id), onclick: () => dlg.close() }, icon('i-box'), ab) : h('p', { class: 'prob-about prob-about-none' }, ab),
          h('p', { class: 'prob-text' }, p.message),
          h('p', { class: `prob-st bub-st-${tone}` }, tone === 'ok' ? icon('i-check') : null, st), answerList(p, today));
      }));
      log.scrollTop = 0;
    }
    function drawLog() {
      drawSeg();
      if (mode === 'all') return drawAll();
      const mine = (S.data.problems || []).slice(-20);
      const hello = bubble('them', `Hi ${(S.data.you || '').split(' ')[0] || 'there'}. What’s the problem? ${contactsText()} will be told straight away and will get back to you.`);
      log.replaceChildren(hello, ...mine.flatMap(p => {
        const [st, tone] = problemStatus(p);
        const ab = p.order ? `About ${product(p.what || '').title || p.job} · ${p.job}` : 'Not about one delivery';
        const out = [h('p', { class: 'chat-day' }, when(p.at, today)), bubble('me', p.message, [ab, h('span', { class: `bub-st bub-st-${tone}` }, tone === 'ok' ? icon('i-check') : null, st)])];
        if (p.state === 'sent') out.push(bubble('them', `Thanks, ${andList(firstNames())} have your message${p.order ? ' and it’s on the delivery in monday.com' : ''}.`, null, 'bub-auto'));
        for (const a of answersOf(p.id)) out.push(bubble('them', a.body, answerMeta(a, today), 'bub-ans'));
        return out;
      }));
      log.scrollTop = log.scrollHeight;
    }
    function drawCompose() {
      aboutRow.replaceChildren(about
        ? h('span', { class: 'chat-chip' }, icon('i-box'), h('span', null, h('b', null, about.job), about.ref ? ` · Order ${about.ref}` : ''),
            h('button', { type: 'button', class: 'chat-chip-x', 'aria-label': 'Not about this delivery', onclick: () => { about = null; drawCompose(); } }, '×'))
        : h('span', { class: 'chat-chip chat-chip-none' }, 'Not about one delivery'));
      quick.hidden = !!box.value.trim();
      quick.replaceChildren(...QUICK.map(q => h('button', { type: 'button', class: 'rec-opt chat-q', onclick: () => { box.value = q + '. '; box.focus(); drawCompose(); } }, q)));
      send.disabled = !box.value.trim();
    }
    const form = h('form', { class: 'chat-form', novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.hidden = true; send.setAttribute('aria-busy', 'true'); send.disabled = true;
      try {
        const { error } = await client().rpc('orders_report_problem', { p_order: about ? about.id : null, p_message: box.value.trim() });
        if (error) throw error;
        box.value = ''; drawCompose();
        await refresh(false); drawLog();
        for (const ms of [3000, 8000, 20000]) setTimeout(async () => { if (chatOpen === drawLog) { await refresh(false); } }, ms);
      } catch (x) {
        const code = flrCode(x);
        err.textContent = code === 'FLR_VALIDATION' && x.details ? x.details : code === 'FLR_FORBIDDEN' ? 'You can’t send messages from the Order Tracker.' : offline(x) ? 'Can’t reach the FLR database. Nothing was sent; try again.' : 'That didn’t send. Try again.';
        err.hidden = false;
      } finally { send.removeAttribute('aria-busy'); drawCompose(); }
    } },
      h('div', { class: 'rec-head chat-head' },
        h('div', { class: 'chat-faces', 'aria-hidden': 'true' }, ...contacts().map(n => h('span', { class: 'chat-face' }, n.split(' ').map(w => w[0]).join('').slice(0, 2)))),
        h('div', { class: 'chat-titles' }, h('h2', { class: 'rec-title', id: 'chat-title' }, 'Have a problem?'), h('p', { class: 'chat-sub' }, andList(contacts()))),
        h('button', { class: 'round rec-x', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('i-back'))),
      seg, log, compose);
    compose.append(aboutRow, quick, err, h('div', { class: 'chat-row' }, box, send));
    box.addEventListener('input', drawCompose);
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !send.disabled) form.requestSubmit(); });
    dlg.append(form);
    dlg.addEventListener('close', () => { chatOpen = null; dlg.remove(); });
    document.body.append(dlg);
    chatOpen = drawLog;
    drawLog(); drawCompose();
    if (unreadAnswers()) markAnswersSeen();
    dlg.showModal();
    box.focus();
  }

  /* ---------------------------------------------------------------- putting a screen together */
  let lastKey = '';
  function render() {
    if (!S.data) return;
    const r = parseRoute(), prevTab = S.tab, prevId = S.id;
    if (!prevId || wide.matches) S.scroll[prevTab] = scrollY;   // where the list was, to come back to it
    S.tab = r.tab;
    const today = londonDay(), g = sorted(today);
    // On a wide screen the panel is never empty: the address's order if there is one, otherwise the first of this
    // view (Today: due today, then needs attention, then any order). Not called "next": the board doesn't know the order.
    const first = { today: [g.due, g.late, g.upcoming, g.nodate, g.gotToday, g.gotEarlier], upcoming: [g.upcoming, g.nodate], received: [g.gotToday, g.gotEarlier] }[S.tab]
      .map(l => l[0]).find(Boolean);
    S.id = r.id || (wide.matches && first ? jobKey(first.o) : null);
    // Today's badge: jobs with materials still to come that are due today. "Needs attention" has its own count.
    const counts = { today: jobCount(g.due), upcoming: jobCount([...g.upcoming, ...g.nodate]), received: jobCount(g.gotToday, false) };
    const job = findJob(S.id);
    if (job && S.id !== job.key) S.id = job.key;   // an old link to one order opens its job
    const v = $('#view');
    document.body.dataset.view = 'page';
    $('#gate').hidden = true; v.hidden = false;

    const missing = S.id && !job ? h('div', { class: 'pick' }, thumb('box', 'thumb-lg'), h('p', { class: 'pick-title' }, 'That job isn’t on the board now'),
      h('p', { class: 'pick-text' }, 'It may have been deleted on monday.com.'), h('a', { class: 'btn btn-brand', href: href(S.tab) }, 'Back to the list')) : null;

    const focused = !wide.matches && !!S.id;   // a phone: the order on its own
    tabbar(counts);
    $('#tabs').hidden = focused;
    document.documentElement.style.setProperty('--tabbar-h', focused || wide.matches ? '0px' : 'calc(64px + env(safe-area-inset-bottom, 0px))');
    document.body.dataset.screen = focused ? 'order' : 'list';

    const key = `${S.tab}:${focused ? S.id : ''}`, same = key === lastKey; lastKey = key;
    const y = scrollY;
    if (focused) {
      document.title = `${job ? job.name : 'Job'} · Order Tracker`;
      v.replaceChildren(h('div', { class: 'solo' }, notices(today), job ? jobView(job, today, { back: true }) : missing));
    } else {
      const titles = { today: ['Today’s deliveries', dayLong(today)], upcoming: ['Coming up', 'After today'], received: ['Received', 'Recorded on the Hub or monday.com'] };
      const [title, sub] = titles[S.tab];
      document.title = `${title} · Order Tracker`;
      const body = S.tab === 'today' ? todayScreen(g, today) : S.tab === 'upcoming' ? upcomingScreen(g, today) : receivedScreen(g, today);
      const listCol = h('div', { class: 'col-list' }, header(title, sub, counts, today), notices(today), h('div', { class: 'col-body' }, body));
      v.replaceChildren(wide.matches ? h('div', { class: 'split' }, listCol,
        h('aside', { class: 'col-detail', 'aria-label': 'Selected job' }, job ? jobView(job, today) : missing || placeholder())) : listCol);
    }
    if (same) scrollTo(0, y);
    else if (focused) { scrollTo(0, 0); const t = $('.od-title'); if (t) t.focus({ preventScroll: true }); }
    else if (wide.matches && prevTab === S.tab) { scrollTo(0, y); const p = $('.col-detail'); if (p) p.scrollTop = 0; }
    else scrollTo(0, S.scroll[S.tab] || 0);
  }

  /* ---------------------------------------------------------------- talking to the database, loading, refreshing */
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
  async function fetchBoard() {
    const { data, error } = await client().rpc('orders_board');
    if (error) throw error;
    if (!data || !Array.isArray(data.orders)) throw new Error('The answer had no orders in it');
    return data;
  }
  // Who each surveyor code is, with their photo (1.7). Read once; until 1.7 is live (or if it fails) jobs show no surveyor.
  async function fetchSurveyors() {
    try {
      const { data, error } = await client().rpc('orders_surveyors');
      if (error) { if (!missingFunction(error)) console.warn('Surveyors not loaded', error.message); return missingFunction(error) ? {} : null; }
      return data && typeof data === 'object' ? data : {};
    } catch (e) { return null; }
  }
  // Answers to problems from monday.com (1.9); until 1.9 is live, none.
  async function fetchAnswers() {
    try {
      const { data, error } = await client().rpc('orders_problem_replies');
      if (error) return missingFunction(error) ? { replies: {}, seenAt: null } : null;
      return data && typeof data === 'object' ? { replies: data.replies || {}, seenAt: data.seenAt || null } : null;
    } catch (e) { return null; }
  }
  // The fitters' photos (1.8), for the names shown and not asked for yet; until 1.8 is live, initials.
  async function fetchPhotos() {
    const today = londonDay(), want = new Set();
    for (const j of jobs().values()) for (const p of fittersOf(j, today).people) if (!(p.name in S.photos)) want.add(p.name);
    const names = [...want];
    if (!names.length) return false;
    let got = false;
    for (let i = 0; i < names.length; i += 60) {
      const part = names.slice(i, i + 60);
      try {
        const { data, error } = await client().rpc('orders_photos', { p_names: part });
        if (error) { if (missingFunction(error)) part.forEach(n => { S.photos[n] = null; }); continue; }
        for (const n of part) S.photos[n] = (data && data[n]) || null;
        got = true;
      } catch (e) { /* asked again on the next refresh */ }
    }
    return got;
  }
  function failGate(e) {
    const code = flrCode(e);
    if (expired(e) || code === 'FLR_SIGN_IN_REQUIRED') return location.replace(SIGN_IN);
    if (code === 'FLR_FORBIDDEN') return gate('You don’t have access to the Order Tracker', 'It’s switched on for the FLR staff who need it. If you think you should have it, ask an FLR Super Admin.');
    if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
    if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
    if (missingFunction(e)) return gate('The Order Tracker isn’t ready yet', 'The FLR database doesn’t have the Order Tracker yet.');
    if (offline(e)) return gate('Can’t reach the FLR database', 'Check your connection and try again.', { retry: true });
    return gate('The deliveries didn’t load', 'Something went wrong getting them. Try again in a moment.', { retry: true });
  }
  async function refresh(byHand) {
    if (S.busy) { S.again = true; return; }
    S.busy = true;
    const busy = on => { const b = $('#refresh'); if (b) on ? b.setAttribute('aria-busy', 'true') : b.removeAttribute('aria-busy'); };
    busy(true);
    try {
      const d = await fetchBoard();
      if (!S.surveyors) S.surveyors = await fetchSurveyors();
      S.answers = (await fetchAnswers()) || S.answers;
      S.data = d; S.gotAt = Date.now(); S.err = null;
      if (!d.readAt && !d.orders.length) gate('No deliveries yet', d.failing ? `The tracker couldn’t read monday.com yet. ${d.failing}` : 'The tracker hasn’t read the Goods In board yet. It does every 5 minutes.', { retry: true });
      else { render(); fetchPhotos().then(got => { if (got) render(); }); }
      if (chatOpen) chatOpen();
      if (byHand) toast(d.failing ? 'monday.com still isn’t answering' : 'Up to date');
    } catch (e) {
      const code = flrCode(e);
      if (!S.data || code === 'FLR_FORBIDDEN' || code === 'FLR_ACCOUNT_DISABLED' || expired(e) || code === 'FLR_SIGN_IN_REQUIRED') { S.data = null; failGate(e); }
      else { S.err = e; render(); if (byHand) toast('Couldn’t refresh'); }
    } finally {
      S.busy = false; busy(false);
      if (S.again) { S.again = false; refresh(false); }
    }
  }
  function schedule() {
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data && Date.now() - S.gotAt > POLL_MS) refresh(false); });
  addEventListener('hashchange', render);
  wide.addEventListener('change', render);
  $('#gate-retry').addEventListener('click', () => { document.body.dataset.view = 'loading'; $('#gate-message').hidden = true; refresh(false); });

  async function boot() {
    const c = client();
    if (!c) return gate('The Order Tracker isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) return location.replace(SIGN_IN);
    await refresh(false);
    schedule();
  }
  boot();
})();
