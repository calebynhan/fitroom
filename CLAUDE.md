# FitRoom — 3D outfit try-on platform

**What it is:** Shoppers enter their measurements, see real UNIQLO pieces on a body shaped like theirs from every
angle and in different settings, get the size to buy, and turn any outfit into a photoreal shot.
**Why:** People return clothes because they looked different on the model. FitRoom shows fit on *your* body.
**Status:** The SideQuest Sunday hackathon (Nov 8, 2026) produced a working proof of concept, live at
fitroom-woad.vercel.app. We're now building it into a full, usable platform. No more time limits or feature
freezes: quality over speed, and nothing ships broken.

## Product principles
- **Honest fit beats fake realism.** The 3D view is for fit and silhouette. Photoreal is for the "that's me" moment.
- **Avatar style: a premium store mannequin** (matte, no hair, no skin shading, simple shoes). A clean mannequin
  reads as intentional; a half-real human reads as uncanny. Revisit only with a real photoreal body/face pipeline.
- **Every feature works on the live URL, on desktop and mobile**, with real error messages instead of silent failures.
- **Black-and-white, Banana Republic-style design.** Use the FitRoom design system:
  paper #FFFFFF, bone #F4F1EC, stone #E4DFD6, hairline #D6D1C8, ink #111111, graphite #3A3835, muted #6F6A63,
  khaki #8B7E66 (accent, never text), sale #8E2A21. Cormorant Garamond for display, Inter for UI.
  Radii 0 / 2px / pill. Spacing 4/8/16/24/48/80.

## v1 platform: done means
**Core loop**
- [ ] Onboarding: height + weight (required), chest / waist / hips / inseam (optional; estimated from
      height + weight via the ANSUR II regression when blank). Unit toggle in/lb ↔ cm/kg. Saved to localStorage.
- [ ] Avatar matches the entered measurements to within ~2 cm on chest, waist and hips (measured on the mesh).
- [ ] Garments look like clothes: real ease and drape, hems and cuffs, fabric normal maps, no skin-tight paint.
- [ ] Size recommendation per item ("You're a M; L if you want it roomier"), from UNIQLO size charts vs. the
      user's measurements. The chosen size changes how the garment fits on the avatar (tight ↔ loose).
- [x] "Make it real" works reliably: photoreal image from the current view, about 20–40 s, with a progress state,
      retry, and download.

**Catalog**
- [ ] UNIQLO men's tees, sweaters and pants (aim for 30+ items), with real names, prices, colors, swatches,
      product photos and size charts, refreshed by a script.
- [ ] Paste any UNIQLO US product link and it loads. Unsupported categories get a clear message.

**Experience**
- [ ] Mix tops and bottoms, 360° orbit, poses (Relaxed / Pocket / Walk), scenes (Studio / City / Night).
- [ ] Save outfits; share an outfit by link (state encoded in the URL).
- [ ] Mobile layout: viewer on top, controls in a bottom sheet.
- [ ] Optional: upload a selfie as a reference so the photoreal shot looks like you. Never store the photo.

**Production**
- [ ] Rate limit /api/photoreal (per IP, e.g. 5/hour) and cap total daily spend.
- [ ] Error handling on every API call; loading states for GLBs; GLBs under ~5 MB each (Draco/meshopt).
- [ ] OG image + metadata, Vercel Analytics, a short About / how-it-works section.

## Default body (Caleb)
5'10" (178 cm), 143 lb (65 kg), chest 92 cm, waist 75 cm (29"), hips 90 cm, inseam 84 cm. Slim, slight V-taper.
Fitted morph weights (lod1 mannequin): body_0 -1.62, body_1 -1.28, body_2 0.74, body_3 0.16, body_4 0.12, body_5 -0.18.
**body_1 positive adds a bust (female direction); keep it ≤ 0 for men.**

