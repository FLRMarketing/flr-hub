# FLR Hub

The front door to FLR's staff tools. One FLR account (the Cost Estimator's sign-in) works for everything on this site.

- **Cost Estimator** opens here, in the same tab (`estimator/`), already signed in.
- **Fleet Management** (the driver speeding report) opens here too (`speeding/`), but only for the people on its list. Its data and staff photos
  stay in the FLR database and reach the page only after sign-in.
- **Annual Leave** opens here (`annual-leave/`). Leave approvers (a list in the database) see and decide everyone's leave;
  everyone else sees only their own requests and days left. monday.com stays the source of truth: the `flr-leave`
  function keeps the database's copy in step with it and writes decisions back.
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
| `estimator/` | The Estimator's production page (no pricing data), copied by `scripts/sync-estimator.sh`. |
| `speeding/` | The Speeding Report page, built by `scripts/sync-speeding.py` from `../flr-speeding-report` with no photos or names; `bridge.js`, which answers the page's data requests from the FLR database; and `map/`, the OpenStreetMap road and place packs (public map data). |
| `annual-leave/` | The Annual Leave page, built by `scripts/sync-leave.py` from `../flr-annual-leave` without the staff form link, and `bridge.js`, which answers the page's monday.com calls from the FLR database and sends decisions to the `flr-leave` function. |
| `assets/` | The FLR icon. |

## Tiles

The hub always shows the Cost Estimator. Other tiles come from the database (`public.hub_home()`), from the migration
`supabase/migrations/20260928000100_flr_hub.sql` in the Estimator's repository. A tile's link is either a page of this
site such as `speeding/` (same tab) or an `https://` address (new tab). Change tiles in the Supabase SQL editor, or as an
FLR administrator:

```sql
select public.admin_set_hub_tile('speeding', 'Fleet Management', 'Speeding by driver and vehicle, updated every morning', 'speeding/', 'listed', 20);
select public.admin_set_hub_tile_person('speeding', 'name@flr.co.uk', true);   -- false takes them off the list
select public.admin_hub_tiles();                                              -- everything, with the lists
```

Use `'everyone'` instead of `'listed'` to show a tile to every FLR account. Before the migration is run, the hub still
works and shows the Estimator only.

## The Speeding Report's data

The report page reads `public.speeding_data()`, from the migration `20260928000200_flr_speeding.sql`. That returns data
only to active accounts the `speeding` tile is for, and each view is recorded in the audit trail. The data is written
by the report's refresh jobs with `../flr-speeding-report/push_supabase.py`, which sends the same writes the Claude
page gets. It uses a writer key kept in `~/.config/flr/speeding-writer.key`, of which the database holds only the SHA-256.

## Updating the copies

```sh
scripts/sync-estimator.sh --build
scripts/sync-speeding.py
scripts/sync-leave.py
```

Then commit `estimator/`, `speeding/` and `annual-leave/`. When `hub.css` or `hub.js` changes, bump the `?v=` on their links in `index.html`:
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

## Publishing checklist

1. **Supabase, SQL editor:** run `20260928000100_flr_hub.sql`, then `20260928000200_flr_speeding.sql`. Then register the
   writer key's SHA-256 with `public.admin_set_speeding_writer(...)`, and add the tiles and people (above). For Annual
   Leave, `20260928000300_flr_leave.sql` and the `flr-leave` function (the steps in its README).
2. **Supabase, Authentication, URL Configuration:** add `https://flrmarketing.github.io/flr-hub/`,
   `https://flrmarketing.github.io/flr-hub/estimator/` and `https://flrmarketing.github.io/flr-hub/speeding/` to the
   redirect URLs, so password-reset emails come back here.
3. **GitHub Pages:** deploy from the `main` branch, root folder.
