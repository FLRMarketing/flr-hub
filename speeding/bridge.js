/* ============================================================================
   FLR Hub: runs Fleet Management (the driver speeding report) on the FLR site.
   The report asks for its database the way it does on Claude
   (window.claude.use('db')). This answers from the FLR database instead,
   after checking the FLR sign-in. The database decides what each person gets:
   administrators every driver; an account linked to a driver only that
   driver's own log (the page shows it as "My driving"); anyone else nothing.
   Nothing about drivers is in this site's files: the data and staff photos
   (as data URLs in window.__FLR_PHOTOS) arrive after sign-in.
   window.FLRHUB tells the page which view it has (scope) and, for
   administrators, links FLR accounts to drivers. ?preview=<driver> shows an
   administrator exactly what that driver sees.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';        // the FLR sign-in the hub and the Estimator share
  const HUB = '../';
  const SIGN_IN = HUB + '?next=speeding';
  const FRESH_MS = 5 * 60 * 1000;               // re-read when the page comes back to the front after 5 minutes,
  const OPEN_MS = 15 * 60 * 1000;               // and every 15 minutes while it stays open (FLR's server updates the data that often)
  const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const PREVIEW = (() => { try { return (new URLSearchParams(location.search).get('preview') || '').trim().slice(0, 120); } catch (e) { return ''; } })();
  let sb = null, data = null, scope = null, loadedAt = 0, loading = null, sig = '';
  // The report's pages stay hidden until the database has said which view this person gets.
  document.documentElement.dataset.hub = 'loading';
  const subs = [];                              // the page's subscriptions, so fresh data reaches every one
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
  const detailOf = e => (e && typeof e.details === 'string' ? e.details : '');
  const missing = e => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message || ''));
  const offline = e => !!e && /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(e.message || '');
  const expired = e => !!e && (e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT expired|invalid JWT/i.test(e.message || ''));

  // A calm full-page message in the report's own colours, with a way back to the hub.
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
        Object.assign(b.style, { display: 'inline-flex', alignItems: 'center', minHeight: '44px', padding: '0 18px', borderRadius: '12px', border: '0', cursor: 'pointer',
          font: '600 16px/1 var(--font-text, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)', textDecoration: 'none',
          background: primary ? 'var(--tint-fill, #00098b)' : 'var(--fill, rgba(118,118,128,.12))', color: primary ? 'var(--on-tint, #fff)' : 'var(--ink, #101116)' });
        row.appendChild(b);
      };
      if (o.own) btn('Open Fleet Management', true, { href: location.pathname });
      btn('Back to FLR Hub', !o.own, { href: HUB });
      if (o.retry) btn('Try again', false, { run: () => location.reload() });
      if (o.switchAccount) btn('Use another account', false, { run: async () => { try { await client().auth.signOut({ scope: 'local' }); } catch (e) { /* leave anyway */ } location.replace(SIGN_IN); } });
      card.append(h, p, row); box.appendChild(card); document.body.appendChild(box); h.focus();
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }

  // Switched off, or new and still waiting for a Super Admin to check who it is (Hub migration 2.2): the Hub knows which.
  async function offOrWaiting() {
    let waiting = false;
    try { const h = await client().rpc('hub_home'); waiting = !!(h && h.data && h.data.waiting); } catch (e) { /* treated as switched off */ }
    if (waiting) blocked('Your account is waiting for a Super Admin', 'They’ll check it’s really you, then switch on your tools. You don’t need to do anything.');
    else blocked('Your FLR account is switched off', 'Ask an FLR Super Admin to switch it back on.');
  }

  // quiet: a re-read in the background. If it fails, the page keeps what it shows; the next visit says why.
  async function fetchData(quiet) {
    const c = client();
    if (!c) { if (!quiet) blocked('Fleet Management can’t start', 'This copy of the FLR site has no sign-in settings (flr-config.js).'); return null; }
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) { if (quiet) return null; location.replace(SIGN_IN); return new Promise(() => {}); }   // the hub signs people in, then brings them back
    let r;
    try { r = PREVIEW ? await c.rpc('speeding_preview', { p_driver: PREVIEW }) : await c.rpc('speeding_data'); }
    catch (e) { r = { error: e }; }
    if (!r.error) return r.data;
    if (quiet) return null;
    const code = flrCode(r.error), why = detailOf(r.error);
    if (code === 'FLR_SIGN_IN_REQUIRED' || expired(r.error)) { location.replace(SIGN_IN); return new Promise(() => {}); }
    if (code === 'FLR_FORBIDDEN' && why === 'speeding.unlinked') blocked('Nothing to show you yet', 'Fleet Management shows each driver their own speeding, driving score and vehicle details. If you drive an FLR vehicle, ask an FLR administrator to link your FLR account to your name.', { switchAccount: true });
    else if (code === 'FLR_FORBIDDEN' && why === 'speeding.off') blocked('Fleet Management is switched off', 'An FLR administrator has turned it off for now. Try again later.');
    else if (code === 'FLR_FORBIDDEN' && why === 'speeding.preview') blocked('Only administrators can preview', 'Previewing another driver’s page is for FLR administrators.', { own: true });
    else if (code === 'FLR_VALIDATION' && PREVIEW) blocked('That driver isn’t in the current report', 'Go back to Fleet Management and choose a driver from the list.', { own: true });
    else if (code === 'FLR_FORBIDDEN') blocked('You don’t have access to Fleet Management', 'Ask an FLR administrator if you need it.', { switchAccount: true });
    else if (code === 'FLR_ACCOUNT_DISABLED') await offOrWaiting();
    else if (code === 'FLR_NO_PROFILE') blocked('Your account isn’t set up for FLR tools', 'Ask an FLR administrator to finish setting it up.');
    else if (missing(r.error)) blocked('Fleet Management isn’t set up yet', 'Its data hasn’t been added to the FLR database.');
    else if (offline(r.error)) blocked('Can’t reach the FLR database', 'Check your connection, then try again.', { retry: true });
    else blocked('Fleet Management didn’t load', 'Something went wrong on the way. Try again in a moment.', { retry: true });
    return null;
  }
  function take(d) {
    const photos = Object.create(null);
    for (const [k, v] of Object.entries((d && d.photos) || {})) if (typeof v === 'string' && PHOTO.test(v)) photos[k] = v;
    window.__FLR_PHOTOS = photos;
    data = { docs: (d && d.docs) || {}, collections: (d && d.collections) || {} };
    const s = d && d.scope && typeof d.scope === 'object' ? d.scope : { kind: 'all' };
    scope = Object.freeze({ kind: s.kind === 'driver' ? 'driver' : 'all', admin: s.admin === true, preview: s.preview === true,
      driver: typeof s.driver === 'string' ? s.driver : '', regs: Object.freeze((Array.isArray(s.regs) ? s.regs : []).filter(x => typeof x === 'string')),
      withheld: Object.freeze((Array.isArray(s.withheld) ? s.withheld : []).filter(x => typeof x === 'string')) });
    document.documentElement.dataset.hub = scope.kind;
    loadedAt = Date.now();
    try { sig = JSON.stringify(d); } catch (e) { sig = String(Date.now()); }
  }
  // Administrators link FLR accounts to FleetView drivers from the page. The database checks the caller every time.
  async function call(fn, args) {
    const r = await client().rpc(fn, args || {});
    if (!r.error) return r.data;
    const code = flrCode(r.error), why = detailOf(r.error);
    if (code === 'FLR_SIGN_IN_REQUIRED' || expired(r.error)) { location.replace(SIGN_IN); return new Promise(() => {}); }
    throw new Error(code === 'FLR_VALIDATION' && why ? why : code === 'FLR_FORBIDDEN' ? 'Only FLR administrators can change sign-ins.'
      : offline(r.error) ? 'Can’t reach the FLR database. Check your connection, then try again.' : 'That didn’t save. Try again in a moment.');
  }
  const hub = {
    get scope() { return scope; },
    links: () => call('speeding_links'),
    link: (account, driver) => call('speeding_link', { p_account: account, p_driver: driver || '' }),
    previewHref: driver => location.pathname + '?preview=' + encodeURIComponent(driver),
    exitPreviewHref: () => location.pathname,
  };
  async function load() { const d = await fetchData(); if (!d) return false; take(d); return true; }

  // The same shapes the Claude database hands the page.
  const snap = v => ({ exists: v != null, data: () => v });
  function deliver(s) {
    try {
      if (s.kind === 'doc') s.cb(snap(Object.prototype.hasOwnProperty.call(data.docs, s.name) ? data.docs[s.name] : null));
      else s.cb({ docs: (data.collections[s.name] || []).map(x => ({ data: () => x })) });
    } catch (e) { console.error(e); }
  }
  function subscribe(kind, name) {
    return {
      onSnapshot(cb, onError) {
        const s = { kind, name, cb, onError };
        subs.push(s);
        setTimeout(() => deliver(s), 0);
        return () => { const i = subs.indexOf(s); if (i >= 0) subs.splice(i, 1); };
      },
    };
  }
  const db = Object.freeze({ doc: name => subscribe('doc', name), collection: name => subscribe('collection', name) });
  window.claude = Object.freeze({ use: async name => name === 'db' && (await (loading || (loading = load()))) ? db : null });
  window.FLRHUB = Object.freeze(hub);

  // FLR's server updates the data every 15 minutes (FleetView and the Monday fleet board). Coming back to the page after
  // five minutes, or keeping it open for fifteen, reads it again; every subscription gets the new version, and only
  // when something changed, so a quiet read never redraws the page under the reader.
  let rereading = false;
  async function reread() {
    if (rereading || !data) return;
    rereading = true; loadedAt = Date.now();
    try {
      const d = await fetchData(true);
      if (!d) return;
      const was = scope, before = sig;
      take(d);
      // Linked, unlinked or made an administrator since the page opened: start again with the view they have now.
      if (was && (was.kind !== scope.kind || was.driver !== scope.driver)) { location.reload(); return; }
      if (sig !== before) subs.slice().forEach(deliver);
    } finally { rereading = false; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - loadedAt >= FRESH_MS) reread();
  });
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - loadedAt >= OPEN_MS) reread(); }, 60 * 1000);
})();
