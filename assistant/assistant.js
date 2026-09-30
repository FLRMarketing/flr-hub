/* ============================================================================
   FLR Hub Assistant: "Likkle Jeff" (first called "Ask the Hub"), a compact help
   button on every Hub page.
   Version 1 is search, not AI. It finds the best answer in the Hub's approved
   help (help.json) and links straight to the right page, and says so when it
   can't find one. It changes nothing. Asked about the person's own leave,
   driving or quotations, it looks them up read-only (records.js) with their own
   sign-in, through the same database functions the tools' pages use, so it
   shows exactly what their page would. It also asks the FLR database which tools
   the person has (hub_home), so it can say "that isn't on your Hub" instead of
   linking somewhere they can't open.
   Its face is the FLR character (face.css): six drawings of him, one per mood.
   He floats and tilts his head now and then, lifts when you reach for him,
   thinks while a look-up takes a moment and reacts to what it finds.
   Add it to a page with:
     <script type="module" src="<hub>/assistant/assistant.js?v=2.1"></script>
   On a release, bump ?v= in the pages AND in V and the engine import below
   (GitHub Pages caches files for 10 minutes).
   ========================================================================== */
import { buildIndex, search, searchSlots, maybes, hubWords, properNames, unaddressed } from './engine.js?v=2.1';
import { pickLine, moodFor } from './lines.js?v=2.1';

const V = '2.1';
const HERE = new URL('.', import.meta.url);
const HUB = new URL('../', HERE);
const AUTH_KEY = 'flr-estimator-auth';                 // the FLR sign-in every Hub page shares
const LOG_KEY = 'flr-assist:log', GUIDE_KEY = 'flr-assist:guide';
const NAMES = { hub: 'the Hub', estimator: 'the Cost Estimator', speeding: 'Fleet Management', 'annual-leave': 'Annual Leave', fitters: 'the Fitter Schedule' };
const PAGE = location.pathname.includes('/fitter-schedule/') ? 'fitters'
  : (location.pathname.startsWith(HUB.pathname) ? location.pathname.slice(HUB.pathname.length).split('/')[0] : '') || 'hub';
// The Fitter Schedule has its own way in (a team passcode) and lives outside the Hub's folder: people use it without
// signing in to the Hub, so on it the assistant doesn't send them to sign in first, or link them to the page they're on.
const OWN_ACCESS = PAGE === 'fitters';
const mqNarrow = matchMedia('(max-width: 699px)');
const narrow = () => mqNarrow.matches;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = () => matchMedia('(pointer: coarse)').matches;

const ICON = {
  ask: '<svg class="fab-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6c-4.8 0-8.5 3.3-8.5 7.5 0 2.2 1 4.1 2.6 5.5l-.8 3.7 3.9-1.9c.9.3 1.8.4 2.8.4 4.8 0 8.5-3.3 8.5-7.7S16.8 3.6 12 3.6z"/><path d="M9.8 9.3a2.25 2.25 0 1 1 3.2 2c-.6.3-1 .8-1 1.5v.3"/><path stroke-width="2.5" d="M12 15.8h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 16 16.5 7.5M9.5 7.5h7v7"/></svg>',
};

/* ---------------------------------------------------------------- who is asking: only the tools on their Hub, never their records */
// This decides which links to offer, nothing more. What anyone can actually open or read is decided by the FLR database
// on each page; the assistant never fetches leave, quotes or driver data, so it has none to show.
const session = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; } };
// The Hub's settings (where the FLR sign-in is). Hub pages load them; a page outside the Hub's folder (the Fitter
// Schedule) may not have yet, so the first time they're needed they come from the Hub.
let configP = null;
const hubConfig = () => configP || (configP = window.FLR_CONFIG ? Promise.resolve() : new Promise(done => {
  const sc = document.createElement('script');
  sc.src = new URL('flr-config.js', HUB).href;
  sc.onload = sc.onerror = () => done();
  document.head.append(sc);
}));
let ctxMemo = null;
function context() {
  const s = session(), token = (s && s.access_token) || '';
  if (ctxMemo && ctxMemo.token === token) return ctxMemo.p;   // asked again after signing in or out: look again
  const p = (async () => {
    const unknown = { signedIn: true, name: '', role: '', tools: null, urls: {}, titles: {} };   // offer every link; pages still check
    if (!token) return { ...unknown, signedIn: false };
    await hubConfig();
    const cfg = window.FLR_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || (s.expires_at && s.expires_at * 1000 < Date.now())) return unknown;
    try {
      const r = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/hub_home', {
        method: 'POST', headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!r.ok) return unknown;
      const h = await r.json(), titles = {}, urls = { estimator: new URL('estimator/', HUB).href };
      for (const t of h.tiles || []) if (t && t.id) { titles[t.id] = t.title; if (t.url) urls[t.id] = new URL(t.url, HUB).href; }
      return { signedIn: true, name: h.name || '', role: h.role || '', tools: new Set(['hub', 'estimator', ...Object.keys(titles)]), urls, titles };
    } catch (e) { return unknown; }
  })();
  ctxMemo = { token, p };
  return p;
}
const toolName = (id, ctx) => (ctx && ctx.titles[id]) || NAMES[id] || 'the Hub';

/* ---------------------------------------------------------------- the approved help, loaded the first time someone asks */
let helpP = null;
function help() {
  return helpP || (helpP = fetch(new URL('help.json?v=' + V, HERE), { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error('help ' + r.status);
    return r.json();
  }).then(h => ({
    index: buildIndex(h.entries), byId: new Map(h.entries.map(e => [e.id, e])),
    // Words the help writes with a capital (Fleet Management, Annual Leave, the Jeff Day): not taken for a person's name.
    words: hubWords(h),
  })).catch(err => { helpP = null; throw Object.assign(err instanceof Error ? err : new Error(String(err)), { help: true }); }));
}

