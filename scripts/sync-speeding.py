#!/usr/bin/env python3
"""Build speeding/: the Driver Speeding Report for the FLR site, from the report's own template.

It is the same page as on Claude (same template, same rules; the CALC block is untouched), except:
  * the FLR database decides what each person gets (administrators every driver, a linked driver only their own log),
    and the report's pages stay hidden until it has answered (bridge.js sets html[data-hub]);
  * no staff photos and no list of photo names: the photos come from the FLR database after sign-in, like all the data;
  * a whole HTML document carrying what the Claude frame normally supplies (charset, viewport, a small reset), plus
    this site's sign-in settings and bridge.js, which answers the page's database requests from the FLR database;
  * a Content-Security-Policy, so the page can only talk to this site and the FLR database, as on Claude.
The OpenStreetMap packs in map/ (roads and place names only: public map data, nothing about drivers) are copied beside it.

Usage: scripts/sync-speeding.py      (SPEEDING_DIR overrides ../flr-speeding-report)
"""
import json
import os
import shutil

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get('SPEEDING_DIR') or os.path.join(HUB, '..', 'flr-speeding-report')
OUT = os.path.join(HUB, 'speeding')

t = open(os.path.join(SRC, 'template.html'), encoding='utf-8').read()
logo = open(os.path.join(SRC, 'logo.b64')).read().strip()
css = open(os.path.join(SRC, 'map-assets', 'leaflet.min.css')).read().strip()
topo = json.load(open(os.path.join(SRC, 'map-assets', 'uk-boundaries.topo.json')))
for k in ('__LOGO__', '__PHOTOS__', '__LEAFLET_CSS__', '__UK_TOPO__'):
    assert t.count(k) == 1, f'template placeholder {k} missing'
assert '</' not in css, 'CSS would close the style element'
assert t.startswith('<title>'), 'expected the Claude-style page (content only, title first)'
assert 'window.__FLR_PHOTOS' in t, 'the template has no hook for photos from the FLR database'

page = (t.replace('__LOGO__', logo).replace('__PHOTOS__', '[]').replace('__LEAFLET_CSS__', css)
         .replace('__UK_TOPO__', json.dumps(topo, separators=(',', ':'))))
head = """<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co; base-uri 'none'; form-action 'none'; object-src 'none'">
<link rel="icon" href="../assets/flr-icon-192.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}html[data-hub="loading"] #tabbar,html[data-hub="loading"] #stack{visibility:hidden}</style>
<link rel="stylesheet" href="../tool-transition.css">
<script src="../flr-config.js"></script>
<script src="../vendor/supabase-2.116.0.js"></script>
<script src="bridge.js?v=1.2"></script>
<script type="module" src="../assistant/assistant.js?v=1.9"></script>
</head>
<body>
"""
# bridge.js?v=: bump it whenever bridge.js changes, so a new page never runs with a cached old bridge (Pages caches 10 min).
html = head + page + '\n</body>\n</html>\n'
assert 'const PHOTOS = new Set([]);' in html, 'the public page must not list staff photos'

os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(html)
maps = os.path.join(OUT, 'map')
if os.path.isdir(maps):
    shutil.rmtree(maps)
shutil.copytree(os.path.join(SRC, 'map'), maps, ignore=shutil.ignore_patterns('.DS_Store'))
print(f"speeding/ updated: index.html {len(html):,} bytes, {len(os.listdir(maps))} map packs")

# The Hub assistant answers questions about drivers with this report's own rules (its CALC block), taken from the page
# just built, so the two always agree (scripts/speeding_core.py). Commit speeding/speeding-core.js with it.
import sys  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import speeding_core  # noqa: E402
speeding_core.main()
