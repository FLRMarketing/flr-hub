/* ============================================================================
   FLR Hub: what every Hub page, and the Fitter Schedule, loads from here.
     - logo.js: on a tool, the FLR logo goes back to the Hub. Always on.
     - jeff.js: Likkle Jeff, the help button in the corner. Off from 2 Oct 2026,
       back on 9 Oct 2026 (the user: "turn on little jeff"). Set JEFF to false
       to take him off again without deleting anything (jeff.js, lines.js,
       engine.js, records.js, help.json, face/).
   Pages load it with:
     <script type="module" src="<hub>/assistant/assistant.js?v=2.2"></script>
   On a release, bump ?v= in the pages and in the imports here and in jeff.js
   (GitHub Pages caches files for 10 minutes).
   ========================================================================== */
import './logo.js?v=2.2';

const JEFF = true;    // Likkle Jeff: false takes him off every page
if (JEFF) import('./jeff.js?v=2.2');
