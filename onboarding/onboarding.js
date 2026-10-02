/* ============================================================================
   FLR Onboarding: a new starter's checklist, and the reviews, checks and
   internal setup behind it for HR, payroll, medical HR, trainers and assessors.
   This page is public; it holds nothing. Every call goes to the database's
   onb_* functions, which check who is asking and return only what that person
   may see (20261003000100_flr_onboarding.sql). Nothing read here is written to
   the console, the address bar or browser storage.
   ========================================================================== */
(function () {
  'use strict';
  const C = window.ONB;
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';            // the one FLR sign-in for the whole site
  const SIGN_IN = '../?next=onboarding';
  const HUB_URL = new URL('../', location.href).href;
  const $ = (s, r = document) => r.querySelector(s);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAX_FILE = 10 * 1024 * 1024;

  /* ---------------------------------------------------------------- building the page (text only: nothing is parsed as HTML) */
  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'value') value = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k === 'style') for (const [p, x] of Object.entries(v)) n.style.setProperty(p, x);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, String(v));
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== '') n.append(k instanceof Node ? k : String(k));
    if (value !== undefined) n.value = value;
    return n;
  }
  function icon(id, cls) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u);
    return s;
  }
  let uid = 0; const nid = p => `${p}-${++uid}`;
  // replaceChildren(null) would write the word “null”: drop empty parts first.
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false && k !== ''));

  /* ---------------------------------------------------------------- dates */
  const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const asDate = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? ymd(s) : s ? new Date(s) : null);
  const day = s => { const d = asDate(s); return d && !isNaN(d) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
  const dayLong = s => { const d = asDate(s); return d && !isNaN(d) ? d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''; };
  const when = s => { const d = asDate(s); return d && !isNaN(d) ? `${day(s)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const size = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const first = name => String(name || '').trim().split(/\s+/)[0] || '';
  function initials(text) {
    const w = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '·';
    return w.length === 1 ? w[0][0].toUpperCase() : (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }

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
  async function call(fn, args) {
    const { data, error } = await client().rpc(fn, args || {});
    if (error) {
      if (expired(error) || flrCode(error) === 'FLR_SIGN_IN_REQUIRED') { location.replace(SIGN_IN); }
      throw error;
    }
    return data;
  }
  function said(e) {
    const code = flrCode(e);
    if (offline(e)) return 'Can’t reach the FLR database. Check your connection and try again.';
    if (code === 'FLR_VALIDATION' && e.details) return e.details;
    if (code === 'FLR_NOT_FOUND') return e.details || 'That isn’t there any more. The page has been refreshed.';
    if (code === 'FLR_FORBIDDEN') return 'You don’t have access to that.';
    if (code === 'FLR_ACCOUNT_DISABLED') return 'Your FLR account is switched off.';
    if (expired(e) || code === 'FLR_SIGN_IN_REQUIRED') return 'Your sign-in has expired. Sign in again.';
    return 'That didn’t work. Try again.';
  }

  /* ---------------------------------------------------------------- state */
  const S = { home: null, team: null, starter: null, task: null, opened: new Set(), tab: {} };
  const me = () => (S.home && S.home.team) || {};
  const isTeam = () => { const t = me(); return !!(t.overview || t.hr || t.medical || t.payroll || t.assigned || t.superAdmin); };

  /* ---------------------------------------------------------------- page furniture */
  function gate(title, text, o = {}) {
    document.body.dataset.view = 'gate';
    $('#view').hidden = true; $('#gate').hidden = false; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
    $('#gate-retry').hidden = !o.retry;
  }
  function loading() {
    document.body.dataset.view = 'loading';
    $('#gate').hidden = false; $('#gate-message').hidden = true; $('#view').hidden = true;
    fill($('#bar-end'));
  }
  function bar(o) {
    const back = $('#back');
    back.href = o.back || '../'; $('#back-label').textContent = o.backLabel || 'Hub';
    $('#bar-title').textContent = o.title || 'Onboarding';
    fill($('#bar-end'), o.end || []);
    document.title = `${o.title || 'Onboarding'} · FLR Hub`;
  }
  function show(nodes, o = {}) {
    document.body.dataset.view = 'page';
    $('#gate').hidden = true;
    const v = $('#view'); v.hidden = false; v.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
    if (o.keepScroll != null) scrollTo(0, o.keepScroll); else { scrollTo(0, 0); $('#main').focus({ preventScroll: true }); }
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
  const busy = (b, on, label) => {
    if (!b) return;
    if (on) { b.dataset.label = b.textContent; b.setAttribute('aria-busy', 'true'); if (label) b.textContent = label; }
    else { b.removeAttribute('aria-busy'); if (b.dataset.label) b.textContent = b.dataset.label; }
  };
  // Runs an action from a button: busy while it runs, the database's message if it fails.
  async function act(btn, fn, o = {}) {
    busy(btn, true, o.busy);
    try { const r = await fn(); if (o.ok) toast(o.ok); return r; }
    catch (e) { toast(said(e)); if (o.errorEl) o.errorEl.replaceChildren(errorBox(said(e))); return undefined; }
    finally { busy(btn, false); }
  }
  const errorBox = text => h('p', { class: 'form-error', role: 'alert' }, icon('i-alert'), h('span', null, text));

  /* ---------------------------------------------------------------- the sheet */
  let sheetClose = null;
  function openSheet(title, body, o = {}) {
    const d = $('#sheet');
    $('#sheet-title').textContent = title;
    $('#sheet-body').replaceChildren(...[body].flat(Infinity).filter(Boolean));
    sheetClose = o.onClose || null;
    if (!d.open) d.showModal();
    requestAnimationFrame(() => d.classList.add('open'));
    document.documentElement.classList.add('sheet-open');
  }
  function closeSheet() {
    const d = $('#sheet');
    d.classList.remove('open');
    document.documentElement.classList.remove('sheet-open');
    setTimeout(() => { if (d.open) d.close(); $('#sheet-body').replaceChildren(); const f = sheetClose; sheetClose = null; if (f) f(); }, reduced() ? 0 : 300);
  }
  $('#sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
  $('#sheet').addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });
  function confirmIt(title, text, yes, o = {}) {
    return new Promise(res => {
      let answered = false;
      const done = v => { answered = true; res(v); closeSheet(); };
      openSheet(title, [h('p', { class: 'sheet-lede' }, text),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-plain', type: 'button', onclick: () => done(false) }, 'Cancel'),
          h('button', { class: 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: () => done(true) }, yes))],
      { onClose: () => { if (!answered) res(false); } });
    });
  }

  /* ---------------------------------------------------------------- statuses */
  const chip = s => h('span', { class: 'st st-' + s }, C.STATUS[s] || s);
  const avail = a => (a ? h('span', { class: 'av' + (a === 'to_sign' ? ' av-ok' : '') }, a === 'to_sign' ? null : icon('i-lock'), C.AVAIL[a] || a) : null);
  const blocked = t => !!t.availability && t.availability !== 'to_sign';
  const locked = t => ['submitted', 'complete', 'not_applicable'].includes(t.status) || blocked(t);
  const title = k => (C.TASKS[k] || {}).title || k;

  /* ---------------------------------------------------------------- autosave: drafts save a moment after typing stops */
  const AS = { task: null, payload: null, timer: 0, saving: null, dirty: false, el: null, after: null };
  function autosave(task, payload, after) {
    AS.task = task; AS.payload = payload; AS.dirty = false; AS.after = after || null;
    AS.el = h('span', { class: 'save-state', role: 'status', 'aria-live': 'polite' }, 'Saves as you go');
    return AS.el;
  }
  function stop() { clearTimeout(AS.timer); AS.task = null; AS.payload = null; AS.dirty = false; }
  function state(text, bad) { if (!AS.el) return; fill(AS.el, bad ? icon('i-alert') : text === 'Saved' ? icon('i-check') : null, text); AS.el.classList.toggle('bad', !!bad); }
  function touched() {
    if (!AS.task) return;
    AS.dirty = true; clearTimeout(AS.timer); state('Not saved yet');
    AS.timer = setTimeout(saveNow, 1100);
  }
  async function saveNow() {
    clearTimeout(AS.timer);
    if (AS.saving) { await AS.saving.catch(() => {}); }
    if (!AS.task || !AS.dirty) return true;
    const task = AS.task, data = AS.payload();
    AS.dirty = false; state('Saving…');
    AS.saving = (async () => {
      try {
        const r = await call('onb_save', { p_task: task, p_data: data, p_submit: false });
        if (r && r.starter && S.home) S.home.starter = r.starter;
        if (AS.task === task) { state('Saved'); if (AS.after) AS.after(r); }
        return true;
      } catch (e) {
        if (AS.task === task) { AS.dirty = true; state(`Not saved. ${said(e)}`, true); }
        return false;
      } finally { AS.saving = null; }
    })();
    return AS.saving;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  addEventListener('pagehide', () => { saveNow(); });

  /* ---------------------------------------------------------------- fields bound to a model */
  const getp = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  function setp(o, p, v) { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) { if (typeof x[k] !== 'object' || x[k] === null) x[k] = {}; x = x[k]; } x[ks[ks.length - 1]] = v; }
  // f: { k, label, type, hint, optional, auto, mode, span, rows, options, max, placeholder, cls, readonly }
  function field(model, f, o = {}) {
    const id = nid('f');
    const lab = h('label', { class: 'field-label', for: id }, f.label, f.optional ? h('span', { class: 'opt' }, ' (optional)') : null);
    let input;
    const common = { id, autocomplete: f.auto || 'off', 'aria-describedby': f.hint ? id + '-h' : null };
    if (f.type === 'textarea') input = h('textarea', { ...common, class: 'textarea', rows: f.rows || 3, maxlength: f.max || 800, placeholder: f.placeholder });
    else if (f.type === 'select') input = h('select', { ...common, class: 'select' }, h('option', { value: '' }, f.placeholder || 'Choose…'), f.options.map(x => h('option', { value: x.v }, x.label)));
    else input = h('input', { ...common, class: 'input' + (f.cls ? ' ' + f.cls : ''), type: f.type || 'text', inputmode: f.mode, maxlength: f.max || 160,
      placeholder: f.placeholder, spellcheck: f.spell === false ? 'false' : null, autocapitalize: f.caps });
    input.value = getp(model, f.k) ?? '';
    if (o.locked || f.readonly) { if (f.type === 'select') input.disabled = true; else input.readOnly = true; }
    input.addEventListener('input', () => { setp(model, f.k, input.value); if (o.change) o.change(f.k, input.value); });
    return h('div', { class: 'field' + (f.span ? ' span' : '') }, lab, f.hint ? h('p', { class: 'field-hint', id: id + '-h' }, f.hint) : null, input);
  }
  const fields = (model, list, o = {}, cls = 'fields two') => h('div', { class: cls }, list.map(f => field(model, f, o)));
  // Radio cards: nothing is chosen for them.
  function choices(model, k, options, o = {}) {
    const name = nid('c');
    return h('fieldset', { class: 'choices' + (o.inline ? ' inline' : '') }, o.legend ? h('legend', { class: 'sr' }, o.legend) : null,
      options.map(x => {
        const inp = h('input', { type: 'radio', name, value: x.v, disabled: o.locked || null });
        inp.checked = getp(model, k) === x.v;
        inp.addEventListener('change', () => { if (inp.checked) { setp(model, k, x.v); if (o.change) o.change(k, x.v); } });
        return h('label', { class: 'choice' }, inp, h('span', { class: 'dot', 'aria-hidden': 'true' }),
          h('span', null, h('span', { class: 'choice-title' }, x.label), x.text ? h('span', { class: 'choice-text' }, x.text) : null));
      }));
  }
  // A small segmented choice (Yes/No, or three ways).
  function seg(value, options, on, o = {}) {
    const name = nid('y');
    const g = h('div', { class: 'yn' + (options.length === 3 ? ' seg3' : ''), role: 'radiogroup', 'aria-label': o.label || 'Answer' });
    g.style.setProperty('--n', String(options.length));
    for (const x of options) {
      const inp = h('input', { type: 'radio', name, value: x.v, disabled: o.locked || null });
      inp.checked = value === x.v;
      inp.addEventListener('change', () => { if (inp.checked) on(x.v); });
      g.append(h('label', { class: x.tone || '' }, inp, x.label));
    }
    return g;
  }
  const YES_NO = [{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }];
  function checkbox(text, checked, on, o = {}) {
    const inp = h('input', { type: 'checkbox', disabled: o.locked || null });
    inp.checked = !!checked;
    inp.addEventListener('change', () => on(inp.checked));
    return h('label', { class: 'check' }, inp, h('span', null, text));
  }
  const source = (text, cite) => h('blockquote', { class: 'source' }, h('span', null, text), cite ? h('span', { class: 'source-cite' }, cite) : null);
  const box = (cls, ic, ...kids) => h('div', { class: cls }, icon(ic), h('div', null, ...kids));
  const card = (titleText, sub, ...kids) => h('section', { class: 'card' }, titleText ? h('h2', { class: 'card-title' }, titleText) : null, sub ? h('p', { class: 'card-sub' }, sub) : null, ...kids);
  const kv = pairs => h('dl', { class: 'kv' }, pairs.filter(p => p && p[1] != null && p[1] !== '').map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));

  /* ---------------------------------------------------------------- files: upload, list, view */
  const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heic', webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword' };
  const mimeOf = f => f.type || MIME[(f.name.split('.').pop() || '').toLowerCase()] || '';
  const readB64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  // A button that picks a file and hands it to send(name, mime, b64).
  function picker(label, send, o = {}) {
    const inp = h('input', { type: 'file', accept: o.word ? 'application/pdf,image/*,.doc,.docx' : 'application/pdf,image/jpeg,image/png,image/heic,image/webp', hidden: true });
    const b = h('button', { class: 'btn btn-plain btn-small', type: 'button', disabled: o.disabled || null, onclick: () => inp.click() }, icon('i-upload'), label);
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; inp.value = '';
      if (!f) return;
      if (f.size > MAX_FILE) return toast('Files can be up to 10 MB.');
      const mime = mimeOf(f);
      if (!mime) return toast('Upload a PDF or a photo.');
      busy(b, true, 'Uploading…');
      try { await send(f.name, mime, await readB64(f)); }
      catch (e) { toast(said(e)); }
      finally { busy(b, false); }
    });
    return h('span', { class: 'upload' }, b, inp);
  }
  function fileList(files, o = {}) {
    if (!files || !files.length) return null;
    return h('ul', { class: 'files' }, files.map(f => h('li', { class: 'file' }, icon('i-file'),
      h('span', { class: 'file-name' }, f.fileName), h('span', { class: 'file-size' }, size(f.size)),
      h('button', { class: 'link', type: 'button', onclick: () => viewFile('file', f.id) }, 'View'),
      o.remove ? h('button', { class: 'link', type: 'button', onclick: async e => {
        if (!(await confirmIt('Remove this file?', `${f.fileName} will be taken off your onboarding.`, 'Remove', { danger: true }))) return;
        await act(e.target, async () => o.remove(await call('onb_remove_file', { p_id: f.id })), { ok: 'Removed' });
      } }, 'Remove') : null)));
  }
  // Opens a file or FLR document in a sheet, from a blob that is forgotten when the sheet closes.
  async function viewFile(kind, id) {
    let f;
    try { f = await call(kind === 'doc' ? 'onb_doc' : 'onb_file', { p_id: id }); } catch (e) { return toast(said(e)); }
    const bytes = Uint8Array.from(atob(f.b64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
    const name = f.fileName || 'document';
    const body = f.mime === 'application/pdf' ? h('iframe', { class: 'viewer', src: url, title: name })
      : f.mime.startsWith('image/') && f.mime !== 'image/heic' ? h('img', { class: 'viewer-img', src: url, alt: name })
      : h('p', { class: 'sheet-lede' }, 'This file can’t be shown here. Download it to open it.');
    openSheet(f.label || name, [body, h('div', { class: 'btn-row' },
      h('a', { class: 'btn btn-plain', href: url, download: name }, 'Download'),
      h('a', { class: 'btn btn-plain', href: url, target: '_blank', rel: 'noopener' }, 'Open in a new tab'))],
    { onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000) });
    if (kind === 'doc') S.opened.add(id);
  }

  /* ---------------------------------------------------------------- signing */
  // A declaration: tick (never ticked for them), type a full name, today's date.
  function signBox(o) {
    const m = { agree: false, name: o.name || '', extra: false };
    const err = h('div');
    const btn = h('button', { class: 'btn btn-primary', type: 'button' }, o.button);
    const sigId = nid('sig');
    const inp = h('input', { class: 'input sig', id: sigId, autocomplete: 'name', maxlength: 80, value: '' });
    inp.addEventListener('input', () => { m.name = inp.value; });
    btn.addEventListener('click', async () => {
      err.replaceChildren();
      if (o.needOpen && !o.needOpen()) return err.replaceChildren(errorBox(o.needOpenText));
      if (!m.agree) return err.replaceChildren(errorBox('Tick the box to confirm.'));
      if (o.extraText && !m.extra) return err.replaceChildren(errorBox('Tick both boxes to confirm.'));
      if (m.name.trim().length < 2) return err.replaceChildren(errorBox('Type your full name as your signature.'));
      await act(btn, () => o.sign(m.name.trim(), m), { errorEl: err });
    });
    return card(o.title || 'Your signature', null,
      o.statement ? source(o.statement, o.cite) : null,
      h('div', { class: 'fields' },
        checkbox(o.agreeText, false, v => { m.agree = v; }),
        o.extraText ? checkbox(o.extraText, false, v => { m.extra = v; }) : null,
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: sigId }, 'Type your full name'), h('p', { class: 'field-hint' }, 'This is your signature.'), inp),
        h('p', { class: 'field-hint' }, `Date: ${dayLong(today())}`)),
      err, h('div', { class: 'btn-row' }, btn));
  }
  function signedPanel(sig, extra) {
    if (!sig) return null;
    return card(null, null, h('div', { class: 'signed' }, icon('i-check'), h('div', null,
      h('p', null, sig.statement),
      h('span', { class: 'sig' }, sig.typedName),
      h('p', { class: 'field-hint' }, `Signed ${when(sig.at)}${sig.docLabel ? ` · ${sig.docLabel}` : ''}`),
      sig.docSha256 ? h('p', { class: 'field-hint mono' }, `Document fingerprint ${sig.docSha256.slice(0, 16)}…`) : null, extra || null)));
  }

  /* ================================================================ the new starter's own pages */
  function homeView() {
    stop();
    const s = S.home.starter;
    if (!s) {
      if (isTeam()) return location.replace('#/team');
      return gate('No onboarding for you yet', 'This is where FLR’s new starters complete their forms. HR hasn’t set up a checklist for your account.');
    }
    const t = me();
    bar({ title: 'Onboarding', end: isTeam() ? [h('a', { class: 'btn btn-plain btn-small', href: '#/team' }, 'New starters')] : [] });
    const next = nextTask(s.tasks);
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    const fill = h('span', { class: 'fill' }); fill.style.setProperty('--p', pct + '%');
    const route = s.route === 'office' ? (s.visitsSites ? 'Office employee · visits sites' : 'Office employee') : 'Operative';
    const groups = C.GROUPS.map(g => {
      const items = s.tasks.filter(x => (C.TASKS[x.key] || {}).group === g.id);
      return items.length ? h('section', { class: 'section', 'aria-labelledby': 'g-' + g.id },
        h('h2', { class: 'group-title', id: 'g-' + g.id }, g.title),
        h('ul', { class: 'tasks' }, items.map(taskCard))) : null;
    });
    show([
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, 'FLR new starter onboarding'),
        h('h1', { class: 'display' }, `Welcome, ${first(s.name) || 'to FLR'}`),
        h('div', { class: 'meta' },
          s.jobTitle ? h('span', null, s.jobTitle) : null,
          s.jobTitle && s.startDate ? h('span', { class: 'meta-sep', 'aria-hidden': 'true' }, '·') : null,
          s.startDate ? h('span', null, `Starts ${dayLong(s.startDate)}`) : null,
          h('span', { class: 'pill pill-route', title: 'Your onboarding route, set by FLR HR' }, route)),
        h('div', { class: 'progress' },
          h('div', { class: 'progress-top' }, h('strong', null, 'Your progress'), h('span', null, `${s.done} of ${s.total} done`)),
          h('div', { class: 'track' + (pct === 100 ? ' done' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(s.total), 'aria-valuenow': String(s.done), 'aria-label': 'Onboarding progress' }, fill))),
      next ? h('section', { class: 'next', 'aria-label': 'Your next task' },
        h('div', null, h('p', { class: 'next-label' }, next.status === 'needs_changes' ? 'Needs your attention' : 'Next up'),
          h('h2', { class: 'next-title' }, title(next.key)), h('p', { class: 'next-text' }, next.status === 'needs_changes' && next.note ? next.note : C.TASKS[next.key].text)),
        h('a', { class: 'btn btn-primary', href: '#/task/' + next.key }, next.status === 'not_started' ? 'Start' : 'Continue'))
      : h('section', { class: 'next all-done' }, h('div', null,
          h('p', { class: 'next-label' }, s.done === s.total ? 'All done' : 'Nothing to do right now'),
          h('h2', { class: 'next-title' }, s.done === s.total ? 'Your onboarding is complete' : 'FLR is working on the rest'),
          h('p', { class: 'next-text' }, s.done === s.total ? 'Thank you. Everything has been checked and accepted.' : 'The tasks left are with FLR for review, or waiting for a document or your trainer. You’ll see changes here.'))),
      groups,
      h('p', { class: 'notice' }, 'Your answers save as you go, so you can leave and come back at any time. Only the FLR staff who need each part can see it.'),
    ]);
  }
  function nextTask(tasks) {
    const can = x => !['complete', 'not_applicable', 'submitted'].includes(x.status) && !blocked(x);
    return tasks.find(x => x.status === 'needs_changes') || tasks.find(x => can(x) && x.status === 'in_progress') || tasks.find(can) || null;
  }
  function taskCard(t) {
    const meta = C.TASKS[t.key] || { title: t.key, text: '' };
    const done = ['complete', 'not_applicable', 'submitted'].includes(t.status);
    const label = blocked(t) ? 'View' : done ? 'Review' : t.status === 'not_started' ? 'Start' : 'Continue';
    return h('li', { class: 'task', dataset: { status: t.status } },
      h('div', null,
        h('h3', { class: 'task-title' }, meta.title),
        h('p', { class: 'task-text' }, meta.text),
        h('p', { class: 'task-meta' }, chip(t.status), avail(t.availability),
          t.submittedAt && ['submitted', 'complete'].includes(t.status) ? h('span', null, `Submitted ${day(t.submittedAt)}`) : null,
          t.status === 'in_progress' && t.updatedAt && !t.availability ? h('span', null, `Saved ${day(t.updatedAt)}`) : null)),
      h('div', { class: 'task-actions' }, h('a', { class: 'btn ' + (done || blocked(t) ? 'btn-plain' : 'btn-primary'), href: '#/task/' + t.key,
        'aria-label': `${label}: ${meta.title}` }, label)),
      t.status === 'needs_changes' && t.note ? h('p', { class: 'task-note' }, icon('i-alert'), h('span', null, h('b', null, 'Changes needed: '), t.note)) : null);
  }

  // One task, from the starter's side.
  async function taskView(key, sub) {
    stop();
    loading();
    let t;
    try { t = await call('onb_task', { p_task: key }); }
    catch (e) { return pageError(e); }
    S.task = t; if (t.starter) S.home.starter = t.starter;
    renderTask(t, sub);
  }
  function renderTask(t, sub, o = {}) {
    S.task = t;
    const view = TASKS[t.key];
    bar({ title: title(t.key), back: '#/', backLabel: 'Onboarding' });
    const body = view(t, sub);
    const nodes = Array.isArray(body) ? body : body.nodes;
    show([taskHead(t, Array.isArray(body) ? null : body.saveEl), nodes], o);
  }
  async function refresh(t, o = {}) {
    if (t && t.starter) S.home.starter = t.starter;
    if (!t || !t.key) t = await call('onb_task', { p_task: S.task.key });
    renderTask(t, null, { keepScroll: o.top ? null : scrollY });
  }
  function taskHead(t, saveEl) {
    const g = C.GROUPS.find(x => x.id === (C.TASKS[t.key] || {}).group);
    return h('header', { class: 'task-head' },
      h('p', { class: 'eyebrow' }, g ? g.title : 'Onboarding'),
      h('h1', { class: 'display' }, title(t.key)),
      h('div', { class: 'meta' }, chip(t.status), avail(t.availability),
        t.submittedAt && ['submitted', 'complete'].includes(t.status) ? h('span', null, `Submitted ${when(t.submittedAt)}`) : null,
        t.status === 'complete' && t.reviewedAt && t.reviewedBy ? h('span', null, `Accepted by ${t.reviewedBy}`) : null,
        saveEl || null),
      t.status === 'needs_changes' && t.note ? h('p', { class: 'task-note' }, icon('i-alert'), h('span', null, h('b', null, 'Changes needed: '), t.note)) : null,
      blocked(t) ? box('info', 'i-lock', h('p', null, h('b', null, C.AVAIL[t.availability] + '. '), C.AVAIL_TEXT[t.availability])) : null,
      t.status === 'submitted' && !['documents', 'driving', 'qualifications'].includes(t.key) ? box('info', 'i-check', h('p', null, 'Sent to FLR. You’ll see here if anything needs changing.')) : null);
  }
  function submitBar(label, onSubmit, err) {
    const b = h('button', { class: 'btn btn-primary', type: 'button' }, label);
    b.addEventListener('click', async () => {
      err.replaceChildren();
      busy(b, true, 'Sending…');
      try { await saveNow(); await onSubmit(); }
      catch (e) { err.replaceChildren(errorBox(said(e))); toast(said(e)); }
      finally { busy(b, false); }
    });
    return h('div', { class: 'sticky-submit no-print' }, err, h('div', { class: 'btn-row' }, h('span', { class: 'grow field-hint' }, 'Your answers are saved. Submit when you’re ready.'), b));
  }
  async function submit(task, data) {
    const r = await call('onb_save', { p_task: task, p_data: data, p_submit: true });
    stop(); toast('Sent to FLR');
    await refresh(r, { top: true });
  }

  const TASKS = {};

  /* ---------------------------------------------------------------- New Starter Information */
  TASKS.new_starter = t => {
    const lockedNow = locked(t);
    const d = JSON.parse(JSON.stringify(t.data || {}));
    for (const k of ['personal', 'emergency', 'declaration']) d[k] = d[k] || {};
    d.history = Array.isArray(d.history) ? d.history : [];
    const bank = { bankName: (t.bank && t.bank.bankName) || '', bankAddress: (t.bank && t.bank.bankAddress) || '', accountNumber: '', sortCode: '' };
    let bankTouched = false, pensionSeen = false;
    const payload = () => {
      const p = JSON.parse(JSON.stringify(d));
      p.personal.address = [p.personal.addressLine1, p.personal.addressLine2, p.personal.town, p.personal.county].filter(x => x && String(x).trim()).join(', ');
      if (bankTouched) p.bank = { ...bank };
      if (pensionSeen) p.pensionSeen = true;
      return p;
    };
    const saveEl = lockedNow ? null : autosave('new_starter', payload, () => { bankTouched = false; pensionSeen = false; });
    const ch = () => touched();
    const o = { locked: lockedNow, change: ch };
    const P = d.personal;
    // Postcode lookup: the town and county from postcodes.io (open data); the street is typed in.
    const pcMsg = h('p', { class: 'field-hint', role: 'status' });
    const pcInput = field(d, { k: 'personal.postcode', label: 'Postcode', auto: 'postal-code', caps: 'characters', max: 10 }, o);
    const town = field(d, { k: 'personal.town', label: 'Town or city', auto: 'address-level2' }, o);
    const county = field(d, { k: 'personal.county', label: 'County', optional: true, auto: 'address-level1' }, o);
    const lookup = h('button', { class: 'btn btn-plain', type: 'button', disabled: lockedNow || null }, 'Look up');
    lookup.addEventListener('click', async () => {
      const pc = String(P.postcode || '').trim();
      if (!/^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test(pc)) { pcMsg.textContent = 'Enter a full UK postcode, such as B90 4SB.'; return; }
      busy(lookup, true, 'Looking…');
      try {
        const r = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc), { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (r.status === 404) { pcMsg.textContent = 'We couldn’t find that postcode. Check it, or type your address below.'; return; }
        const j = await r.json(); const x = j && j.result;
        if (!x) throw new Error('no result');
        P.postcode = x.postcode; P.town = x.admin_district || P.town || ''; P.county = x.admin_county || x.region || P.county || '';
        pcInput.querySelector('input').value = P.postcode; town.querySelector('input').value = P.town; county.querySelector('input').value = P.county;
        pcMsg.textContent = `Found ${P.town}. Now add your house number and street.`; touched();
      } catch (e) { pcMsg.textContent = 'Postcode lookup isn’t available just now. Type your address below.'; }
      finally { busy(lookup, false); }
    });
    { const pcIn = pcInput.querySelector('input'); const row = h('div', { class: 'input-row' }); pcIn.replaceWith(row); row.append(pcIn, lookup); }
    pcInput.classList.add('span'); pcInput.append(pcMsg);

    // Pension wording: recorded as shown once it has been on screen.
    const pension = box('info', 'i-alert', h('p', null, C.NEW_STARTER.pension), h('p', { class: 'field-hint' }, 'From FLR’s New Starter Information Form.'),
      t.pensionShown ? h('p', { class: 'field-hint' }, `Shown to you ${when(t.pensionShown)}.`) : null);
    if (!t.pensionShown && !lockedNow && 'IntersectionObserver' in window) {
      let timer = 0;
      const io = new IntersectionObserver(es => {
        for (const e of es) {
          if (e.isIntersecting) timer = setTimeout(() => { pensionSeen = true; touched(); io.disconnect(); }, 900);
          else clearTimeout(timer);
        }
      }, { threshold: 0.6 });
      requestAnimationFrame(() => io.observe(pension));
    }

    const history = h('ul', { class: 'entries' });
    const drawHistory = () => history.replaceChildren(...d.history.map((e, i) => h('li', { class: 'entry' },
      h('div', { class: 'entry-head' }, h('p', { class: 'entry-title' }, e.employer || `Previous employer ${i + 1}`),
        lockedNow ? null : h('button', { class: 'link', type: 'button', onclick: () => { d.history.splice(i, 1); drawHistory(); touched(); } }, 'Remove')),
      fields(e, [
        { k: 'employer', label: 'Previous employer', span: true },
        { k: 'start', label: 'Start date', placeholder: 'For example March 2021', max: 40 },
        { k: 'end', label: 'End date', placeholder: 'For example September 2026', max: 40 },
        { k: 'position', label: 'Position held', span: true },
      ], { locked: lockedNow, change: (k) => { if (k === 'employer') history.children[i].querySelector('.entry-title').textContent = e.employer || `Previous employer ${i + 1}`; touched(); } }))));
    drawHistory();

    const err = h('div');
    const nodes = [
      lockedNow && t.status !== 'not_applicable' ? null : box('lockbox', 'i-lock', h('p', null, 'HR can see these details. Your bank details go to FLR payroll only.')),
      h('fieldset', { class: 'plain', disabled: lockedNow || null },
        card('Personal details', null, h('div', { class: 'fields two' },
          field(d, { k: 'personal.surname', label: 'Surname', auto: 'family-name' }, o),
          field(d, { k: 'personal.firstNames', label: 'First name or names', auto: 'given-name' }, o),
          field(d, { k: 'personal.dob', label: 'Date of birth', type: 'date', auto: 'bday' }, o),
          field(d, { k: 'personal.title', label: 'Title', hint: 'For example Mr, Mrs, Miss, Ms or Mx', auto: 'honorific-prefix', max: 20 }, o),
          pcInput,
          field(d, { k: 'personal.addressLine1', label: 'Address', auto: 'address-line1', span: true, hint: 'House number and street' }, o),
          field(d, { k: 'personal.addressLine2', label: 'Address line 2', optional: true, auto: 'address-line2', span: true }, o),
          town, county,
          field(d, { k: 'personal.homePhone', label: 'Home telephone number', optional: true, type: 'tel', auto: 'tel' }, o),
          field(d, { k: 'personal.mobile', label: 'Mobile telephone number', type: 'tel', auto: 'tel' }, o),
          field(d, { k: 'personal.ni', label: 'National Insurance number', hint: 'For example QQ 12 34 56 C', caps: 'characters', max: 13, cls: 'mono' }, o),
          field(d, { k: 'personal.email', label: 'Personal email address', type: 'email', auto: 'email' }, o))),
        t.maritalStatus === 'removed' ? null : card('Marital status', null, choices(d, 'marital', C.NEW_STARTER.marital.map(x => ({ v: x.v, label: x.label })), { ...o, inline: true, legend: 'Marital status' })),
        card('Emergency contact details', null, fields(d, [
          { k: 'emergency.name', label: 'Name', auto: 'off' },
          { k: 'emergency.relationship', label: 'Relationship' },
          { k: 'emergency.address', label: 'Address', type: 'textarea', rows: 3, span: true },
          { k: 'emergency.phone', label: 'Telephone number', type: 'tel' },
        ], o)),
        card('Bank details', null,
          box('info', 'i-alert', h('p', null, h('b', null, C.NEW_STARTER.bankNote))),
          h('div', { class: 'fields two' },
            field(bank, { k: 'bankName', label: 'Name of bank or building society', span: true }, { ...o, change: () => { bankTouched = true; touched(); } }),
            field(bank, { k: 'bankAddress', label: 'Bank or building society address', type: 'textarea', rows: 2, span: true }, { ...o, change: () => { bankTouched = true; touched(); } }),
            field(bank, { k: 'accountNumber', label: 'Bank account number', mode: 'numeric', max: 12, cls: 'mono',
              placeholder: t.bank && t.bank.accountEnding ? `Saved, ending ${t.bank.accountEnding}` : '', hint: t.bank && t.bank.accountEnding ? 'Type it again only to change it.' : null }, { ...o, change: () => { bankTouched = true; touched(); } }),
            field(bank, { k: 'sortCode', label: 'Sort code', mode: 'numeric', max: 8, cls: 'mono',
              placeholder: t.bank && t.bank.sortCodeEnding ? `Saved, ending ${t.bank.sortCodeEnding}` : '00-00-00' }, { ...o, change: () => { bankTouched = true; touched(); } })),
          h('p', { class: 'field-hint' }, 'Only FLR payroll can see your full bank details. Once saved, they’re shown here only as their last digits.')),
        card('Pension scheme', null, pension),
        card('Qualifications and professional memberships', 'Add each qualification, or membership of a professional body, that’s relevant to your job. You may also be asked to show the original certificate.',
          qualsList(t, { locked: lockedNow })),
        card('New post details', 'FLR HR enters these. Check them, and tell HR if anything’s wrong.',
          kv([['Job title', t.post && t.post.jobTitle || 'Not entered yet'], ['Start date', t.post && t.post.startDate ? dayLong(t.post.startDate) : 'Not entered yet'],
            ['Hours per week', t.post && t.post.hours || 'Not entered yet']]),
          h('div', { class: 'fields', style: { 'margin-top': '16px' } },
            field(d, { k: 'postQuery', label: 'Is anything above wrong?', type: 'textarea', rows: 2, optional: true, hint: 'Say what it should be. HR will check it.' }, o),
            field(d, { k: 'holidays', label: 'Pre-existing holiday dates', type: 'textarea', rows: 2, optional: true, hint: 'Holidays you’d already booked before joining FLR.' }, o))),
        card('Employment history', 'Your previous employers, most recent first.', history,
          lockedNow ? null : h('button', { class: 'btn btn-plain btn-small add', type: 'button', onclick: () => { d.history.push({}); drawHistory(); touched(); } }, icon('i-plus'), 'Add an employer')),
        card('Declaration', null, source(C.NEW_STARTER.declaration, 'From FLR’s New Starter Information Form'),
          h('div', { class: 'fields' },
            checkbox('I confirm the declaration above.', !!d.declaration.agree, v => { d.declaration.agree = v; touched(); }, o),
            field(d, { k: 'declaration.signature', label: 'Signature: type your full name', cls: 'sig', auto: 'name', max: 80 }, o),
            h('p', { class: 'field-hint' }, lockedNow && t.submittedAt ? `Submitted ${when(t.submittedAt)}` : `Date: ${dayLong(today())}. The time you submit is recorded too.`)))),
      lockedNow ? null : submitBar('Submit New Starter Information', () => submit('new_starter', payload()), err),
    ];
    return { nodes, saveEl };
  };

  // Qualifications and memberships: the starter's own entries, with evidence and its check status.
  function qualsList(t, o = {}) {
    const wrap = h('div');
    const draw = quals => {
      fill(wrap,
        quals.length ? h('ul', { class: 'entries' }, quals.map(q => qualEntry(q, o, draw))) : h('p', { class: 'field-hint' }, 'None added yet.'),
        o.locked ? null : addQual(draw));
    };
    draw(t.quals || []);
    return wrap;
  }
  function qualEntry(q, o, draw) {
    const m = { name: q.name, body: q.body, number: q.number, achievedOn: q.achievedOn || '', expiresOn: q.expiresOn || '' };
    const lockedQ = o.locked || q.status === 'verified';
    const save = h('button', { class: 'btn btn-plain btn-small', type: 'button', hidden: true }, 'Save changes');
    const mark = () => { save.hidden = false; };
    save.addEventListener('click', () => act(save, async () => { const r = await call('onb_qual', { p_op: 'update', p: { id: q.id, ...m } }); draw(r.quals); afterQuals(); }, { ok: 'Saved' }));
    return h('li', { class: 'entry' },
      h('div', { class: 'entry-head' }, h('p', { class: 'entry-title' }, q.name),
        h('span', { class: 'task-meta' }, q.required ? h('span', { class: 'pill pill-tint' }, 'Needed for your role') : null, h('span', { class: 'st ' + qualTone(q.status) }, C.QUAL_STATUS[q.status]))),
      q.note && ['original_required', 'needs_replacement'].includes(q.status) ? h('p', { class: 'task-note' }, icon('i-alert'), h('span', null, q.note)) : null,
      fields(m, [
        q.required ? null : { k: 'name', label: 'Qualification or membership', span: true },
        { k: 'body', label: 'Awarding or professional body' },
        { k: 'number', label: 'Certificate or membership number', optional: true },
        { k: 'achievedOn', label: 'Date achieved', type: 'date' },
        { k: 'expiresOn', label: 'Expiry date', type: 'date', optional: true },
      ].filter(Boolean), { locked: lockedQ, change: mark }),
      h('div', { class: 'btn-row' },
        lockedQ ? null : picker('Upload evidence', async (name, mime, b64) => { await call('onb_upload', { p_purpose: 'qual', p_name: name, p_mime: mime, p_b64: b64, p_ref: q.id }); toast('Uploaded'); afterQuals(true); }),
        save,
        lockedQ || q.required ? null : h('button', { class: 'link', type: 'button', onclick: async e => {
          if (!(await confirmIt('Remove this entry?', `${q.name} and its evidence will be removed.`, 'Remove', { danger: true }))) return;
          await act(e.target, async () => { const r = await call('onb_qual', { p_op: 'remove', p: { id: q.id } }); draw(r.quals); afterQuals(); }, { ok: 'Removed' });
        } }, 'Remove')),
      fileList(q.files, { remove: lockedQ ? null : () => afterQuals(true) }));
  }
  const qualTone = s => ({ verified: 'st-complete', uploaded: 'st-submitted', original_required: 'st-needs_changes', needs_replacement: 'st-needs_changes', awaiting_evidence: 'st-not_started' })[s] || 'st-not_started';
  function addQual(draw) {
    const m = {};
    const err = h('div');
    const form = h('div', { class: 'entry', hidden: true },
      fields(m, [
        { k: 'name', label: 'Qualification or membership', span: true },
        { k: 'body', label: 'Awarding or professional body' },
        { k: 'number', label: 'Certificate or membership number', optional: true },
        { k: 'achievedOn', label: 'Date achieved', type: 'date' },
        { k: 'expiresOn', label: 'Expiry date', type: 'date', optional: true },
      ]), err,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: e => act(e.target, async () => {
        const r = await call('onb_qual', { p_op: 'add', p: m }); draw(r.quals); afterQuals();
      }, { ok: 'Added', errorEl: err }) }, 'Add'), h('button', { class: 'link', type: 'button', onclick: () => { form.hidden = true; open.hidden = false; } }, 'Cancel')));
    const open = h('button', { class: 'btn btn-plain btn-small add', type: 'button', onclick: () => { form.hidden = false; open.hidden = true; form.querySelector('input').focus(); } }, icon('i-plus'), 'Add a qualification or membership');
    return h('div', null, form, open);
  }
  // A change to qualifications can change a task's status: refresh the header (and, after uploads, the page).
  async function afterQuals(full) {
    await saveNow();
    try { const t = await call('onb_task', { p_task: S.task.key }); if (t.starter) S.home.starter = t.starter; if (full) renderTask(t, null, { keepScroll: scrollY }); else S.task = t; } catch (e) { /* the list itself is already up to date */ }
  }

  /* ---------------------------------------------------------------- Medical questionnaire */
  TASKS.medical = t => {
    const lockedNow = locked(t);
    const d = JSON.parse(JSON.stringify(t.answers || {}));
    d.history = d.history || {};
    const saveEl = lockedNow ? null : autosave('medical', () => d);
    const o = { locked: lockedNow, change: () => touched() };
    const body = h('div');
    const draw = () => fill(body,
      box('lockbox', 'i-lock', h('p', null, 'Your answers are seen only by the HR staff FLR has authorised to read medical information, not by your manager or anyone else.')),
      h('fieldset', { class: 'plain', disabled: lockedNow || null },
        card('Personal details', null, h('div', { class: 'fields two' },
          field(d, { k: 'name', label: 'Name', auto: 'name', span: true }, o),
          field(d, { k: 'address', label: 'Address', type: 'textarea', rows: 3, span: true }, o),
          field(d, { k: 'ni', label: 'National Insurance No*', hint: C.MEDICAL.evidence, caps: 'characters', cls: 'mono', max: 13 }, o),
          field(d, { k: 'dob', label: 'Date of Birth*', type: 'date', hint: C.MEDICAL.evidence }, o),
          field(d, { k: 'company', label: 'Company', span: true }, o))),
        card('Emergency contact details', null, fields(d, [
          { k: 'ecName', label: 'Name' }, { k: 'ecRelationship', label: 'Relationship' },
          { k: 'ecPhone', label: 'Contact Number', type: 'tel' }, { k: 'ecAddress', label: 'Address', type: 'textarea', rows: 2, span: true },
        ], o)),
        card('Medical history', 'Answer Yes or No to each. Add details where you can.',
          h('ol', { class: 'qs' }, C.MEDICAL.history.map(([id, q]) => {
            d.history[id] = d.history[id] || {};
            const det = h('textarea', { class: 'textarea', rows: 2, maxlength: 800, 'aria-label': `Details: ${q}`, placeholder: 'Details' });
            det.value = d.history[id].d || ''; det.readOnly = lockedNow;
            det.addEventListener('input', () => { d.history[id].d = det.value; touched(); });
            return h('li', { class: 'q' }, h('p', { class: 'q-text' }, q),
              seg(d.history[id].a, [{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }], v => { d.history[id].a = v; touched(); }, { locked: lockedNow, label: q }), det);
          }))),
        card('Declaration', null, source(C.MEDICAL.declaration, 'From FLR’s Medical Questionnaire'),
          h('div', { class: 'fields' },
            checkbox('I confirm the declaration above.', !!d.declAgree, v => { d.declAgree = v; touched(); }, o),
            h('div', { class: 'fields two' },
              field(d, { k: 'declName', label: 'Name', auto: 'name' }, o),
              field(d, { k: 'declSignature', label: 'Signature: type your full name', cls: 'sig', auto: 'name' }, o)),
            h('p', { class: 'field-hint' }, lockedNow && t.submittedAt ? `Submitted ${when(t.submittedAt)}` : `Date: ${dayLong(today())}`)))));
    draw();
    // Fill what the New Starter form already has, the first time.
    if (!lockedNow && !Object.keys(t.answers || {}).length) {
      call('onb_task', { p_task: 'new_starter' }).then(ns => {
        const p = (ns.data && ns.data.personal) || {}, e = (ns.data && ns.data.emergency) || {};
        const name = [p.firstNames, p.surname].filter(Boolean).join(' ');
        Object.assign(d, { name: name || S.home.starter.name, address: p.address || '', ni: p.ni || '', dob: p.dob || '', company: 'FLR Group',
          ecName: e.name || '', ecRelationship: e.relationship || '', ecPhone: e.phone || '', ecAddress: e.address || '', declName: name || S.home.starter.name });
        draw();
      }).catch(() => {});
    }
    const err = h('div');
    return { nodes: [body, lockedNow ? null : submitBar('Submit medical questionnaire', () => submit('medical', d), err)], saveEl };
  };

  /* ---------------------------------------------------------------- P45, and HMRC's starter checklist */
  TASKS.tax = t => {
    const lockedNow = locked(t);
    const d = JSON.parse(JSON.stringify(t.data || {}));
    const saveEl = lockedNow ? null : autosave('tax', () => d);
    const pay = t.payroll || {};
    const err = h('div');
    return { saveEl, nodes: [
      card('Do you have a P45 from your last job?', 'A P45 is the form your last employer gives you when you leave. Payroll uses it, or HMRC’s starter checklist, to set up your tax code.',
        choices(d, 'hasP45', [{ v: 'yes', label: 'Yes, I have a P45', text: 'Bring the original to FLR on your first day, or give it to payroll. You can upload a copy below too.' },
          { v: 'no', label: 'No, I don’t have one', text: 'Payroll will probably ask for HMRC’s starter checklist instead.' }], { locked: lockedNow, change: () => touched() }),
        h('div', { class: 'fields', style: { 'margin-top': '16px' } },
          field(d, { k: 'note', label: 'Anything payroll should know?', type: 'textarea', rows: 2, optional: true }, { locked: lockedNow, change: () => touched() }))),
      card('From HMRC’s starter checklist', null, source(C.HMRC.instructions, 'HMRC Starter checklist, instructions for employee (HMRC 12/25)'),
        h('p', { class: 'field-hint' }, 'Payroll decides whether they need the checklist from you, and it appears as its own task if they do.')),
      card('A copy of your P45', 'Optional. Payroll still needs the original.',
        h('div', { class: 'btn-row' }, picker('Upload a copy', async (name, mime, b64) => { await refresh(await call('onb_upload', { p_purpose: 'p45', p_name: name, p_mime: mime, p_b64: b64 })); toast('Uploaded'); },
          { disabled: pay.p45Received || null })),
        fileList(t.files, { remove: pay.p45Received ? null : r => refresh(r) })),
      t.status === 'complete' || pay.checklistNeeded != null ? card('What payroll has recorded', null, kv([
        ['Original P45', pay.p45Received ? `Received ${day(pay.p45ReceivedOn)}` : 'Not received'],
        ['HMRC starter checklist', pay.checklistNeeded === true ? 'Needed: see the HMRC Starter Checklist task' : pay.checklistNeeded === false ? 'Not needed' : 'Payroll is deciding'],
      ])) : null,
      lockedNow ? null : submitBar('Send to payroll', () => submit('tax', d), err),
    ] };
  };
  TASKS.hmrc = t => {
    if (t.status === 'not_applicable') return [card('You don’t need to fill this in', null, h('p', { class: 'prose' }, 'Payroll has what they need, so HMRC’s starter checklist isn’t needed from you.'))];
    if (blocked(t)) return [card('HMRC Starter Checklist', null, h('p', { class: 'prose' }, 'Once you’ve answered the P45 question, payroll will decide whether they need this form from you.'),
      h('a', { class: 'btn btn-plain', href: '#/task/tax' }, 'Go to the P45 question'))];
    const lockedNow = locked(t);
    const d = JSON.parse(JSON.stringify(t.data || {}));
    const saveEl = lockedNow ? null : autosave('hmrc', () => d);
    const version = (t.payroll && t.payroll.hmrcVersion) || t.hmrcCurrent || '';
    const err = h('div');
    return { saveEl, nodes: [
      box('lockbox', 'i-lock', h('p', null, 'Only FLR payroll can see your completed checklist.')),
      card('1. Get HMRC’s form', `Use HMRC’s own starter checklist. FLR doesn’t copy or change HMRC’s questions. Current version: ${version}.`,
        h('div', { class: 'btn-row' },
          h('a', { class: 'btn btn-primary', href: C.HMRC.page, target: '_blank', rel: 'noopener noreferrer' }, 'Open the form on GOV.UK'),
          h('a', { class: 'btn btn-plain', href: C.HMRC.online, target: '_blank', rel: 'noopener noreferrer' }, 'HMRC’s online guide')),
        h('p', { class: 'field-hint' }, 'Download the PDF from GOV.UK and fill it in, or print it, fill it in and take a photo.')),
      card('2. Give it to FLR, not HMRC', null, source(C.HMRC.notToHmrc, 'HMRC Starter checklist, page 1'),
        h('p', { class: 'prose' }, 'Upload your completed form here. Payroll uses it to set up your tax code. FLR doesn’t send it to HMRC.')),
      card('3. Upload your completed form', null,
        h('div', { class: 'btn-row' }, lockedNow ? null : picker('Upload completed form', async (name, mime, b64) => { await refresh(await call('onb_upload', { p_purpose: 'hmrc', p_name: name, p_mime: mime, p_b64: b64 })); toast('Uploaded'); })),
        fileList(t.files, { remove: lockedNow ? null : r => refresh(r) }),
        h('div', { class: 'fields two', style: { 'margin-top': '16px' } },
          field(d, { k: 'completedOn', label: 'Date you completed the form', type: 'date' }, { locked: lockedNow, change: () => touched() }),
          t.data && t.data.version ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Form version'), h('p', { class: 'prose' }, t.data.version)) : null)),
      lockedNow ? null : submitBar('Send to payroll', () => submit('hmrc', d), err),
    ] };
  };

  /* ---------------------------------------------------------------- Contract and handbook: an FLR document, then a signature */
  function docTask(t, words) {
    if (t.availability === 'awaiting_document') return [card(null, null, h('div', { class: 'doc-card' }, icon('i-file'), h('div', { class: 'grow' },
      h('p', { class: 'doc-title' }, 'Awaiting FLR document'), h('p', { class: 'doc-text' }, words.awaiting))))];
    const doc = t.doc;
    const sig = (t.signatures || []).slice(-1)[0];
    const nodes = [];
    if (doc) nodes.push(card(null, null, h('div', { class: 'doc-card' }, icon('i-file'), h('div', { class: 'grow' },
        h('p', { class: 'doc-title' }, words.docTitle), h('p', { class: 'doc-text' }, `${doc.label} · ${doc.fileName} · ${size(doc.size)}`)),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => viewFile('doc', doc.id) }, words.read))));
    if (sig && ['submitted', 'complete'].includes(t.status)) nodes.push(signedPanel(sig, t.status === 'submitted' && t.key === 'contract' ? h('p', { class: 'field-hint' }, 'With FLR HR to confirm.') : null));
    if (!locked(t) && doc) nodes.push(signBox({ title: words.signTitle, agreeText: words.agree, button: words.button, name: '',
      needOpen: () => S.opened.has(doc.id), needOpenText: `Open the ${words.noun} first, so you’ve read the version you’re signing.`,
      sign: async name => { const r = await call('onb_sign', { p_task: t.key, p_typed_name: name, p_doc: doc.id, p: { agree: true } }); toast(words.done); await refresh(r, { top: true }); } }));
    return nodes;
  }
  TASKS.contract = t => docTask(t, { awaiting: 'FLR hasn’t added your approved contract yet. It will appear here for you to read and sign.', docTitle: 'Your contract of employment',
    read: 'Read the contract', signTitle: 'Sign your contract', agree: 'I have read my contract of employment and I accept it.', button: 'Sign contract', noun: 'contract', done: 'Signed. HR will confirm it.' });
  TASKS.handbook = t => docTask(t, { awaiting: 'FLR hasn’t added the approved Employee Handbook yet. It will appear here for you to read.', docTitle: 'Employee Handbook',
    read: 'Read the handbook', signTitle: 'Confirm you’ve read it', agree: 'I have received, read and understood the handbook.', button: 'Confirm', noun: 'handbook', done: 'Thank you. Recorded.' });

  /* ---------------------------------------------------------------- Working time choice (operatives) */
  TASKS.working_time = t => {
    const W = C.WORKING_TIME;
    if (blocked(t)) return [card(W.title, null, h('p', { class: 'prose' }, 'You’ll make your choice here once HR has checked this form.'))];
    const lockedNow = locked(t);
    const d = JSON.parse(JSON.stringify(t.data || {}));
    if (!d.name && !lockedNow) d.name = S.home.starter.name;
    const saveEl = lockedNow ? null : autosave('working_time', () => d);
    const o = { locked: lockedNow, change: () => touched() };
    const err = h('div');
    return { saveEl, nodes: [
      h('fieldset', { class: 'plain', disabled: lockedNow || null },
        card(W.title, null, h('p', { class: 'prose' }, W.intro), fields(d, [
          { k: 'name', label: 'Employee name', auto: 'name' }, { k: 'payroll', label: 'Payroll number', optional: true, hint: 'If known' },
          { k: 'site', label: 'Site / location' }, { k: 'department', label: 'Department' }], o)),
        card('Opt out', null, h('p', { class: 'prose' }, W.rule),
          choices(d, 'option', [{ v: 'A', label: W.a.title, text: W.a.text }, { v: 'B', label: W.b.title, text: W.b.text }], { ...o, legend: 'Choose Option A or Option B' }),
          h('p', { class: 'field-hint' }, W.tick + ' Both options are accepted, and you can finish your onboarding with either.'),
          box('info', 'i-alert', h('p', null, W.withdraw))),
        card('Signature', null, h('div', { class: 'fields two' },
          field(d, { k: 'signature', label: 'Signature: type your full name', cls: 'sig', auto: 'name' }, o),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Date'), h('p', { class: 'prose' }, lockedNow && t.submittedAt ? day(t.submittedAt) : dayLong(today()))),
          field(d, { k: 'effectiveFrom', label: 'Date agreement effective from', type: 'date' }, o)))),
      lockedNow ? null : submitBar('Submit my choice', () => submit('working_time', d), err),
    ] };
  };

  /* ---------------------------------------------------------------- Fitter information (operatives) */
  TASKS.fitter_info = t => {
    const sig = (t.signatures || []).slice(-1)[0];
    return [
      card('What you need to know as an FLR fitter', null, h('ul', { class: 'entries' }, (t.info || []).map(x => h('li', { class: 'entry' },
        h('p', { class: 'entry-title' }, x.title),
        h('p', { class: 'doc-text' }, x.text, ' ',
          x.email ? h('a', { href: 'mailto:' + x.email }, x.email) : null,
          x.link ? h('a', { href: x.link, target: '_blank', rel: 'noopener noreferrer' }, x.link.replace(/^https:\/\/www\./, '')) : null),
        x.tel ? h('p', { class: 'btn-row' }, h('a', { class: 'btn btn-plain btn-small', href: 'tel:' + x.tel }, x.telLabel)) : null)))),
      t.status === 'complete' ? signedPanel(sig) : signBox({ title: 'Confirm you’ve read it', agreeText: 'I have received and read the fitter information.', button: 'Confirm',
        sign: async name => { const r = await call('onb_sign', { p_task: 'fitter_info', p_typed_name: name, p: { agree: true } }); toast('Thank you. Recorded.'); await refresh(r, { top: true }); } }),
    ];
  };

  /* ---------------------------------------------------------------- Documents and right to work; driving documents */
  function itemBlock(t, it, o = {}) {
    const meta = C.ITEMS[it.item];
    const verified = it.checkStatus === 'verified';
    const code = { code: it.code || '' };
    const check = it.checkStatus
      ? h('p', { class: 'checkline' }, h('span', { class: 'st ' + (verified ? 'st-complete' : 'st-needs_changes') }, verified ? (it.item === 'rtw' ? 'Right to work checked' : 'Verified') : 'Follow-up needed'),
          h('span', null, `${it.checkMethod || ''}${it.checkedOn ? ` · ${day(it.checkedOn)}` : ''}${it.checkedBy ? ` · ${it.checkedBy}` : ''}`),
          it.followUpOn ? h('span', null, `Follow-up ${day(it.followUpOn)}`) : null)
      : h('p', { class: 'checkline' }, h('span', { class: 'st st-not_started' }, it.item === 'rtw' ? 'Right-to-work check not done yet' : 'Not checked yet'));
    let codeField = null;
    if (o.codeLabel) {
      const saveCode = h('button', { class: 'btn btn-plain', type: 'button', disabled: verified || null }, 'Save');
      saveCode.addEventListener('click', () => act(saveCode, async () => { await refresh(await call('onb_save', { p_task: t.key, p_data: { code: code.code }, p_submit: false })); }, { ok: 'Saved' }));
      const f = field(code, { k: 'code', label: o.codeLabel, optional: true, hint: o.codeHint, caps: 'characters', cls: 'mono', max: 14 }, { locked: verified });
      const inp = f.querySelector('input'); const row = h('div', { class: 'input-row' }); inp.replaceWith(row); row.append(inp, saveCode);
      codeField = h('div', { class: 'fields', style: { 'margin-top': '14px' } }, f);
    }
    return h('div', { class: 'doc-item' },
      h('div', { class: 'doc-top' }, h('p', { class: 'doc-title' }, meta.title), h('span', { class: 'st ' + ({ requested: 'st-not_started', uploaded: 'st-submitted', needs_replacement: 'st-needs_changes' })[it.status] }, C.UPLOAD_STATUS[it.status])),
      h('p', { class: 'doc-text' }, meta.text),
      it.status === 'needs_replacement' && it.note ? h('p', { class: 'task-note' }, icon('i-alert'), h('span', null, h('b', null, 'Replacement needed: '), it.note)) : null,
      check,
      h('div', { class: 'btn-row' }, verified ? null : picker(it.files && it.files.length ? 'Upload another' : 'Upload', async (name, mime, b64) => {
        await refresh(await call('onb_upload', { p_purpose: it.item, p_name: name, p_mime: mime, p_b64: b64 })); toast('Uploaded');
      })),
      fileList(it.files, { remove: verified ? null : r => refresh(r) }),
      codeField);
  }
  TASKS.documents = t => {
    const items = t.items || [];
    const rel = t.related || {};
    const others = [
      rel.p45 ? ['P45', 'Bring the original to FLR. You can upload a copy in the P45 task.', 'tax'] : null,
      rel.driving ? ['Full driving licence', 'Upload it in Driving documents.', 'driving'] : null,
      rel.qualifications ? ['Original certificates of relevant or essential qualifications', 'Upload evidence in Qualifications and certificates, and bring the originals.', 'qualifications'] : null,
    ].filter(Boolean);
    return [
      card('What FLR needs to see', null,
        source(C.NEW_STARTER.bring, 'From FLR’s New Starter Information Form'),
        source(C.NEW_STARTER.rightToWork, 'From FLR’s New Starter Information Form'),
        box('info', 'i-alert', h('p', null, 'Uploading a document doesn’t complete a check. FLR HR records each check, how it was done and when, after seeing your documents.'))),
      card('Your documents', null, items.map(it => itemBlock(t, it, it.item === 'rtw'
        ? { codeLabel: 'Home Office share code', codeHint: 'If you have one (for example with an eVisa), FLR can check your right to work online with it instead of a document. Get one at gov.uk/prove-right-to-work.' } : {}))),
      others.length ? card('Also on your checklist', null, h('ul', { class: 'rows' }, others.map(([tt, tx, key]) => h('li', null,
        h('a', { class: 'trow', href: '#/task/' + key }, h('span', null, h('span', { class: 'trow-title' }, tt), h('span', { class: 'trow-sub' }, tx)),
          statusOf(key) ? chip(statusOf(key)) : null, icon('i-chevron')))))) : null,
    ];
  };
  const statusOf = key => { const x = ((S.home.starter && S.home.starter.tasks) || []).find(y => y.key === key); return x && x.status; };
  TASKS.driving = t => [
    card('Your driving licence', null, h('p', { class: 'prose' }, C.DRIVING_NOTE),
      (t.items || []).map(it => itemBlock(t, it, { codeLabel: 'DVLA check code', codeHint: 'Optional. Get one at gov.uk/view-driving-licence. It lets FLR check your licence online. Codes last 21 days.' }))),
  ];

  /* ---------------------------------------------------------------- Qualifications and certificates */
  TASKS.qualifications = t => {
    const none = t.data && t.data.none;
    return [
      card('Your qualifications and cards', 'Add each qualification, card or membership your role needs, with evidence. FLR checks each one, and may ask to see the original.',
        qualsList(t, { locked: false })),
      !(t.quals || []).length && !none && !locked(t) ? card('No relevant qualifications?', null,
        h('p', { class: 'prose' }, 'If you don’t hold any qualifications that are relevant to this role, tell HR here.'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-plain', type: 'button', onclick: e => act(e.target, async () => {
          await refresh(await call('onb_save', { p_task: 'qualifications', p_data: {}, p_submit: true }));
        }, { ok: 'Sent to HR' }) }, 'I don’t hold any'))) : null,
      none && t.status !== 'complete' ? box('info', 'i-check', h('p', null, 'You told HR you don’t hold any relevant qualifications.')) : null,
    ];
  };

  /* ---------------------------------------------------------------- PPE and uniform */
  TASKS.ppe = t => {
    if (blocked(t)) return [card('PPE and uniform', null, h('p', { class: 'prose' }, C.AVAIL_TEXT.waiting_issue))];
    const list = t.ppe || [];
    const sig = (t.signatures || []).slice(-1)[0];
    return [
      card('Issued to you', null, h('ul', { class: 'rows' }, list.map(x => h('li', null, h('div', { class: 'trow' },
        h('span', null, h('span', { class: 'trow-title' }, `${x.qty} × ${x.item}`), h('span', { class: 'trow-sub' }, `${x.size ? 'Size ' + x.size + ' · ' : ''}Issued ${day(x.issuedOn)}`))))))),
      t.status === 'complete' ? signedPanel(sig) : signBox({ title: 'Confirm you’ve received it', agreeText: 'I have received the PPE and uniform listed.', button: 'Confirm receipt',
        sign: async name => { const r = await call('onb_sign', { p_task: 'ppe', p_typed_name: name, p: { agree: true } }); toast('Thank you. Recorded.'); await refresh(r, { top: true }); } }),
    ];
  };

  /* ---------------------------------------------------------------- Health and Safety Induction (led by the trainer) */
  function inductionRecord(t, o = {}) {
    const I = C.INDUCTION, rec = t.induction || {}, items = rec.items || {};
    const s = o.starter || (S.home && S.home.starter) || {};
    const label = st => ({ completed: 'Completed', not_completed: 'Not completed', na: 'Not applicable' })[st] || 'Not recorded';
    return [
      card(o.copy ? 'FLR Group Employee Health and Safety Induction Training Record' : 'Your induction record', null,
        kv([['Name', o.name || s.name], ['Job title', o.jobTitle || s.jobTitle], ['Start date', day(o.startDate || s.startDate)],
          ['Induction completed on', rec.completedOn ? dayLong(rec.completedOn) : 'Not yet'], ['Induction completed by', rec.completedBy || t.trainerName || t.trainer || '']]),
        h('p', { class: 'prose', style: { 'margin-top': '14px' } }, I.intro)),
      I.sections.map(sec => card(sec.title, null, h('ul', { class: 'qs' }, sec.items.map(([id, q]) => {
        const it = items[id] || {};
        return h('li', { class: 'q' }, h('p', { class: 'q-text' }, q),
          h('span', { class: 'st ' + (it.state === 'completed' ? 'st-complete' : it.state === 'na' ? 'st-not_applicable' : it.state === 'not_completed' ? 'st-needs_changes' : 'st-not_started') }, label(it.state)),
          it.note ? h('p', { class: 'field-hint q-more' }, `Notes: ${it.note}`) : null);
      })))),
      card(null, null, h('p', { class: 'prose' }, I.closing), h('p', { class: 'prose' }, h('b', null, I.ask))),
    ];
  }
  function youngPanel() {
    const Y = C.INDUCTION.young;
    return h('section', { class: 'card' }, box('warn', 'i-alert', h('p', null, h('b', null, Y.title)),
      h('ol', null, Y.points.map(p => h('li', null, p))), h('p', null, Y.then), h('p', null, h('b', null, Y.ask))));
  }
  TASKS.induction = t => {
    const rec = t.induction || {};
    const trainer = t.trainerName || t.trainer;
    const open = (t.followups || []).filter(f => !f.resolvedAt);
    const itemText = id => { for (const s of C.INDUCTION.sections) for (const [k, q] of s.items) if (k === id) return q; return id; };
    if (t.availability === 'with_trainer') return [
      card('Led by your trainer', trainer ? `Your trainer is ${trainer}. They’ll go through each part with you in person and record it here.` : 'FLR will tell you who your trainer is. They’ll go through each part with you in person and record it here.',
        h('p', { class: 'prose' }, C.INDUCTION.intro)),
      open.length ? card('Still to cover', null, h('ul', { class: 'rows' }, open.map(f => h('li', null, h('div', { class: 'trow' },
        h('span', null, h('span', { class: 'trow-title' }, itemText(f.item)), f.note ? h('span', { class: 'trow-sub' }, f.note) : null)))))) : null,
      t.young ? youngPanel() : null,
      card('What your induction covers', null, C.INDUCTION.sections.map(s => [h('h3', { class: 'entry-title', style: { margin: '14px 0 6px' } }, s.title),
        h('ul', { class: 'qs' }, s.items.map(([, q]) => h('li', { class: 'q' }, h('p', { class: 'q-text' }, q))))])),
    ];
    const sig = (t.signatures || []).slice(-1)[0];
    return [
      t.status === 'complete' ? h('div', { class: 'btn-row no-print', style: { margin: '0 0 16px' } }, h('a', { class: 'btn btn-primary', href: '#/task/induction/copy' }, 'View or print your completed copy')) : null,
      inductionRecord(t),
      t.young ? youngPanel() : null,
      t.status === 'complete' ? signedPanel(sig) : signBox({ title: 'Your acknowledgement', statement: C.INDUCTION.acknowledge, cite: 'From FLR’s H&S Induction Training Record',
        agreeText: 'I have received and understood this induction training.', extraText: t.young ? 'The information for young persons has been explained to me.' : null, button: 'Sign',
        sign: async (name, m) => { const r = await call('onb_sign', { p_task: 'induction', p_typed_name: name, p: { agree: true, young: !!m.extra } }); toast('Signed. Your copy is ready.'); await refresh(r, { top: true }); } }),
    ];
  };
  // The completed copy, for printing or saving as a PDF.
  function inductionCopy(t) {
    const sig = (t.signatures || []).slice(-1)[0];
    bar({ title: 'Induction record', back: '#/task/induction', backLabel: 'Back' });
    show([h('header', { class: 'task-head' }, h('p', { class: 'eyebrow' }, 'Completed copy'), h('h1', { class: 'display' }, 'Health and Safety Induction'),
        h('div', { class: 'btn-row no-print' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => print() }, 'Print or save as PDF'))),
      inductionRecord(t, { copy: true }), t.young ? youngPanel() : null,
      card('Confirmation', null, kv([['Copy confirmed by trainer for', (t.induction || {}).copyName], ['Employee signature', sig ? sig.typedName : ''], ['Signed', sig ? when(sig.at) : ''],
        ['Record version', (t.induction || {}).version]]))]);
  }

  /* ---------------------------------------------------------------- DSE workstation assessment (office) */
  TASKS.dse = t => {
    const D = C.DSE;
    const lockedNow = locked(t);
    const d = JSON.parse(JSON.stringify(t.data || {}));
    d.answers = d.answers || {};
    const saveEl = lockedNow ? null : autosave('dse', () => d);
    const o = { locked: lockedNow, change: () => touched() };
    const err = h('div');
    const actions = t.actions || [];
    const qText = id => { for (const s of D.sections) for (const [k, q] of s.items) if (k === id) return q; return 'General'; };
    return { saveEl, nodes: [
      card('Workstation', null, h('div', { class: 'fields two' },
        field(d, { k: 'location', label: 'Workstation location and number (if applicable)', span: true }, o),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'User'), h('p', { class: 'prose' }, S.home.starter.name)),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Assessment checked by'), h('p', { class: 'prose' }, t.assessorName || t.assessor || 'Your assessor (HR will assign one)')))),
      card('How it works', null, h('ul', null, D.how.map(x => h('li', { class: 'prose' }, x))), h('p', { class: 'field-hint' }, `${D.source}. ${D.licence}`)),
      h('fieldset', { class: 'plain', disabled: lockedNow || null }, D.sections.map(sec => card(sec.title, null, h('ol', { class: 'qs' }, sec.items.map(([id, q, consider]) => {
        d.answers[id] = d.answers[id] || {};
        const note = h('textarea', { class: 'textarea', rows: 1, maxlength: 600, 'aria-label': `Notes or concerns: ${q}`, placeholder: 'Notes or concerns (optional)' });
        note.value = d.answers[id].note || ''; note.readOnly = lockedNow;
        note.addEventListener('input', () => { d.answers[id].note = note.value; touched(); });
        const concern = (D.concern[id] || 'no');
        return h('li', { class: 'q' + (d.answers[id].a === concern ? ' flag' : '') }, h('p', { class: 'q-text' }, q),
          seg(d.answers[id].a, [{ v: 'yes', label: 'Yes', tone: concern === 'yes' ? 'bad' : 'good' }, { v: 'no', label: 'No', tone: concern === 'no' ? 'bad' : 'good' }], v => {
            d.answers[id].a = v; touched();
            const li = note.closest('.q'); if (li) li.classList.toggle('flag', v === concern);
          }, { locked: lockedNow, label: q }),
          consider ? h('details', { class: 'q-more' }, h('summary', null, 'Things to consider'), h('p', null, consider)) : null, note);
      })))),
      card(null, null, field(d, { k: 'problems', label: D.problems, type: 'textarea', rows: 4, optional: true }, o))),
      actions.length || ['submitted', 'complete'].includes(t.status) ? card('Your assessor’s actions', t.status === 'complete' ? `Assessment completed${t.reviewedBy ? ' by ' + t.reviewedBy : ''}.` : 'Your assessment is complete once every action is resolved.',
        actions.length ? h('ul', { class: 'rows' }, actions.map(a => h('li', null, h('div', { class: 'trow' },
          h('span', null, h('span', { class: 'trow-title' }, a.action), h('span', { class: 'trow-sub' }, a.item === 'general' ? 'General' : qText(a.item)),
            a.resolvedAt ? h('span', { class: 'trow-sub' }, `Resolved ${day(a.resolvedAt)}: ${a.resolution}`) : null),
          h('span', { class: 'st ' + (a.resolvedAt ? 'st-complete' : 'st-needs_changes') }, a.resolvedAt ? 'Resolved' : 'Open'))))) : h('p', { class: 'field-hint' }, 'No actions yet.')) : null,
      lockedNow ? null : submitBar('Submit assessment', () => submit('dse', d), err),
    ] };
  };

  /* ================================================================ the team: new starters, reviews, checks, setup */
  async function teamView() {
    stop();
    loading();
    try { S.team = await call('onb_team_home'); } catch (e) { return pageError(e); }
    const t = me();
    const list = S.team.starters || [];
    const waiting = list.filter(s => !s.archivedAt).flatMap(s => (s.review || []).map(k => ({ s, k })));
    bar({ title: 'New starters', end: [S.home.starter ? h('a', { class: 'btn btn-plain btn-small', href: '#/' }, 'My onboarding') : null,
      t.hr || t.superAdmin || t.payroll ? h('a', { class: 'btn btn-plain btn-small', href: '#/setup', 'aria-label': 'Onboarding setup' }, icon('i-gear'), 'Setup') : null].filter(Boolean) });
    const open = list.filter(s => !s.archivedAt), archived = list.filter(s => s.archivedAt);
    show([
      h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Onboarding'), h('h1', { class: 'display' }, 'New starters'),
        h('p', { class: 'lede' }, t.hr ? 'Add new starters, review what they send, record checks and keep the internal setup on track.'
          : t.payroll ? 'P45s, HMRC starter checklists, bank and pay details.' : t.medical ? 'Medical questionnaires waiting for review.'
          : t.overview ? 'Everyone’s onboarding progress.' : 'The onboarding tasks you’ve been given.'),
        t.hr ? h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => inviteSheet() }, icon('i-plus'), 'Add a new starter')) : null),
      h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, 'Waiting for you'), h('p', { class: 'section-count' }, String(waiting.length))),
        waiting.length ? h('ul', { class: 'queue' }, waiting.map(({ s, k }) => h('li', null, h('a', { href: `#/team/${s.id}/task/${k}` },
          h('span', null, h('span', { class: 'q-who' }, s.name), h('span', { class: 'q-what' }, title(k))),
          k === 'induction' ? h('span', { class: 'av av-ok' }, 'To lead') : k === 'tax' ? h('span', { class: 'av av-ok' }, 'To decide')
            : ['documents', 'driving', 'qualifications'].includes(k) || (k === 'new_starter' && (s.tasks.find(x => x.key === k) || {}).status !== 'submitted') ? h('span', { class: 'av av-ok' }, 'To check')
            : chip((s.tasks.find(x => x.key === k) || {}).status || 'submitted'), icon('i-chevron')))))
        : h('p', { class: 'empty' }, 'Nothing is waiting for you.')),
      h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, 'In progress'), h('p', { class: 'section-count' }, String(open.length))),
        open.length ? h('ul', { class: 'starters' }, open.map(starterCard)) : h('p', { class: 'empty' }, t.hr ? 'No new starters yet. Add one to begin.' : 'No new starters to show.')),
      archived.length ? h('section', { class: 'section' }, h('h2', { class: 'group-title' }, 'Archived in the last 90 days'), h('ul', { class: 'starters' }, archived.map(starterCard))) : null,
    ]);
  }
  function starterCard(s) {
    const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    const fill = h('span', { class: 'fill' }); fill.style.setProperty('--p', pct + '%');
    const ifill = s.internal ? h('span', { class: 'fill' }) : null;
    if (ifill) ifill.style.setProperty('--p', (s.internal.total ? Math.round(s.internal.done / s.internal.total * 100) : 0) + '%');
    return h('li', null, h('a', { class: 'starter', href: '#/team/' + s.id },
      h('div', { class: 'starter-top' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(s.name)),
        h('div', null, h('p', { class: 'starter-name' }, s.name), h('p', { class: 'starter-sub' }, [s.jobTitle, s.startDate ? `starts ${day(s.startDate)}` : null].filter(Boolean).join(' · ') || s.email))),
      h('p', { class: 'meta', style: { margin: '0' } }, h('span', { class: 'pill pill-tint' }, routeLabel(s)), s.registered ? null : h('span', { class: 'pill' }, 'Not registered yet'), (s.review || []).length ? h('span', { class: 'pill' }, `${s.review.length} waiting`) : null),
      h('div', { class: 'starter-bars' },
        h('div', null, h('p', { class: 'bar-label' }, h('span', null, 'Employee tasks'), h('span', null, `${s.done} of ${s.total}`)), h('div', { class: 'track small' + (pct === 100 ? ' done' : '') }, fill)),
        s.internal && s.internal.total ? h('div', null, h('p', { class: 'bar-label' }, h('span', null, 'Internal setup'), h('span', null, `${s.internal.done} of ${s.internal.total}`)), h('div', { class: 'track small' }, ifill)) : null,
        h('div', { class: 'dots', 'aria-label': 'Task statuses' }, s.tasks.map(x => h('span', { dataset: { s: x.status }, title: `${title(x.key)}: ${C.STATUS[x.status]}` }))))));
  }
  const routeLabel = s => (s.route === 'office' ? (s.visitsSites ? 'Office · visits sites' : 'Office employee') : 'Operative');

  async function starterView(id, tab) {
    stop();
    loading();
    let d;
    try { d = await call('onb_starter', { p_id: id }); } catch (e) { return pageError(e); }
    S.starter = d;
    renderStarter(d, tab || S.tab[id] || 'tasks');
  }
  function renderStarter(d, tab, o = {}) {
    const s = d.starter, can = d.can || {};
    S.tab[s.id] = tab;
    bar({ title: s.name, back: '#/team', backLabel: 'New starters' });
    const tabs = [['tasks', 'Tasks'], d.internal ? ['internal', 'Internal checklist'] : null, d.audit ? ['history', 'History'] : null].filter(Boolean);
    const body = tab === 'internal' && d.internal ? internalTab(d) : tab === 'history' && d.audit ? historyTab(d) : tasksTab(d);
    const needs = C.NEEDS.filter(([k]) => s.needs && s.needs[k]).map(([, label]) => h('span', { class: 'pill' }, label));
    show([
      h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'New starter'), h('h1', { class: 'display' }, s.name),
        h('div', { class: 'meta' }, h('span', null, s.email), s.jobTitle ? h('span', null, s.jobTitle) : null, s.startDate ? h('span', null, `Starts ${dayLong(s.startDate)}`) : null,
          s.hours ? h('span', null, `${s.hours} hours a week`) : null),
        h('div', { class: 'meta' }, h('span', { class: 'pill pill-route' }, routeLabel(s)), needs, s.registered ? null : h('span', { class: 'pill' }, 'Not registered yet'),
          s.young ? h('span', { class: 'pill' }, 'Young person (16–18)') : null),
        can.hr ? h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: () => inviteSheet(s) }, 'Edit details or route'),
          h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: () => inviteMessage(s) }, 'Invitation message'),
          h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: async e => {
            const arch = !s.archivedAt;
            if (!(await confirmIt(arch ? `Archive ${first(s.name)}’s onboarding?` : 'Restore this onboarding?', arch ? 'It leaves the list and their Onboarding tile is taken away. Nothing is deleted.' : 'It comes back to the list and their tile returns.', arch ? 'Archive' : 'Restore'))) return;
            await act(e.target, async () => { await call('onb_archive', { p_starter: s.id, p_archived: arch }); location.hash = '#/team'; }, { ok: arch ? 'Archived' : 'Restored' });
          } }, s.archivedAt ? 'Restore' : 'Archive')) : null),
      tabs.length > 1 ? h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), onclick: () => renderStarter(d, k) }, l))) : null,
      body,
    ], o);
  }
  function tasksTab(d) {
    const s = d.starter;
    return h('ul', { class: 'rows' }, s.tasks.map(x => {
      const det = d.details[x.key];
      const sub = [x.submittedAt ? `Submitted ${day(x.submittedAt)}` : null, x.availability ? C.AVAIL[x.availability] : null].filter(Boolean).join(' · ');
      const inner = [h('span', null, h('span', { class: 'trow-title' }, title(x.key)), sub ? h('span', { class: 'trow-sub' }, sub) : null,
        x.note ? h('span', { class: 'trow-sub' }, `Changes asked for: ${x.note}`) : null), chip(x.status)];
      return h('li', null, det ? h('a', { class: 'trow', href: `#/team/${s.id}/task/${x.key}` }, inner, icon('i-chevron'))
        : h('div', { class: 'trow' }, inner, h('span', { class: 'lock', title: 'You can see this task’s status, not its answers' }, icon('i-lock'), x.key === 'medical' ? 'Restricted' : 'Status only')));
    }));
  }
  function historyTab(d) {
    const what = a => {
      const x = a.detail || {};
      const q = id => { for (const sec of C.INDUCTION.sections) for (const [k, t] of sec.items) if (k === id) return t; return null; };
      const bits = [x.task ? title(x.task) : null, x.item ? (C.ITEMS[x.item] || {}).title || q(x.item) || x.item : null, x.state ? ({ completed: 'completed', not_completed: 'not completed', na: 'not applicable' })[x.state] : null, x.purpose ? (C.ITEMS[x.purpose] || {}).title || x.purpose : null,
        a.kind === 'induction.item' ? null : x.version || x.label || null, x.typedName ? `signed as “${x.typedName}”` : null, x.option ? `Option ${x.option}` : null, x.method || null].filter(Boolean);
      return `${C.AUDIT[a.kind] || a.kind}${bits.length ? ' · ' + bits.join(' · ') : ''}`;
    };
    return h('div', null, h('p', { class: 'section-note' }, 'Every signature, acknowledgement, check and review, with who did it and when. Answers, bank details, pay and files are never written here.'),
      h('ul', { class: 'rows audit' }, (d.audit || []).map(a => h('li', null, h('time', { datetime: a.at }, when(a.at)), h('span', null, h('b', null, a.who || 'FLR'), ' · ', what(a))))));
  }
  function internalTab(d) {
    const s = d.starter;
    const rows = (d.internal || []).map(it => internalRow(s, it, d));
    return h('div', null,
      h('p', { class: 'section-note' }, `FLR’s own setup for ${first(s.name)}, from the “Office use only” part of the New Starter form. ${first(s.name)} never sees this. Items that apply depend on the route and requirements.`),
      d.pay !== undefined && (d.can.hr || d.can.payroll) ? payCard(s, d.pay) : null,
      h('ul', { class: 'rows' }, rows));
  }
  function payCard(s, pay) {
    const m = { perDay: (pay && pay.perDay) || '', perAnnum: (pay && pay.perAnnum) || '', note: (pay && pay.note) || '' };
    const err = h('div');
    return card('Salary', 'Restricted to HR and payroll. Never shown to the new starter.',
      fields(m, [{ k: 'perDay', label: 'Per day (if applicable)', placeholder: '£', max: 30 }, { k: 'perAnnum', label: 'Per annum', placeholder: '£', max: 30 },
        { k: 'note', label: 'Notes', type: 'textarea', rows: 2, optional: true, span: true }]), err,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: e => act(e.target, async () => {
        const r = await call('onb_pay', { p_starter: s.id, p: m }); S.starter = r;
      }, { ok: 'Saved', errorEl: err }) }, 'Save salary'), pay && pay.updatedAt ? h('span', { class: 'field-hint' }, `Updated ${when(pay.updatedAt)}${pay.updatedBy ? ' by ' + pay.updatedBy : ''}`) : null));
  }
  function internalRow(s, it, d) {
    const m = { status: it.status, assignee: it.assignee || '', dueOn: it.dueOn || '', doneOn: it.doneOn || '', note: it.note || '' };
    const can = it.canEdit && !it.auto;
    const sel = h('select', { class: 'select', 'aria-label': `Status: ${it.label}`, disabled: !can || null }, Object.entries(C.INTERNAL_STATUS).map(([v, l]) => h('option', { value: v }, l)));
    sel.value = m.status;
    let timer = 0;
    const save = () => { clearTimeout(timer); timer = setTimeout(async () => {
      try { const r = await call('onb_internal', { p_starter: s.id, p_item: it.id, p: m }); S.starter = r; toast('Saved'); }
      catch (e) { toast(said(e)); }
    }, 700); };
    sel.addEventListener('change', () => { m.status = sel.value; if (m.status === 'complete' && !m.doneOn) { m.doneOn = today(); const x = row.querySelector('[data-k="doneOn"]'); if (x) x.value = m.doneOn; } save(); });
    const mk = (k, label, type, editable) => {
      const id = nid('i');
      const inp = h(type === 'textarea' ? 'textarea' : 'input', { class: type === 'textarea' ? 'textarea' : 'input', id, type: type === 'textarea' ? null : type, rows: type === 'textarea' ? 1 : null, dataset: { k }, maxlength: 600 });
      inp.value = m[k] || ''; if (!editable) inp.readOnly = true;
      inp.addEventListener('input', () => { m[k] = inp.value; save(); });
      return h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), inp);
    };
    const row = h('li', null, h('div', { class: 'ichk' },
      h('div', null, h('p', { class: 'ichk-label' }, it.label),
        h('p', { class: 'ichk-sub' }, it.auto ? 'Done in the app' : it.link ? `Completes when ${it.link === 'rtw' ? 'the right-to-work check is recorded' : it.link === 'p45' ? 'payroll records the P45' : title(it.link) + ' is complete'}` : null,
          it.assigneeName || it.assignee ? `${it.auto || it.link ? ' · ' : ''}Assigned to ${it.assigneeName || it.assignee}` : null)),
      it.auto ? h('span', { class: 'ist ist-' + it.status }, C.INTERNAL_STATUS[it.status]) : sel,
      it.auto ? null : h('div', { class: 'ichk-more' },
        mk('assignee', 'Assigned to (email)', 'email', can && d.can.hr), mk('dueOn', 'Due', 'date', can && d.can.hr), mk('doneOn', 'Done', 'date', can), mk('note', 'Notes', 'textarea', can))));
    return row;
  }

  // HR: add a new starter, or change one's details or route.
  function inviteSheet(s) {
    const defaults = (S.team && S.team.defaults) || {};
    const m = s ? { id: s.id, name: s.name, email: s.email, jobTitle: s.jobTitle, startDate: s.startDate || '', hours: s.hours, route: s.route,
        visitsSites: s.route === 'office' ? (s.visitsSites ? 'yes' : 'no') : '', trainer: s.trainer || '', dseAssessor: s.dseAssessor || '', needs: { ...(s.needs || {}) }, requiredQuals: '' }
      : { name: '', email: '', jobTitle: '', startDate: '', hours: '', route: '', visitsSites: '', trainer: '', dseAssessor: '', needs: {}, requiredQuals: '' };
    const err = h('div');
    const body = h('div');
    const applyDefaults = () => {
      const key = m.route === 'operative' ? 'operative' : m.visitsSites === 'yes' ? 'office_sites' : 'office';
      if (!s && defaults[key]) m.needs = { ...defaults[key] };
    };
    const draw = () => {
      const site = m.route === 'operative' || m.visitsSites === 'yes';
      fill(body,
        fields(m, [{ k: 'name', label: 'Full name', auto: 'off', span: true }, { k: 'email', label: 'Email address', type: 'email', hint: 'They register on the Hub with this address.', span: true },
          { k: 'jobTitle', label: 'Job title' }, { k: 'startDate', label: 'Start date', type: 'date', optional: true }, { k: 'hours', label: 'Hours per week', optional: true, max: 40 }]),
        h('p', { class: 'field-label' }, 'Onboarding route'),
        choices(m, 'route', [{ v: 'operative', label: 'Operative', text: 'Fitters and site operatives: working time choice, fitter information, driving, qualifications and PPE.' },
          { v: 'office', label: 'Office employee', text: 'Office staff: DSE workstation assessment, and site requirements if the role visits sites.' }], { change: () => { if (m.route === 'operative') m.visitsSites = ''; applyDefaults(); draw(); } }),
        m.route === 'office' ? h('div', { style: { 'margin-top': '16px' } }, h('p', { class: 'field-label' }, 'Will this employee’s role require them to visit sites?'),
          choices(m, 'visitsSites', [{ v: 'yes', label: 'Yes' }, { v: 'no', label: 'No' }], { inline: true, change: () => { applyDefaults(); draw(); } })) : null,
        m.route && (m.route === 'operative' || m.visitsSites) ? h('div', { style: { 'margin-top': '18px' } }, h('p', { class: 'field-label' }, 'What applies to this person'),
          h('p', { class: 'field-hint' }, 'These decide which tasks and internal checks appear.'),
          h('div', { class: 'fields', style: { 'margin-top': '10px' } }, C.NEEDS.filter(([, , , siteOnly]) => !siteOnly || site).map(([k, label, what]) =>
            checkbox([h('span', { class: 'choice-title' }, label), h('span', { class: 'choice-text' }, what)], !!m.needs[k], v => { m.needs[k] = v; draw(); }))),
          site && m.needs.quals ? h('div', { class: 'fields', style: { 'margin-top': '12px' } }, field(m, { k: 'requiredQuals', label: 'Qualifications or cards the role needs', type: 'textarea', rows: 2, optional: true,
            hint: 'One per line, for example CSCS card. They’re asked for evidence of each.' })) : null) : null,
        h('div', { class: 'fields two', style: { 'margin-top': '18px' } },
          field(m, { k: 'trainer', label: 'Health and safety induction trainer', type: 'email', hint: 'Their email. They lead the induction.' }),
          m.route === 'office' ? field(m, { k: 'dseAssessor', label: 'DSE assessor', type: 'email', hint: 'Their email. They review the DSE assessment.' }) : null),
        err,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-plain', type: 'button', 'data-close': '' }, 'Cancel'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: e => act(e.target, async () => {
            if (!m.route) throw { message: 'FLR_VALIDATION', details: 'Choose Operative or Office employee' };
            const p = { ...m, visitsSites: m.route === 'office' ? (m.visitsSites === 'yes' ? true : m.visitsSites === 'no' ? false : null) : false,
              requiredQuals: String(m.requiredQuals || '').split('\n').map(x => x.trim()).filter(Boolean) };
            if (!site) { p.needs = { ...p.needs, ppe: false, quals: false, tools: false }; }
            const r = await call('onb_invite', { p });
            closeSheet();
            if (!s) setTimeout(() => inviteMessage(r.starter), 320);
            else { S.starter = r; renderStarter(r, 'tasks'); }
            if (!s) { location.hash = '#/team/' + r.starter.id; }
          }, { ok: s ? 'Saved' : 'Added', errorEl: err }) }, s ? 'Save' : 'Add new starter')));
    };
    draw();
    openSheet(s ? `Edit ${first(s.name)}’s onboarding` : 'Add a new starter', body);
  }
  function inviteMessage(s) {
    const text = `Hello ${first(s.name)},\n\nWelcome to FLR. Your new starter onboarding is ready on the FLR Hub:\n${HUB_URL}\n\nRegister with this email address (${s.email}) and the access code FLR gives you, then open Onboarding. Your answers save as you go, so you can come back to it at any time.\n\nFLR HR`;
    openSheet('Invitation message', [h('p', { class: 'sheet-lede' }, 'The Hub doesn’t send emails. Copy this into an email or message to them. It holds no personal details beyond their name and email.'),
      h('div', { class: 'card' }, h('p', { class: 'invite-text' }, text)),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: async e => {
        try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (x) { toast('Select the text and copy it.'); }
      } }, 'Copy message'), h('button', { class: 'btn btn-plain', type: 'button', 'data-close': '' }, 'Done'))]);
  }

  /* ---------------------------------------------------------------- reviewing one task */
  async function reviewView(id, key) {
    stop();
    loading();
    let d;
    try { d = await call('onb_starter', { p_id: id }); await withAnswers(d, key); } catch (e) { return pageError(e); }
    S.starter = d;
    renderReview(d, key);
  }
  // Medical answers aren't part of the starter's record: they're opened here, and each opening is recorded.
  async function withAnswers(d, key) {
    if (key === 'medical' && d.details && d.details.medical) d.details.medical.answers = await call('onb_medical', { p_starter: d.starter.id });
  }
  // Bank details are shown only when payroll asks for them, and each opening is recorded.
  function bankReveal(starterId) {
    const out = h('div');
    const b = h('button', { class: 'btn btn-plain btn-small', type: 'button' }, icon('i-lock'), 'Show bank details');
    b.addEventListener('click', () => act(b, async () => {
      const x = await call('onb_bank', { p_starter: starterId });
      fill(out, x ? kv([['Bank or building society', x.bankName], ['Address', x.bankAddress], ['Account number', x.accountNumber], ['Sort code', String(x.sortCode || '').replace(/^(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3')]]) : h('p', { class: 'field-hint' }, 'Not given yet.'),
        h('p', { class: 'field-hint' }, 'Opening bank details is recorded in the history.'));
    }));
    fill(out, h('p', { class: 'field-hint' }, 'Given by the new starter. Opening them is recorded.'), h('div', { class: 'btn-row' }, b));
    return out;
  }
  function renderReview(d, key, o = {}) {
    const s = d.starter, t = d.details[key];
    bar({ title: title(key), back: '#/team/' + s.id, backLabel: first(s.name) || 'Back' });
    if (!t) return show([h('header', { class: 'task-head' }, h('p', { class: 'eyebrow' }, s.name), h('h1', { class: 'display' }, title(key))),
      box('lockbox', 'i-lock', h('p', null, 'This task’s answers are restricted. You can see its status on the new starter’s page.'))]);
    const view = REVIEW[key] || (() => []);
    show([h('header', { class: 'task-head' }, h('p', { class: 'eyebrow' }, s.name), h('h1', { class: 'display' }, title(key)),
        h('div', { class: 'meta' }, chip(t.status), avail(t.availability), t.submittedAt ? h('span', null, `Submitted ${when(t.submittedAt)}`) : null,
          t.reviewedAt && t.reviewedBy ? h('span', null, `Reviewed by ${t.reviewedBy}, ${day(t.reviewedAt)}`) : null),
        t.note && t.status === 'needs_changes' ? h('p', { class: 'task-note' }, icon('i-alert'), h('span', null, h('b', null, 'You asked for changes: '), t.note)) : null),
      view(t, d), decide(t, d, key)], o);
  }
  async function reloadReview(r, key) {
    S.starter = r || await call('onb_starter', { p_id: S.starter.starter.id });
    await withAnswers(S.starter, key);
    renderReview(S.starter, key, { keepScroll: scrollY });
  }
  const REVIEWABLE = ['new_starter', 'contract', 'medical', 'hmrc', 'working_time', 'dse', 'qualifications'];
  function decide(t, d, key) {
    if (!t.canReview || !REVIEWABLE.includes(key) || t.status !== 'submitted') return null;
    if (key === 'qualifications' && (t.quals || []).length) return null;
    const m = { note: '' };
    const err = h('div');
    return card('Your decision', key === 'dse' ? 'Complete the assessment only when every “No” has an action and every action is resolved.' : 'Accept it, or say what needs changing. They see your message on their task.',
      field(m, { k: 'note', label: 'What needs changing', type: 'textarea', rows: 3, optional: true, hint: 'Needed only if you ask for changes.' }), err,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-plain', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_review', { p_starter: d.starter.id, p_task: key, p_decision: 'changes', p_note: m.note }), key), { ok: 'Sent back with your message', errorEl: err }) }, 'Ask for changes'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_review', { p_starter: d.starter.id, p_task: key, p_decision: 'accept' }), key), { ok: key === 'dse' ? 'Assessment complete' : 'Accepted', errorEl: err }) }, key === 'dse' ? 'Complete assessment' : 'Accept')));
  }
  const yn = v => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not answered');
  const REVIEW = {};
  REVIEW.new_starter = (t, d) => {
    const x = t.data || {}, p = x.personal || {}, e = x.emergency || {};
    const marital = (C.NEW_STARTER.marital.find(m => m.v === x.marital) || {}).label;
    return [
      card('Personal details', null, kv([['Surname', p.surname], ['First name or names', p.firstNames], ['Date of birth', day(p.dob)], ['Title', p.title], ['Address', p.address], ['Postcode', p.postcode],
        ['Home telephone', p.homePhone], ['Mobile telephone', p.mobile], ['National Insurance number', p.ni], ['Personal email', p.email]])),
      t.maritalStatus === 'removed' ? null : card('Marital status', null, kv([['Marital status', marital || 'Not answered']])),
      card('Emergency contact details', null, kv([['Name', e.name], ['Relationship', e.relationship], ['Address', e.address], ['Telephone', e.phone]])),
      card('Bank details', null, t.bank === 'restricted' ? box('lockbox', 'i-lock', h('p', null, 'Restricted to payroll.'))
        : t.bank && t.bank.available ? bankReveal(d.starter.id)
        : h('p', { class: 'field-hint' }, 'Not given yet.')),
      card('Pension scheme', null, h('p', { class: 'prose' }, t.pensionShown ? `The pension wording was shown to them ${when(t.pensionShown)}.` : 'Not shown yet.')),
      card('Qualifications and professional memberships', null, qualReview(t, d)),
      card('New post details', null, kv([['Job title', t.post && t.post.jobTitle], ['Start date', t.post && day(t.post.startDate)], ['Hours per week', t.post && t.post.hours],
        ['Pre-existing holiday dates', x.holidays]]), x.postQuery ? box('warn', 'i-alert', h('p', null, h('b', null, 'They say something’s wrong: '), x.postQuery)) : null),
      card('Employment history', null, (x.history || []).length ? h('ul', { class: 'entries' }, x.history.map(hh => h('li', { class: 'entry' },
        kv([['Previous employer', hh.employer], ['Start date', hh.start], ['End date', hh.end], ['Position held', hh.position]])))) : h('p', { class: 'field-hint' }, 'None given.')),
      sigsCard(t),
    ];
  };
  const sigsCard = t => ((t.signatures || []).length ? card('Signatures and acknowledgements', null, h('ul', { class: 'rows' }, t.signatures.map(g => h('li', null, h('div', { class: 'trow' },
    h('span', null, h('span', { class: 'trow-title' }, `“${g.typedName}”`), h('span', { class: 'trow-sub' }, g.statement), h('span', { class: 'trow-sub' }, `${when(g.at)}${g.docLabel ? ' · ' + g.docLabel : ''}${g.docSha256 ? ' · ' + g.docSha256.slice(0, 12) + '…' : ''}`))))))) : null);
  // HR's checks of qualification evidence.
  function qualReview(t, d) {
    const quals = t.quals || [];
    const out = h('div');
    out.append(quals.length ? h('ul', { class: 'entries' }, quals.map(q => {
      const m = { status: '', method: '', note: '' };
      const err = h('div');
      return h('li', { class: 'entry' },
        h('div', { class: 'entry-head' }, h('p', { class: 'entry-title' }, q.name), h('span', { class: 'task-meta' }, q.required ? h('span', { class: 'pill pill-tint' }, 'Required') : null, h('span', { class: 'st ' + qualTone(q.status) }, C.QUAL_STATUS[q.status]))),
        kv([['Awarding or professional body', q.body], ['Number', q.number], ['Achieved', day(q.achievedOn)], ['Expires', day(q.expiresOn)],
          ['Checked', q.checkedOn ? `${day(q.checkedOn)}${q.checkedBy ? ' by ' + q.checkedBy : ''}${q.checkMethod ? ' · ' + q.checkMethod : ''}` : null], ['Note', q.note]]),
        fileList(q.files),
        d.can.hr && q.status !== 'verified' ? h('div', { class: 'fields two', style: { 'margin-top': '12px' } },
          field(m, { k: 'status', label: 'Check', type: 'select', options: [{ v: 'verified', label: 'Verified' }, { v: 'original_required', label: 'Original required' }, { v: 'needs_replacement', label: 'Needs replacement' }] }),
          field(m, { k: 'method', label: 'How it was checked', type: 'select', options: C.CHECK_METHODS.qual.map(v => ({ v, label: v })) }),
          field(m, { k: 'note', label: 'Note for them', type: 'textarea', rows: 2, span: true, optional: true, hint: 'Needed for “Original required” or “Needs replacement”.' }), err,
          h('div', { class: 'btn-row span' }, h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: e => act(e.target, async () => {
            reloadReview(await call('onb_qual_check', { p_starter: d.starter.id, p_op: 'check', p: { id: q.id, ...m } }), S.reviewKey || 'new_starter');
          }, { ok: 'Recorded', errorEl: err }) }, 'Record check'),
          q.required && q.status === 'awaiting_evidence' && !(q.files || []).length ? h('button', { class: 'link', type: 'button', onclick: e => act(e.target, async () => {
            reloadReview(await call('onb_qual_check', { p_starter: d.starter.id, p_op: 'unrequire', p: { id: q.id } }), S.reviewKey || 'new_starter');
          }, { ok: 'Removed' }) }, 'No longer required') : null)) : null);
    })) : h('p', { class: 'field-hint' }, (t.data && t.data.none) ? 'They say they don’t hold any relevant qualifications.' : 'None added yet.'));
    if (d.can.hr) {
      const m = { name: '' }; const err = h('div');
      out.append(h('div', { class: 'fields', style: { 'margin-top': '14px' } }, field(m, { k: 'name', label: 'Ask for a qualification the role needs', placeholder: 'For example CSCS card' }), err,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: e => act(e.target, async () => {
          reloadReview(await call('onb_qual_check', { p_starter: d.starter.id, p_op: 'require', p: { name: m.name } }), S.reviewKey || 'new_starter');
        }, { ok: 'Added', errorEl: err }) }, icon('i-plus'), 'Add requirement'))));
    }
    return out;
  }
  REVIEW.qualifications = (t, d) => [card('Qualifications and certificates', null, qualReview(t, d))];
  REVIEW.medical = t => {
    const a = t.answers || {}, hist = a.history || {};
    return [
      box('lockbox', 'i-lock', h('p', null, 'Medical information. Only people FLR has authorised for medical answers can open this, and each opening is recorded.')),
      card('Personal details', null, kv([['Name', a.name], ['Address', a.address], ['National Insurance No', a.ni], ['Date of Birth', day(a.dob)], ['Company', a.company]])),
      card('Emergency contact details', null, kv([['Name', a.ecName], ['Relationship', a.ecRelationship], ['Contact number', a.ecPhone], ['Address', a.ecAddress]])),
      card('Medical history', null, h('ol', { class: 'qs' }, C.MEDICAL.history.map(([id, q]) => { const x = hist[id] || {};
        return h('li', { class: 'q' + (x.a === 'yes' ? ' flag' : '') }, h('p', { class: 'q-text' }, q), h('span', { class: 'st ' + (x.a === 'yes' ? 'st-needs_changes' : 'st-not_started') }, yn(x.a)),
          x.d ? h('p', { class: 'q-more prose' }, x.d) : null); }))),
      card('Declaration', null, h('p', { class: 'prose' }, a.declAgree ? `Declaration confirmed. Name: ${a.declName || ''}. Signature: “${a.declSignature || ''}”.` : 'Not confirmed yet.')),
      sigsCard(t),
    ];
  };
  function docReview(t, d, key) {
    const out = [];
    if (t.doc) out.push(card('Current document', null, h('div', { class: 'doc-card' }, icon('i-file'), h('div', { class: 'grow' }, h('p', { class: 'doc-title' }, t.doc.label), h('p', { class: 'doc-text' }, `${t.doc.fileName} · approved ${day(t.doc.approvedAt)}`)),
      h('button', { class: 'btn btn-plain', type: 'button', onclick: () => viewFile('doc', t.doc.id) }, 'View'))));
    else out.push(box('warn', 'i-alert', h('p', null, h('b', null, 'Awaiting FLR document. '), key === 'contract' ? 'No approved contract for this route yet. A Super Admin adds templates in Setup, or issue one for this person below.' : 'A Super Admin adds it in Setup.')));
    out.push(sigsCard(t));
    if (key === 'contract' && d.can.hr) out.push(personalContract(d));
    return out;
  }
  // HR: a contract for this one person (uploaded as a draft, then confirmed as FLR's approved version).
  function personalContract(d) {
    const m = { label: '' }; let picked = null; const err = h('div'); const status = h('p', { class: 'field-hint' });
    const pick = picker('Choose the contract file', async (name, mime, b64) => { picked = { name, mime, b64 }; status.textContent = `Ready: ${name}`; }, { word: true });
    return card('Issue a contract for this person', 'Use this when their contract differs from the route’s template. It replaces the template for them only.',
      fields(m, [{ k: 'label', label: 'Version name', placeholder: 'For example Signed offer, 2 Oct 2026', span: true }]), h('div', { class: 'btn-row' }, pick), status, err,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: e => act(e.target, async () => {
        if (!picked) throw { message: 'FLR_VALIDATION', details: 'Choose the file first' };
        const docs = await call('onb_doc_upload', { p: { kind: 'contract', scope: 'person', starterId: d.starter.id, label: m.label, fileName: picked.name, mime: picked.mime, b64: picked.b64 } });
        const mine = docs.find(x => x.starterId === d.starter.id && !x.approvedAt && !x.retiredAt);
        if (mine && (await confirmIt('Is this FLR’s approved contract?', 'Once confirmed, it’s shown to them to sign. Only confirm a final, approved version.', 'Confirm and issue'))) await call('onb_doc_set', { p_id: mine.id, p_op: 'approve' });
        reloadReview(null, 'contract');
      }, { ok: 'Saved', errorEl: err }) }, 'Upload contract')));
  }
  REVIEW.contract = (t, d) => docReview(t, d, 'contract');
  REVIEW.handbook = (t, d) => docReview(t, d, 'handbook');
  REVIEW.fitter_info = t => [sigsCard(t) || h('p', { class: 'empty' }, 'Not acknowledged yet.')];
  // Payroll: the P45 and the checklist decision.
  function payrollCard(t, d) {
    if (!d.can.payroll) return null;
    const pay = t.payroll || {};
    const m = { p45Received: !!pay.p45Received, p45ReceivedOn: pay.p45ReceivedOn || '', checklistNeeded: pay.checklistNeeded === true ? 'yes' : pay.checklistNeeded === false ? 'no' : '',
      hmrcVersion: pay.hmrcVersion || t.hmrcCurrent || '', note: pay.note || '' };
    const err = h('div');
    const dateField = field(m, { k: 'p45ReceivedOn', label: 'Date the P45 arrived', type: 'date', optional: true });
    return card('Payroll', 'Only payroll can change this.',
      h('div', { class: 'fields' },
        checkbox('Original P45 received', m.p45Received, v => { m.p45Received = v; if (v && !m.p45ReceivedOn) { m.p45ReceivedOn = today(); dateField.querySelector('input').value = m.p45ReceivedOn; } }),
        h('div', { class: 'fields two' }, dateField, field(m, { k: 'hmrcVersion', label: 'HMRC checklist version given', hint: 'The latest version on GOV.UK.' })),
        h('p', { class: 'field-label' }, 'Is the HMRC Starter Checklist needed from them?'),
        choices(m, 'checklistNeeded', [{ v: 'yes', label: 'Yes', text: 'It appears as a task for them, with HMRC’s official form.' }, { v: 'no', label: 'No', text: 'The HMRC Starter Checklist task shows as not applicable.' }], { inline: true }),
        field(m, { k: 'note', label: 'Payroll notes', type: 'textarea', rows: 2, optional: true })), err,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: e => act(e.target, async () => {
        reloadReview(await call('onb_payroll', { p_starter: d.starter.id, p: { ...m, checklistNeeded: m.checklistNeeded === 'yes' ? true : m.checklistNeeded === 'no' ? false : null } }), S.reviewKey);
      }, { ok: 'Saved', errorEl: err }) }, 'Save')));
  }
  REVIEW.tax = (t, d) => {
    const x = t.data || {};
    const c = payrollCard(t, d);
    return [card('What they told payroll', null, kv([['Has a P45', x.hasP45 === 'yes' ? 'Yes' : x.hasP45 === 'no' ? 'No' : 'Not answered yet'], ['Their note', x.note]]), fileList(t.files)), c];
  };
  REVIEW.hmrc = (t, d) => {
    const x = t.data || {};
    return [card('Their completed checklist', 'HMRC’s official form, returned to FLR.', fileList(t.files) || h('p', { class: 'field-hint' }, 'Not uploaded yet.'),
      kv([['Completed on', day(x.completedOn)], ['Form version', x.version]])), payrollCard({ ...t, payroll: t.payroll }, d)];
  };
  // HR: a document check, kept apart from the upload.
  function checkCard(t, d, it) {
    const meta = C.ITEMS[it.item];
    const m = { method: '', other: '', checkedOn: today(), followUpOn: it.followUpOn || '', docDated: it.docDated || '', note: '' };
    const err = h('div');
    const methods = C.CHECK_METHODS[it.item].map(v => ({ v, label: v })).concat([{ v: 'other', label: 'Other' }]);
    const run = (action, btn) => act(btn, async () => {
      const method = m.method === 'other' ? m.other : m.method;
      reloadReview(await call('onb_item', { p_starter: d.starter.id, p_item: it.item, p_action: action, p: { ...m, method } }), S.reviewKey);
    }, { ok: action === 'replace' ? 'Sent back' : 'Recorded', errorEl: err });
    return h('div', { class: 'doc-item' },
      h('div', { class: 'doc-top' }, h('p', { class: 'doc-title' }, meta.title), h('span', { class: 'st ' + ({ requested: 'st-not_started', uploaded: 'st-submitted', needs_replacement: 'st-needs_changes' })[it.status] }, `Upload: ${C.UPLOAD_STATUS[it.status]}`)),
      fileList(it.files) || h('p', { class: 'field-hint' }, 'Nothing uploaded.'),
      it.code ? h('p', { class: 'checkline' }, h('span', { class: 'pill' }, it.item === 'rtw' ? 'Share code' : 'DVLA check code'), h('span', { class: 'mono' }, it.code)) : null,
      it.checkStatus ? box(it.checkStatus === 'verified' ? 'ok' : 'warn', it.checkStatus === 'verified' ? 'i-check' : 'i-alert',
        h('p', null, h('b', null, it.checkStatus === 'verified' ? (it.item === 'rtw' ? 'Right-to-work check recorded. ' : 'Verified. ') : 'Follow-up needed. '),
          `${it.checkMethod} · checked ${day(it.checkedOn)}${it.checkedBy ? ' by ' + it.checkedBy : ''}${it.followUpOn ? ' · follow-up ' + day(it.followUpOn) : ''}${it.docDated ? ' · document dated ' + day(it.docDated) : ''}`),
        it.checkNote ? h('p', null, it.checkNote) : null)
        : h('p', { class: 'checkline' }, h('span', { class: 'st st-not_started' }, it.item === 'rtw' ? 'Right-to-work check not recorded' : 'Not verified')),
      it.status === 'needs_replacement' && it.note ? h('p', { class: 'task-note' }, icon('i-alert'), h('span', null, `Replacement asked for: ${it.note}`)) : null,
      // The check form: once there's something to check (a right-to-work check can also be a manual check of originals or a
      // share code), and not again once it's verified, unless HR asks for a replacement.
      d.can.hr && it.checkStatus === 'verified' ? h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: async e => {
        const why = { note: '' };
        openSheet('Ask for a replacement', [h('p', { class: 'sheet-lede' }, 'This clears the recorded check. Say what they need to send instead.'),
          field(why, { k: 'note', label: 'What to replace', type: 'textarea', rows: 3 }),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-plain', type: 'button', 'data-close': '' }, 'Cancel'),
            h('button', { class: 'btn btn-danger', type: 'button', onclick: ev => act(ev.target, async () => { const r = await call('onb_item', { p_starter: d.starter.id, p_item: it.item, p_action: 'replace', p: { note: why.note } }); closeSheet(); reloadReview(r, S.reviewKey); }, { ok: 'Sent back' }) }, 'Ask for a replacement'))]);
      } }, 'Ask for a replacement')) : null,
      d.can.hr && it.checkStatus !== 'verified' && (it.item === 'rtw' || (it.files || []).length) ? h('div', { style: { 'margin-top': '14px' } },
        h('div', { class: 'fields two' },
          field(m, { k: 'method', label: it.item === 'rtw' ? 'How the right to work was checked' : 'How it was checked', type: 'select', options: methods, span: true }),
          field(m, { k: 'other', label: 'If other, say how', optional: true, span: true }),
          field(m, { k: 'checkedOn', label: 'Date checked', type: 'date' }),
          field(m, { k: 'followUpOn', label: it.item === 'rtw' ? 'Follow-up check date' : it.item === 'licence' ? 'Licence expiry or next check' : 'Follow-up date', type: 'date', optional: true,
            hint: it.item === 'rtw' ? 'For time-limited permission to work.' : null }),
          it.item === 'address' ? field(m, { k: 'docDated', label: 'Date on the document', type: 'date', hint: 'Must be within three months of the check.' }) : null,
          field(m, { k: 'note', label: 'Notes, or what to replace', type: 'textarea', rows: 2, optional: true, span: true })),
        err,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: e => run('verify', e.target) }, it.item === 'rtw' ? 'Record right-to-work check' : 'Record as verified'),
          h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: e => run('follow_up', e.target) }, 'Checked, follow-up needed'),
          h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: e => run('replace', e.target) }, 'Ask for a replacement'))) : null);
  }
  REVIEW.documents = (t, d) => [box('info', 'i-alert', h('p', null, 'An upload isn’t a check. Record who checked, when, how and any follow-up date. The right-to-work check is recorded on its own.')),
    card('Documents', null, (t.items || []).map(it => checkCard(t, d, it)))];
  REVIEW.driving = (t, d) => [card('Driving licence', null, (t.items || []).map(it => checkCard(t, d, it)))];
  REVIEW.ppe = (t, d) => {
    const m = { item: '', size: '', qty: '1', issuedOn: today() }; const err = h('div');
    const issued = (t.data || {}).issued;
    return [card('Issued', issued ? 'Sent to them to confirm receipt.' : 'Add each item, then send the list to them to confirm.',
      (t.ppe || []).length ? h('ul', { class: 'rows' }, t.ppe.map(x => h('li', null, h('div', { class: 'trow' },
        h('span', null, h('span', { class: 'trow-title' }, `${x.qty} × ${x.item}`), h('span', { class: 'trow-sub' }, `${x.size ? 'Size ' + x.size + ' · ' : ''}Issued ${day(x.issuedOn)}${x.issuedBy ? ' by ' + x.issuedBy : ''}`)),
        t.status === 'complete' ? null : h('button', { class: 'link', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_ppe', { p_starter: d.starter.id, p_op: 'remove', p: { id: x.id } }), 'ppe')) }, 'Remove'))))) : h('p', { class: 'field-hint' }, 'Nothing added yet.'),
      t.status === 'complete' ? sigsCard(t) : h('div', null, h('div', { class: 'fields three', style: { 'margin-top': '14px' } },
        field(m, { k: 'item', label: 'Item', placeholder: 'For example Safety boots' }), field(m, { k: 'size', label: 'Size', optional: true, max: 20 }),
        field(m, { k: 'qty', label: 'Quantity', type: 'number', mode: 'numeric' }), field(m, { k: 'issuedOn', label: 'Issued on', type: 'date' })), err,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_ppe', { p_starter: d.starter.id, p_op: 'add', p: m }), 'ppe'), { ok: 'Added', errorEl: err }) }, icon('i-plus'), 'Add item'),
          h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_ppe', { p_starter: d.starter.id, p_op: 'issue' }), 'ppe'), { ok: 'Sent to confirm', errorEl: err }) }, `Ask ${first(d.starter.name)} to confirm`))))];
  };
  REVIEW.working_time = t => {
    const x = t.data || {}, W = C.WORKING_TIME;
    return [card('Their choice', null, kv([['Choice', x.option === 'A' ? W.a.title : x.option === 'B' ? W.b.title : 'Not chosen'], ['Employee name', x.name], ['Payroll number', x.payroll],
      ['Site / location', x.site], ['Department', x.department], ['Effective from', day(x.effectiveFrom)], ['Signature', x.signature ? `“${x.signature}”` : '']]),
      x.option ? source(x.option === 'A' ? W.a.text : W.b.text, W.source) : null), sigsCard(t)];
  };
  REVIEW.dse = (t, d) => {
    const D = C.DSE, x = t.data || {}, a = x.answers || {};
    const open = (t.actions || []).filter(y => !y.resolvedAt);
    const can = t.canReview && t.status !== 'complete';
    const actionsFor = id => (t.actions || []).filter(y => y.item === id);
    const addAction = id => { const m = { action: '' }; const err = h('div');
      return h('div', { class: 'q-more' }, h('div', { class: 'input-row' }, h('input', { class: 'input', placeholder: 'Action to take', 'aria-label': 'Action to take', maxlength: 600, oninput: e => { m.action = e.target.value; } }),
        h('button', { class: 'btn btn-plain', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_dse_action', { p_starter: d.starter.id, p_op: 'add', p: { item: id, action: m.action } }), 'dse'), { ok: 'Action added', errorEl: err }) }, 'Add')), err); };
    const actionRow = y => { const m = { resolution: '' };
      return h('li', null, h('div', { class: 'trow' }, h('span', null, h('span', { class: 'trow-title' }, y.action), h('span', { class: 'trow-sub' }, `Added ${day(y.createdAt)}${y.createdBy ? ' by ' + y.createdBy : ''}`),
          y.resolvedAt ? h('span', { class: 'trow-sub' }, `Resolved ${day(y.resolvedAt)}${y.resolvedBy ? ' by ' + y.resolvedBy : ''}: ${y.resolution}`) : null),
        h('span', { class: 'st ' + (y.resolvedAt ? 'st-complete' : 'st-needs_changes') }, y.resolvedAt ? 'Resolved' : 'Open')),
        can && !y.resolvedAt ? h('div', { class: 'input-row', style: { padding: '0 16px 12px' } }, h('input', { class: 'input', placeholder: 'How it was resolved', 'aria-label': 'How it was resolved', oninput: e => { m.resolution = e.target.value; } }),
          h('button', { class: 'btn btn-plain', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_dse_action', { p_starter: d.starter.id, p_op: 'resolve', p: { id: y.id, resolution: m.resolution } }), 'dse'), { ok: 'Resolved' }) }, 'Resolve')) : null,
        can && y.resolvedAt ? h('p', { style: { padding: '0 16px 12px', margin: 0 } }, h('button', { class: 'link', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_dse_action', { p_starter: d.starter.id, p_op: 'reopen', p: { id: y.id } }), 'dse')) }, 'Reopen')) : null); };
    return [
      card('Workstation', null, kv([['Workstation location and number', x.location], ['User', d.starter.name], ['Checklist completed by', d.starter.name], ['Assessment checked by', t.assessorName || t.assessor],
        ['Any further action needed', open.length || D.sections.some(s => s.items.some(([id]) => (a[id] || {}).a === (D.concern[id] || 'no'))) ? 'Yes' : 'No']])),
      D.sections.map(sec => card(sec.title, null, h('ol', { class: 'qs' }, sec.items.map(([id, q]) => {
        const ans = a[id] || {}; const flag = ans.a === (D.concern[id] || 'no');
        const acts = actionsFor(id);
        return h('li', { class: 'q' + (flag ? ' flag' : '') }, h('p', { class: 'q-text' }, q),
          h('span', { class: 'st ' + (flag ? 'st-needs_changes' : ans.a ? 'st-complete' : 'st-not_started') }, yn(ans.a)),
          ans.note ? h('p', { class: 'q-more prose' }, `Their note: ${ans.note}`) : null,
          acts.length ? h('ul', { class: 'rows q-more' }, acts.map(actionRow)) : null,
          can && flag ? addAction(id) : null);
      })))),
      x.problems ? card('Details of any problems', null, h('p', { class: 'prose' }, x.problems)) : null,
      card('General actions', null, (t.actions || []).filter(y => y.item === 'general').length ? h('ul', { class: 'rows' }, (t.actions || []).filter(y => y.item === 'general').map(actionRow)) : null,
        can ? addAction('general') : null),
    ];
  };
  REVIEW.induction = (t, d) => {
    const I = C.INDUCTION, rec = t.induction || {}, items = rec.items || {}, s = d.starter;
    const finished = !!rec.finishedAt, done = t.status === 'complete';
    const can = t.canReview && !done;
    const fus = t.followups || [];
    const states = [{ v: 'completed', label: 'Completed', tone: 'good' }, { v: 'not_completed', label: 'Not completed', tone: 'bad' }, { v: 'na', label: 'N/A' }];
    const setItem = async (id, state, note) => {
      try { S.starter = await call('onb_induction', { p_starter: s.id, p_op: 'item', p: { item: id, state, note } }); toast('Saved'); renderReview(S.starter, 'induction', { keepScroll: scrollY }); }
      catch (e) { toast(said(e)); }
    };
    const m = { completedOn: today(), copyName: '' }; const err = h('div');
    return [
      card('Induction details', null, kv([['Name', s.name], ['Job title', s.jobTitle], ['Start date', day(s.startDate)], ['Trainer', t.trainerName || t.trainer || 'Not assigned'],
        ['Induction completed on', rec.completedOn ? dayLong(rec.completedOn) : 'Not yet'], ['Induction completed by', rec.completedBy || ''], ['Record version', rec.version]]),
        can && !finished ? box('info', 'i-alert', h('p', null, 'Go through each item with them in person. Mark anything not covered as Not completed: it becomes a follow-up, and the induction stays open until it’s covered.')) : null,
        done ? box('ok', 'i-check', h('p', null, `${first(s.name)} signed the record. Their copy is in their onboarding.`)) : finished ? box('info', 'i-check', h('p', null, `Waiting for ${first(s.name)} to read and sign the record.`)) : null),
      s.young ? youngPanel() : null,
      s.young && can && !finished ? card(null, null, checkbox('I have explained the information for young persons.', rec.youngExplained, async v => {
        try { S.starter = await call('onb_induction', { p_starter: s.id, p_op: 'young', p: { explained: v } }); toast('Saved'); } catch (e) { toast(said(e)); } })) : null,
      fus.length ? card('Follow-ups', null, h('ul', { class: 'rows' }, fus.map(f => h('li', null, h('div', { class: 'trow' },
        h('span', null, h('span', { class: 'trow-title' }, (I.sections.flatMap(x => x.items).find(([k]) => k === f.item) || [, f.item])[1]),
          h('span', { class: 'trow-sub' }, f.resolvedAt ? `Covered ${day(f.resolvedAt)}${f.resolvedBy ? ' by ' + f.resolvedBy : ''}${f.resolution ? ': ' + f.resolution : ''}` : `Opened ${day(f.openedAt)}${f.note ? ': ' + f.note : ''}`)),
        h('span', { class: 'st ' + (f.resolvedAt ? 'st-complete' : 'st-needs_changes') }, f.resolvedAt ? 'Covered' : 'Open')))))) : null,
      I.sections.map(sec => card(sec.title, null, h('ol', { class: 'qs' }, sec.items.map(([id, q]) => {
        const it = items[id] || {};
        const note = h('input', { class: 'input', placeholder: 'Notes', 'aria-label': `Notes: ${q}`, maxlength: 500, value: it.note || '', readonly: !can || finished || null });
        note.addEventListener('change', () => { if (it.state) setItem(id, it.state, note.value); });
        return h('li', { class: 'q' + (it.state === 'not_completed' ? ' flag' : '') }, h('p', { class: 'q-text' }, q),
          seg(it.state, states, v => setItem(id, v, note.value), { locked: !can || finished, label: q }), note);
      })))),
      can && !finished ? card('Complete the induction', null, h('div', { class: 'fields two' },
          field(m, { k: 'completedOn', label: 'Induction completed on', type: 'date' }),
          field(m, { k: 'copyName', label: 'Re-enter their name', hint: I.copyName + ' (Their completed copy is in their onboarding.)', auto: 'off' })), err,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_induction', { p_starter: s.id, p_op: 'finish', p: m }), 'induction'), { ok: `Sent to ${first(s.name)} to sign`, errorEl: err }) }, 'Complete induction'))) : null,
      can && finished ? h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-plain', type: 'button', onclick: e => act(e.target, async () => reloadReview(await call('onb_induction', { p_starter: s.id, p_op: 'reopen' }), 'induction'), { ok: 'Reopened' }) }, 'Reopen to change it')) : null,
      sigsCard(t),
    ];
  };

  /* ---------------------------------------------------------------- setup: launch checks, templates, team and access, task rules */
  async function setupView(tab) {
    stop();
    loading();
    const t = me();
    let home, admin = null;
    try { home = await call('onb_team_home'); if (t.superAdmin) admin = await call('onb_admin'); else if (t.hr) admin = { docs: await call('onb_docs') }; }
    catch (e) { return pageError(e); }
    S.team = home;
    const tabs = [['checks', 'Launch checks'], (t.superAdmin || t.hr) ? ['docs', 'Documents'] : null, t.superAdmin ? ['team', 'Team and access'] : null, t.superAdmin ? ['rules', 'Task rules'] : null].filter(Boolean);
    tab = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
    bar({ title: 'Setup', back: '#/team', backLabel: 'New starters' });
    const body = tab === 'docs' ? docsTab(admin, t) : tab === 'team' ? teamTab(admin) : tab === 'rules' ? rulesTab(admin) : checksTab(home, t);
    show([h('header', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Onboarding'), h('h1', { class: 'display' }, 'Setup'),
        h('p', { class: 'lede' }, 'What must be confirmed before launch, FLR’s documents, who can see what, and which tasks each route gets.')),
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) => h('a', { href: '#/setup/' + k, role: 'tab', 'aria-current': k === tab ? 'page' : null }, l))),
      body], {});
  }
  function checksTab(home, t) {
    const items = home.content || [];
    const decided = c => (c.key === 'marital_status' ? c.decision === 'kept' || c.decision === 'removed' : !!c.decision);
    return h('div', null, h('p', { class: 'section-note' }, `${items.filter(decided).length} of ${items.length} confirmed. Only the working time form is held back from starters until approved; the rest are checks to finish before onboarding goes live.`),
      h('ul', { class: 'rows' }, items.map(c => {
        const canSet = t.hr || (c.key === 'hmrc' && t.payroll);
        const label = c.decision === 'approved' ? 'Approved' : c.decision === 'current' ? 'Confirmed current' : c.decision === 'kept' ? 'Kept' : c.decision === 'removed' ? 'Removed from the form' : 'Not confirmed';
        const go = (decision, btn, version) => act(btn, async () => { await call('onb_content_set', { p_key: c.key, p_decision: decision, p_version: version || null }); setupView('checks'); }, { ok: 'Recorded' });
        const vm = { version: c.version };
        return h('li', null, h('div', { class: 'launch' },
          h('div', null, h('p', { class: 'launch-title' }, c.title, c.gates ? h('span', { class: 'pill', style: { 'margin-left': '8px' } }, 'Holds the task back') : null),
            h('p', { class: 'launch-sub' }, c.question), h('p', { class: 'launch-sub' }, `In use: ${c.version}`),
            h('p', { class: 'launch-sub' }, h('span', { class: 'st ' + (decided(c) ? 'st-complete' : 'st-needs_changes') }, label), c.decidedAt ? ` ${day(c.decidedAt)}${c.decidedBy ? ' · ' + c.decidedBy : ''}` : '')),
          canSet ? h('div', { class: 'btn-row' },
            c.key === 'hmrc' ? h('input', { class: 'input', style: { 'min-height': '34px', width: '220px' }, 'aria-label': 'HMRC form version', value: c.version, oninput: e => { vm.version = e.target.value; } }) : null,
            c.key === 'marital_status' ? [h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: e => go('kept', e.target) }, 'Keep it'),
              h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: e => go('removed', e.target) }, 'Remove it')]
            : h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: e => go(c.key === 'working_time' ? 'approved' : 'current', e.target, c.key === 'hmrc' ? vm.version : null) }, c.key === 'working_time' ? 'Approve wording' : 'Confirm current'),
            c.decision ? h('button', { class: 'link', type: 'button', onclick: e => go('reset', e.target) }, 'Undo') : null) : null));
      })));
  }
  function docsTab(admin, t) {
    const docs = (admin && admin.docs) || [];
    const kinds = Object.keys(C.DOC_KINDS);
    const scope = x => ({ all: 'Everyone', operative: 'Operatives', office: 'Office employees', person: `Only ${x.starter || 'one person'}` })[x.scope];
    const m = { kind: 'contract', scope: 'all', label: '' }; let picked = null; const err = h('div'); const st = h('p', { class: 'field-hint' });
    return h('div', null,
      h('p', { class: 'section-note' }, 'FLR’s approved documents. A new upload is a draft until it’s confirmed as FLR’s approved version; only then do starters see it. Anything without an approved version shows to starters as “Awaiting FLR document”.'),
      kinds.map(k => {
        const list = docs.filter(x => x.kind === k);
        const current = list.filter(x => x.approvedAt && !x.retiredAt && x.scope !== 'person');
        return h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, C.DOC_KINDS[k]),
            current.length ? h('span', { class: 'st st-complete' }, 'Approved version in use') : h('span', { class: 'av' }, icon('i-lock'), 'Awaiting FLR document')),
          list.length ? h('ul', { class: 'rows' }, list.map(x => h('li', null, h('div', { class: 'trow' },
            h('span', null, h('span', { class: 'trow-title' }, x.label), h('span', { class: 'trow-sub' }, `${scope(x)} · ${x.fileName} · uploaded ${day(x.uploadedAt)}${x.uploadedBy ? ' by ' + x.uploadedBy : ''}`),
              h('span', { class: 'trow-sub' }, x.retiredAt ? `Retired ${day(x.retiredAt)}` : x.approvedAt ? `Approved ${day(x.approvedAt)}${x.approvedBy ? ' by ' + x.approvedBy : ''} · signed by ${x.signed}` : 'Draft: not shown to anyone')),
            h('span', { class: 'btn-row', style: { margin: 0 } },
              h('button', { class: 'link', type: 'button', onclick: () => viewFile('doc', x.id) }, 'View'),
              (t.superAdmin || x.scope === 'person') && !x.approvedAt && !x.retiredAt ? h('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: async e => {
                if (!(await confirmIt('Is this FLR’s approved version?', 'Once approved, new starters see it and sign or acknowledge this exact file.', 'Approve'))) return;
                await act(e.target, async () => { await call('onb_doc_set', { p_id: x.id, p_op: 'approve' }); setupView('docs'); }, { ok: 'Approved' });
              } }, 'Approve') : null,
              (t.superAdmin || x.scope === 'person') && !x.retiredAt ? h('button', { class: 'link', type: 'button', onclick: async e => {
                if (!(await confirmIt('Retire this version?', 'Nobody new will be shown it. Signatures already made stay on record.', 'Retire', { danger: true }))) return;
                await act(e.target, async () => { await call('onb_doc_set', { p_id: x.id, p_op: 'retire' }); setupView('docs'); }, { ok: 'Retired' });
              } }, 'Retire') : null))))) : null);
      }),
      t.superAdmin ? card('Upload a new version', 'PDF is best: starters can read it on their phone.',
        h('div', { class: 'fields two' },
          field(m, { k: 'kind', label: 'Document', type: 'select', options: kinds.map(k => ({ v: k, label: C.DOC_KINDS[k] })) }),
          field(m, { k: 'scope', label: 'Who it’s for', type: 'select', options: [{ v: 'all', label: 'Everyone' }, { v: 'operative', label: 'Operatives' }, { v: 'office', label: 'Office employees' }] }),
          field(m, { k: 'label', label: 'Version name', placeholder: 'For example Handbook v4, October 2026', span: true })),
        h('div', { class: 'btn-row' }, picker('Choose file', async (name, mime, b64) => { picked = { name, mime, b64 }; st.textContent = `Ready: ${name}`; }, { word: true })), st, err,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: e => act(e.target, async () => {
          if (!picked) throw { message: 'FLR_VALIDATION', details: 'Choose the file first' };
          await call('onb_doc_upload', { p: { ...m, fileName: picked.name, mime: picked.mime, b64: picked.b64 } }); setupView('docs');
        }, { ok: 'Uploaded as a draft', errorEl: err }) }, 'Upload as draft'))) : null);
  }
  function teamTab(admin) {
    const team = (admin && admin.team) || [];
    const perms = [['overview', 'Progress', 'Sees everyone’s progress and statuses'], ['hr', 'HR', 'Adds starters, reviews, checks documents, internal checklist, pay'],
      ['medical', 'Medical', 'Reads medical questionnaires'], ['payroll', 'Payroll', 'Bank, pay, P45 and HMRC checklist']];
    const set = async (email, p, btn) => act(btn, async () => { await call('onb_set_team', { p_email: email, p }); setupView('team'); }, { ok: 'Saved' });
    const m = { email: '' }; const err = h('div');
    return h('div', null,
      h('p', { class: 'section-note' }, 'Who can see what. Being a Super Admin doesn’t give anyone medical answers or bank details: give those only to the people who need them. New starters, trainers and assessors get Onboarding from their assignments.'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'matrix' }, h('thead', null, h('tr', null, h('th', null, 'Person'), perms.map(([, l, tip]) => h('th', { class: 'c', title: tip }, l)))),
        h('tbody', null, team.map(p => h('tr', null, h('td', null, h('b', null, p.name || p.email), p.name ? h('div', { class: 'field-hint' }, p.email) : null),
          perms.map(([k, l]) => h('td', { class: 'c' }, h('input', { type: 'checkbox', checked: p[k] || null, 'aria-label': `${l} for ${p.email}`, onchange: e => set(p.email, { overview: p.overview, hr: p.hr, medical: p.medical, payroll: p.payroll, [k]: e.target.checked }, null) })))))))),
      card('Add someone', null, h('div', { class: 'fields' }, field(m, { k: 'email', label: 'Their FLR email', type: 'email' }),
        h('div', { class: 'fields two' }, perms.map(([k, l, tip]) => checkbox(`${l}: ${tip}`, false, v => { m[k] = v; })))), err,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: e => set(m.email, { overview: !!m.overview, hr: !!m.hr, medical: !!m.medical, payroll: !!m.payroll }, e.target) }, 'Add'))));
  }
  function rulesTab(admin) {
    const rules = (admin && admin.rules) || [], defs = (admin && admin.defaults) || {};
    const routes = [['operative', 'Operative'], ['office', 'Office'], ['officeSites', 'Office: extra if visiting sites']];
    const cond = { driving: 'when driving applies', qualifications: 'when qualifications apply', ppe: 'when PPE applies', hmrc: 'when payroll says it’s needed', tax: '' };
    return h('div', null,
      h('p', { class: 'section-note' }, 'Which tasks each route gets. Some also depend on what HR ticks for the person. Changes apply to everyone at once, including people already onboarding, so change a rule only when no one is part-way through.'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'matrix' }, h('thead', null, h('tr', null, h('th', null, 'Task'), routes.map(([, l]) => h('th', { class: 'c' }, l)))),
        h('tbody', null, rules.map(r => h('tr', null, h('td', null, title(r.task), cond[r.task] ? h('div', { class: 'field-hint' }, cond[r.task]) : null),
          routes.map(([k, l]) => h('td', { class: 'c' }, h('input', { type: 'checkbox', checked: r[k] || null, 'aria-label': `${title(r.task)}: ${l}`, onchange: async e => {
            try { await call('onb_set_rule', { p_task: r.task, p: { [k]: e.target.checked } }); toast('Saved'); } catch (x) { toast(said(x)); e.target.checked = !e.target.checked; } } })))))))),
      h('h2', { class: 'group-title', style: { 'margin-top': '28px' } }, 'What HR’s switches start at, for each route'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'matrix' }, h('thead', null, h('tr', null, h('th', null, 'Requirement'), [['operative', 'Operative'], ['office', 'Office'], ['office_sites', 'Office, visits sites']].map(([, l]) => h('th', { class: 'c' }, l)))),
        h('tbody', null, C.NEEDS.map(([k, label]) => h('tr', null, h('td', null, label), ['operative', 'office', 'office_sites'].map(route => h('td', { class: 'c' }, h('input', { type: 'checkbox', checked: (defs[route] || {})[k] || null, 'aria-label': `${label}: ${route}`, onchange: async e => {
          try { await call('onb_set_default', { p_route: route, p: { [k]: e.target.checked } }); toast('Saved'); } catch (x) { toast(said(x)); e.target.checked = !e.target.checked; } } })))))))));
  }

  /* ---------------------------------------------------------------- errors and the router */
  function pageError(e) {
    const code = flrCode(e);
    if (code === 'FLR_FORBIDDEN') return gate('You don’t have access to that', 'It’s restricted to the FLR staff who need it.', {});
    if (code === 'FLR_NOT_FOUND') return gate('That isn’t there', said(e));
    return gate('That didn’t load', said(e), { retry: true });
  }
  async function route() {
    await saveNow();
    const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    S.reviewKey = p[0] === 'team' && p[2] === 'task' ? p[3] : null;
    if (p[0] === 'task' && p[1] === 'induction' && p[2] === 'copy') {
      loading(); try { const t = await call('onb_task', { p_task: 'induction' }); S.task = t; return inductionCopy(t); } catch (e) { return pageError(e); }
    }
    if (p[0] === 'task' && p[1]) return TASKS[p[1]] ? taskView(p[1], p[2]) : gate('That isn’t there', 'That task doesn’t exist.');
    if (p[0] === 'team' && p[1] && p[2] === 'task' && p[3]) return reviewView(p[1], p[3]);
    if (p[0] === 'team' && p[1]) return starterView(p[1], p[2]);
    if (p[0] === 'team') return teamView();
    if (p[0] === 'setup') return setupView(p[1]);
    try { S.home = await call('onb_home'); } catch (e) { return failGate(e); }
    return homeView();
  }
  function failGate(e) {
    const code = flrCode(e);
    if (expired(e) || code === 'FLR_SIGN_IN_REQUIRED') return location.replace(SIGN_IN);
    if (code === 'FLR_FORBIDDEN') return gate('You don’t have access to Onboarding', 'Onboarding is for the new starters FLR has invited, and the people who look after them. If you think you should have it, ask FLR HR.');
    if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
    if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
    if (missingFunction(e)) return gate('Onboarding isn’t ready yet', 'The FLR database doesn’t have Onboarding yet.');
    return gate('Onboarding didn’t load', said(e), { retry: true });
  }
  async function boot() {
    const c = client();
    if (!c) return gate('Onboarding isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) return location.replace(SIGN_IN);
    try { S.home = await call('onb_home'); } catch (e) { return failGate(e); }
    addEventListener('hashchange', route);
    route();
  }
  $('#gate-retry').addEventListener('click', () => location.reload());
  boot();
})();
