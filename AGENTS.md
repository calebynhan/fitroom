# Agents — three parallel Claude Code sessions

Read CLAUDE.md first.

> **2026-11-09:** the app no longer uses the 3D mannequin; it generates four photos from the shopper's own photos
> (see CLAUDE.md). Session A's pipeline is paused and kept as legacy; Session B's 3D items (mannequin look,
> materials, fit morphs) no longer apply.

Each session owns its folders and works through its phases in order.
Finish and verify a phase (on the live URL where it applies) before starting the next.

## Session A — Realism pipeline (pipeline/, GLBs + fit_model.json in web/public/)
1. **Garments that look like clothes.** Real ease, gravity cloth relax, hems/cuffs, UVs, lod1 if the GLB stays
   under ~5 MB. Posed render check from 4 angles: no spikes, no poke-through, visible drape.
2. **fit_model.json.** Measurements -> morph weights + scale, fitted on mesh slices at ANSUR landmark ratios.
   Report error on chest/waist/hips across 20 random ANSUR-like bodies (target ≤ 2 cm).
3. **Size fit morphs.** fit_tight / fit_loose that read clearly (about ±3 cm of ease).
4. **Compression.** Draco or meshopt; all GLBs load fast on mobile.

## Session B — App (web/, api/)
1. **Fix "Make it real"** end to end on the live URL (see the /api/photoreal contract). Progress state, retry, download.
2. **Mannequin look + materials.** Matte mannequin, simple shoes, fabric normal maps per fabric, environment
   lighting per scene, ambient occlusion.
3. **Onboarding + fit.** Measurement form with unit toggle and ANSUR estimates, drives fit_model.json
   (sliders stay as manual fine-tuning). Size recommendation per item; chosen size -> fit morph.
4. **Saved outfits + share links + mobile layout.**
5. **Production.** Rate limit + spend cap on /api/photoreal, error and loading states, OG image, analytics.

## Session C — Catalog and data (scripts/, api/product)
1. **/api/product.** Test whether UNIQLO answers server-side requests from Vercel. If yes, make paste-a-link work;
   if not, ship the paste-JSON fallback with a one-click console snippet.
2. **Catalog ingest.** A script that builds catalog.json for 30+ UNIQLO men's tees, sweaters and pants:
   names, prices, colors with hex (sampled from swatches), swatches, product images, sizes, fit type.
3. **Size charts.** Inspect sizeChartUrl, parse body measurements per size into sizeChart; mark items without
   a chart as null so the app falls back gracefully.

## Handoffs
- A drops GLBs and fit_model.json into web/public/; B picks them up on reload.
- C owns catalog.json's content; B owns how it's displayed. Schema changes go in CLAUDE.md first.
- Only B deploys (`vercel --prod` from the repo root). A and C tell B when their output is ready.
