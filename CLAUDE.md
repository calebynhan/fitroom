# FitRoom — personalised outfit photos

**What it is:** Shoppers upload three photos of themselves (front, side, left face profile) and their height and weight,
pick real UNIQLO pieces, get the size to buy, and receive four photoreal shots of themselves wearing the outfit in that
size (front, three-quarter, side, back), like the model photos on a product page, but of them.
**Why:** People return clothes because they looked different on the model. FitRoom shows the clothes on *you*.
**Status:** The SideQuest Sunday hackathon (Nov 8, 2026) produced a 3D proof of concept, live at fitroom-woad.vercel.app.
On 2026-11-09 the app moved from the 3D mannequin to generating the photos directly from the shopper's own photos;
the Blender pipeline is kept in the repo but no longer used (see Legacy). Quality over speed, and nothing ships broken.

## Product principles
- **Honest fit beats flattering.** The size chart decides how the garment sits (ease and hem length) and the prompt says
  so; never slim, bulk up or idealise the person. A size up must look roomier in the shots.
- **Their photos are theirs.** Photos stay in browser memory (never localStorage), pass straight through
  /api/photoreal to OpenAI, and are never stored or logged by FitRoom. Only photos of yourself (the UI says so).
- **Every feature works on the live URL, on desktop and mobile**, with real error messages instead of silent failures.
- **Black-and-white, Banana Republic-style design.** Use the FitRoom design system:
  paper #FFFFFF, bone #F4F1EC, stone #E4DFD6, hairline #D6D1C8, ink #111111, graphite #3A3835, muted #6F6A63,
  khaki #8B7E66 (accent, never text), sale #8E2A21. Cormorant Garamond for display, Inter for UI.
  Radii 0 / 2px / pill. Spacing 4/8/16/24/48/80.

## v1 platform: done means
**Core loop**
- [ ] Onboarding: three photos (front full body, side full body, left face profile), downscaled in the browser; height
      + weight (required), chest / waist / hips / inseam (optional; estimated from height + weight via the ANSUR II
      regression when blank). Unit toggle in/lb ↔ cm/kg. Measurements saved to localStorage, photos never.
- [ ] Four shots per look (front, three-quarter, side, back) that keep the person's identity and proportions and match
      each other (same garments, shoes, light), about 30–60 s, with per-photo progress, retry, and download.
- [ ] Size recommendation per item ("You're an M; L if you want it roomier"), from UNIQLO size charts vs. the
      user's measurements. The chosen size changes how the garment sits in the shots (ease + length).

**Catalog**
- [ ] UNIQLO men's tees, sweaters and pants (aim for 30+ items), with real names, prices, colors, swatches,
      product photos and size charts, refreshed by a script.
- [ ] Paste any UNIQLO US product link and it loads. Unsupported categories get a clear message.

**Experience**
- [ ] Mix tops and bottoms; settings (Studio / City / Night).
- [ ] Save outfits; share an outfit by link (state encoded in the URL; never the photos).
- [ ] Mobile layout: photos on top, controls below (bottom sheet later).

**Production**
- [ ] Rate limit /api/photoreal and cap total daily spend (in place: 3 looks per visitor cookie, 48 photos per IP and
      200 per instance per day, both in memory per warm instance, so best effort; next: shared counters (Vercel KV /
      Upstash) and a hard monthly budget on the OpenAI project; verify on the live URL).
- [ ] Error handling on every API call; loading states.
- [ ] OG image + metadata, Vercel Analytics, a short About / how-it-works section.

