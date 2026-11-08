# FitRoom — SideQuest Sunday build (Nov 8, 11:00am-2:05pm PT)

**Project:** FitRoom (3D outfit try-on web app)
**Goal by 2pm:** Enter measurements -> realistic 3D avatar of you. Paste a UNIQLO link or pick from 6 bestsellers
-> it dresses you in real colours. Mix top + bottom, spin 360, switch 3 scenes, one-click photoreal shot.
**Proof:** Demo video + live Vercel link + commit history.

## Rules
- All code is written live today in this repo. Commit every ~20 min with clear messages (proof of live work).
- Scope is fixed. Feature freeze at 1:40pm PT. Quality is judged by eye: simple and clean beats ambitious and broken.

## Done means
- [ ] Realistic avatar (Meta MHR body) from typed measurements, reshaping live in the browser
- [ ] 3 garment shapes that fit cleanly: tee, sweater (crewneck), pants (straight/slim)
- [ ] Paste a UNIQLO product URL -> name, price, colourways, sizes, mapped to a shape, garment on the avatar
- [ ] 6 preloaded UNIQLO bestsellers (fallback if a pasted link fails)
- [ ] Mix top + bottom, 360 orbit, 3 scene/lighting presets (studio, city, night)
- [ ] "Make it real" -> photoreal image via OpenAI
- [ ] Live on Vercel; opens on a dressed avatar slowly auto-rotating in the city scene

## Default body (Caleb)
height 178 cm, chest 92 cm, waist 75 cm, hips 90 cm, inseam 84 cm, weight 65 kg. Slim, slight V-taper.

## Hero items (UNIQLO US)
| Item | ID | Shape | Fabric |
|---|---|---|---|
| SUPIMA Cotton T-Shirt | E455365-000 | tee | jersey |
| Crew Neck T-Shirt | E422992-000 | tee | jersey |
| Washable Milano Ribbed Sweater | E453754-000 | sweater | rib knit |
| Cashmere Sweater | E450543-000 | sweater | cashmere |
| Ultra Stretch Pants | E475598-000 | pants | twill |
| Barrel Jeans | E479000-000 | pants | denim |

UNIQLO product API (works same-origin in a browser tab; server-side access untested):
`https://www.uniqlo.com/us/api/commerce/v5/en/products/<ID>/price-groups/00/details?includeModelSize=false&httpFailure=true`
-> result.name, result.prices.base.value, result.sizes[].name, result.colors[].{displayCode,name},
result.breadcrumbs.class/category.locale, result.sizeChartUrl (format unknown - inspect before relying on it).
Swatch: `https://image.uniqlo.com/UQ/ST3/WesternCommon/imagesgoods/<num>/chip/goods_<code>_<num>_chip.jpg`
(<num> = ID without E and -000). Product URL shape: /us/en/products/E453754-000/00 -> ID = E453754-000.
Shape mapping: T-Shirts -> tee, Sweaters/Knit -> sweater, Pants/Jeans/Bottoms -> pants; anything else ->
"not supported yet" message.

## Architecture
    pipeline/  Python 3.11 + bpy (use .venv/bin/python). Offline. Writes GLBs into web/public/.
      body.py      assets/mhr/assets/lod2.fbx -> web/public/models/body.glb (with body morph targets)
      garments.py  body -> web/public/garments/{tee,sweater,pants}.glb (same skeleton + same morphs)
    web/       Vite + React + TS + three + @react-three/fiber + @react-three/drei + zustand
    api/       Vercel functions: /api/product (UNIQLO link -> item), /api/photoreal (OpenAI)

Nothing physics-based runs in the browser. Browser loads GLBs, drives morphs, tints, swaps.

## Contracts
**Body GLB** web/public/models/body.glb: one SkinnedMesh, MHR skeleton (root, c_spine0..3, c_neck, l_/r_upleg,
l_/r_lowleg, l_/r_uparm, l_/r_lowarm ...), metres, Y-up, A-pose. Morph targets body_0..body_5 = MHR shape_0..5.

**Garment GLB** web/public/garments/<shape>.glb: one SkinnedMesh skinned to the SAME bone names, same rest pose.
Same morph targets body_0..body_5, transferred from the body (each garment vertex copies the delta of its
nearest body surface point). Also fit_tight / fit_loose. Material "fabric", white base (viewer tints).
UNIQLO fits (added by A): tee.glb also has fit_boxy (Uniqlo U heavyweight tee), pants.glb has fit_barrel
(Barrel Jeans). **web/public/garments/fits.json**: items{<UNIQLO id>: {shape, morphs{name: weight}, fit}} and
name_rules[{match: regex on product name, morphs}] for pasted links. Viewer: after choosing an item, set each
listed morph influence on that garment (others 0). fit_* morphs are 0 by default; body_* copy the body.
Viewer rebinds by bone name:

    const bones = garment.skeleton.bones.map(b => avatarBonesByName.get(b.name)!);
    garment.bind(new THREE.Skeleton(bones, garment.skeleton.boneInverses), garment.bindMatrix);
    avatarArmature.add(garment);

