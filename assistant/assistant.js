/* ============================================================================
   FLR Hub: what every Hub page, and the Fitter Schedule, loads from here.
     - logo.js: on a tool, the FLR logo goes back to the Hub. Always on.
     - jeff.js: Likkle Jeff, the help button in the corner. Switched off for now
       (the user, 2 Oct 2026: take him off for now, but don't delete him: he's
       coming back). Set JEFF to true to bring him back exactly as he was;
       nothing of his has gone (jeff.js, lines.js, engine.js, records.js,
       help.json, face/).
   Pages load it with:
     <script type="module" src="<hub>/assistant/assistant.js?v=2.1"></script>
   On a release, bump ?v= in the pages and in the imports here and in jeff.js
   (GitHub Pages caches files for 10 minutes).
   ========================================================================== */
import './logo.js?v=2.1';

const JEFF = false;   // Likkle Jeff: true shows him on every page again
if (JEFF) import('./jeff.js?v=2.1');
