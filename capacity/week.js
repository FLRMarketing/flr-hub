/* ============================================================================
   FLR Hub: the Planner's Week view (tab "Week"; capacity.js holds the Month view, the sign-in and the data).
   An Outlook-style week, Monday to Sunday: who is booked where each day.

   The data: planner_board() since Planner 1.4 (Estimator repo 20261028100000_flr_planner_week.sql) also returns
     bookings: [ { job: {id, name, site, postcode, address, wfm}, sub: {id, name}, kind: 'work' | 'unassigned',
                   status, days: ['YYYY-MM-DD'], people: [{name, tag?: 'flr' | 'sub'}] },
                 { kind: 'away', day, people: ['name'] } ],
     bookingsFrom, bookingsTo     the window they cover (4 weeks back to 16 weeks ahead, whole weeks)
   made by flr-planner from the Monday Work Programme every 15 minutes, by the same rules as the totals.

   What the week shows:
   - each job (one Work Programme item: grouped by its item ID only, never by name) as a card across the days it is
     booked that week; a gap in its days starts a new card, so a card never covers a day nobody is booked. The fitters
     are shown once when the same every day, else day by day inside the card. All-TBC days: dashed (Outlook's
     "tentative"); Scheduled: solid. Tap a card for its details (address, WFM, every loaded day with who and status);
   - bookings with no fitter: gold "Needs a fitter" cards (no fitter, the "FLR Fitter TBC" placeholder, or only leavers);
   - an "Away" line per day with names only (leave, sickness, appointments, training, Not Working: never which);
   - bank holidays, company close days and the Jeff Day hatched, with the name, as on the Month view;
   - each day's capacity badge (N/23, gold number) from the same totals as the Month view.
   Outside the loaded window the week says "No bookings loaded for this week" rather than showing empty days.
   Phones (640px and narrower): the same week as a day-by-day list.
   CSP: no inline styles; sizes and grid places are set with element.style.
   ========================================================================== */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  let P = null;            // capacity.js's parts (h, icon, battery, ...)
  let PLAN = null;         // the current planner_board() answer, checked
  let IDX = null;          // indexes built from PLAN
  let shownMon = null;     // the Monday of the week shown
  let miniMonth = null;    // the month shown in the mini calendar (1st of the month)

  /* ---------------------------------------------------------------- dates */
  const startOfDay = dt => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const addDays = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x; };
  const iso = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const mondayOf = dt => addDays(startOfDay(dt), -((dt.getDay() + 6) % 7));
  // ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday)
  function isoWeek(dt) {
    const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - y0) / 864e5 + 1) / 7);
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const dd = d => String(d.getDate()).padStart(2, '0');
  // "26 October – 01 November, 2026"; "02–08 November, 2026"; "28 December, 2026 – 03 January, 2027"
  function rangeText(mon) {
    const sun = addDays(mon, 6);
    if (mon.getFullYear() !== sun.getFullYear()) return `${dd(mon)} ${MONTHS[mon.getMonth()]}, ${mon.getFullYear()} – ${dd(sun)} ${MONTHS[sun.getMonth()]}, ${sun.getFullYear()}`;
    if (mon.getMonth() !== sun.getMonth()) return `${dd(mon)} ${MONTHS[mon.getMonth()]} – ${dd(sun)} ${MONTHS[sun.getMonth()]}, ${sun.getFullYear()}`;
    return `${dd(mon)}–${dd(sun)} ${MONTHS[mon.getMonth()]}, ${mon.getFullYear()}`;
  }
  const fmtShort = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtWindow = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const today = () => startOfDay(new Date());

  /* ---------------------------------------------------------------- the data, indexed */
  // jobs: id -> { job, days: Map(day -> { people: [{name, tag}], statuses: Set, subs: [sub] }), need: Map(day -> n) }
  function index(plan) {
    const jobs = new Map(), away = new Map();
    for (const b of plan.bookings) {
      if (b.kind === 'away') { away.set(b.day, b.people); continue; }
      let j = jobs.get(b.job.id);
      if (!j) jobs.set(b.job.id, j = { job: b.job, days: new Map(), need: new Map(), subs: new Map() });
      j.subs.set(b.sub.id, b.sub);
      for (const d of b.days) {
        if (b.kind === 'unassigned') { const n = j.need.get(d) || { n: 0, statuses: new Set(), subs: [] }; n.n++; n.statuses.add(b.status); n.subs.push(b.sub); j.need.set(d, n); continue; }
        let x = j.days.get(d);
        if (!x) j.days.set(d, x = { people: [], names: new Set(), statuses: new Set(), subs: [] });
        for (const p of b.people) if (!x.names.has(p.name)) { x.names.add(p.name); x.people.push(p); }
        x.statuses.add(b.status); x.subs.push(b.sub);
      }
    }
    return { jobs, away };
  }
  const loaded = mon => !!(PLAN && PLAN.bookingsFrom && PLAN.bookingsTo && iso(mon) >= PLAN.bookingsFrom && iso(addDays(mon, 6)) <= PLAN.bookingsTo);
  const allTbc = statuses => statuses.size > 0 && [...statuses].every(s => s === 'TBC');
  const peopleKey = ps => ps.map(p => p.name + '|' + (p.tag || '')).sort().join(',');

  // The week's cards: runs of consecutive booked days per job (work), and per job (needs a fitter).
  function cardsFor(mon) {
    const days = Array.from({ length: 7 }, (_, i) => iso(addDays(mon, i)));
    const cards = [];
    for (const j of IDX.jobs.values()) {
      for (const kind of ['need', 'work']) {
        const map = kind === 'work' ? j.days : j.need;
        let run = null;
        days.forEach((d, i) => {
          const x = map.get(d);
          if (!x) { run = null; return; }
          if (!run) cards.push(run = { kind, job: j, start: i, len: 0, per: [] });
          run.len++; run.per.push({ day: d, ...x });
        });
      }
    }
    // gold cards first, then by first day, longest first, then name: Outlook-like, and the gaps are easy to spot
    cards.sort((a, b) => (a.kind === 'need' ? 0 : 1) - (b.kind === 'need' ? 0 : 1) || a.start - b.start || b.len - a.len || a.job.job.name.localeCompare(b.job.job.name));
    const lanes = [];
    for (const c of cards) {
      let l = 0;
      while ((lanes[l] || []).some(x => !(x.start + x.len <= c.start || c.start + c.len <= x.start))) l++;
      (lanes[l] = lanes[l] || []).push(c); c.lane = l;
    }
    return { days, cards, lanes: lanes.length };
  }

  /* ---------------------------------------------------------------- pieces */
  const h = (...a) => P.h(...a);
  function chip(p) {
    return h('span', { class: 'chip' + (p.tag ? ' t-' + p.tag : '') }, h('span', { class: 'cn' }, p.name),
      p.tag ? h('span', { class: 'tg', title: p.tag === 'flr' ? 'FLR staff' : 'Subcontractor' }, p.tag === 'flr' ? 'FLR staff' : 'Sub') : null);
  }
  // "Moseley · B13 8RD"; the postcode once when the site already ends with it
  const siteLine = job => [job.site, job.postcode && !job.site.toUpperCase().includes(job.postcode.toUpperCase()) ? job.postcode : ''].filter(Boolean).join(' · ');
  const names = ps => ps.map(p => p.name + (p.tag === 'flr' ? ' (FLR staff)' : p.tag === 'sub' ? ' (subcontractor)' : '')).join(', ');
  function cardLabel(c) {
    const first = fromIso(c.per[0].day), last = fromIso(c.per[c.per.length - 1].day);
    const when = c.len === 1 ? fmtLong.format(first) : `${fmtShort.format(first)} to ${fmtShort.format(last)}`;
    const site = siteLine(c.job.job);
    if (c.kind === 'need') return `Needs a fitter: ${c.job.job.name}${site ? ', ' + site : ''}. ${when}. Open the details`;
    const same = c.per.every(x => peopleKey(x.people) === peopleKey(c.per[0].people));
    const who = same ? names(c.per[0].people) : c.per.map(x => `${fmtShort.format(fromIso(x.day))}: ${names(x.people)}`).join('; ');
    const tbc = c.per.every(x => allTbc(x.statuses)) ? ' To be confirmed (TBC).' : c.per.some(x => allTbc(x.statuses)) ? ' Some days TBC.' : '';
    return `${c.job.job.name}${site ? ', ' + site : ''}. ${when}. ${who}.${tbc} Open the details`;
  }
  function card(c, phone) {
    const j = c.job.job, need = c.kind === 'need';
    const tbc = !need && c.per.every(x => allTbc(x.statuses));
    const btn = h('button', { type: 'button', class: ['jc', need ? 'need' : '', tbc ? 'tbc' : ''].filter(Boolean).join(' '), 'aria-label': cardLabel(c), 'data-job': j.id });
    if (need) {
      const n = Math.max(...c.per.map(x => x.n));
      btn.append(h('span', { class: 'jk' }, 'Needs a fitter' + (n > 1 ? ` ×${n}` : '')));
    }
    btn.append(h('span', { class: 'jn' }, j.name));
    const site = siteLine(j);
    if (site) btn.append(h('span', { class: 'js' }, site));
    if (!need) {
      const same = c.per.every(x => peopleKey(x.people) === peopleKey(c.per[0].people));
      if (same || phone) {
        btn.append(h('span', { class: 'pp' }, c.per[0].people.map(chip), tbc ? null : c.per.some(x => allTbc(x.statuses)) ? h('span', { class: 'tb' }, 'TBC') : null));
      } else {
        const split = h('span', { class: 'split' });
        split.style.gridTemplateColumns = `repeat(${c.len}, minmax(0, 1fr))`;
        for (const x of c.per) split.append(h('span', { class: 'pp' }, x.people.map(chip), !tbc && allTbc(x.statuses) ? h('span', { class: 'tb' }, 'TBC') : null));
        btn.append(split);
      }
    }
    btn.addEventListener('click', () => openSheet(j.id, btn));
    return btn;
  }
  function capBadge(d) {
    const c = PLAN.days[d];
    if (!c) return null;
    const v = { booked: c.b, unassigned: c.u || 0, tbc: c.t || 0, free: c.f };
    return h('span', { class: 'wcap', title: P.capLabel(v) }, P.battery(v), v.unassigned ? h('span', { class: 'unk', 'aria-hidden': 'true' }, v.unassigned > 9 ? '9+' : String(v.unassigned)) : null);
  }
  function capText(d) { const c = PLAN.days[d]; return c ? P.capLabel({ booked: c.b, unassigned: c.u || 0, tbc: c.t || 0, free: c.f }) : 'No fitting work booked'; }
  // Who is away that day: names only. A long list (the weekend rota) shows five and "+N more", which opens it.
  const AWAY_SHOWN = 5;
  function awayLine(d) {
    const ps = IDX.away.get(d);
    if (!ps || !ps.length) return null;
    const p = h('p', { class: 'away' }, h('span', { class: 'al' }, 'Away'), ' ');
    if (ps.length <= AWAY_SHOWN + 1) { p.append(ps.join(', ')); return p; }
    const rest = h('span', { class: 'more', hidden: true }, ', ' + ps.slice(AWAY_SHOWN).join(', '));
    const btn = h('button', { type: 'button', class: 'morebtn', 'aria-expanded': 'false', 'aria-label': `Show all ${ps.length} people away` }, `+${ps.length - AWAY_SHOWN} more`);
    btn.addEventListener('click', () => { rest.hidden = false; btn.remove(); });
    p.append(ps.slice(0, AWAY_SHOWN).join(', '), rest, ' ', btn);
    return p;
  }

  /* ---------------------------------------------------------------- the week (wide screens) */
  function renderGrid(mon) {
    const { days, cards, lanes } = cardsFor(mon);
    const t = iso(today());
    const grid = h('div', { class: 'wk', role: 'group', 'aria-label': 'Week of ' + rangeText(mon) });
    const hasAway = days.some(d => (IDX.away.get(d) || []).length);
    const firstCardRow = hasAway ? 3 : 2;
    const rows = firstCardRow + Math.max(lanes, 1);
    days.forEach((d, i) => {
      const cl = PLAN.closures.get(d);
      const cls = ['wcol', i >= 5 ? 'we' : '', d === t ? 'today' : '', cl ? 'closed-' + cl.kind : ''].filter(Boolean).join(' ');
      const col = h('div', { class: cls, 'aria-hidden': 'true' });
      col.style.gridColumn = String(i + 1); col.style.gridRow = `1 / ${rows + 1}`;
      grid.append(col);
    });
    days.forEach((d, i) => {
      const dt = fromIso(d), cl = PLAN.closures.get(d);
      const head = h('div', { class: ['wh', d === t ? 'today' : '', i >= 5 ? 'we' : '', cl ? 'closed-' + cl.kind : ''].filter(Boolean).join(' ') },
        h('h3', { class: 'wd', 'aria-label': fmtLong.format(dt) + (d === t ? ', today' : '') + (cl ? '. FLR closed: ' + P.closureText(cl) : '') + '. ' + capText(d) },
          h('span', { class: 'dnum', 'aria-hidden': 'true' }, String(dt.getDate())), h('span', { class: 'dname', 'aria-hidden': 'true' }, DOW[i])),
        capBadge(d),
        cl ? h('span', { class: 'cl', 'aria-hidden': 'true' }, cl.name) : null);
      head.style.gridColumn = String(i + 1); head.style.gridRow = '1';
      grid.append(head);
      if (hasAway) {
        const a = awayLine(d);
        const cell = h('div', { class: 'wa' }, a);
        cell.style.gridColumn = String(i + 1); cell.style.gridRow = '2';
        grid.append(cell);
      }
    });
    for (const c of cards) {
      const el = card(c, false);
      el.style.gridColumn = `${c.start + 1} / span ${c.len}`; el.style.gridRow = String(firstCardRow + c.lane);
      grid.append(el);
    }
    if (!cards.length) {
      const none = h('p', { class: 'wnone' }, 'No fitting work booked this week.');
      none.style.gridColumn = '1 / -1'; none.style.gridRow = String(firstCardRow);
      grid.append(none);
    }
    return grid;
  }

  /* ---------------------------------------------------------------- the week (phones): day by day */
  function renderList(mon) {
    const { days, cards } = cardsFor(mon);
    const t = iso(today());
    const list = h('div', { class: 'wl' });
    days.forEach((d, i) => {
      const dt = fromIso(d), cl = PLAN.closures.get(d);
      const sec = h('section', { class: ['wld', d === t ? 'today' : '', i >= 5 ? 'we' : '', cl ? 'closed-' + cl.kind : ''].filter(Boolean).join(' '), id: 'wl-' + d });
      sec.append(h('div', { class: 'wlh' },
        h('h3', { class: 'wd', 'aria-label': fmtLong.format(dt) + (d === t ? ', today' : '') + '. ' + capText(d) },
          h('span', { class: 'dnum', 'aria-hidden': 'true' }, String(dt.getDate())), h('span', { class: 'dname', 'aria-hidden': 'true' }, DOW[i] + (d === t ? ' · Today' : ''))),
        capBadge(d)));
      if (cl) sec.append(h('p', { class: 'cl' }, P.closureText(cl)));
      // this day's cards: each job's people on this day only
      const todays = cards.filter(c => c.start <= i && i < c.start + c.len).map(c => {
        const x = c.per[i - c.start];
        return { ...c, start: 0, len: 1, per: [x] };
      });
      for (const c of todays) sec.append(card(c, true));
      if (!todays.length) sec.append(h('p', { class: 'wnone' }, 'No fitting work booked.'));
      const a = awayLine(d);
      if (a) sec.append(a);
      list.append(sec);
    });
    return list;
  }

  /* ---------------------------------------------------------------- the mini calendar (wide screens) */
  function renderMini() {
    const box = $('#mini');
    if (!box) return;
    const first = miniMonth, t = iso(today());
    const start = mondayOf(first);
    const head = h('div', { class: 'mh' },
      h('button', { class: 'mbtn', type: 'button', 'aria-label': 'Previous month', id: 'mini-prev' }, P.icon('i-chev-l')),
      h('span', { class: 'mt' }, `${MONTHS[first.getMonth()]} ${first.getFullYear()}`),
      h('button', { class: 'mbtn', type: 'button', 'aria-label': 'Next month', id: 'mini-next' }, P.icon('i-chev-r')));
    const g = h('div', { class: 'mg', role: 'grid', 'aria-label': `${MONTHS[first.getMonth()]} ${first.getFullYear()}` });
    g.append(h('span', { class: 'mwk mhd', 'aria-hidden': 'true', title: 'Week number' }, 'Wk'));
    for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) g.append(h('span', { class: 'mhd', 'aria-hidden': 'true' }, d));
    for (let r = 0; r < 6; r++) {
      const mon = addDays(start, r * 7);
      if (r > 3 && mon.getMonth() !== first.getMonth() && mon > first) break;
      const row = h('div', { class: 'mrow' + (iso(mon) === iso(shownMon) ? ' on' : ''), role: 'row' });
      row.append(h('span', { class: 'mwk', role: 'rowheader', 'aria-label': 'Week ' + isoWeek(mon) }, String(isoWeek(mon))));
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i);
        const b = h('button', { type: 'button', role: 'gridcell', class: ['md', d.getMonth() !== first.getMonth() ? 'out' : '', iso(d) === t ? 'today' : ''].filter(Boolean).join(' '),
          'aria-label': fmtLong.format(d) + (iso(d) === t ? ', today' : ''), 'aria-current': iso(d) === t ? 'date' : null }, String(d.getDate()));
        b.addEventListener('click', () => go(mondayOf(d)));
        row.append(b);
      }
      g.append(row);
    }
    box.replaceChildren(head, g,
      PLAN.bookingsFrom ? h('p', { class: 'mnote' }, `Bookings loaded ${fmtWindow.format(fromIso(PLAN.bookingsFrom))} to ${fmtWindow.format(fromIso(PLAN.bookingsTo))}.`) : null);
    $('#mini-prev').addEventListener('click', () => { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() - 1, 1); renderMini(); });
    $('#mini-next').addEventListener('click', () => { miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + 1, 1); renderMini(); });
  }

  /* ---------------------------------------------------------------- the details sheet */
  const STATUS = { Scheduled: 'Scheduled', TBC: 'TBC' };
  function openSheet(jobId, from) {
    const j = IDX.jobs.get(jobId);
    const dlg = $('#sheet');
    if (!j || !dlg) return;
    const job = j.job;
    const all = [...new Set([...j.days.keys(), ...j.need.keys()])].sort();
    const body = [h('h2', { class: 'sh-t', id: 'sheet-title' }, job.name)];
    const addr = [job.address, job.postcode && !job.address.toUpperCase().includes(job.postcode.toUpperCase()) ? job.postcode : ''].filter(Boolean).join(', ');
    const facts = h('dl', { class: 'sh-f' },
      h('dt', null, 'Site'), h('dd', null, addr || 'No address on the Work Programme'),
      h('dt', null, 'WFM'), h('dd', null, job.wfm || '—'));
    body.push(facts);
    body.push(h('h3', { class: 'sh-h' }, all.length === 1 ? 'Booked day' : `Booked days (${all.length})`));
    const ul = h('ul', { class: 'sh-days' });
    const wk = new Set(Array.from({ length: 7 }, (_, i) => iso(addDays(shownMon, i))));
    for (const d of all) {
      const x = j.days.get(d), n = j.need.get(d);
      const li = h('li', { class: wk.has(d) ? 'inwk' : null },
        h('span', { class: 'sd' }, fmtShort.format(fromIso(d))),
        h('span', { class: 'sp' },
          x ? x.people.map(chip) : null,
          x ? [...x.statuses].filter(s => s !== 'Default').map(s => h('span', { class: 'st' + (s === 'TBC' ? ' tbc' : '') }, STATUS[s] || s)) : null,
          n ? h('span', { class: 'st need' }, n.n > 1 ? `Needs a fitter ×${n.n}` : 'Needs a fitter') : null));
      ul.append(li);
    }
    body.push(ul);
    body.push(h('p', { class: 'sh-n' }, `Days from ${fmtWindow.format(fromIso(PLAN.bookingsFrom))} to ${fmtWindow.format(fromIso(PLAN.bookingsTo))}, from the Monday Work Programme.`));
    const close = h('button', { type: 'button', class: 'sh-x', 'aria-label': 'Close' }, '×');
    close.addEventListener('click', () => dlg.close());
    dlg.replaceChildren(h('div', { class: 'sh-in' }, close, body));
    dlg.setAttribute('aria-labelledby', 'sheet-title');
    dlg.returnTo = from;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  /* ---------------------------------------------------------------- the toolbar and the whole view */
  const narrow = window.matchMedia('(max-width: 640px)');
  function render() {
    if (!PLAN || !shownMon) return;
    $('#wk-range').textContent = rangeText(shownMon);
    $('#wk-num').textContent = 'Week ' + isoWeek(shownMon);
    $('#wk-num').setAttribute('aria-label', 'ISO week number ' + isoWeek(shownMon));
    const box = $('#week');
    if (!PLAN.bookingsFrom) {
      box.replaceChildren(h('div', { class: 'wmsg' }, h('h3', null, 'No bookings loaded yet'),
        h('p', null, 'The Week view fills in after the next Monday read (every 15 minutes).')));
    } else if (!loaded(shownMon)) {
      const back = h('button', { type: 'button', class: 'btn' }, 'Go to this week');
      back.addEventListener('click', () => go(mondayOf(today())));
      box.replaceChildren(h('div', { class: 'wmsg' }, h('h3', null, 'No bookings loaded for this week'),
        h('p', null, `The Planner keeps bookings from ${fmtWindow.format(fromIso(PLAN.bookingsFrom))} to ${fmtWindow.format(fromIso(PLAN.bookingsTo))}.`), back));
    } else {
      box.replaceChildren(narrow.matches ? renderList(shownMon) : renderGrid(shownMon));
    }
    const minMon = PLAN.bookingsFrom ? addDays(fromIso(PLAN.bookingsFrom), -7) : null, maxMon = PLAN.bookingsTo ? addDays(mondayOf(fromIso(PLAN.bookingsTo)), 7) : null;
    $('#wk-prev').disabled = !!minMon && shownMon <= minMon;
    $('#wk-next').disabled = !!maxMon && shownMon >= maxMon;
    renderMini();
  }
  function go(mon) {
    shownMon = mon;
    if (!miniMonth || mon.getMonth() !== miniMonth.getMonth() && addDays(mon, 6).getMonth() !== miniMonth.getMonth()) miniMonth = new Date(mon.getFullYear(), mon.getMonth(), 1);
    render();
  }

  window.FLRPlannerWeek = {
    // capacity.js: once, with its parts
    init(parts) {
      P = parts;
      $('#wk-today').addEventListener('click', () => go(mondayOf(today())));
      $('#wk-prev').addEventListener('click', () => go(addDays(shownMon, -7)));
      $('#wk-next').addEventListener('click', () => go(addDays(shownMon, 7)));
      narrow.addEventListener('change', render);
      const dlg = $('#sheet');
      if (dlg) dlg.addEventListener('close', () => { const r = dlg.returnTo; dlg.returnTo = null; if (r && r.isConnected) r.focus(); });
    },
    // every good planner_board() answer (first load and the 5-minute refresh): the week shown stays
    update(plan) {
      PLAN = plan; IDX = index(plan);
      if (!shownMon) go(mondayOf(today())); else render();
    },
    isoWeek, rangeText,
  };
})();
