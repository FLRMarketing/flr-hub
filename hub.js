/* ============================================================================
   FLR Hub: the front door to FLR's staff tools.
   Sign-in is the FLR account the Cost Estimator uses (Supabase). The hub and the
   Estimator live on one site and keep the session under the same storage key,
   so signing in here signs you in there too, and signing out signs out of both.
   Links to private tools are never written into this page: the database hands
   each one only to the accounts it is meant for (public.hub_home()).
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const root = document.documentElement;
  const cfg = window.FLR_CONFIG || {};
  const AUTH_KEY = 'flr-estimator-auth';   // the Cost Estimator's key: one sign-in for the whole site
  const NAME_KEY = 'flr-hub:name';         // this browser only: greet people by name before the database answers
  const ROLES = { estimator: 'Estimator', admin: 'Administrator', developer: 'Developer' };
  const ESTIMATOR = { id: 'estimator', title: 'Cost Estimator', subtitle: 'Price commercial flooring jobs and build quotes.', url: 'estimator/' };
  const ICONS = { estimator: 'i-estimator', speeding: 'i-speeding', 'annual-leave': 'i-leave', fitters: 'i-fitters' };
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const strongEnough = p => p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: the hub still works */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  // iOS Safari applies :active only when the page listens for touches; press feedback has to start on touch-down.
  document.addEventListener('touchstart', () => {}, { passive: true });
  // The slide back from a tool is skipped when the page arrives hidden (a background tab): nothing to report.
  addEventListener('pagereveal', e => { const t = e.viewTransition; if (t) { t.ready.catch(() => {}); t.finished.catch(() => {}); t.updateCallbackDone.catch(() => {}); } });

  /* ---------------------------------------------------------------- motion: the Speeding Report's spring
     Damping 1 = no overshoot; response = seconds to (roughly) arrive. Motion always starts from the
     live on-screen value and carries the finger's velocity, so a sheet can be caught mid-flight. */
  class Spring {
    constructor(value, o = {}) {
      this.x = value; this.v = 0; this.target = value; this.raf = 0; this.onRest = null;
      this.precision = o.precision || .5; this.onUpdate = o.onUpdate || null;
      this.set(o.damping == null ? 1 : o.damping, o.response || .4);
      this._step = this._step.bind(this);
    }
    set(damping, response) { this.damping = damping; this.response = response; this.k = Math.pow(2 * Math.PI / response, 2); this.c = 4 * Math.PI * damping / response; return this; }
    to(target, o = {}) {
      if (o.damping != null || o.response != null) this.set(o.damping == null ? this.damping : o.damping, o.response || this.response);
      if (o.velocity != null) this.v = o.velocity;
      this.target = target; this.onRest = o.onRest || null;
      if (reduced()) { this.jump(target); const r = this.onRest; this.onRest = null; if (r) r(); return this; }
      if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this._step); }
      return this;
    }
    jump(value) { this.stop(); this.x = this.target = value; this.v = 0; if (this.onUpdate) this.onUpdate(value, 0); return this; }
    stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; return this; }
    get moving() { return !!this.raf; }
    _step(now) {
      const dt = clamp((now - this.last) / 1000, 0, .064); this.last = now;
      const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
      for (let i = 0; i < n; i++) { const a = -this.k * (this.x - this.target) - this.c * this.v; this.v += a * h; this.x += this.v * h; }
      if (Math.abs(this.v) < this.precision * 12 && Math.abs(this.x - this.target) < this.precision) {
        this.x = this.target; this.v = 0; this.raf = 0;
        if (this.onUpdate) this.onUpdate(this.x, 0);
        const r = this.onRest; this.onRest = null; if (r) r();
        return;
      }
      if (this.onUpdate) this.onUpdate(this.x, this.v);
      this.raf = requestAnimationFrame(this._step);
    }
  }
  // Where a flick would come to rest (Apple's exponential-decay projection).
  const project = (v, d = .998) => (v / 1000) * d / (1 - d);
  // Past a boundary, follow less and less: responsive, but clearly the end.
  const rubberband = (over, dim, c = .55) => (over * dim * c) / (dim + c * Math.abs(over));
  function Tracker() {
    const p = [];
    return {
      add(e) { p.push([e.clientY, e.timeStamp || performance.now()]); while (p.length > 2 && p[p.length - 1][1] - p[0][1] > 100) p.shift(); },
      v() { if (p.length < 2) return 0; const a = p[0], b = p[p.length - 1], dt = (b[1] - a[1]) / 1000; return dt > 0 ? (b[0] - a[0]) / dt : 0; },
      clear() { p.length = 0; },
    };
  }

  /* ---------------------------------------------------------------- sheets: rise on a spring, drag the top edge down to dismiss */
  const sheets = (() => {
    const states = new WeakMap();
    function state(dlg) {
      let s = states.get(dlg);
      if (s) return s;
      s = { dlg, panel: dlg.querySelector('.panel'), scrim: dlg.querySelector('.scrim'), H: 1, closing: false };
      s.spring = new Spring(0, { damping: 1, response: .42, onUpdate: y => paint(s, y) });
      states.set(dlg, s); bind(s);
      return s;
    }
    function paint(s, y) { s.panel.style.setProperty('--y', y.toFixed(2) + 'px'); s.scrim.style.opacity = clamp(1 - y / s.H, 0, 1).toFixed(3); }
    function measure(s) { s.panel.style.setProperty('--y', '0px'); return Math.max(160, innerHeight - s.panel.getBoundingClientRect().top + 16); }
    function fade(s, inward, then) {
      const kf = inward ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
      if (inward) s.scrim.style.opacity = '1';
      const a = s.panel.animate(kf, { duration: 200, easing: 'ease', fill: 'forwards' });
      const b = s.scrim.animate(kf, { duration: 200, easing: 'ease', fill: 'forwards' });
      a.onfinish = () => { if (then) then(); a.cancel(); b.cancel(); };
    }
    function open(id) {
      const dlg = document.getElementById(id);
      if (!dlg) return;
      const s = state(dlg);
      if (dlg.open && !s.closing) return;
      s.closing = false;
      if (!dlg.open) { dlg.showModal(); root.classList.add('sheet-open'); }
      s.H = measure(s);
      const first = dlg.querySelector('input');
      if (first && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
      if (reduced()) { s.spring.jump(0); fade(s, true); return; }
      if (!s.spring.moving) s.spring.jump(s.H);
      s.spring.to(0, { damping: 1, response: .42 });
    }
    function close(dlg, o = {}) {
      if (!dlg || !dlg.open) return;
      const s = state(dlg);
      const done = () => {
        s.closing = false; s.spring.jump(s.H); dlg.close();
        if (!document.querySelector('dialog.sheet[open]')) root.classList.remove('sheet-open');
      };
      if (o.instant) { done(); return; }
      if (s.closing) return;
      s.closing = true;
      if (reduced()) { fade(s, false, done); return; }
      s.spring.to(s.H, { velocity: o.velocity || 0, damping: 1, response: .34, onRest: () => { if (s.closing) done(); } });
    }
    function bind(s) {
      const { dlg } = s;
      dlg.addEventListener('cancel', e => { e.preventDefault(); close(dlg); });
      dlg.addEventListener('click', e => { if (e.target === s.scrim || e.target.closest('[data-close]')) close(dlg); });
      let g = null; const tr = Tracker();
      dlg.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        const head = e.target.closest('.sheet-head');
        if (!head || e.target.closest('button,a,input')) return;
        s.spring.stop(); s.closing = false;   // caught mid-flight: carry on from where it is on screen
        g = { sy: e.clientY, y0: s.spring.x, id: e.pointerId }; tr.clear(); tr.add(e);
        try { head.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        dlg.classList.add('dragging');
      });
      dlg.addEventListener('pointermove', e => {
        if (!g || e.pointerId !== g.id) return;
        tr.add(e);
        let y = g.y0 + e.clientY - g.sy;
        if (y < 0) y = -rubberband(-y, s.panel.offsetHeight);
        s.spring.x = y; s.spring.v = 0; paint(s, y);
      });
      const up = e => {
        if (!g || e.pointerId !== g.id) return;
        g = null; dlg.classList.remove('dragging'); tr.add(e);
        const v = tr.v();
        if (s.spring.x + project(v) > s.H * .42 && v > -150) close(dlg, { velocity: v });
        else s.spring.to(0, { velocity: v, damping: 1, response: .36 });
      };
      dlg.addEventListener('pointerup', up);
      dlg.addEventListener('pointercancel', up);
    }
    return { open, close };
  })();

  /* ---------------------------------------------------------------- the FLR account (Supabase) */
  let sb = null;
  function client() {
    if (sb) return sb;
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) return null;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_KEY },
    });
    return sb;
  }
  // The Cost Estimator's wording, so both front doors say the same thing.
  function describeAuthError(e, context) {
    if (!e) return 'Something went wrong. Try again.';
    const m = String(e.message || '');
    if (e.status === 429 || /rate limit|too many/i.test(m)) return 'Too many attempts. Wait a few minutes and try again.';
    if (/Failed to fetch|NetworkError|fetch failed|Load failed|network/i.test(m) || e.status === 0) return 'The FLR sign-in service could not be reached. Check your connection and try again.';
    if (context === 'signin') {
      if (/Invalid login credentials|invalid_credentials/i.test(m)) return 'The email address or password is not right.';
      if (/Email not confirmed|email_not_confirmed/i.test(m)) return 'This account has not been confirmed yet. Use the link in the confirmation email, or ask your FLR administrator.';
    }
    if (context === 'signup') {
      if (/already registered|already exists|user_already_exists|already been registered/i.test(m)) return 'An account already exists for that email address. Sign in, or use “Forgotten your password?”.';
      if (/FLR_REGISTRATION_CLOSED/i.test(m)) return 'Registration is closed at the moment. Contact your FLR administrator.';
      if (/FLR_NAME_REQUIRED/i.test(m)) return 'Enter your full name.';
      if (/Database error saving new user|FLR_ACCESS_CODE|unexpected_failure/i.test(m)) return 'The FLR access code was not accepted (it is case-sensitive), or registration is closed at the moment. Ask your FLR administrator for the current code.';
      if (/Signups not allowed|signup_disabled/i.test(m)) return 'Registration is disabled in the account service. Contact your FLR administrator.';
      if (/weak|Password should|password/i.test(m)) return 'The password does not meet the requirements.';
      if (/invalid.*email|email.*invalid|validation_failed/i.test(m)) return 'Enter a valid email address.';
    }
    if (context === 'update' && /same_password|different from the old/i.test(m)) return 'Choose a password you have not used before.';
    if (context === 'update' && /weak|Password should|password/i.test(m)) return 'The new password does not meet the requirements.';
    return m || 'Something went wrong. Try again.';
  }
  const flrCode = e => { const m = /FLR_[A-Z_]+/.exec(e ? `${e.message || ''} ${e.details || ''}` : ''); return m ? m[0] : ''; };
  const missingFunction = e => !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message || ''));
  const offline = e => !!e && /Failed to fetch|NetworkError|Load failed|fetch failed/i.test(e.message || '');
  const expired = e => !!e && (e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT expired|invalid JWT/i.test(e.message || ''));
  const ACCOUNT = {
    FLR_ACCOUNT_DISABLED: 'Your FLR account is switched off. Ask an FLR administrator to switch it back on.',
    FLR_NO_PROFILE: 'You signed in, but this account has no FLR profile yet. Ask an FLR administrator.',
    FLR_SIGN_IN_REQUIRED: 'Your sign-in has expired. Sign in again.',
  };

  /* ---------------------------------------------------------------- views */
  let current = 'boot';
  function show(name, o = {}) {
    const apply = () => {
      document.body.dataset.view = name;
      $('#signin').hidden = name !== 'signin';
      $('#home').hidden = name !== 'home';
      $('#setup').hidden = name !== 'setup';
      $('#bar').hidden = name !== 'home';
      current = name;
      scrollTo(0, 0);
    };
    if (o.animate && current !== 'boot' && current !== name && typeof document.startViewTransition === 'function' && !reduced()) {
      let t;
      // The FLR mark flies between the sign-in screen and the bar; everything else cross-fades.
      try { t = document.startViewTransition({ update: apply, types: ['flr-swap'] }); } catch (e) { t = document.startViewTransition(apply); }
      t.ready.catch(() => {}); t.finished.catch(() => {});   // skipped when the page is hidden: nothing to report
      return t.updateCallbackDone.catch(() => apply());
    }
    apply();
    return Promise.resolve();
  }
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  function initials(text) {
    const w = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!w.length) return '';
    if (w.length === 1) return w[0][0].toUpperCase();
    return (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }
  const SAME_SITE = /^[a-z0-9][a-z0-9-]{0,39}\/$/;   // a page of this site, such as speeding/ (opens in the same tab)
  // A full address on this same web address (another FLR site such as the Fitter Schedule) opens in the same tab too.
  const sameOrigin = u => { try { return new URL(u).origin === location.origin; } catch (e) { return false; } };
  const safeTile = t => {
    if (!t || typeof t.title !== 'string' || typeof t.url !== 'string') return false;
    if (SAME_SITE.test(t.url)) return true;
    try { return new URL(t.url).protocol === 'https:'; } catch (e) { return false; }
  };
  function tileEl(t, o = {}) {
    const li = $('#tile-tpl').content.firstElementChild.cloneNode(true);
    const a = li.querySelector('.tile-link'), tip = li.querySelector('.tile-tip');
    if (o.loading) { li.classList.add('tile--loading'); li.setAttribute('aria-hidden', 'true'); a.tabIndex = -1; tip.remove(); return li; }
    const external = /^https:/i.test(t.url) && !sameOrigin(t.url);
    a.href = t.url;
    if (external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    const icon = li.querySelector('.app-icon');
    icon.classList.add('app-icon--' + (ICONS[t.id] ? t.id : 'link'));
    icon.querySelector('use').setAttribute('href', '#' + (ICONS[t.id] || 'i-tile'));
    li.querySelector('.tile-name').textContent = t.title;
    // The card is the link's description, so screen readers hear it without hovering.
    tip.id = 'tip-' + t.id;
    a.setAttribute('aria-describedby', tip.id);
    li.querySelector('.tip-title').textContent = t.title;
    const text = li.querySelector('.tip-text');
    text.textContent = t.subtitle || ''; text.hidden = !t.subtitle;
    const host = external ? new URL(t.url).hostname : '';
    li.querySelector('.tip-go-label').textContent = !external ? 'Opens here' : /(^|\.)claude\.ai$/.test(host) ? 'Opens in Claude' : 'Opens in a new tab';
    li.querySelector('.tip-go use').setAttribute('href', external ? '#i-external' : '#i-chevron');
    return li;
  }

  /* ---------------------------------------------------------------- the description card that rises from each icon */
  // Centred under its icon, nudged in from the screen edges, and above the icon when there's no room below.
  function placeTip(li) {
    const tip = li.querySelector('.tile-tip');
    if (!tip) return;
    li.classList.remove('tip-off');
    // The screen's own width: on phones innerWidth grows with anything that overflows, so it can't be trusted here.
    const vw = document.documentElement.clientWidth;
    const r = li.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, m = 12;
    const left = r.left + r.width / 2 - w / 2;
    const dx = left < m ? m - left : left + w > vw - m ? vw - m - (left + w) : 0;
    tip.style.setProperty('--tip-dx', `${Math.round(dx)}px`);
    li.classList.toggle('tip-up', r.bottom + 10 + h > innerHeight - m && r.top - 10 - h > m);
  }
  const tilesEl = $('#tiles');
  const hideTips = () => document.querySelectorAll('.tile.show-tip').forEach(li => li.classList.remove('show-tip'));
  // Every card is placed as soon as its icon is on screen (and again when the window changes size), so even a hidden
  // card never reaches past the screen edge.
  let placing = 0;
  const placeAll = () => { if (placing) return; placing = requestAnimationFrame(() => { placing = 0; tilesEl.querySelectorAll('.tile').forEach(placeTip); }); };
  new MutationObserver(placeAll).observe(tilesEl, { childList: true });
  addEventListener('resize', placeAll);
  tilesEl.addEventListener('pointerover', e => { const li = e.target.closest('.tile'); if (li && !li.contains(e.relatedTarget)) placeTip(li); });
  tilesEl.addEventListener('focusin', e => { const li = e.target.closest('.tile'); if (li) placeTip(li); });
  // Touch screens have no hover: a long press shows the card and a tap still opens the tool, as on iPhone.
  let press = null, swallowUntil = 0;
  tilesEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    const li = e.target.closest('.tile:not(.tile--loading)');
    if (!li) return;
    const p = press = { x: e.clientX, y: e.clientY, fired: false };
    p.timer = setTimeout(() => { hideTips(); placeTip(li); li.classList.add('show-tip'); p.fired = true; }, 450);
  });
  tilesEl.addEventListener('pointermove', e => { if (press && !press.fired && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; } });
  // Lifting the finger after a long press must not also open the tool; only that one release is ignored.
  const endPress = () => { if (!press) return; clearTimeout(press.timer); if (press.fired) swallowUntil = Date.now() + 600; press = null; };
  tilesEl.addEventListener('pointerup', endPress);
  tilesEl.addEventListener('pointercancel', endPress);
  tilesEl.addEventListener('click', e => { if (Date.now() < swallowUntil) { e.preventDefault(); swallowUntil = 0; } }, true);
  tilesEl.addEventListener('contextmenu', e => { if (e.target.closest('.tile')) e.preventDefault(); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.tile.show-tip')) hideTips(); }, true);
  addEventListener('scroll', hideTips, { passive: true });
  // Escape hides the card until the pointer or focus moves on, so it never covers what someone is reading.
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideTips(); tilesEl.querySelectorAll('.tile').forEach(li => li.classList.add('tip-off')); } });
  tilesEl.addEventListener('pointerout', e => { const li = e.target.closest('.tile'); if (li && !li.contains(e.relatedTarget)) li.classList.remove('tip-off'); });
  tilesEl.addEventListener('focusout', e => { const li = e.target.closest('.tile'); if (li) li.classList.remove('tip-off'); });
  function renderHome(home, o = {}) {
    const name = (home && home.name) || '';
    const first = name.trim().split(/\s+/)[0] || '';
    $('#today').textContent = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    $('#greeting').textContent = first ? `${greeting()}, ${first}` : greeting();
    const ini = initials(name || (home && home.email) || '') || '·';
    $('#account-btn').textContent = ini; $('#acct-initials').textContent = ini;
    $('#account-btn').setAttribute('aria-label', name ? `Your account: ${name}` : 'Your account');
    $('#acct-name').textContent = name || 'Your FLR account';
    $('#acct-email').textContent = (home && home.email) || '';
    const role = home && ROLES[home.role];
    $('#acct-role').textContent = role || ''; $('#acct-role').hidden = !role;
    const tiles = [tileEl(ESTIMATOR)];
    if (o.loading) tiles.push(tileEl(null, { loading: true }));
    else for (const t of (home && home.tiles) || []) if (safeTile(t)) tiles.push(tileEl(t));
    $('#tiles').replaceChildren(...tiles);
    const n = $('#home-notice'); n.querySelector('span').textContent = o.notice || ''; n.hidden = !o.notice;
  }
  function rise(els) {
    if (reduced()) return;
    els.forEach((el, i) => el.animate(
      [{ opacity: 0, transform: 'translateY(16px) scale(.98)' }, { opacity: 1, transform: 'none' }],
      { duration: 560, delay: 90 + i * 60, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'backwards' }));
  }

  /* ---------------------------------------------------------------- loading the signed-in person's hub */
  let loading = null, signingOut = false;
  function loadHome(o = {}) {
    if (loading) return loading;
    loading = (async () => {
      const c = client();
      let r = await c.rpc('hub_home');
      let home = r.error ? null : r.data;
      if (r.error && missingFunction(r.error)) {
        // This database doesn't have the hub's tiles yet: greet the person and still offer the Estimator.
        const m = await c.rpc('me');
        if (!m.error && m.data) home = { name: m.data.name, email: m.data.upn, role: (m.data.roles || [])[0], tiles: [] };
        else r = m;
      }
      if (!home) return failed(r.error, o);
      store.set(NAME_KEY, home.name || '');
      const fresh = current !== 'home';
      renderHome(home);
      await show('home', { animate: o.animate });
      rise([...$('#tiles').children].slice(fresh ? 0 : 1));
      goNext(home);
    })().finally(() => { loading = null; });
    return loading;
  }
  // A tool on this site sent someone here to sign in (…/?next=speeding): once they're in, carry on to it, but only
  // to a page of this site that is one of their tiles.
  function goNext(home) {
    const next = new URLSearchParams(location.search).get('next');
    if (!next) return;
    history.replaceState(null, '', location.pathname + location.hash);   // Back from the tool returns to a plain hub
    const path = next + '/';
    const theirs = path === ESTIMATOR.url || ((home && home.tiles) || []).some(t => t && t.url === path);
    if (/^[a-z0-9-]{1,40}$/.test(next) && theirs) location.assign(path);
  }
  async function failed(err, o) {
    const code = flrCode(err);
    if (ACCOUNT[code] || expired(err)) {
      signingOut = true;
      const { error } = await client().auth.signOut({ scope: 'local' });
      if (error) store.del(AUTH_KEY);
      store.del(NAME_KEY); signingOut = false;
      formError('#signin-error', ACCOUNT[code] || ACCOUNT.FLR_SIGN_IN_REQUIRED);
      return show('signin', { animate: o.animate });
    }
    // The database couldn't be reached: keep the Estimator tile, say what happened, offer a retry.
    renderHome({ name: store.get(NAME_KEY) || '' }, {
      notice: offline(err) ? 'Can’t reach the FLR sign-in service, so some tools may be missing. Check your connection.' : 'Some of your tools didn’t load.',
    });
    return show('home', { animate: o.animate });
  }

  /* ---------------------------------------------------------------- forms */
  function busy(btn, on, label) {
    const l = btn.querySelector('.btn-label');
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    if (on) { btn.dataset.label = l.textContent; l.textContent = label; }
    else if (btn.dataset.label) l.textContent = btn.dataset.label;
  }
  function formError(sel, text) { const p = $(sel); p.querySelector('span').textContent = text || ''; p.hidden = !text; }
  function fieldError(id, text) {
    const p = $('#' + id + '-err'), input = $('#' + id);
    if (p) { p.textContent = text || ''; p.hidden = !text; }
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    input.closest('.row').setAttribute('aria-invalid', text ? 'true' : 'false');
  }
  const submitBtn = form => form.querySelector('button[type="submit"]');

  $('#signin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = submitBtn(e.currentTarget);
    if (btn.getAttribute('aria-busy') === 'true') return;
    const email = $('#si-email').value.trim(), password = $('#si-password').value;
    if (!email || !password) { formError('#signin-error', 'Enter your email address and password.'); (email ? $('#si-password') : $('#si-email')).focus(); return; }
    formError('#signin-error', ''); busy(btn, true, 'Signing in…');
    const { error } = await client().auth.signInWithPassword({ email, password });
    if (error) { busy(btn, false); formError('#signin-error', describeAuthError(error, 'signin')); $('#si-password').select(); return; }
    $('#si-password').value = '';
    await loadHome({ animate: true });
    busy(btn, false);
  });

  // Registration: the same account and the same access code as the Cost Estimator.
  const REG = ['rg-name', 'rg-email', 'rg-password', 'rg-confirm', 'rg-code'];
  let regTried = false;
  function checkRegister() {
    const v = { name: $('#rg-name').value.trim(), email: $('#rg-email').value.trim(), password: $('#rg-password').value, confirm: $('#rg-confirm').value, code: $('#rg-code').value.trim() };
    const errs = {};
    if (!v.name) errs['rg-name'] = 'Enter your full name.';
    if (!EMAIL.test(v.email)) errs['rg-email'] = 'Enter a valid email address.';
    if (!strongEnough(v.password)) errs['rg-password'] = 'Use at least 10 characters, with letters and numbers.';
    if (v.confirm !== v.password) errs['rg-confirm'] = 'The two passwords don’t match.';
    if (!v.code) errs['rg-code'] = 'Enter the FLR access code.';
    return { v, errs };
  }
  // Check each field as the person leaves it (only once they've typed something), not only on submit.
  $('#register-form').addEventListener('focusout', e => {
    const id = e.target.id;
    if (!REG.includes(id)) return;
    if (!regTried && !e.target.value) return;
    fieldError(id, checkRegister().errs[id]);
  });
  $('#register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget, btn = submitBtn(form);
    if (btn.getAttribute('aria-busy') === 'true') return;
    regTried = true;
    const { v, errs } = checkRegister();
    REG.forEach(id => fieldError(id, errs[id]));
    const firstBad = REG.find(id => errs[id]);
    if (firstBad) { $('#' + firstBad).focus(); return; }
    formError('#register-error', ''); busy(btn, true, 'Creating account…');
    const { data, error } = await client().auth.signUp({
      email: v.email, password: v.password,
      options: { data: { full_name: v.name, access_code: v.code }, emailRedirectTo: location.origin + location.pathname },
    });
    busy(btn, false);
    if (error) {
      const msg = describeAuthError(error, 'signup');
      if (/access code/i.test(msg)) { fieldError('rg-code', msg); $('#rg-code').focus(); }
      else if (/valid email/i.test(msg)) { fieldError('rg-email', msg); $('#rg-email').focus(); }
      else formError('#register-error', msg);
      return;
    }
    if (!data || !data.session) {   // only if email confirmation is switched on in Supabase
      $('#register-ok').textContent = 'Account created. Use the link in the email we’ve sent you, then sign in.';
      $('#register-ok').hidden = false;
      return;
    }
    form.reset(); regTried = false; $('#register-ok').hidden = true;
    sheets.close($('#sheet-register'));
    await loadHome({ animate: true });
  });

  $('#forgot-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = submitBtn(e.currentTarget);
    if (btn.getAttribute('aria-busy') === 'true') return;
    const email = $('#fg-email').value.trim();
    $('#forgot-ok').hidden = true;
    if (!EMAIL.test(email)) { formError('#forgot-error', 'Enter the email address you sign in with.'); $('#fg-email').focus(); return; }
    formError('#forgot-error', ''); busy(btn, true, 'Sending…');
    const { error } = await client().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    busy(btn, false);
    if (error) { formError('#forgot-error', describeAuthError(error, 'reset')); return; }
    $('#forgot-ok').textContent = 'If there’s an FLR account for that address, a reset link is on its way. It can take a few minutes to arrive.';
    $('#forgot-ok').hidden = false;
  });

  $('#recover-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget, btn = submitBtn(form);
    if (btn.getAttribute('aria-busy') === 'true') return;
    const p = $('#rc-password').value, again = $('#rc-confirm').value;
    if (!strongEnough(p)) { formError('#recover-error', 'Use at least 10 characters, with letters and numbers.'); $('#rc-password').focus(); return; }
    if (p !== again) { formError('#recover-error', 'The two passwords don’t match.'); $('#rc-confirm').focus(); return; }
    formError('#recover-error', ''); busy(btn, true, 'Saving…');
    const { error } = await client().auth.updateUser({ password: p });
    busy(btn, false);
    if (error) { formError('#recover-error', describeAuthError(error, 'update')); return; }
    form.reset();
    sheets.close($('#sheet-recover'));
    toast('Password changed');
    if (current !== 'home') loadHome({ animate: true });
  });

  $('#account-btn').addEventListener('click', () => sheets.open('sheet-account'));
  $('#signout').addEventListener('click', async () => {
    signingOut = true;
    const { error } = await client().auth.signOut({ scope: 'local' });
    if (error) store.del(AUTH_KEY);   // offline: forget the session on this device anyway
    store.del(NAME_KEY);
    sheets.close($('#sheet-account'));
    await show('signin', { animate: true });
    signingOut = false;
    toast('Signed out');
  });
  $('#home-retry').addEventListener('click', () => loadHome());
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-sheet]');
    if (!b) return;
    if (b.dataset.sheet === 'sheet-forgot' && !$('#fg-email').value) $('#fg-email').value = $('#si-email').value.trim();
    sheets.open(b.dataset.sheet);
  });

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
    }, 2400);
  }
  // The bar's material fades in as content scrolls under it: no hard divider at rest.
  let raf = 0;
  addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; $('#bar').style.setProperty('--bar-mat', clamp(scrollY / 24, 0, 1).toFixed(3)); });
  }, { passive: true });

  /* ---------------------------------------------------------------- start */
  async function boot() {
    const c = client();
    if (!c) return show('setup');
    const stored = !!store.get(AUTH_KEY);
    if (stored) { renderHome({ name: store.get(NAME_KEY) || '' }, { loading: true }); await show('home'); }
    c.auth.onAuthStateChange(event => {
      // Never call Supabase from inside this callback (it can deadlock); hand off to the next task.
      if (event === 'PASSWORD_RECOVERY') setTimeout(() => sheets.open('sheet-recover'), 0);
      else if (event === 'SIGNED_OUT') setTimeout(() => { if (signingOut) return; store.del(NAME_KEY); if (current === 'home') show('signin', { animate: true }); }, 0);
    });
    let session = null;
    try { session = (await c.auth.getSession()).data.session; } catch (e) { /* treated as signed out */ }
    if (session) return loadHome();
    store.del(NAME_KEY);
    return show('signin', { animate: stored });
  }
  boot();
})();
