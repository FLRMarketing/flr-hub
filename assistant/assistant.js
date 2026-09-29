/* ============================================================================
   FLR Hub Assistant: "Ask the Hub", a compact help button on every Hub page.
   Version 1 is search, not AI. It finds the best answer in the Hub's approved
   help (help.json) and links straight to the right page, and says so when it
   can't find one. It is read-only by design: it never fetches or shows leave,
   quotes or driver data and never changes anything. The one thing it asks the
   FLR database is which tools the signed-in person has (hub_home), so it can
   say "that isn't on your Hub" instead of linking somewhere they can't open.
   Add it to a page with:
     <script type="module" src="<hub>/assistant/assistant.js?v=1.1"></script>
   On a release, bump ?v= in the pages AND in V and the engine import below
   (GitHub Pages caches files for 10 minutes).
   ========================================================================== */
import { buildIndex, search, maybes } from './engine.js?v=1.1';

const V = '1.1';
const HERE = new URL('.', import.meta.url);
const HUB = new URL('../', HERE);
const AUTH_KEY = 'flr-estimator-auth';                 // the FLR sign-in every Hub page shares
const LOG_KEY = 'flr-assist:log', GUIDE_KEY = 'flr-assist:guide';
const NAMES = { hub: 'the Hub', estimator: 'the Cost Estimator', speeding: 'Fleet Management', 'annual-leave': 'Annual Leave', fitters: 'the Fitter Schedule' };
const PAGE = location.pathname.includes('/fitter-schedule/') ? 'fitters'
  : (location.pathname.startsWith(HUB.pathname) ? location.pathname.slice(HUB.pathname.length).split('/')[0] : '') || 'hub';
const mqNarrow = matchMedia('(max-width: 699px)');
const narrow = () => mqNarrow.matches;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = () => matchMedia('(pointer: coarse)').matches;

const ICON = {
  ask: '<svg class="ic-ask" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6c-4.8 0-8.5 3.3-8.5 7.5 0 2.2 1 4.1 2.6 5.5l-.8 3.7 3.9-1.9c.9.3 1.8.4 2.8.4 4.8 0 8.5-3.3 8.5-7.7S16.8 3.6 12 3.6z"/><path d="M9.8 9.3a2.25 2.25 0 1 1 3.2 2c-.6.3-1 .8-1 1.5v.3"/><path stroke-width="2.5" d="M12 15.8h.01"/></svg>',
  close: '<svg class="ic-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 16 16.5 7.5M9.5 7.5h7v7"/></svg>',
};

/* ---------------------------------------------------------------- who is asking: only the tools on their Hub, never their records */
// This decides which links to offer, nothing more. What anyone can actually open or read is decided by the FLR database
// on each page; the assistant never fetches leave, quotes or driver data, so it has none to show.
const session = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; } };
let ctxMemo = null;
function context() {
  const s = session(), token = (s && s.access_token) || '';
  if (ctxMemo && ctxMemo.token === token) return ctxMemo.p;   // asked again after signing in or out: look again
  const p = (async () => {
    const cfg = window.FLR_CONFIG || {};
    const unknown = { signedIn: true, name: '', role: '', tools: null, urls: {}, titles: {} };   // offer every link; pages still check
    if (!token) return { ...unknown, signedIn: false };
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
  }).then(h => ({ index: buildIndex(h.entries), byId: new Map(h.entries.map(e => [e.id, e])) })).catch(err => { helpP = null; throw err; }));
}

/* ---------------------------------------------------------------- the button and the panel (built once, in their own shadow root) */
const host = document.createElement('flr-assistant');
host.style.display = 'none';                         // until its stylesheet has arrived
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<link rel="stylesheet" href="${new URL('assistant.css?v=' + V, HERE).href}">
<button class="fab" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="fa-panel" aria-label="Ask the Hub">${ICON.ask}${ICON.close}<span class="fab-label" aria-hidden="true">Ask the Hub</span></button>
<dialog class="panel" id="fa-panel" aria-labelledby="fa-title" aria-describedby="fa-sub">
  <div class="head"><span class="grabber" aria-hidden="true"></span><div class="head-text"><h2 id="fa-title">Ask the Hub</h2><p id="fa-sub">Finds answers in the Hub’s help. It can’t see or change your records.</p></div>
    <button class="x" type="button" aria-label="Close">${ICON.x}</button></div>
  <div class="log" role="log" aria-live="polite"></div>
  <div class="suggest" hidden></div>
  <form class="composer" novalidate><label class="sr" for="fa-q">Your question</label>
    <input id="fa-q" type="text" autocomplete="off" autocapitalize="sentences" enterkeyhint="send" maxlength="200" placeholder="Ask about leave, estimates, fleet…">
    <button class="send" type="submit" aria-label="Ask" disabled>${ICON.send}</button></form>
  <p class="foot">Answers come from the Hub’s own help. For anything else, ask an FLR administrator.</p>
