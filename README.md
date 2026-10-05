# FLR Hub

The front door to FLR's staff tools. One FLR account (the Cost Estimator's sign-in) works for everything on this site.

- **Cost Estimator** opens here, in the same tab (`estimator/`), already signed in.
- **Fleet Management** (the driver speeding report) opens here too (`speeding/`), but only for the people on its list. Its data and staff photos
  stay in the FLR database and reach the page only after sign-in.
- **Annual Leave** opens here (`annual-leave/`). Leave approvers (a list in the database) see and decide everyone's leave;
  everyone else sees only their own requests, days left and other leave. monday.com stays the source of truth: the `flr-leave`
  function keeps the database's copy in step with it and writes decisions back. Approvers also see staff photos beside
  names, from `public.leave_faces()` after sign-in; anyone without a photo gets their initials.
- **Fitter Schedule** opens the fitter schedule site in a new tab: who is free, who is working and which jobs still need a
  fitter. Its link lives in the database like the others, and the site still asks for the team passcode. With a Hub sign-in it also shows
  each fitter's photo and number plate from `public.fitter_faces()`, using this site's `flr-config.js` and
  `vendor/supabase-2.116.0.js`: if either moves or is renamed, update `FLR_HUB` in the Fitter Schedule too.

GitHub Pages is public, so nothing private belongs in this repository: no data, no staff photos or names, no links to
private tools, no writer key and never the Supabase `service_role` key.

## What's here

| Path | What |
|---|---|
| `index.html`, `hub.css`, `hub.js` | The hub. Plain HTML, CSS and JavaScript with no build step. |
| `flr-config.js` | The FLR sign-in's address and public key. Both are safe to publish. |
| `vendor/supabase-2.116.0.js` | The Supabase client, the same version the Estimator bundles. |
| `tool-transition.css` | The slide between the hub and a tool, linked from each tool's page. |
| `settings/` | Hub settings, for FLR administrators (the gear beside their initials): accounts, the apps each person can use, and registration. It calls the database's `admin_*` functions, which check every call. |
| `estimator/` | The Estimator's production page (no pricing data), copied by `scripts/sync-estimator.sh`. |
| `speeding/` | The Speeding Report page, built by `scripts/sync-speeding.py` from `../flr-speeding-report` with no photos or names; `bridge.js`, which answers the page's data requests from the FLR database; and `map/`, the OpenStreetMap road and place packs (public map data). |
| `annual-leave/` | The Annual Leave page, built by `scripts/sync-leave.py` from `../flr-annual-leave` without the staff form link, and `bridge.js`, which answers the page's monday.com calls from the FLR database, fetches approvers' staff photos and sends decisions to the `flr-leave` function. |
| `onboarding/` | Onboarding: each new starter's checklist (forms, FLR documents, uploads, acknowledgements), and the reviews, checks and internal setup behind it. `content.js` holds the wording taken from FLR's source forms. Draft on branch `feature/onboarding`; see "Onboarding" below. |
| `assistant/` | Ask the Hub, the help button on every Hub page (see below). |
| `assets/` | The FLR icon. |

## Tiles, and who uses which app

