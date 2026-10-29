/* ============================================================================
   FLR Hub: Maintenance (Hub tile 'maintenance'). PROTOTYPE, for reviewing the look and feel.

   Staff report office problems, IT faults and Hub faults, and follow each report's progress:
   My reports (their own, filtered by status) and Known issues (shared notices anyone may see).
   Report an issue opens a side panel (the full screen on a phone); a report's details open in
   the same panel, with its photos and a timeline of updates.

   What is real: the FLR sign-in. The page asks the Hub who is signed in (public.hub_home()) and
   reports in their name, so nobody types it again.
   What is not: everything else. The reports are labelled samples, made up for this preview, and
   anything submitted or replied to stays in this browser (localStorage, DEMO_KEY) until Reset the
   demo. Nothing is sent to Monday, nobody is notified and no live records are touched.
   This page's CSP allows no inline styles: everything is built as elements.
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';              // the one FLR sign-in for the whole site
  const SIGN_IN = '../?next=maintenance';
  const DEMO_KEY = 'flr-hub:maintenance-demo';        // this browser only: the demo's reports, never FLR records
  const MAX_PHOTO = 10 * 1024 * 1024;

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
  const IMPACT = { minor: 'Minor inconvenience', affecting: 'Affecting work', blocked: 'Unable to work' };

  /* ---------------------------------------------------------------- sample data (made up for the preview)
     Dates are days before today, so the samples always look recent. */
  const ago = (days, hh, mm) => { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
  const samples = () => [
    { id: 'MNT-1044', sample: true, cat: 'it', title: 'Second monitor not detected', status: 'submitted', impact: 'minor', where: 'First floor, desk 12',
      what: 'My second screen stopped showing anything this morning. The cable looks fine and I’ve restarted the laptop twice.',
      files: [], raised: ago(0, 8, 41),
      timeline: [{ kind: 'submitted', at: ago(0, 8, 41), who: 'You', what: 'Report submitted' }] },
    { id: 'MNT-1042', sample: true, cat: 'it', title: 'First-floor printer keeps jamming', status: 'waiting', impact: 'affecting', where: 'First floor, by the kitchen',
      what: 'The printer by the kitchen jams on nearly every job and shows a paper error. I’ve cleared the tray but it happens again on the next print.',
      files: [{ name: 'printer-error.jpg', src: 'samples/printer-error.svg' }], raised: ago(2, 9, 14),
      timeline: [
        { kind: 'submitted', at: ago(2, 9, 14), who: 'You', what: 'Report submitted' },
        { kind: 'progress', at: ago(2, 11, 2), who: 'IT support (sample)', what: 'Picked up', msg: 'Thanks for reporting this. We’re looking into it.' },
        { kind: 'waiting', at: ago(1, 14, 30), who: 'IT support (sample)', what: 'Asked for more information',
          msg: 'Does it jam on every print, or only on double-sided jobs? If you can, add a photo of the message on the printer’s screen next time it happens.' },
      ] },
    { id: 'MNT-1039', sample: true, cat: 'office', title: 'Kitchen cupboard door hanging off', status: 'progress', impact: 'minor', where: 'Ground floor kitchen, left of the sink',
      what: 'The top hinge on the cupboard with the mugs has come loose, so the door hangs at an angle and doesn’t close.',
      files: [{ name: 'cupboard.jpg', src: 'samples/cupboard.svg' }], raised: ago(7, 13, 5),
      timeline: [
        { kind: 'submitted', at: ago(7, 13, 5), who: 'You', what: 'Report submitted' },
        { kind: 'progress', at: ago(6, 9, 20), who: 'Facilities (sample)', what: 'Picked up', msg: 'A replacement hinge is on order. Please don’t use the door until it’s fixed.' },
        { kind: 'progress', at: ago(2, 16, 10), who: 'Facilities (sample)', what: 'Update', msg: 'The hinge has arrived. Fitting is booked for Monday morning.' },
      ] },
    { id: 'MNT-1031', sample: true, cat: 'hub', title: 'Fleet Management page won’t load', status: 'resolved', impact: 'blocked', where: 'Hub → Fleet Management',
      what: 'The page stays on the grey loading boxes and never shows the map. Other Hub tools open fine.',
      files: [{ name: 'screenshot.png', src: 'samples/hub-loading.svg' }], raised: ago(15, 8, 55),
      timeline: [
        { kind: 'submitted', at: ago(15, 8, 55), who: 'You', what: 'Report submitted' },
        { kind: 'progress', at: ago(15, 9, 40), who: 'Hub support (sample)', what: 'Picked up', msg: 'We can see the same thing on older iPads. Looking at it now.' },
        { kind: 'resolved', at: ago(14, 12, 15), who: 'Hub support (sample)', what: 'Resolved', msg: 'Fixed. Close the page and open it again from the Hub, and it should load. Thanks for the screenshot.' },
      ] },
  ];
  // Shared notices: written for everyone, with nothing personal in them.
  const KNOWN = [
    { cat: 'it', title: 'Wi-Fi dropping in the first-floor meeting room', status: 'progress', text: 'An engineer is booked to replace the access point. Until then, the wired port by the screen works.', updated: ago(1, 10, 0) },
    { cat: 'office', title: 'Car park barrier slow to open', status: 'progress', text: 'Hold your fob to the reader for a couple of seconds. A repair visit is being arranged.', updated: ago(3, 15, 20) },
    { cat: 'hub', title: 'Order Tracker can be a few minutes behind Monday', status: 'submitted', text: 'Changes made on Monday can take up to 5 minutes to appear. Nothing is lost.', updated: ago(5, 9, 0) },
  ];

  /* ---------------------------------------------------------------- the demo's own store (this browser only) */
  const store = {
    get() { try { const v = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); return Array.isArray(v) ? v : null; } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(v)); } catch (e) { /* too big or a private window: kept for this visit only */ } },
    del() { try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* ignore */ } },
  };
  let reports = store.get() || samples();
  const save = () => store.set(reports);
  let me = { name: '', email: '' };
  let filter = 'all';
  let newId = '';

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
  const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const longDate = iso => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
  const badge = st => el('span', 'status ' + STATUS[st].cls, STATUS[st].name);
  let toastTimer = 0;
  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  /* ---------------------------------------------------------------- My reports */
  function renderFilters() {
    const counts = { all: reports.length };
    for (const k in STATUS) counts[k] = reports.filter(r => r.status === k).length;
    const opts = [['all', 'All'], ...Object.entries(STATUS).map(([k, s]) => [k, s.name])];
    const wrap = $('#filters');
    wrap.replaceChildren(...opts.map(([k, name]) => {
      const b = el('button', 'filter'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.f = k;
      b.setAttribute('aria-checked', String(filter === k)); b.tabIndex = filter === k ? 0 : -1;
      b.append(el('span', '', name), el('span', 'n', String(counts[k])));
      return b;
    }));
  }
  $('#filters').addEventListener('click', e => { const b = e.target.closest('.filter'); if (b) { filter = b.dataset.f; render(); $(`.filter[data-f="${filter}"]`).focus(); } });
  $('#filters').addEventListener('keydown', e => {   // arrow keys move along the chips, as in a radio group
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const all = [...$('#filters').children], i = all.findIndex(b => b.dataset.f === filter);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    e.preventDefault(); filter = all[j].dataset.f; render(); $(`.filter[data-f="${filter}"]`).focus();
  });

  function reportRow(r) {
    const li = el('li');
    const b = el('button', 'report' + (r.id === newId ? ' is-new' : '')); b.type = 'button'; b.dataset.id = r.id;
    const ico = el('span', 'cat-ico'); ico.append(svg(CATS[r.cat].icon));
    const text = el('span');
    const title = el('span', 'r-title', r.title);
    const meta = el('span', 'r-meta');
    meta.append(el('span', '', CATS[r.cat].name), el('span', 'dot', '·'), el('span', '', `Raised ${day(r.raised).replace(/^(Today|Yesterday)$/, s => s.toLowerCase())}`));
    if (r.status === 'waiting') meta.append(el('span', 'dot', '·'), el('span', 'r-need', 'Reply needed'));
    if (r.sample) meta.append(el('span', 'tag', 'Sample'));
    text.append(title, meta);
    b.setAttribute('aria-label', `${r.title}. ${CATS[r.cat].name}. Raised ${day(r.raised)}. ${STATUS[r.status].name}${r.sample ? '. Sample report' : ''}`);
    b.append(ico, text, badge(r.status), svg('i-chev-r', 'r-chev'));
    li.append(b);
    return li;
  }
  function render() {
    renderFilters();
    const order = { waiting: 0, submitted: 1, progress: 1, resolved: 2 };   // what needs you first, finished ones last
    const shown = reports.filter(r => filter === 'all' || r.status === filter)
      .sort((a, b) => order[a.status] - order[b.status] || b.raised.localeCompare(a.raised));
    $('#reports').replaceChildren(...shown.map(reportRow));
    $('#reports').hidden = !shown.length;
    $('#reports-empty').hidden = !!shown.length;
    if (!shown.length) {
      $('#empty-title').textContent = filter === 'all' ? 'No reports yet' : `Nothing ${STATUS[filter].name.toLowerCase()}`;
      $('#empty-text').textContent = filter === 'all' ? 'When you report a problem, it appears here so you can follow its progress.' : 'None of your reports has this status at the moment.';
    }
  }
  $('#reports').addEventListener('click', e => { const b = e.target.closest('.report'); if (b) openDetail(b.dataset.id); });

  function renderKnown() {
    $('#known-list').replaceChildren(...KNOWN.map(k => {
      const li = el('li', 'known-item');
      const top = el('div', 'k-top');
      const cat = el('span', 'k-cat'); cat.append(svg(CATS[k.cat].icon), el('span', '', CATS[k.cat].name));
      top.append(cat, el('span', 'status ' + STATUS[k.status].cls, k.status === 'submitted' ? 'Known' : 'Being fixed'));
      const when = el('p', 'k-when', `Updated ${day(k.updated).replace(/^(Today|Yesterday)$/, s => s.toLowerCase())} · `);
      when.append(el('span', 'tag', 'Sample'));
      li.append(top, el('h3', 'k-title', k.title), el('p', 'k-text', k.text), when);
      return li;
    }));
  }

  /* ---------------------------------------------------------------- the panel */
  const panel = $('#panel');
  let opener = null, closeToken = 0;
  function openPanel(mode, title) {
    for (const id of ['form', 'done', 'detail']) $('#' + id).hidden = id !== mode;
    $('#panel-title').textContent = title;
    if (panel.classList.contains('closing')) { closeToken++; panel.classList.remove('closing'); }
    if (!panel.open) { opener = document.activeElement; panel.classList.remove('closing'); panel.showModal(); document.documentElement.classList.add('locked'); }
    $('#' + mode).scrollTop = 0;
  }
  function closePanel() {
    if (!panel.open || panel.classList.contains('closing')) return;
    // Slide out, then close. Only this close may finish it: opening the panel again in the meantime cancels it.
    const token = ++closeToken;
    const finish = () => { if (token !== closeToken || !panel.classList.contains('closing')) return; panel.classList.remove('closing'); panel.close(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { panel.classList.add('closing'); return finish(); }
    panel.classList.add('closing');
    const onEnd = e => { if (e.target === panel) { panel.removeEventListener('animationend', onEnd); finish(); } };
    panel.addEventListener('animationend', onEnd);
    setTimeout(() => { panel.removeEventListener('animationend', onEnd); finish(); }, 400);
  }
  panel.addEventListener('close', () => {
    document.documentElement.classList.remove('locked');
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (opener && document.contains(opener)) opener.focus();
  });
  panel.addEventListener('cancel', e => { e.preventDefault(); closePanel(); });   // Escape: slide out, like the close button
  panel.addEventListener('click', e => { if (e.target === panel) closePanel(); });   // the dimmed page behind it
  $('#panel-close').addEventListener('click', closePanel);

  /* ---------------------------------------------------------------- Report an issue */
  const form = $('#form');
  let photo = null;   // { name, src } as a data: address (this page's CSP allows data: images, not blob:)
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

  function openForm() {
    $('#as').querySelector('span').replaceChildren('Reporting as ', el('b', '', me.name || me.email || 'you'), me.name && me.email ? ` · ${me.email}` : '');
    $('#form-error').hidden = true;
    openPanel('form', 'Report an issue');
    history.replaceState(null, '', '#report');
    setTimeout(() => { const c = form.querySelector('input[name="category"]:checked') || form.querySelector('input[name="category"]'); c.focus({ preventScroll: true }); }, 60);
  }
  $('#report-btn').addEventListener('click', openForm);

  function setError(id, text) {
    const p = $('#err-' + id); p.replaceChildren(svg('i-alert'), el('span', '', text)); p.hidden = false;
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

  $('#f-photo').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    $('#err-photo').hidden = true;
    if (!f) return;
    if (!/^image\//.test(f.type)) return setError('photo', 'That file isn’t a photo or screenshot. Choose an image file.');
    if (f.size > MAX_PHOTO) return setError('photo', 'That image is over 10 MB. Choose a smaller one.');
    const rd = new FileReader();
    rd.onload = () => { photo = { name: f.name, src: String(rd.result) }; showPhoto(); };
    rd.onerror = () => setError('photo', 'That image couldn’t be read. Try another one.');
    rd.readAsDataURL(f);
  });
  function showPhoto() {
    $('#photo-preview').hidden = !photo; form.querySelector('.photo-add').hidden = !!photo;
    if (photo) { $('#photo-img').src = photo.src; $('#photo-name').textContent = photo.name; }
  }
  $('#photo-remove').addEventListener('click', () => { photo = null; showPhoto(); form.querySelector('.photo-add').focus(); });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const { v, errs } = validate();
    if (errs.length) {
      const fe = $('#form-error');
      fe.querySelector('span').textContent = errs.length === 1 ? 'One thing needs fixing before you send this.' : `${errs.length} things need fixing before you send this.`;
      fe.hidden = false;
      errs[0][2].focus();
      return;
    }
    const btn = $('#submit'); btn.classList.add('busy'); btn.querySelector('.btn-label').textContent = 'Sending…';
    setTimeout(() => {   // a pause, as a real send would have; nothing leaves this page
      const n = Math.max(1044, ...reports.map(r => Number(r.id.slice(4)) || 0)) + 1;
      const now = new Date().toISOString();
      const r = { id: `MNT-${n}`, cat: v.cat, title: v.title, what: v.what, where: v.where, impact: v.impact, status: 'submitted', raised: now,
        files: photo ? [photo] : [], timeline: [{ kind: 'submitted', at: now, who: 'You', what: 'Report submitted' }], demo: true };
      reports.unshift(r); save();
      newId = r.id; filter = 'all'; render();
      form.reset(); photo = null; showPhoto(); $('#where-label').textContent = 'Location'; $('#f-where').placeholder = CATS.office.placeholder;
      btn.classList.remove('busy'); btn.querySelector('.btn-label').textContent = 'Send report';
      $('#done-text').textContent = `“${r.title}” is now in My reports as ${r.id}, marked Submitted.`;
      $('#done-view').dataset.id = r.id;
      openPanel('done', 'Report an issue');
      history.replaceState(null, '', location.pathname + location.search);
      $('#done-title').focus();
    }, 700);
  });
  $('#done-close').addEventListener('click', closePanel);
  $('#done-view').addEventListener('click', e => openDetail(e.currentTarget.dataset.id));

  /* ---------------------------------------------------------------- a report's details */
  function openDetail(id) {
    const r = reports.find(x => x.id === id);
    if (!r) return;
    const d = $('#detail');
    const top = el('div', 'd-top'); top.append(badge(r.status), el('span', 'd-ref', r.id));
    if (r.sample) top.append(el('span', 'tag', 'Sample'));
    if (r.demo) top.append(el('span', 'tag', 'Demo, not sent'));
    const facts = el('dl', 'd-facts');
    const fact = (k, v) => { if (v) facts.append(el('dt', '', k), el('dd', '', v)); };
    fact('Category', CATS[r.cat].name);
    fact(r.cat === 'hub' ? 'Page or tool' : 'Location', r.where);
    fact('Impact', IMPACT[r.impact]);
    fact('Raised', `${longDate(r.raised)} at ${time(r.raised)}`);
    fact('Raised by', 'You');
    const files = r.files.length ? el('ul', 'd-files') : el('p', 'd-none', 'No photos or screenshots.');
    for (const f of r.files) {
      const li = el('li', 'd-file'); const img = el('img'); img.src = f.src; img.alt = f.name + (r.sample ? ' (sample image)' : ''); img.decoding = 'async';
      li.append(img, el('span', '', f.name)); files.append(li);
    }
    const tl = el('ol', 'tl');
    for (const t of r.timeline) {
      const li = el('li', `tl-${t.who === 'You' && t.kind !== 'submitted' ? 'you' : t.kind}`);
      const head = el('div', 'tl-head'); head.append(el('span', 'tl-what', t.what), el('span', 'tl-when', `${day(t.at)}, ${time(t.at)}`));
      li.append(el('span', 'tl-dot'), head, el('p', 'tl-who', t.who));
      if (t.msg) li.append(el('p', 'tl-msg', t.msg));
      tl.append(li);
    }
    d.replaceChildren(top, el('h3', 'd-title', r.title), facts, el('h4', 'd-h', 'What’s wrong'), el('p', 'd-desc', r.what),
      el('h4', 'd-h', 'Photos and screenshots'), files, el('h4', 'd-h', 'Updates'), tl);
    if (r.status === 'waiting') d.append(replyBox(r));
    openPanel('detail', 'Report details');
    history.replaceState(null, '', '#' + r.id);
  }
  function replyBox(r) {
    const f = el('form', 'reply'); f.noValidate = true;
    const l = el('label', 'label', 'Reply with the information asked for'); l.htmlFor = 'reply-text';
    const h = el('p', 'hint', 'Your reply goes back to the person handling this report.');
    const t = el('textarea', 'input'); t.id = 'reply-text'; t.rows = 3; t.maxLength = 1000; t.setAttribute('aria-describedby', 'reply-err');
    const err = el('p', 'field-error'); err.id = 'reply-err'; err.hidden = true;
    const b = el('button', 'btn btn-brand', 'Send reply'); b.type = 'submit';
    const acts = el('div', 'reply-actions'); acts.append(b);
    f.append(l, h, t, err, acts);
    t.addEventListener('input', () => { err.hidden = true; t.removeAttribute('aria-invalid'); });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const msg = t.value.trim();
      if (msg.length < 3) { err.replaceChildren(svg('i-alert'), el('span', '', 'Write a reply first.')); err.hidden = false; t.setAttribute('aria-invalid', 'true'); t.focus(); return; }
      r.timeline.push({ kind: 'progress', at: new Date().toISOString(), who: 'You', what: 'You replied', msg });
      r.status = 'progress'; save(); render(); openDetail(r.id);
      toast('Reply added. In this demo it isn’t sent to anyone.');
    });
    return f;
  }

  /* ---------------------------------------------------------------- the demo */
  $('#demo-reset').addEventListener('click', () => {
    store.del(); reports = samples(); filter = 'all'; newId = ''; render();
    toast('Demo reset to the sample reports.');
  });
  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h === 'report') openForm();
    else if (/^MNT-\d+$/.test(h)) openDetail(h);
  }

  /* ---------------------------------------------------------------- who is signed in */
  let sb = null;
  const client = () => {
    if (sb) return sb;
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY },
    });
    return sb;
  };
  function gate(title, text) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
  }
  async function boot() {
    const c = client();
    if (!c) return gate('Maintenance isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) return location.replace(SIGN_IN);
    // The Hub's own answer about who this is. If it can't be had, the email from the sign-in will do for a preview.
    try { const { data } = await c.rpc('hub_home'); if (data) me = { name: data.name || '', email: data.email || '' }; } catch (e) { /* below */ }
    if (!me.email) me.email = (session.user && session.user.email) || '';
    render(); renderKnown();
    document.body.dataset.view = 'ready';
    $('#view').hidden = false;
    route();
  }
  boot();
})();
