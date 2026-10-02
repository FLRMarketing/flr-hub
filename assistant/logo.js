/* ============================================================================
   FLR Hub: on a tool, the FLR logo goes back to the Hub. Every Hub tool (and the
   Fitter Schedule) loads assistant.js, which loads this whether or not Likkle
   Jeff is switched on. (It was part of Likkle Jeff's file until 2 Oct 2026.)
   ========================================================================== */
const HUB = new URL('../', new URL('.', import.meta.url));
const PAGE = location.pathname.includes('/fitter-schedule/') ? 'fitters'
  : (location.pathname.startsWith(HUB.pathname) ? location.pathname.slice(HUB.pathname.length).split('/')[0] : '') || 'hub';

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