Every app is a tile in the database (`public.hub_home()`): the Cost Estimator (`estimator`), Fleet Management
(`speeding`), Annual Leave (`annual-leave`) and the Fitter Schedule (`fitters`). Since
`supabase/migrations/20261001100000_flr_app_access.sql` (in the Estimator's repository), each tile has its own list of
the accounts that may use the app, and administrators switch people on and off in **Hub settings**. The Hub shows each
person only their apps, and the apps check the same list in the database, so going straight to an app's address
doesn't get round it: the Estimator, Fleet Management and Annual Leave say "You don't have access to …". On the Fitter
Schedule it covers the photos, plates and arrivals; the schedule itself is behind its team passcode.

**New accounts wait for a Super Admin** (`20261002200000_flr_account_approval.sql`, Hub migration 2.2). A new account
starts switched off, as a User, whatever was set up for its address: a role assigned in advance is only noted, and apps
switched on in advance and the leave approver list do nothing yet. The Hub shows the person "Your account is waiting for
a Super Admin". In Hub settings, **New accounts waiting** lists them; "Check and approve" opens a sheet that needs the
identity check (their work number from the staff list, Teams on their existing work account, or IT), a note and a tick
before it approves. Approval switches the account on with the role and the apps in "New accounts get" (or others chosen
there), and the change log keeps who approved, how they checked and when. "Don't approve" keeps it switched off.

**Super Admins and Admins** (`20261002100000_flr_admin_roles.sql`, 2 Oct 2026). A Super Admin (database role `admin`, what
every administrator was before) looks after accounts, roles, app access, registration and every app's settings. An Admin
(`manager`) does the day-to-day work and no settings: approves leave and sees everyone's, sees every driver in Fleet
Management (without the driver sign-ins) and the fitters' arrivals, and in the Cost Estimator builds, approves and
reassigns quotations (no Settings, no deleting). The database decides; the pages hide what an Admin can't use, and Hub
settings or the Estimator's Settings opened by their address say they're for Super Admins. There is always an active
Super Admin: the database refuses any change that would leave none.

A tile's link is either a page of this site such as `speeding/` (same tab) or an `https://` address (new tab). The SQL
editor can do what Hub settings does:

```sql
select public.admin_set_hub_tile('speeding', 'Fleet Management', 'Speeding by driver and vehicle, updated through the working day', 'speeding/', 'listed', 20);
select public.admin_set_hub_tile_person('speeding', 'name@flr.co.uk', true);   -- by email; false takes them off the list
select public.admin_accounts();                                               -- everyone, with their role, status and apps
```

A tile switched off (`active` false) is an app nobody can use. Before the app-access migration is run, the hub works as
it did: the Estimator for everyone, plus the tiles their audience allows.

## The Speeding Report's data

The report page reads `public.speeding_data()` (migrations `20260928000200_flr_speeding.sql` and
`20260928001000_flr_speeding_drivers.sql`): administrators get every driver, an account linked to a FleetView driver
only that driver's own log, anyone else nothing, and each view is recorded in the audit trail.
- **Vehicle details:** the Monday fleet board is synced every 15 minutes by the Supabase Edge Function `flr-fleet` (in
  the Estimator's repository, `supabase/functions/flr-fleet/`, with its setup steps in its README), which writes only
  what changed. `select public.admin_fleet_status();` shows how it's doing.
- **Speeding data:** FleetView doesn't let FLR's API key read Driver Performance, so the FLR Fleet Management updater
  reads it: a Chrome add-on (the Estimator's repository, `extension/fleet-updater/`) that every 15 minutes reads it in a
  signed-in FleetView tab and sends it to `flr-fleet` (`?op=peek`, then `?op=upload`) with an FLR Super Admin's
  sign-in. It runs only while that computer is on with Chrome open, so the page counts only the working day (Monday to
  Friday, 9am to 5pm UK time) before it says the figures haven't updated. Bank holidays are worked out in the page, and
  FLR's close days come from the Monday board "FLR - Bank Holidays & Closures" (the Annual Leave calendar, from
  flr-leave's copy) as the `closures` collection of `speeding_data()` (Fleet migration 2.3,
  `20261005000100_flr_fleet_close_days.sql`). Add next year's close days to that board and Fleet Management follows.
- **Staff photos:** `../flr-speeding-report/push_supabase.py --photos` loads them, with a writer key kept in
  `~/.config/flr/speeding-writer.key`, of which the database holds only the SHA-256.
- **Fresh data:** the page re-reads it when it comes back to the front after five minutes, and every 15 minutes while it
  stays open.

## Updating the copies

```sh
scripts/sync-estimator.sh --build
scripts/sync-speeding.py
scripts/sync-leave.py
```

Then commit `estimator/`, `speeding/` and `annual-leave/`. After `sync-speeding.py`, run `node scripts/due-rule-test.mjs`:
it checks the Vehicles page's MOT, tax and service rule against the cases agreed with FLR on 2 Oct 2026. When `hub.css` or `hub.js` changes, bump the `?v=` on their links in `index.html`:
GitHub Pages lets browsers cache files for 10 minutes, and the version keeps a page from mixing old and new files. The Estimator script refuses the demonstration build, which has pricing data
in it. The Speeding script refuses a page that lists staff photos.

## Local preview

From the Estimator's folder:

```sh
HUB_DIR=../flr-hub HUB_DEMO_PEOPLE=you@example.com HUB_DEV_WRITER_KEY_FILE=/path/to/throwaway.key npx tsx build/mock-supabase.ts
```

Then open http://127.0.0.1:8791/flr-hub/. This runs against an imitation of Supabase built on the real schema; the
access code is in the Estimator's `docs/DEPLOYMENT.md`. Load Speeding data into it with `push_supabase.py`, setting
`FLR_SUPABASE_URL=http://127.0.0.1:8791`, `FLR_SUPABASE_KEY=mock-anon-key` and `FLR_WRITER_KEY_FILE` to the throwaway key.

## Annual Leave

monday.com's five leave boards stay the source of truth. The Supabase Edge Function `flr-leave` (in the Estimator's
repository, `supabase/functions/flr-leave/`, with its setup steps in its README) holds the monday.com key and keeps a
private copy of the boards in the database, from monday.com webhooks plus a full read every 10 minutes. The page reads
the copy through `public.leave_home()` (migration `20260928000300_flr_leave.sql`), and open pages reload by themselves
when it changes. Decisions go through the function, which lets only approvers make them, writes them to monday.com,
and records who made them (audit trail, the "Decided by" column, and the update on the request).

```sql
select public.admin_set_leave_approver('name@flr.co.uk', true);   -- false takes them off the list
select public.admin_set_leave_form('https://...');               -- the staff leave request form
select public.admin_leave_status();                               -- sync health, counts, approvers, webhooks
```

Everyone else is matched to their staff record by the Email column on FLR - Leave Allowances.

To try it all locally, add `LEAVE=1 LEAVE_APPROVERS=you@example.com` to the preview command below: a stand-in
monday.com with made-up staff, the real function, and webhooks between them. `/__mock/monday/edit?item=402&col=color_mm7m6q47&value=Denied`
changes something "in monday.com".

## Onboarding (draft, not live)

New starters and the people who look after them. HR adds a starter (name, email, route: Operative, or Office employee with
"visits sites" yes/no, and what applies: driving, PPE, qualifications, PAT-tested tools, phone, email, DBS) and the
Onboarding tile appears for that email address; they register on the Hub as usual. Their tasks follow the route and
those requirements (`private.onb_rules`, which Super Admins can change in Setup). The database is
`supabase/migrations/20261003000100_flr_onboarding.sql` in the Estimator's repository, with `tests/db/onboarding.test.ts`.

- Who sees what is decided in the database, never by this page: the starter sees their own tasks; **overview** (managers)
  sees progress and statuses only; **HR** adds starters, reviews, records document and right-to-work checks, the
  internal checklist and pay; **payroll** sees personal details, bank details (opened on request, and each opening is
  recorded), pay, the P45 and HMRC checklist; **medical** (named people only, not every Super Admin) reads medical
  answers, opened on request and recorded; trainers and DSE assessors see the tasks they're assigned. Super Admins manage
  the team, FLR document templates and task rules.
- An upload never completes a check: HR records how and when each document was checked, and the right-to-work check
  is kept apart from the upload. The H&S induction is led and completed by the trainer; the starter then signs it.
- FLR documents (contract, handbook, H&S policy, emergency contacts notice) show as "Awaiting FLR document" until a
  Super Admin uploads one and confirms it as FLR's approved version. The working time form is held back until HR
  approves its wording (Setup, Launch checks). HMRC's starter checklist is linked from GOV.UK, never reproduced.
- Uploads are kept in the database (private schema, up to 10 MB each), not in this repository; nothing private is
  written to the audit trail, notifications or the console.
- Preview: `build/onboarding-demo.ts` (Estimator repository) fills the mock Supabase with made-up people.

## Likkle Jeff (the help button, first called Ask the Hub)

**Paused since 2 Oct 2026** (the user's request: off for now, not deleted). `assistant/assistant.js`, the file every page
loads, now only loads `logo.js` (the FLR logo on each tool goes back to the Hub) and, when `JEFF` is `true`, `jeff.js`
(Likkle Jeff himself, unchanged). To bring him back: set `const JEFF = true;` in `assistant/assistant.js` and publish.


A round button, bottom right on the Hub, the Estimator, Fleet Management and Annual Leave. People ask where to find
something or how to do it, and get a short answer and a link. It is search, not AI: `assistant/engine.js` matches
the question against the approved answers in `assistant/help.json`, in the browser, and says so when nothing fits
instead of guessing. It never reads leave, quotes or driver data and changes nothing; its only database call is
`hub_home()`, so it can say "that isn't on your Hub" instead of linking to a tool someone doesn't have.

- `help.json` is public like everything here: how-to text only. Quote labels exactly as the pages show them. A link is
  `{"href": "annual-leave/"}` (relative to the Hub) or `{"tile": "fitters"}` (that tool's address from the database).
- After changing it, run `node assistant/tests/run.mjs` and `node assistant/tests/run.mjs --heldout`. Both must end with
  no wrong answers and none answered that should have been declined. `heldout.json` was written by someone who never
  saw the help text; `--sweep` shows other thresholds.
- Pages load it with `<script type="module" src="(../)assistant/assistant.js?v=2.1"></script>`: `index.html` directly,
  and the tools through their build scripts. The Fitter Schedule (FLRMarketing/fitter-schedule) loads
  `/flr-hub/assistant/assistant.js` from the head that `flr-fitter-schedule/dev/assemble.py` writes. On a release, bump
  `?v=` in all five and in `assistant.js` (`V` and the `engine.js` and `lines.js` imports).
- When a tool changes its buttons or wording, update its answers here too.
- It also answers from everything the person can see in their tools, read-only (`assistant/records.js`), and nothing
  more: each answer comes from the database function the tool's own page uses (`leave_home`, `speeding_data`,
  `list_projects`), called with their own sign-in. So administrators can ask about any vehicle ("when is the MOT due
  on AB12 CDE?", "which vans need an MOT this month?", "what does Dan drive?"), any driver ("how is Owen driving?"),
  the review order and the worst incidents; a linked driver gets only their own vehicle and driving. Leave approvers can
  ask about anyone's balance and requests, what's waiting for a decision and who's off on any day or week (with the
  kind of leave, as their Diary shows it); everyone else gets their own leave and who's off today, names only. Anyone
  with the Estimator can look quotations up by number, client, site, estimator or state. An answer marks which
  look-up it uses with `"data"` in `help.json`; names the help doesn't know are only ever used if they're found in
  the person's own records. The answers aren't kept in the chat's saved history: leaving the page forgets them.
- The figures use the pages' own rules, cut from the built pages: `annual-leave/leave-core.js` (by
  `scripts/leave_core.py`, which `sync-leave.py` runs after every build) and `speeding/speeding-core.js` (the report's
  CALC block and its MOT, tax and service rule, the DUE block, by `scripts/speeding_core.py`, which `sync-speeding.py`
  runs). Commit each with its page.
- Tests: `node assistant/tests/run.mjs`, `--heldout` and `--records` (questions about records, with names and
  registrations, routed as the chat routes them).
- A speech bubble from him offers help as soon as a page opens, then again the moment it goes quiet (a second's pause):
  once each pause, not while the chat is open (`listen` in `assistant.js`). What he says comes from `lines.js`: for the page,
  signing in, the time of day or their first name, never the same line twice running (`node assistant/tests/lines.mjs`).
- On a tool, the FLR logo at the top goes back to the Hub (`LOGO` in `assistant.js`, done there because every tool
  loads it): a step back through the tab's history when it came from the Hub, the Hub opened when not.
- He's called Likkle Jeff: the button says "Ask Likkle Jeff", the chat's header "Likkle Jeff". His name said to him
  ("Likkle Jeff, how many days have I got left?") is left out of the question (`unaddressed` in `engine.js`); "Jeff"
  on its own is a person (`alsoPeople` in `help.json`), except in the Hub's own "Jeff Day" and "Likkle Jeff".
- His face is the FLR character: six drawings of him, one per mood, in `face/` (thumbs up by default; thinking,
  celebrating, reassuring, unsure, and playfully angry for the Hub's own faults only). `face.css` fades from one drawing
  to the next and keeps him still for people who ask for reduced motion; `reaction()` in `assistant.js` picks his mood
  for each reply, helped by `care` in `help.json` and the `unsure`, `care` and `fault` marks on records cards. The
  drawings are made from the originals by `art/make-faces.mjs`, which crops all six to one box so he never moves
  between moods. The full-size originals are kept off this public repository.

## Publishing checklist

1. **Supabase, SQL editor:** run `20260928000100_flr_hub.sql`, then `20260928000200_flr_speeding.sql`. Then register the
   writer key's SHA-256 with `public.admin_set_speeding_writer(...)`, and add the tiles and people (above). For Annual
   Leave, `20260928000300_flr_leave.sql` and the `flr-leave` function (the steps in its README). For Hub settings and app access,
   `20261001100000_flr_app_access.sql`, after the others (it adds an app check to their functions).
2. **Supabase, Authentication, URL Configuration:** add `https://flrmarketing.github.io/flr-hub/`,
   `https://flrmarketing.github.io/flr-hub/estimator/` and `https://flrmarketing.github.io/flr-hub/speeding/` to the
   redirect URLs, so password-reset emails come back here.
3. **GitHub Pages:** deploy from the `main` branch, root folder.
