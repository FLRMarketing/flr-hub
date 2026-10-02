/* ============================================================================
   FLR Hub: runs Annual Leave on the FLR site. The page talks to monday.com the
   way it does on Claude (window.claude.use('mcp')). This answers instead, after
   checking the FLR sign-in:
     - reads come from the FLR database's copy of the five leave boards, which
       the flr-leave function keeps in step with monday.com. Approvers get all
       of it; everyone else gets only their own requests and allowance.
     - changes go to the flr-leave function as plain lists of what to change
       (never the page's own queries). It checks the person approves leave,
       writes to monday.com with the key it holds, and records who did it.
     - when monday.com changes, the page reloads by itself: a Realtime message
       (topic 'flr-leave', no leave data in it) or a check every minute.
   Nothing about staff or leave is in this site's files, not even the form link.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';        // the FLR sign-in the hub and the Estimator share
  const HUB = '../';
  const SIGN_IN = HUB + '?next=annual-leave';
  const FN = (cfg.supabaseUrl || '') + '/functions/v1/flr-leave';
  const BOARD = { 5105073088: 'req', 5105073023: 'alw', 5105073015: 'grp', 5105073038: 'clo', 5105088856: 'oth' };
  const CHECK_MS = 60 * 1000;
  window.__FLR_LEAVE = {};                      // tells the page it's on the Hub before it first draws
  let sb = null, version = null, refreshWanted = false, reloadTimer = 0, liveStarted = false;
  let faces = {}, facesAsked = false;           // staff photos, fetched once per visit: everyone's for approvers, their own for staff
  // The slide in from the hub is skipped when the page arrives hidden (a background tab): nothing to report.
  addEventListener('pagereveal', e => { const t = e.viewTransition; if (t) { t.ready.catch(() => {}); t.finished.catch(() => {}); t.updateCallbackDone.catch(() => {}); } });

  function client() {
    if (!sb && window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey) {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY },
      });
    }
    return sb;
  }
  const flrCode = e => { const m = /FLR_[A-Z_]+/.exec(e ? `${e.message || ''} ${e.details || ''}` : ''); return m ? m[0] : ''; };
  const missing = e => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message || ''));
  const offline = e => !!e && /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(e.message || '');
  const expired = e => !!e && (e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT expired|invalid JWT/i.test(e.message || ''));
  const never = () => new Promise(() => {});    // the page is leaving, or a full-page message has taken over

  // A calm full-page message in the page's own colours, with a way back to the hub.
  function blocked(title, text, o = {}) {
    const show = () => {
      if (document.getElementById('flr-blocked')) return;
      const box = document.createElement('div');
      box.id = 'flr-blocked'; box.setAttribute('role', 'alert');
      Object.assign(box.style, { position: 'fixed', inset: '0', zIndex: '100000', display: 'grid', placeItems: 'center', padding: '24px',
        background: 'var(--bg, #f2f2f7)', color: 'var(--ink, #101116)', font: '400 17px/1.45 var(--font-text, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)' });
      const card = document.createElement('div');
      Object.assign(card.style, { maxWidth: '420px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' });
      const h = document.createElement('h1'); h.textContent = title; h.tabIndex = -1;
      Object.assign(h.style, { margin: '0', font: '700 26px/1.2 var(--font-display, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)', letterSpacing: '-.02em' });
      const p = document.createElement('p'); p.textContent = text;
      Object.assign(p.style, { margin: '0 0 8px', color: 'var(--ink-2, #55575f)' });
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' });
      const btn = (label, primary, act) => {
        const b = document.createElement(act.href ? 'a' : 'button'); b.textContent = label;
        if (act.href) b.href = act.href; else { b.type = 'button'; b.addEventListener('click', act.run); }
        Object.assign(b.style, { display: 'inline-flex', alignItems: 'center', minHeight: '44px', padding: '0 18px', borderRadius: '999px', border: '0', cursor: 'pointer',
          font: '600 16px/1 var(--font-text, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)', textDecoration: 'none',
          background: primary ? 'var(--tint-fill, #00098b)' : 'var(--fill, rgba(118,118,128,.12))', color: primary ? 'var(--on-tint, #fff)' : 'var(--ink, #101116)' });
        row.appendChild(b);
      };
      btn('Back to FLR Hub', true, { href: HUB });
      if (o.retry) btn('Try again', false, { run: () => location.reload() });
      card.append(h, p, row); box.appendChild(card); document.body.appendChild(box); h.focus();
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }

  async function session() {
    const c = client();
    if (!c) { blocked('Annual Leave can’t start', 'This copy of the FLR site has no sign-in settings (flr-config.js).'); return never(); }
    let s = null;
    try { s = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!s) { location.replace(SIGN_IN); return never(); }   // the hub signs people in, then brings them back
    return s;
  }

  async function readHome() {
    const r = await client().rpc('leave_home');
    if (!r.error) return r.data;
    const code = flrCode(r.error);
    if (code === 'FLR_SIGN_IN_REQUIRED' || expired(r.error)) { location.replace(SIGN_IN); return never(); }
    if (code === 'FLR_ACCOUNT_DISABLED') { blocked('Your FLR account is switched off', 'Ask an FLR administrator to switch it back on.'); return never(); }
    // Hub settings decides who uses Annual Leave; the database refuses everyone else (detail 'app.annual-leave').
    if (code === 'FLR_FORBIDDEN') { blocked('You don’t have access to Annual Leave', 'Ask an FLR Super Admin if you need it.'); return never(); }
    if (code === 'FLR_NO_PROFILE') { blocked('Your account isn’t set up for FLR tools', 'Ask an FLR administrator to finish setting it up.'); return never(); }
    if (missing(r.error)) { blocked('Annual Leave isn’t set up yet', 'Its data hasn’t been added to the FLR database.'); return never(); }
    if (offline(r.error)) throw { code: 'offline', message: 'Check your connection, then press Refresh.' };
    throw { code: 'server_error', message: 'The FLR database didn’t answer as expected. Try again in a moment.' };
  }

  // Staff photos, by staff record: approvers get everyone's, anyone else just their own (the database decides). Without
  // them (or from a database that refuses staff) the page shows initials.
  async function readFaces() {
    try { const r = await client().rpc('leave_faces'); return !r.error && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {}; }
    catch (e) { return {}; }
  }
  function take(h) {
    window.__FLR_LEAVE = { access: h.access, linked: !!h.linked, me: h.me || {}, syncError: h.syncError || null, lastFullSync: h.lastFullSync || null, today: h.today || null,
      wpIssues: Array.isArray(h.wpIssues) ? h.wpIssues : [], faces };
    try { FORM_URL = h.formUrl || ''; } catch (e) { /* the page keeps its own */ }   // eslint-disable-line no-undef
    version = h.version;
  }
  // What the page expects back from its read of the five boards.
  function boards(h) {
    const p = { me: { name: (h.me && h.me.name) || '' } };
    for (const k of ['req', 'alw', 'grp', 'clo', 'oth']) p[k] = [{ items_page: { cursor: null, items: (h.boards && h.boards[k]) || [] } }];
    return p;
  }

  // The page's monday.com changes, as the plain changes they are.
  function changes(query, v) {
    const ops = [];
    if (/create_update\(item_id: \$i, body: \$body\)/.test(query)) ops.push({ kind: 'update', item: String(v.i), body: String(v.body) });
    else if (/change_multiple_column_values\(board_id: \$b, item_id: \$i, column_values: \$v\)/.test(query)) ops.push({ kind: 'set', board: BOARD[v.b], item: String(v.i), values: JSON.parse(v.v) });
    else {
      const many = /w(\d+): change_multiple_column_values\(board_id: \$b\1, item_id: \$i\1, column_values: \$v\1\)/g;
      let m;
      while ((m = many.exec(query))) ops.push({ kind: 'set', board: BOARD[v['b' + m[1]]], item: String(v['i' + m[1]]), values: JSON.parse(v['v' + m[1]]) });
    }
    return ops;
  }
  async function post(body) {
    const s = await session();
    let res;
    try {
      res = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.supabaseAnonKey, authorization: `Bearer ${s.access_token}` }, body: JSON.stringify(body) });
    } catch (e) { throw { code: 'offline', message: 'Check your connection, then try again.' }; }
    const out = await res.json().catch(() => null);
    if (!res.ok || !out || out.error) {
      const err = (out && out.error) || {};
      throw { code: err.code || 'server_error', message: err.message || `The FLR server answered ${res.status}.` };
    }
    return out;
  }

  const mcp = Object.freeze({
    async callTool(server, tool, input) {
      const query = String((input && input.query) || '');
      let vars = {};
      try { vars = JSON.parse((input && input.variables) || '{}'); } catch (e) { /* none */ }
      if (/^\s*mutation/.test(query)) {
        const ops = changes(query, vars);
        if (!ops.length || ops.some(o => o.kind === 'set' && !o.board)) throw { code: 'tool_error', message: 'The FLR site doesn’t make that change.' };
        return { payload: (await post({ op: 'write', ops })).data || {} };
      }
      if (/next_items_page/.test(query)) return { payload: { next_items_page: { cursor: null, items: [] } } };
      if (refreshWanted) { refreshWanted = false; await post({ op: 'sync' }).catch(() => {}); }
      const h = await readHome();
      if (!facesAsked) { facesAsked = true; faces = await readFaces(); }
      take(h);
      live();
      return { payload: boards(h) };
    },
  });
  window.claude = Object.freeze({ use: async name => { if (name !== 'mcp') return null; await session(); return mcp; } });

  // Refresh asks the server to read monday.com again first (at most every 30 seconds, whoever asks).
  document.addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('#refresh')) refreshWanted = true; }, true);

  // Reload when monday.com has changed, once the page is quiet (not mid-decision or saving).
  function reloadSoon() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      /* global state, load */
      if (typeof state === 'undefined' || typeof load !== 'function') return;
      if (!state.mcp || state.loading || state.busy || state.savingCount) { reloadSoon(); return; }
      load();
    }, 1200);
  }
  function check() {
    if (document.visibilityState !== 'visible' || version == null) return;
    client().rpc('leave_version').then(r => { if (r && !r.error && r.data && r.data.version !== version) reloadSoon(); }, () => {});
  }
  function live() {
    if (liveStarted) return;
    liveStarted = true;
    try {
      client().channel('flr-leave').on('broadcast', { event: 'changed' }, msg => {
        const v = msg && msg.payload && msg.payload.v;
        if (version == null || typeof v !== 'number' || v !== version) reloadSoon();
      }).subscribe();
    } catch (e) { /* the minute check still runs */ }
    setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', check);
  }
})();
