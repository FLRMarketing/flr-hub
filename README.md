# FLR Hub

The front door to FLR's staff tools. One FLR account (the Cost Estimator's sign-in) works for everything on this site.

- **Cost Estimator** opens here, in the same tab (`estimator/`), already signed in.
- **FLR Group Fleet Management** (the driver speeding report) opens here too (`speeding/`), but only for the people on its list. Its data and staff photos
  stay in the FLR database and reach the page only after sign-in.

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
| `assets/` | The FLR icon. |

## Tiles

The hub always shows the Cost Estimator. Other tiles come from the database (`public.hub_home()`), from the migration
`supabase/migrations/20260928000100_flr_hub.sql` in the Estimator's repository. A tile's link is either a page of this
site such as `speeding/` (same tab) or an `https://` address (new tab). Change tiles in the Supabase SQL editor, or as an
FLR administrator:

```sql
select public.admin_set_hub_tile('speeding', 'FLR Group Fleet Management', 'Speeding by driver and vehicle, updated every morning', 'speeding/', 'listed', 20);
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
```

Then commit `estimator/` and `speeding/`. When `hub.css` or `hub.js` changes, bump the `?v=` on their links in `index.html`:
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

## Publishing checklist

1. **Supabase, SQL editor:** run `20260928000100_flr_hub.sql`, then `20260928000200_flr_speeding.sql`. Then register the
   writer key's SHA-256 with `public.admin_set_speeding_writer(...)`, and add the tiles and people (above).
2. **Supabase, Authentication, URL Configuration:** add `https://flrmarketing.github.io/flr-hub/`,
   `https://flrmarketing.github.io/flr-hub/estimator/` and `https://flrmarketing.github.io/flr-hub/speeding/` to the
   redirect URLs, so password-reset emails come back here.
3. **GitHub Pages:** deploy from the `main` branch, root folder.
