/* ============================================================================
   FLR Hub: Maintenance 1.0 (Hub tile 'maintenance').

   Everyone: report an office problem, an IT fault or a Hub fault (Report an issue opens a side panel, the full screen
   on a phone), follow each report on My reports (filtered by status), see its photos and updates, and answer when the
   person handling it asks for more information. Known issues are shared notices for everyone.

   Handlers (the people chosen for a category, and every Super Admin): the To handle tab lists the reports in their
   categories with who raised them; each report's panel has an update box (In progress, Waiting for information with
   the question, Resolved, or just a note). They also write the Known issues. Super Admins choose who handles what.

   The data (Estimator repo, 20261029100000_flr_maintenance.sql):
     maintenance_home()   { you, handles, superAdmin, waitingForYou, reports, known, now }
     maintenance_queue()  { handles, superAdmin, reports (with by/email), known (to edit), handlers (Super Admins) }
     maintenance_report(), maintenance_reply(), maintenance_photo(id), maintenance_update(),
     maintenance_known_save(), maintenance_set_handler()
   Nothing goes to Monday and nobody is notified yet: handlers see new reports here.
   Photos are made smaller here first (1600 px JPEG) and sent as data: addresses (this page's CSP allows data: images).
   This page's CSP allows no inline styles: everything is built as elements.
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';              // the one FLR sign-in for the whole site
  const SIGN_IN = '../?next=maintenance';
  const MAX_FILE = 20 * 1024 * 1024, MAX_PHOTOS = 3, PHOTO_PX = 1600;
  const REFRESH_MS = 60000;

  const CATS = {
    office: { name: 'Office & Facilities', icon: 'c-office', where: 'Location', placeholder: 'For example: First floor, by the kitchen' },
    it: { name: 'IT & Equipment', icon: 'c-it', where: 'Location', placeholder: 'For example: First floor, desk 12' },
    hub: { name: 'Hub Support', icon: 'c-hub', where: 'Which page or tool?', placeholder: 'For example: Fleet Management' },
    other: { name: 'Something Else', icon: 'c-other', where: 'Location', placeholder: 'Where is it, if it matters?' },
  };
  const STATUS = {
    submitted: { name: 'Submitted', cls: 'st-submitted' },
    progress: { name: 'In progress', cls: 'st-progress' },
    waiting: { name: 'Waiting for information', cls: 'st-waiting' },
    resolved: { name: 'Resolved', cls: 'st-resolved' },
  };
  const KNOWN_STATUS = { known: { name: 'Known', cls: 'st-known' }, fixing: { name: 'Being fixed', cls: 'st-progress' }, fixed: { name: 'Fixed', cls: 'st-resolved' } };
  const IMPACT = { minor: 'Minor inconvenience', affecting: 'Affecting work', blocked: 'Unable to work' };

  let home = null;      // maintenance_home()
  let queue = null;     // maintenance_queue(), for handlers
  let tab = 'mine';
  let filter = 'all', qFilter = 'open', qCat = 'all';
  let newId = 0;
  let shown = null;     // { id, handler } the report open in the panel

  /* ---------------------------------------------------------------- small helpers */
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const svg = (id, cls) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s;
  };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  function day(iso) {
    const d = new Date(iso), now = new Date(), y = new Date(); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, y)) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  const lower = s => s.replace(/^(Today|Yesterday)$/, x => x.toLowerCase());
  const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const longDate = iso => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
  const badge = (st, map = STATUS) => el('span', 'status ' + map[st].cls, map[st].name);
  let toastTimer = 0;
  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function busy(btn, on, label) {
    btn.classList.toggle('busy', on); btn.disabled = on;
    const l = btn.querySelector('.btn-label'); if (l && label) l.textContent = label;
  }
  function showErr(p, text) { p.replaceChildren(svg('i-alert'), el('span', '', text)); p.hidden = false; }
  // Chips that act as one radio group, with arrow keys.
  function chipGroup(wrap, opts, value, onPick) {
    wrap.replaceChildren(...opts.map(([k, name, n]) => {
      const b = el('button', 'filter'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.f = k;
      b.setAttribute('aria-checked', String(value === k)); b.tabIndex = value === k ? 0 : -1;
      b.append(el('span', '', name)); if (n != null) b.append(el('span', 'n', String(n)));
      return b;
    }));
    wrap.onclick = e => { const b = e.target.closest('.filter'); if (b) { onPick(b.dataset.f); wrap.querySelector(`[data-f="${b.dataset.f}"]`).focus(); } };
    wrap.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const all = [...wrap.children], i = all.findIndex(b => b.dataset.f === value);
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
      e.preventDefault(); onPick(all[j].dataset.f); wrap.querySelector(`[data-f="${all[j].dataset.f}"]`).focus();
    };
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
  // What to tell the person when a save is refused: the database's own words for a validation, else something plain.
  const why = e => flrCode(e) === 'FLR_VALIDATION' && e.details ? e.details + '.'
    : flrCode(e) === 'FLR_NOT_FOUND' ? 'That report isn’t there any more. Refresh the page.'
    : flrCode(e) === 'FLR_FORBIDDEN' ? 'You can’t do that here.'
    : offline(e) ? 'Can’t reach the FLR database. Check your connection and try again.' : 'Something went wrong. Try again in a moment.';
  async function call(fn, args) {
    let res;
    try { res = await client().rpc(fn, args || {}); } catch (e) { res = { error: e }; }
    if (res.error && (expired(res.error) || flrCode(res.error) === 'FLR_SIGN_IN_REQUIRED')) { location.replace(SIGN_IN); throw res.error; }
    if (res.error) throw res.error;
    return res.data;
  }

  function gate(title, text) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
  }
  function failGate(e) {
    const code = flrCode(e);
    if (code === 'FLR_FORBIDDEN') return gate('Maintenance isn’t switched on for you', 'Ask an FLR Super Admin if you need it.');
    if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
    if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
    if (missingFunction(e)) return gate('Maintenance isn’t ready yet', 'The FLR database doesn’t have Maintenance yet.');
    if (offline(e)) return gate('Can’t reach the FLR database', 'Check your connection and try again.');
    return gate('Maintenance didn’t load', 'Something went wrong. Try again in a moment.');
  }
  const handler = () => !!(home && home.handles && home.handles.length);
  async function load(quiet) {
    try {
      home = await call('maintenance_home');
      queue = handler() ? await call('maintenance_queue') : null;
      $('#notice').hidden = true;
      return true;
    } catch (e) {
      if (!quiet) failGate(e);
      else { $('#notice').querySelector('span').textContent = offline(e) ? 'Can’t reach the FLR database, so this may be out of date.' : 'This page couldn’t update just now.'; $('#notice').hidden = false; }
      return false;
    }
  }
  $('#notice-retry').addEventListener('click', async () => { if (await load(true)) render(); });

  /* ---------------------------------------------------------------- My reports */
  // The person who raised it has written since a handler last did.
  const lastReply = r => { const t = r.timeline || []; return t.length > 1 && t[t.length - 1].kind === 'reply'; };
  const ORDER = { waiting: 0, submitted: 1, progress: 1, resolved: 2 };
  function reportRow(r, o = {}) {
    const li = el('li');
    const b = el('button', 'report' + (r.id === newId ? ' is-new' : '')); b.type = 'button'; b.dataset.id = r.id;
    const ico = el('span', 'cat-ico'); ico.append(svg(CATS[r.category].icon));
    const text = el('span');
    const meta = el('span', 'r-meta');
    const parts = [];
    if (o.handler) parts.push(el('span', 'r-who', r.by));
    parts.push(el('span', '', CATS[r.category].name), el('span', '', `Raised ${lower(day(r.raised))}`));
    if (o.handler && r.impact === 'blocked' && r.status !== 'resolved') parts.push(el('span', 'r-blocked', 'Unable to work'));
    if (!o.handler && r.status === 'waiting') parts.push(el('span', 'r-need', 'Reply needed'));
    if (o.handler && r.status !== 'resolved' && lastReply(r)) parts.push(el('span', 'r-need', 'New reply'));
    parts.forEach((p, i) => { if (i) meta.append(el('span', 'dot', '·')); meta.append(p); });
    text.append(el('span', 'r-title', r.title), meta);
    b.setAttribute('aria-label', [r.title, o.handler ? `Raised by ${r.by}` : '', CATS[r.category].name, `Raised ${day(r.raised)}`, STATUS[r.status].name].filter(Boolean).join('. '));
    b.append(ico, text, badge(r.status), svg('i-chev-r', 'r-chev'));
    li.append(b);
    return li;
  }

  function renderMine() {
    const reports = home.reports;
    const counts = { all: reports.length };
    for (const k in STATUS) counts[k] = reports.filter(r => r.status === k).length;
    chipGroup($('#filters'), [['all', 'All', counts.all], ...Object.entries(STATUS).map(([k, s]) => [k, s.name, counts[k]])], filter, f => { filter = f; renderMine(); });
    const list = reports.filter(r => filter === 'all' || r.status === filter)
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.raised.localeCompare(a.raised));
    $('#reports').replaceChildren(...list.map(r => reportRow(r)));
    $('#reports').hidden = !list.length; $('#reports-empty').hidden = !!list.length;
    if (!list.length) {
      $('#empty-title').textContent = filter === 'all' ? 'No reports yet' : `Nothing ${STATUS[filter].name.toLowerCase()}`;
      $('#empty-text').textContent = filter === 'all' ? 'When you report a problem, it appears here so you can follow its progress.' : 'None of your reports has this status at the moment.';
    }
    $('#known-list').replaceChildren(...home.known.map(k => {
      const li = el('li', 'known-item');
      const top = el('div', 'k-top');
      const cat = el('span', 'k-cat'); cat.append(svg(CATS[k.category].icon), el('span', '', CATS[k.category].name));
      top.append(cat, badge(k.status, KNOWN_STATUS));
      li.append(top, el('h3', 'k-title', k.title));
      if (k.text) li.append(el('p', 'k-text', k.text));
      li.append(el('p', 'k-when', `Updated ${lower(day(k.updated))}`));
      return li;
    }));
    $('#known-none').hidden = !!home.known.length;
  }
  $('#reports').addEventListener('click', e => { const b = e.target.closest('.report'); if (b) openDetail(Number(b.dataset.id), false); });

  /* ---------------------------------------------------------------- To handle (handlers) */
  function renderQueue() {
    const all = queue.reports;
    const cats = all.filter(r => qCat === 'all' || r.category === qCat);
    const open = r => r.status !== 'resolved';
    const counts = { open: cats.filter(open).length };
    for (const k in STATUS) counts[k] = cats.filter(r => r.status === k).length;
    chipGroup($('#q-filters'), [['open', 'Open', counts.open], ...Object.entries(STATUS).map(([k, s]) => [k, s.name, counts[k]])], qFilter, f => { qFilter = f; renderQueue(); });
    $('#q-cats').hidden = queue.handles.length < 2;
    if (queue.handles.length > 1) chipGroup($('#q-cats'), [['all', 'All categories'], ...queue.handles.map(c => [c, CATS[c].name])], qCat, c => { qCat = c; renderQueue(); });
    $('#queue-sub').textContent = queue.handles.length === 4 ? 'Every category.' : `${queue.handles.map(c => CATS[c].name).join(', ')}.`;
    // New ones first, then those with a reply waiting, then the rest; within each, Unable to work first, then newest.
    const rank = r => r.status === 'submitted' ? 0 : r.status !== 'resolved' && lastReply(r) ? 1 : r.status === 'resolved' ? 3 : 2;
    const list = cats.filter(r => qFilter === 'open' ? open(r) : r.status === qFilter)
      .sort((a, b) => rank(a) - rank(b) || (b.impact === 'blocked') - (a.impact === 'blocked') || b.raised.localeCompare(a.raised));
    $('#queue').replaceChildren(...list.map(r => reportRow(r, { handler: true })));
    $('#queue').hidden = !list.length; $('#queue-empty').hidden = !!list.length;
    $('#queue-empty-title').textContent = qFilter === 'open' ? 'Nothing open' : `Nothing ${STATUS[qFilter].name.toLowerCase()}`;
    $('#queue-empty-text').textContent = qFilter === 'open' ? 'New reports in your categories appear here.' : 'No report in your categories has this status.';
    const n = all.filter(r => r.status === 'submitted' || (open(r) && lastReply(r))).length;
    $('#tab-n').textContent = n ? String(n) : '';

    $('#known-manage').replaceChildren(...queue.known.map(k => {
      const li = el('li');
      const b = el('button', 'report'); b.type = 'button'; b.dataset.known = k.id;
      const ico = el('span', 'cat-ico'); ico.append(svg(CATS[k.category].icon));
      const text = el('span'); const meta = el('span', 'r-meta');
      meta.append(el('span', '', CATS[k.category].name), el('span', 'dot', '·'), el('span', '', `Updated ${lower(day(k.updated))}${k.by ? ` by ${k.by}` : ''}`));
      text.append(el('span', 'r-title', k.title), meta);
      b.append(ico, text, k.active ? badge(k.status, KNOWN_STATUS) : el('span', 'status st-off', 'Hidden'), svg('i-chev-r', 'r-chev'));
      li.append(b); return li;
    }));
    $('#known-manage').hidden = !queue.known.length;
    $('#known-manage-none').hidden = !!queue.known.length;
    $('#handlers-section').hidden = !queue.superAdmin;
    if (queue.superAdmin) renderHandlers();
  }
  $('#queue').addEventListener('click', e => { const b = e.target.closest('.report'); if (b) openDetail(Number(b.dataset.id), true); });
  $('#known-manage').addEventListener('click', e => { const b = e.target.closest('.report'); if (b) openKnown(Number(b.dataset.known)); });

  function renderHandlers() {
    $('#handlers').replaceChildren(...Object.entries(CATS).map(([c, cat]) => {
      const card = el('div', 'hcard');
      const h = el('h3'); const ico = el('span', 'cat-ico'); ico.append(svg(cat.icon)); h.append(ico, el('span', '', cat.name));
      const ul = el('ul', 'hlist');
      const people = (queue.handlers || []).filter(x => x.category === c);
      if (!people.length) ul.append(el('li', 'none', 'Nobody yet, so Super Admins handle these.'));
      for (const p of people) {
        const li = el('li'); const who = el('span');
        who.append(el('span', '', p.name), el('span', 'sub', p.account ? p.email : `${p.email} · account switched off`));
        const x = el('button', 'iconbtn small'); x.type = 'button'; x.setAttribute('aria-label', `Remove ${p.name} from ${cat.name}`); x.append(svg('i-close'));
        x.addEventListener('click', () => setHandler(c, p.email, false, x));
        li.append(who, x); ul.append(li);
      }
      const f = el('form', 'hadd'); f.noValidate = true;
      const input = el('input', 'input'); input.type = 'email'; input.placeholder = 'name@flr.co.uk'; input.autocomplete = 'off'; input.setAttribute('aria-label', `Add a handler for ${cat.name}`);
      const add = el('button', 'btn', 'Add'); add.type = 'submit';
      const err = el('p', 'field-error'); err.hidden = true; err.id = `herr-${c}`; input.setAttribute('aria-describedby', err.id);
      input.addEventListener('input', () => { err.hidden = true; });
      f.append(input, add);
      f.addEventListener('submit', e => { e.preventDefault(); setHandler(c, input.value, true, add, err); });
      card.append(h, ul, f, err);
      return card;
    }));
  }
  async function setHandler(category, email, on, btn, err) {
    btn.disabled = true;
    try {
      queue.handlers = await call('maintenance_set_handler', { p_category: category, p_email: email, p_on: on });
      renderHandlers();
      toast(on ? `Added to ${CATS[category].name}` : `Removed from ${CATS[category].name}`);
    } catch (e) {
      btn.disabled = false;
      if (err) showErr(err, why(e)); else toast(why(e));
    }
  }

  /* ---------------------------------------------------------------- tabs */
  function setTab(t, focus) {
    tab = t;
    $('#tab-mine').setAttribute('aria-selected', String(t === 'mine')); $('#tab-mine').tabIndex = t === 'mine' ? 0 : -1;
    $('#tab-handle').setAttribute('aria-selected', String(t === 'handle')); $('#tab-handle').tabIndex = t === 'handle' ? 0 : -1;
    $('#mine-view').hidden = t !== 'mine'; $('#handle-view').hidden = t !== 'handle';
    if (focus) $('#tab-' + t).focus();
    try { sessionStorage.setItem('flr-hub:maintenance-tab', t); } catch (e) { /* ignore */ }
  }
  $('#tab-mine').addEventListener('click', () => setTab('mine'));
  $('#tab-handle').addEventListener('click', () => setTab('handle'));
  $('#tabs').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setTab(tab === 'mine' ? 'handle' : 'mine', true); } });

  function render() {
    renderMine();
    $('#tabs').hidden = !handler();
    if (handler() && queue) renderQueue(); else if (tab === 'handle') setTab('mine');
    if (panel.open && shown && !$('#detail').hidden && !$('#detail').contains(document.activeElement)) openDetail(shown.id, shown.handler, { keep: true });
  }

  /* ---------------------------------------------------------------- the panel */
  const panel = $('#panel');
  let opener = null, closeToken = 0;
  function openPanel(mode, title) {
    for (const id of ['form', 'done', 'detail', 'kform']) $('#' + id).hidden = id !== mode;
    $('#panel-title').textContent = title;
    if (panel.classList.contains('closing')) { closeToken++; panel.classList.remove('closing'); }
    if (!panel.open) { opener = document.activeElement; panel.showModal(); document.documentElement.classList.add('locked'); }
  }
  function closePanel() {
    if (!panel.open || panel.classList.contains('closing')) return;
    // Slide out, then close. Only this close may finish it: opening the panel again in the meantime cancels it.
    const token = ++closeToken;
    const finish = () => { if (token !== closeToken || !panel.classList.contains('closing')) return; panel.classList.remove('closing'); panel.close(); };
    panel.classList.add('closing');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    const onEnd = e => { if (e.target === panel) { panel.removeEventListener('animationend', onEnd); finish(); } };
    panel.addEventListener('animationend', onEnd);
    setTimeout(() => { panel.removeEventListener('animationend', onEnd); finish(); }, 400);
  }
  panel.addEventListener('close', () => {
    document.documentElement.classList.remove('locked'); shown = null; zoomClose();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (opener && document.contains(opener)) opener.focus();
  });
  panel.addEventListener('cancel', e => { e.preventDefault(); if (!zoomClose()) closePanel(); });   // Escape: the photo first, then the panel
  panel.addEventListener('click', e => { if (e.target === panel) closePanel(); });   // the dimmed page behind it
  $('#panel-close').addEventListener('click', closePanel);

  /* ---------------------------------------------------------------- photos: made smaller here, then sent */
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onerror = () => reject(new Error('read'));
      rd.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode'));
        img.onload = () => {
          const k = Math.min(1, PHOTO_PX / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          resolve({ name: (file.name || 'photo').replace(/\.[a-z0-9]+$/i, '').slice(0, 100) + '.jpg', data: c.toDataURL('image/jpeg', .82) });
        };
        img.src = String(rd.result);
      };
      rd.readAsDataURL(file);
    });
  }
  // Photos waiting to be sent, as thumbnails with a remove button each.
  function photoPicker(list, input, errEl, onChange) {
    const photos = [];
    const draw = () => {
      list.replaceChildren(...photos.map((p, i) => {
        const li = el('li', 'thumb'); const img = el('img'); img.src = p.data; img.alt = p.name;
        const x = el('button'); x.type = 'button'; x.setAttribute('aria-label', `Remove ${p.name}`); x.append(svg('i-close'));
        x.addEventListener('click', () => { photos.splice(i, 1); draw(); input.focus(); });
        li.append(img, x); return li;
      }));
      if (onChange) onChange(photos.length);
    };
    input.addEventListener('change', async () => {
      const files = [...(input.files || [])]; input.value = '';
      errEl.hidden = true;
      for (const f of files) {
        if (photos.length >= MAX_PHOTOS) { showErr(errEl, `Add up to ${MAX_PHOTOS} photos.`); break; }
        if (!/^image\//.test(f.type)) { showErr(errEl, 'That file isn’t a photo or screenshot. Choose an image file.'); continue; }
        if (f.size > MAX_FILE) { showErr(errEl, 'That image is over 20 MB. Choose a smaller one.'); continue; }
        try { photos.push(await shrink(f)); draw(); } catch (e) { showErr(errEl, 'That image couldn’t be read. Try another one.'); }
      }
    });
    return { photos, clear() { photos.length = 0; draw(); } };
  }

  const photoCache = new Map();
  function photoData(id) {
    if (!photoCache.has(id)) photoCache.set(id, call('maintenance_photo', { p_id: id }).then(p => p.data).catch(e => { photoCache.delete(id); throw e; }));
    return photoCache.get(id);
  }
  function photoImg(ph) {
    const img = el('img', 'loading'); img.alt = ph.name; img.decoding = 'async';
    const b = el('button', 'zoom-btn'); b.type = 'button'; b.setAttribute('aria-label', `View ${ph.name} full size`);
    photoData(ph.id).then(d => { img.src = d; img.classList.remove('loading'); }).catch(() => { img.alt = `${ph.name} (couldn’t load)`; img.classList.remove('loading'); });
    b.append(img); b.addEventListener('click', () => { if (img.src) zoom(img.src, ph.name); });
    return b;
  }
  // A photo at full size, over the panel. A click or Escape closes it.
  let zoomEl = null;
  function zoom(src, name) {
    zoomClose();
    zoomEl = el('div', 'zoom'); zoomEl.setAttribute('role', 'dialog'); zoomEl.setAttribute('aria-label', name); zoomEl.tabIndex = -1;
    const img = el('img'); img.src = src; img.alt = name; zoomEl.append(img);
    zoomEl.addEventListener('click', zoomClose);
    panel.append(zoomEl); zoomEl.focus();
  }
  function zoomClose() { if (!zoomEl) return false; zoomEl.remove(); zoomEl = null; return true; }

  /* ---------------------------------------------------------------- Report an issue */
  const form = $('#form');
  $('#cats').replaceChildren(...Object.entries(CATS).map(([k, c]) => {
    const l = el('label', 'cat');
    const i = el('input'); i.type = 'radio'; i.name = 'category'; i.value = k;
    const ico = el('span', 'cat-ico'); ico.append(svg(c.icon));
    l.append(i, ico, el('span', 'cat-name', c.name));
    return l;
  }));
  form.addEventListener('change', e => {
    if (e.target.name === 'category') {
      const c = CATS[e.target.value];
      $('#where-label').textContent = c.where; $('#f-where').placeholder = c.placeholder;
      clearError('category');
    }
    if (e.target.name === 'impact') clearError('impact');
  });
  for (const id of ['title', 'what']) $('#f-' + id).addEventListener('input', () => clearError(id));
  const formPhotos = photoPicker($('#thumbs'), $('#f-photo'), $('#err-photo'), n => { form.querySelector('.photo-add').hidden = n >= MAX_PHOTOS; });

  function openForm() {
    $('#as').querySelector('span').replaceChildren('Reporting as ', el('b', '', home.you.name || home.you.email || 'you'), home.you.name && home.you.email ? ` · ${home.you.email}` : '');
    $('#form-error').hidden = true;
    openPanel('form', 'Report an issue');
    history.replaceState(null, '', '#report');
    setTimeout(() => { const c = form.querySelector('input[name="category"]:checked') || form.querySelector('input[name="category"]'); c.focus({ preventScroll: true }); }, 60);
  }
  $('#report-btn').addEventListener('click', openForm);

  function setError(id, text) {
    showErr($('#err-' + id), text);
    const input = $('#f-' + id);
    if (input && input.tagName !== 'FIELDSET') input.setAttribute('aria-invalid', 'true');
    if (id === 'category') $('#cats').classList.add('invalid');
    if (id === 'impact') $('#impact').classList.add('invalid');
  }
  function clearError(id) {
    $('#err-' + id).hidden = true;
    const input = $('#f-' + id);
    if (input) input.removeAttribute('aria-invalid');
    if (id === 'category') $('#cats').classList.remove('invalid');
    if (id === 'impact') $('#impact').classList.remove('invalid');
    if (!form.querySelector('.field-error:not([hidden])')) $('#form-error').hidden = true;
  }
  function validate() {
    const v = {
      cat: (form.querySelector('input[name="category"]:checked') || {}).value || '',
      title: $('#f-title').value.trim().replace(/\s+/g, ' '),
      what: $('#f-what').value.trim(),
      where: $('#f-where').value.trim(),
      impact: (form.querySelector('input[name="impact"]:checked') || {}).value || '',
    };
    const errs = [];
    if (!v.cat) errs.push(['category', 'Choose what it’s about.', form.querySelector('input[name="category"]')]);
    if (!v.title) errs.push(['title', 'Give the issue a short title.', $('#f-title')]);
    else if (v.title.length < 4) errs.push(['title', 'Make the title a little longer, so it’s clear what’s wrong.', $('#f-title')]);
    if (!v.what) errs.push(['what', 'Say what’s wrong.', $('#f-what')]);
    else if (v.what.length < 10) errs.push(['what', 'Add a few more words about what’s wrong.', $('#f-what')]);
    if (!v.impact) errs.push(['impact', 'Choose how much it’s affecting you.', form.querySelector('input[name="impact"]')]);
    ['category', 'title', 'what', 'impact'].forEach(clearError);
    errs.forEach(([id, text]) => setError(id, text));
    return { v, errs };
  }
  function formProblem(text) { const fe = $('#form-error'); fe.querySelector('span').textContent = text; fe.hidden = false; }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#submit');
    if (btn.disabled) return;
    const { v, errs } = validate();
    if (errs.length) {
      formProblem(errs.length === 1 ? 'One thing needs fixing before you send this.' : `${errs.length} things need fixing before you send this.`);
      errs[0][2].focus();
      return;
    }
    busy(btn, true, 'Sending…');
    try {
      const r = await call('maintenance_report', { p_category: v.cat, p_title: v.title, p_what: v.what, p_location: v.where, p_impact: v.impact, p_photos: formPhotos.photos });
      home.reports.unshift(r); newId = r.id; filter = 'all';
      form.reset(); formPhotos.clear(); $('#where-label').textContent = 'Location'; $('#f-where').placeholder = CATS.office.placeholder;
      setTab('mine'); render();
      $('#done-text').textContent = `“${r.title}” is in My reports as ${r.ref}, marked Submitted.`;
      $('#done-view').dataset.id = r.id;
      openPanel('done', 'Report an issue');
      history.replaceState(null, '', location.pathname + location.search);
      $('#done-title').focus();
      if (handler()) load(true).then(ok => { if (ok) render(); });
    } catch (err) {
      formProblem(`Your report wasn’t sent. ${why(err)}`); $('#form-error').focus();
    } finally { busy(btn, false, 'Send report'); }
  });
  $('#done-close').addEventListener('click', closePanel);
  $('#done-view').addEventListener('click', e => openDetail(Number(e.currentTarget.dataset.id), false));

  /* ---------------------------------------------------------------- a report's details */
  const find = (id, asHandler) => ((asHandler ? queue && queue.reports : home.reports) || []).find(x => x.id === id);
  function openDetail(id, asHandler, o = {}) {
    const r = find(id, asHandler);
    if (!r) { if (!o.keep) toast('That report isn’t there any more.'); return; }
    shown = { id, handler: asHandler };
    const d = $('#detail'); const scroll = d.scrollTop;
    const top = el('div', 'd-top'); top.append(badge(r.status), el('span', 'd-ref', r.ref));
    const facts = el('dl', 'd-facts');
    const fact = (k, v) => { if (v) facts.append(el('dt', '', k), el('dd', '', v)); };
    fact('Category', CATS[r.category].name);
    fact(r.category === 'hub' ? 'Page or tool' : 'Location', r.location);
    fact('Impact', IMPACT[r.impact]);
    fact('Raised', `${longDate(r.raised)} at ${time(r.raised)}`);
    fact('Raised by', asHandler ? `${r.by} · ${r.email}` : 'You');
    const own = r.photos.filter(p => !p.update);
    const files = own.length ? el('ul', 'd-files') : el('p', 'd-none', 'No photos or screenshots.');
    for (const ph of own) { const li = el('li', 'd-file'); li.append(photoImg(ph), el('span', '', ph.name)); files.append(li); }
    const tl = el('ol', 'tl');
    for (const t of r.timeline) {
      const mine = !t.handler && t.kind !== 'submitted';
      const li = el('li', `tl-${mine ? 'you' : t.kind === 'request' ? 'waiting' : t.status === 'resolved' ? 'resolved' : t.kind === 'submitted' ? 'submitted' : 'progress'}`);
      const what = t.kind === 'submitted' ? 'Report submitted' : t.kind === 'request' ? 'Asked for more information'
        : t.kind === 'reply' ? (asHandler ? `${t.by} replied` : 'You replied') : t.kind === 'message' ? 'Update'
        : t.status === 'resolved' ? 'Resolved' : `Marked ${STATUS[t.status].name}`;
      const head = el('div', 'tl-head'); head.append(el('span', 'tl-what', what), el('span', 'tl-when', `${day(t.at)}, ${time(t.at)}`));
      li.append(el('span', 'tl-dot'), head, el('p', 'tl-who', t.by === 'you' ? 'You' : t.by));
      if (t.message) li.append(el('p', 'tl-msg', t.message));
      const attached = r.photos.filter(p => p.update === t.id);
      if (attached.length) { const ul = el('ul', 'tl-photos'); attached.forEach(ph => { const x = el('li'); x.append(photoImg(ph)); ul.append(x); }); li.append(ul); }
      tl.append(li);
    }
    d.replaceChildren(top, el('h3', 'd-title', r.title), facts, el('h4', 'd-h', 'What’s wrong'), el('p', 'd-desc', r.what),
      el('h4', 'd-h', 'Photos and screenshots'), files, el('h4', 'd-h', 'Updates'), tl);
    if (asHandler) d.append(updateBox(r));
    else if (r.status !== 'resolved') d.append(replyBox(r));
    openPanel('detail', 'Report details');
    d.scrollTop = o.keep ? scroll : 0;
    history.replaceState(null, '', '#' + r.ref + (asHandler ? '/handle' : ''));
  }

  // The person who raised it: answer a question, or add something. Waiting for information makes it stand out.
  function replyBox(r) {
    const waiting = r.status === 'waiting';
    const f = el('form', waiting ? 'reply' : 'upd'); f.noValidate = true;
    const l = el('label', 'label', waiting ? 'Reply with the information asked for' : 'Add more information'); l.htmlFor = 'reply-text';
    const h = el('p', 'hint', 'It goes to the people handling this report.');
    const t = el('textarea', 'input'); t.id = 'reply-text'; t.rows = 3; t.maxLength = 1500; t.setAttribute('aria-describedby', 'reply-err');
    const add = el('label', 'link add-photos'); add.htmlFor = 'reply-photo'; add.append(svg('i-camera'), el('span', '', 'Add photos'));
    const input = el('input', 'sr'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.id = 'reply-photo';
    const thumbs = el('ul', 'thumbs');
    const err = el('p', 'field-error'); err.id = 'reply-err'; err.hidden = true;
    const b = el('button', 'btn btn-brand'); b.type = 'submit'; b.append(svg('i-spin', 'spin'), el('span', 'btn-label', 'Send reply'));
    const acts = el('div', 'reply-actions'); acts.append(add, input, b);
    f.append(l, h, t, thumbs, err, acts);
    const picker = photoPicker(thumbs, input, err);
    t.addEventListener('input', () => { err.hidden = true; t.removeAttribute('aria-invalid'); });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (b.disabled) return;
      const msg = t.value.trim();
      if (msg.length < 2) { showErr(err, 'Write a reply first.'); t.setAttribute('aria-invalid', 'true'); t.focus(); return; }
      busy(b, true, 'Sending…');
      try {
        const nr = await call('maintenance_reply', { p_id: r.id, p_message: msg, p_photos: picker.photos });
        home.reports = home.reports.map(x => x.id === nr.id ? nr : x);
        render(); openDetail(nr.id, false);
        toast('Reply sent');
        if (handler()) load(true).then(ok => { if (ok) render(); });
      } catch (er) { busy(b, false, 'Send reply'); showErr(err, `Not sent. ${why(er)}`); }
    });
    return f;
  }

  // A handler's update: a new status and/or a note. Waiting for information needs the question.
  function updateBox(r) {
    const f = el('form', 'upd'); f.noValidate = true;
    const lg = el('p', 'label', 'Update this report');
    const chips = el('div', 'chips'); chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', 'Status');
    for (const k of ['progress', 'waiting', 'resolved']) {
      const l = el('label', 'chip-opt'); const i = el('input'); i.type = 'radio'; i.name = 'upd-status'; i.value = k; i.checked = r.status === k;
      l.append(i, el('span', '', STATUS[k].name)); chips.append(l);
    }
    const ml = el('label', 'label'); ml.htmlFor = 'upd-text';
    const t = el('textarea', 'input'); t.id = 'upd-text'; t.rows = 3; t.maxLength = 1500; t.setAttribute('aria-describedby', 'upd-hint upd-err');
    const h = el('p', 'hint'); h.id = 'upd-hint'; h.textContent = `${r.by} sees this on their report.`;
    const err = el('p', 'field-error'); err.id = 'upd-err'; err.hidden = true;
    const b = el('button', 'btn btn-brand'); b.type = 'submit'; b.append(svg('i-spin', 'spin'), el('span', 'btn-label', 'Save update'));
    const acts = el('div', 'reply-actions'); acts.append(b);
    f.append(lg, chips, ml, t, h, err, acts);
    const picked = () => (f.querySelector('input[name="upd-status"]:checked') || {}).value || null;
    const label = () => {
      const s = picked(), changed = s && s !== r.status;
      ml.textContent = s === 'waiting' && changed ? 'What do you need to know?' : s === 'resolved' && changed ? 'What was done? (optional)' : 'Message (optional)';
    };
    label(); chips.addEventListener('change', () => { err.hidden = true; label(); });
    t.addEventListener('input', () => { err.hidden = true; t.removeAttribute('aria-invalid'); });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (b.disabled) return;
      let s = picked(); if (s === r.status) s = null;
      const msg = t.value.trim();
      if (s === 'waiting' && msg.length < 5) { showErr(err, 'Say what information you need.'); t.setAttribute('aria-invalid', 'true'); t.focus(); return; }
      if (!s && !msg) { showErr(err, 'Choose a new status or write an update.'); t.focus(); return; }
      busy(b, true, 'Saving…');
      try {
        const nr = await call('maintenance_update', { p_id: r.id, p_status: s, p_message: msg });
        queue.reports = queue.reports.map(x => x.id === nr.id ? nr : x);
        render(); openDetail(nr.id, true);
        toast(s === 'waiting' ? 'Question sent' : s === 'resolved' ? 'Marked Resolved' : s ? `Marked ${STATUS[s].name}` : 'Update added');
        if (home.reports.some(x => x.id === nr.id)) load(true).then(ok => { if (ok) render(); });   // your own report, handled by you
      } catch (er) { busy(b, false, 'Save update'); showErr(err, `Not saved. ${why(er)}`); }
    });
    return f;
  }

  /* ---------------------------------------------------------------- Known issues (handlers) */
  const kform = $('#kform');
  let editing = null;
  function openKnown(id) {
    const k = id ? queue.known.find(x => x.id === id) : null;
    editing = k ? k.id : null;
    $('#k-category').replaceChildren(...queue.handles.map(c => { const o = el('option', '', CATS[c].name); o.value = c; return o; }));
    $('#k-category').value = k ? k.category : queue.handles[0];
    $('#k-title').value = k ? k.title : ''; $('#k-text').value = k ? k.text : '';
    kform.querySelector(`input[name="k-status"][value="${k ? k.status : 'fixing'}"]`).checked = true;
    $('#k-active').checked = k ? k.active : true;
    $('#kform-error').hidden = true;
    openPanel('kform', k ? 'Known issue' : 'Add a known issue');
    setTimeout(() => $('#k-title').focus({ preventScroll: true }), 60);
  }
  $('#known-add').addEventListener('click', () => openKnown(null));
  function kErr(text) { const p = $('#kform-error'); p.querySelector('span').textContent = text; p.hidden = false; p.focus(); }
  kform.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#k-save'); if (btn.disabled) return;
    const title = $('#k-title').value.trim().replace(/\s+/g, ' ');
    if (title.length < 4) { kErr('Give it a title of at least 4 characters.'); $('#k-title').focus(); return; }
    busy(btn, true, 'Saving…');
    try {
      await call('maintenance_known_save', { p_id: editing, p_category: $('#k-category').value, p_title: title, p_text: $('#k-text').value.trim(),
        p_status: kform.querySelector('input[name="k-status"]:checked').value, p_active: $('#k-active').checked });
      await load(true); render(); closePanel();
      toast(editing ? 'Known issue saved' : 'Known issue added');
    } catch (er) { kErr(`Not saved. ${why(er)}`); }
    finally { busy(btn, false, 'Save'); }
  });

  /* ---------------------------------------------------------------- start */
  function route() {
    const m = /^#(report|MNT-(\d+)(\/handle)?)$/.exec(location.hash);
    if (!m) return;
    if (m[1] === 'report') openForm();
    else { const asHandler = !!m[3] && handler(); if (asHandler) setTab('handle'); openDetail(Number(m[2]), asHandler); }
  }
  // A link to #report or a report (or Back and Forward) while the page is open.
  addEventListener('hashchange', () => { if (document.body.dataset.view === 'ready') route(); });
  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, REFRESH_MS); };
  async function refresh() {
    // Never while someone is typing in the panel: the next round will do.
    const typing = panel.open && /^(TEXTAREA|INPUT|SELECT)$/.test((document.activeElement || {}).tagName || '');
    if (document.visibilityState === 'visible' && !typing && await load(true)) render();
    schedule();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { clearTimeout(timer); timer = setTimeout(refresh, 300); } });

  async function boot() {
    const c = client();
    if (!c) return gate('Maintenance isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) return location.replace(SIGN_IN);
    if (!(await load(false))) return;
    let t = 'mine'; try { t = sessionStorage.getItem('flr-hub:maintenance-tab') || 'mine'; } catch (e) { /* ignore */ }
    setTab(handler() && t === 'handle' ? 'handle' : 'mine');
    render();
    document.body.dataset.view = 'ready';
    $('#view').hidden = false;
    route();
    schedule();
  }
  boot();
})();