</dialog>`;
const $ = s => root.querySelector(s);
const fab = $('.fab'), panel = $('.panel'), logEl = $('.log'), suggestEl = $('.suggest'), form = $('.composer'), input = $('#fa-q'), sendBtn = $('.send');
root.querySelector('link').addEventListener('load', () => { host.style.display = ''; });
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

// Where to start, by page (and for Fleet Management, by who's asking).
function starters(ctx) {
  if (!ctx.signedIn) return ['signin', 'account-new', 'password-forgot'];
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
  if (!ctx.signedIn && e.link && e.link.tile) return 'signin';
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
  const onSite = url.origin === location.origin && url.pathname.startsWith(HUB.pathname);
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
  if (e.link && (g === 'ok' || g === 'viewonly')) { const a = linkFor(e, ctx); if (a) b.append(a); }
  const rel = chipsFor([...new Set([...(e.related || []), ...(m.rel || [])])].filter(id => id !== e.id).slice(0, 3), H, ctx);
  if (rel.childElementCount) b.append(el('p', 'label', 'Related'), rel);
  return b;
}
function render(m, H, ctx) {
  if (m.k === 'me') return el('div', 'msg me', m.t);
  if (m.k === 'answer') return answerEl(m, H, ctx);
  const b = el('div', 'msg bot');
  if (m.k === 'intro') {
    const first = (ctx.name || '').trim().split(/\s+/)[0];
    b.append(el('p', null, `Hi${first ? ' ' + first : ''}. Ask me where to find something on the Hub, or how to do it.`));
    if (!ctx.signedIn) b.append(el('p', 'note', 'You’re signed out. Sign in to use the Hub’s tools; I can help with that too.'));
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
    b.append(el('p', null, 'The Hub’s help didn’t load. Check your connection, then try again.'));
  }
  return b;
}
let painting = null;   // the panel's first drawing, which a question asked straight away waits for
function paint() { return (painting = draw()); }
async function draw() {
  samePerson();
  const ctx = await context();
  let H = null;
  try { H = await help(); } catch (err) { logEl.replaceChildren(render({ k: 'error' })); return; }
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
  try { H = await help(); } catch (err) { logEl.append(render({ k: 'error' })); return; }
  const added = ms.map(m => render(m, H, ctx)).filter(Boolean);
  logEl.append(...added);
  // Bring the new question to the top of the conversation, so a long answer is read from its start.
  if (added.length) logEl.scrollTo({ top: Math.max(0, added[0].offsetTop - 12), behavior: reduced() ? 'instant' : 'smooth' });
}

async function ask(text) {
  const q = String(text || '').trim().slice(0, 200);
  if (!q) return;
  let H;
  try { H = await help(); } catch (err) { return push({ k: 'me', t: q }, { k: 'error' }); }
  const r = search(H.index, q, { page: PAGE });
  const top = r.results[0];
  if (!r.terms.length) return push({ k: 'me', t: q }, { k: 'hello', thanks: /^(thanks|thank you|cheers|ta)\b/i.test(q) });
  if (r.confident) {
    const rel = r.results.slice(1).filter(x => x.score >= top.score * 0.7).slice(0, 2).map(x => x.entry.id);
    return push({ k: 'me', t: q }, { k: 'answer', id: top.entry.id, rel });
  }
  const maybe = maybes(r).map(x => x.entry.id);
  push({ k: 'me', t: q }, maybe.length ? { k: 'unsure', ids: maybe } : { k: 'none' });
}
async function askId(id) {
  const H = await help().catch(() => null);
  const e = H && H.byId.get(id);
  if (e) push({ k: 'me', t: e.title }, { k: 'answer', id });
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
function open(focusInput = true, instant = false) {
  if (panel.open) return;
  help().catch(() => null);                            // start loading while the panel moves
  if (narrow()) panel.showModal(); else panel.show();
  fab.setAttribute('aria-expanded', 'true');
  fab.classList.remove('note');
  paint();
  if (anim) anim.cancel();
  if (!instant) {
    anim = panel.animate(reduced() ? [{ opacity: 0 }, { opacity: 1 }]
      : narrow() ? [{ transform: 'translateY(100%)' }, { transform: 'none' }]
      : [{ opacity: 0, transform: 'translateY(12px) scale(.92)' }, { opacity: 1, transform: 'none' }],
    { duration: reduced() ? 150 : narrow() ? 420 : 380, easing: EASE_OUT });
  }
  if (focusInput && !coarse()) input.focus({ preventScroll: true });
}
function close(velocity = 0) {
  if (!panel.open) return;
  const from = ty();                                   // wherever it is now, even mid-animation
  if (anim) anim.cancel();
  const done = () => {
    panel.close(); panel.style.transform = ''; anim = null;
    fab.setAttribute('aria-expanded', 'false');
    if (!coarse()) fab.focus({ preventScroll: true });
  };
  if (reduced()) { anim = panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }); anim.onfinish = done; return; }
  anim = narrow()
    ? panel.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(100%)' }],
      { duration: Math.max(180, 320 - Math.min(velocity, 2000) / 10), easing: EASE_IN, fill: 'forwards' })
    : panel.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.94)' }], { duration: 200, easing: EASE_IN, fill: 'forwards' });
  anim.onfinish = done;
}
fab.addEventListener('click', () => (panel.open ? close() : open()));
$('.x').addEventListener('click', () => close());
panel.addEventListener('cancel', ev => { ev.preventDefault(); close(); });
panel.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !panel.matches(':modal')) { ev.preventDefault(); close(); } });
panel.addEventListener('click', ev => { if (ev.target === panel && narrow()) close(); });   // a tap on the dimmed page closes the sheet
mqNarrow.addEventListener('change', () => {           // turned a tablet, or resized the window: a sheet on phones, a panel otherwise
  if (!panel.open) return;
  if (anim) anim.cancel();
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
  if (narrow()) fab.classList.add('note'); else open(false);
})();
