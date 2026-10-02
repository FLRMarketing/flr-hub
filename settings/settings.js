/* ============================================================================
   FLR Hub settings: everyone with an FLR account, the apps each person may use,
   new accounts waiting for approval, and registration (the access code, open or
   closed, what new accounts get, roles decided in advance). For Super Admins:
   the database checks every call (users.write), whatever this page shows. The
   apps check the lists themselves, so taking an app away also closes it to
   anyone who goes to its address. A new account is switched off until a Super
   Admin checks who it is and approves it (Hub migration 2.2).
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';            // the one FLR sign-in for the whole site
  const HUB = new URL('../', location.href).href;
  const SIGN_IN = '../?next=settings';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 'admin' is the Super Admin (what every administrator was before 2 Oct 2026); 'manager' is the Admin.
  const ROLES = { admin: 'Super Admin', manager: 'Admin', estimator: 'User', developer: 'Developer' };   // 'estimator' is shown as User
  const AS = { admin: 'a Super Admin', manager: 'an Admin', estimator: 'a User', developer: 'a developer' };
  const ROLE_NOTE = {
    admin: 'Looks after accounts, roles and every app’s settings; sees everything in their apps',
    manager: 'Day-to-day: approves leave, sees every driver and fitter arrivals, reassigns quotes; no settings',
    estimator: 'Uses the apps switched on for them: builds and approves quotes, sees their own leave and driving',
    developer: 'Reads and exports quotes, for testing',
  };
  const SHORT = { estimator: 'Estimator', speeding: 'Fleet', 'annual-leave': 'Leave', fitters: 'Fitters' };
  const CHECKED = { phone: 'checked by phone', teams: 'checked on Teams', it: 'checked by IT' };
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  let sb = null;
  const client = () => {
    if (sb) return sb;
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY },
    });
    return sb;
  };

  /* ---------------------------------------------------------------- talking to the database */
  const flrCode = e => { const m = /FLR_[A-Z_]+/.exec(e ? `${e.message || ''} ${e.details || ''}` : ''); return m ? m[0] : ''; };
  const missingFunction = e => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message || ''));
  const offline = e => !!e && /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(e.message || '');
  const expired = e => !!e && (e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT expired|invalid JWT/i.test(e.message || ''));
  async function call(fn, args) {
    const { data, error } = await client().rpc(fn, args || {});
    if (error) throw error;
    return data;
  }
  function said(e) {
    const code = flrCode(e);
    if (offline(e)) return 'Can’t reach the FLR database. Check your connection and try again.';
    if (code === 'FLR_VALIDATION' && e.details) return e.details;
    if (code === 'FLR_FORBIDDEN') return 'Only FLR Super Admins can do that.';
    if (code === 'FLR_NOT_FOUND') return 'That account no longer exists. The list has been refreshed.';
    if (code === 'FLR_ACCOUNT_DISABLED') return 'Your FLR account is switched off.';
    if (expired(e) || code === 'FLR_SIGN_IN_REQUIRED') return 'Your sign-in has expired. Sign in again.';
    return 'That didn’t work. Try again.';
  }

  /* ---------------------------------------------------------------- state */
  const S = { you: '', apps: [], accounts: [], settings: null, pre: [], query: '' };
  const byId = id => S.accounts.find(a => a.id === id);
  // Waiting: registered, switched off, nobody has decided yet. Not approved: waiting, or a Super Admin said no.
  const notApproved = a => !!(a && a.request && a.request.decision !== 'approved');
  const waitingOf = () => S.accounts.filter(a => a.waiting);
  const listed = () => S.accounts.filter(a => !a.waiting);
  const appTitle = id => (S.apps.find(a => a.id === id) || {}).title || SHORT[id] || id;
  const nameOf = a => (a && (a.name || '').trim()) || (a && a.email) || 'This account';
  const firstName = a => nameOf(a).split(/\s+/)[0];
  function initials(text) {
    const w = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '·';
    return w.length === 1 ? w[0][0].toUpperCase() : (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const day = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  function when(iso) {
    if (!iso) return '';
    const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
    const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return today ? `today at ${t}` : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${t}`;
  }
  function seen(iso) {
    if (!iso) return 'Never signed in';
    const d = new Date(iso), now = new Date();
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
    if (days === 0) return `Last seen today, ${time}`;
    if (days === 1) return `Last seen yesterday, ${time}`;
    return `Last seen ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}`;
  }

  /* ---------------------------------------------------------------- views */
  function view(name) { document.body.dataset.view = name; }
  function gate(title, text, o = {}) {
    view('gate');
    $('#gate').hidden = false; $('#gate-message').hidden = false;
    $('#gate-title').textContent = title; $('#gate-text').textContent = text;
    $('#gate-retry').hidden = !o.retry;
    $('#accounts-section').hidden = true; $('#registration-section').hidden = true; $('#waiting-section').hidden = true;
  }

  function switchEl(on, label, data) {
    const b = el('button', 'switch');
    b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', on ? 'true' : 'false');
    if (label) b.setAttribute('aria-label', label);
    for (const [k, v] of Object.entries(data || {})) b.dataset[k] = v;
    b.append(el('span', 'knob'));
    return b;
  }

  function accountRow(a) {
    const off = notApproved(a);
    const li = el('li', 'acct' + (a.status === 'disabled' ? ' is-off' : ''));
    li.dataset.id = a.id;
    const person = el('button', 'acct-person');
    person.type = 'button';
    if (off) { person.dataset.approve = a.id; person.setAttribute('aria-label', `${nameOf(a)}, ${a.email}: not approved. Check and approve`); }
    else { person.dataset.open = a.id; person.setAttribute('aria-label', `${nameOf(a)}, ${a.email}: role, status and password`); }
    const av = el('span', 'avatar', initials(nameOf(a))); av.setAttribute('aria-hidden', 'true');
    const text = el('span', 'acct-text');
    const nm = el('span', 'acct-name'); nm.append(el('span', null, nameOf(a)));
    if (a.id === S.you) nm.append(el('span', 'pill pill-you', 'You'));
    text.append(nm, el('span', 'acct-email', a.email));
    person.append(av, text);
    // The role, changed right here (as in the person's sheet). Nobody changes their own.
    const role = el('label', 'acct-role select-wrap');
    const pick = el('select');
    pick.dataset.roleFor = a.id;
    pick.setAttribute('aria-label', `Role for ${nameOf(a)}`);
    for (const r of ['estimator', 'manager', 'admin', 'developer']) { const o = el('option', null, ROLES[r]); o.value = r; pick.append(o); }
    if (!ROLES[a.role]) { const o = el('option', null, a.role); o.value = a.role; pick.append(o); }   // a role this page doesn't know yet
    pick.value = a.role;
    if (a.id === S.you) { pick.disabled = true; role.title = 'You can’t change your own role'; }
    else if (off) { pick.disabled = true; role.title = 'Approve this account first'; }
    role.append(pick);
    const status = el('span', 'acct-status');
    status.append(el('span', a.status === 'disabled' ? 'pill pill-off' : 'pill pill-on', off ? 'Not approved' : a.status === 'disabled' ? 'Switched off' : 'Active'));
    const apps = el('span', 'acct-apps');
    for (const app of S.apps) {
      const cell = el('span', 'app-cell');
      const sw = switchEl(a.apps.includes(app.id), `${appTitle(app.id)} for ${nameOf(a)}`, { app: app.id, user: a.id });
      if (off) sw.disabled = true;   // tools come with approval
      cell.append(el('span', 'app-label', SHORT[app.id] || appTitle(app.id)), sw);   // phones: the short name; the switch says it in full
      apps.append(cell);
    }
    li.append(person, role, status, apps);
    return li;
  }

  function renderAccounts() {
    $('#apps-head').replaceChildren(...S.apps.map(a => el('span', null, SHORT[a.id] || a.title)));
    $('#accounts').style.setProperty('--apps', String(S.apps.length || 1));
    $('#acct-list').replaceChildren(...listed().map(accountRow));
    filter();
    renderWaiting();
  }
  // New accounts waiting: who registered, when, and any role set up in advance for the address.
  function noted(a) {
    const r = a.request || {};
    if (!r.notedRole) return 'Nothing set up in advance';
    return `Set up in advance as ${ROLES[r.notedRole] || r.notedRole}${r.notedBy && r.notedBy.name ? ` by ${r.notedBy.name}` : ''}${r.notedAt ? ` on ${day(r.notedAt)}` : ''}`;
  }
  function waitRow(a) {
    const li = el('li', 'row row-static wait-row');
    li.dataset.id = a.id;
    const av = el('span', 'avatar', initials(nameOf(a))); av.setAttribute('aria-hidden', 'true');
    const main = el('span', 'row-main');
    main.append(el('span', 'row-title', nameOf(a)), el('span', 'row-sub', a.email), el('span', 'row-sub', `Registered ${when((a.request || {}).registeredAt)} · ${noted(a)}`));
    const actions = el('span', 'wait-actions');
    const ok = el('button', 'btn btn-small btn-tint', 'Check and approve'); ok.type = 'button'; ok.dataset.approve = a.id;
    ok.setAttribute('aria-label', `Check and approve ${nameOf(a)}`);
    const no = el('button', 'btn btn-small', 'Don’t approve'); no.type = 'button'; no.dataset.refuse = a.id;
    no.setAttribute('aria-label', `Don’t approve ${nameOf(a)}`);
    actions.append(ok, no);
    li.append(av, main, actions);
    return li;
  }
  function renderWaiting() {
    const w = waitingOf();
    $('#waiting-section').hidden = !w.length;
    $('#waiting-count').textContent = w.length ? `${w.length} waiting` : '';
    $('#wait-list').replaceChildren(...w.map(waitRow));
  }
  function filter() {
    const q = S.query.trim().toLowerCase();
    let shown = 0;
    for (const li of $('#acct-list').children) {
      const a = byId(li.dataset.id);
      const hit = !q || `${nameOf(a)} ${a.email}`.toLowerCase().includes(q);
      li.hidden = !hit; if (hit) shown++;
    }
    const n = listed().length;
    $('#accounts-count').textContent = q ? `${shown} of ${n}` : `${n} ${n === 1 ? 'account' : 'accounts'}`;
    $('#accounts-empty').hidden = shown > 0;
  }
  function replaceAccount(a) {
    const i = S.accounts.findIndex(x => x.id === a.id);
    if (i < 0) return;
    S.accounts[i] = a;
    const old = $(`#acct-list > li[data-id="${a.id}"]`);
    if (old && !a.waiting) { const row = accountRow(a); row.hidden = old.hidden; old.replaceWith(row); }
    if (openFor === a.id) fillSheet(a);
  }

  function renderSettings() {
    const s = S.settings;
    $('#reg-open').setAttribute('aria-checked', s.registrationOpen ? 'true' : 'false');
    $('#reg-open-sub').textContent = s.registrationOpen ? 'Anyone with the access code can register.' : 'Nobody can register until you switch this back on.';
    $('#code-status').textContent = s.accessCodeSet ? `Set${s.accessCodeSetAt ? ' ' + day(s.accessCodeSetAt) : ''}` : 'Not set: nobody can register';
    $('#code-status').classList.toggle('is-warn', !s.accessCodeSet);
    $('#defaults').replaceChildren(...S.apps.map(app => {
      const row = el('div', 'row row-static');
      const main = el('span', 'row-main'); main.append(el('span', 'row-title', appTitle(app.id)));
      row.append(main, switchEl((s.defaultApps || []).includes(app.id), `New accounts get ${appTitle(app.id)}`, { default: app.id }));
      return row;
    }));
  }

  function renderPre() {
    const list = $('#pre-list');
    if (!S.pre.length) { list.replaceChildren(el('p', 'empty', 'None. Everyone who registers starts as a User.')); return; }
    list.replaceChildren(...S.pre.map(p => {
      const row = el('div', 'row row-static pre-row');
      const main = el('span', 'row-main');
      const state = p.waiting ? `Registered ${when(p.claimedAt)}: waiting for you to approve` : p.registered ? 'Registered' : 'Not registered yet';
      main.append(el('span', 'row-title', p.email), el('span', 'row-sub', `${ROLES[p.role] || p.role} · ${state}`));
      const rm = el('button', 'btn btn-small', 'Remove');
      rm.type = 'button'; rm.dataset.unassign = p.email; rm.setAttribute('aria-label', `Remove the role assigned to ${p.email}`);
      row.append(main, rm);
      return row;
    }));
  }

  /* ---------------------------------------------------------------- loading */
  async function load() {
    const c = client();
    if (!c) return gate('Hub settings isn’t set up here', 'This copy of the Hub has no FLR sign-in settings.');
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) { location.replace(SIGN_IN); return; }
    try {
      const [acc, set, pre] = await Promise.all([call('admin_accounts'), call('admin_hub_settings'), call('admin_preassigned_roles')]);
      S.you = acc.you; S.apps = acc.apps || []; S.accounts = acc.accounts || []; S.settings = set; S.pre = pre || [];
    } catch (e) {
      const code = flrCode(e);
      if (code === 'FLR_SIGN_IN_REQUIRED' || expired(e)) { location.replace(SIGN_IN); return; }
      if (code === 'FLR_FORBIDDEN') return gate('For FLR Super Admins', 'Only Super Admins can open Hub settings. If you look after accounts, ask a Super Admin to make you one.');
      if (code === 'FLR_ACCOUNT_DISABLED') return gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
      if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
      if (missingFunction(e)) return gate('Not ready yet', 'Hub settings needs the latest update to the FLR database. Ask whoever looks after it to run the “app access” update, then try again.', { retry: true });
      return gate('Hub settings didn’t load', offline(e) ? 'Can’t reach the FLR database. Check your connection and try again.' : 'Something went wrong. Try again in a moment.', { retry: true });
    }
    $('#gate').hidden = true;
    $('#accounts-section').hidden = false; $('#registration-section').hidden = false;
    renderSettings(); renderAccounts(); renderPre();
    view('ready');
  }
  async function reloadAccounts() {
    const acc = await call('admin_accounts');
    S.you = acc.you; S.apps = acc.apps || []; S.accounts = acc.accounts || [];
    renderAccounts();
    if (openFor) { const a = byId(openFor); if (a) fillSheet(a); else sheets.close($('#sheet-account')); }
    if (approveFor) { const a = byId(approveFor); if (!a || !notApproved(a)) sheets.close($('#sheet-approve')); }
  }

  /* ---------------------------------------------------------------- giving and taking apps (the list and the account sheet) */
  async function toggleApp(btn) {
    const a = byId(btn.dataset.user), app = btn.dataset.app;
    if (!a || btn.getAttribute('aria-busy') === 'true') return;
    const on = btn.getAttribute('aria-checked') !== 'true';
    for (const b of document.querySelectorAll(`.switch[data-user="${a.id}"][data-app="${app}"]`)) { b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('aria-busy', 'true'); }
    try {
      const row = await call('admin_set_app_access', { p_user: a.id, p_app: app, p_allowed: on });
      replaceAccount(row);
      toast(`${appTitle(app)} ${on ? 'on' : 'off'} for ${nameOf(row)}`);
    } catch (e) {
      for (const b of document.querySelectorAll(`.switch[data-user="${a.id}"][data-app="${app}"]`)) b.setAttribute('aria-checked', on ? 'false' : 'true');
      toast(said(e));
      if (flrCode(e) === 'FLR_NOT_FOUND') reloadAccounts().catch(() => {});
    } finally {
      for (const b of document.querySelectorAll(`.switch[data-user="${a.id}"][data-app="${app}"]`)) b.removeAttribute('aria-busy');
    }
  }
  document.addEventListener('click', e => {
    const sw = e.target.closest('.switch[data-app][data-user]');
    if (sw) { if (!sw.disabled) toggleApp(sw); return; }
    const ap = e.target.closest('[data-approve]');
    if (ap) { openApprove(ap.dataset.approve); return; }
    const no = e.target.closest('[data-refuse]');
    if (no) { refuse(no.dataset.refuse); return; }
    const open = e.target.closest('[data-open]');
    if (open) openAccount(open.dataset.open);
  });
  $('#search').addEventListener('input', e => { S.query = e.target.value; filter(); });

  /* ---------------------------------------------------------------- one account */
  let openFor = '';
  function appNote(a, id) {
    if (id === 'speeding') return a.role === 'admin' ? 'Sees every driver, and links drivers to accounts' : a.role === 'manager' ? 'Sees every driver' : a.driver ? `Sees their own driving (${a.driver})` : 'Not linked to a FleetView driver, so it shows them nothing yet';
    if (id === 'annual-leave') return a.approver ? 'Leave approver: sees everyone’s leave' : 'Their own leave';
    if (id === 'fitters') return a.role === 'admin' || a.role === 'manager' ? 'Photos, plates and arrivals here; the schedule also needs the team passcode' : 'Photos and plates here; the schedule also needs the team passcode';
    if (id === 'estimator') return a.role === 'admin' ? 'Everything, including prices and rules' : a.role === 'manager' ? 'Builds, approves and reassigns quotes' : a.role === 'developer' ? 'Reads and exports quotes' : 'Builds and approves quotes';
    return '';
  }
  function fillSheet(a) {
    const self = a.id === S.you;
    $('#sa-initials').textContent = initials(nameOf(a));
    $('#sa-name').textContent = nameOf(a);
    $('#sa-email').textContent = a.email;
    $('#sa-meta').textContent = `Joined ${day(a.createdAt)} · ${seen(a.lastSeen)}`;
    const role = $('#sa-role');
    role.value = a.role; role.disabled = self;
    $('#sa-role-sub').textContent = self ? 'You can’t change your own role' : ROLE_NOTE[a.role] || '';
    const active = $('#sa-active');
    active.setAttribute('aria-checked', a.status === 'disabled' ? 'false' : 'true');
    active.disabled = self;
    $('#sa-active-sub').textContent = self ? 'You can’t switch off your own account' : a.status === 'disabled' ? 'Can’t sign in to the Hub or any app' : 'Can sign in';
    $('#sa-apps').replaceChildren(...S.apps.map(app => {
      const row = el('div', 'row row-static');
      const main = el('span', 'row-main');
      main.append(el('span', 'row-title', appTitle(app.id)), el('span', 'row-sub', appNote(a, app.id)));
      row.append(main, switchEl(a.apps.includes(app.id), `${appTitle(app.id)} for ${nameOf(a)}`, { app: app.id, user: a.id }));
      return row;
    }));
  }
  function openAccount(id) {
    const a = byId(id);
    if (!a) return;
    openFor = id; fillSheet(a);
    sheets.open($('#sheet-account'));
  }
  // A new role, from the person's sheet or the menu in their row. Both levels see other people's data (everyone's leave,
  // every driver), so making someone either is confirmed, as is taking one away.
  async function changeRole(a, role, select) {
    if (!a || role === a.role) return;
    const ask = role === 'admin' ? [`Make ${firstName(a)} a Super Admin?`, 'Super Admins look after every account, role and app, and every app’s settings, including the Cost Estimator’s prices and rules.', 'Make Super Admin', false]
      : role === 'manager' ? [`Make ${firstName(a)} an Admin?`, 'Admins approve leave and see everyone’s, see every driver’s driving and fitter arrivals, and reassign quotes. They can’t change any settings.', 'Make Admin', false]
      : a.role === 'admin' ? [`Take ${firstName(a)}’s Super Admin rights away?`, `${firstName(a)} will no longer be able to open Hub settings or change accounts and settings.`, 'Take away', true]
      : a.role === 'manager' ? [`Take ${firstName(a)}’s Admin rights away?`, `${firstName(a)} will no longer approve leave or see everyone’s leave, every driver or fitter arrivals.`, 'Take away', true] : null;
    if (ask && !(await confirmIt(...ask))) { select.value = a.role; return; }
    select.disabled = true;
    try { await call('admin_set_role', { p_user: a.id, p_role: role }); await reloadAccounts(); toast(`${nameOf(a)} is now ${AS[role] || role}`); }
    catch (err) { select.value = a.role; toast(said(err)); }
    finally { if (select.isConnected) select.disabled = a.id === S.you; }   // the row's menu is redrawn on reload
  }
  $('#sa-role').addEventListener('change', e => changeRole(byId(openFor), e.target.value, e.target));
  $('#acct-list').addEventListener('change', e => { const s = e.target.closest('select[data-role-for]'); if (s) changeRole(byId(s.dataset.roleFor), s.value, s); });
  $('#sa-active').addEventListener('click', async e => {
    const btn = e.currentTarget, a = byId(openFor);
    if (!a || btn.disabled || btn.getAttribute('aria-busy') === 'true') return;
    const on = a.status === 'disabled';
    if (!on && !(await confirmIt(`Switch off ${firstName(a)}’s account?`, 'They won’t be able to sign in to the Hub or any app until it’s switched back on. Nothing of theirs is deleted.', 'Switch off', true))) return;
    btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-checked', on ? 'true' : 'false');
    try { await call('admin_set_status', { p_user: a.id, p_status: on ? 'active' : 'disabled' }); await reloadAccounts(); toast(on ? `${nameOf(a)} switched back on` : `${nameOf(a)} switched off`); }
    catch (err) { btn.setAttribute('aria-checked', on ? 'false' : 'true'); toast(said(err)); }
    finally { btn.removeAttribute('aria-busy'); }
  });
  $('#sa-reset').addEventListener('click', async e => {
    const a = byId(openFor), btn = e.currentTarget;
    if (!a || btn.disabled) return;
    btn.disabled = true;
    try {
      const { error } = await client().auth.resetPasswordForEmail(a.email, { redirectTo: HUB });
      if (error) throw error;
      toast(`Reset email sent to ${a.email}`);
    } catch (err) { toast(offline(err) ? 'Can’t reach the FLR sign-in service. Check your connection.' : 'The reset email couldn’t be sent. Try again in a few minutes.'); }
    finally { btn.disabled = false; }
  });

  /* ---------------------------------------------------------------- a new account: check who it is, then approve */
  let approveFor = '';
  function apError(text) { const p = $('#ap-error'); p.querySelector('span').textContent = text; p.hidden = !text; }
  function apReady() {
    const how = document.querySelector('input[name="ap-how"]:checked');
    $('#ap-submit').disabled = !(how && $('#ap-note').value.trim().length >= 5 && $('#ap-tick').checked);
  }
  function apRole() {
    const a = byId(approveFor), v = $('#ap-role').value, r = (a && a.request) || {};
    $('#ap-role-sub').textContent = `${r.notedRole === v ? 'Set up in advance. ' : ''}${ROLE_NOTE[v] || ''}`;
    $('#ap-role-warn').hidden = v !== 'admin';
  }
  function fillApprove(a) {
    const r = a.request || {};
    $('#ap-title').textContent = `Approve ${firstName(a)}`;
    $('#ap-initials').textContent = initials(nameOf(a));
    $('#ap-name').textContent = nameOf(a);
    $('#ap-email').textContent = a.email;
    $('#ap-meta').textContent = `Registered ${when(r.registeredAt)} · name typed: ${(a.name || '').trim() || 'none'}`;
    $('#ap-refused').hidden = r.decision !== 'refused';
    for (const i of document.querySelectorAll('input[name="ap-how"]')) i.checked = false;
    $('#ap-note').value = ''; $('#ap-tick').checked = false;
    $('#ap-tick-label').textContent = `I’ve checked this is ${nameOf(a)}, using contact details FLR already holds.`;
    $('#ap-role').value = ROLES[r.notedRole] ? r.notedRole : 'estimator';
    apRole();
    // The tools: New accounts get, plus any already switched on for the address. Change them here if needed.
    const on = new Set([...((S.settings && S.settings.defaultApps) || []), ...(a.apps || [])]);
    $('#ap-apps').replaceChildren(...S.apps.map(app => {
      const row = el('div', 'row row-static');
      const main = el('span', 'row-main'); main.append(el('span', 'row-title', appTitle(app.id)));
      row.append(main, switchEl(on.has(app.id), `${appTitle(app.id)} for ${nameOf(a)}`, { apApp: app.id }));
      return row;
    }));
    apError(''); apReady();
  }
  function openApprove(id) {
    const a = byId(id);
    if (!a || !notApproved(a)) return;
    approveFor = id; fillApprove(a);
    sheets.open($('#sheet-approve'));
  }
  $('#approve-form').addEventListener('input', apReady);
  $('#approve-form').addEventListener('change', e => { if (e.target.id === 'ap-role') apRole(); apReady(); });
  $('#ap-apps').addEventListener('click', e => {
    const b = e.target.closest('.switch[data-ap-app]');
    if (b) b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
  });
  $('#approve-form').addEventListener('submit', async e => {
    e.preventDefault();
    const a = byId(approveFor), btn = $('#ap-submit');
    if (!a || btn.disabled || btn.getAttribute('aria-busy') === 'true') return;
    const how = document.querySelector('input[name="ap-how"]:checked').value, role = $('#ap-role').value;
    const apps = [...document.querySelectorAll('#ap-apps .switch[data-ap-app]')].filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.dataset.apApp);
    btn.setAttribute('aria-busy', 'true'); apError('');
    try {
      await call('admin_approve_account', { p_user: a.id, p_checked_how: how, p_check_note: $('#ap-note').value.trim(), p_role: role, p_apps: apps });
      sheets.close($('#sheet-approve'));
      await reloadAccounts();
      S.pre = await call('admin_preassigned_roles') || []; renderPre();
      toast(`${nameOf(a)} approved as ${AS[role] || role}, ${CHECKED[how]}`);
    } catch (err) { apError(said(err)); }
    finally { btn.removeAttribute('aria-busy'); }
  });
  async function refuse(id) {
    const a = byId(id);
    if (!a) return;
    if (!(await confirmIt(`Don’t approve ${firstName(a)}?`, 'Their account stays switched off and can’t use any tools. You can still approve it later from Accounts.', 'Don’t approve', true))) return;
    try { await call('admin_refuse_account', { p_user: a.id }); await reloadAccounts(); toast(`${nameOf(a)} not approved`); }
    catch (err) { toast(said(err)); }
  }
  $('#ap-refuse').addEventListener('click', () => { const id = approveFor; sheets.close($('#sheet-approve')); setTimeout(() => refuse(id), reduced() ? 0 : 300); });

  /* ---------------------------------------------------------------- registration */
  $('#reg-open').addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (btn.getAttribute('aria-busy') === 'true') return;
    const open = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-checked', open ? 'true' : 'false');
    try { await call('admin_set_registration', { p_open: open }); S.settings = await call('admin_hub_settings'); renderSettings(); toast(open ? 'Registration is open' : 'Registration is closed'); }
    catch (err) { btn.setAttribute('aria-checked', open ? 'false' : 'true'); toast(said(err)); }
    finally { btn.removeAttribute('aria-busy'); }
  });
  $('#defaults').addEventListener('click', async e => {
    const btn = e.target.closest('.switch[data-default]');
    if (!btn || btn.getAttribute('aria-busy') === 'true') return;
    const app = btn.dataset.default, on = btn.getAttribute('aria-checked') !== 'true';
    const next = S.apps.map(a => a.id).filter(id => id === app ? on : (S.settings.defaultApps || []).includes(id));
    btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-checked', on ? 'true' : 'false');
    try { S.settings = await call('admin_set_default_apps', { p_apps: next }); renderSettings(); toast(`New accounts ${on ? 'get' : 'don’t get'} ${appTitle(app)}`); }
    catch (err) { btn.setAttribute('aria-checked', on ? 'false' : 'true'); btn.removeAttribute('aria-busy'); toast(said(err)); }
  });
  $('#code-change').addEventListener('click', () => { $('#code-form').reset(); formError(''); sheets.open($('#sheet-code')); });
  $('#sc-show').addEventListener('click', e => {
    const f = $('#sc-code'), show = f.type === 'password';
    f.type = show ? 'text' : 'password'; e.currentTarget.textContent = show ? 'Hide' : 'Show';
  });
  function formError(text) { const p = $('#sc-error'); p.querySelector('span').textContent = text; p.hidden = !text; }
  $('#code-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('button[type="submit"]'), code = $('#sc-code').value;
    if (btn.getAttribute('aria-busy') === 'true') return;
    if (code.trim().length < 12) { formError('Use at least 12 characters.'); $('#sc-code').focus(); return; }
    formError(''); btn.setAttribute('aria-busy', 'true');
    try {
      await call('admin_set_access_code', { p_code: code });
      S.settings = await call('admin_hub_settings'); renderSettings();
      sheets.close($('#sheet-code'));
      toast('New access code set: share it with staff in person');
    } catch (err) { formError(said(err)); }
    finally { btn.removeAttribute('aria-busy'); }
  });
  $('#pre-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#pre-email').value.trim().toLowerCase(), role = $('#pre-role').value;
    if (!EMAIL.test(email)) { toast('Enter a valid email address'); $('#pre-email').focus(); return; }
    const btn = e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      S.pre = await call('admin_set_preassigned_role', { p_email: email, p_role: role }) || [];
      renderPre(); $('#pre-email').value = '';
      await reloadAccounts();
      const p = S.pre.find(x => x.email === email) || {};
      toast(p.waiting ? `${email} will be ${AS[role] || role} once you approve them` : p.registered ? `${email} is now ${AS[role] || role}` : `${email} will be ${AS[role] || role} once they register and you approve them`);
    } catch (err) { toast(said(err)); }
    finally { btn.disabled = false; }
  });
  $('#pre-list').addEventListener('click', async e => {
    const btn = e.target.closest('[data-unassign]');
    if (!btn) return;
    btn.disabled = true;
    try { S.pre = await call('admin_remove_preassigned_role', { p_email: btn.dataset.unassign }) || []; renderPre(); toast('Removed'); }
    catch (err) { btn.disabled = false; toast(said(err)); }
  });

  /* ---------------------------------------------------------------- sheets and the confirmation */
  const sheets = {
    open(d) {
      if (d.open) return;
      d.showModal();
      document.documentElement.classList.add('sheet-open');
      requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('open')));
      // A sheet to type in (the access code) starts in its field; the others leave focus where the dialog puts it, so a
      // click doesn't ring the role menu, and a confirmation starts on Cancel.
      const first = d.querySelector('input');
      if (first && !matchMedia('(pointer: coarse)').matches) setTimeout(() => first.focus({ preventScroll: true }), reduced() ? 0 : 60);
    },
    close(d) {
      if (!d.open) return;
      d.classList.remove('open');
      const done = () => { if (!d.classList.contains('open') && d.open) d.close(); };
      if (reduced()) done(); else setTimeout(done, 420);
    },
  };
  for (const d of document.querySelectorAll('dialog.sheet')) {
    d.addEventListener('cancel', e => { e.preventDefault(); sheets.close(d); });
    d.addEventListener('close', () => {
      if (!document.querySelector('dialog.sheet[open]')) document.documentElement.classList.remove('sheet-open');
      if (d.id === 'sheet-account') openFor = '';
      if (d.id === 'sheet-approve') approveFor = '';
      if (d.id === 'sheet-confirm' && confirming) { confirming(false); confirming = null; }
    });
    d.addEventListener('click', e => { if (e.target.closest('[data-close]')) sheets.close(d); });
  }
  let confirming = null;
  function confirmIt(title, text, ok, danger) {
    if (confirming) confirming(false);
    $('#cf-title').textContent = title; $('#cf-text').textContent = text;
    const b = $('#cf-ok'); b.textContent = ok; b.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    return new Promise(res => {
      confirming = res;
      sheets.open($('#sheet-confirm'));
      setTimeout(() => $('#cf-cancel').focus({ preventScroll: true }), 30);   // the safe answer has focus
    });
  }
  $('#cf-ok').addEventListener('click', () => { const r = confirming; confirming = null; sheets.close($('#sheet-confirm')); if (r) r(true); });

  /* ---------------------------------------------------------------- small things */
  let toastTimer = 0;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    if (!reduced()) t.animate([{ opacity: 0, transform: 'translate(-50%, 12px) scale(.96)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.25,1)' });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (reduced()) { t.hidden = true; return; }
      const a = t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
      a.onfinish = () => { t.hidden = true; a.cancel(); };
    }, 2600);
  }
  // The bar's material and the small title come in as the page scrolls under it.
  let raf = 0;
  addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; $('#bar').style.setProperty('--bar-mat', Math.min(1, Math.max(0, (scrollY - 20) / 30)).toFixed(3)); });
  }, { passive: true });
  $('#gate-retry').addEventListener('click', () => { $('#gate-message').hidden = true; view('loading'); load(); });
  document.addEventListener('touchstart', () => {}, { passive: true });   // iOS: press feedback starts on touch-down
  addEventListener('pagereveal', e => { const t = e.viewTransition; if (t) { t.ready.catch(() => {}); t.finished.catch(() => {}); t.updateCallbackDone.catch(() => {}); } });

  function start() {
    const c = client();
    if (c) c.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') setTimeout(() => location.replace(SIGN_IN), 0); });
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
