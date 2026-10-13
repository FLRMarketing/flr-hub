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
  const S = { data: null, gotAt: 0, err: null, busy: false, timer: 0, tab: 'today', id: null, attnAll: false, scroll: {} };
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

  /* ---------------------------------------------------------------- grouped by where they're going (Monday's Delivery Location) */
  // Monday records Warehouse, Site or Collection; for a site delivery the site is the job.
  function destKey(o) {
    if (o.destination === 'Warehouse') return ['0', 'FLR warehouse', 'i-warehouse', null];
    if (o.destination === 'Site') return ['1' + o.job.toUpperCase(), o.job, 'i-site', 'Site'];
    if (o.destination === 'Collection') return ['2', 'For collection', 'i-collect', null];
    return ['3', 'Destination not confirmed', 'i-alert', null];
  }
  function grouped(items, today, o) {
    const groups = new Map();
    for (const x of items) { const k = destKey(x.o); if (!groups.has(k[0])) groups.set(k[0], { k, items: [] }); groups.get(k[0]).items.push(x); }
    return [...groups.values()].sort((a, b) => a.k[0].localeCompare(b.k[0])).map(({ k, items: xs }) =>
      h('div', { class: 'dest' },
        h('h3', { class: 'dest-head' }, icon(k[2]), h('span', { class: 'dest-name' }, k[1]), k[3] ? h('span', { class: 'dest-kind' }, k[3]) : null, h('span', { class: 'dest-n' }, String(xs.length))),
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
  // Likkle Jeff lives in the tab bar on phones (and in the order's own bar), so he never floats over a delivery.
  const askJeff = ev => ev.currentTarget.dispatchEvent(new CustomEvent('flr-assist:open', { bubbles: true }));
  function tabbar(counts) {
    $('#tabs').replaceChildren(...TABS.map(([k, label, ic]) => h('a', { class: 'tab', href: href(k), 'aria-current': S.tab === k ? 'page' : null },
      h('span', { class: 'tab-ic' }, icon(ic), counts[k] ? h('span', { class: 'tab-n' }, String(counts[k])) : null), h('span', { class: 'tab-label' }, label))),
      h('button', { class: 'tab', type: 'button', 'aria-label': 'Help from Likkle Jeff', onclick: askJeff }, h('span', { class: 'tab-ic' }, icon('i-help')), h('span', { class: 'tab-label' }, 'Help')));
  }

  /* ---------------------------------------------------------------- one delivery in a list */
  // Material and job; on the right only a recorded time (or, for late orders, the day they were or are now due);
  // a label only for an exception. No "Due today" on every row: the section says it.
  function row(x, today, o = {}) {
    const { o: ord, s } = x, t = titleOf(ord, s), b = badge(ord, s);
    let when = '';
    const late = o.late ? `${s.kind === 'overdue' ? 'Was due' : 'Now due'} ${dayShort(ord.day)}` : '';
    if (s.kind === 'received') when = ord.receivedAt ? clock(ord.receivedAt) : '';
    else if (!o.late && timed(ord)) when = clock(ord.at);
    const label = [t.title + (t.more ? ` and ${plural(t.more, 'more product')}` : ''), ord.job, late, b && b[1], when && `${s.kind === 'received' ? 'received' : 'expected'} ${when}`].filter(Boolean).join('. ');
    return h('li', null, h('a', { class: 'row', href: href(S.tab, ord.id), 'aria-current': S.id === ord.id ? 'true' : null, 'aria-label': label },
      thumb(t.kind, 'thumb-sm'),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, t.title, t.more ? h('span', { class: 'row-more' }, ` +${t.more}`) : null),
        h('span', { class: 'row-job' }, ord.job),
        late ? h('span', { class: 'row-late' }, late) : null,
        b ? h('span', { class: `pill pill-${b[0]} pill-in`, 'aria-hidden': 'true' }, b[1]) : null),   // narrow screens: under the text
      h('span', { class: 'row-end' },
        b ? h('span', { class: `pill pill-${b[0]} pill-out`, 'aria-hidden': 'true' }, b[1]) : null,
        when ? h('span', { class: 'row-when' }, when) : null)));
  }
  const list = (items, today, o) => h('ul', { class: 'rows' }, items.map(x => row(x, today, o)));
  // Said once, beside the heading, when some rows have no time.
  const timeNote = items => items.some(x => !timed(x.o)) ? h('p', { class: 'block-note' }, items.some(x => timed(x.o)) ? 'Times show only where monday.com has one; the rest aren’t confirmed.' : 'Arrival times aren’t confirmed.') : null;
  const empty = (title, text) => h('div', { class: 'empty' }, thumb('box', 'thumb-lg'), h('p', { class: 'empty-title' }, title), text ? h('p', { class: 'empty-text' }, text) : null);

  /* ---------------------------------------------------------------- the three screens */
  function todayScreen(g, today) {
    const late = g.late, shown = S.attnAll ? late : late.slice(0, ATTN_SHOWN);
    return [
      late.length ? h('section', { class: 'block attn', 'aria-labelledby': 'attn-title' },
        h('h2', { class: 'block-title attn-title', id: 'attn-title' }, h('span', { class: 'attn-dot', 'aria-hidden': 'true' }), 'Needs attention', h('span', { class: 'block-n' }, String(late.length))),
        grouped(shown, today, { late: true }),
        late.length > ATTN_SHOWN ? h('button', { class: 'more-btn', type: 'button', 'aria-expanded': S.attnAll ? 'true' : 'false',
          onclick: () => { S.attnAll = !S.attnAll; render(); } }, S.attnAll ? 'Show fewer' : `Show all ${late.length}`) : null) : null,
      h('section', { class: 'block', 'aria-labelledby': 'due-title' },
        h('h2', { class: 'block-title', id: 'due-title' }, 'Still to arrive', g.due.length ? h('span', { class: 'block-n' }, String(g.due.length)) : null),
        g.due.length ? [timeNote(g.due), grouped(g.due, today, {})] : empty(g.gotToday.length ? 'Everything due today is in' : 'Nothing due today')),
      g.gotToday.length ? h('a', { class: 'got-link', href: href('received') }, icon('i-check', 'got-ic'),
        h('span', null, `${plural(g.gotToday.length, 'delivery', 'deliveries')} received today`), icon('i-chevron', 'got-chev')) : null,
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
  const HUB_UPDATE = /^Delivery record(ed on| corrected on) the FLR Hub by /;
  const notesOf = o => [...(o.updates || []).filter(u => !HUB_UPDATE.test(u.text || '')),
    ...(o.hubNotes || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const condWord = c => c === 'good' ? 'good' : c === 'Wrong location' ? 'wrong place' : String(c).toLowerCase();
  // A receipt as it was recorded, and a correction: who, why and what changed. The receipt's own entry never changes.
  function hubEvent(r) {
    if (r.kind !== 'correction') return `Recorded on the Hub by ${r.by}: ${r.lines.map(l => `${product(l.name).title}${l.condition === 'good' ? '' : ` (${condWord(l.condition)})`}`).join(', ')} arrived${r.remaining.length ? `; ${plural(r.remaining.length, 'item')} still to come` : ''}${r.note ? `. “${r.note}”` : ''}`;
    const what = r.lines.map(l => l.to === 'outstanding' ? `${product(l.name).title} back to still to arrive` : `${product(l.name).title} ${condWord(l.from)} → ${condWord(l.to)}`);
    if (r.noteChanged) what.push(r.note ? `note now “${r.note}”` : 'note removed');
    return `Receipt corrected by ${r.by}: ${what.join('; ')}. Reason: “${r.reason}”`;
  }
  function history(o, s, today, shownNote) {
    const ev = [];
    for (const m of o.moves || []) ev.push([m.at, `Delivery date moved from ${dayShort(m.from)} to ${dayShort(m.to)}`]);
    if (o.receivedAt) ev.push([o.receivedAt, s.partial ? 'Ticked as received, with items still to arrive' : 'Received']);
    for (const u of o.updates || []) if (!HUB_UPDATE.test(u.text || '') && !(shownNote && u.text === shownNote.text && u.at === shownNote.at)) ev.push([u.at, `“${u.text}”${u.by ? ` · ${u.by}` : ''}`]);
    for (const r of o.hubReceipts || []) ev.push([r.at, hubEvent(r), r.kind === 'correction' ? 'hist-fix' : null]);
    ev.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    const fixed = [o.day ? ['', `Delivery date on monday.com: ${dayLong(o.day)}${timed(o) ? `, ${clock(o.at)}` : ''}`] : null,
      o.ref ? ['', `Order reference recorded: ${o.ref}`] : ['', 'No order reference recorded yet']].filter(Boolean);
    return fold('History', null, h('ul', { class: 'hist' }, [...ev, ...fixed].map(([at, text, cls]) =>
      h('li', cls ? { class: cls } : null, h('span', { class: 'hist-when' }, at ? when(at, today) : 'Recorded'), h('span', { class: 'hist-text' }, text)))));
  }
  function orderView(o, today, opt = {}) {
    const s = status(o, today), t = titleOf(o, s), a = arrival(o, s, today);
    const [tone, line, exception] = statusLine(o, s);
    const latest = exception ? notesOf(o)[0] || null : null;   // the explanation goes right under the exception
    const lines = o.items || [];
    const out = s.partial ? s.outstanding : [], got = lines.filter(i => !out.includes(i));
    const showOut = s.partial && out.length > 0;
    const id = 'od-' + o.id;
    return h('article', { class: `od od-${tone}`, 'aria-labelledby': id },
      h('div', { class: 'od-hero' },
        opt.back ? h('div', { class: 'od-bar' }, h('a', { class: 'od-back', href: href(S.tab) }, icon('i-back'), TABS.find(x => x[0] === S.tab)[1]),
          h('span', { class: 'od-bar-end' },
            h('button', { class: 'round', type: 'button', 'aria-label': 'Help from Likkle Jeff', onclick: askJeff }, icon('i-help')),
            h('a', { class: 'brand brand-solo', href: '../', 'aria-label': 'Back to the FLR Hub' }, icon('flr-mark', 'brand-mark')))) : null,
        h('div', { class: 'od-top' },
          h('div', { class: 'od-when' }, a.label ? h('p', { class: 'od-label' }, a.label) : null,
            h('p', { class: `od-big${a.date ? ' od-big-date' : ''}` }, a.big), a.small ? h('p', { class: 'od-small' }, a.small) : null),
          thumb(t.kind, 'thumb-hero')),
        h('h1', { class: 'od-title', id, tabindex: '-1' }, t.title, t.more ? h('span', { class: 'od-more' }, ` +${t.more} more`) : null),
        h('p', { class: 'od-job' }, o.job)),
      h('div', { class: 'od-body' },
        h('div', { class: 'facts' },
          h('p', { class: 'fact' }, icon(destIcon(o)), destText(o, s)),
          h('p', { class: `fact fact-${tone}` }, icon(tone === 'good' ? 'i-check' : tone === 'calm' ? 'i-calendar' : 'i-alert'), line),
          latest ? note(latest, today) : null,
          o.hubFailed ? h('p', { class: 'fact fact-warn' }, icon('i-alert'), 'Saved on the Hub; monday.com hasn’t been updated yet. It will try again.')
            : o.hubPending ? h('p', { class: 'fact' }, icon('i-refresh'), 'Saved on the Hub; updating monday.com…')
            : o.hubMismatch ? h('p', { class: 'fact fact-warn' }, icon('i-alert'), `Recorded on the Hub, but monday.com shows it differently. Check the order on monday.com.`) : null),
        s.kind !== 'received' || correctable(o).length ? h('div', { class: 'od-acts' },
          s.kind !== 'received' ? h('button', { class: 'btn btn-brand btn-wide', type: 'button', onclick: () => openRecord(o.id) }, icon('i-check'), 'Record delivery') : null,
          correctable(o).length ? h('button', { class: 'btn btn-quiet btn-wide', type: 'button', onclick: () => openCorrect(o.id) }, icon('i-edit'), 'Correct receipt') : null) : null,
        lines.length ? h('section', { class: 'od-sec', 'aria-label': showOut ? 'Still to arrive' : 'Materials' },
          h('h2', { class: 'od-h' }, showOut ? 'Still to arrive' : 'Materials', h('span', { class: 'od-n' }, String(showOut ? out.length : lines.length))),
          matRows(showOut ? out : lines, today, !s.partial)) : h('p', { class: 'od-none' }, 'No products listed on monday.com.'),
        h('div', { class: 'folds' },
          showOut && got.length ? fold('Received', got.length, matRows(got, today, true)) : null,
          fold('Order details', null, [h('dl', { class: 'meta' },
            h('div', null, h('dt', null, 'Supplier'), h('dd', null, o.supplier || '—')),
            h('div', null, h('dt', null, 'Order ref'), h('dd', null, o.ref || 'None yet')),
            h('div', null, h('dt', null, 'WFM job'), h('dd', null, o.wfm || '—'))),
            o.url ? h('a', { class: 'mon', href: o.url, target: '_blank', rel: 'noopener' }, 'Open in monday.com', icon('i-external')) : null]),
          history(o, s, today, latest))));
  }
  const placeholder = () => h('div', { class: 'pick' }, thumb('box', 'thumb-lg'), h('p', { class: 'pick-title' }, 'Choose a delivery'), h('p', { class: 'pick-text' }, 'Its arrival, materials and details show here.'));

  /* ---------------------------------------------------------------- recording a delivery */
  // The person receiving it chooses what arrived and its condition. Nothing is ticked to start with; what isn't
  // chosen stays outstanding. Who and when are set by the database (orders_record_receipt), not by this page.
  const CONDITIONS = [['Damaged', 'Damaged'], ['Wrong colour', 'Wrong colour'], ['Wrong quantity', 'Wrong quantity'], ['Wrong location', 'Wrong place']];
  function openRecord(id) {
    const o = findOrder(id);
    if (!o) return;
    const lines = (o.items || []).length ? o.items.filter(i => !i.received) : [{ id: 'order', name: o.job, whole: true }];
    if (!lines.length) return toast('Everything on this delivery is already recorded');
    const pick = new Map(lines.map(l => [l.id, { arrived: false, cond: null }]));   // cond: 'good' | a problem | null
    const dlg = h('dialog', { class: 'rec', 'aria-labelledby': 'rec-title' });
    const err = h('p', { class: 'rec-err', role: 'alert', hidden: true });
    const noteBox = h('textarea', { id: 'rec-note', class: 'rec-note', rows: 3, maxlength: 500, placeholder: 'What was wrong, e.g. “Two tubs split in the box”' });
    const summary = h('p', { class: 'rec-sum', 'aria-live': 'polite' });
    const go = h('button', { class: 'btn btn-brand btn-wide', type: 'submit' }, 'Record delivery');
    const list = h('ul', { class: 'rec-lines' });
    function draw() {
      list.replaceChildren(...lines.map(l => {
        const st = pick.get(l.id), p = l.whole ? { title: 'The whole delivery', qty: '' } : product(l.name);
        const toggle = h('button', { type: 'button', class: 'rec-tick', role: 'checkbox', 'aria-checked': st.arrived ? 'true' : 'false',
          'aria-label': `${p.title}${p.qty ? ', ' + p.qty : ''} arrived`, onclick: () => { st.arrived = !st.arrived; if (!st.arrived) st.cond = null; draw(); } },
          h('span', { class: 'rec-box', 'aria-hidden': 'true' }, st.arrived ? icon('i-check') : null),
          h('span', { class: 'rec-name' }, h('b', null, p.title), p.qty ? h('small', null, p.qty) : null));
        const cond = st.arrived ? h('div', { class: 'rec-cond', role: 'radiogroup', 'aria-label': `Condition of ${p.title}` },
          h('button', { type: 'button', role: 'radio', class: 'rec-opt', 'aria-checked': st.cond === 'good' ? 'true' : 'false', onclick: () => { st.cond = 'good'; draw(); } }, 'Good condition'),
          ...CONDITIONS.map(([v, label]) => h('button', { type: 'button', role: 'radio', class: 'rec-opt rec-opt-bad', 'aria-checked': st.cond === v ? 'true' : 'false', onclick: () => { st.cond = v; draw(); } }, label))) : null;
        return h('li', { class: `rec-line${st.arrived ? ' on' : ''}` }, toggle, cond);
      }));
      const chosen = [...pick.values()].filter(x => x.arrived), bad = chosen.filter(x => x.cond && x.cond !== 'good');
      const missingCond = chosen.some(x => !x.cond), needNote = bad.length > 0 && !noteBox.value.trim();
      noteBox.closest('.rec-note-wrap').classList.toggle('need', bad.length > 0);
      summary.textContent = !chosen.length ? 'Choose what arrived. Anything not chosen stays outstanding.'
        : missingCond ? 'Choose the condition of each material that arrived.'
        : `${chosen.length} of ${lines.length} ${lines.length === 1 && lines[0].whole ? 'delivery' : 'items'} arrived${bad.length ? ` · ${plural(bad.length, 'problem')}` : ''}${chosen.length < lines.length ? ' · the rest stays outstanding' : ''}.${needNote ? ' Add a note about the problem.' : ''}`;
      go.disabled = !chosen.length || missingCond || needNote;
    }
    const form = h('form', { class: 'rec-form', novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.hidden = true; go.setAttribute('aria-busy', 'true'); go.disabled = true;
      const p_lines = lines.filter(l => pick.get(l.id).arrived).map(l => ({ id: l.id, condition: pick.get(l.id).cond }));
      try {
        const { error } = await client().rpc('orders_record_receipt', { p_order: o.id, p_lines, p_note: noteBox.value.trim() || null });
        if (error) throw error;
        dlg.close(); toast('Delivery recorded');
        await refresh(false); setTimeout(() => refresh(false), 6000);
      } catch (x) {
        const code = flrCode(x);
        err.textContent = code === 'FLR_VALIDATION' && x.details ? x.details : code === 'FLR_FORBIDDEN' ? 'You can’t record deliveries.' : offline(x) ? 'Can’t reach the FLR database. Nothing was recorded; try again.' : 'That didn’t save. Nothing was recorded; try again.';
        err.hidden = false; go.removeAttribute('aria-busy'); draw();
      }
    } },
      h('div', { class: 'rec-head' }, h('h2', { class: 'rec-title', id: 'rec-title' }, 'Record delivery'),
        h('button', { class: 'round rec-x', type: 'button', 'aria-label': 'Close without recording', onclick: () => dlg.close() }, icon('i-back'))),
      h('p', { class: 'rec-job' }, o.job),
      h('p', { class: 'rec-q' }, (o.items || []).length ? 'Which materials arrived?' : 'Did the delivery arrive?'),
      list,
      h('div', { class: 'rec-note-wrap' }, h('label', { for: 'rec-note', class: 'rec-label' }, 'Note', h('span', { class: 'rec-label-hint' }, ' · needed for any problem')), noteBox),
      err, summary, go,
      h('p', { class: 'rec-who' }, `Recorded as ${S.data.you || 'you'}, at the time you press Record. It’s added to the order on monday.com.`));
    noteBox.addEventListener('input', draw);
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    draw();
    dlg.showModal();
  }

  /* ---------------------------------------------------------------- correcting a receipt */
  // A receipt recorded by mistake is corrected, never changed: each material on it can go back to still to arrive or
  // get the right condition, and its note can change; a reason is always needed. The database stamps who and when
  // (orders_correct_receipt), keeps the original in History, and monday.com is updated to match.
  // Correctable: the Hub's receipts with a material still shown as arrived because of them.
  const correctable = o => (o.hubReceipts || []).filter(r => r.kind !== 'correction'
    && Object.values((o.hubState || {}).lines || {}).some(x => x.received && x.receipt === r.id));
  const FIX = [['good', 'Good condition'], ...CONDITIONS, ['outstanding', 'Didn’t arrive']];
  function openCorrect(id, which) {
    const o = findOrder(id);
    if (!o) return;
    const recs = correctable(o);
    if (!recs.length) return toast('Nothing on this order can be corrected');
    const r = recs.find(x => x.id === which) || recs[recs.length - 1];
    const st = o.hubState.lines, notes = o.hubState.notes || {};
    const lines = r.lines.filter(l => st[l.id] && st[l.id].received && st[l.id].receipt === r.id).map(l => ({ id: l.id, name: l.name, was: st[l.id].condition }));
    const pick = new Map(lines.map(l => [l.id, l.was]));
    const oldNote = (Object.prototype.hasOwnProperty.call(notes, r.id) ? notes[r.id] : r.note) || '';
    const dlg = h('dialog', { class: 'rec', 'aria-labelledby': 'fix-title' });
    const err = h('p', { class: 'rec-err', role: 'alert', hidden: true });
    const noteBox = h('textarea', { id: 'fix-note', class: 'rec-note', rows: 2, maxlength: 500, placeholder: 'What was wrong, e.g. “Tile box crushed on one corner”' });
    noteBox.value = oldNote;
    const why = h('textarea', { id: 'fix-why', class: 'rec-note', rows: 2, maxlength: 300, required: true, placeholder: 'e.g. “Ticked the wrong order: the trim hasn’t come”' });
    const summary = h('p', { class: 'rec-sum', 'aria-live': 'polite' });
    const go = h('button', { class: 'btn btn-brand btn-wide', type: 'submit' }, 'Save correction');
    const list = h('ul', { class: 'rec-lines' });
    const label = x => (FIX.find(f => f[0] === x) || [x, x])[1];
    function draw() {
      list.replaceChildren(...lines.map(l => {
        const p = l.id === 'order' ? { title: 'The whole delivery', qty: '' } : product(l.name), now = pick.get(l.id);
        return h('li', { class: `rec-line on${now !== l.was ? ' fix-changed' : ''}` },
          h('div', { class: 'rec-tick fix-name' }, h('span', { class: 'rec-name' }, h('b', null, p.title), h('small', null, `${p.qty ? p.qty + ' · ' : ''}recorded as ${label(l.was).toLowerCase()}`))),
          h('div', { class: 'rec-cond', role: 'radiogroup', 'aria-label': `What ${p.title} should be` },
            ...FIX.map(([v, text]) => h('button', { type: 'button', role: 'radio', class: `rec-opt${v === 'good' ? '' : v === 'outstanding' ? ' rec-opt-out' : ' rec-opt-bad'}`,
              'aria-checked': now === v ? 'true' : 'false', onclick: () => { pick.set(l.id, v); draw(); } }, text))));
      }));
      const changes = lines.filter(l => pick.get(l.id) !== l.was);
      const noteChanged = noteBox.value.trim() !== oldNote.trim();
      const bad = lines.some(l => !['good', 'outstanding'].includes(pick.get(l.id)));
      const needNote = bad && !noteBox.value.trim(), needWhy = !why.value.trim();
      noteBox.closest('.rec-note-wrap').classList.toggle('need', bad);
      const back = changes.filter(l => pick.get(l.id) === 'outstanding').length;
      summary.textContent = !changes.length && !noteChanged ? 'Change what was recorded wrongly, then say why.'
        : `${changes.length ? plural(changes.length, 'change') : 'Note changed'}${back ? ` · ${back} back to still to arrive` : ''}.${needNote ? ' Add a note about the problem.' : ''}${needWhy ? ' Say why it’s being corrected.' : ''}`;
      go.disabled = (!changes.length && !noteChanged) || needNote || needWhy;
    }
    const form = h('form', { class: 'rec-form', novalidate: true, onsubmit: async e => {
      e.preventDefault(); err.hidden = true; go.setAttribute('aria-busy', 'true'); go.disabled = true;
      const p_changes = lines.filter(l => pick.get(l.id) !== l.was).map(l => ({ id: l.id, to: pick.get(l.id) }));
      const p_note = noteBox.value.trim() !== oldNote.trim() ? noteBox.value.trim() : null;
      try {
        const { error } = await client().rpc('orders_correct_receipt', { p_receipt: r.id, p_changes, p_reason: why.value.trim(), p_note });
        if (error) throw error;
        dlg.close(); toast('Receipt corrected');
        await refresh(false); setTimeout(() => refresh(false), 6000);
      } catch (x) {
        const code = flrCode(x);
        err.textContent = code === 'FLR_VALIDATION' && x.details ? x.details : code === 'FLR_FORBIDDEN' ? 'You can’t correct deliveries.' : offline(x) ? 'Can’t reach the FLR database. Nothing was changed; try again.' : 'That didn’t save. Nothing was changed; try again.';
        err.hidden = false; go.removeAttribute('aria-busy'); draw();
      }
    } },
      h('div', { class: 'rec-head' }, h('h2', { class: 'rec-title', id: 'fix-title' }, 'Correct receipt'),
        h('button', { class: 'round rec-x', type: 'button', 'aria-label': 'Close without correcting', onclick: () => dlg.close() }, icon('i-back'))),
      h('p', { class: 'rec-job' }, o.job),
      recs.length > 1 ? h('div', { class: 'fix-which', role: 'group', 'aria-label': 'Which delivery record' },
        ...recs.map(x => h('button', { type: 'button', class: 'rec-opt', 'aria-pressed': x.id === r.id ? 'true' : 'false',
          onclick: () => { if (x.id !== r.id) { dlg.close(); openCorrect(id, x.id); } } }, `${when(x.at, R.londonDay())} · ${x.by}`))) : null,
      h('p', { class: 'rec-q' }, `Recorded by ${r.by}, ${when(r.at, R.londonDay())}. What should it say?`),
      list,
      h('div', { class: 'rec-note-wrap' }, h('label', { for: 'fix-note', class: 'rec-label' }, 'Note', h('span', { class: 'rec-label-hint' }, ' · needed for any problem')), noteBox),
      h('div', { class: 'rec-note-wrap need' }, h('label', { for: 'fix-why', class: 'rec-label' }, 'Reason for the correction', h('span', { class: 'rec-label-hint' }, ' · always needed')), why),
      err, summary, go,
      h('p', { class: 'rec-who' }, `Saved as ${S.data.you || 'you'}, at the time you press Save. The original record stays in History, and monday.com is updated to match.`));
    noteBox.addEventListener('input', draw); why.addEventListener('input', draw);
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    draw();
    dlg.showModal();
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
    S.id = r.id || (wide.matches && first ? first.o.id : null);
    // Today's badge: orders with materials still to come that are due today. "Needs attention" has its own count.
    const counts = { today: g.due.length, upcoming: g.upcoming.length + g.nodate.length, received: g.gotToday.length };
    const order = S.id ? findOrder(S.id) : null;
    const v = $('#view');
    document.body.dataset.view = 'page';
    $('#gate').hidden = true; v.hidden = false;

    const missing = S.id && !order ? h('div', { class: 'pick' }, thumb('box', 'thumb-lg'), h('p', { class: 'pick-title' }, 'That delivery isn’t on the board now'),
      h('p', { class: 'pick-text' }, 'It may have been deleted on monday.com.'), h('a', { class: 'btn btn-brand', href: href(S.tab) }, 'Back to the list')) : null;

    const focused = !wide.matches && !!S.id;   // a phone: the order on its own
    tabbar(counts);
    $('#tabs').hidden = focused;
    document.documentElement.style.setProperty('--tabbar-h', focused || wide.matches ? '0px' : 'calc(64px + env(safe-area-inset-bottom, 0px))');
    document.body.dataset.screen = focused ? 'order' : 'list';
    document.documentElement.toggleAttribute('data-flr-assist-docked', !wide.matches);

    const key = `${S.tab}:${focused ? S.id : ''}`, same = key === lastKey; lastKey = key;
    const y = scrollY;
    if (focused) {
      document.title = `${order ? titleOf(order, status(order, today)).title : 'Delivery'} · Order Tracker`;
      v.replaceChildren(h('div', { class: 'solo' }, notices(today), order ? orderView(order, today, { back: true }) : missing));
    } else {
      const titles = { today: ['Today’s deliveries', dayLong(today)], upcoming: ['Coming up', 'After today'], received: ['Received', 'Recorded on the Hub or monday.com'] };
      const [title, sub] = titles[S.tab];
      document.title = `${title} · Order Tracker`;
      const body = S.tab === 'today' ? todayScreen(g, today) : S.tab === 'upcoming' ? upcomingScreen(g, today) : receivedScreen(g, today);
      const listCol = h('div', { class: 'col-list' }, header(title, sub, counts, today), notices(today), h('div', { class: 'col-body' }, body));
      v.replaceChildren(wide.matches ? h('div', { class: 'split' }, listCol,
        h('aside', { class: 'col-detail', 'aria-label': 'Selected delivery' }, order ? orderView(order, today) : missing || placeholder())) : listCol);
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
    if (S.busy) return;
    S.busy = true;
    const busy = on => { const b = $('#refresh'); if (b) on ? b.setAttribute('aria-busy', 'true') : b.removeAttribute('aria-busy'); };
    busy(true);
    try {
      const d = await fetchBoard();
      S.data = d; S.gotAt = Date.now(); S.err = null;
      if (!d.readAt && !d.orders.length) gate('No deliveries yet', d.failing ? `The tracker couldn’t read monday.com yet. ${d.failing}` : 'The tracker hasn’t read the Goods In board yet. It does every 5 minutes.', { retry: true });
      else render();
      if (byHand) toast(d.failing ? 'monday.com still isn’t answering' : 'Up to date');
    } catch (e) {
      const code = flrCode(e);
      if (!S.data || code === 'FLR_FORBIDDEN' || code === 'FLR_ACCOUNT_DISABLED' || expired(e) || code === 'FLR_SIGN_IN_REQUIRED') { S.data = null; failGate(e); }
      else { S.err = e; render(); if (byHand) toast('Couldn’t refresh'); }
    } finally {
      S.busy = false; busy(false);
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