## UNIQLO data
All under `https://www.uniqlo.com/us/api/commerce/v5/en`. They answer plain server-side `fetch` (verified from the
live Vercel function and from Node, 2026-11-08; don't spoof browser headers). Code: api/_lib/uniqloClient.ts.
- Details: `/products/<ID>/price-groups/00/details?includeModelSize=false&httpFailure=true` -> result.name,
  prices.base/promo.value, sizes[].name, colors[].{displayCode,name}, breadcrumbs.class/category/subcategory.locale,
  images.main[<code>].image, representative.color, tags[] (`top-fit`/`bottom-fit` -> fit, `sleeve` -> short|long),
  rating.count, sizeGender (MEN|WOMEN).
- Size charts: `/products/size-charts?productIdsWithColorCode=<ID>,<ID>&includeBodyMeasurements=true` (batch up to
  ~10) -> result[].sizeChart (garment) and .bodyMeasurements (body ranges like "96 - 104"). The `sizeChartUrl`
  pages (/us/en/size/<num>_size.html) return S3 AccessDenied; don't use them.
- Listing: `/products?path=<gender>,<class>,<category>,&offset=0&limit=100` (Men 22211; T-Shirts class 23305 >
  category 23386; Sweaters 95668 > 95670; Bottoms 23306). IDs come from result.aggregations.tree.
Swatch: `https://image.uniqlo.com/UQ/ST3/WesternCommon/imagesgoods/<num>/chip/goods_<code>_<num>_chip.jpg`
(<num> = ID without E and -000). Product URL: /us/en/products/E453754-000/00 -> ID = E453754-000.
Shape mapping (api/_lib/uniqlo.ts): pants/jeans/chinos/bottoms -> pants; tees/knits/sweatshirts -> top, and the
sleeve decides the mesh: short -> tee, long -> sweater (size chart's garment sleeve length < 65 cm from centre
back = short, else the sleeve tag, else the name). Shorts, skirts, dresses, tights, tanks, vests, hoodies,
full-zips, cardigans, button-up shirts, underwear, jackets and coats -> "not supported yet".

Current hero items: SUPIMA Cotton T-Shirt E455365-000 (tee), Crew Neck T-Shirt E422992-000 (tee), Washable Milano
Ribbed Sweater E453754-000 (sweater), Cashmere Sweater E450543-000 (sweater), Ultra Stretch Pants E475598-000
(pants), Barrel Jeans E479000-000 (pants).

## Architecture
    pipeline/  Python 3.11 + bpy (use .venv/bin/python). Offline. Writes GLBs + JSON into web/public/.
      body.py        MHR lod1 fbx -> web/public/models/body.glb (mannequin, morphs body_0..body_5, pose clips)
      garments.py    body -> web/public/garments/{shoes,pants,tee,sweater}.glb (cloth_sim.py drape, shoes.py)
      fit_model.py   ANSUR II -> web/public/models/fit_model.json (pure numpy; fit_solver.py)
      compress_glb.mjs  meshopt-compress + verify GLBs in place (node; pipeline/package.json)
      tests/         pytest for the pure-numpy parts (.venv/bin/python -m pytest pipeline/tests)
    scripts/   Node/TS data scripts: catalog ingest, size-chart parsing -> web/public/catalog.json
    web/       Vite + React + TS + three + @react-three/fiber + @react-three/drei + zustand
    api/       Vercel functions: /api/product, /api/photoreal

Nothing physics-based runs in the browser. The browser loads GLBs, drives morphs, tints, and swaps.

## Contracts
**Body GLB** web/public/models/body.glb: one SkinnedMesh (MHR lod1, ~18k verts), MHR skeleton (root, c_spine0..3,
c_neck, l_/r_upleg, l_/r_lowleg, l_/r_uparm, l_/r_lowarm ...), metres, Y-up, A-pose. Morph targets body_0..body_5
= MHR shape_0..5. Store mannequin: no texture or vertex colours (the viewer colours it), smooth scalp, no nipples.
Clips relaxed / pocket / walk stand the feet 1.8 cm up (poses.SOLE_LIFT) so shoes.glb's soles touch y = 0.
body_measure.json: tape measurements + jacobian at the default weights.

**Garment GLB** web/public/garments/<shape>.glb, shape = tee | sweater | pants | shoes: one SkinnedMesh skinned to
the SAME bone names, same rest pose, morph targets body_0..body_5 (each vertex follows the body point it was cut
from). Clothes add fit_tight / fit_loose: at weight 1 = -/+3 cm of garment circumference ease (a size down / up;
partial weights interpolate), plus fit_boxy (tee) and fit_barrel (pants) set per item by fits.json. Material
"fabric", white base (the viewer tints). shoes.glb: material "shoe", body morphs only, always worn. Clothes are
single-sided cloth with turned-back hems: render DoubleSide. UVs in metres (u around the body/limb, v along it).
COLOR_0.r = knit rib mask (1 on crew collars and sweater cuffs/hem band) for a rib normal map, not a tint.
All GLBs are meshopt-compressed (EXT_meshopt_compression, drei's useGLTF decodes it); POSITION and TEXCOORD stay
float32, so raw attribute values are metres / UV metres. Rebind by bone name:

    const bones = garment.skeleton.bones.map(b => avatarBonesByName.get(b.name)!);
    garment.bind(new THREE.Skeleton(bones, garment.skeleton.boneInverses), garment.bindMatrix);
    avatarArmature.add(garment);

**fit_model.json** (web/public/models/): maps {heightCm, weightKg, chestCm?, waistCm?, hipsCm?, inseamCm?} ->
{body_0..body_5, scale}. Least-squares model fitted offline on 200 ANSUR II men by tape-measuring the mesh
(pipeline/fit_model.py). The browser evaluates it, no server round trip (`how_to` in the file says the same):
1. A blank measurement n = estimate[nCm].intercept + heightCm * estimate[nCm].heightCm + weightKg * .weightKg.
2. x_n = cm * ref_height_cm / heightCm for n in chest, waist, hips, inseam.
3. body_i = clamp(weights.intercept[i] + sum_n (weights.coef[nCm][i] * x_n + weights.quad[nCm][i] *
   ((x_n - quad_center) / quad_scale)^2), weights.min[i], weights.max[i]).
4. scale = heightCm / (height.intercept_cm + sum_i height.per_weight_cm[i] * body_i); use it instead of
   heightCm / 178. Held-out check (`validation`): chest/waist/hips mean 0.2-0.4 cm, max 1.4 cm; inseam mean 3 cm
   (one uniform scale can't change leg proportion).

**Catalog item** (web/public/catalog.json `{ source, generatedAt, items }` and the /api/product response):
`{ id, name, price, salePrice|null, slot: "top"|"bottom", shape: "tee"|"sweater"|"pants", fabric:
"jersey"|"rib_knit"|"cashmere"|"twill"|"denim", fit: "slim"|"regular"|"relaxed", url, image, colors: [{ code,
name, hex, swatch, image? }], sizes: [..], sizeChart: { [size]: SizeSpec } | null }`
SizeSpec (api/_lib/sizeChart.ts), all cm: `chestCm? waistCm? hipsCm?` = BODY measurement the size fits (upper end
of UNIQLO's range); `inseamCm? lengthCm?` = GARMENT inseam (pants) / body length (tops); `body?: { chestCm?,
waistCm?, hipsCm?: [min, max] }`; `garment?: { chestCm, waistCm, hipsCm, lengthCm, shoulderCm, sleeveCm,
inseamCm, riseCm, thighCm, hemCm }` (all optional; circumferences are full, not flat). Keys match `sizes` exactly
("M", "33inch"). Pants charts carry no chest. Men's tops usually give body chest (+ often waist); pants give body
waist only. Garment chest minus the user's chest = real ease, if you want to drive fit morphs from data.
`colors[].image` = product photo in that colour when UNIQLO has one.

**POST /api/product** `{ url }` -> catalog item (with fit + sizeChart), or `{ error, code }`: 400 bad_input,
404 not_found, 422 unsupported, 429 rate_limited (30/min per IP, `Retry-After`), 500 internal, 502 blocked
(UNIQLO unreachable: show the paste-JSON fallback). A failed size-chart call still returns the item with
`sizeChart: null`.

**POST /api/photoreal** `{ image: <JPEG data URL, max 1024px>, scene, items, selfie?: <data URL> }` ->
`{ image, remaining }` or `{ error, detail?, retryable, remaining? }` (`error` = plain-language headline, `detail` =
OpenAI's own message with org ids/links stripped, `retryable` = whether Retry can help; `selfie` not wired yet).
OpenAI images.edit (gpt-image-1.5 by default, override with OPENAI_IMAGE_MODEL; input_fidelity "high"). The canvas needs
`preserveDrawingBuffer: true`. Keep request bodies far under Vercel's 4.5 MB limit. Prompt: keep every garment,
colour, silhouette and the pose exactly; realistic fabric, folds and shoes; the chosen setting; full body; no
logos or text.

**Size recommendation**: compare the user's measurements to sizeChart with the item's fit (slim/regular/relaxed)
ease; pick the smallest size whose body measurements cover the user's. Size → fit morph: smaller than
recommended -> fit_tight, larger -> fit_loose; weight = ease difference / 3 cm, so one size off ≈ weight 1.

## Pitfalls (learned so far)
| Symptom | Cause | Fix |
|---|---|---|
| import bmesh fails | bpy-as-module must load first | import bpy before bmesh |
| Wrong sizes / remesh OOM | rigged meshes in cm under a scaled armature | unparent copies, keep world matrix, transform_apply -> metres |
| Sleeves don't follow arms | removing vertex groups one by one renumbers the rest | collect used NAMES first, remove by name |
| Limb weights wrong | several weight transfers mixed with ADD | one Data Transfer from a single source |
| Spikes on garments | solidify use_even_offset divides by fold angle | use_even_offset=False, thickness_clamp=1.0, drop faces with edges > 4x median |
| Body pokes through cloth | smoothing shrinks fabric over hips/chest | anti-clip: BVH nearest body point, push verts closer than the gap back out |
| Holes at hips | x cutoff meant for hands also cuts thighs | pants: select by height; exclude verts with high arm skin weight |
| Garment invisible/offset in three.js | added to scene root | add to the avatar SkinnedMesh's parent |
| neutral_bone in GLB | verts with zero weights | check every vertex has a weight before export |
| Morph targets lost on export | modifiers applied after shape keys | bake geometry first, add shape keys last, export_morph=True |
| Men's avatars have a bust | body_1 positive is the female direction | lock body_1 ≤ 0 for male bodies |
| Clothes look painted on | inflate offset too small, no drape | real ease per garment + longer cloth relax with gravity |
| "Photos are paused: … no image credit" (was "could not make this image") | OpenAI org has 0 TPM for gpt-image (429 "Limit 0"): Free tier / no prepaid credit | add credit on platform.openai.com (Tier 1+), verify the org; `vercel logs` shows the full upstream error |
| vercel dev: "Photoreal is not configured" | this CLI's `vercel dev` does not load .env.local into functions | `set -a; . ./.env.local; set +a; vercel dev --listen 3100` |
| UNIQLO sizeChartUrl returns S3 AccessDenied | those HTML pages are not public | use the size-charts API (see UNIQLO data) |
| Sweatshirts/hoodies mapped to tees | "Sweatshirts" contains "tshirt"; class "T-Shirts, Sweats & Fleece" | word-boundary patterns; judge hoods on the name |
| Hem rides up 5-8 cm in the cloth sim | pattern cut in the A-pose has a sleeve cap sized for raised arms; lowering them hauls the shirt up | drape with arms 65% lowered (poses.DRAPE); skinning covers the rest |
| Crease line / crumples in the sim | isotropic slack (negative shrink) buckles sideways; skinned-into-pose rest shapes pinch | no slack; skinned garment + animated rest -> pose; excess via hem flare |
| Neckline far too wide, notches at its corners | neck width sliced at c_neck caught the trapezius; head-clear plane cut the collar | neck slice at 72% c_neck -> c_head; HEAD_CLEAR 0.07 |
| Top pushed above the pants | pants as a cloth collider: the top starts inside its margin, the rim pushes it up | drape tops on the body only; clear the pants after (rest + every pose) |
| Pants show through a top at the waistband | turned-back strips face the body; as a collider they flip the inside test | layer over the outer shell only (GarmentMesh.outer) |
| Ragged turned hems | a straight offset strip cuts across wavy fabric | strip rows follow the outer fabric (nearest vertex - normal x thickness) |
| Turntable renders all frontal | glTF import leaves objects in quaternion rotation mode | rotation_mode = "XYZ" before rotation_euler |
| Blender can't import body.glb | web GLBs are meshopt-compressed | later steps read assets/build/body.glb (body.py keeps an uncompressed copy) |
| gltfpack drops UVs / custom attributes | it strips unused and `_*` attributes | -kv; rib mask lives in COLOR_0 |
| Vercel build looks for web/web/package.json | Root Directory set to web while install cmd already cds into web | deploy from the repo root (`vercel --prod`) |

## Garment recipe (per shape; pipeline/garments.py, order shoes -> pants -> tops)
1. Body = MHR lod1 mannequin, voxel-remeshed to even ~1 cm cloth edges. Each garment vertex keeps its origin on
   the body: skin weights and body_0..5 deltas are interpolated from it.
2. Cut by skeleton landmarks: tee hem hips-0.02 m, sleeves to mid upper arm; sweater hem hips-0.035 m, sleeves to
   the wrist; crew neck = ellipse at the neck base; pants waist hips+0.06 m, hem 4 mm above the shoe collar line.
3. Ease along normals (tee 8 mm, sweater 15 mm, pants 12 mm; 4-6 mm over the shoulders) + the fit's silhouette
   (chest ease, hem flare, sleeve flare, leg taper / barrel) -> smooth -> anti-clip.
4. Gravity drape (cloth_sim.py): garment skinned (Armature before Cloth), skeleton animates from the A-pose into
   the Relaxed stance with arms 65% down while the cloth settles on the body (pants also on the shoes). Pins:
   collar/shoulders, waistband, cuffs; knit rib bands drawn in by per-vertex shrink. Back to rest by inverse LBS.
5. Relax hems -> anti-clip at rest and in every clip (sleeves vs arm, body vs torso/legs, hands tent fabric only
   when under it, tops clear the pants' outer shell by 4 mm) -> fit_tight / fit_loose -> turned-back hem strips ->
   UVs, rib mask -> GLB -> 4-angle check renders in pipeline/renders/ -> compress_glb.mjs.

## Commands
    .venv/bin/python pipeline/body.py --fbx assets/mhr/assets/lod1.fbx --height 178 --out web/public/models/body.glb
    .venv/bin/python pipeline/garments.py --body assets/build/body.glb --out web/public/garments   # ~10 min + renders
    .venv/bin/python pipeline/fit_model.py --body assets/build/body.glb \
        --ansur assets/ansur/ANSUR_II_MALE_Public.csv --out web/public/models/fit_model.json   # data: openlab.psu.edu/ansur2
    (cd pipeline && npm ci) && node pipeline/compress_glb.mjs web/public/models/body.glb web/public/garments/*.glb
    .venv/bin/python -m pytest pipeline/tests   # pipeline unit tests
    cd web && npm run dev          # frontend only
    vercel dev                     # frontend + /api (needs .env.local)
    vercel --prod                  # deploy from the REPO ROOT, never from web/
    vercel logs <deployment-url>   # function errors
    npm run catalog                # rebuild web/public/catalog.json from UNIQLO (~20 s; --dry-run, --per-shape N)
    npm test && npm run typecheck  # api/ + scripts/ tests and types (root); web has its own in web/

## Conventions
- Small commits with clear messages; pull before committing. Run `npm run build` before every deploy.
- A contract change = edit CLAUDE.md in the same commit and say so.
- Never commit .env*, .venv, node_modules, assets/, or user photos. Never print API keys.
- UNIQLO content is used for a non-commercial demo; link back to uniqlo.com on every item.