## Default body (Caleb)
5'10" (178 cm), 143 lb (65 kg), chest 92 cm, waist 75 cm (29"), hips 90 cm, inseam 84 cm. Slim, slight V-taper.
Recommended sizes: Milano Ribbed Sweater S, Crew Neck T-Shirt S, Ultra Stretch Pants S, Slim Chino 30inch.

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
    web/       Vite + React + TS + zustand. No 3D.
      photos/prepare.ts   decode (EXIF-aware), downscale (body 1024 px, face 768 px), JPEG data URL; memory only
      body/profile.ts     measurements, ANSUR estimates, units, localStorage
      fit/sizing.ts       size recommendation + ease/length of the chosen size on this body
      look/request.ts     app state -> the request every view shares + a key (same key = same photos)
      look/shoot.ts       front first, then three-quarter / side / back in parallel with the front shot attached
      state/looks.ts      photos per look key (revisiting an outfit costs nothing), busy flag, looks left
      ui/                 Header (Make my shots), Lookbook (4 frames + Lightbox), Photo/Measure/Outfit/Scene sections
    api/       Vercel functions: /api/product, /api/photoreal (shared contract: api/_lib/look.ts)
    scripts/   Node/TS data scripts: catalog ingest, size-chart parsing -> web/public/catalog.json
    pipeline/  LEGACY (unused by the app): Python + bpy 3D mannequin and garments. See Legacy below.

Env (Vercel + .env.local): OPENAI_API_KEY (required), OPENAI_IMAGE_MODEL (default gpt-image-1.5),
OPENAI_IMAGE_QUALITY (default medium), PHOTOREAL_DAILY_CAP (photos per warm instance per day, default 200),
PHOTOREAL_DISABLED=1 (kill switch).

## Contracts
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

**POST /api/photoreal** (one photo of one view; types and validation in api/_lib/look.ts)
`{ view: "front"|"three_quarter"|"side"|"back", scene: "studio"|"city"|"night", body: { heightCm, weightKg, chestCm,
waistCm, hipsCm, inseamCm }, items: [{ slot, name, color, fabric, size?, ease?, length?, image? }], photos: { front,
side, face }, reference?, lookToken? }` -> `{ image, view, lookToken?, remaining }` or `{ error, detail?, retryable,
remaining? }`.
- photos / reference: JPEG/PNG/WebP data URLs, ≤ 1.5 M chars each and ≤ 4 M together (Vercel rejects bodies over
  4.5 MB). The browser budgets front/side 900 K, face 450 K and the finished front shot 900 K (photos/prepare.ts,
  look/shoot.ts), lowering JPEG quality, then size, to fit. `body` is complete (the client fills estimates). `ease` = close|regular|relaxed|oversized,
  `length` = cropped|regular|long (tops) or cropped|ankle|full|long (bottoms). `image` = UNIQLO product photo, accepted
  only from https://image.uniqlo.com/ and fetched server-side without redirects; if it fails the garment is described
  in words. Item text is sanitised to letters, digits and plain punctuation before it reaches the prompt.
