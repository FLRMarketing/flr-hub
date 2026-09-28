/* ============================================================================
   FLR Hub: runs FLR Group Fleet Management (the driver speeding report) on the FLR site.
   The report asks for its database the way it does on Claude
   (window.claude.use('db')). This answers from the FLR database instead,
   after checking the FLR sign-in, and only for the people the Speeding tile
   is for. Nothing about drivers is in this site's files: the data and staff
   photos (as data URLs in window.__FLR_PHOTOS) arrive after sign-in.
   ========================================================================== */
(function () {
  'use strict';
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';        // the FLR sign-in the hub and the Estimator share
  const HUB = '../';
  const SIGN_IN = HUB + '?next=speeding';
  const FRESH_MS = 10 * 60 * 1000;              // re-read when the page comes back to the front after 10 minutes
  const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  let sb = null, data = null, loadedAt = 0, loading = null;
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
      btn('Back to FLR Hub', true, { href: HUB });
      if (o.retry) btn('Try again', false, { run: () => location.reload() });
      if (o.switchAccount) btn('Use another account', false, { run: async () => { try { await client().auth.signOut({ scope: 'local' }); } catch (e) { /* leave anyway */ } location.replace(SIGN_IN); } });
      card.append(h, p, row); box.appendChild(card); document.body.appendChild(box); h.focus();
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }

  async function fetchData() {
    const c = client();
    if (!c) { blocked('FLR Group Fleet Management can’t start', 'This copy of the FLR site has no sign-in settings (flr-config.js).'); return null; }
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (!session) { location.replace(SIGN_IN); return new Promise(() => {}); }   // the hub signs people in, then brings them back
    const r = await c.rpc('speeding_data');
    if (!r.error) return r.data;
    const code = flrCode(r.error);
    if (code === 'FLR_SIGN_IN_REQUIRED' || expired(r.error)) { location.replace(SIGN_IN); return new Promise(() => {}); }
    if (code === 'FLR_FORBIDDEN') blocked('You don’t have access to FLR Group Fleet Management', 'It’s only open to the people on its list. Ask an FLR administrator if you need it.', { switchAccount: true });
    else if (code === 'FLR_ACCOUNT_DISABLED') blocked('Your FLR account is switched off', 'Ask an FLR administrator to switch it back on.');
    else if (code === 'FLR_NO_PROFILE') blocked('Your account isn’t set up for FLR tools', 'Ask an FLR administrator to finish setting it up.');
    else if (missing(r.error)) blocked('FLR Group Fleet Management isn’t set up yet', 'Its data hasn’t been added to the FLR database.');
    else if (offline(r.error)) blocked('Can’t reach the FLR database', 'Check your connection, then try again.', { retry: true });
    else blocked('FLR Group Fleet Management didn’t load', 'Something went wrong on the way. Try again in a moment.', { retry: true });
    return null;
  }
  function take(d) {
    const photos = Object.create(null);
    for (const [k, v] of Object.entries((d && d.photos) || {})) if (typeof v === 'string' && PHOTO.test(v)) photos[k] = v;
    window.__FLR_PHOTOS = photos;
    data = { docs: (d && d.docs) || {}, collections: (d && d.collections) || {} };
    loadedAt = Date.now();
  }
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

  // The refresh jobs update the data every morning and hourly on weekdays: coming back to the page after a while
  // reads it again and hands every subscription the new version.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !data || Date.now() - loadedAt < FRESH_MS) return;
    loadedAt = Date.now();
    const d = await fetchData();
    if (!d) return;
    take(d);
    subs.slice().forEach(deliver);
  });
})();
