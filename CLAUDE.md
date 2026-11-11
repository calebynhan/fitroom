# FitRoom — personalised outfit photos

**What it is:** Shoppers upload three photos of themselves (front, side, left face profile) and their height and weight,
pick real UNIQLO pieces, get the size to buy, and receive four photoreal shots of themselves wearing the outfit in that
size (front, three-quarter, side, back), like the model photos on a product page, but of them.
**Why:** People return clothes because they looked different on the model. FitRoom shows the clothes on *you*.
**Status:** The SideQuest Sunday hackathon (Nov 8, 2026) produced a 3D proof of concept, live at fitroom-woad.vercel.app.
On 2026-11-09 the app moved from the 3D mannequin to generating the photos directly from the shopper's own photos;
the Blender pipeline is kept in the repo but no longer used (see Legacy). On 2026-11-10 generated photos (OpenAI) were
found not to keep the shopper's likeness, so the default engine became free virtual try-on: the shopper's own photo,
re-dressed by FASHN VTON v1.5 on its free Hugging Face Space (see Photo engines). Quality over speed, and nothing ships
broken.

## Product principles
- **Honest fit beats flattering.** The size chart decides how the garment sits (ease and hem length) and the prompt says
  so; never slim, bulk up or idealise the person. A size up must look roomier in the shots.