/* ---------------------------------------------------------------- the button and the panel (built once, in their own shadow root) */
// His face: a drawing of him for each mood (face/*.webp), stacked in one box so face.css can fade from one to the next.
// Only the thumbs-up comes with the page; the rest follow once the page has settled, or as soon as you reach for him.
const art = f => new URL(f + '?v=' + V, HERE).href;
const MOODS = { idle: 'default', think: 'thinking', cheer: 'celebrating', care: 'reassuring', unsure: 'unsure', grr: 'angry' };
const face = cls => `<span class="face${cls ? ' ' + cls : ''}" data-mood="idle" aria-hidden="true"><span class="face-float"><span class="face-body">`
  + Object.values(MOODS).map(n => `<img class="f-${n}" ${n === 'default' ? 'src' : 'data-src'}="${art('face/' + n + '.webp')}" alt="" draggable="false" decoding="async">`).join('')
  + `</span></span><span class="face-shadow"></span></span>`;
const host = document.createElement('flr-assistant');
host.style.display = 'none';                         // until its stylesheets have arrived
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<link rel="stylesheet" href="${art('face.css')}"><link rel="stylesheet" href="${art('assistant.css')}">
<button class="fab" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="fa-panel" aria-label="Ask Likkle Jeff">${face('')}${ICON.ask}<span class="fab-x" aria-hidden="true">${ICON.x}</span><span class="fab-label" aria-hidden="true">Ask Likkle Jeff</span><span class="fab-nudge" aria-hidden="true">Ask me for help</span></button>
<dialog class="panel" id="fa-panel" aria-labelledby="fa-title" aria-describedby="fa-sub">
  <div class="head"><span class="grabber" aria-hidden="true"></span><span class="head-face">${face('mini')}</span><div class="head-text"><h2 id="fa-title">Likkle Jeff</h2><p id="fa-sub">Answers from the Hub’s help and from what your tools show you. He can’t change anything.</p></div>
    <button class="x" type="button" aria-label="Close">${ICON.x}</button></div>
  <div class="log" role="log" aria-live="polite"></div>
  <div class="suggest" hidden></div>
  <form class="composer" novalidate><label class="sr" for="fa-q">Your question</label>
    <input id="fa-q" type="text" autocomplete="off" autocapitalize="sentences" enterkeyhint="send" maxlength="200" placeholder="Ask about leave, estimates, fleet…">
    <button class="send" type="submit" aria-label="Ask" disabled>${ICON.send}</button></form>
  <p class="foot">Answers come from the Hub’s help and from what your tools show you, and nothing more. For anything else, ask an FLR administrator.</p>
