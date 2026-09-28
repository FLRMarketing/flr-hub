# FLR Hub

The front door to FLR's staff tools. One FLR account (the Cost Estimator's sign-in) works for everything on this site.

- **Cost Estimator** opens here, in the same tab (`estimator/`), already signed in.
- **Private tools** (the Driver Speeding Report today) are not in this repository. The links live in the FLR database, and
  each person sees only the tiles they're on the list for.

GitHub Pages is public, so nothing private belongs in this repository: no links to private tools, no data, and never the
Supabase `service_role` key.

## What's here

| Path | What |
|---|---|
| `index.html`, `hub.css`, `hub.js` | The hub. Plain HTML, CSS and JavaScript with no build step. |
| `flr-config.js` | The FLR sign-in's address and public key. Both are safe to publish. |
| `vendor/supabase-2.116.0.js` | The Supabase client, the same version the Estimator bundles. |
| `estimator/` | The Estimator's production page (no pricing data), copied by `scripts/sync-estimator.sh`, plus `hub-transition.css` for the slide between hub and Estimator. |
| `assets/` | The FLR icon. |

## Tiles

The hub always shows the Cost Estimator. Other tiles come from the database (`public.hub_home()`), from the migration
`supabase/migrations/20260928000100_flr_hub.sql` in the Estimator's repository. Change them in the Supabase SQL editor,
or as an FLR administrator:

```sql
select public.admin_set_hub_tile('speeding', 'Driver Speeding Report', 'Speeding by driver and vehicle, updated every morning', 'https://claude.ai/artifact/…', 'listed', 20);
select public.admin_set_hub_tile_person('speeding', 'name@flr.co.uk', true);   -- false takes them off the list
select public.admin_hub_tiles();                                              -- everything, with the lists
```

Use `'everyone'` instead of `'listed'` to show a tile to every FLR account. Links must start with `https://`.
Before the migration is run, the hub still works and shows the Estimator only.

## Updating the Estimator copy

```sh
scripts/sync-estimator.sh --build
```

Then commit `estimator/`. The script refuses the demonstration build, which has pricing data in it.

## Local preview

From the Estimator's folder:

```sh
HUB_DIR=../flr-hub HUB_DEMO_PEOPLE=you@example.com npx tsx build/mock-supabase.ts
```

Then open http://127.0.0.1:8791/flr-hub/. This runs against an imitation of Supabase built on the real schema; the
access code is in the Estimator's `docs/DEPLOYMENT.md`. `HUB_DEMO_URL` sets the demonstration tile's link.

## Publishing checklist

1. **Supabase, SQL editor:** run `20260928000100_flr_hub.sql`, then add the tiles and people (above).
2. **Supabase, Authentication, URL Configuration:** add `https://flrmarketing.github.io/flr-hub/` and
   `https://flrmarketing.github.io/flr-hub/estimator/` to the redirect URLs, so password-reset emails come back here.
3. **GitHub Pages:** deploy from the `main` branch, root folder.
