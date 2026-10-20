/* ============================================================================
   FLR Hub: what every Hub page, and the Fitter Schedule, loads from here.
     - logo.js: on a tool, the FLR logo goes back to the Hub. Always on.
     - jeff.js: Likkle Jeff, the help button in the corner. He shows when the
       switch in Hub settings (Super Admins: "Likkle Jeff") is on: this asks the
       FLR database (likkle_jeff_on, Hub migration 2.4) before loading him. If it
       can't ask (offline, or before 2.4) it goes by the last answer in this
       browser, and otherwise shows him, as before the switch existed.
       JEFF below is the code-level override: false keeps him off everywhere,
       whatever the switch says. Nothing of his is deleted either way.
   Pages load it with:
     <script type="module" src="<hub>/assistant/assistant.js?v=2.2"></script>
   On a release, bump ?v= in the pages and in the imports here and in jeff.js
   (GitHub Pages caches files for 10 minutes).
   ========================================================================== */
import './logo.js?v=2.2';

const JEFF = true;    // false keeps him off every page, whatever Hub settings says

const SEEN = 'flr-hub-likkle-jeff';   // this browser's last answer: '1' on, '0' off
const remember = (on) => { try { localStorage.setItem(SEEN, on ? '1' : '0'); } catch (e) { /* private window */ } };
const lastAnswer = () => { try { return localStorage.getItem(SEEN) !== '0'; } catch (e) { return true; } };

async function config() {
  if (window.FLR_CONFIG && window.FLR_CONFIG.supabaseUrl) return window.FLR_CONFIG;
  // The Fitter Schedule loads this file without the Hub's flr-config.js: read the same two public values from it.
  const text = await (await fetch(new URL('../flr-config.js', import.meta.url))).text();
  const pick = (k) => (new RegExp(k + ':\\s*"([^"]+)"').exec(text) || [])[1];
  return { supabaseUrl: pick('supabaseUrl'), supabaseAnonKey: pick('supabaseAnonKey') };
}

// Is the Hub settings switch on? Anyone may ask (signed in or not); the answer is only true or false.
async function switchedOn() {
  try {
    const cfg = await config();
    const ask = fetch(cfg.supabaseUrl + '/rest/v1/rpc/likkle_jeff_on', {
      method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: '{}' });
    const res = await Promise.race([ask, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const on = (await res.json()) !== false;
    remember(on);
    return on;
  } catch (e) {
    return lastAnswer();
  }
}

// Hub settings calls this after a Super Admin flips the switch, so that browser follows at once.
window.FLR_LIKKLE_JEFF_SEEN = remember;

if (JEFF) switchedOn().then((on) => { if (on) import('./jeff.js?v=2.5'); });
