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
     on it that week are listed once (on phones: that day's). All bookings TBC: dashed (Outlook's "tentative"), else
     solid, with a small TBC tag on the people whose bookings on the card are all TBC. Tap a card for its details (address, WFM, every loaded day with who and status);
   - bookings with no fitter: gold "Needs a fitter" cards (no fitter, the "FLR Fitter TBC" placeholder, or only leavers);
   - an "Away" line per day with names only (leave, sickness, appointments, training, Not Working: never which);
   - bank holidays, company close days and the Jeff Day hatched, with the name, as on the Month view;
   - each day's capacity badge (N/23, gold number) from the same totals as the Month view.
   Outside the loaded window the week says "No bookings loaded for this week" rather than showing empty days.
   Phones (640px and narrower): a Mon–Sun day picker and the chosen day only (chips or a swipe change the day).
   Faces (Planner 1.5): each person shows as a round photo, else their initials in a tinted circle. The photos and van
   plates come from planner_photos(names) (Estimator repo 20261028200000_flr_planner_faces.sql: the Annual Leave staff
   photo, else Fleet Management's, as the Order Tracker; the plate of the van FleetView has them driving most, as the
   Fitter Schedule), asked once per name for the people in the week shown and kept in memory for this page only. The
   week draws straight away with initials and the faces fade in when they arrive; if the ask fails, initials stay.
   CSP: no inline styles; sizes, grid places and avatar tints are set with element.style.
   ========================================================================== */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  let P = null;            // capacity.js's parts (h, icon, battery, ...)
  let PLAN = null;         // the current planner_board() answer, checked
  let IDX = null;          // indexes built from PLAN
  let shownMon = null;     // the Monday of the week shown
  let shownDay = 0;        // phones: the day of that week shown (0 = Monday)
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
        if (!x) j.days.set(d, x = { people: [], names: new Set(), statuses: new Set(), subs: [], pst: new Map() });
        for (const p of b.people) {
          if (!x.names.has(p.name)) { x.names.add(p.name); x.people.push(p); }
          let st = x.pst.get(p.name); if (!st) x.pst.set(p.name, st = new Set()); st.add(b.status);   // each person's statuses that day
        }
        x.statuses.add(b.status); x.subs.push(b.sub);
      }
    }
    return { jobs, away };
  }
  const loaded = mon => !!(PLAN && PLAN.bookingsFrom && PLAN.bookingsTo && iso(mon) >= PLAN.bookingsFrom && iso(addDays(mon, 6)) <= PLAN.bookingsTo);
  const allTbc = statuses => statuses.size > 0 && [...statuses].every(s => s === 'TBC');

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

  /* ---------------------------------------------------------------- faces (Planner 1.5) */
  // name -> { photo: data URL or '', plate: 'K4 FLR' or '' } | null (asked: no photo and no plate, or the ask failed)
  const FACES = new Map(), ASKED = new Set();
  const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/, PLATE_RE = /^[A-Z0-9 ]{2,10}$/;
  function faceFrom(x) {
    if (!x || typeof x !== 'object') return null;
    const photo = typeof x.photo === 'string' && x.photo.length <= 400000 && PHOTO_RE.test(x.photo) ? x.photo : '';
    const plate = typeof x.plate === 'string' && PLATE_RE.test(x.plate.trim().toUpperCase()) ? x.plate.trim().toUpperCase() : '';
    return photo || plate ? { photo, plate } : null;
  }
  const ASK_MAX = 80;   // planner_photos() takes up to 80 names at a time
  function wantFaces(list) {
    if (!P.photos) return;
    const need = [...new Set(list)].filter(n => n && !ASKED.has(n));
    for (let i = 0; i < need.length; i += ASK_MAX) {
      const part = need.slice(i, i + ASK_MAX);
      part.forEach(n => ASKED.add(n));
      Promise.resolve().then(() => P.photos(part)).then(m => {
        for (const n of part) FACES.set(n, faceFrom(m && typeof m === 'object' ? m[n] : null));
        paintFaces();
      }, () => { for (const n of part) FACES.set(n, null); });   // initials stay; asked again only after a reload
    }
  }
  const initials = n => { const w = n.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean); return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
  // a calm, steady tint per person (the same name always gets the same one)
  const HUES = [232, 212, 188, 162, 268, 300, 24, 42];
  const hueOf = n => { let x = 0; for (const c of n) x = (x * 31 + c.charCodeAt(0)) >>> 0; return HUES[x % HUES.length]; };
  function photoInto(el, src) {
    if (el.querySelector('img')) return;
    const img = h('img', { alt: '', src, decoding: 'async', draggable: 'false' });
    if (img.complete) img.classList.add('in'); else img.addEventListener('load', () => img.classList.add('in'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    el.append(img);
  }
  // A round face: the photo, else initials on the person's tint. Screen readers hear the names elsewhere.
  function avatar(name, cls = '') {
    const el = h('span', { class: 'av' + (cls ? ' ' + cls : ''), 'data-face': name, 'aria-hidden': 'true' }, h('span', { class: 'ini' }, initials(name)));
    el.style.setProperty('--h', String(hueOf(name)));
    const f = FACES.get(name);
    if (f && f.photo) photoInto(el, f.photo);
    el.title = f && f.plate ? `${name} · ${f.plate}` : name;
    return el;
  }
  // A few faces overlapping, then "+N" for the rest
  function stack(list, max, cls = '') {
    const shown = list.length > max ? list.slice(0, max - 1) : list;
    const s = h('span', { class: 'avs' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, shown.map(n => avatar(n)));
    if (list.length > shown.length) s.append(h('span', { class: 'av more', title: list.slice(shown.length).join(', ') }, '+' + (list.length - shown.length)));
    return s;
  }
  // A UK number plate, as Fleet Management and the Fitter Schedule show them
  const plateEl = name => { const f = FACES.get(name); return h('span', { class: 'plate', 'data-plate': name, hidden: !(f && f.plate), title: 'Van (from Fleet Management)' }, f && f.plate ? f.plate : ''); };
  function paintFaces() {
    for (const el of document.querySelectorAll('.av[data-face]')) {
      const n = el.dataset.face, f = FACES.get(n);
      if (!f) continue;
      if (f.photo) photoInto(el, f.photo);
      el.title = f.plate ? `${n} · ${f.plate}` : n;
    }
    for (const el of document.querySelectorAll('.plate[data-plate]')) {
      const f = FACES.get(el.dataset.plate);
      if (f && f.plate) { el.textContent = f.plate; el.hidden = false; }
    }
  }

  /* ---------------------------------------------------------------- pieces */
  const h = (...a) => P.h(...a);
  const tagText = t => t === 'flr' ? 'FLR staff' : 'Sub';
  function chip(p, tbc) {
    return h('span', { class: 'chip' + (p.tag ? ' t-' + p.tag : '') }, avatar(p.name, 'xs'), h('span', { class: 'cn' }, p.name),
      p.tag ? h('span', { class: 'tg', title: p.tag === 'flr' ? 'FLR staff' : 'Subcontractor' }, tagText(p.tag)) : null,
      tbc ? h('span', { class: 'tb', title: 'To be confirmed' }, 'TBC') : null);
  }
  // A card's people: their faces overlapping, then every name once (with FLR staff / Sub / TBC tags)
  function people(ps, max) {
    return h('span', { class: 'pp' }, stack(ps.map(p => p.name), max),
      h('span', { class: 'pn' }, ps.map(p => h('span', { class: 'pnm' }, h('span', { class: 'cn' }, p.name),
        p.tag ? h('span', { class: 'tg', title: p.tag === 'flr' ? 'FLR staff' : 'Subcontractor' }, tagText(p.tag)) : null,
        p.tbc ? h('span', { class: 'tb', title: 'To be confirmed' }, 'TBC') : null))));
  }
  const pinIcon = () => P.icon('i-pin', 'pin');
  // Everyone on a card's days, each once (in the order first booked), and whether ALL of that person's bookings on the
  // card are TBC. The card itself is dashed when every booking on it is TBC; otherwise only those people's chips say TBC.
  function crew(c) {
    const out = new Map();
    for (const x of c.per) for (const p of x.people) {
      let e = out.get(p.name); if (!e) out.set(p.name, e = { p, st: new Set() });
      for (const s of (x.pst && x.pst.get(p.name)) || x.statuses) e.st.add(s);
    }
    return [...out.values()].map(e => ({ ...e.p, tbc: allTbc(e.st) }));
  }
  // "Moseley · B13 8RD"; the postcode once when the site already ends with it
  const siteLine = job => [job.site, job.postcode && !job.site.toUpperCase().includes(job.postcode.toUpperCase()) ? job.postcode : ''].filter(Boolean).join(' · ');
  const names = ps => ps.map(p => p.name + (p.tag === 'flr' ? ' (FLR staff)' : p.tag === 'sub' ? ' (subcontractor)' : '')).join(', ');
  function cardLabel(c) {
    const first = fromIso(c.per[0].day), last = fromIso(c.per[c.per.length - 1].day);
    const when = c.len === 1 ? fmtLong.format(first) : `${fmtShort.format(first)} to ${fmtShort.format(last)}`;
    const site = siteLine(c.job.job);
    if (c.kind === 'need') return `Needs a fitter: ${c.job.job.name}${site ? ', ' + site : ''}. ${when}. Open the details`;
    const ps = crew(c), all = c.per.every(x => allTbc(x.statuses));
    const who = names(ps), some = ps.filter(p => p.tbc);
    const tbc = all ? ' To be confirmed (TBC).' : some.length ? ` TBC: ${some.map(p => p.name).join(', ')}.` : '';
    return `${c.job.job.name}${site ? ', ' + site : ''}. ${when}. ${who}.${tbc} Open the details`;
  }
  function card(c, phone) {
    const j = c.job.job, need = c.kind === 'need';
    const tbc = !need && c.per.every(x => allTbc(x.statuses));
    const btn = h('button', { type: 'button', class: ['jc', need ? 'need' : '', tbc ? 'tbc' : ''].filter(Boolean).join(' '), 'aria-label': cardLabel(c), 'data-job': j.id });
    if (need) {
      const n = Math.max(...c.per.map(x => x.n));
      btn.append(h('span', { class: 'jk' }, h('span', { class: 'av open', 'aria-hidden': 'true' }, P.icon('i-person', 'pi')), h('span', null, 'Needs a fitter' + (n > 1 ? ` ×${n}` : ''))));
    }
    btn.append(h('span', { class: 'jn' }, j.name));
    const site = siteLine(j);
    if (site) btn.append(h('span', { class: 'js' }, pinIcon(), h('span', null, site)));
    if (!need) {
      // everyone on the job this week, once (on phones the card is one day, so that day's fitters); day by day is in the details
      const ps = crew(c).map(p => ({ ...p, tbc: !tbc && p.tbc }));
      btn.append(people(ps, phone ? 6 : c.len > 1 ? 6 : 4));
    }
    if (tbc) btn.append(h('span', { class: 'jt' }, 'TBC'));
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
    const p = h('p', { class: 'away' }, h('span', { class: 'ah' }, h('span', { class: 'al' }, 'Away'), stack(ps, 5, 'sm')), ' ');
    const txt = h('span', { class: 'an' });
    p.append(txt);
    if (ps.length <= AWAY_SHOWN + 1) { txt.append(ps.join(', ')); return p; }
    const rest = h('span', { class: 'more', hidden: true }, ', ' + ps.slice(AWAY_SHOWN).join(', '));
    const btn = h('button', { type: 'button', class: 'morebtn', 'aria-expanded': 'false', 'aria-label': `Show all ${ps.length} people away` }, `+${ps.length - AWAY_SHOWN} more`);
    btn.addEventListener('click', () => { rest.hidden = false; btn.remove(); });
    txt.append(ps.slice(0, AWAY_SHOWN).join(', '), rest, ' ', btn);
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
          h('span', { class: 'dname', 'aria-hidden': 'true' }, DOW[i]), h('span', { class: 'dnum', 'aria-hidden': 'true' }, String(dt.getDate()))),
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

  /* ---------------------------------------------------------------- the week (phones): a day picker and one day */
  // Phones show one day of the shown week at a time: a Mon–Sun strip of chips (weekday letter, date, the day's booked
  // count in its battery colour, a gold dot when bookings still need a fitter, today marked, closed days hatched, the
  // chosen day filled), then only that day: header, closure, Away, its job cards. Chips or a swipe change the day;
  // ‹ › change the week. The day isn't kept in the address (#week only).
  function dayChip(d, i, sel) {
    const dt = fromIso(d), cl = PLAN.closures.get(d), c = PLAN.days[d], t = iso(today());
    const b = h('button', { type: 'button', role: 'tab', class: ['dc', i === sel ? 'on' : '', d === t ? 'today' : '', i >= 5 ? 'we' : '', cl ? 'closed-' + cl.kind : ''].filter(Boolean).join(' '),
      'aria-selected': i === sel ? 'true' : 'false', tabindex: i === sel ? '0' : '-1', 'data-i': String(i),
      'aria-label': fmtLong.format(dt) + (d === t ? ', today' : '') + (cl ? '. FLR closed: ' + P.closureText(cl) : '') + '. ' + capText(d) },
      h('span', { class: 'dl', 'aria-hidden': 'true' }, DOW[i][0]),
      h('span', { class: 'dn2', 'aria-hidden': 'true' }, String(dt.getDate())));
    if (c) {
      const n = h('span', { class: 'dk' + (c.b > PLAN.capacity ? ' over' : c.b === 0 ? ' zero' : ''), 'aria-hidden': 'true' }, String(c.b));
      if (c.b > 0 && c.b <= PLAN.capacity) n.style.background = P.battColour(c.b);
      b.append(n);
      if (c.u) b.append(h('span', { class: 'du', 'aria-hidden': 'true' }));
    } else b.append(h('span', { class: 'dk none', 'aria-hidden': 'true' }, '–'));
    b.addEventListener('click', () => { if (shownDay !== i) moving = 'enter-day'; shownDay = i; render(); const f = document.querySelector('.dc.on'); if (f) f.focus(); });
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); moving = 'enter-day'; shownDay = Math.max(0, Math.min(6, shownDay + (e.key === 'ArrowRight' ? 1 : -1))); render();
      const f = document.querySelector('.dc.on'); if (f) f.focus();
    });
    return b;
  }
  function renderPhone(mon) {
    const { days, cards } = cardsFor(mon);
    const t = iso(today()), i = shownDay, d = days[i], dt = fromIso(d), cl = PLAN.closures.get(d);
    const strip = h('div', { class: 'dstrip', role: 'tablist', 'aria-label': 'Day' }, days.map((x, k) => dayChip(x, k, i)));
    const sec = h('section', { class: ['wld', d === t ? 'today' : '', i >= 5 ? 'we' : '', cl ? 'closed-' + cl.kind : ''].filter(Boolean).join(' '), id: 'wl-' + d, role: 'tabpanel', 'aria-label': fmtLong.format(dt) });
    sec.append(h('div', { class: 'wlh' },
      h('h3', { class: 'wd', 'aria-label': fmtLong.format(dt) + (d === t ? ', today' : '') + '. ' + capText(d) },
        h('span', { class: 'dnum', 'aria-hidden': 'true' }, String(dt.getDate())), h('span', { class: 'dname', 'aria-hidden': 'true' }, DOW[i] + (d === t ? ' · Today' : ''))),
      capBadge(d)));
    if (cl) sec.append(h('p', { class: 'cl' }, P.closureText(cl)));
    const a = awayLine(d);
    if (a) sec.append(a);
    // this day's cards: each job's people on this day only
    const todays = cards.filter(c => c.start <= i && i < c.start + c.len).map(c => ({ ...c, start: 0, len: 1, per: [c.per[i - c.start]] }));
    for (const c of todays) sec.append(card(c, true));
    if (!todays.length) sec.append(h('p', { class: 'wnone' }, 'No fitting work booked.'));
    // a swipe left / right: the next / previous day of this week
    let x0 = null, y0 = null;
    sec.addEventListener('touchstart', e => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
    sec.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const n = Math.max(0, Math.min(6, shownDay + (dx < 0 ? 1 : -1)));
      if (n !== shownDay) { moving = 'enter-day'; shownDay = n; render(); }
    });
    return h('div', { class: 'wl' }, strip, sec);
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
    const body = [h('p', { class: 'sh-e' }, 'Job'), h('h2', { class: 'sh-t', id: 'sheet-title' }, job.name)];
    const addr = [job.address, job.postcode && !job.address.toUpperCase().includes(job.postcode.toUpperCase()) ? job.postcode : ''].filter(Boolean).join(', ');
    const facts = h('dl', { class: 'sh-f' },
      h('dt', null, 'Site'), h('dd', null, addr || 'No address on the Work Programme'),
      h('dt', null, 'WFM'), h('dd', null, job.wfm ? h('span', { class: 'wfm' }, job.wfm) : '—'));
    body.push(facts);
    // Everyone booked on it in the loaded days, once, with the van they drive (Fleet Management) when known
    const team = new Map();
    for (const d of all) { const x = j.days.get(d); if (x) for (const p of x.people) if (!team.has(p.name)) team.set(p.name, p); }
    if (team.size) {
      body.push(h('h3', { class: 'sh-h' }, team.size === 1 ? 'Fitter' : `Team (${team.size})`));
      body.push(h('ul', { class: 'sh-team' }, [...team.values()].map(p => h('li', null, avatar(p.name, 'lg'),
        h('span', { class: 'tn' }, h('span', { class: 'cn' }, p.name), p.tag ? h('span', { class: 'tg' }, p.tag === 'flr' ? 'FLR staff' : 'Subcontractor') : null),
        plateEl(p.name)))));
    }
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
    const close = h('button', { type: 'button', class: 'sh-x', 'aria-label': 'Close' }, P.icon('i-x'));
    close.addEventListener('click', () => dlg.close());
    dlg.replaceChildren(h('div', { class: 'sh-grab', 'aria-hidden': 'true' }), h('div', { class: 'sh-in' }, close, body));
    wantFaces([...team.keys()]);
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
      const view = narrow.matches ? renderPhone(shownMon) : renderGrid(shownMon);
      if (moving) view.classList.add(moving);
      box.replaceChildren(view);
      wantFaces(weekNames(shownMon));
    }
    moving = '';
    const minMon = PLAN.bookingsFrom ? addDays(fromIso(PLAN.bookingsFrom), -7) : null, maxMon = PLAN.bookingsTo ? addDays(mondayOf(fromIso(PLAN.bookingsTo)), 7) : null;
    $('#wk-prev').disabled = !!minMon && shownMon <= minMon;
    $('#wk-next').disabled = !!maxMon && shownMon >= maxMon;
    renderMini();
  }
  // the people in the week shown (cards and Away), for their faces
  function weekNames(mon) {
    const out = [];
    for (let i = 0; i < 7; i++) { const d = iso(addDays(mon, i)); for (const p of IDX.away.get(d) || []) out.push(p); }
    for (const j of IDX.jobs.values()) for (let i = 0; i < 7; i++) { const x = j.days.get(iso(addDays(mon, i))); if (x) for (const p of x.people) out.push(p.name); }
    return out;
  }
  let moving = '';   // how the next render arrives: 'enter' (a new week), 'enter-day' (another day on phones); '' = a quiet refresh
  function go(mon) {
    moving = shownMon && +mon === +shownMon ? '' : 'enter';
    shownMon = mon;
    const ti = Math.round((today() - mon) / 864e5);   // phones open on today when it's in this week, else Monday
    shownDay = ti >= 0 && ti <= 6 ? ti : 0;
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
      if (dlg) {
        dlg.addEventListener('close', () => { const r = dlg.returnTo; dlg.returnTo = null; if (r && r.isConnected) r.focus(); });
        dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // a tap on the dimmed page closes it
      }
    },
    // every good planner_board() answer (first load and the 5-minute refresh): the week shown stays
    update(plan) {
      PLAN = plan; IDX = index(plan);
      if (!shownMon) go(mondayOf(today())); else render();
    },
    isoWeek, rangeText,
  };
})();
