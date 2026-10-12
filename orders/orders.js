/* ============================================================================
   FLR Order Tracker: deliveries due today, and how far each order has got.
   This page is public; it holds nothing. It reads public.orders_board(), which
   only answers active accounts on the 'orders' Hub tile's list, from what the
   flr-orders function last read on the Monday "FLR - Goods In" board
   (20261012200000_flr_order_tracker.sql). Read-only: nothing here changes
   Monday. "Today" is always the day in Europe/London.

   What the board can and can't say, and so what the page claims:
   - Order reference recorded: the order has an order number on Monday. That's
     the reference staff typed in; it doesn't show the supplier confirmed it.
   - Delivery date set, with any moves (the board's activity log).
   - Received: Received ticked, with any products or problems still outstanding.
   - Supplier confirmation, dispatch and out for delivery aren't on the board,
     so the page doesn't show them as stages at all.
   - An expected time only when Monday's Date has a time; never a made-up one.
   - Delayed / Date moved / Overdue / part received: rules.js.
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
  const londonDay = d => window.FLR_ORDER_RULES.londonDay(d);
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
  const whenAt = (iso, today) => { const w = when(iso, today); return /^\d/.test(w) ? `at ${w}` : /^(today|yesterday|tomorrow)/.test(w) ? w : `on ${w}`; };   // "at 14:36", "yesterday at 14:36", "on Fri 9 Oct at 14:36"
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

  /* ---------------------------------------------------------------- what each order's state is, today (rules.js) */
  const R = window.FLR_ORDER_RULES;
  const status = R.status;
  const outText = s => s.outstanding.length ? `${plural(s.outstanding.length, 'product')} still to come` : '“Item missing” logged';
  // What has and hasn't arrived, in a line.
  function partText(o, s) {
    if (!s.lines) return '“Item missing” logged on monday.com';
    if (o.received && !s.got) return 'Ticked as received, but none of its products are';
    if (!s.outstanding.length) return '“Item missing” logged on monday.com';
    return `${s.got} of ${s.lines} received · ${outText(s)}`;
  }
  // The big line: when it's expected (or was received), only as precisely as Monday knows.
  function arrival(o, s, today) {
    if (s.kind === 'received') {
      if (o.receivedAt) return { main: `Received ${when(o.receivedAt, today)}`, sub: null };
      return { main: 'Received', sub: 'Time not recorded' };
    }
    if (s.kind === 'nodate') return { main: 'No delivery date yet', sub: null };
    if (s.kind === 'overdue') return { main: `Was due ${relDay(o.day, today)}`, sub: s.partial ? null : 'Awaiting a new delivery date' };
    const day = s.kind === 'today' ? 'Due today' : `Due ${relDay(o.day, today)}`;
    if (o.at && londonDay(new Date(o.at)) === o.day) return { main: `${day} · ${clock(o.at)}`, sub: 'Time set on monday.com' };
    return { main: `${day} · time not confirmed`, sub: null };
  }
  function chip(o, s) {
    const issues = (o.issues || []).length;
    if (s.kind === 'received') return issues ? ['issues', `Received · ${plural(issues, 'problem')}`] : ['received', 'Received'];
    if (s.kind === 'overdue') return ['overdue', s.late === 1 ? '1 day overdue' : `${s.late} days overdue`];
    if (s.partial) return ['partly', 'Part received'];
    if (s.delay === 'active') return ['delayed', 'Delayed'];
    if (s.delay === 'moved') return ['moved', 'Date moved'];
    if (s.kind === 'nodate') return ['nodate', 'Awaiting date'];
    return ['waiting', 'Awaiting delivery'];
  }
  // The second line on a card: what's still to come, or why the date isn't the first one.
  function subLines(o, s, a, today) {
    const out = [a.sub];
    if (s.partial) out.push(partText(o, s));
    if (s.kind !== 'received' && s.kind !== 'overdue') {
      if (s.delay === 'active') out.push(`Was due ${relDay(o.firstDay, today)}`);
      else if (s.delay === 'moved') out.push(`Moved from ${dayShort(o.firstDay)}`);
    }
    return out.filter(Boolean);
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
  function materials(o, max, s) {
    const lines = o.items || [];
    if (!lines.length) return h('p', { class: 'card-mat card-mat-none' }, 'No products listed on monday.com');
    if (s && s.partial && s.outstanding.length) {   // what's still to come first; what's in, as a count
      const out = s.outstanding.slice(0, max);
      return h('ul', { class: 'card-mat card-mat-out' }, h('li', { class: 'mat-head' }, 'Still to come'),
        out.map(i => h('li', null, h('span', null, i.name))),
        s.outstanding.length > max ? h('li', { class: 'more' }, `+ ${plural(s.outstanding.length - max, 'more product')} to come`) : null,
        s.got ? h('li', { class: 'more got' }, icon('i-check', 'got-tick'), h('span', null, `${plural(s.got, 'product')} received`)) : null);
    }
    const shown = lines.slice(0, max);
    return h('ul', { class: 'card-mat' }, shown.map(i => h('li', { class: i.received ? 'got' : null }, i.received ? icon('i-check', 'got-tick') : null, h('span', null, i.name), i.received ? h('span', { class: 'sr' }, ' (received)') : null)),
      lines.length > max ? h('li', { class: 'more' }, `+ ${plural(lines.length - max, 'more product')}`) : null);
  }
  function card(o, today) {
    const s = status(o, today), a = arrival(o, s, today), [ck, cl] = chip(o, s);
    const sub = subLines(o, s, a, today);
    const label = `${o.job}. ${a.main}. ${cl}.${sub.length ? ' ' + sub.join('. ') + '.' : ''}`;
    return h('li', { class: 'oc', dataset: { kind: ck } },
      h('a', { class: 'oc-link', href: `#order/${encodeURIComponent(o.id)}`, 'aria-label': label },
        h('div', { class: 'oc-top' },
          h('p', { class: 'oc-when' }, a.main),
          h('span', { class: `st st-${ck}` }, cl)),
        sub.length ? h('p', { class: 'oc-sub' }, sub.join(' · ')) : null,
        h('p', { class: 'oc-job' }, o.job, o.wfm ? h('span', { class: 'oc-wfm' }, ` · WFM ${o.wfm}`) : null),
        h('p', { class: 'oc-meta' },
          h('span', null, o.supplier || 'Supplier not set'),
          h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'),
          h('span', null, o.ref ? `Ref ${o.ref}` : 'No order reference')),
        h('p', { class: 'oc-dest' }, icon(destIcon(o)), destText(o)),
        materials(o, 2, s),
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
    const b = new Map(orders.map(o => [o.id, R.bucket(o, status(o, today), today)]));
    const inB = k => orders.filter(o => b.get(o.id) === k);
    const dueToday = inB('dueToday').sort(byTime);
    // Overdue first (oldest first), then delayed orders that now have a later date.
    const overdueFirst = (x, y) => Number(y.day < today) - Number(x.day < today) || x.day.localeCompare(y.day) || x.job.localeCompare(y.job);
    const attention = inB('late').sort(overdueFirst);
    const gotToday = inB('receivedToday').sort((x, y) => (y.receivedAt || '').localeCompare(x.receivedAt || ''));
    const upcoming = inB('upcoming').length, noDate = inB('nodate').length;

    const summary = [dueToday.length ? plural(dueToday.length, 'delivery', 'deliveries') + ' still to come' : gotToday.length ? 'Nothing more to come' : 'No deliveries due today'];
    if (attention.length) summary.push(`${attention.length} late or delayed`);
    if (gotToday.length) summary.push(`${gotToday.length} received`);
    const head = h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, dayLong(today)),
      h('h1', { class: 'display' }, 'Orders due today'),
      h('p', { class: 'lede-line' }, summary.join(' · ')));
    const earlier = inB('receivedEarlier').length;
    return [head, freshness(today),
      section('Still to arrive', dueToday, today, { empty: gotToday.length ? 'Everything due today has arrived.' : 'Nothing is due today.' }),
      attention.length ? section('Late or delayed', attention, today, {
        note: 'Overdue: its date has passed and it isn’t all ticked as received. Delayed: its first date has come and gone, and monday.com now gives a later one.' }) : null,
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
    const bk = o => R.bucket(o, status(o, today), today);
    const up = orders.filter(o => bk(o) === 'upcoming').sort((a, b) => a.day.localeCompare(b.day) || byTime(a, b));
    const days = [...new Set(up.map(o => o.day))];
    const noDate = orders.filter(o => bk(o) === 'nodate');
    return [h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Order Tracker'), h('h1', { class: 'display' }, 'Coming up')),
      freshness(today),
      h('p', { class: 'lede-line' }, 'Delayed orders are on the main screen until they arrive.'),
      days.length ? days.map(d => section(daysBetween(today, d) === 1 ? `Tomorrow, ${dayShort(d)}` : dayLong(d), up.filter(o => o.day === d), today)) : h('p', { class: 'empty' }, 'Nothing else is booked in after today.'),
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
      h('p', { class: 'lede-line' }, 'Fully received before today, newest first. Anything with products still to come stays on the main screen.')),
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
        h('p', { class: 'step-title' }, title, h('span', { class: 'sr' }, state === 'done' ? ' (done)' : state === 'now' ? ' (in progress)' : ' (not yet)')),
        text ? h('p', { class: 'step-text' }, text) : null, extra || null));
  }
  // Only what monday.com records: the reference, the delivery date (and its moves), and what has been received.
  function timeline(o, s, today) {
    const timed = o.at && londonDay(new Date(o.at)) === o.day;
    const dateText = o.day ? [`${dayLong(o.day)}${timed ? `, ${clock(o.at)}` : ', time not confirmed'}.`,
      s.moved ? `First due ${dayLong(o.firstDay)}${s.lastMove ? `; changed ${whenAt(s.lastMove.at, today)}` : ''}.` : ''].filter(Boolean).join(' ') : 'No delivery date on monday.com yet.';
    const recState = s.kind === 'received' ? 'done' : s.partial ? 'now' : 'todo';
    const recText = s.kind === 'received'
      ? [o.receivedAt ? `Received ${when(o.receivedAt, today)}` : 'Ticked as received; the time wasn’t recorded', (o.issues || []).length ? `Problems found: ${o.issues.join(', ')}` : 'No problems recorded'].join('. ') + '.'
      : s.partial ? `${partText(o, s)}.`
      : 'Not ticked as received on monday.com yet.';
    return h('ol', { class: 'steps', 'aria-label': 'What monday.com records' },
      step(o.ref ? 'done' : 'todo', 'Order reference recorded', o.ref ? `Reference ${o.ref}${o.supplier ? ` for ${o.supplier}` : ''}.` : 'No order reference on monday.com yet.'),
      step(o.day ? 'done' : 'todo', 'Delivery date set', dateText),
      step(recState, s.partial ? 'Part received' : 'Received', recText));
  }
  function matList(list, today) {
    return h('ul', { class: 'mats' }, list.map(i => h('li', { class: i.received ? 'got' : null },
      h('span', { class: 'mat-name' }, i.name),
      h('span', { class: 'mat-state' }, i.received ? [icon('i-check'), i.receivedAt ? `Received ${when(i.receivedAt, today)}` : 'Received'] : 'Not received yet',
        (i.issues || []).length ? h('span', { class: 'mat-issue' }, ` · ${i.issues.join(', ')}`) : null))));
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

    // Late, delayed or just moved: only while something is still to come.
    let delay = null;
    if (s.kind !== 'received' && (s.kind === 'overdue' || s.delay)) {
      const m = s.lastMove, kind = s.kind === 'overdue' ? 'overdue' : s.delay === 'active' ? 'active' : 'moved';
      const title = { overdue: s.partial ? 'Overdue: not all of it has arrived' : 'Overdue, awaiting a new date', active: `Delayed: now due ${dayShort(o.day)}`, moved: 'Delivery date moved' }[kind];
      const text = {
        overdue: s.partial ? `It was due ${dayLong(o.day)}. ${s.outstanding.length ? `Part of it has arrived; ${outText(s)}` : 'It’s ticked as received, but “Item missing” is logged'}, and there’s no new date on monday.com.`
          : `It was due ${dayLong(o.day)} and isn’t ticked as received. Nobody has given it a new date on monday.com yet.`,
        active: `It was first due ${dayLong(o.firstDay)} and should have arrived by now. monday.com now says ${dayLong(o.day)}.`,
        moved: `First due ${dayLong(o.firstDay)}, now ${dayLong(o.day)}. It isn’t late: the first date hasn’t come yet.`,
      }[kind];
      delay = h('section', { class: `delay delay-${kind}`, 'aria-labelledby': 'delay-title' },
        h('h2', { class: 'delay-title', id: 'delay-title' }, icon(kind === 'moved' ? 'i-note' : 'i-alert'), title),
        h('p', null, text, m && kind !== 'overdue' ? ` Changed on monday.com ${whenAt(m.at, today)}.` : ''),
        latest ? h('p', { class: 'delay-why' }, h('b', null, 'Latest note: '), `“${latest.text}”`) : h('p', { class: 'delay-why none' }, 'No reason has been noted on monday.com.'));
    }

    const mats = o.items || [];
    return [hero, delay,
      h('section', { class: 'blk', 'aria-labelledby': 'tl-title' }, h('h2', { class: 'blk-title', id: 'tl-title' }, 'Progress'), timeline(o, s, today),
        h('p', { class: 'blk-note' }, 'These are the three things the Goods In board records. It doesn’t record whether the supplier has confirmed, dispatched or sent out the order, so the tracker doesn’t show those.')),
      h('section', { class: 'blk', 'aria-labelledby': 'mat-title' }, h('h2', { class: 'blk-title', id: 'mat-title' }, 'Materials', mats.length ? h('span', { class: 'blk-count' }, ` ${mats.length}`) : null),
        s.partial && s.outstanding.length ? [h('h3', { class: 'mat-group' }, `Still to come · ${s.outstanding.length}`), matList(s.outstanding, today),
          s.got ? [h('h3', { class: 'mat-group' }, `Received · ${s.got}`), matList(mats.filter(i => !s.outstanding.includes(i)), today)] : null]
          : mats.length ? matList(mats, today)
          : h('p', { class: 'empty' }, 'No products are listed for this order on monday.com.'),
        s.missingReported ? h('p', { class: 'mat-missing' }, icon('i-alert'), '“Item missing” is logged on this order on monday.com.') : null,
        mats.length ? h('p', { class: 'blk-note' }, 'Quantities are as written in each product’s name on monday.com.') : null),
      h('section', { class: 'blk', 'aria-labelledby': 'det-title' }, h('h2', { class: 'blk-title', id: 'det-title' }, 'Order details'),
        h('dl', { class: 'details' },
          row('Supplier', o.supplier),
          row('Order reference', o.ref, { none: 'No order reference on monday.com' }),
          row('Job', o.job),
          row('WFM job', o.wfm),
          row('Destination', o.destination ? destText(o) : null),
          row('Expected', o.day ? `${dayLong(o.day)}${o.at && londonDay(new Date(o.at)) === o.day ? `, ${clock(o.at)}` : ', time not confirmed'}` : null, { none: 'No date yet' }),
          s.moved ? row('First due', `${dayLong(o.firstDay)} (moved${s.lastMove ? ` ${whenAt(s.lastMove.at, today)}` : ''})`) : null,
          o.received ? row(s.partial ? 'Ticked as received' : 'Received', o.receivedAt ? `${dayLong(londonDay(new Date(o.receivedAt)))}, ${clock(o.receivedAt)}` : 'Yes, time not recorded') : null,
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
