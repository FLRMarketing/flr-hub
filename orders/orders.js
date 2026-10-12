/* ============================================================================
   FLR Order Tracker: deliveries due today, and how far each order has got.
   This page is public; it holds nothing. It reads public.orders_board(), which
   only answers active accounts on the 'orders' Hub tile's list, from what the
   flr-orders function last read on the Monday "FLR - Goods In" board
   (20261012200000_flr_order_tracker.sql). Read-only: nothing here changes
   Monday. "Today" is always the day in Europe/London.

   What the board can and can't say, and so what the page claims:
   - Order confirmed: the order has a supplier order reference on Monday.
   - Dispatched / Out for delivery: never recorded on the board, so never ticked.
   - Received: Received is ticked (with Received At, and any problems found).
   - An expected time only when Monday's Date has a time; never a made-up one.
   - Delayed: the Date was moved later (the board's activity log); overdue: the
     date has passed and nothing was received or re-dated.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';            // the one FLR sign-in for the whole site
  const SIGN_IN = '../?next=orders';
  const TZ = 'Europe/London';
  const POLL_MS = 60 * 1000;                        // the page asks the database every minute; Monday is read every 5
  const STALE_MIN = 20;                             // older than this with no reason given: say it may be out of date
  const $ = (s, r = document) => r.querySelector(s);

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
  const parts = (d, o) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).formatToParts(d).map(p => [p.type, p.value]));
  const londonDay = (d = new Date()) => { const p = parts(d, { year: 'numeric', month: '2-digit', day: '2-digit' }); return `${p.year}-${p.month}-${p.day}`; };
  const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
  // A day ("2026-10-13") read as that calendar day, shown the British way.
  const asDay = (day, o) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  const dayShort = day => asDay(day, { weekday: 'short', day: 'numeric', month: 'short' });
  const dayLong = day => asDay(day, { weekday: 'long', day: 'numeric', month: 'long' });
  const clock = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  function relDay(day, today) {
    const n = daysBetween(today, day);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return dayShort(day);
  }
  function when(iso, today) {             // "14:36", "yesterday at 14:36", "Fri 9 Oct at 14:36"
    if (!iso) return '';
    const d = londonDay(new Date(iso));
    return d === today ? clock(iso) : `${relDay(d, today)} at ${clock(iso)}`;
  }
  const whenAt = (iso, today) => { const w = when(iso, today); return /^\d/.test(w) ? `at ${w}` : w; };   // "at 14:36", "yesterday at 14:36"
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

  /* ---------------------------------------------------------------- talking to the database */
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

  /* ---------------------------------------------------------------- what each order's state is, today */
  // kind: received | overdue | today | upcoming | nodate. Never more than the board says.
  function status(o, today) {
    const lines = o.items || [];
    const gotLines = lines.filter(i => i.received).length;
    const delayed = !!(o.firstDay && o.day && o.day > o.firstDay);
    const lastMove = (o.moves || []).length ? o.moves[o.moves.length - 1] : null;
    const base = { delayed, lastMove, gotLines, lines: lines.length, partly: !o.received && gotLines > 0 };
    if (o.received) return { ...base, kind: 'received', recDay: o.receivedAt ? londonDay(new Date(o.receivedAt)) : o.receivedDay || null };
    if (!o.day) return { ...base, kind: 'nodate' };
    if (o.day < today) return { ...base, kind: 'overdue', late: daysBetween(o.day, today) };
    if (o.day === today) return { ...base, kind: 'today' };
    return { ...base, kind: 'upcoming' };
  }
  // The big line: when it's expected (or was received), only as precisely as Monday knows.
  function arrival(o, s, today) {
    if (s.kind === 'received') {
      if (o.receivedAt) return { main: `Received ${when(o.receivedAt, today)}`, sub: null };
      return { main: 'Received', sub: 'Time not recorded' };
    }
    if (s.kind === 'nodate') return { main: 'No delivery date yet', sub: null };
    if (s.kind === 'overdue') return { main: `Was due ${relDay(o.day, today)}`, sub: 'Awaiting a new delivery date' };
    const day = s.kind === 'today' ? 'Due today' : `Due ${relDay(o.day, today)}`;
    if (o.at && londonDay(new Date(o.at)) === o.day) return { main: `${day} · ${clock(o.at)}`, sub: 'Time set on monday.com' };
    return { main: `${day} · time not confirmed`, sub: null };
  }
  function chip(o, s) {
    const issues = (o.issues || []).length;
    if (s.kind === 'received') return issues ? ['issues', `Received · ${plural(issues, 'problem')}`] : ['received', 'Received'];
    if (s.kind === 'overdue') return ['overdue', s.late === 1 ? '1 day overdue' : `${s.late} days overdue`];
    if (s.partly) return ['partly', `Part received · ${s.gotLines} of ${s.lines}`];
    if (s.delayed) return ['delayed', 'Delayed'];
    if (s.kind === 'nodate') return ['nodate', 'Awaiting date'];
    return ['waiting', 'Awaiting delivery'];
  }
  const DEST = { Warehouse: ['i-warehouse', 'FLR warehouse'], Site: ['i-site', 'Delivered to site'], Collection: ['i-collect', 'For collection'] };
  const destText = o => (DEST[o.destination] || [null, o.destination || 'Destination not set'])[1];
  const destIcon = o => (DEST[o.destination] || ['i-box'])[0];

  /* ---------------------------------------------------------------- state */
  const S = { data: null, gotAt: 0, err: null, busy: false, timer: 0, view: 'today', id: null };

  /* ---------------------------------------------------------------- page furniture */
  function gate(title, text, o = {}) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#gate').hidden = false; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
    $('#gate-retry').hidden = !o.retry;
    $('#refresh').hidden = true;
  }
  function bar(o) {
    $('#back').href = o.back || '../'; $('#back-label').textContent = o.backLabel || 'Hub';
    $('#bar-title').textContent = o.title || 'Order Tracker';
    document.title = `${o.title || 'Order Tracker'} · FLR Hub`;
  }
  let lastKey = '';
  function show(nodes) {
    document.body.dataset.view = 'page';
    $('#gate').hidden = true; $('#refresh').hidden = false;
    const v = $('#view'); v.hidden = false;
    const key = `${S.view}:${S.id || ''}`, same = key === lastKey; lastKey = key;
    const y = scrollY;
    v.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
    if (same) scrollTo(0, y); else { scrollTo(0, 0); $('#main').focus({ preventScroll: true }); }
    onScroll();
  }
  let raf = 0;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; $('#bar').style.setProperty('--bar-mat', Math.min(1, Math.max(0, (scrollY - 20) / 30)).toFixed(3)); });
  }
  addEventListener('scroll', onScroll, { passive: true });
  let toastTimer = 0;
  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  /* ---------------------------------------------------------------- how fresh this is: shown on every view */
  function freshness(today) {
    const d = S.data;
    const read = d.readAt ? when(d.readAt, today) : null;
    const notes = [];
    if (S.err) {
      notes.push(h('p', { class: 'fresh-note fresh-bad', role: 'status' }, icon('i-alert'),
        h('span', null, h('b', null, 'Couldn’t refresh. '), `These are the orders as the tracker had them at ${clock(new Date(S.gotAt).toISOString())}. `,
          offline(S.err) ? 'Check your connection.' : 'It will try again in a minute.'),
        h('button', { class: 'link', type: 'button', onclick: () => refresh(true) }, 'Try again')));
    }
    if (d.failing) {
      notes.push(h('p', { class: 'fresh-note fresh-warn', role: 'status' }, icon('i-alert'),
        h('span', null, h('b', null, 'monday.com isn’t answering'), d.failingSince ? ` (since ${when(d.failingSince, today)}). ` : '. ',
          read ? `Showing what it said ${whenAt(d.readAt, today)}; anything changed there since then isn’t here yet.` : 'Nothing has been read from it yet.')));
    } else if (d.readAt && Date.now() - Date.parse(d.readAt) > STALE_MIN * 60000) {
      notes.push(h('p', { class: 'fresh-note fresh-warn', role: 'status' }, icon('i-alert'),
        h('span', null, h('b', null, 'This may be out of date. '), `monday.com was last read at ${read}.`)));
    }
    return notes;
  }
  function footer(today) {
    const d = S.data;
    return h('footer', { class: 'src' },
      h('p', null, d.readAt ? `Updated from monday.com ${whenAt(d.readAt, today)}` : 'Not read from monday.com yet',
        ` · checked every ${d.every || 5} minutes`),
      h('p', null, 'From the monday.com board ', d.board && d.board.url ? h('a', { href: d.board.url, target: '_blank', rel: 'noopener' }, d.board.name || 'FLR - Goods In') : (d.board && d.board.name) || 'FLR - Goods In',
        '. Read-only: change an order on monday.com and it shows here within a few minutes.'));
  }

  /* ---------------------------------------------------------------- one order as a card */
  function materials(o, max) {
    const lines = o.items || [];
    if (!lines.length) return h('p', { class: 'card-mat card-mat-none' }, 'No products listed on monday.com');
    const shown = lines.slice(0, max);
    return h('ul', { class: 'card-mat' }, shown.map(i => h('li', { class: i.received ? 'got' : null }, i.received ? icon('i-check', 'got-tick') : null, h('span', null, i.name), i.received ? h('span', { class: 'sr' }, ' (received)') : null)),
      lines.length > max ? h('li', { class: 'more' }, `+ ${plural(lines.length - max, 'more product')}`) : null);
  }
  function card(o, today) {
    const s = status(o, today), a = arrival(o, s, today), [ck, cl] = chip(o, s);
    const sub = [a.sub];
    if (s.delayed && s.kind !== 'received' && s.kind !== 'overdue') sub.push(`Was due ${relDay(o.firstDay, today)}`);
    const label = `${o.job}. ${a.main}. ${cl}.`;
    return h('li', { class: 'oc', dataset: { kind: ck } },
      h('a', { class: 'oc-link', href: `#order/${encodeURIComponent(o.id)}`, 'aria-label': label },
        h('div', { class: 'oc-top' },
          h('p', { class: 'oc-when' }, a.main),
          h('span', { class: `st st-${ck}` }, cl)),
        sub.filter(Boolean).length ? h('p', { class: 'oc-sub' }, sub.filter(Boolean).join(' · ')) : null,
        h('p', { class: 'oc-job' }, o.job, o.wfm ? h('span', { class: 'oc-wfm' }, ` · WFM ${o.wfm}`) : null),
        h('p', { class: 'oc-meta' },
          h('span', null, o.supplier || 'Supplier not set'),
          h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'),
          h('span', null, o.ref ? `Order ${o.ref}` : 'No order number')),
        h('p', { class: 'oc-dest' }, icon(destIcon(o)), destText(o)),
        materials(o, 2),
        icon('i-chevron', 'oc-chev')));
  }
  function section(title, list, today, o = {}) {
    if (!list.length && !o.empty) return null;
    const id = 'sec-' + title.toLowerCase().replace(/[^a-z]+/g, '-');
    return h('section', { class: 'sec', 'aria-labelledby': id },
      h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title', id }, title), h('p', { class: 'sec-count' }, list.length ? String(list.length) : '')),
      o.note ? h('p', { class: 'sec-note' }, o.note) : null,
      list.length ? h('ul', { class: 'cards' }, list.map(x => card(x, today))) : h('p', { class: 'empty' }, o.empty));
  }

  /* ---------------------------------------------------------------- the main screen: today */
  const byTime = (a, b) => (a.at || '9') .localeCompare(b.at || '9') || a.job.localeCompare(b.job);
  function todayView() {
    const today = londonDay(), orders = S.data.orders;
    bar({ title: 'Order Tracker' });
    const st = new Map(orders.map(o => [o.id, status(o, today)]));
    const dueToday = orders.filter(o => st.get(o.id).kind === 'today').sort(byTime);
    const overdue = orders.filter(o => st.get(o.id).kind === 'overdue').sort((a, b) => a.day.localeCompare(b.day) || a.job.localeCompare(b.job));
    // Delayed: it should have come by now (its first date has passed) but has a new, later date.
    const delayed = orders.filter(o => { const s = st.get(o.id); return s.kind === 'upcoming' && s.delayed && o.firstDay <= today; }).sort((a, b) => a.day.localeCompare(b.day));
    const gotToday = orders.filter(o => { const s = st.get(o.id); return s.kind === 'received' && s.recDay === today; })
      .sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
    const upcoming = orders.filter(o => st.get(o.id).kind === 'upcoming').length;
    const noDate = orders.filter(o => st.get(o.id).kind === 'nodate').length;

    const attention = [...overdue, ...delayed];
    const summary = [dueToday.length ? plural(dueToday.length, 'delivery', 'deliveries') + ' still to come' : gotToday.length ? 'Nothing more to come' : 'No deliveries due today'];
    if (attention.length) summary.push(`${attention.length} late or delayed`);
    if (gotToday.length) summary.push(`${gotToday.length} received`);
    const head = h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, dayLong(today)),
      h('h1', { class: 'display' }, 'Orders due today'),
      h('p', { class: 'lede-line' }, summary.join(' · ')));
    const earlier = orders.filter(o => { const s = st.get(o.id); return s.kind === 'received' && s.recDay !== today; }).length;
    return [head, freshness(today),
      section('Still to arrive', dueToday, today, { empty: gotToday.length ? 'Everything due today has arrived.' : 'Nothing is due today.' }),
      attention.length ? section('Late or delayed', attention, today, {
        note: 'Overdue: the date has passed and nothing is ticked as received or given a new date on monday.com. Delayed: its date on monday.com was moved later.' }) : null,
      section('Received today', gotToday, today),
      h('nav', { class: 'more-nav', 'aria-label': 'Other orders' },
        h('a', { class: 'more-row', href: '#upcoming' }, h('span', null, 'Coming up'), h('span', { class: 'more-n' }, upcoming + noDate ? String(upcoming + noDate) : 'None'), icon('i-chevron')),
        h('a', { class: 'more-row', href: '#received' }, h('span', null, 'Received earlier'), h('span', { class: 'more-n' }, earlier ? String(earlier) : 'None'), icon('i-chevron'))),
      footer(today)];
  }

  /* ---------------------------------------------------------------- coming up, and received earlier */
  function upcomingView() {
    const today = londonDay(), orders = S.data.orders;
    bar({ title: 'Coming up', back: '#', backLabel: 'Today' });
    const up = orders.filter(o => status(o, today).kind === 'upcoming').sort((a, b) => a.day.localeCompare(b.day) || byTime(a, b));
    const days = [...new Set(up.map(o => o.day))];
    const noDate = orders.filter(o => status(o, today).kind === 'nodate');
    return [h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Order Tracker'), h('h1', { class: 'display' }, 'Coming up')),
      freshness(today),
      days.length ? days.map(d => section(daysBetween(today, d) === 1 ? `Tomorrow, ${dayShort(d)}` : dayLong(d), up.filter(o => o.day === d), today)) : h('p', { class: 'empty' }, 'Nothing is booked in after today.'),
      section('No delivery date yet', noDate, today),
      footer(today)];
  }
  function receivedView() {
    const today = londonDay(), orders = S.data.orders;
    bar({ title: 'Received earlier', back: '#', backLabel: 'Today' });
    const got = orders.map(o => [o, status(o, today)]).filter(([, s]) => s.kind === 'received' && s.recDay !== today)
      .sort(([a, x], [b, y]) => (y.recDay || '').localeCompare(x.recDay || '') || (b.receivedAt || '').localeCompare(a.receivedAt || ''));
    const days = [...new Set(got.map(([, s]) => s.recDay || ''))];
    return [h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Order Tracker'), h('h1', { class: 'display' }, 'Received earlier'),
      h('p', { class: 'lede-line' }, 'Everything ticked as received on monday.com before today, newest first.')),
      freshness(today),
      got.length ? days.map(d => section(d ? (daysBetween(d, today) === 1 ? `Yesterday, ${dayShort(d)}` : dayLong(d)) : 'Date not recorded', got.filter(([, s]) => (s.recDay || '') === d).map(([o]) => o), today))
        : h('p', { class: 'empty' }, 'Nothing was received before today.'),
      footer(today)];
  }

  /* ---------------------------------------------------------------- one order: details and progress */
  function step(state, title, text, extra) {
    return h('li', { class: `step step-${state}` },
      h('span', { class: 'step-dot', 'aria-hidden': 'true' }, state === 'done' ? icon('i-check') : null),
      h('div', { class: 'step-body' },
        h('p', { class: 'step-title' }, title, h('span', { class: 'sr' }, state === 'done' ? ' (done)' : state === 'now' ? ' (in progress)' : state === 'untracked' ? ' (not recorded)' : ' (not yet)')),
        text ? h('p', { class: 'step-text' }, text) : null, extra || null));
  }
  function timeline(o, s, today) {
    const confirmed = !!o.ref;
    const recState = s.kind === 'received' ? 'done' : s.partly ? 'now' : 'todo';
    const recText = s.kind === 'received'
      ? [o.receivedAt ? `Received ${when(o.receivedAt, today)}` : 'Ticked as received; the time wasn’t recorded', (o.issues || []).length ? `Problems found: ${o.issues.join(', ')}` : 'No problems recorded'].join('. ') + '.'
      : s.partly ? `${s.gotLines} of ${s.lines} products ticked as received.`
      : arrival(o, s, today).main + '.';
    return h('ol', { class: 'steps', 'aria-label': 'Delivery progress' },
      step(confirmed ? 'done' : 'now', 'Order confirmed', confirmed ? `Order ${o.ref}${o.supplier ? ` with ${o.supplier}` : ''}.` : 'No supplier order number on monday.com yet.'),
      step('untracked', 'Dispatched', 'Not recorded on the Goods In board.'),
      step('untracked', 'Out for delivery', 'Not recorded on the Goods In board.'),
      step(recState, 'Received', recText));
  }
  function row(label, value, o = {}) {
    return h('div', { class: 'drow' }, h('dt', null, label), h('dd', { class: o.cls || null }, value == null || value === '' ? h('span', { class: 'none' }, o.none || 'Not on monday.com') : value));
  }
  function orderView(id) {
    const today = londonDay();
    const o = S.data.orders.find(x => x.id === id);
    if (!o) {
      bar({ title: 'Order', back: '#', backLabel: 'Today' });
      return [h('div', { class: 'gate-message' }, h('h2', { class: 'gate-title' }, 'That order isn’t on the board now'),
        h('p', { class: 'gate-text' }, 'It may have been deleted or moved on monday.com.'),
        h('p', { class: 'gate-actions' }, h('a', { class: 'btn btn-primary', href: '#' }, 'Back to today’s orders')))];
    }
    const s = status(o, today), a = arrival(o, s, today), [ck, cl] = chip(o, s);
    bar({ title: o.job, back: S.from || '#', backLabel: S.from === '#upcoming' ? 'Coming up' : S.from === '#received' ? 'Received' : 'Today' });
    const latest = (o.updates || [])[0];

    const hero = h('section', { class: 'hero', dataset: { kind: ck }, 'aria-labelledby': 'hero-when' },
      h('p', { class: 'hero-job' }, o.job),
      h('h1', { class: 'hero-when', id: 'hero-when' }, a.main),
      h('div', { class: 'hero-line' }, h('span', { class: `st st-${ck}` }, cl), a.sub ? h('span', { class: 'hero-sub' }, a.sub) : null),
      h('p', { class: 'hero-dest' }, icon(destIcon(o)), destText(o), o.supplier ? ` · from ${o.supplier}` : ''));

    let delay = null;
    if (s.kind !== 'received' && (s.delayed || s.kind === 'overdue')) {
      const m = s.lastMove;
      delay = h('section', { class: `delay delay-${s.kind === 'overdue' ? 'overdue' : 'moved'}`, 'aria-labelledby': 'delay-title' },
        h('h2', { class: 'delay-title', id: 'delay-title' }, icon('i-alert'), s.kind === 'overdue' ? 'Overdue, awaiting a new date' : 'Delivery date moved later'),
        s.kind === 'overdue'
          ? h('p', null, `It was due ${dayLong(o.day)} and isn’t ticked as received. Nobody has given it a new date on monday.com yet.`)
          : h('p', null, `First due ${dayLong(o.firstDay)}, now ${dayLong(o.day)}.`, m ? ` Changed on monday.com ${whenAt(m.at, today)}.` : ''),
        latest ? h('p', { class: 'delay-why' }, h('b', null, 'Latest note: '), `“${latest.text}”`) : h('p', { class: 'delay-why none' }, 'No reason has been noted on monday.com.'));
    }

    const mats = o.items || [];
    return [hero, delay,
      h('section', { class: 'blk', 'aria-labelledby': 'tl-title' }, h('h2', { class: 'blk-title', id: 'tl-title' }, 'Progress'), timeline(o, s, today),
        h('p', { class: 'blk-note' }, 'The Goods In board records when an order is placed and when it arrives. Dispatch and out-for-delivery aren’t recorded there, so they’re never ticked here.')),
      h('section', { class: 'blk', 'aria-labelledby': 'mat-title' }, h('h2', { class: 'blk-title', id: 'mat-title' }, 'Materials', mats.length ? h('span', { class: 'blk-count' }, ` ${mats.length}`) : null),
        mats.length ? h('ul', { class: 'mats' }, mats.map(i => h('li', { class: i.received ? 'got' : null },
          h('span', { class: 'mat-name' }, i.name),
          h('span', { class: 'mat-state' }, i.received ? [icon('i-check'), i.receivedAt ? `Received ${when(i.receivedAt, today)}` : 'Received'] : (i.issues || []).length ? i.issues.join(', ') : ''))))
          : h('p', { class: 'empty' }, 'No products are listed for this order on monday.com.'),
        mats.length ? h('p', { class: 'blk-note' }, 'Quantities are as written in each product’s name on monday.com.') : null),
      h('section', { class: 'blk', 'aria-labelledby': 'det-title' }, h('h2', { class: 'blk-title', id: 'det-title' }, 'Order details'),
        h('dl', { class: 'details' },
          row('Supplier', o.supplier),
          row('Order number', o.ref, { none: 'No order number on monday.com' }),
          row('Job', o.job),
          row('WFM job', o.wfm),
          row('Destination', o.destination ? destText(o) : null),
          row('Expected', o.day ? `${dayLong(o.day)}${o.at && londonDay(new Date(o.at)) === o.day ? `, ${clock(o.at)}` : ', time not confirmed'}` : null, { none: 'No date yet' }),
          s.delayed ? row('First due', dayLong(o.firstDay)) : null,
          s.kind === 'received' ? row('Received', o.receivedAt ? `${dayLong(londonDay(new Date(o.receivedAt)))}, ${clock(o.receivedAt)}` : 'Yes, time not recorded') : null,
          (o.issues || []).length ? row('Problems found', o.issues.join(', '), { cls: 'bad' }) : null)),
      h('section', { class: 'blk', 'aria-labelledby': 'up-title' }, h('h2', { class: 'blk-title', id: 'up-title' }, 'Latest updates'),
        (o.updates || []).length ? h('ul', { class: 'updates' }, o.updates.map(u => h('li', null,
          h('p', { class: 'up-text' }, u.text), h('p', { class: 'up-meta' }, [u.by, u.at ? when(u.at, today) : ''].filter(Boolean).join(' · ')))))
          : h('p', { class: 'empty' }, 'No updates have been written on this order on monday.com.'),
        o.updatedAt ? h('p', { class: 'blk-note' }, `Last changed on monday.com ${whenAt(o.updatedAt, today)}.`) : null),
      o.url ? h('p', { class: 'open-monday' }, h('a', { class: 'btn btn-plain', href: o.url, target: '_blank', rel: 'noopener' }, 'Open in monday.com', icon('i-external'))) : null,
      footer(today)];
  }

  /* ---------------------------------------------------------------- loading, refreshing, the router */
  function render() {
    if (!S.data) return;
    const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (p[0] === 'order' && p[1]) { S.view = 'order'; S.id = decodeURIComponent(p[1]); return show(orderView(S.id)); }
    S.id = null;
    if (p[0] === 'upcoming') { S.view = 'upcoming'; S.from = '#upcoming'; return show(upcomingView()); }
    if (p[0] === 'received') { S.view = 'received'; S.from = '#received'; return show(receivedView()); }
    S.view = 'today'; S.from = '#';
    return show(todayView());
  }
  function failGate(e) {
    const code = flrCode(e);
    if (expired(e) || code === 'FLR_SIGN_IN_REQUIRED') return location.replace(SIGN_IN);
    if (code === 'FLR_FORBIDDEN') return gate('You don’t have access to the Order Tracker', 'It’s switched on for the FLR staff who need it. If you think you should have it, ask an FLR Super Admin.');
    if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
    if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
    if (missingFunction(e)) return gate('The Order Tracker isn’t ready yet', 'The FLR database doesn’t have the Order Tracker yet.');
    if (offline(e)) return gate('Can’t reach the FLR database', 'Check your connection and try again.', { retry: true });
    return gate('The orders didn’t load', 'Something went wrong getting them. Try again in a moment.', { retry: true });
  }
  async function refresh(byHand) {
    if (S.busy) return;
    S.busy = true;
    const btn = $('#refresh'); btn.setAttribute('aria-busy', 'true');
    try {
      const d = await fetchBoard();
      S.data = d; S.gotAt = Date.now(); S.err = null;
      if (!d.readAt && !d.orders.length) gate('No orders yet', d.failing ? `The tracker couldn’t read monday.com yet. ${d.failing}` : 'The tracker hasn’t read the Goods In board on monday.com yet. It does every 5 minutes.', { retry: true });
      else render();
      if (byHand) toast(d.failing ? 'monday.com still isn’t answering' : 'Up to date');
    } catch (e) {
      const code = flrCode(e);
      if (!S.data || code === 'FLR_FORBIDDEN' || code === 'FLR_ACCOUNT_DISABLED' || expired(e) || code === 'FLR_SIGN_IN_REQUIRED') { S.data = null; failGate(e); }
      else { S.err = e; render(); if (byHand) toast('Couldn’t refresh'); }
    } finally {
      S.busy = false; btn.removeAttribute('aria-busy');
    }
  }
  function schedule() {
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, POLL_MS);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data && Date.now() - S.gotAt > POLL_MS) refresh(false); });
  addEventListener('hashchange', render);
  $('#refresh').addEventListener('click', () => refresh(true));
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