- Front: costs one look (signed HttpOnly cookie `fr_looks`, LOOK_LIMIT 3) when it succeeds, and returns `lookToken`
  (HMAC, 30 min, bound to a digest of photos + body + items + scene). A front is refused unless all 4 photos of the
  look still fit under today's IP and instance caps. Other views need `lookToken` + `reference` (the finished front
  shot, ≤ 1024 px) and cost no look; each angle is claimed while it develops (a duplicate gets 409), succeeds once per
  token (409 after), and gets at most 3 billed attempts. 403 = expired/forged token or a different look.
  `remaining` = looks left. 400 bad input (message is shopper-facing); 429 limits (the "already developing on your
  network" one is `retryable` with `Retry-After`); 503 not configured / paused. The OpenAI call gets what is left of a
  112 s budget (vercel.json maxDuration 120); the product-photo fetch times out at 4 s.
- OpenAI images.edit, multipart `image[]` in this order: front photo, side photo, face profile, [front shot],
  [top product photo], [bottoms product photo]; the prompt names them "Image 1..n" (high input fidelity favours the
  first, so the front photo leads). input_fidelity high, 1024x1536, JPEG. Prompt (api/_lib/photorealPrompt.ts): keep
  identity and real proportions with the body numbers, never slimmer/taller/younger; each garment exactly as its
  product photo with size and fit on this body; plain white sneakers; per-view direction; setting; no logos or text.

**Size recommendation** (web/src/fit/sizing.ts): the smallest size whose body ranges cover the user's. Tops go by
chest, plus waist only when the user typed one (an ANSUR estimate, SD 4.4 cm, must not push a size up); bottoms go
by waist (estimated if blank), plus hips only when typed. If no size covers the body, the largest is shown as "Runs
small for you" and rendered tight. Ease of the chosen size: more than 4 cm over its body range = close; otherwise
garment circumference - body (tops chest: <8 close, <16 regular, <25 relaxed, else oversized; bottoms hips: <6, <14,
<24); without garment numbers, steps from the recommended size. Length: tops vs 0.39 x height (±5 cm), pants vs
inseam - 4 cm (≤ -10 cropped, ≤ -4 ankle, ≤ +5 full, else long). Both go into the prompt.

## Pitfalls (learned so far)
| Symptom | Cause | Fix |
|---|---|---|
| "Photos are paused: … no image credit" (was "could not make this image") | OpenAI org has 0 TPM for gpt-image (429 "Limit 0"): Free tier / no prepaid credit | add credit on platform.openai.com (Tier 1+), verify the org; `vercel logs` shows the full upstream error |
| vercel dev: "Photoreal is not configured" | this CLI's `vercel dev` does not load .env.local into functions | `set -a; . ./.env.local; set +a; vercel dev --listen 3100` |
| UNIQLO sizeChartUrl returns S3 AccessDenied | those HTML pages are not public | use the size-charts API (see UNIQLO data) |
| Sweatshirts/hoodies mapped to tees | "Sweatshirts" contains "tshirt"; class "T-Shirts, Sweats & Fleece" | word-boundary patterns; judge hoods on the name |
| Vercel build looks for web/web/package.json ("Vercel – web" check red on every push) | a second Vercel project "web" had Root Directory = web while the install cmd already cds into web; deleted 2026-11-09 | one project only ("fitroom", Root Directory = repo root); deploy from the repo root (`vercel --prod`) |
| `rib_knit` reached the prompt as "ribknit" | the text cleaner stripped `_` before it was turned into a space | replace `_` first, then clean (api/_lib/look.ts parsePieces) |
| Parallel angles under-count the visitor's looks | each response sets the cookie to the count it read + 1 | one look = the front shot; the angles ride on the signed look token and never touch the cookie |
| App freezes / "getSnapshot should be cached" | a zustand selector returned a new object every render | select slices, derive with useMemo (look/useLookInput.ts) |
| Imperial value drifts on blur (178 cm -> 177.8) | re-committing a rounded display value | commit only when the typed text differs from the stored value (MeasureSection NumberBox) |
| A paid front whose angles then hit "a lot of photos today" | the cap check only made room for 1 photo | a new look needs room for all 4 (rateLimit.check) |
| Shoot Again wiped 4 paid photos when the new front failed | the look was reset before the front succeeded | restore the earlier look with a notice (look/shoot.ts) |
| Every deploy uploads 57 MB of unused 3D assets | web/public is copied into dist | .vercelignore excludes web/public/{hdri,models,garments} |
| Vercel build log full of TS2339 "Property 'status' does not exist" on `ok` unions | no root tsconfig: Vercel's Node builder then sets module NodeNext and forces strict: false, so `if (!r.ok)` doesn't narrow | root tsconfig.json pins module/moduleResolution NodeNext (what Vercel emits) with strict on; `npm run typecheck` runs it |
| /api/photoreal.test answers 500 FUNCTION_INVOCATION_FAILED | every .ts directly in api/ deploys as a function, test files too | .vercelignore excludes api/**/*.test.ts |

## Commands
    cd web && npm run dev          # frontend + /api (vite serves api/*.ts; reads OPENAI_API_KEY from ../.env.local)
    cd web && npm test && npm run typecheck && npm run build
    npm test && npm run typecheck  # api/ + scripts/ tests and types (root; also api/ as Vercel compiles it: tsconfig.json)
    vercel dev                     # Vercel's own dev server (needs .env.local loaded, see Pitfalls)
    vercel --prod                  # deploy from the REPO ROOT, never from web/
    vercel logs <deployment-url>   # function errors
    npm run catalog                # rebuild web/public/catalog.json from UNIQLO (~20 s; --dry-run, --per-shape N)

## Conventions
- Small commits with clear messages; pull before committing. Run `npm run build` before every deploy.
- A contract change = edit CLAUDE.md in the same commit and say so.
- Never commit .env*, .venv, node_modules, assets/, or user photos. Never print API keys.
- UNIQLO content is used for a non-commercial demo; link back to uniqlo.com on every item.

## Legacy: 3D pipeline (unused by the app since 2026-11-09)
The web app no longer loads any of this; it is kept until the photo flow is proven on the live URL, then can be
deleted (pipeline/, web/public/models, web/public/garments, web/public/hdri; .vercelignore already keeps the last
three out of deploys). The 3D viewer code lives in git history
(before the photo pivot commit). web/src/body/profile.ts copies the ANSUR `estimate` block from fit_model.json.
Fitted morph weights for the default body (lod1 mannequin): body_0 -1.62, body_1 -1.28, body_2 0.74, body_3 0.16,
body_4 0.12, body_5 -0.18. body_1 positive adds a bust (female direction); keep it ≤ 0 for men.

**Body GLB** web/public/models/body.glb: one SkinnedMesh (MHR lod1, ~18k verts), MHR skeleton (root, c_spine0..3,
c_neck, l_/r_upleg, l_/r_lowleg, l_/r_uparm, l_/r_lowarm ...), metres, Y-up, A-pose. Morph targets body_0..body_5
= MHR shape_0..5. Store mannequin: no texture (the viewer colours it), smooth scalp, no nipples. COLOR_0 =
(0, AO, 0): baked self-occlusion in the Relaxed clip (1 = open, raw linear); it is not paint.
Clips relaxed / pocket / walk stand the feet 1.8 cm up (poses.SOLE_LIFT) so shoes.glb's soles touch y = 0.
Relaxed = mannequin stance, arms a little away from the waist, palms toward the thighs.
body_measure.json: tape measurements + jacobian at the default weights.

**Garment GLB** web/public/garments/<shape>.glb, shape = tee | sweater | pants | shoes: one SkinnedMesh skinned to
the SAME bone names, same rest pose, morph targets body_0..body_5 (each vertex follows the body point it was cut
from). Clothes add fit_tight / fit_loose: at weight 1 = -/+3 cm of garment circumference ease (a size down / up;
partial weights interpolate), plus fit_boxy (tee) and fit_barrel (pants) set per item by fits.json. Material
"fabric", white base (the viewer tints). shoes.glb: material "shoe", body morphs only, always worn. Clothes are
single-sided cloth with turned-back hems: render DoubleSide. UVs in metres (u around the body/limb, v along it).
COLOR_0 = (rib mask, AO, 0): .r = 1 on crew collars and sweater cuffs/hem band (rib normal map), .g = baked
ambient occlusion by the body + the garment itself in Relaxed (1 = open, raw linear). Not a tint.
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

### Pitfalls (3D)
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
| Hem rides up 5-8 cm in the cloth sim | pattern cut in the A-pose has a sleeve cap sized for raised arms; lowering them hauls the shirt up | drape with arms 65% lowered (poses.DRAPE); skinning covers the rest |
| Crease line / crumples in the sim | isotropic slack (negative shrink) buckles sideways; skinned-into-pose rest shapes pinch | no slack; skinned garment + animated rest -> pose; excess via hem flare |
| Neckline far too wide, notches at its corners | neck width sliced at c_neck caught the trapezius; head-clear plane cut the collar | neck slice at 72% c_neck -> c_head; HEAD_CLEAR 0.07 |
| Top pushed above the pants | pants as a cloth collider: the top starts inside its margin, the rim pushes it up | drape tops on the body only; clear the pants after (rest + every pose) |
| Pants show through a top at the waistband | turned-back strips face the body; as a collider they flip the inside test | layer over the outer shell only (GarmentMesh.outer) |
| Ragged turned hems | a straight offset strip cuts across wavy fabric | strip rows follow the outer fabric (nearest vertex - normal x thickness) |
| Turntable renders all frontal | glTF import leaves objects in quaternion rotation mode | rotation_mode = "XYZ" before rotation_euler |
| Blender can't import body.glb | web GLBs are meshopt-compressed | later steps read assets/build/body.glb (body.py keeps an uncompressed copy) |
| gltfpack drops UVs / custom attributes | it strips unused and `_*` attributes | -kv; rib mask lives in COLOR_0 |
| Garments "full of holes" when welded | turned-back strip rows snapped to the nearest vertex stack on one spot (zero-area faces) | project strip rows onto the fabric surface; drop degenerate faces; glb_tools.mesh_report |
| Shirt side panels torn by the forearms | arms skinned into the shirt after the drape | Relaxed with arms off the waist; forearms push side fabric inward (below the chest only) |
| Shoulders shredded after a collision pass | sleeve verts vs torso faces / torso fabric vs deltoid read as "inside" | sleeves collide with arm faces only; inward push only for forearms/hands below the chest |
| Pants legs crumpled to capri length | clearance vs the shoes tested every vertex: a thigh 40 cm up read as "behind" a collar face and was thrown onto the shoe | test only verts within 3 cm of a lower garment (UNDER_REACH) |
| Texture squashed in one strip of triangles | cylindrical UV angle wraps from +pi to -pi inside a triangle | per-corner UVs, shift the wrapped corners one circumference |

### Garment recipe (per shape; pipeline/garments.py, order shoes -> pants -> tops)
1. Body = MHR lod1 mannequin, voxel-remeshed to even ~1 cm cloth edges. Each garment vertex keeps its origin on
   the body: skin weights and body_0..5 deltas are interpolated from it.
2. Cut by skeleton landmarks: tee hem hips-0.02 m, sleeves to mid upper arm; sweater hem hips-0.035 m, sleeves to
   the wrist; crew neck = ellipse at the neck base; pants waist hips+0.06 m, hem draped 4 mm above the shoe
   collar line, then dropped 1.2 cm over it after the drape (draping it overlapped catches the hem on the shoes).
3. Ease along normals (tee 8 mm, sweater 15 mm, pants 12 mm; 4-6 mm over the shoulders) + the fit's silhouette
   (chest ease, hem flare, sleeve flare, leg taper / barrel) -> smooth -> anti-clip.
4. Gravity drape (cloth_sim.py): garment skinned (Armature before Cloth), skeleton animates from the A-pose into
   the Relaxed stance with arms 65% down while the cloth settles on the body (pants also on the shoes). Pins:
   collar/shoulders, waistband, cuffs; knit rib bands drawn in by per-vertex shrink. Back to rest by inverse LBS.
5. Relax hems -> anti-clip at rest and in every clip (sleeves vs arm, body vs torso/legs, hands tent fabric only
   when under it, forearms push side-panel fabric inward, tops clear the pants' outer shell by 4 mm) -> unfold
   folded faces -> fit_tight / fit_loose -> turned-back hem strips (projected onto the fabric) -> UVs split at the
   wrap, rib mask + baked AO (bake_ao.py) -> GLB (degenerate faces dropped, sharp folds) -> mesh check -> 4-angle
   renders in pipeline/renders/ -> compress_glb.mjs.

Commands (legacy):

    .venv/bin/python pipeline/body.py --fbx assets/mhr/assets/lod1.fbx --height 178 --out web/public/models/body.glb
    .venv/bin/python pipeline/garments.py --body assets/build/body.glb --out web/public/garments   # ~10 min + renders
    .venv/bin/python pipeline/fit_model.py --body assets/build/body.glb \
        --ansur assets/ansur/ANSUR_II_MALE_Public.csv --out web/public/models/fit_model.json   # data: openlab.psu.edu/ansur2
    (cd pipeline && npm ci) && node pipeline/compress_glb.mjs web/public/models/body.glb web/public/garments/*.glb
    .venv/bin/python -m pytest pipeline/tests   # pipeline unit tests