- **Their photos are theirs.** Photos stay in browser memory (never localStorage) and are never stored or logged by
  FitRoom. Try-on engine: they go from the browser straight to the public FASHN Space, which keeps uploads on its
  server for a while (Gradio's file cache, outside our control); the UI says so. OpenAI engine: they pass through
  /api/photoreal to OpenAI. ChatGPT plugin: the shopper attaches the photo in ChatGPT (OpenAI holds it under its
  terms); /api/mcp downloads it into memory, sends it to the FASHN API as base64 with `return_base64` (FASHN keeps no
  image copy past the request), and returns the result to the widget only (`_meta`, never to the model); nothing is
  stored or logged. Only photos of yourself (the UI and the tool description say so).
- **Every feature works on the live URL, on desktop and mobile**, with real error messages instead of silent failures.
- **Black-and-white, Banana Republic-style design.** Use the FitRoom design system:
  paper #FFFFFF, bone #F4F1EC, stone #E4DFD6, hairline #D6D1C8, ink #111111, graphite #3A3835, muted #6F6A63,
  khaki #8B7E66 (accent, never text), sale #8E2A21. Cormorant Garamond for display, Inter for UI.
  Radii 0 / 2px / pill. Spacing 4/8/16/24/48/80.

## v1 platform: done means
Rewritten 2026-11-11 for the free try-on engine (the default). Ticked = built and checked in a browser on a local build;
the last step for every item is the same check on the live URL, on desktop and a phone.

**Core loop**
- [x] Onboarding: a full-body front photo (side optional), downscaled in the browser; height + weight (required), chest /
      waist / hips / inseam (optional; estimated from height + weight via the ANSUR II regression when blank). Unit toggle
      in/lb <-> cm/kg. Measurements saved to localStorage, photos never.
- [x] The try-on photo: the shopper's own front photo wearing the top and the bottoms (the side photo on request), face,
      body, pose and background kept, ~30-60 s, with progress, Cancel, Retry and Download; what it costs in free GPU time
      said before it runs out (tryon/allowance.ts).
- [x] Size recommendation per item ("You're an M; L if you want it roomier"), from UNIQLO size charts vs. the user's
      measurements, honest about estimates (borderline sizes).
- [x] Fit confidence: a fit card per item (the chosen size vs one other, in numbers: chest/hip room, where the hem lands,
      shoulders/thigh, sleeve/inseam) and fit preferences (Close / Regular / Relaxed per slot, or a top / pants of their
      own measured flat) that drive the pick. The photo can't show size (the model draws the garment as photographed), so
      size lives in numbers, said under the photo.

**Catalog**
- [x] UNIQLO men's tees, sweaters and pants (34 items), with real names, prices, colors, swatches, product photos and
      size charts, refreshed by a script (`npm run catalog`, from a home connection).
- [x] Paste any UNIQLO US product link and it loads. Unsupported categories get a clear message.

**Experience**
- [x] Mix tops and bottoms.
- [x] Save outfits; share an outfit by link (state encoded in the URL; never the photos).
- [x] Mobile layout: photos on top, controls below (bottom sheet later).

**Production**
- [x] Error handling on every API call and Space call (deadlines, Cancel, shopper-facing messages); loading states.
- [x] OG image + metadata (web/index.html, web/public/og.png 1200x630, favicon.svg), Vercel Analytics (web/src/analytics.ts:
      page views without cookies, URLs stripped of query/hash; a `tryon` event per photo { outcome ok|partial|quota|busy|
      timeout|unreachable|cancelled|photo|error, reason, view, garments, reused, seconds } (custom events need Vercel
      Pro; on Hobby only page views count); Web Analytics must be enabled in the Vercel project), About / how-it-works
      (ui/AboutSection).
- [x] Installable web app (PWA): web/public/manifest.webmanifest (standalone, white) + icons rendered from favicon.svg by
      `npm run icons` (scripts/app-icons.mjs: apple-touch-icon.png 180 px opaque, icons/icon-192.png and icon-512.png; the
      512 doubles as the maskable icon, the F sits inside the safe zone); scripts/app-icons.test.ts checks them. The F is a
      path (Cormorant Garamond 500), so the favicon no longer falls back to Georgia. No service worker: nothing works
      offline (try-on needs the Space) and a cached shell would serve an old build after a deploy; Chromium installs
      without one (no installability errors, 2026-11-11). iOS gives a home-screen app its own storage, so measurements and
      saved outfits from Safari don't carry over. Phone check: Add to Home Screen, then a try-on and Download inside it.
- [ ] Capacity: about 4 free passes per visitor per day on a Space we don't control. Done: passes reused, side photo on
      request, the allowance shown (Phase 6). Next: our own duplicate of the Space (VITE_TRYON_SPACE), a week of outcome
      counts, then maybe "Sign in with Hugging Face" (5 GPU-min instead of 2).

**Paid generator only** (VITE_PHOTO_ENGINE=openai): four shots per look (front, three-quarter, side, back) with settings
(Studio / City / Night) and a free size-comparison front shot; /api/photoreal rate-limited (3 looks per visitor cookie, 48
photos per IP and 200 per instance per day, in memory per warm instance, so best effort; shared counters and a hard
monthly OpenAI budget before it is ever turned on for the public).

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
(pants), Slim Chino Pants E450251-000 (pants). Items with `sizeGender` WOMEN are refused ("sized for women"): Barrel
Jeans E479000-000 (22-34 inch) came in through the men's listing; removed from catalog.json by hand on 2026-11-10
(UNIQLO's API refuses cloud-session IPs; the next `npm run catalog` applies the rule to every item).

## Architecture
    web/       Vite + React + TS + zustand. No 3D.
      photos/prepare.ts   decode (EXIF-aware), downscale (front 1536 px, side 1024 px, face 768 px), JPEG data URL;
                          memory only; photoWarning flags body photos that make poor try-ons: landscape (person
                          small), under 1000 px tall (soft: the model outputs 864), mean luma < 60 (dark)
      body/profile.ts     measurements, ANSUR estimates, units, fit preferences + reference garment, localStorage
      fit/sizing.ts       size pick (chart, preference or reference garment), ease/length, comparison size + deltas
      fit/fitCard.ts      the fit card: two sizes on this body in numbers (cm or in)
                          (these three and catalog/types.ts are re-export stubs: the code lives in api/_lib/fit/, shared
                          with the ChatGPT plugin; Vercel compiles api/ as CommonJS and web/ as ESM, so a function
                          can't load web/src. Edit api/_lib/fit/*.ts)
      look/engine.ts      which engine makes the photos (VITE_PHOTO_ENGINE): useShotInput / makeShots / retryShot
      tryon/space.ts      free engine: @gradio/client (lazy chunk) -> FASHN VTON v1.5 Space (ours, then FASHN's); errors in
                          shopper words
      tryon/garment.ts    garment photo: UNIQLO's garment-only shot (goods_*) when it exists, else the catalogue photo;
                          flat-lay vs model judged from the top-centre backdrop
      tryon/composite.ts  sharper results: the model's output only where the clothes changed (solid per-row region,
                          feathered, lightly sharpened), the shopper's own photo everywhere else
      tryon/shoot.ts      the front: top, then bottoms on that result (side photo on request); finished passes reused;
                          partial photo kept; quota stops the rest
      tryon/allowance.ts  estimate of the free GPU allowance (passes today, used up, when it's back), localStorage
      outfit/             share links (share.ts), saved outfits (saved.ts), wearing either (load.ts)
      look/request.ts     app state -> the request every view shares + a key (same key = same photos)
      look/shoot.ts       front first, then three-quarter / side / back in parallel with the front shot attached;
                          shootCompare = the front again with one item in its comparison size
      state/looks.ts      photos per look key (revisiting an outfit costs nothing), each look's views (`order`),
                          busy flag, looks left
      analytics.ts        Vercel Web Analytics (production builds only) + try-on outcome events; never photos or outfits
      ui/                 Header (Make my shots, How it works), Lookbook (4 frames + Lightbox + Compare sizes), FitTable,
                          BeforeAfter (lightbox: drag between the shopper's photo and the try-on; done.before),
                          LooksStrip ("Your try-ons": every outfit tried on these photos; one tap goes back, free),
                          Photo/Measure/Fit/Outfit/Scene/About sections, SavedOutfits,
                          TryOnBudget (allowance note, "Try your side photo too")
    api/       Vercel functions: /api/product, /api/photoreal (shared contract: api/_lib/look.ts), /api/mcp (ChatGPT plugin)
      _lib/fit/           profile, sizing, fitCard, catalogItem, garmentPhoto: pure code shared by web (via @api) and api
      _lib/productLookup.ts  UNIQLO product by ID (cache, dedupe), used by /api/product and the plugin
      _lib/mcp/           the plugin: server.ts (tools, widget resource), catalog.ts, sizing.ts (body input -> advice),
                          tryOn.ts (FASHN API), quota.ts (free photos per ChatGPT user), widget.html (the card)
    scripts/   Node/TS data scripts: catalog ingest, size-chart parsing -> web/public/catalog.json
    pipeline/  LEGACY (unused by the app): Python + bpy 3D mannequin and garments. See Legacy below.

Env (Vercel + .env.local): VITE_TRYON_SPACE (build time: `owner/name` of our own duplicate of the FASHN Space; unset =
FASHN's), VITE_PHOTO_ENGINE (build time: unset = free try-on Space, `openai` = the paid generator
below), OPENAI_API_KEY (only for the openai engine), OPENAI_IMAGE_MODEL (default gpt-image-1.5),
OPENAI_IMAGE_QUALITY (default medium), PHOTOREAL_DAILY_CAP (photos per warm instance per day, default 200),
PHOTOREAL_DISABLED=1 (kill switch).
ChatGPT plugin (/api/mcp): FASHN_API_KEY (try-on photos; unset = try_on says it's not switched on), TRYON_FREE_PER_MONTH
(default 5 per ChatGPT user), TRYON_DAILY_CAP (default 100 photos a day for everyone), TRYON_DISABLED=1 (kill switch),
UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL + KV_REST_API_TOKEN (shared counters; unset = in
memory per warm instance, best effort), AFFILIATE_URL_TEMPLATE (wraps product links, `{url}` = the encoded UNIQLO URL).

## Photo engines
**Try-on (default, free)**: FASHN VTON v1.5 (Apache-2.0) on https://huggingface.co/spaces/fashn-ai/fashn-vton-1.5,
called from the shopper's browser with @gradio/client, connected by URL (https://fashn-ai-fashn-vton-1-5.hf.space/;
by name it first asks huggingface.co for metadata). Endpoint `/try_on`: { person_image, garment_image, category:
tops|bottoms|one-pieces, garment_photo_type: flat-lay|model (garment.ts decides per photo), num_timesteps (we use 30,
default 50), guidance_scale 1.5, seed 42, segmentation_free true } -> one image (576x864 WebP). The Space sends CORS for
any origin. The front photo gets the top, then the bottoms on that result: ~26 s a pass. The side photo (optional) is
tried only when the shopper asks, after the front ("Try your side photo too"; also only then uploaded). No face
close-up, no setting. Finished passes are kept in memory per (photo version, view, garments so far), last 16: the same
photo in the same top is reused when only the bottoms change, Try On Again costs nothing (the seed is fixed, so it
would be the same photo anyway), and a retry after a partial photo starts from the part that worked. Order stays top
then bottoms (a bottoms-first order would make the same outfit depend on the path taken). The photo keeps their face, body, pose and background; it shows the
garment as photographed, not in their size, so size lives in the fit card (no size-comparison photo). Sizes are not in
the look key: changing a size keeps the photo.
Limits: the Space runs one job at a time for everyone (queue max 30). ZeroGPU daily quota (docs, 2026-11-10):
unauthenticated 2 GPU-minutes, free account 5, PRO 40; it resets 24 h after the first use. Anonymous visitors get a few
passes a day, then "You have exceeded your ZeroGPU runs limit". tryon/allowance.ts estimates it (4 passes a day from the
first pass, 0 after a quota error, back 24 h after the first pass; localStorage `fitroom.gpu.v1`) and says what a try-on
costs before it starts; it is shared by everyone on the network, so only ever "about". The Space belongs to FASHN (no SLA; they can pause or
remove it). Free accounts in good standing (verified email, > 30 days old) can host 2 ZeroGPU Spaces, so a duplicate
under our own account is the free way to control availability and get our own queue (visitors still use their quota).
Own Space: on the FASHN Space page, menu (three dots) > Duplicate this Space, keep ZeroGPU and Public (the browser calls
it without a token), then set VITE_TRYON_SPACE=<you>/<name> in Vercel (Production + Preview) and redeploy. The app tries
ours first and falls back to FASHN's when ours doesn't connect within 20 s (sleeping, building, paused); a quota or busy
error is not a reason to switch (the quota is the visitor's, on every Space).
A quota error keeps any finished pass as a partial photo with a note and stops the remaining photos.
Deadlines (tryon/space.ts): connect 20 s per Space; a job is given up when there is no progress (no new queue position or stage)
for 120 s or after 10 min in all, then `job.cancel()` and a retryable "taking too long"; result download 30 s; garment
photo 15 s. A Cancel link on the developing frame aborts the run and frees the app. Changing or removing a photo drops
every cached input holding the old one (tryon/shoot.ts, and the OpenAI `sessions`) and stops a run still using it;
out-of-date looks have no Retry. A retry that makes nothing keeps the photo already there. gradio's own messages
("This application is currently busy", "GPU task aborted", "No GPU was available") read as busy. Garment photos fall
back to the catalogue photo only on 403/404/410 or a non-image; network errors and 5xx fail (and aren't cached).
UNIQLO's image CDN sends no CORS headers: product photos load from the same site via `/uniqlo/*` (vercel.json rewrite to
https://image.uniqlo.com, vite.config.ts proxy in dev).
Accuracy (tested 2026-11-10 on the owner's photos, 8 passes): identity, pose and background always kept; garment type
and colour right. Fixed since: (1) the catalogue photo (usgoods_*) is worn by a model and the model copied its styling
(undershirt under a sweater, tucked tee, a jacket over pants) -> use the garment-only shot
`/UQ/ST3/WesternCommon/imagesgoods/<num>/item/goods_<code>_<num>_3x4.jpg` when it exists (some are model shots too:
garment.ts: model = something in the top-centre band (> 5%) AND skin tones in the upper third (> 1%); coverage alone
misread tall flat pants whose waistband reaches the band; 68/68 on the catalog's photos), which also gave
truer colour; (2) output is ~486x864 -> composite.ts uses the model's output only in the region the try-on changed and
the shopper's photo (at its own resolution, 864x1536 for the front) everywhere else: changed = 3x3 mean of the largest
channel difference > 24 (40 left holes in the garment, 16 caught sand and wall texture); per row, leftmost to rightmost
dense change, smoothed over 3% of the height (widest wins, which also fills rows inside the garment), widened 3% of the
width, between the first and last garment rows +-1.2%, feathered 1.2%; unsharp mask 0.5 (radius 2 px) on the enlarged
output inside that box (1.0 haloed). Inside the region, where both images show skin in the same place (YCbCr skin box,
light to very dark tones alike; largest channel difference < 48; eroded 1 px, softened) the shopper's own skin is kept:
sharper hands, forearms and neck. Off when a new garment's colour is itself skin-like (catalog hex; 54/237 colourways),
so an old beige garment can never pass for skin under a new beige one. On the owner's photos the model's output now covers 13-31% of the image (was
everything below the collar): legs under a new top, shoes, floor and the wall beside the person stay sharp. Per-pixel
blending was tried and mixed old and new garments (dark pants over dark jeans barely differ); a solid per-row region
can't leave holes in the garment. Not fixable in the model, handled in the UI: no size (the "Your size" panel under the photos shows
UNIQLO's photo for colour, the size and the fit card); blurry hands get redrawn and bags/straps removed, and dark pants
over dark jeans barely show (photo tips). A blur detector (Laplacian variance) couldn't tell a motion-blurred selfie
(472) from a sharp photo (530), so there is none.
**Generated (openai, paid)**: four views from /api/photoreal (below), size comparison shots, settings, 3 looks per visitor.

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
side, face }, reference?, lookToken?, compare? }` -> `{ image, view, lookToken?, compare?, remaining }` or `{ error,
detail?, retryable, remaining? }`.
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
  `remaining` = looks left.
- Size comparison: `view: "front"` + `lookToken` + `reference` + `compare: { slot, size, ease?, length?, delta?: {
  chestCm?, lengthCm?, hipsCm?, inseamCm? } }` (delta = garment cm of `size` minus the size shot, |d| ≤ 40). `items`
  stay exactly as shot (the token is checked against them); the server swaps in `compare` for that one slot
  (`comparedItems`). Costs no look; at most 2 per token (`MAX_COMPARES`, a free failure doesn't count), each
  size once (409 after); 400 if the size equals the one shot or the slot isn't worn. Echoes `compare: { slot, size }`.
  Images: [finished front shot] first (the photo to edit), then front, side, face, products; the prompt says
  "Edit Image 1 ... change only the top: size M instead of S ... measures 6 cm more around the chest, 3 cm longer".
- 400 bad input (message is shopper-facing); 429 limits (the "already developing on your
  network" one is `retryable` with `Retry-After`); 503 not configured / paused. The OpenAI call gets what is left of a
  112 s budget (vercel.json maxDuration 120); the product-photo fetch times out at 4 s.
- OpenAI images.edit, multipart `image[]` in this order: front photo, side photo, face profile, [front shot],
  [top product photo], [bottoms product photo]; the prompt names them "Image 1..n" (high input fidelity favours the
  first, so the front photo leads). input_fidelity high, 1024x1536, JPEG. Prompt (api/_lib/photorealPrompt.ts): the
  front shot is an EDIT of the shopper's front photo (FRONT_EDIT: same face, hair, glasses, skin, build and stance;
  replace every garment, the shoes and the background), the other angles take the face from the finished front shot
  and the profile; every view gets KEEP_IDENTITY (a real person, not a model: exact features, skin texture and
  blemishes, hair not restyled, no beautifying) and the body numbers (never slimmer/taller/younger); each garment
  exactly as its product photo with size and fit on this body; plain white sneakers; per-view direction; setting; no
  logos or text. Never call the person a "model" or the shot a "product page": it pulls the face toward a generic one.

**ChatGPT plugin: /api/mcp** (api/mcp.ts, api/_lib/mcp/; plan and rules: docs/chatgpt-plugin.md)
MCP over Streamable HTTP, stateless (a server per request, `enableJsonResponse`, no sessions); POST JSON-RPC; GET from a
browser = a JSON description (tools, catalogItems, widgetBytes, tryOn on/off); GET with `Accept: text/event-stream` and
DELETE = 405; CORS `*`; 600 req/min per IP (ChatGPT calls from OpenAI's IPs). vercel.json: maxDuration 60, includeFiles
catalog.json + widget.html (read from disk). Connect: ChatGPT developer mode > new connector > https://<host>/api/mcp, no
auth (previews sit behind Vercel Authentication, so use production or a bypass).
- `recommend_size` { product (ID, link or catalog name), color?, units? imperial|metric, height (in or cm), weight (lb
  or kg), chest?, waist?, hips?, inseam?, fit? close|regular|relaxed, size? (one they're considering), ownGarment?
  { chestFlat, length, hipsFlat, inseam } } -> text for the model (advice, fit card lines, buy link) + structuredContent
  `{ kind: "size", product: ProductCard, size, sizeLabel, pick, text, summary, compare, borderline, card, estimated,
  units, buyUrl, tryOn: { available, message? } }`. Same code as the website (parity test over every catalog item).
  Names: an exact catalog name wins; else a unique close match; else "Which one: ..." with IDs.
- `find_clothes` { query?, kind? tee|sweater|pants|top|bottom, color?, maxPrice?, limit? (1-12, default 8) } ->
  `{ kind: "catalog", items: [ProductCard + colors[]] }`.
- `try_on` { photo: { download_url, file_id?, ... } (`openai/fileParams`), top?: { product, color? }, bottom?: {...} } ->
  `{ kind: "tryon", status: ok|partial|limit|unavailable|photo|busy|error, message, items, remaining, resetsAt }`, the
  image in `_meta["fitroom/photo"]` (data URI). Top first, then bottoms on that result (FASHN tryon-v1.6, balanced,
  jpeg, conservative moderation, garment-only goods_* shot fetched by the server, else the catalogue photo); a failed
  second pass keeps the first (partial, counted). Budget 48 s. Photo links: https only, no IP literals or internal
  names, each redirect checked, <= 10 MB, JPEG/PNG/WebP sniffed. Quota: per hashed `openai/subject` (then
  `openai/session`, then IP), per calendar month (UTC); taken before the run, given back when nothing was made; the
  daily cap is for everyone; a store error fails closed. Messages never mention paying (plugin rules: no upsells).
- ProductCard `{ id, name, price, salePrice, slot, shape, fit, color: { code, name, hex }, image, url (colour link,
  AFFILIATE_URL_TEMPLATE applied), sizes }`.
- Widget `ui://fitroom/fitting-room-v1.html`, `text/html;profile=mcp-app` (MCP Apps), tools point at it with
  `_meta.ui.resourceUri` and `openai/outputTemplate`; CSP resourceDomains image.uniqlo.com + Google Fonts, no
  connectDomains, no `ui.domain`. Talks MCP Apps postMessage (ui/initialize, tool-input/result, size-changed, open-link,
  message, tools/call), falls back to `window.openai` (toolOutput, toolResponseMetadata, openExternal,
  sendFollowUpMessage, callTool, uploadFile for the in-card "Try it on with your photo" in ChatGPT). Renders with
  textContent only. Change the widget's behaviour incompatibly = bump the URI (hosts cache it).

**Share link / saved outfits** (web/src/outfit/): `/?top=<ID>.<colour code>[.<size>]&bottom=...&scene=studio|city|night`,
e.g. `?top=E453754-000.67.S&bottom=E475598-000.09`; the size only when hand-picked (the recipient gets their own). Never
photos or measurements. On load (after the catalog) items outside catalog.json are fetched via /api/product, unknown
colours fall back to the item's first, unknown sizes are dropped, and the params are stripped from the URL. Saved
outfits: localStorage `fitroom.saved.v1`, newest first, max 20, `{ id, name, outfit, scene, savedAt }`. Share uses the
native share sheet on touch devices, else the clipboard.

**Size recommendation** (api/_lib/fit/sizing.ts, re-exported at web/src/fit/sizing.ts): the chart size is the smallest size whose body ranges cover the user's. Tops go by
chest, plus waist only when the user typed one (an ANSUR estimate, SD 4.4 cm, must not push a size up); bottoms go
by waist (estimated if blank), plus hips only when typed. If no size covers the body, the largest is shown as "Runs
small for you" and rendered tight. Ease of the chosen size: more than 4 cm over its body range = close; otherwise
garment circumference - body (tops chest: <8 close, <16 regular, <25 relaxed, else oversized; bottoms hips: <6, <14,
<24); without garment numbers, steps from the recommended size. Length: tops vs 0.39 x height (±5 cm), pants vs
inseam - 4 cm (≤ -10 cropped, ≤ -4 ankle, ≤ +5 full, else long). Both go into the prompt.
The pick (`pickSize`) moves the chart size by the shopper's preference: Regular = the chart size (default, so the
documented sizes hold); Relaxed = size up until the garment reads relaxed (≤ 2 sizes; +1 without garment numbers);
Close = one size down only if the body is ≤ 2 cm over that size's range and its garment chest still clears the body.
A reference garment (top chest / pants hips laid flat, ×2 = circumference; optional length / inseam) beats the
preference: the size whose garment chest (+0.5 × length diff) or hips (+0.3 × inseam diff) is closest. Never applied
when no size covers the body. Comparison size (`sizePair`): a hand-picked size vs the pick; the pick vs the chart size
when they differ, else the next size up (or down at the top). Profile keys (localStorage `fitroom.profile.v1`):
fitTop, fitBottom, refTopChestFlatCm, refTopLengthCm, refBottomHipsFlatCm, refBottomInseamCm.
Honesty rules (Phase 2, 2026-11-10): (1) Borderline: when the deciding measurement (tops chest, pants waist) is an
estimate and the pick changes within +-1 SD of it (3.2 / 4.4 cm, the ANSUR residuals), the advice says "Between S and M:
your chest is estimated. Likely an S; measure your chest to be sure" (more than three sizes: "Anywhere from 28" waist to
32" waist"), compares with the other likely size, and links to the field (`borderline` on SizeAdvice; 78% of tops and
84% of pants for height + weight only). Never for typed measurements or a measured garment. (2) Stretch: a garment
smaller than a body inside the size's own range is "stretches 2 cm / snug by design", "N cm tight" only when the body is
over the range. (3) A measured garment more than 10 cm beyond every size of the item is ignored for the pick (measured
all the way round instead of flat), and the Fit section says so for > 50 cm of room. (4) Range hints round inward so
every value they offer is accepted. (5) Colourways sharing a name show UNIQLO's code: "Blue (67)".

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
| Shots "look nothing like me" (generic, younger, smoother face) | the front photo was sent at 1024 px (face ~60 px wide), no frontal close-up, and the prompt composed a new "clothing model" shot instead of editing the photo | front shot edits the front photo (FRONT_EDIT), front sent at 1536 px, KEEP_IDENTITY in every view, landscape-photo warning; verify on the live URL with a well-lit upright front photo |
| Generated shots still didn't look like the shopper after the likeness fixes | a general image model redraws the whole person | free try-on engine: repaint only the clothes in their own photo (Photo engines) |
| "Space metadata could not be loaded" from @gradio/client | `Client.connect("owner/name")` asks huggingface.co first (rate limits, blocked hosts) | connect by the Space URL (tryon/space.ts SPACE_URL) |
| Node scripts can't reach the Space or Hugging Face from a cloud session | Node's fetch ignores HTTPS_PROXY | `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node ...`; Playwright: `proxy: { server: HTTPS_PROXY, bypass: 'localhost' }` |
| Try-on copied the product photo's undershirt / tuck / jacket | the catalogue photo is worn by a model with styling | garment-only goods_* shot when it exists (tryon/garment.ts) |
| Try-on photo cropped (feet cut off) | frames were fixed at 2:3, results are the shopper's 9:16 | finished frames take the photo's own shape (.frame-done) |
| UNIQLO API: HTTP/2 INTERNAL_ERROR / timeouts from a cloud session | UNIQLO blocks those IPs (it answers Vercel and home connections) | run `npm run catalog` locally |
| Every deploy uploads 57 MB of unused 3D assets | web/public is copied into dist | .vercelignore excludes web/public/{hdri,models,garments} |
| /api/mcp FUNCTION_INVOCATION_FAILED, ERR_REQUIRE_ESM for web/src/... | Vercel compiles api/ as CommonJS, web/ as ESM (web/package.json "type": "module") | code a function needs lives in api/_lib (web imports it via @api); never import web/src from api/ |
| Try-on photo missing from the widget in ChatGPT | ChatGPT's MCP Apps bridge can drop `_meta` from ui/notifications/tool-result (forum reports, 2026) | widget falls back to window.openai.toolResponseMetadata |
| Widget test page: SyntaxError "Invalid or unexpected token" | the widget's `</script>` ends the host page's inline script | escape `<` as \u003c when embedding HTML in a script |

## Commands
    cd web && npm run dev          # frontend + /api (vite serves api/*.ts; reads OPENAI_API_KEY from ../.env.local)
    cd web && npm test && npm run typecheck && npm run build
    npm test && npm run typecheck  # api/ + scripts/ tests and types (root); api/mcp.test.ts = the plugin over MCP
    curl -s https://<host>/api/mcp # plugin self-description (tools, catalog size, widget bytes, try-on on/off)
    vercel dev                     # Vercel's own dev server (needs .env.local loaded, see Pitfalls)
    vercel --prod                  # deploy from the REPO ROOT, never from web/
    vercel logs <deployment-url>   # function errors
    npm run catalog                # rebuild web/public/catalog.json from UNIQLO (~20 s; --dry-run, --per-shape N)
    npm run icons                  # re-render the home-screen icons from web/public/favicon.svg (needs Playwright)
    cd web && npm run dev          # then /eval.html: try-on eval (dev only) on your photos, scored by src/eval/metrics.ts

Quality: docs/quality-audit.md (2026-11-10) has the test results, open findings by priority and the phased plan with
measurable gates; web/src/fit/sizing.population.test.ts holds the sizing invariants over 3,400 body x item cases.
Distribution: docs/chatgpt-plugin.md (2026-11-11) covers FitRoom as a ChatGPT plugin: the rules (no selling credits or
upsells inside ChatGPT), ChatGPT's own Try On, and a phased plan that leads with size and fit; the endpoint itself is
/api/mcp (Contracts, "ChatGPT plugin"), built 2026-11-11 and not yet tried inside ChatGPT.

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
