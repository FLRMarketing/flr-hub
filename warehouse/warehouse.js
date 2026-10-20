/* ============================================================================
   FLR Hub: Warehouse Tasks (Hub tile 'warehouse'). The warehouse's weekly checklist from the
   Monday board "FLR - Operations" (the Warehouse Weekly Task List), for phones and tablets.

   Today (the main screen): today's date, how many of today's tasks are done, the My tasks /
   All tasks switch, and the checklist: today's tasks, then anything from earlier this week
   that isn't done, then the done ones folded into their own group with who and when.
   Week (#/week): every day of a week, earlier weeks (the history) and next week's preview.

   The data: public.warehouse_board(week) (Estimator repo, 20261016500000_flr_warehouse_tasks.sql)
     { today, thisWeek, readAt, failingSince, pageError, you: {name, email, monday},
       week: {start, itemId, url, state}, weeks: [...], template: [{id, name}] | null,
       tasks: [{ id, name, title, day, status, statusAt, owners: [{id, name, you}], mine,
                 mondayBy, tick: {id, done, by, at, state, error, sentAt} | null }] }
   A task's Status is Monday's. "tick" is the latest tick made on the Hub: 'waiting' while
   flr-warehouse writes it to Monday, 'sent' once Monday has confirmed it (the Status is then
   already updated), 'failed' with why. Ticking: public.warehouse_tick(task, done).

   Saving states, on the card: "Saving…" from the tap until Monday confirms; "Saved" for a few
   seconds after; "Not saved" with Try again when Monday refused or couldn't be reached
   (Monday then still shows what it showed before). Only a confirmed tick shows as saved.
   The page asks the database again every 20 seconds while it's open (and every 1.2 seconds
   while one of your ticks is being saved); changes made on Monday arrive with flr-warehouse's
   next read (every 2 minutes in working hours).

   Who can open it: warehouse_board() makes the Hub's app check (private.require_app('warehouse')).
   This page's CSP allows no inline styles: everything is built as elements.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';            // the one FLR sign-in for the whole site
  const SIGN_IN = '../?next=warehouse';
  const SCOPE_KEY = 'flr-warehouse:scope';          // this browser: My tasks or All tasks, as last chosen
  const DONE_OPEN_KEY = 'flr-warehouse:done-open', EARLIER_OPEN_KEY = 'flr-warehouse:earlier-open';
  const DONE = 'Done', SKIP = ['Cancelled', 'N.A'];
  const REFRESH_MS = 20 * 1000, FAST_MS = 1200, FAST_FOR_MS = 60 * 1000, SAVED_FOR_MS = 3500, SLOW_SAVE_MS = 20 * 1000;
  const $ = s => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: still works */ } },
  };

  /* ---------------------------------------------------------------- building the page (text only: nothing is parsed as HTML) */
  const SVG = 'http://www.w3.org/2000/svg';
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
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
  // Something for screen readers to hear (saved, not saved), without moving focus.
  const live = h('div', { class: 'defs', 'aria-live': 'polite', role: 'status' });
  document.body.append(live);
  const say = text => { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); };

  /* ---------------------------------------------------------------- dates (days are 'YYYY-MM-DD', UK days from the database) */
  const asDate = d => new Date(d + 'T12:00:00Z');
  const addDays = (d, n) => { const x = asDate(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const fmt = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o });
  const fmtLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
  const fmtWeekday = fmt({ weekday: 'long' });
  const fmtShort = fmt({ day: 'numeric', month: 'short' });
  const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  const fmtDayTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const ukDay = at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  // "09:14" today, "Tue 09:14" on another day of the week, "12 Oct, 09:14" further back.
  function when(iso) {
    const at = new Date(iso);
    if (isNaN(at)) return '';
    if (ukDay(at) === TODAY) return fmtTime.format(at);
    if (Math.abs(asDate(ukDay(at)) - asDate(TODAY)) < 6 * 864e5) return fmtDayTime.format(at);
    return `${fmtShort.format(asDate(ukDay(at)))}, ${fmtTime.format(at)}`;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const weekLabel = start => {
    const end = addDays(start, 6), a = asDate(start), b = asDate(end);
    return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${fmtShort.format(b)}` : `${fmtShort.format(a)} – ${fmtShort.format(b)}`;
  };
  // Next week's preview only: a template name's weekday and title ("Monday - Forklift Check"), as flr-warehouse reads them.
  const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  function splitName(name) {
    const m = /^\s*(mon|tues?|wed(?:nes)?|weds|thu(?:rs)?|fri|sat(?:ur)?|sun)[a-z]*\.?\s*[-–—:]\s*(.+?)\s*$/i.exec(name || '');
    return m ? { offset: WEEKDAYS.indexOf(m[1].toLowerCase().slice(0, 3)), title: m[2] } : { offset: null, title: String(name || '') };
  }

  /* ================================================================ state */
  let TODAY = null, THIS_WEEK = null;
  const boards = new Map();            // week start → warehouse_board()'s answer
  let view = 'today', shownWeek = null;
  let scope = store.get(SCOPE_KEY);    // 'mine' | 'all' (chosen on first load when not remembered)
  const local = new Map();             // task id → {done, state: 'sending' | 'error', error}: before the database has the tick
  const watching = new Map();          // task id → tick id: your ticks still being saved, to say "Saved" when Monday confirms
  const savedUntil = new Map();        // task id → time until which the card says "Saved"
  let fastUntil = 0;

  /* ---------------------------------------------------------------- a task as the page shows it */
  const isSkipped = t => SKIP.includes(t.status);
  // done: ticked (as Monday has it, or as you've just asked); sync: 'saving' | 'saved' | 'failed' | null.
  function stateOf(t) {
    const l = local.get(t.id), k = t.tick, mondayDone = t.status === DONE;
    if (l && l.state === 'sending') return { done: l.done, sync: 'saving' };
    if (l && l.state === 'error') return { done: mondayDone, sync: 'failed', want: l.done, minutes: l.minutes, error: l.error };
    if (k && k.state === 'waiting') return { done: k.done, sync: 'saving', slow: Date.now() - Date.parse(k.at) > SLOW_SAVE_MS };
    if (k && k.state === 'failed' && k.done !== mondayDone && Date.now() - Date.parse(k.at) < 12 * 3600e3) return { done: mondayDone, sync: 'failed', want: k.done, minutes: k.minutes, error: k.error };
    if ((savedUntil.get(t.id) || 0) > Date.now()) return { done: mondayDone, sync: 'saved' };
    return { done: mondayDone, sync: null };
  }
  // Who ticked it and when: the Hub's tick when it's the latest change, else Monday's own (its log), else just when.
  function doneInfo(t) {
    const k = t.tick;
    // 1.2: how long it took: Monday's "Time taken (mins)" (it can be corrected there), else the time given with the tick
    const minutes = t.minutes != null ? t.minutes : k && k.done && k.state === 'sent' ? k.minutes : null;
    if (k && k.done && k.state === 'sent' && (!t.statusAt || Date.parse(k.sentAt || k.at) >= Date.parse(t.statusAt) - 120e3)) return { by: k.by, at: k.at, minutes };
    return { by: t.mondayBy || null, at: t.statusAt, minutes };
  }
  const inScope = t => scope !== 'mine' || t.mine;

  /* ---------------------------------------------------------------- one card */
  function card(t, o = {}) {
    const s = stateOf(t), skipped = isSkipped(t) && !s.sync;
    const cls = ['task', (s.done && s.sync !== 'saving') || skipped ? 'is-done' : '', skipped ? 'skipped' : '', s.sync === 'failed' ? 'failed' : ''].filter(Boolean).join(' ');
    const meta = [];
    if (o.dayTag) meta.push(h('span', { class: 'chip day' }, o.dayTag));
    // the person (or people) it's given to on Monday
    if (t.owners.length) {
      const you = t.owners.some(p => p.you);
      meta.push(h('span', { class: 'who' + (you ? ' you' : '') }, icon('i-person'), t.owners.map(p => p.you ? 'You' : p.name).join(', ')));
    } else meta.push(h('span', { class: 'who none' }, icon('i-person'), 'Unassigned'));
    // Monday's Status when it says more than to do / done
    if (skipped) meta.push(h('span', { class: 'chip' }, `${t.status} on Monday`));
    else if (!s.done && t.status && t.status !== 'Pending' && t.status !== DONE && !s.sync)
      meta.push(h('span', { class: 'chip ' + (t.status === 'Working on it' ? 'st-working' : t.status === 'Stuck' ? 'st-stuck' : 'st-other') }, t.status));
    // 1.1: the task's form (Forklift Checks): needed, or sent (with what the form said)
    const sent = t.form ? t.form.sent || [] : [];
    const needsForm = !!t.form && !sent.length && !s.done;
    if (t.form && sent.length) { const a = sent[sent.length - 1]; meta.push(h('span', { class: 'chip ' + formClass(a.status), title: `${a.by || 'Someone'}, ${when(a.at)}` }, `Form ${a.status ? '· ' + a.status : 'sent'}`)); }
    else if (needsForm) meta.push(h('span', { class: 'chip form-need' }, 'Form needed'));
    // saving / saved / not saved
    if (s.sync === 'saving') meta.push(h('span', { class: 'sync saving' }, s.slow ? 'Still saving… waiting for Monday' : 'Saving…'));
    else if (s.sync === 'saved') meta.push(h('span', { class: 'sync saved' }, icon('i-check'), 'Saved to Monday'));
    else if (s.sync === 'failed') meta.push(h('span', { class: 'sync failed', title: s.error || '' }, icon('i-warn'), 'Not saved'),
      o.readOnly ? null : h('button', { class: 'retry', type: 'button', onclick: () => s.want && !s.minutes ? askTime(t) : tick(t, s.want, s.minutes) }, 'Try again'));
    else if (s.done) { const d = doneInfo(t); meta.push(h('span', { class: 'when' }, [d.by || 'Done on Monday', d.at ? when(d.at) : '', d.minutes ? short(d.minutes) : ''].filter(Boolean).join(' · '))); }

    const label = needsForm ? `Send the form first, then tick off ${t.title}` : (s.done ? 'Untick ' : 'Tick off ') + t.title;
    const btn = h('button', { class: 'tick' + (s.sync === 'saving' ? ' busy' : '') + (needsForm ? ' locked' : ''), type: 'button', 'aria-pressed': String(!!s.done), 'aria-label': label, title: label,
      disabled: s.sync === 'saving' || skipped || o.readOnly || null, onclick: () => needsForm ? openGuide(t.id, { needForm: true }) : s.done ? tick(t, false) : askTime(t) }, icon(needsForm ? 'i-lock' : 'i-check'));
    // 1.1: Will's instructions (and the form), opened from the card
    const guide = (t.instructions || t.form) ? h('button', { class: 'guide-btn', type: 'button', onclick: () => openGuide(t.id) }, icon('i-book'), t.form ? 'Instructions & form' : 'Instructions') : null;
    return h('li', { class: cls, 'data-id': t.id }, h('div', null, h('p', { class: 'name' }, t.title), h('div', { class: 'meta' }, meta), guide), btn);
  }
  const previewCard = name => h('li', { class: 'task preview' }, h('div', null, h('p', { class: 'name' }, name), h('div', { class: 'meta' }, h('span', { class: 'who none' }, 'On next week’s list'))),
    h('button', { class: 'tick', type: 'button', disabled: true, 'aria-label': 'Not on Monday yet' }, icon('i-check')));
  const empty = (title, text, action, cls) => h('div', { class: 'empty' + (cls ? ' ' + cls : '') }, h('h3', null, title), text ? h('p', null, text) : null, action || null);
  const showAll = () => h('button', { class: 'btn', type: 'button', onclick: () => setScope('all') }, 'Show all tasks');

  /* ---------------------------------------------------------------- My tasks / All tasks */
  function renderScope(el, tasks) {
    const n = { mine: tasks.filter(t => t.mine && !isSkipped(t)).length, all: tasks.filter(t => !isSkipped(t)).length };
    el.replaceChildren(...[['mine', 'My tasks'], ['all', 'All tasks']].map(([k, label]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(scope === k), onclick: () => setScope(k) }, label, h('span', { class: 'n' }, String(n[k])))));
  }
  function setScope(k) { scope = k; store.set(SCOPE_KEY, k); render(); }

  /* ================================================================ Today */
  function renderToday() {
    const b = boards.get(THIS_WEEK);
    $('#today-date').textContent = fmtLong.format(asDate(TODAY));
    const all = b.tasks;
    // today's tasks: dated today, or for any day this week
    const todays = all.filter(t => t.day === TODAY || t.day == null);
    renderScope($('#scope-today'), todays.concat(all.filter(t => t.day && t.day < TODAY && !stateOf(t).done && !isSkipped(t))));
    const mine = todays.filter(inScope);
    const counted = mine.filter(t => !isSkipped(t));
    const confirmed = t => stateOf(t).done && stateOf(t).sync !== 'saving';   // the count only moves once Monday has confirmed
    const doneN = counted.filter(confirmed).length;
    // still to do from earlier this week; and earlier ones ticked today stay in Done, so a tick never makes a task vanish
    const earlier = all.filter(t => t.day && t.day < TODAY && inScope(t));
    const earlierOpen = earlier.filter(t => !stateOf(t).done && !isSkipped(t));
    const earlierDoneToday = earlier.filter(t => stateOf(t).done && !stateOf(t).sync && ukDay(new Date(doneInfo(t).at || 0)) === TODAY);

    const total = counted.length;
    $('#today-count').replaceChildren(total ? h('span', null, h('b', null, `${doneN} of ${total}`), ' done today')
      : (scope === 'mine' ? 'Nothing given to you today' : 'No tasks today'));
    const bar = $('#today-progress');
    bar.setAttribute('aria-valuemax', String(total)); bar.setAttribute('aria-valuenow', String(doneN));
    bar.firstElementChild.style.width = total ? `${(doneN / total) * 100}%` : '0';
    bar.hidden = !total;

    const out = [];
    // A task being saved (or just saved, or not saved) stays where it is, so you see it through; then it moves to Done.
    const open = mine.filter(t => (!stateOf(t).done && !isSkipped(t)) || stateOf(t).sync);
    const closed = mine.filter(t => !open.includes(t)).concat(earlierDoneToday);
    if (!b.week.itemId && !all.length) out.push(empty('This week’s list is being made', 'A fresh copy of the Warehouse Weekly Task List is made on Monday each week. It will be here in a minute or two.'));
    else if (open.length) out.push(h('ul', { class: 'list', 'aria-label': 'To do today' }, open.map(t => card(t))));
    else if (total && doneN === total) out.push(empty('Everything’s done for today', scope === 'mine' ? 'All of your tasks for today are ticked off.' : 'Every task for today is ticked off.', null, 'all-done'));
    else if (!todays.length) out.push(empty(`Nothing on the list for ${fmtWeekday.format(asDate(TODAY))}`, 'The weekly list has no tasks for today.', h('a', { class: 'btn', href: '#/week' }, 'See the week')));
    else if (scope === 'mine') out.push(empty('Nothing given to you today', 'Tasks are given out in Monday’s Owner column. Everyone’s tasks are under All tasks.', showAll()));

    // Earlier this week, not done: folded (today stays first), opened with a tap; remembered on this device.
    const earlierShown = earlier.filter(t => (!stateOf(t).done && !isSkipped(t)) || stateOf(t).sync);
    if (earlierShown.length) {
      const d = h('details', { class: 'donegroup earlier', open: store.get(EARLIER_OPEN_KEY) === '1' || null },
        h('summary', null, icon('i-chev-d'), 'Still to do from earlier this week', h('span', { class: 'n' }, String(earlierOpen.length))),
        h('ul', { class: 'list' }, earlierShown.map(t => card(t, { dayTag: fmtWeekday.format(asDate(t.day)) }))));
      d.addEventListener('toggle', () => store.set(EARLIER_OPEN_KEY, d.open ? '1' : '0'));
      out.push(d);
    }
    if (closed.length) {
      const d = h('details', { class: 'donegroup', open: store.get(DONE_OPEN_KEY) !== '0' || null },
        h('summary', null, icon('i-chev-d'), 'Done', h('span', { class: 'n' }, String(closed.length))),
        h('ul', { class: 'list' }, closed.map(t => card(t, { dayTag: t.day && t.day < TODAY ? fmtWeekday.format(asDate(t.day)) : null }))));
      d.addEventListener('toggle', () => store.set(DONE_OPEN_KEY, d.open ? '1' : '0'));
      out.push(d);
    }
    $('#today-list').replaceChildren(...out);
  }

  /* ================================================================ the week */
  function renderWeek() {
    const b = boards.get(shownWeek);
    $('#week-label').textContent = `Week of ${weekLabel(shownWeek)}`;
    const weeks = (b && b.weeks) || [];
    $('#prev').disabled = !weeks.some(w => w < shownWeek);
    $('#next').disabled = shownWeek >= addDays(THIS_WEEK, 7);
    if (!b) { $('#week-list').replaceChildren(h('div', { class: 'sk sk-card' }), h('div', { class: 'sk sk-card' })); $('#week-count').textContent = ''; return; }
    const out = [];
    const past = shownWeek < THIS_WEEK, future = shownWeek > THIS_WEEK;
    if (!b.week.itemId) {
      // no copy on Monday: next week's preview from the template, or a week before the Hub started
      $('#week-count').textContent = '';
      $('#scope-week').hidden = true;
      if (future && b.template && b.template.length) {
        const by = new Map();
        for (const tp of b.template) { const s = splitName(tp.name); const k = s.offset == null ? 'any' : addDays(shownWeek, s.offset); if (!by.has(k)) by.set(k, []); by.get(k).push(s.title); }
        for (const [k, names] of [...by.entries()].sort((a, c) => (a[0] === 'any') - (c[0] === 'any') || a[0].localeCompare(c[0])))
          out.push(h('section', { class: 'dayblock' }, h('h3', null, k === 'any' ? 'Any day this week' : fmtLong.format(asDate(k))), h('ul', { class: 'list' }, names.map(previewCard))));
        $('#week-foot').textContent = 'Next week’s list is made on Monday morning from the Warehouse Weekly Task List template. Changes to the template show here.';
      } else {
        out.push(empty('No list for this week', past ? 'Warehouse Tasks started after this week.' : 'This week’s list is being made on Monday.'));
        $('#week-foot').textContent = '';
      }
      $('#week-list').replaceChildren(...out);
      return;
    }
    $('#scope-week').hidden = false;
    renderScope($('#scope-week'), b.tasks);
    const tasks = b.tasks.filter(inScope), counted = tasks.filter(t => !isSkipped(t));
    const doneN = counted.filter(t => stateOf(t).done && stateOf(t).sync !== 'saving').length;
    const logged = counted.filter(t => stateOf(t).done).reduce((n, t) => n + (doneInfo(t).minutes || 0), 0);   // 1.2
    $('#week-count').replaceChildren(counted.length ? h('span', null, h('b', null, `${doneN} of ${counted.length}`), ' done this week', logged ? ` · ${short(logged)} logged` : '')
      : (scope === 'mine' ? 'Nothing given to you this week' : 'No tasks this week'));
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(shownWeek, i));
    const groups = days.map(d => [d, tasks.filter(t => t.day === d)]).filter(([d, l], i) => l.length || i < 5);
    const anyDay = tasks.filter(t => t.day == null);
    if (anyDay.length) groups.push(['any', anyDay]);
    for (const [d, list] of groups) {
      const open = list.filter(t => !stateOf(t).done && !isSkipped(t)).length, cnt = list.filter(t => !isSkipped(t)).length;
      const isPast = d !== 'any' && d < TODAY, isToday = d === TODAY;
      const sum = !cnt ? '' : open && isPast ? `${open} not done` : `${cnt - open} of ${cnt}`;
      out.push(h('section', { class: 'dayblock' + (isToday ? ' is-today' : '') },
        h('h3', null, h('span', null, d === 'any' ? 'Any day this week' : fmtLong.format(asDate(d)) + (isToday ? ' · Today' : '')), h('span', { class: 'sum' + (open && isPast ? ' open-past' : '') }, sum)),
        list.length ? h('ul', { class: 'list' }, list.map(t => card(t))) : h('p', { class: 'weekfoot' }, scope === 'mine' ? 'Nothing given to you.' : 'Nothing on the list.')));
    }
    if (!tasks.length && scope === 'mine') out.unshift(empty('Nothing given to you this week', 'Tasks are given out in Monday’s Owner column.', showAll()));
    $('#week-list').replaceChildren(...out);
    const foot = $('#week-foot');
    foot.replaceChildren(b.week.url ? h('a', { href: b.week.url, target: '_blank', rel: 'noopener' }, 'Open this week’s list on Monday') : '');
  }

  /* ================================================================ the page */
  function showSource() {
    const b = boards.get(THIS_WEEK) || boards.values().next().value;
    if (!b || !b.readAt) return;
    const at = new Date(b.readAt), src = $('#source');
    src.textContent = `Monday · updated ${when(b.readAt)}`;
    src.title = `Tasks from the Monday Warehouse Weekly Task List, read every 2 minutes in working hours. Last read ${fmtTime.format(at)}.`;
    src.classList.toggle('stale', !!b.failingSince);
    const note = $('#notice');
    if (b.failingSince) {
      note.textContent = `Couldn’t read Monday since ${when(b.failingSince)}. Showing the tasks as they were at ${when(b.readAt)}. Ticks still go to Monday.`;
      note.hidden = false;
    } else { note.textContent = ''; note.hidden = true; }
  }
  function render() {
    if (document.body.dataset.view !== 'ready') return;
    const focusId = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-id]') && document.activeElement.closest('[data-id]').dataset.id;
    const focusRetry = document.activeElement && document.activeElement.classList.contains('retry');
    showSource();
    $('#today').hidden = view !== 'today'; $('#week').hidden = view !== 'week';
    if (view === 'today') renderToday(); else renderWeek();
    // keep the keyboard where it was after the list is rebuilt
    if (focusId) { const el = document.querySelector(`[data-id="${CSS.escape(focusId)}"] ${focusRetry ? '.retry' : '.tick'}`) || document.querySelector(`[data-id="${CSS.escape(focusId)}"] .tick`); if (el) el.focus({ preventScroll: true }); }
  }

  function route() {
    const m = /^#\/week(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(location.hash);
    if (m) { view = 'week'; shownWeek = m[1] ? weekOf(m[1]) : THIS_WEEK; if (!boards.has(shownWeek)) { const w = shownWeek; load(w).then(ok => { if (ok && w === shownWeek) render(); }); } }
    else view = 'today';
    render();
    scrollTo(0, 0);
  }
  const weekOf = d => addDays(d, -((asDate(d).getUTCDay() + 6) % 7));
  addEventListener('hashchange', route);
  $('#prev').addEventListener('click', () => { location.hash = `#/week/${addDays(shownWeek, -7)}`; });
  $('#next').addEventListener('click', () => { location.hash = `#/week/${addDays(shownWeek, 7)}`; });

  /* ---------------------------------------------------------------- ticking */
  async function tick(t, done, minutes) {
    local.set(t.id, { done, minutes, state: 'sending' });
    render();
    let res;
    try { res = await client().rpc('warehouse_tick', done ? { p_task: t.id, p_done: true, p_minutes: minutes } : { p_task: t.id, p_done: false }); }
    catch (e) { res = { error: e }; }
    if (res.error) {
      if (expired(res.error) || flrCode(res.error) === 'FLR_SIGN_IN_REQUIRED') return location.replace(SIGN_IN);
      if (flrCode(res.error) === 'FLR_FORBIDDEN') return failGate(res.error);
      if (flrCode(res.error) === 'FLR_FORM_NEEDED') { local.delete(t.id); render(); return openGuide(t.id, { needForm: true }); }
      if (flrCode(res.error) === 'FLR_TIME_NEEDED') { local.delete(t.id); render(); return askTime(t); }
      const why = offline(res.error) ? 'Couldn’t reach the FLR database. Check your connection.' : flrCode(res.error) === 'FLR_NOT_FOUND' ? 'That task is no longer on Monday.' : 'The FLR database didn’t take the tick.';
      local.set(t.id, { done, minutes, state: 'error', error: why });
      say(`${t.title}: not saved. ${why}`);
      render();
      return;
    }
    local.delete(t.id);
    t.tick = res.data;                    // waiting: the card says Saving… until Monday confirms
    watching.set(t.id, res.data.id);
    fastUntil = Date.now() + FAST_FOR_MS;
    render();
    schedule(FAST_MS);
  }
  // What happened to your ticks since the last look: say Saved (or Not saved) once Monday has answered.
  function noteOutcomes() {
    for (const b of boards.values()) for (const t of b.tasks) {
      const id = watching.get(t.id);
      if (!id || !t.tick || t.tick.id < id) continue;
      if (t.tick.state === 'sent') { watching.delete(t.id); savedUntil.set(t.id, Date.now() + SAVED_FOR_MS); say(`${t.title}: saved to Monday.`); setTimeout(render, SAVED_FOR_MS + 50); }
      else if (t.tick.state === 'failed') { watching.delete(t.id); say(`${t.title}: not saved to Monday.`); }
    }
  }

  /* ---------------------------------------------------------------- 1.1: instructions and the form, in a panel */
  const formClass = st => /issue/i.test(st || '') ? 'form-issue' : /concern/i.test(st || '') ? 'form-concern' : 'form-ok';
  const findTask = id => { for (const b of boards.values()) { const t = b.tasks.find(x => x.id === id); if (t) return t; } return null; };
  const dialog = h('dialog', { class: 'guide', 'aria-labelledby': 'guide-title' });
  document.body.append(dialog);
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });   // a tap outside the panel closes it
  dialog.addEventListener('close', () => { guideId = null; guideNote = null; });
  let guideId = null, guideNote = null, checkingUntil = 0;
  // The instructions as Will wrote them: headings, paragraphs and lists, as text (links as buttons that open a new tab).
  function instructionsView(blocks) {
    const out = []; let ul = null;
    for (const b of blocks || []) {
      if (b.k === 'li') { if (!ul) out.push(ul = h('ul')); ul.append(h('li', null, b.t, b.href ? [' ', link(b.href)] : null)); continue; }
      ul = null;
      // a link to the task's form: the form's own section above has the button, so the address isn't repeated here
      const isForm = b.href && /forms\.monday\.com/.test(b.href);
      const text = isForm ? b.t.replace(/\S*forms\.monday\.com\S*/g, '').replace(/\s*-?>\s*$/, '').replace(/[\s:]+$/, '') + ': use the form button above.' : b.t;
      out.push(b.k === 'h' ? h('h3', null, b.t) : h('p', null, text, b.href && !isForm ? [' ', link(b.href)] : null));
    }
    return out;
  }
  const link = href => h('a', { class: 'inline-link', href, target: '_blank', rel: 'noopener noreferrer' }, 'Open link');
  function formView(t, s) {
    const sent = t.form.sent || [];
    const day = t.day ? fmtWeekday.format(asDate(t.day)) : 'this week';
    const parts = [h('h3', null, t.form.title || 'Form')];
    if (sent.length) {
      for (const a of sent) parts.push(h('p', { class: 'form-line' }, h('span', { class: 'chip ' + formClass(a.status) }, a.status || 'Sent'), ` ${a.by || 'Someone'} · ${when(a.at)}`, a.note ? h('span', { class: 'form-note' }, a.note) : null));
      if (!s.done) parts.push(h('p', { class: 'guide-actions' }, h('button', { class: 'btn btn-brand', type: 'button', onclick: () => { dialog.close(); askTime(t); } }, 'Tick it off now')));
    } else {
      parts.push(h('p', { class: 'form-wait' + (guideNote === 'need' ? ' urgent' : '') }, guideNote === 'need'
        ? `Send the form for ${day} first. Once it has arrived on Monday you can tick this off.`
        : `No form for ${day} has arrived on Monday yet.`));
      const checking = checkingUntil > Date.now();
      parts.push(h('p', { class: 'guide-actions' },
        h('a', { class: 'btn btn-brand', href: t.form.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the form'),
        h('button', { class: 'btn', type: 'button', disabled: checking || null, onclick: checkNow }, checking ? 'Checking Monday…' : 'I’ve sent it: check again')));
      if (guideNote === 'checked') parts.push(h('p', { class: 'form-wait' }, 'Monday hasn’t got it yet. Forms can take a minute to arrive; try again shortly.'));
    }
    return h('section', { class: 'guide-form' }, parts);
  }
  function renderGuide() {
    const t = guideId && findTask(guideId);
    if (!t) { if (dialog.open) dialog.close(); return; }
    const s = stateOf(t);
    dialog.replaceChildren(h('div', { class: 'guide-head' },
        h('div', null, h('p', { class: 'guide-day' }, t.day ? fmtLong.format(asDate(t.day)) : 'Any day this week'), h('h2', { id: 'guide-title' }, t.title)),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('i-close'))),
      h('div', { class: 'guide-body' },
        t.form ? formView(t, s) : null,
        t.instructions ? h('section', { class: 'guide-text' }, instructionsView(t.instructions)) : h('p', { class: 'form-wait' }, 'No instructions on Monday for this task.')));
  }
  function openGuide(id, o = {}) {
    guideId = id; guideNote = o.needForm ? 'need' : null;
    renderGuide();
    if (!dialog.open) dialog.showModal();
  }
  // "I've sent it": ask flr-warehouse to read Monday now, then look for 40 seconds.
  async function checkNow() {
    checkingUntil = Date.now() + 40e3; fastUntil = checkingUntil; renderGuide();
    try { await client().rpc('warehouse_read_now'); } catch (e) { /* the 2-minute read still comes */ }
    schedule(2500);
    setTimeout(() => { checkingUntil = 0; const t = guideId && findTask(guideId); if (t && t.form && !(t.form.sent || []).length) guideNote = 'checked'; renderGuide(); }, 40e3);
  }

  /* ---------------------------------------------------------------- 1.2: "How long did this take you?" before a tick off */
  // "15 min", "1 h", "1 h 30 min"
  const short = m => { const hh = Math.floor(m / 60), mm = m % 60; return hh ? (mm ? `${hh} h ${mm} min` : `${hh} h`) : `${mm} min`; };
  const QUICK = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180];
  const timeDialog = h('dialog', { class: 'guide timeprompt', 'aria-labelledby': 'time-title' });
  document.body.append(timeDialog);
  timeDialog.addEventListener('click', e => { if (e.target === timeDialog) timeDialog.close(); });
  // Required: the tick is only sent once a time is chosen. Closing the prompt leaves the task as it was.
  function askTime(t) {
    let chosen = null;
    const save = h('button', { class: 'btn btn-brand', type: 'button', disabled: true }, 'Tick off');
    const hours = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: '24', placeholder: '0', 'aria-label': 'Hours' });
    const mins = h('input', { type: 'number', inputmode: 'numeric', min: '0', max: '59', placeholder: '0', 'aria-label': 'Minutes' });
    const chips = QUICK.map(m => h('button', { class: 'time-chip', type: 'button', 'aria-pressed': 'false', onclick: () => pick(m, true) }, short(m)));
    function pick(m, fromChip) {
      chosen = Number.isInteger(m) && m >= 1 && m <= 1440 ? m : null;
      chips.forEach((c, i) => c.setAttribute('aria-pressed', String(fromChip && QUICK[i] === chosen)));
      if (fromChip) { hours.value = ''; mins.value = ''; }
      save.disabled = !chosen;
      save.textContent = chosen ? `Tick off · ${short(chosen)}` : 'Tick off';
    }
    const typed = () => { const v = (parseInt(hours.value, 10) || 0) * 60 + (parseInt(mins.value, 10) || 0); pick(v || NaN, false); };
    hours.addEventListener('input', typed); mins.addEventListener('input', typed);
    save.addEventListener('click', () => { if (!chosen) return; timeDialog.close(); tick(t, true, chosen); });
    timeDialog.replaceChildren(h('div', { class: 'guide-head' },
        h('div', null, h('p', { class: 'guide-day' }, t.title), h('h2', { id: 'time-title' }, 'How long did this take you?')),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close without ticking off', onclick: () => timeDialog.close() }, icon('i-close'))),
      h('div', { class: 'guide-body' },
        h('div', { class: 'time-grid', role: 'group', 'aria-label': 'Quick times' }, chips),
        h('p', { class: 'time-other' }, h('span', null, 'Or type it:'), h('label', null, hours, ' h'), h('label', null, mins, ' min')),
        h('p', { class: 'guide-actions' }, save, h('button', { class: 'btn', type: 'button', onclick: () => timeDialog.close() }, 'Cancel'))));
    if (!timeDialog.open) timeDialog.showModal();
    chips[2].focus();
  }

  /* ---------------------------------------------------------------- the database */
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

  function gate(title, text, o = {}) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
    $('#gate-retry').hidden = !o.retry;
  }
  function failGate(e) {
    const code = flrCode(e);
    if (expired(e) || code === 'FLR_SIGN_IN_REQUIRED') return location.replace(SIGN_IN);
    if (code === 'FLR_FORBIDDEN') return gate('You don’t have access to Warehouse Tasks', 'It’s switched on for the warehouse team and FLR Super Admins. If you think you should have it, ask an FLR Super Admin.');
    if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
    if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
    if (missingFunction(e)) return gate('Warehouse Tasks isn’t ready yet', 'The FLR database doesn’t have Warehouse Tasks yet.');
    if (offline(e)) return gate('Can’t reach the FLR database', 'Check your connection and try again.', { retry: true });
    return gate('Warehouse Tasks didn’t load', 'Something went wrong getting the tasks. Try again in a moment.', { retry: true });
  }
  // warehouse_board()'s answer, checked enough to draw: anything else counts as not loaded.
  function boardFrom(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.tasks) || !d.week || !/^\d{4}-\d{2}-\d{2}$/.test(d.today || '')) return null;
    for (const t of d.tasks) if (!t || typeof t.id !== 'string' || typeof t.title !== 'string' || !Array.isArray(t.owners)) return null;
    return d;
  }
  // One week's tasks (default: this week). quiet: a refresh; it only ever replaces good tasks with newer good ones.
  async function load(week, quiet = false) {
    let res;
    try { res = await client().rpc('warehouse_board', week ? { p_week: week } : {}); }
    catch (e) { res = { error: e }; }
    if (res.error) {
      if (!quiet || expired(res.error) || ['FLR_SIGN_IN_REQUIRED', 'FLR_FORBIDDEN', 'FLR_ACCOUNT_DISABLED'].includes(flrCode(res.error))) failGate(res.error);
      return false;
    }
    const b = boardFrom(res.data);
    if (!b) { if (!quiet) failGate(new Error('The answer had no tasks in it')); return false; }
    if (!b.readAt) { gate('No tasks yet', 'Warehouse Tasks hasn’t read the Monday list yet. Try again in a few minutes.', { retry: true }); return false; }
    TODAY = b.today; THIS_WEEK = b.thisWeek;
    boards.set(b.week.start, b);
    if (!scope) scope = b.week.start === THIS_WEEK && b.tasks.some(t => t.mine) ? 'mine' : 'all';
    noteOutcomes();
    return true;
  }
  async function refresh() {
    if (document.visibilityState !== 'visible' || document.body.dataset.view !== 'ready') return schedule();
    const weeks = new Set([THIS_WEEK]); if (view === 'week' && shownWeek) weeks.add(shownWeek);
    for (const w of weeks) await load(w, true);
    render();
    if (dialog.open) {
      const t = findTask(guideId);
      if (t && t.form && (t.form.sent || []).length && checkingUntil) { checkingUntil = 0; guideNote = null; say('The form has arrived on Monday.'); }
      renderGuide();
    }
    schedule();
  }
  let timer = 0;
  function schedule(ms) {
    clearTimeout(timer);
    const fast = (watching.size || checkingUntil > Date.now()) && Date.now() < fastUntil;
    timer = setTimeout(refresh, ms || (fast ? FAST_MS : REFRESH_MS));
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(50); });
  $('#gate-retry').addEventListener('click', () => { document.body.dataset.view = 'loading'; $('#gate-message').hidden = true; boot(); });

  async function boot() {
    const c = client();
    if (!c) return gate('Warehouse Tasks isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) return location.replace(SIGN_IN);
    if (!(await load(null))) return;
    document.body.dataset.view = 'ready';
    $('#view').hidden = false;
    route();
    schedule();
  }
  boot();
})();
