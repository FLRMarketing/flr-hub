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
  const ICONS = { estimator: 'i-estimator', speeding: 'i-speeding', 'annual-leave': 'i-leave', fitters: 'i-fitters', orders: 'i-orders', capacity: 'i-capacity', proximity: 'i-proximity', warehouse: 'i-warehouse', surveyors: 'i-surveyors' };   // as on the Hub home
  const STATUS = { active: 'Active', disabled: 'Switched off' };
  const SHORT = { estimator: 'Estimator', speeding: 'Fleet', 'annual-leave': 'Leave', fitters: 'Fitters', orders: 'Orders', capacity: 'Planner', proximity: 'Nearby', warehouse: 'Warehouse', surveyors: 'Surveys' };
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
    if (code === 'FLR_VALIDATION' && e.details) return /[.!?]$/.test(e.details) ? e.details : e.details + '.';
    if (code === 'FLR_FORBIDDEN') return 'Only FLR Super Admins can do that.';
    if (code === 'FLR_NOT_FOUND') return 'That account no longer exists. The list has been refreshed.';
    if (code === 'FLR_ACCOUNT_DISABLED') return 'Your FLR account is switched off.';
    if (expired(e) || code === 'FLR_SIGN_IN_REQUIRED') return 'Your sign-in has expired. Sign in again.';
    return 'That didn’t work. Try again.';
  }

  /* ---------------------------------------------------------------- state */
  const S = { you: '', apps: [], accounts: [], settings: null, pre: [], query: '',
    // People & access: which view, who or which app is open, and the drafts (account id -> { role, status, apps: { app: on } }),
    // kept until Save changes. Nothing in a draft has reached the database.
    mode: 'people', person: '', app: '', open: false, draft: new Map(), saving: false, error: '', saved: '',
    photos: {},
    // Teams (Hub migration 2.8): null until the database has them (the Teams tab stays hidden); drafts as for accounts.
    teams: null, team: '', teamFilter: '', tdraft: new Map(), newSeq: 0 };   // account id -> staff photo (Hub migration 2.5); none, initials
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
    $('#accounts-section').hidden = true; $('#registration-section').hidden = true; $('#jeff-section').hidden = true; $('#waiting-section').hidden = true;
  }

  function switchEl(on, label, data) {
    const b = el('button', 'switch');
    b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', on ? 'true' : 'false');
    if (label) b.setAttribute('aria-label', label);
    for (const [k, v] of Object.entries(data || {})) b.dataset[k] = v;
    b.append(el('span', 'knob'));
    return b;
  }

  const svgUse = (id, cls) => { const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); n.setAttribute('aria-hidden', 'true'); if (cls) n.setAttribute('class', cls);
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); n.append(u); return n; };
  // The everyday websites (Hub migration 2.6): their own mark on their colour, a small app icon, from ../web-apps.js.
  const webLogo = id => { const w = (Array.isArray(window.FLR_WEB_APPS) ? window.FLR_WEB_APPS : []).find(x => x && x.id === id);
    return w && /^assets\/web-apps\/[a-z0-9-]+\.(svg|png)$/.test(w.logo || '') ? '../' + w.logo : ''; };
  function webIcon(id, cls) {
    const box = el('span', `${cls} pa-web app-icon--${id}`); box.setAttribute('aria-hidden', 'true');
    const img = el('img'); img.src = webLogo(id); img.alt = ''; box.append(img);
    return box;
  }
  const appIcon = id => !ICONS[id] && webLogo(id) ? webIcon(id, 'pa-icon') : svgUse(ICONS[id] || 'i-tile', 'pa-icon');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const roleName = r => ROLES[r] || r;
  const isPhone = () => matchMedia('(max-width: 760px)').matches;

  /* ---------------------------------------------------------------- People & access: drafts */
  // What the page shows for an account: the database's values with this page's unsaved changes on top.
  function shown(a) {
    const d = S.draft.get(a.id), apps = new Set(a.apps);
    if (d) for (const [id, on] of Object.entries(d.apps)) { if (on) apps.add(id); else apps.delete(id); }
    return { role: d && d.role !== undefined ? d.role : a.role, status: d && d.status !== undefined ? d.status : a.status, apps };
  }
  // One change to the draft. A change back to what the database has isn't a change any more.
  function edit(a, what) {
    if (!a || notApproved(a) || S.saving) return;
    const d = S.draft.get(a.id) || { apps: {} };
    if ('role' in what) { if (what.role === a.role) delete d.role; else d.role = what.role; }
    if ('status' in what) { if (what.status === a.status) delete d.status; else d.status = what.status; }
    if ('app' in what) { if (what.on === a.apps.includes(what.app)) delete d.apps[what.app]; else d.apps[what.app] = what.on; }
    if (d.role === undefined && d.status === undefined && !Object.keys(d.apps).length) S.draft.delete(a.id); else S.draft.set(a.id, d);
    S.error = ''; S.saved = '';
    render();
  }
  // Every unsaved change, in the order Save sends them: per person, the role, then on or off, then their apps.
  function changes() {
    const out = [];
    for (const a of listed()) {
      const d = S.draft.get(a.id);
      if (!d) continue;
      if (d.role !== undefined) out.push({ a, kind: 'role', value: d.role, from: a.role });
      if (d.status !== undefined) out.push({ a, kind: 'status', value: d.status, from: a.status });
      for (const app of S.apps) if (app.id in d.apps) out.push({ a, kind: 'app', app: app.id, value: d.apps[app.id] });
    }
    return out;
  }
  // After the accounts are read again: drop drafts that now match the database, and any for accounts that have gone
  // (or aren't approved any more). Returns how many changes were dropped because their account had gone.
  function prune() {
    let gone = 0;
    for (const [id, d] of [...S.draft]) {
      const a = byId(id);
      const n = (d.role !== undefined) + (d.status !== undefined) + Object.keys(d.apps).length;
      if (!a || a.waiting || notApproved(a)) { S.draft.delete(id); gone += n; continue; }
      if (d.role === a.role) delete d.role;
      if (d.status === a.status) delete d.status;
      for (const [app, on] of Object.entries(d.apps)) if (on === a.apps.includes(app) || !S.apps.some(x => x.id === app)) delete d.apps[app];
      if (d.role === undefined && d.status === undefined && !Object.keys(d.apps).length) S.draft.delete(id);
    }
    return gone;
  }
  /* ---------------------------------------------------------------- Teams (Hub migration 2.8): what people do at FLR */
  // A team is a name, a colour, a few words and its members; someone can be in several. Teams only organise this page
  // (filter people, give a team an app as ordinary per-person ticks); they never grant anything themselves.
  const TEAM_COLOURS = [['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow'], ['orange', 'Orange'], ['red', 'Red'], ['pink', 'Pink'], ['purple', 'Purple'], ['cyan', 'Cyan'], ['coral', 'Coral']];
  const colourName = c => (TEAM_COLOURS.find(x => x[0] === c) || [c, c])[1];
  const serverTeam = id => (S.teams || []).find(t => t.id === id);
  const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  // A team as the page shows it: the database's, with this page's unsaved changes on top (or a new one, not saved yet).
  function teamShown(id) {
    const s = serverTeam(id), d = S.tdraft.get(id) || {};
    if (!s && !d.isNew) return null;
    return { id, isNew: !!d.isNew, deleted: !!d.deleted,
      name: d.name !== undefined ? d.name : s.name, colour: d.colour !== undefined ? d.colour : s.colour,
      description: d.description !== undefined ? d.description : (s ? s.description : ''),
      members: new Set(d.members !== undefined ? d.members : (s ? s.members : [])) };
  }
  const teamIds = () => [...(S.teams || []).map(t => t.id), ...[...S.tdraft].filter(([, d]) => d.isNew).map(([id]) => id)];
  const allTeams = () => teamIds().map(teamShown).filter(t => t && !t.deleted);
  const teamsOf = uid => allTeams().filter(t => t.members.has(uid));
  function editTeam(id, what, o = {}) {
    if (S.saving) return;
    const s = serverTeam(id), d = S.tdraft.get(id) || {};
    if (!s && !d.isNew) return;
    for (const k of ['name', 'colour', 'description']) if (k in what) { if (s && what[k] === s[k]) delete d[k]; else d[k] = what[k]; }
    if ('members' in what) { const m = [...what.members]; if (s && sameSet(m, s.members)) delete d.members; else d.members = m; }
    if ('deleted' in what) { if (what.deleted) d.deleted = true; else delete d.deleted; }
    if (!d.isNew && !Object.keys(d).length) S.tdraft.delete(id); else S.tdraft.set(id, d);
    S.error = ''; S.saved = '';
    render(o);
  }
  function setMember(teamId, uid, on) {
    const t = teamShown(teamId); if (!t) return;
    if (on) t.members.add(uid); else t.members.delete(uid);
    editTeam(teamId, { members: t.members });
  }
  function newTeam() {
    if (S.saving) return;
    const used = new Set(allTeams().map(t => t.colour));
    const colour = (TEAM_COLOURS.find(([c]) => !used.has(c)) || TEAM_COLOURS[0])[0];
    const id = `new-${++S.newSeq}`;
    S.tdraft.set(id, { isNew: true, name: '', colour, description: '', members: [] });
    S.team = id; S.error = ''; S.saved = '';
    render(); openDetail();
    const n = $('#pa-team-name'); if (n) n.focus({ preventScroll: isPhone() });
  }
  // Every unsaved team change, in the order Save sends them; n is how many it counts as.
  function teamOps() {
    const out = [];
    for (const id of teamIds()) {
      const t = teamShown(id), s = serverTeam(id), d = S.tdraft.get(id);
      if (!d) continue;
      if (d.isNew) { out.push({ kind: 'team-new', id, t, n: 1 + t.members.size }); continue; }
      if (d.deleted) { out.push({ kind: 'team-delete', id, t: { ...t, name: s.name }, n: 1 }); continue; }
      if (['name', 'colour', 'description'].some(k => d[k] !== undefined)) out.push({ kind: 'team-details', id, t, n: ['name', 'colour', 'description'].filter(k => d[k] !== undefined).length });
      if (d.members !== undefined) {
        const add = d.members.filter(x => !s.members.includes(x)), remove = s.members.filter(x => !d.members.includes(x));
        if (add.length + remove.length) out.push({ kind: 'team-members', id, t, n: add.length + remove.length });
      }
    }
    return out;
  }
  // After the teams are read again: drop drafts that now match, and any for teams that have gone.
  function pruneTeams() {
    for (const [id, d] of [...S.tdraft]) {
      if (d.isNew) continue;
      const s = serverTeam(id);
      if (!s) { S.tdraft.delete(id); continue; }
      for (const k of ['name', 'colour', 'description']) if (d[k] === s[k]) delete d[k];
      if (d.members !== undefined) { d.members = d.members.filter(x => byId(x)); if (sameSet(d.members, s.members)) delete d.members; }
      if (!Object.keys(d).length) S.tdraft.delete(id);
    }
  }
  const dirty = () => changes().length + teamOps().reduce((n, o) => n + o.n, 0);

  /* ---------------------------------------------------------------- People & access: drawing */
  // A person's staff photo (the Annual Leave one, matched by email in the database), or their initials. Accounts that
  // aren't approved never show one: the photo would be whoever the address belongs to, not who registered.
  function avatarOf(a) {
    const src = !notApproved(a) && S.photos[a.id];
    const av = el('span', 'pa-avatar' + (src ? ' has-photo' : ''));
    av.setAttribute('aria-hidden', 'true');
    if (src && /^data:image\/jpeg;base64,/.test(src)) { const img = el('img'); img.alt = ''; img.decoding = 'async'; img.src = src; av.append(img); }
    else av.textContent = initials(nameOf(a));
    return av;
  }
  const statusOf = (a, sh) => notApproved(a) ? ['Not approved', 'is-unapproved'] : sh.status === 'disabled' ? [STATUS.disabled, 'is-off'] : [STATUS.active, 'is-active'];
  function metaLine(a, sh) {
    const m = el('span', 'pa-meta');
    const [label, cls] = statusOf(a, sh);
    m.append(el('span', null, roleName(sh.role)), el('span', 'pa-dot', '·'), el('span', 'pa-status ' + cls, label));
    return m;
  }
  function nameLine(a, tag) {
    const n = el(tag || 'span', 'pa-name');
    n.append(el('span', null, nameOf(a)));
    if (a.id === S.you) n.append(el('span', 'pa-you', 'You'));
    if (S.draft.has(a.id)) n.append(el('span', 'pa-edited', 'Unsaved'));
    return n;
  }
  const matches = a => { const q = S.query.trim().toLowerCase(); return !q || `${nameOf(a)} ${a.email}`.toLowerCase().includes(q); };

  function personRow(a) {
    const sh = shown(a), n = sh.apps.size;
    const b = el('button', 'pa-row');
    b.type = 'button'; b.dataset.person = a.id; b.dataset.focus = 'person:' + a.id;
    if (a.id === S.person && (S.open || !isPhone())) b.setAttribute('aria-current', 'true');   // phones: nobody is open until tapped
    const av = avatarOf(a);
    const text = el('span');
    text.append(nameLine(a), el('span', 'pa-email', a.email), metaLine(a, sh));
    const chips = teamChips(a.id); if (chips) text.append(chips);
    const count = el('span', 'pa-count'); count.append(el('strong', null, String(n)), ` ${n === 1 ? 'app' : 'apps'}`);
    b.append(av, text, count, svgUse('i-chevron', 'pa-chev'));
    b.hidden = !matches(a) || (S.teamFilter && !(teamShown(S.teamFilter) || { members: new Set() }).members.has(a.id));
    return b;
  }
  function teamChip(t) { const c = el('span', `pa-chip tc-${t.colour}`, t.name || 'New team'); return c; }
  function teamChips(uid) {
    const ts = teamsOf(uid);
    if (!ts.length) return null;
    const box = el('span', 'pa-chips');
    box.append(...ts.slice(0, 3).map(teamChip));
    if (ts.length > 3) box.append(el('span', 'pa-chip pa-chip-more', `+${ts.length - 3}`));
    return box;
  }
  function teamRow(t) {
    const b = el('button', `pa-row pa-team-row tc-${t.colour}`);
    b.type = 'button'; b.dataset.teamPick = t.id; b.dataset.focus = 'team:' + t.id;
    if (t.id === S.team && (S.open || !isPhone())) b.setAttribute('aria-current', 'true');
    const dot = el('span', 'pa-team-dot'); dot.setAttribute('aria-hidden', 'true');
    const text = el('span');
    const nm = el('span', 'pa-name'); nm.append(el('span', null, t.name || 'New team'));
    if (S.tdraft.has(t.id)) nm.append(el('span', 'pa-edited', t.isNew ? 'New' : 'Unsaved'));
    text.append(nm);
    if (t.description) text.append(el('span', 'pa-email', t.description));
    const n = t.members.size;
    b.append(dot, text, el('span', 'pa-count', plural(n, 'person', 'people')), svgUse('i-chevron', 'pa-chev'));
    b.setAttribute('aria-label', `${t.name || 'New team'}: ${plural(n, 'person', 'people')}`);
    return b;
  }
  function appRow(app) {
    const people = listed().filter(a => shown(a).apps.has(app.id)).length;
    const b = el('button', 'pa-row pa-app-row');
    b.type = 'button'; b.dataset.appPick = app.id; b.dataset.focus = 'app:' + app.id;
    if (app.id === S.app && (S.open || !isPhone())) b.setAttribute('aria-current', 'true');
    const nm = el('span', 'pa-name', appTitle(app.id));
    const text = el('span'); text.append(nm);
    if (app.active === false) text.append(el('span', 'pa-email', 'Not shown on the Hub at the moment'));
    b.append(appIcon(app.id), text, el('span', 'pa-count', plural(people, 'person', 'people')));
    b.setAttribute('aria-label', `${appTitle(app.id)}: ${plural(people, 'person has', 'people have')} access`);
    return b;
  }

  function backButton(label) {
    const b = el('button', 'pa-back'); b.type = 'button'; b.dataset.back = '1';
    b.append(svgUse('i-arrow-left'), el('span', null, label));
    return b;
  }
  function selectField(label, id, options, value, o) {
    const wrap = el('label', 'pa-field');
    wrap.append(el('span', 'pa-label', label));
    const box = el('span', 'pa-select' + (o.changed ? ' is-changed' : ''));
    const sel = el('select'); sel.id = id; sel.dataset.focus = id;
    for (const [v, t] of options) { const op = el('option', null, t); op.value = v; sel.append(op); }
    if (!options.some(([v]) => v === value)) { const op = el('option', null, value); op.value = value; sel.append(op); }   // a value this page doesn't know yet
    sel.value = value; sel.disabled = !!o.disabled;
    if (o.title) box.title = o.title;
    box.append(sel); wrap.append(box);
    return wrap;
  }
  function checkRow(o) {
    const row = el('label', 'pa-check' + (o.disabled ? ' is-disabled' : ''));
    const main = el('span', 'pa-check-main');
    if (o.icon) main.append(o.icon);
    const text = el('span', 'pa-check-text');
    const title = el('span', null, o.title);
    if (o.changed) title.append(el('span', 'pa-unsaved', 'Unsaved'));
    text.append(title);
    if (o.extra) text.append(...o.extra);
    main.append(text);
    const box = el('input'); box.type = 'checkbox'; box.checked = o.checked; box.disabled = !!o.disabled;
    for (const [k, v] of Object.entries(o.data)) box.dataset[k] = v;
    box.setAttribute('aria-label', o.label);
    row.append(main, box);
    return row;
  }

  // What an app gives this person, by their role (the draft role in the editor).
  function appNote(a, id) {
    if (id === 'speeding') return a.role === 'admin' ? 'Sees every driver, and links drivers to accounts' : a.role === 'manager' ? 'Sees every driver' : a.driver ? `Sees their own driving (${a.driver})` : 'Not linked to a FleetView driver, so it shows them nothing yet';
    if (id === 'annual-leave') return a.approver || a.role === 'admin' || a.role === 'manager' ? 'Leave approver: sees everyone’s leave' : 'Their own leave';
    if (id === 'fitters') return a.role === 'admin' || a.role === 'manager' ? 'Photos, plates and arrivals here; the schedule also needs the team passcode' : 'Photos and plates here; the schedule also needs the team passcode';
    if (id === 'orders') return 'Deliveries from the Monday Goods In board, read-only';
    if (id === 'capacity') return 'Fitters booked each day from the Monday Work Programme';
    if (id === 'proximity') return 'The nearest surveyor to a site postcode; live vehicle positions for Admins';
    if (id === 'warehouse') return 'Ticks off the warehouse checklist; ticks go to Monday';
    if (id === 'surveyors') return 'Who’s surveying where, from HubSpot, read-only';
    if (['outlook', 'monday', 'hubspot', 'sharepoint'].includes(id)) return 'Shows it on their Hub. The website has its own sign-in';
    if (id === 'estimator') return a.role === 'admin' ? 'Everything, including prices and rules' : a.role === 'manager' ? 'Builds, approves and reassigns quotes' : a.role === 'developer' ? 'Reads and exports quotes' : 'Builds and approves quotes';
    return '';
  }

  // One person: role, on or off, and a checklist of the apps.
  function personDetail(a) {
    const sh = shown(a), self = a.id === S.you, off = notApproved(a), d = S.draft.get(a.id) || { apps: {} };
    const box = document.createDocumentFragment();
    box.append(backButton('All people'));
    const top = el('div', 'pa-top');
    const av = avatarOf(a);
    const who = el('div'); who.style.minWidth = '0';
    const h = el('h3', 'pa-title', nameOf(a)); h.id = 'pa-detail-title'; h.tabIndex = -1;
    who.append(h, el('span', 'pa-email', a.email), el('p', 'pa-seen', `Joined ${day(a.createdAt)} · ${seen(a.lastSeen)}`));
    top.append(av, who);
    box.append(top);
    if (off) {
      const lock = el('div', 'pa-lock');
      lock.append(el('p', 'pa-note', (a.request || {}).decision === 'refused' ? 'This account wasn’t approved, so it stays switched off with no apps. Approving it checks who it is first, then gives a role and apps.' : 'This account is waiting for approval. Approving it checks who it is first, then gives a role and apps.'));
      const go = el('button', 'pa-btn', 'Check and approve'); go.type = 'button'; go.dataset.approve = a.id;
      lock.append(go);
      box.append(lock);
    }
    const fields = el('div', 'pa-fields');
    fields.append(
      selectField('Role', 'pa-role', ['estimator', 'manager', 'admin', 'developer'].map(r => [r, ROLES[r]]), sh.role,
        { disabled: self || off, changed: d.role !== undefined, title: self ? 'You can’t change your own role' : off ? 'Approve this account first' : '' }),
      selectField('Account status', 'pa-status', off ? [[a.status, 'Not approved']] : Object.entries(STATUS), sh.status,
        { disabled: self || off, changed: d.status !== undefined, title: self ? 'You can’t switch off your own account' : off ? 'Approve this account first' : '' }));
    box.append(fields);
    box.append(el('p', 'pa-note', self ? 'You can’t change your own role or switch off your own account. Another Super Admin can.'
      : off ? '' : `${ROLE_NOTE[sh.role] || ''}${sh.status === 'disabled' ? '. Switched off: can’t sign in to the Hub or any app.' : ''}`));
    if (S.teams) {
      const ts = allTeams(), mine = teamsOf(a.id).length;
      const th = el('div', 'pa-access-title');
      th.append(el('strong', null, 'Teams'), el('span', null, ts.length ? `${mine} of ${ts.length}` : ''));
      box.append(th);
      if (!ts.length) box.append(el('p', 'pa-note', 'No teams yet. Make one under Teams to group people by what they do.'));
      else {
        const wrap = el('div', 'pa-team-toggles'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', `Teams for ${nameOf(a)}`);
        for (const t of ts) {
          const on = t.members.has(a.id);
          const b = el('button', `pa-toggle tc-${t.colour}`); b.type = 'button';
          b.setAttribute('aria-pressed', String(on)); b.dataset.teamToggle = t.id; b.dataset.user = a.id; b.dataset.focus = `tt:${a.id}:${t.id}`;
          b.append(el('span', 'pa-team-dot'), el('span', null, t.name || 'New team'));
          b.setAttribute('aria-label', `${t.name || 'New team'}${on ? ', in this team' : ''}`);
          wrap.append(b);
        }
        box.append(wrap);
      }
    }
    const head = el('div', 'pa-access-title');
    head.append(el('strong', null, 'App access'), el('span', null, `${sh.apps.size} of ${S.apps.length} enabled`));
    box.append(head);
    const list = el('div'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', `Apps for ${nameOf(a)}`);
    for (const app of S.apps) {
      list.append(checkRow({ icon: appIcon(app.id), title: appTitle(app.id), extra: [el('span', 'pa-check-sub', appNote({ ...a, role: sh.role }, app.id))],
        checked: sh.apps.has(app.id), disabled: off, changed: app.id in d.apps, label: `${appTitle(app.id)} for ${nameOf(a)}`,
        data: { user: a.id, app: app.id, focus: `check:${a.id}:${app.id}` } }));
    }
    box.append(list);
    const foot = el('div', 'pa-foot-note');
    foot.append(el('p', 'pa-note', 'Role controls administration. App access controls which apps this person can open.'));
    const reset = el('button', 'pa-link pa-reset', 'Send a password reset email'); reset.type = 'button'; reset.dataset.reset = a.id;
    if (!off) foot.append(reset);
    box.append(foot);
    return box;
  }
  // One app: everyone (or everyone the search finds) with a box each.
  function appDetail(app) {
    const box = document.createDocumentFragment();
    box.append(backButton('All apps'));
    const people = listed(), withIt = people.filter(a => shown(a).apps.has(app.id)).length;
    const top = el('div', 'pa-top');
    const badge = el('span', 'pa-app-badge'); badge.append(!ICONS[app.id] && webLogo(app.id) ? webIcon(app.id, 'pa-badge-web') : svgUse(ICONS[app.id] || 'i-tile'));
    const who = el('div');
    const h = el('h3', 'pa-title', appTitle(app.id)); h.id = 'pa-detail-title'; h.tabIndex = -1;
    who.append(h, el('span', 'pa-email', `${plural(withIt, 'person has', 'people have')} access`));
    top.append(badge, who);
    box.append(top);
    const head = el('div', 'pa-access-title');
    head.append(el('strong', null, 'People with access'), el('span', null, 'Enable individually'));
    box.append(head);
    const hits = people.filter(matches);
    if (!hits.length) { box.append(el('p', 'pa-empty', 'No account matches that search.')); return box; }
    const list = el('div'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', `People with ${appTitle(app.id)}`);
    for (const a of hits) {
      const sh = shown(a), d = S.draft.get(a.id) || { apps: {} }, off = notApproved(a);
      const row = checkRow({ title: '', extra: [], checked: sh.apps.has(app.id), disabled: off, changed: false,
        label: `${appTitle(app.id)} for ${nameOf(a)}`, data: { user: a.id, app: app.id, focus: `check:${a.id}:${app.id}` } });
      row.classList.add('pa-member');
      const text = row.querySelector('.pa-check-text');
      text.replaceChildren(nameLineFor(a, app.id in d.apps), el('span', 'pa-email', a.email), metaLine(a, sh));
      if (off) row.title = 'Approve this account first';
      list.append(row);
    }
    box.append(list);
    return box;
  }
  // One team: its name, few words and colour, its members, "give this team an app", and Delete.
  function teamDetail(t) {
    const box = document.createDocumentFragment();
    box.append(backButton('All teams'));
    const top = el('div', `pa-top tc-${t.colour}`);
    const orb = el('span', 'pa-team-orb'); orb.setAttribute('aria-hidden', 'true');
    const who = el('div'); who.style.minWidth = '0';
    const h = el('h3', 'pa-title', t.name || 'New team'); h.id = 'pa-detail-title'; h.tabIndex = -1;
    who.append(h, el('span', 'pa-email', `${plural(t.members.size, 'person', 'people')}${t.isNew ? ' · not saved yet' : ''}`));
    top.append(orb, who);
    box.append(top);
    if (t.deleted) return box;
    const nameF = el('label', 'pa-field pa-wide'); nameF.append(el('span', 'pa-label', 'Name'));
    const ni = el('input', 'pa-input'); ni.id = 'pa-team-name'; ni.dataset.focus = 'pa-team-name'; ni.maxLength = 40; ni.value = t.name; ni.placeholder = 'Surveyors, Fitters, Office…'; ni.autocomplete = 'off';
    nameF.append(ni);
    const descF = el('label', 'pa-field pa-wide'); descF.append(el('span', 'pa-label', 'What they do (optional)'));
    const di = el('input', 'pa-input'); di.id = 'pa-team-desc'; di.dataset.focus = 'pa-team-desc'; di.maxLength = 160; di.value = t.description; di.autocomplete = 'off';
    descF.append(di);
    box.append(nameF, descF);
    const ch = el('div', 'pa-field pa-wide'); ch.append(el('span', 'pa-label', 'Colour'));
    const sw = el('div', 'pa-swatches'); sw.setAttribute('role', 'radiogroup'); sw.setAttribute('aria-label', 'Team colour');
    for (const [c, label] of TEAM_COLOURS) {
      const b = el('button', `pa-swatch tc-${c}`); b.type = 'button'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(c === t.colour)); b.tabIndex = c === t.colour ? 0 : -1;
      b.setAttribute('aria-label', label); b.title = label; b.dataset.colour = c; b.dataset.focus = 'swatch:' + c;
      sw.append(b);
    }
    ch.append(sw, el('span', 'pa-swatch-name', colourName(t.colour)));
    box.append(ch);
    // Give everyone in the team an app: ordinary per-person ticks, saved with everything else.
    const give = el('div', 'pa-give');
    const gl = el('label', 'pa-field'); gl.append(el('span', 'pa-label', 'Give everyone in this team an app'));
    const gs = el('span', 'pa-select'); const sel = el('select'); sel.id = 'pa-team-app'; sel.dataset.focus = 'pa-team-app';
    for (const app of S.apps) { const op = el('option', null, appTitle(app.id)); op.value = app.id; sel.append(op); }
    if (S.giveApp && S.apps.some(x => x.id === S.giveApp)) sel.value = S.giveApp;
    gs.append(sel); gl.append(gs);
    const gb = el('button', 'pa-btn', 'Tick for the team'); gb.type = 'button'; gb.dataset.teamGive = t.id; gb.disabled = !t.members.size;
    give.append(gl, gb);
    box.append(give);
    if (S.teamMsg) box.append(el('p', 'pa-note pa-give-note', S.teamMsg));
    const people = listed(), hits = people.filter(matches);
    const head = el('div', 'pa-access-title');
    head.append(el('strong', null, 'Members'), el('span', null, `${t.members.size} of ${people.length}`));
    box.append(head);
    if (!hits.length) box.append(el('p', 'pa-empty', 'No account matches that search.'));
    const list = el('div'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', `Members of ${t.name || 'the new team'}`);
    const s = serverTeam(t.id);
    for (const a of hits) {
      const changed = s ? t.members.has(a.id) !== s.members.includes(a.id) : t.members.has(a.id);
      const row = checkRow({ title: '', extra: [], checked: t.members.has(a.id), changed: false, label: `${nameOf(a)} in ${t.name || 'the new team'}`,
        data: { teamMember: t.id, user: a.id, focus: `tm:${t.id}:${a.id}` } });
      row.classList.add('pa-member');
      row.querySelector('.pa-check-text').replaceChildren(nameLineFor(a, changed), el('span', 'pa-email', a.email), metaLine(a, shown(a)));
      list.append(row);
    }
    box.append(list);
    const foot = el('div', 'pa-foot-note');
    foot.append(el('p', 'pa-note', 'Teams organise people here. They don’t give anyone apps on their own: “Tick for the team” ticks the app for each member, and you save as usual.'));
    const del = el('button', 'pa-link pa-danger', t.isNew ? 'Remove this new team' : 'Delete team'); del.type = 'button'; del.dataset.teamDelete = t.id;
    foot.append(del);
    box.append(foot);
    return box;
  }
  function nameLineFor(a, changed) {
    const n = el('span', 'pa-name'); n.append(el('span', null, nameOf(a)));
    if (a.id === S.you) n.append(el('span', 'pa-you', 'You'));
    if (changed) n.append(el('span', 'pa-unsaved', 'Unsaved'));
    return n;
  }

  // The whole section from the state. Focus stays on the same control when it's redrawn.
  function render(o = {}) {
    if (!S.accounts.length && !S.apps.length) return;
    if (S.mode === 'teams' && !S.teams) S.mode = 'people';
    const active = document.activeElement, key = active && active.dataset ? active.dataset.focus : '';
    const people = listed();
    if (!S.person || !byId(S.person) || byId(S.person).waiting) S.person = (people[0] || {}).id || '';
    if (!S.app || !S.apps.some(x => x.id === S.app)) S.app = (S.apps[0] || {}).id || '';
    const teams = S.teams ? allTeams() : [];
    if (!S.team || !teamShown(S.team)) S.team = (teams[0] || {}).id || '';
    if (S.teamFilter && !teams.some(t => t.id === S.teamFilter)) S.teamFilter = '';
    $('#tab-teams').hidden = !S.teams;
    const byPeople = S.mode === 'people';
    for (const t of document.querySelectorAll('.pa-tab')) t.setAttribute('aria-selected', String(t.dataset.mode === S.mode));
    $('#pa-grid').setAttribute('aria-labelledby', `tab-${S.mode}`);
    $('#pa-grid').classList.toggle('is-open', S.open);
    const n = people.length, hits = people.filter(matches).length;
    renderFilter(byPeople ? teams : []);
    $('#accounts-count').textContent = plural(n, 'account', 'accounts');
    if (byPeople) {
      $('#pa-list-title').textContent = 'People';
      $('#pa-list-count').textContent = S.query.trim() ? `${hits} of ${n}` : plural(n, 'account', 'accounts');
      $('#pa-items').replaceChildren(...people.map(personRow));
      $('#pa-empty').hidden = hits > 0;
    } else if (S.mode === 'teams') {
      $('#pa-list-title').textContent = 'Teams';
      $('#pa-list-count').textContent = plural(teams.length, 'team', 'teams');
      const add = el('button', 'pa-row pa-new-team'); add.type = 'button'; add.dataset.teamNew = '1'; add.dataset.focus = 'team-new';
      add.append(el('span', 'pa-plus', '+'), el('span', 'pa-name', 'New team'));
      $('#pa-items').replaceChildren(add, ...teams.map(teamRow));
      $('#pa-empty').hidden = true;
    } else {
      $('#pa-list-title').textContent = 'Apps';
      $('#pa-list-count').textContent = S.query.trim() ? `${plural(hits, 'person matches', 'people match')} the search` : plural(S.apps.length, 'app', 'apps');
      $('#pa-items').replaceChildren(...S.apps.map(appRow));
      $('#pa-empty').hidden = true;
    }
    const a = byId(S.person), app = S.apps.find(x => x.id === S.app);
    const tm = teamShown(S.team);
    if (!o.keepDetail) $('#pa-detail').replaceChildren(byPeople ? (a ? personDetail(a) : '') : S.mode === 'teams' ? (tm ? teamDetail(tm) : emptyTeams()) : (app ? appDetail(app) : ''));
    renderFoot();
    if (key) { const again = document.querySelector(`[data-focus="${CSS.escape(key)}"]`); if (again && again !== active && !again.hidden) again.focus({ preventScroll: true }); }
  }
  function emptyTeams() {
    const box = document.createDocumentFragment();
    box.append(el('h3', 'pa-title', 'No teams yet'), el('p', 'pa-note', 'Group people by what they do at FLR: Surveyors, Fitters, Office, Warehouse… Press New team to start.'));
    return box;
  }
  // People: a row of team chips to show one team only.
  function renderFilter(teams) {
    const bar = $('#pa-filter');
    bar.hidden = !teams.length;
    if (!teams.length) return;
    const chip = (id, label, colour, n) => {
      const b = el('button', 'pa-fchip' + (colour ? ` tc-${colour}` : '')); b.type = 'button'; b.dataset.teamFilter = id; b.dataset.focus = 'tf:' + (id || 'all');
      b.setAttribute('aria-pressed', String(S.teamFilter === id));
      if (colour) b.append(el('span', 'pa-team-dot'));
      b.append(el('span', null, label));
      if (n != null) b.append(el('span', 'pa-fcount', String(n)));
      return b;
    };
    bar.replaceChildren(chip('', 'Everyone', '', null), ...teams.map(t => chip(t.id, t.name || 'New team', t.colour, t.members.size)));
  }
  function renderFoot() {
    const n = dirty(), foot = $('#pa-foot'), save = $('#pa-save');
    $('#pa-discard').disabled = !n || S.saving;
    save.disabled = !n || S.saving;
    if (S.saving) save.setAttribute('aria-busy', 'true'); else save.removeAttribute('aria-busy');
    save.querySelector('.btn-label').textContent = S.saving ? 'Saving…' : 'Save changes';
    foot.classList.toggle('is-sticky', !!n || !!S.error || S.saving);   // in view while there's something to save
    foot.classList.toggle('is-dirty', !!n && !S.error);
    foot.classList.toggle('is-error', !!S.error);
    foot.classList.toggle('is-saved', !n && !!S.saved);
    $('#pa-feedback').textContent = S.saving ? `Saving ${plural(n, 'change', 'changes')}…` : S.error ? S.error
      : n ? plural(n, 'unsaved change', 'unsaved changes') : S.saved || 'No unsaved changes';
  }
  function renderAccounts() { render(); renderWaiting(); }

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
  $('#wait-list').addEventListener('click', e => {
    const ap = e.target.closest('[data-approve]');
    if (ap) { openApprove(ap.dataset.approve); return; }
    const no = e.target.closest('[data-refuse]');
    if (no) refuse(no.dataset.refuse);
  });
  // Likkle Jeff's switch (Hub migration 2.4). S.jeff: true / false, or null when the database hasn't got the switch yet.
  function renderJeff() {
    const btn = $('#jeff-on'), sub = $('#jeff-on-sub');
    btn.disabled = S.jeff === null;
    btn.setAttribute('aria-checked', S.jeff ? 'true' : 'false');
    sub.textContent = S.jeff === null ? 'Needs the “Likkle Jeff switch” update to the FLR database (Hub migration 2.4).'
      : S.jeff ? 'Showing on every page for everyone.' : 'Hidden for everyone until you switch him back on.';
    sub.classList.toggle('is-warn', S.jeff === null);
  }
  async function loadJeff() {
    try { S.jeff = (await call('likkle_jeff_on')) !== false; } catch (e) { S.jeff = null; }
    renderJeff();
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
      if (code === 'FLR_ACCOUNT_DISABLED') {
        let waiting = false;   // new and not approved yet (Hub migration 2.2), or switched off
        try { const h = await c.rpc('hub_home'); waiting = !!(h && h.data && h.data.waiting); } catch (err) { /* treated as switched off */ }
        return waiting ? gate('Your account is waiting for a Super Admin', 'They’ll check it’s really you, then switch on your tools. You don’t need to do anything.')
          : gate('Your account is switched off', 'Ask an FLR Super Admin to switch it back on.');
      }
      if (code === 'FLR_NO_PROFILE') return gate('No FLR profile yet', 'You’re signed in, but this account has no FLR profile. Ask an FLR Super Admin.');
      if (missingFunction(e)) return gate('Not ready yet', 'Hub settings needs the latest update to the FLR database. Ask whoever looks after it to run the “app access” update, then try again.', { retry: true });
      return gate('Hub settings didn’t load', offline(e) ? 'Can’t reach the FLR database. Check your connection and try again.' : 'Something went wrong. Try again in a moment.', { retry: true });
    }
    $('#gate').hidden = true;
    $('#accounts-section').hidden = false; $('#registration-section').hidden = false; $('#jeff-section').hidden = false;
    renderSettings(); renderAccounts(); renderPre(); loadJeff(); loadPhotos(); loadTeams(); loadActivity(true);
    view('ready');
  }
  // Staff photos (Hub migration 2.5). Before that update, or if it fails, everyone keeps their initials.
  async function loadPhotos() {
    try { const p = await call('admin_account_photos'); S.photos = p && typeof p === 'object' && !Array.isArray(p) ? p : {}; }
    catch (e) { return; }
    render();
  }
  // Teams (Hub migration 2.8). Before that update the Teams tab and chips stay hidden.
  async function loadTeams() {
    try { const t = await call('admin_teams'); S.teams = Array.isArray(t) ? t : []; }
    catch (e) { S.teams = null; }
    pruneTeams(); render();
  }
  /* ---------------------------------------------------------------- Activity (Hub migration 2.9): the change log, readable */
  // A page at a time, newest first. Before that update the section stays hidden (the Cost Estimator still has the log).
  const ACT = { area: '', actor: '', views: false, events: [], more: false, actors: null, busy: false, error: '' };
  const ACT_AREAS = [['', 'Everything'], ['quotes', 'Quotes'], ['accounts', 'Accounts'], ['teams', 'Teams'], ['leave', 'Annual Leave'], ['fleet', 'Fleet'],
    ['orders', 'Orders'], ['warehouse', 'Warehouse'], ['nearby', 'Nearby']];
  const actCtx = {
    personName: id => { const a = id && byId(String(id)); return a ? nameOf(a) : (ACT.actors || []).find(x => x.id === id)?.name || ''; },
    appTitle: id => id ? appTitle(id) : '',
    roleName: r => roleName(r || ''),
    roleAs: r => AS[r] || roleName(r || ''),
    teamName: id => { const t = id && (S.teams || []).find(x => x.id === id); return t ? t.name : ''; },
  };
  async function loadActivity(reset) {
    if (ACT.busy || !window.FLRActivity) return;
    ACT.busy = true; ACT.error = ''; renderActivityStatus();
    if (reset) { ACT.events = []; ACT.more = false; }
    try {
      const r = await call('admin_activity', { p_before: reset ? null : (ACT.events[ACT.events.length - 1] || {}).id || null, p_limit: 100,
        p_area: ACT.area || null, p_actor: ACT.actor || null, p_views: ACT.views });
      ACT.events = reset ? (r.events || []) : ACT.events.concat(r.events || []);
      ACT.more = !!r.more;
      if (r.actors) ACT.actors = r.actors;
      const first = $('#activity-section').hidden;
      $('#activity-section').hidden = false;
      if (first && location.hash === '#activity') requestAnimationFrame(() => $('#activity-section').scrollIntoView({ block: 'start' }));   // from the Cost Estimator's Change log tab
    } catch (e) {
      if (missingFunction(e)) { $('#activity-section').hidden = true; ACT.busy = false; return; }
      ACT.error = said(e);
    }
    ACT.busy = false;
    renderActivity();
  }
  const dayKey = iso => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  function dayLabel(iso) {
    const d = new Date(iso), now = new Date();
    const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  }
  const hm = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  function activityRow(e, run = { n: 1, first: e }) {
    const li = el('li', `act-row act-${e.area || 'other'}`);
    const a = e.actorId && byId(e.actorId);
    const av = a ? avatarOf(a) : el('span', 'pa-avatar', initials(e.actorName || '?'));
    av.setAttribute('aria-hidden', 'true');
    const body = el('div', 'act-body');
    const line = el('p', 'act-line');
    line.append(el('strong', 'act-who', e.actorName || 'Someone'), ' ');
    let said;
    try { said = window.FLRActivity.describe(e, actCtx); } catch (err) { said = { parts: ['did something'], details: [] }; }
    for (const p of said.parts) line.append(typeof p === 'string' ? document.createTextNode(p) : el('b', null, p.b));
    const meta = el('p', 'act-meta');
    const t = new Date(e.at);
    const time = el('time', null, t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); time.dateTime = e.at;
    time.title = t.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'medium' });
    if (run.n > 1) { time.textContent = `${hm(run.first.at)}–${hm(e.at)}`; meta.append(el('span', 'act-times', `${run.n} times`), el('span', 'pa-dot', '·')); }
    meta.append(time, el('span', 'pa-dot', '·'), el('span', `act-area act-area-${e.area || 'other'}`, window.FLRActivity.AREA[e.area] || 'Hub'));
    body.append(line, meta);
    if (said.details.length) {
      const det = el('details', 'act-details');
      det.append(el('summary', null, 'Details'));
      const dl = el('dl');
      for (const [k, v] of said.details) dl.append(el('dt', null, k), el('dd', null, v));
      det.append(dl);
      body.append(det);
    }
    li.append(av, body);
    return li;
  }
  function renderActivity() {
    $('#act-areas').replaceChildren(...ACT_AREAS.map(([id, label]) => {
      const bt = el('button', 'pa-fchip act-chip', label); bt.type = 'button'; bt.dataset.actArea = id;
      bt.setAttribute('aria-pressed', String(ACT.area === id)); return bt;
    }));
    const sel = $('#act-person');
    if (ACT.actors && sel.options.length !== ACT.actors.length + 1) {
      sel.replaceChildren(Object.assign(el('option', null, 'Everyone'), { value: '' }), ...ACT.actors.map(p => Object.assign(el('option', null, p.name), { value: p.id })));
      sel.value = ACT.actor;
    }
    $('#act-views').checked = ACT.views;
    const list = $('#act-list'), frag = document.createDocumentFragment();
    // The same thing done again and again in a row (saving a quotation's details as you type, say) is one line with a count.
    const runs = [];
    for (const e of ACT.events) {
      const r = runs[runs.length - 1];
      if (r && r.e.actorId === e.actorId && r.e.kind === e.kind && r.e.quoteId === e.quoteId && r.e.roomId === e.roomId && dayKey(r.e.at) === dayKey(e.at)) { r.n++; r.first = e; }
      else runs.push({ e, first: e, n: 1 });
    }
    let last = '', ul = null;
    for (const r of runs) {
      const k = dayKey(r.e.at);
      if (k !== last) { last = k; const g = el('section', 'act-day'); g.append(el('h3', 'act-day-title', dayLabel(r.e.at))); ul = el('ul', 'act-items'); g.append(ul); frag.append(g); }
      ul.append(activityRow(r.e, r));
    }
    list.replaceChildren(frag);
    $('#act-more').hidden = !ACT.more;
    $('#act-count').textContent = ACT.events.length ? `${ACT.events.length}${ACT.more ? '+' : ''} shown` : '';
    renderActivityStatus();
  }
  function renderActivityStatus() {
    const st = $('#act-status');
    st.textContent = ACT.busy ? 'Loading…' : ACT.error ? ACT.error : !ACT.events.length ? 'Nothing here yet for this choice.' : '';
    st.classList.toggle('is-error', !!ACT.error);
    $('#act-more').disabled = ACT.busy;
  }
  $('#act-areas').addEventListener('click', e => { const bt = e.target.closest('[data-act-area]'); if (!bt || ACT.area === bt.dataset.actArea) return; ACT.area = bt.dataset.actArea; loadActivity(true); });
  $('#act-person').addEventListener('change', e => { ACT.actor = e.target.value; loadActivity(true); });
  $('#act-views').addEventListener('change', e => { ACT.views = e.target.checked; loadActivity(true); });
  $('#act-more').addEventListener('click', () => loadActivity(false));
  async function reloadAccounts() {
    const acc = await call('admin_accounts');
    S.you = acc.you; S.apps = acc.apps || []; S.accounts = acc.accounts || [];
    loadPhotos();
    const gone = prune();
    if (gone) S.error = `${plural(gone, 'unsaved change was', 'unsaved changes were')} dropped: the account has gone, or isn’t approved any more.`;
    renderAccounts();
    if (approveFor) { const a = byId(approveFor); if (!a || !notApproved(a)) sheets.close($('#sheet-approve')); }
  }

  /* ---------------------------------------------------------------- People & access: choosing, editing, saving */
  function openDetail() {
    if (!isPhone()) return;
    if (!S.open) { S.open = true; history.pushState({ pa: 1 }, ''); }
    render();
    scrollTo({ top: $('#accounts-section').offsetTop - 60, behavior: reduced() ? 'auto' : 'smooth' });
    const h = $('#pa-detail-title'); if (h) h.focus({ preventScroll: true });
  }
  function closeDetail() {
    if (history.state && history.state.pa) { history.back(); return; }   // popstate draws it
    S.open = false; render();
  }
  addEventListener('popstate', () => {
    if (!S.open) return;
    const was = S.mode === 'people' ? `person:${S.person}` : S.mode === 'teams' ? `team:${S.team}` : `app:${S.app}`;
    S.open = false; render();
    const row = document.querySelector(`[data-focus="${CSS.escape(was)}"]`); if (row) row.focus({ preventScroll: true });
  });
  $('#pa-grid').addEventListener('click', e => {
    const p = e.target.closest('[data-person]');
    if (p) { S.person = p.dataset.person; render(); openDetail(); if (!isPhone()) { const h = $('#pa-detail-title'); if (h && matchMedia('(pointer: coarse)').matches) h.focus({ preventScroll: true }); } return; }
    const ap = e.target.closest('[data-app-pick]');
    if (ap) { S.app = ap.dataset.appPick; render(); openDetail(); return; }
    const tp = e.target.closest('[data-team-pick]');
    if (tp) { S.team = tp.dataset.teamPick; S.teamMsg = ''; render(); openDetail(); return; }
    if (e.target.closest('[data-team-new]')) { S.teamMsg = ''; newTeam(); return; }
    const tf = e.target.closest('[data-team-filter]');
    if (tf) { S.teamFilter = tf.dataset.teamFilter; render(); return; }
    const tt = e.target.closest('[data-team-toggle]');
    if (tt) { setMember(tt.dataset.teamToggle, tt.dataset.user, tt.getAttribute('aria-pressed') !== 'true'); return; }
    const sw = e.target.closest('[data-colour]');
    if (sw) { editTeam(S.team, { colour: sw.dataset.colour }); return; }
    const give = e.target.closest('[data-team-give]');
    if (give) { giveTeamApp(give.dataset.teamGive); return; }
    const del = e.target.closest('[data-team-delete]');
    if (del) { deleteTeam(del.dataset.teamDelete); return; }
    if (e.target.closest('[data-back]')) { closeDetail(); return; }
    const ok = e.target.closest('[data-approve]');
    if (ok) { openApprove(ok.dataset.approve); return; }
    const rs = e.target.closest('[data-reset]');
    if (rs) resetPassword(byId(rs.dataset.reset), rs);
  });
  $('#pa-grid').addEventListener('change', e => {
    const t = e.target;
    if (t.matches('input[type="checkbox"][data-app][data-user]')) { edit(byId(t.dataset.user), { app: t.dataset.app, on: t.checked }); return; }
    if (t.matches('input[type="checkbox"][data-team-member]')) { setMember(t.dataset.teamMember, t.dataset.user, t.checked); return; }
    if (t.id === 'pa-team-app') { S.giveApp = t.value; return; }
    if (t.id === 'pa-role') { edit(byId(S.person), { role: t.value }); return; }
    if (t.id === 'pa-status') edit(byId(S.person), { status: t.value });
  });
  // Typing a team's name or words: the list and the Save bar follow; the editor stays as it is, so the caret doesn't jump.
  $('#pa-grid').addEventListener('input', e => {
    if (e.target.id === 'pa-team-name') { editTeam(S.team, { name: e.target.value.replace(/\s+/g, ' ').trimStart() }, { keepDetail: true }); const h = $('#pa-detail-title'); if (h) h.textContent = e.target.value.trim() || 'New team'; }
    if (e.target.id === 'pa-team-desc') editTeam(S.team, { description: e.target.value }, { keepDetail: true });
  });
  $('#pa-grid').addEventListener('keydown', e => {   // the colours: arrows move between them, as in any radio group
    const sw = e.target.closest('[data-colour]');
    if (!sw || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const i = TEAM_COLOURS.findIndex(([c]) => c === sw.dataset.colour), step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const next = TEAM_COLOURS[(i + step + TEAM_COLOURS.length) % TEAM_COLOURS.length][0];
    editTeam(S.team, { colour: next });
    const b = document.querySelector(`[data-colour="${next}"]`); if (b) b.focus();
  });
  function giveTeamApp(teamId) {
    const t = teamShown(teamId), app = ($('#pa-team-app') || {}).value;
    if (!t || !app || S.saving) return;
    let ticked = 0, had = 0, skipped = 0;
    for (const uid of t.members) {
      const a = byId(uid);
      if (!a || a.waiting) continue;
      if (notApproved(a)) { skipped++; continue; }
      if (shown(a).apps.has(app)) { had++; continue; }
      const d = S.draft.get(a.id) || { apps: {} };
      if (a.apps.includes(app)) delete d.apps[app]; else d.apps[app] = true;
      if (d.role === undefined && d.status === undefined && !Object.keys(d.apps).length) S.draft.delete(a.id); else S.draft.set(a.id, d);
      ticked++;
    }
    S.giveApp = app; S.error = ''; S.saved = '';
    S.teamMsg = ticked ? `${appTitle(app)} ticked for ${plural(ticked, 'person', 'people')}${had ? `; ${had} already had it` : ''}${skipped ? `; ${skipped} not approved yet` : ''}. Press Save changes to keep it.`
      : `Everyone in ${t.name || 'this team'} already has ${appTitle(app)}${skipped ? ` (${skipped} not approved yet)` : ''}.`;
    render();
  }
  async function deleteTeam(id) {
    const t = teamShown(id); if (!t || S.saving) return;
    if (t.isNew) { S.tdraft.delete(id); S.team = ''; render(); closeDetail(); return; }
    if (!(await confirmIt(`Delete ${t.name}?`, `The team goes when you press Save changes. Its ${plural(t.members.size, 'member keeps', 'members keep')} their accounts and apps.`, 'Delete team', true))) return;
    editTeam(id, { deleted: true });
    S.team = ''; render(); closeDetail();
  }
  for (const t of document.querySelectorAll('.pa-tab')) t.addEventListener('click', () => {
    if (S.mode === t.dataset.mode) return;
    S.mode = t.dataset.mode;
    if (S.open && history.state && history.state.pa) { S.open = false; history.replaceState(null, ''); } else S.open = false;
    render();
  });
  $('.pa-tabs').addEventListener('keydown', e => {   // tabs: left and right move between them
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tabs = [...document.querySelectorAll('.pa-tab')].filter(x => !x.hidden);
    const i = tabs.findIndex(x => x.dataset.mode === S.mode), next = tabs[(i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
    next.click(); next.focus();
  });
  $('#search').addEventListener('input', e => { S.query = e.target.value; render(); });

  // Changes that give or take away rights over other people's data, or stop someone signing in: said once more before saving.
  function warnings(list) {
    const out = [];
    let danger = false;
    for (const c of list) {
      const who = nameOf(c.a);
      if (c.kind === 'role') {
        if (c.value === 'admin') out.push(`${who} becomes a Super Admin, who can change every account, role and app setting, and every app’s settings.`);
        else if (c.value === 'manager') out.push(`${who} becomes an Admin: approves leave, sees everyone’s leave, every driver and fitter arrivals.`);
        if (c.from === 'admin' && c.value !== 'admin') { out.push(`${who} loses Super Admin rights.`); danger = true; }
        else if (c.from === 'manager' && c.value !== 'manager' && c.value !== 'admin') { out.push(`${who} loses Admin rights.`); danger = true; }
      } else if (c.kind === 'status' && c.value === 'disabled') { out.push(`${who}’s account is switched off: they can’t sign in to the Hub or any app. Nothing of theirs is deleted.`); danger = true; }
    }
    return { text: out.join(' '), danger };
  }
  function teamWarnings(ops) {
    const gone = ops.filter(o => o.kind === 'team-delete').map(o => o.t.name);
    return gone.length ? `${gone.join(', ')} ${gone.length === 1 ? 'is' : 'are'} deleted (${gone.length === 1 ? 'its' : 'their'} members keep their apps).` : '';
  }
  async function sendTeam(o) {
    if (o.kind === 'team-new') {
      const id = await call('admin_save_team', { p_id: null, p_name: o.t.name.trim(), p_colour: o.t.colour, p_description: o.t.description.trim() });
      S.tdraft.delete(o.id);
      if (S.team === o.id) S.team = id;
      if (S.teamFilter === o.id) S.teamFilter = id;
      if (o.t.members.size) { S.tdraft.set(id, { members: [...o.t.members] }); S.teams = [...(S.teams || []), { id, name: o.t.name.trim(), colour: o.t.colour, description: o.t.description.trim(), members: [] }];
        S.teams = await call('admin_set_team_members', { p_id: id, p_members: [...o.t.members] }); }
      return;
    }
    if (o.kind === 'team-delete') { S.teams = await call('admin_delete_team', { p_id: o.id }); S.tdraft.delete(o.id); return; }
    if (o.kind === 'team-details') { await call('admin_save_team', { p_id: o.id, p_name: o.t.name.trim(), p_colour: o.t.colour, p_description: o.t.description.trim() }); return; }
    S.teams = await call('admin_set_team_members', { p_id: o.id, p_members: [...o.t.members] });
  }
  async function reloadTeams() { if (S.teams) { S.teams = await call('admin_teams'); pruneTeams(); } }
  async function send(c) {
    if (c.kind === 'role') { await call('admin_set_role', { p_user: c.a.id, p_role: c.value }); const a = byId(c.a.id); if (a) a.role = c.value; return; }
    if (c.kind === 'status') { await call('admin_set_status', { p_user: c.a.id, p_status: c.value }); const a = byId(c.a.id); if (a) a.status = c.value; return; }
    const row = await call('admin_set_app_access', { p_user: c.a.id, p_app: c.app, p_allowed: c.value });
    const i = S.accounts.findIndex(x => x.id === c.a.id);
    if (row && i >= 0) S.accounts[i] = row;
  }
  async function save() {
    const list = changes(), tops = teamOps(), total = dirty();
    if (!total || S.saving) return;
    for (const o of tops) if ((o.kind === 'team-new' || o.kind === 'team-details') && !o.t.name.trim()) {
      S.team = o.id; S.mode = 'teams'; S.error = 'Give the team a name before saving.'; render(); const n = $('#pa-team-name'); if (n) n.focus(); return;
    }
    const w = warnings(list), tw = teamWarnings(tops);
    const text = [w.text, tw].filter(Boolean).join(' ');
    if (text && !(await confirmIt(`Save ${plural(total, 'change', 'changes')}?`, text, 'Save changes', w.danger || !!tw))) return;
    S.saving = true; S.error = ''; S.saved = ''; renderFoot(); render();
    const failed = [];
    let stop = null;
    for (const o of tops) {
      if (stop) break;
      try { await sendTeam(o); }
      catch (e) {
        failed.push(e);
        if (offline(e) || expired(e) || ['FLR_SIGN_IN_REQUIRED', 'FLR_FORBIDDEN', 'FLR_ACCOUNT_DISABLED'].includes(flrCode(e))) stop = e;
      }
    }
    for (const c of stop ? [] : list) {
      try { await send(c); }
      catch (e) {
        failed.push(e);
        if (offline(e) || expired(e) || ['FLR_SIGN_IN_REQUIRED', 'FLR_FORBIDDEN', 'FLR_ACCOUNT_DISABLED'].includes(flrCode(e))) { stop = e; break; }   // the rest would fail the same way
      }
    }
    // Read everything back, so the page shows what the database has now; what didn't save is still a draft.
    try { await reloadAccounts(); } catch (e) { prune(); }
    try { await reloadTeams(); } catch (e) { pruneTeams(); }
    if (!$('#activity-section').hidden) loadActivity(true);
    S.saving = false;
    const left = dirty();
    if (!failed.length && !left) {
      S.saved = `${plural(total, 'change', 'changes')} saved`; S.teamMsg = '';
      toast(S.saved);
    } else {
      const e = stop || failed[0];
      const why = e ? said(e) : 'Some changes didn’t reach the FLR database.';
      S.error = `${left === total ? 'Nothing was saved.' : `${plural(left, 'change', 'changes')} didn’t save.`} ${why} ${left === 1 ? 'It’s' : 'They’re'} still here: press Save changes to try again.`;
      if (expired(e) || flrCode(e) === 'FLR_SIGN_IN_REQUIRED') S.error = `Your sign-in has expired, so ${left === total ? 'nothing was saved' : `${plural(left, 'change', 'changes')} didn’t save`}. Sign in again in another tab, then press Save changes.`;
    }
    render();
  }
  $('#pa-save').addEventListener('click', save);
  $('#pa-discard').addEventListener('click', async () => {
    const n = dirty();
    if (!n || S.saving) return;
    if (!(await confirmIt(`Discard ${plural(n, 'unsaved change', 'unsaved changes')}?`, 'Everything goes back to how it is in the FLR database. Nothing has been saved.', 'Discard', true))) return;
    S.draft.clear(); S.tdraft.clear(); S.error = ''; S.saved = ''; S.teamMsg = '';
    render(); toast('Changes discarded');
  });

  // Leaving with unsaved changes: the Hub link and other links ask first; closing or reloading the tab gets the browser's question.
  let leaving = false;
  addEventListener('beforeunload', e => { if (!leaving && (dirty() || S.saving)) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('click', async e => {
    const link = e.target.closest('a[href]');
    if (!link || !dirty() || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || link.target === '_blank') return;
    e.preventDefault();
    const n = dirty();
    if (await confirmIt('Leave without saving?', `You have ${plural(n, 'unsaved change', 'unsaved changes')} in People & access. ${n === 1 ? 'It’s' : 'They’re'} lost if you leave now.`, 'Leave', true)) { leaving = true; location.href = link.href; }
  }, true);

  async function resetPassword(a, btn) {
    if (!a || btn.disabled) return;
    btn.disabled = true;
    try {
      const { error } = await client().auth.resetPasswordForEmail(a.email, { redirectTo: HUB });
      if (error) throw error;
      toast(`Reset email sent to ${a.email}`);
    } catch (err) { toast(offline(err) ? 'Can’t reach the FLR sign-in service. Check your connection.' : 'The reset email couldn’t be sent. Try again in a few minutes.'); }
    finally { btn.disabled = false; }
  }

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

  /* ---------------------------------------------------------------- Likkle Jeff */
  $('#jeff-on').addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (btn.getAttribute('aria-busy') === 'true' || S.jeff === null) return;
    const on = !S.jeff;
    btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-checked', on ? 'true' : 'false');
    try {
      S.jeff = (await call('admin_set_likkle_jeff', { p_on: on })) !== false;
      if (window.FLR_LIKKLE_JEFF_SEEN) window.FLR_LIKKLE_JEFF_SEEN(S.jeff);   // this browser follows at once
      renderJeff(); toast(S.jeff ? 'Likkle Jeff is on for everyone' : 'Likkle Jeff is off for everyone');
    } catch (err) { renderJeff(); toast(said(err)); }
    finally { btn.removeAttribute('aria-busy'); }
  });

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
