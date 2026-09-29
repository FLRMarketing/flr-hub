#!/bin/sh
# Copies the Cost Estimator's production page into estimator/: the page the hub opens in the same tab.
# The Estimator's source stays in its private repository; only its built page is published here.
#   scripts/sync-estimator.sh            copy the existing build
#   scripts/sync-estimator.sh --build    rebuild the Estimator first (npm run build in its folder)
# ESTIMATOR_DIR overrides where the Estimator lives (default: ../flr-cost-estimator next to this folder).
set -eu
HUB=$(cd "$(dirname "$0")/.." && pwd)
EST=${ESTIMATOR_DIR:-"$HUB/../flr-cost-estimator"}
if [ "${1:-}" = "--build" ]; then (cd "$EST" && npm run build); fi
[ -f "$EST/app/index.html" ] || { echo "No production build at $EST/app/index.html (run with --build)" >&2; exit 1; }
mkdir -p "$HUB/estimator"
python3 - "$EST/app/index.html" "$HUB/estimator/index.html" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
html = open(src, encoding="utf-8").read()
# The production page reads flr-config.js and carries no pricing data; the demonstration build must never be published.
assert 'src="flr-config.js"' in html, "this is not the Estimator's production build"
assert html.count("</head>") == 1, "expected exactly one </head>"
tag = ('<link rel="stylesheet" href="../tool-transition.css"><!-- added by the FLR Hub: the slide between hub and Estimator -->\n'
       '<script type="module" src="../assistant/assistant.js?v=1.2"></script><!-- added by the FLR Hub: the Ask the Hub button -->\n')
open(dst, "w", encoding="utf-8").write(html.replace("</head>", tag + "</head>", 1))
PY
cp "$HUB/flr-config.js" "$HUB/estimator/flr-config.js"
echo "estimator/ updated from $EST/app/index.html"