</dialog>`;
const $ = s => root.querySelector(s);
const fab = $('.fab'), panel = $('.panel'), logEl = $('.log'), suggestEl = $('.suggest'), form = $('.composer'), input = $('#fa-q'), sendBtn = $('.send');
{ let n = 0; for (const l of root.querySelectorAll('link')) l.addEventListener('load', () => { if (++n === 2) host.style.display = ''; }); }
// If his picture can't load, the button falls back to a plain round one, so it's never an invisible button.
fab.querySelector('.f-default').addEventListener('error', () => fab.classList.add('noart'));
document.body.appendChild(host);

// Follow a page's own light/dark switch (the Fleet page's data-mode, others' data-theme), otherwise the device; and step
// aside while a page shows its own dialog or sheet (Annual Leave and the Fitter Schedule mark theirs with html.overlay-open).
const pageModal = () => { try { return !!document.querySelector('dialog:modal'); } catch (e) { return false; } };
function syncPage() {
  const h = document.documentElement, m = h.getAttribute('data-mode') || h.getAttribute('data-theme');
  if (m === 'dark' || m === 'light') host.setAttribute('data-scheme', m); else host.removeAttribute('data-scheme');
  const covered = h.classList.contains('overlay-open') || pageModal();
  host.toggleAttribute('data-covered', covered);
  if (covered && panel.open && !panel.matches(':modal')) close();
}
syncPage();
new MutationObserver(syncPage).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-theme', 'class'] });
new MutationObserver(syncPage).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });

/* ---------------------------------------------------------------- the way back: on a tool, the FLR logo goes to the Hub */
// Every tool loads this file, so it's the one place that can do this for all of them without changing their pages. Each
// draws its logo its own way; clicks on it are caught before the tool's own handler (Fleet Management's logo went to its
// Drivers page and the Estimator's to its projects, which its own "Projects" button still does). When this tab came from
// the Hub, it's a step back through the tab's history (so the Hub is as they left it); otherwise the Hub opens. Either
// way the Hub's own slide plays (hub.css). Pages that redraw or relabel their logo get it put back each time.
const LOGO = { speeding: '.nb-brand', estimator: '.brand', 'annual-leave': '.brand', fitters: '.brand' }[PAGE];
if (LOGO) {
  const toHub = () => {
    const nav = window.navigation, here = nav && nav.currentEntry;
    const hub = here && nav.entries().slice(0, here.index).reverse().find(en => {
      try { const u = new URL(en.url); return u.origin === HUB.origin && u.pathname === HUB.pathname; } catch (e) { return false; }
    });
    if (hub) nav.traverseTo(hub.key); else location.assign(HUB.href);
  };
  const want = (n, k, v) => { if (n.getAttribute(k) !== v) n.setAttribute(k, v); };   // unchanged: no mutation, no loop
  const dress = () => {
    for (const n of document.querySelectorAll(LOGO)) {
      if (n.localName === 'a') want(n, 'href', HUB.href); else { want(n, 'role', 'link'); want(n, 'tabindex', '0'); n.style.cursor = 'pointer'; }
      want(n, 'aria-label', 'Back to the FLR Hub');
      want(n, 'title', 'Back to the FLR Hub');
    }
  };
  dress();
  new MutationObserver(dress).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'aria-label'] });
  const onLogo = ev => ev.target instanceof Element && ev.target.closest(LOGO);
  document.addEventListener('click', ev => {
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || !onLogo(ev)) return;   // a new tab: the link does that
    ev.preventDefault(); ev.stopImmediatePropagation(); toHub();
  }, true);
  document.addEventListener('keydown', ev => {                 // the logos that aren't links: Enter, as on a link
    if (ev.key === 'Enter' && onLogo(ev) && ev.target.localName !== 'a') { ev.preventDefault(); toHub(); }
  }, true);
}

// Keep clear of what a page keeps in the bottom-right corner. Tab bars at the bottom come for free: those pages set
// --tabbar-h, which the button's position adds (assistant.css). These are the rest: the Estimator's sticky bar with
// "Save room" and the Fleet map's zoom buttons and key.
const AVOID = { estimator: '.editor-sticky', speeding: '#view-map:not(.off) .leaflet-bottom.leaflet-right' }[PAGE];
if (AVOID) {
  let queued = false;
  const clearance = () => {
    queued = false;
    let need = 0;
    for (const n of document.querySelectorAll(AVOID)) {
      const r = n.getBoundingClientRect();
      if (!r.height || r.top >= innerHeight || r.bottom < innerHeight - 96 || r.right < innerWidth - 96) continue;
      need = Math.max(need, Math.ceil(innerHeight - r.top) + 12);
    }
    host.style.setProperty('--fa-clear', need + 'px');
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(clearance); } };
  addEventListener('scroll', later, { passive: true, capture: true });
  addEventListener('resize', later, { passive: true });
  addEventListener('hashchange', () => { later(); setTimeout(later, 350); setTimeout(later, 900); });
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  later();
}

// Phones: keep the sheet above the on-screen keyboard, which covers the page rather than resizing it.
if (window.visualViewport) {
  const vv = visualViewport;
  const fit = () => {
    const kb = panel.open && narrow() ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    host.style.setProperty('--fa-kb', kb + 'px');
    host.style.setProperty('--fa-vh', kb ? Math.round(vv.height) + 'px' : '100dvh');
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

/* ---------------------------------------------------------------- his mood (face.css draws each one) */
const faces = [...root.querySelectorAll('.face')], fabFace = fab.querySelector('.face');
// The other five drawings: once the page has settled, or straight away if you reach for him first.
let facesAsked = false;
function loadFaces() {
  if (facesAsked) return;
  facesAsked = true;
  for (const img of root.querySelectorAll('.face img[data-src]')) { img.src = img.dataset.src; img.removeAttribute('data-src'); img.decode().catch(() => null); }
}
{
  const settle = () => ('requestIdleCallback' in window ? requestIdleCallback(loadFaces, { timeout: 5000 }) : setTimeout(loadFaces, 2000));
  if (document.readyState === 'complete') settle(); else addEventListener('load', settle, { once: true });
}
// A mood shows only once its drawing is here (until then he stays as he is), and the passing ones last a moment, then
// he's back to his thumbs-up; "then" is the mood to go on to instead (after a fault: a reassuring one, as it's explained).
const HOLD = { cheer: 1400, care: 2400, unsure: 2400, grr: 1300, land: 450 };
const drawn = m => { const img = fabFace.querySelector('.f-' + MOODS[m]); return !MOODS[m] || (img.complete && img.naturalWidth > 0); };
const whenDrawn = (m, ms = 1500) => new Promise(done => {   // for a mood straight after the page opens, when it may still be on its way
  if (drawn(m)) return done(true);
  const img = fabFace.querySelector('.f-' + MOODS[m]), t = setTimeout(() => done(false), ms);
  img.addEventListener('load', () => { clearTimeout(t); done(true); }, { once: true });
});
let moodTimer = 0;
function mood(m, then) {
  clearTimeout(moodTimer);
  if (m === 'rest' || !drawn(m)) m = 'idle';
  for (const f of faces) {
    if (f.dataset.mood === m && HOLD[m]) { f.dataset.mood = ''; void f.offsetWidth; }   // the same again: replay its movement
    f.dataset.mood = m;
  }
  if (HOLD[m]) moodTimer = setTimeout(() => mood(then || 'idle'), HOLD[m]);
}
// Now and then, while he's idle, a small tilt of the head.
(function tiltLater() {
  setTimeout(() => {
    if (!reduced() && !document.hidden) for (const f of faces) if (f.dataset.mood === 'idle' && !f.hasAttribute('data-look')) { f.classList.remove('tilt'); void f.offsetWidth; f.classList.add('tilt'); }
    tiltLater();
  }, 6000 + Math.random() * 8000);
})();
for (const f of faces) f.addEventListener('animationend', ev => { if (ev.animationName === 'face-tilt') f.classList.remove('tilt'); });
// Hover or keyboard focus: he lifts a little towards you.
{
  const look = on => { fabFace.toggleAttribute('data-look', on); if (on) loadFaces(); };
  fab.addEventListener('pointerenter', ev => { if (ev.pointerType !== 'touch') look(true); else loadFaces(); });
  fab.addEventListener('pointerleave', () => look(fab.matches(':focus-visible')));
  fab.addEventListener('focus', () => { loadFaces(); if (fab.matches(':focus-visible')) look(true); });
  fab.addEventListener('blur', () => look(false));
}
/* ---------------------------------------------------------------- his speech bubble: "Ask me for help" */
// It pops up as soon as a page opens and he's on screen, then again the moment the page goes quiet: a pause of a second
// with no pointer, touch, key or scroll (any shorter and it would flicker on and off while someone scrolls). Once each
// pause: after it's shown, the person has to do something before it comes again, so someone reading a long page isn't
// nagged every few seconds. Not while the chat is open, over a page's own sheet or while the page is out of sight. It
// goes after 8 seconds, or at the next thing the person does anywhere else; a tap on it opens the chat, like the button
// it's part of. Screen readers aren't told: they don't always pass their keys to the page, so someone listening to it
// could look idle.
const QUIET = 1000, SHOWN = 8000;
let lastStir = Date.now(), armed = true, opening = true, nudgeTimer = 0;   // opening: the page has only just opened
function hideNudge() { clearTimeout(nudgeTimer); fab.classList.remove('nudge'); }
function stir(ev) {
  if (ev && ev.type === 'pointermove' && !ev.movementX && !ev.movementY) return;   // the browser's own, not a person's
  lastStir = Date.now(); armed = true;
  const towardHim = ev && (ev.type === 'pointermove' || (ev.composedPath && ev.composedPath().includes(fab)));
  if (fab.classList.contains('nudge') && !towardHim) hideNudge();   // a pointer on the move may be on its way to him
}
for (const t of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) addEventListener(t, stir, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => stir());
const LINE_KEY = 'flr-assist:line', nudgeEl = fab.querySelector('.fab-nudge');
const quietHere = () => !document.hidden && !panel.open && !host.hasAttribute('data-covered') && !fab.classList.contains('noart');
// What he says comes from lines.js: for this page, signing in or the time of day, with their first name if the Hub
// tells it quickly enough; never the line he said last, even on the page before.
async function nudge(first) {
  const s = session(), ctx = await Promise.race([context(), wait(600).then(() => null)]).catch(() => null);
  if (!quietHere() || (!first && Date.now() - lastStir < QUIET)) return;   // they were back before he'd picked his words
  let last = '';
  try { last = sessionStorage.getItem(LINE_KEY) || ''; } catch (e) { /* no storage */ }
  const line = pickLine({ page: PAGE, signedIn: ctx ? ctx.signedIn : !!(s && s.access_token), name: (ctx && ctx.name) || '', last });
  try { sessionStorage.setItem(LINE_KEY, line); } catch (e) { /* private window */ }
  nudgeEl.textContent = line;
  fab.classList.add('nudge');
  mood(moodFor(line));
  clearTimeout(nudgeTimer); nudgeTimer = setTimeout(hideNudge, SHOWN);
}
(function listen() {
  if (host.style.display === 'none') { setTimeout(listen, 100); return; }   // not on screen yet: his stylesheets are on their way
  const left = QUIET - (Date.now() - lastStir);
  if ((opening || left <= 0) && armed && quietHere()) { const first = opening; opening = false; armed = false; setTimeout(() => nudge(first), first ? 400 : 0); }
  setTimeout(listen, left > 0 ? Math.max(100, left) : 250);
})();

/* ---------------------------------------------------------------- the conversation: kept for this tab (it follows you between pages), for this person */
const uid = () => { const s = session(); return (s && s.user && s.user.id) || ''; };
let log = [], logUid = uid();
try { const saved = JSON.parse(sessionStorage.getItem(LOG_KEY) || 'null'); if (saved && saved.uid === logUid) log = saved.items || []; } catch (e) { log = []; }
const saveLog = () => { try { sessionStorage.setItem(LOG_KEY, JSON.stringify({ uid: logUid, items: log.slice(-30) })); } catch (e) { /* private window: fine */ } };
function samePerson() {   // someone signed in or out on this page: start their conversation afresh
  if (uid() === logUid) return true;
  logUid = uid(); log = []; saveLog();
  return false;
}
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

const tokensUnknown = (H, q) => search(H.index, q, {}).terms.some(t => !H.index.df.has(t));
/* ---------------------------------------------------------------- your own records (records.js, loaded the first time they're asked about) */
// A question about your own leave, driving or quotations is answered from the FLR database, as you and read-only. The
// answers stay on this page: the chat's saved history keeps only the question, so leaving the page forgets them.
const kept = new Map();   // answers looked up on this page
let recordsP = null;
const records = () => recordsP || (recordsP = import(art('records.js')).catch(err => { recordsP = null; throw err; }));
const QUOTE_REF = /\b(?:[a-z]{1,5}-)?\d{4}-\d{1,5}\b/i;   // Q-2026-041, FLR-2026-0001
const QUOTE_WORD = /\b(quotes?|quotations?|estimates?)\b/i;
const PLATE = /\b[a-z]{2}\d{2}\s?[a-z]{3}\b|\b[a-z]\d{1,3}\s?[a-z]{3}\b/gi;   // AB12 CDE, A123 BCD: a vehicle registration
// slots: names in the question the help doesn't know ("Sarah", "Faye's van"). soft: the answer rests on a guess (a name,
// or that this is a quote search), so if the records don't know it, answer as if there were no look-up.
async function lookUpFor(e, q, ctx, { slots = [], soft = false } = {}) {
  if (!e || !e.data || !ctx.signedIn || gate(e, ctx) !== 'ok') return null;
  const R = await records();
  if (e.data === 'quotes.find') { const x = R.quoteQuery(q); if (!x.refs.length && !x.terms.length && !x.mine && !x.state && !x.month) return null; }   // "how do I find a quote?" is help
  const s = session();
  const card = await R.lookUp(e.data, q, { uid: (s && s.user && s.user.id) || '', name: ctx.name }, slots);
  if (!card || (soft && card.empty)) return null;
  const ref = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  kept.set(ref, card);
  return { k: 'records', id: e.id, ref, error: !!card.error };
}

// Where to start, by page (and for Fleet Management, by who's asking).
function starters(ctx) {
  if (!ctx.signedIn && !OWN_ACCESS) return ['signin', 'account-new', 'password-forgot'];
  switch (PAGE) {
    case 'estimator': return ['estimate-new', 'estimate-find', 'estimate-approve', 'estimate-print'];
    case 'speeding': return ctx.role === 'admin' ? ['fleet-review', 'fleet-link', 'fleet-map', 'fleet-vehicles'] : ['fleet-my-driving', 'fleet-incident', 'fleet-nothing', 'fleet-privacy'];
    case 'annual-leave': return ['leave-request', 'leave-balance', 'leave-diary', 'leave-approve'];
    case 'fitters': return ['fitters-free', 'fitters-jobs', 'fitters-views', 'fitters-passcode'];
    default: return ['leave-request', 'estimate-new', 'fleet-find', 'fitters-free'];
  }
}

function chip(label, onClick) { const b = el('button', 'chip', label); b.type = 'button'; b.addEventListener('click', onClick); return b; }
function chipsFor(ids, H, ctx) {   // with ctx: leave out tools that aren't on this person's Hub
  const box = el('div', 'chips');
  for (const id of ids) {
    const e = H.byId.get(id);
    if (e && !(ctx && gate(e, ctx) === 'missing')) box.append(chip(e.title, () => askId(id)));
  }
  return box;
}
function gate(e, ctx) {
  if (!ctx.signedIn && e.link && e.link.tile && !(OWN_ACCESS && e.tool === PAGE)) return 'signin';
  if (!e.tool || e.tool === 'hub' || !ctx.tools) return 'ok';
  if (!ctx.tools.has(e.tool)) return 'missing';
  if (e.who === 'admin' && ctx.role && ctx.role !== 'admin') return 'admin';
  if (e.who === 'estimator' && ctx.role === 'developer') return 'viewonly';
  return 'ok';
}
function linkFor(e, ctx) {
  const href = e.link.tile ? ctx.urls[e.link.tile] : e.link.href;
  if (!href) return null;
  const url = new URL(href, HUB);
  if (!/^https?:$/.test(url.protocol)) return null;
  const onSite = url.origin === location.origin;          // the Hub and the Fitter Schedule: this tab, and the next steps follow
  const a = el('a', 'go', e.link.label || `Open ${toolName(e.tool, ctx)}`);
  a.href = url.href;
  a.insertAdjacentHTML('beforeend', onSite ? ICON.chev : ICON.ext);
  if (!onSite) { a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', `${a.textContent} (opens in a new tab)`); return a; }
  a.addEventListener('click', () => {
    if (url.pathname !== location.pathname) {   // another page: carry on with the steps when it opens
      try { sessionStorage.setItem(GUIDE_KEY, JSON.stringify({ id: e.id, at: Date.now() })); } catch (err) { /* ignore */ }
    } else if (narrow()) close();                // this page: get the sheet out of the way
  });
  return a;
}
function answerEl(m, H, ctx) {
  const e = H.byId.get(m.id);
  if (!e) return null;
  const g = gate(e, ctx), b = el('div', 'msg bot');
  b.append(el('h3', null, e.title));
  for (const para of String(e.answer).split('\n\n')) b.append(el('p', null, para));
  if (e.steps && e.steps.length && g === 'ok') { const ol = el('ol'); for (const s of e.steps) ol.append(el('li', null, s)); b.append(ol); }
  if (g === 'missing') b.append(el('p', 'note', `${toolName(e.tool, ctx)} isn’t on your Hub. Ask an FLR administrator if you need it.`));
  if (g === 'admin') b.append(el('p', 'note', 'This is for FLR administrators.'));
  if (g === 'viewonly') b.append(el('p', 'note', 'Your role can view quotations but not create or change them.'));
  if (g === 'signin') {
    b.append(el('p', 'note', `Sign in to the Hub first, then open ${toolName(e.tool, ctx)} from there.`));
    const a = el('a', 'go', 'Go to the Hub'); a.href = HUB.href; a.insertAdjacentHTML('beforeend', ICON.chev); b.append(a);
  }
  if (e.link && (g === 'ok' || g === 'viewonly') && !(OWN_ACCESS && e.tool === PAGE)) { const a = linkFor(e, ctx); if (a) b.append(a); }
  const rel = chipsFor([...new Set([...(e.related || []), ...(m.rel || [])])].filter(id => id !== e.id).slice(0, 3), H, ctx);
  if (rel.childElementCount) b.append(el('p', 'label', 'Related'), rel);
  return b;
}
function recordsEl(m, H, ctx) {
  const card = kept.get(m.ref), e = H.byId.get(m.id), b = el('div', 'msg bot rec');
  if (!card) {             // from an earlier page: not kept, by design
    b.append(el('p', null, 'Records aren’t kept in this chat once you leave a page. Ask again to see them.'));
    if (e) b.append(chipsFor([e.id], H, ctx));
    return b;
  }
  b.append(el('h3', null, card.title));
  if (card.sub) b.append(el('p', 'rec-sub', card.sub));
  if (card.big != null) {
    const p = el('p', 'rec-big');
    p.append(el('span', 'rec-num' + (card.neg ? ' neg' : ''), card.big));
    if (card.unit) p.append(el('span', 'rec-unit', card.unit));
    b.append(p);
  }
  if (card.rows) {
    const dl = el('dl', 'rec-rows');
    for (const [k, v, tone] of card.rows) { const d = el('div'); d.append(el('dt', null, k), el('dd', tone ? 'tone-' + tone : null, v)); dl.append(d); }
    b.append(dl);
  }
  if (card.list) {
    const ul = el('ul', 'rec-list');
    for (const it of card.list) {
      const li = el('li'), t = el('div', 'rec-li');
      t.append(el('b', null, it.title));
      if (it.meta) t.append(el('span', null, it.meta));
      li.append(t);
      if (it.pill) li.append(el('span', 'rec-pill' + (it.tone ? ' ' + it.tone : ''), it.pill));
      ul.append(li);
    }
    b.append(ul);
  }
  if (card.text) b.append(el('p', null, card.text));
  if (card.note) b.append(el('p', 'rec-note', card.note));
  if (card.link) { const a = el('a', 'go', card.link.label); a.href = card.link.href; a.insertAdjacentHTML('beforeend', ICON.chev); b.append(a); }
  return b;
}
function render(m, H, ctx) {
  if (m.k === 'me') return el('div', 'msg me', m.t);
  if (m.k === 'answer') return answerEl(m, H, ctx);
  if (m.k === 'records') return recordsEl(m, H, ctx);
  const b = el('div', 'msg bot');
  if (m.k === 'intro') {
    const first = (ctx.name || '').trim().split(/\s+/)[0];
    b.append(el('p', null, `Hi${first ? ' ' + first : ''}. Ask me where to find something on the Hub, or how to do it.`));
    if (!ctx.signedIn && !OWN_ACCESS) b.append(el('p', 'note', 'You’re signed out. Sign in to use the Hub’s tools; I can help with that too.'));
    b.append(chipsFor(starters(ctx), H, ctx));
  } else if (m.k === 'hello') {
    b.append(el('p', null, m.thanks ? 'You’re welcome.' : 'Ask me about a tool or a task, for example:'));
    if (!m.thanks) b.append(chipsFor(starters(ctx), H, ctx));
  } else if (m.k === 'unsure') {
    b.append(el('p', null, 'I’m not sure which of these you mean:'));
    b.append(chipsFor(m.ids, H));
  } else if (m.k === 'none') {
    b.append(el('p', null, 'I couldn’t find that in the Hub’s help, so I won’t guess.'));
    b.append(el('p', null, 'Try other words, or ask an FLR administrator.'));
    b.append(el('p', 'label', 'On the Hub'), chipsFor(['about-estimator', 'about-leave', 'about-fleet', 'about-fitters'], H, ctx));
  } else if (m.k === 'guide') {
    const e = H.byId.get(m.id);
    if (!e || gate(e, ctx) !== 'ok') return null;
    b.append(el('p', null, `Next, in ${toolName(e.tool, ctx)}:`));
    const ol = el('ol'); for (const s of (e.steps || []).filter((x, i) => !(i === 0 && /^Open /.test(x)))) ol.append(el('li', null, s)); b.append(ol);
  } else if (m.k === 'error') {
    b.append(el('p', null, m.help === false
      ? 'Something went wrong on the Hub’s side while I was looking, not with what you asked. Try again in a moment; if it keeps happening, tell an FLR administrator.'
      : 'The Hub’s help didn’t load, so I can’t answer just now. Check your connection, then try again.'));
  }
  return b;
}
let painting = null;   // the panel's first drawing, which a question asked straight away waits for
function paint() { return (painting = draw()); }
async function draw() {
  samePerson();
  const ctx = await context();
  let H = null;
  try { H = await help(); } catch (err) { await grumble(); logEl.replaceChildren(render({ k: 'error' })); return; }
  if (!log.length) log.push({ k: 'intro' });
  logEl.replaceChildren(...log.map(m => render(m, H, ctx)).filter(Boolean));
  logEl.scrollTo({ top: logEl.scrollHeight, behavior: 'instant' });
}
async function push(...ms) {
  if (painting) await painting.catch(() => null);
  if (!samePerson()) await paint();
  log.push(...ms); saveLog();
  const ctx = await context();
  let H = null;
  try { H = await help(); } catch (err) { if (!ms.some(m => m.k === 'error')) await grumble(); logEl.append(render({ k: 'error' })); return; }
  const added = ms.map(m => render(m, H, ctx)).filter(Boolean);
  logEl.append(...added);
  toQuestion();
}
// Bring the latest question to the top of the conversation, so its answer is read from the start.
function toQuestion() {
  const qs = logEl.querySelectorAll('.msg.me'), q = qs[qs.length - 1];
  if (q) logEl.scrollTo({ top: Math.max(0, q.offsetTop - 12), behavior: reduced() ? 'instant' : 'smooth' });
}

function ask(text) {
  const said = String(text || '').trim().slice(0, 200);
  if (!said) return;
  converse(said, async () => {
    const q = unaddressed(said) || said;                 // "Likkle Jeff, …": his name said to him isn't part of the question
    const H = await help(), ctx = await context();
    // A registration reads as "registration" to the search; the records look for the plate itself.
    const plates = q.match(PLATE) || [], plain = plates.length ? q.replace(PLATE, ' registration ') : q;
    // A person named with a capital is set aside first; if the rest isn't a question about records, it goes back in.
    const people = properNames(q, H.words);
    let asked = plain, r = null, slots = [];
    if (people.length) {
      asked = people.reduce((t, n) => t.replace(n, ' '), plain);
      r = searchSlots(H.index, asked, { page: PAGE });
      if (r.confident && H.byId.get(r.results[0].entry.id).data) slots = [...people.flatMap(n => n.toLowerCase().split(' ')), ...r.slots];
      else { asked = plain; r = null; }
    }
    if (!r) { r = searchSlots(H.index, asked, { page: PAGE }); slots = r.slots; }
    const top = r.results[0], ref = QUOTE_REF.test(q);
    if (!r.terms.length && !ref && !people.length) return { k: 'hello', thanks: /^(thanks|thank you|cheers|ta)\b/i.test(q) };
    const named = slots.length > 0;                         // understood only once the names were set aside
    const id = r.confident ? top.entry.id : ref ? 'estimate-find' : null;   // a quote number is always a look-up
    if (id && !(named && !H.byId.get(id).data)) {           // a guess about names needs records to check it against
      const got = await lookUpFor(H.byId.get(id), q, ctx, { slots, soft: named });
      if (got) return got;
      if (!named) return { k: 'answer', id, rel: r.confident ? r.results.slice(1).filter(x => x.score >= top.score * 0.7).slice(0, 2).map(x => x.entry.id) : [] };
    }
    // "The henderson quote": a quote named by words the help doesn't know (a client, a site) is worth looking for.
    if (QUOTE_WORD.test(q) && tokensUnknown(H, q)) {
      const got = await lookUpFor(H.byId.get('estimate-find'), q, ctx, { soft: true });
      if (got) return got;
    }
    if (named) { const first = search(H.index, asked, { page: PAGE }); const maybe = maybes(first).map(x => x.entry.id); return maybe.length ? { k: 'unsure', ids: maybe } : { k: 'none' }; }
    const maybe = maybes(r).map(x => x.entry.id);
    return maybe.length ? { k: 'unsure', ids: maybe } : { k: 'none' };
  });
}
function askId(id) {
  help().then(H => {
    const e = H.byId.get(id);
    if (e) converse(e.title, async () => (await lookUpFor(e, e.title, await context())) || { k: 'answer', id });
  }).catch(() => null);
}
// One question at a time: show it, then the reply as soon as it's ready, never held back for effect. Only if it takes
// longer than a blink (a look-up in the FLR database, or the help's first load) does he think, with dots in the chat.
let queue = Promise.resolve();
const wait = ms => new Promise(r => setTimeout(r, ms));
function thinking(on) {
  const t = logEl.querySelector('.typing');
  if (!on) { if (t) t.remove(); return; }
  if (t) return;
  const d = el('div', 'msg bot typing'); d.setAttribute('aria-hidden', 'true'); d.append(el('i'), el('i'), el('i'));
  logEl.append(d);
  toQuestion();                                        // they come a moment after the question: bring them into view too
}
function converse(q, work) {
  queue = queue.then(async () => {
    await push({ k: 'me', t: q });
    const slow = setTimeout(() => { mood('think'); thinking(true); }, 180);
    let m;
    try { m = await work(); } catch (err) { m = { k: 'error', help: !!(err && err.help) }; }
    clearTimeout(slow); thinking(false);
    const r = await reaction(m);
    if (r === 'grr') await grumble();
    await push(m);
    if (r !== 'grr') mood(r);
  }).catch(() => { thinking(false); mood('rest'); });
}
// Something broke on the Hub's side: a moment's playful grump, then the explanation (which the caller shows), and he
// turns reassuring while you read it. Never for what someone asked or got wrong: that's the unsure or reassuring face.
async function grumble() { mood('grr', 'care'); await wait(reduced() ? 250 : 450); }
// How he takes a reply. Found it: a celebration. Privacy, sign-in, someone's own leave or driving, or bad news (a date
// overdue, a request declined): reassuring. Nothing found, or which one: unsure. A fault on the Hub's side: the grump.
const CARE_DATA = /^(leave\.|fleet\.(me|review|serious)$)/;
const badNews = card => [...(card.list || []), ...(card.rows || []).map(r => ({ tone: r[2] }))].some(x => x.tone === 'over');
async function reaction(m) {
  if (m.k === 'error') return 'grr';
  if (m.k === 'unsure' || m.k === 'none') return 'unsure';
  if (m.k === 'hello') return 'care';
  const H = await help().catch(() => null), ctx = await context(), e = H && H.byId.get(m.id);
  if (m.k === 'answer') return e && gate(e, ctx) === 'ok' && !e.care && !CARE_DATA.test(e.data || '') ? 'cheer' : 'care';
  if (m.k === 'records') {
    const card = kept.get(m.ref) || {};
    if (card.fault) return 'grr';
    if (card.unsure || card.empty) return 'unsure';
    return card.error || card.care || (e && CARE_DATA.test(e.data || '')) || badNews(card) ? 'care' : 'cheer';
  }
  return 'idle';
}

/* ---------------------------------------------------------------- typing: suggestions as you go */
let typing = 0;
input.addEventListener('input', () => {
  sendBtn.disabled = !input.value.trim();
  clearTimeout(typing);
  typing = setTimeout(async () => {
    const q = input.value.trim();
    if (q.length < 3) { suggestEl.hidden = true; return; }
    const H = await help().catch(() => null);
    if (!H) return;
    const items = search(H.index, input.value, { page: PAGE, typing: true }).results.filter(x => x.score >= 6).slice(0, 3);
    suggestEl.replaceChildren(...items.map(x => chip(x.entry.title, () => { input.value = ''; sendBtn.disabled = true; suggestEl.hidden = true; askId(x.entry.id); })));
    suggestEl.hidden = !items.length;
  }, 120);
});
form.addEventListener('submit', ev => {
  ev.preventDefault();
  const q = input.value;
  input.value = ''; sendBtn.disabled = true; suggestEl.hidden = true;
  if (coarse()) input.blur();                          // phones: put the keyboard away so the answer is in view
  ask(q);
});

/* ---------------------------------------------------------------- opening and closing: from the button, back to the button */
let anim = null;
const EASE_OUT = 'cubic-bezier(.2,.9,.25,1)', EASE_IN = 'cubic-bezier(.3,0,.8,.15)';
const ty = () => { const t = getComputedStyle(panel).transform; return t && t !== 'none' ? new DOMMatrix(t).m42 : 0; };
// Stop every animation on the panel. A closing one holds its end (faded and shrunk, or slid off the screen) until it's
// stopped: left holding, it hid the panel again the moment the next opening finished, so the chat opened unseen (on
// phones, behind a dimmed page) until the page was reloaded.
const letGo = () => { for (const a of panel.getAnimations()) a.cancel(); anim = null; };
function open(focusInput = true, instant = false) {
  if (panel.open) return;
  letGo();
  help().catch(() => null);                            // start loading while the panel moves
  if (narrow()) panel.showModal(); else panel.show();
  fab.setAttribute('aria-expanded', 'true');
  fab.classList.remove('note');
  hideNudge(); opening = false;                        // not over the chat
  paint();
  loadFaces();
  mood('rest');
  if (!narrow()) {                                     // grow out of him: his centre is the panel's origin
    const p = panel.getBoundingClientRect(), f = fabFace.getBoundingClientRect();
    panel.style.transformOrigin = `${Math.round(f.left + f.width / 2 - p.left)}px ${Math.round(f.top + f.height / 2 - p.top)}px`;
  }
  if (!instant) {
    anim = panel.animate(reduced() ? [{ opacity: 0 }, { opacity: 1 }]
      : narrow() ? [{ transform: 'translateY(100%)' }, { transform: 'none' }]
      : [{ opacity: 0, transform: 'scale(.3)', offset: 0 }, { opacity: 1, offset: 0.45 }, { transform: 'none' }],
    { duration: reduced() ? 150 : narrow() ? 420 : 460, easing: 'cubic-bezier(.2,.95,.3,1.04)' });
  }
  if (focusInput && !coarse()) input.focus({ preventScroll: true });
}
function close(velocity = 0) {
  if (!panel.open) return;
  const from = ty();                                   // wherever it is now, even mid-animation
  letGo();
  const done = () => {
    panel.close(); panel.style.transform = ''; letGo();    // closed first, so letting go of its end shows nothing
    fab.setAttribute('aria-expanded', 'false');
    thinking(false);
    mood('land');                                      // back in his corner: a small settle
    if (!coarse()) fab.focus({ preventScroll: true });
  };
  if (reduced()) { anim = panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }); anim.onfinish = done; return; }
  anim = narrow()
    ? panel.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(100%)' }],
      { duration: Math.max(180, 320 - Math.min(velocity, 2000) / 10), easing: EASE_IN, fill: 'forwards' })
    : panel.animate([{ opacity: 1, transform: 'none' }, { opacity: 1, offset: 0.4 }, { opacity: 0, transform: 'scale(.3)' }], { duration: 260, easing: EASE_IN, fill: 'forwards' });
  anim.onfinish = done;
}
fab.addEventListener('click', () => (panel.open ? close() : open()));
$('.x').addEventListener('click', () => close());
panel.addEventListener('cancel', ev => { ev.preventDefault(); close(); });
panel.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !panel.matches(':modal')) { ev.preventDefault(); close(); } });
panel.addEventListener('click', ev => { if (ev.target === panel && narrow()) close(); });   // a tap on the dimmed page closes the sheet
mqNarrow.addEventListener('change', () => {           // turned a tablet, or resized the window: a sheet on phones, a panel otherwise
  if (!panel.open) return;
  panel.close(); panel.style.transform = '';
  open(false, true);
});

// On phones the sheet follows your finger down from its top edge; a flick or a long drag closes it.
{
  let g = null;
  const head = $('.head');
  head.addEventListener('pointerdown', ev => {
    if (!narrow() || ev.button !== 0 || ev.target.closest('button')) return;
    const base = ty();                                 // catch it mid-animation where it is
    if (anim) anim.cancel();
    panel.style.transform = base ? `translateY(${base}px)` : '';
    g = { y: ev.clientY - base, pts: [[ev.clientY, ev.timeStamp]], id: ev.pointerId };
    try { head.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
  });
  head.addEventListener('pointermove', ev => {
    if (!g || ev.pointerId !== g.id) return;
    const dy = ev.clientY - g.y;
    panel.style.transform = `translateY(${dy > 0 ? dy : -Math.sqrt(-dy) * 2}px)`;   // resists being pulled up
    g.pts.push([ev.clientY, ev.timeStamp]); if (g.pts.length > 5) g.pts.shift();
  });
  const up = ev => {
    if (!g || ev.pointerId !== g.id) return;
    const dy = ev.clientY - g.y, [a, b] = [g.pts[0], g.pts[g.pts.length - 1]];
    const v = b[1] > a[1] ? (b[0] - a[0]) / ((b[1] - a[1]) / 1000) : 0;           // px per second, downwards
    g = null;
    if (dy + v * 0.2 > panel.offsetHeight * 0.3 && v > -200) { close(v); return; }
    anim = panel.animate([{ transform: panel.style.transform || 'none' }, { transform: 'none' }], { duration: 360, easing: EASE_OUT });
    panel.style.transform = '';
  };
  head.addEventListener('pointerup', up);
  head.addEventListener('pointercancel', up);
}

/* ---------------------------------------------------------------- arriving from one of its own links: carry on with the next steps */
(async () => {
  let g = null;
  try { g = JSON.parse(sessionStorage.getItem(GUIDE_KEY) || 'null'); sessionStorage.removeItem(GUIDE_KEY); } catch (err) { /* ignore */ }
  if (!g || Date.now() - g.at > 60000) return;
  const H = await help().catch(() => null), e = H && H.byId.get(g.id);
  if (!e || e.tool !== PAGE || !(e.steps && e.steps.length)) return;
  const ctx = await context();
  if (gate(e, ctx) !== 'ok') return;
  log.push({ k: 'guide', id: e.id }); saveLog();
  if (narrow()) { fab.classList.add('note'); return; }
  open(false);
  if (await whenDrawn('cheer')) mood('cheer');          // you got there: here are the next steps
})();