Body GLB is exported AT Caleb's body: 1.78 m tall, default morph weights (glTF mesh.weights) already fit
chest 92 / waist 75 / hips 90 / inseam 84. Faces +Z. Morph weights are MHR PCA units, sensible range -3..3.
**web/public/models/body_measure.json** (added by A): default_weights, measured_cm_at_default, and
jacobian_cm_per_unit {chest,waist,hips}[6] = cm change per unit of body_i. MHR PCs are not one-measurement-each
(body_0 ~ overall girth/Build: +14 chest, +17 waist, +7.5 hips per unit). To map typed measurements -> weights:
w = default + pinv(J) @ (target_cm - measured_cm_at_default), clamp to -3..3.

**Female model (added by A)**: web/public/models/body_female.glb (+ body_female_measure.json), same skeleton,
same body_0..5 morph names, 1.72 m, model proportions (bust 86 / underbust 66 / waist 65.5 / hips 89). Its garments
are web/public/garments/female/{tee,sweater,pants}.glb (+ fits.json), same morphs. Swap body + garment folder
together; never mix male garments on the female body.

**Skin texture (added by A)**: body.glb / body_female.glb material "skin" has a 2048 px baseColorTexture
(skin tone, short hair, brows, painted eyes, lips). Viewer must keep the GLB material (or copy its .map), not
replace it with a flat colour.

**Poses (added by A)**: body.glb and body_female.glb carry 3 glTF animation clips, each a single keyframe of
every bone: "relaxed" (arms loose at sides, hip-width stance), "pocket" (weight on right leg, left hand at front
pocket), "walk" (mid-stride, arms swinging). Modelled on UNIQLO catalogue shots. Garments follow automatically
(bound to the avatar bones). Default to "relaxed" (the rest A-pose is only for binding):

    const mixer = new THREE.AnimationMixer(avatarScene);
    const act = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'relaxed'));
    act.play(); mixer.update(0);          // switch: other.reset().play(); act.crossFadeTo(other, 0.4); tick mixer

**Body controls (viewer)**: Height scales the avatar root. Sliders Build / Chest / Waist / Hips drive
body_0..body_3 on the body AND every garment at once. Measurement inputs map to slider values.

**Catalog item** (web/public/catalog.json and /api/product response):
`{ id, name, price, salePrice|null, slot: "top"|"bottom", shape: "tee"|"sweater"|"pants", fabric, url,
colors: [{ code, name, hex, swatch }], sizes: [..] }`

**POST /api/product** `{ url }` -> catalog item, or `{ error }`. If UNIQLO blocks server requests, fall back
to a "paste product JSON" box (user runs a console snippet on uniqlo.com).

**POST /api/photoreal** `{ image: <PNG or JPEG data URL>, scene, outfit? }` -> `{ image, remaining }` (B: client sends JPEG
to stay under Vercel's 4.5 MB body cap). OpenAI images.edit,
input_fidelity "high". Prompt: keep every garment, colour, silhouette and the pose exactly; realistic fabric;
the chosen setting; full body; no logos or text. Limit ~5 calls per visitor.

## Pitfalls (learned in research)
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

## Garment recipe (per shape)
1. Body proxy = MHR body (watertight already). Copy skin weights.
2. Cut region by skeleton landmarks: tee = hips-0.10 m to neck, sleeves ~45% of upper arm; sweater = hips-0.13 m
   to neck, sleeves to wrist; pants = ankle+0.03 m to hips+0.06 m. Arms found by arm skin weight (A-pose).
3. Inflate along normals (tee 8 mm, sweater 15 mm, pants 10 mm) -> smooth -> anti-clip.
4. Optional short cloth relax (pin shoulders / waistband) -> anti-clip.
5. Spike cleanup -> solidify -> re-skin from body -> drop unused groups by name -> transfer body morphs -> UVs -> GLB.

## Commands
    .venv/bin/python pipeline/body.py --fbx assets/mhr/assets/lod2.fbx --height 178 --out web/public/models/body.glb
    .venv/bin/python pipeline/garments.py --body web/public/models/body.glb --out web/public/garments
    cd web && npm run dev          # or: vercel dev (runs /api too)
    vercel --prod

## Conventions
- Never commit .env*, .venv, node_modules, assets/, photos. UNIQLO content is demo use only.
