#!/usr/bin/env python3
"""Build annual-leave/: FLR Annual Leave for the FLR site, from the leave tool's own page.

It is the same page as on Claude (same look, same leave rules and checks), except:
  * a whole HTML document carrying what the Claude frame normally supplies (charset, viewport, a small reset), plus this
    site's sign-in settings, the Supabase client and annual-leave/bridge.js, which answers the page's monday.com calls
    from the FLR database's copy of the leave boards and sends decisions to the flr-leave function (see bridge.js);
  * no staff leave form link: this site is public, so the link arrives from the FLR database after sign-in;
  * error messages about this site, not about Claude's monday.com connector;
  * a Content-Security-Policy, so the page can only talk to this site and the FLR database.

Usage: scripts/sync-leave.py      (LEAVE_DIR overrides ../flr-annual-leave)
"""
import os
import sys

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get('LEAVE_DIR') or os.path.join(HUB, '..', 'flr-annual-leave')
OUT = os.path.join(HUB, 'annual-leave')

page = open(os.path.join(SRC, 'index.html'), encoding='utf-8').read()
assert page.startswith('<title>'), 'expected the Claude-style page (content only, title first)'

FORM = "const FORM_URL = 'https://wkf.ms/4hsJV2r';"
assert page.count(FORM) == 1, 'the form link line has changed: update this script'
page = page.replace(FORM, "let FORM_URL = '';   // the FLR Hub fills this in after sign-in (bridge.js): the link isn't in this public site")

HUB_ERRORS = """function describeError(e) {
  const code = (e && e.code) || 'server_error';
  const msg = (e && e.message) || '';
  switch (code) {
    case 'FLR_FORBIDDEN': return { title: 'Only leave approvers can do that', body: msg || 'Ask an FLR administrator if you should approve leave.' };
    case 'FLR_SIGN_IN_REQUIRED': return { title: 'Sign in again', body: msg || 'Your FLR sign-in has expired. Go back to the FLR Hub, sign in, then try again.' };
    case 'FLR_VALIDATION': return { title: 'That change isn’t allowed', body: msg || 'The FLR server refused it. Nothing was changed.' };
    case 'tool_error': return { title: 'monday.com refused the change', body: msg || 'monday.com reported an error. Nothing was changed.' };
    case 'not_configured': return { title: 'Annual Leave isn’t connected to monday.com yet', body: msg || 'The monday.com key hasn’t been added to the FLR server.' };
    case 'offline': return { title: 'Can’t reach the FLR server', body: msg || 'Check your connection, then press Refresh.' };
    default: return { title: 'Something went wrong', body: msg || 'The FLR server couldn’t finish that. Press Refresh to try again.' };
  }
}
"""
start = page.index('function describeError(e) {')
end = page.index('\n}\n', start) + 3
assert 'claude.ai Settings' in page[start:end], 'describeError has changed: update this script'
page = page[:start] + HUB_ERRORS + page[end:]
assert 'wkf.ms' not in page, 'the public page must not carry the form link'

head = """<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; base-uri 'none'; form-action 'none'; object-src 'none'">
<link rel="icon" href="../assets/flr-icon-192.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<link rel="stylesheet" href="../tool-transition.css">
<script src="../flr-config.js"></script>
<script src="../vendor/supabase-2.116.0.js"></script>
<script src="bridge.js"></script>
<script type="module" src="../assistant/assistant.js?v=1.3"></script>
</head>
<body>
"""
html = head + page + '\n</body>\n</html>\n'
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(html)
print(f"annual-leave/ updated: index.html {len(html):,} bytes (bridge.js is kept by hand)")

# The Hub assistant answers leave questions ("how many days have I got left?") with this page's own leave rules, taken
# from the page just built, so the two always agree (scripts/leave_core.py). Commit annual-leave/leave-core.js with it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import leave_core  # noqa: E402
leave_core.main()
