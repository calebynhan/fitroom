# FitRoom plugin kit: test, submit, list

Everything needed to put FitRoom in ChatGPT's Plugin Directory. Prepared 2026-11-11. The steps that need the owner's
accounts are marked **(you)**. Rules and background are in docs/chatgpt-plugin.md; the launch plan is in
docs/launch-kit.md.

| File | Use |
|---|---|
| logo-1024.png, logo-512.png | Listing icon (ink square, Cormorant "F", khaki rule) |
| logo-light-512.png | Light variant, if the form asks for one |
| screenshots/1-size.png | Size advice for the default body (Washable Milano Ribbed Sweater, S) |
| screenshots/2-size-estimated-mobile.png | A close call ("Between S and M: your waist is estimated"), phone width |
| screenshots/3-catalog.png | Browsing sweaters |
| screenshots/4-size-dark.png | Dark theme |
| screenshots/5-size-chart.png | The size chart for one item, with a 36 in chest highlighted (size_chart) |

All screenshots are real tool output rendered by the real card. There's no try-on screenshot: it would need a real
FASHN result, so take one once the key is set.

## 1. Before submitting (you)

- [ ] **Merge the branch** with the privacy and terms pages. They must be live: https://fitroom-woad.vercel.app/privacy and /terms.
- [ ] **Upstash Redis** (free tier is enough to start): Vercel > the fitroom project > Storage (Marketplace) > Upstash for
      Redis > connect it to Production. This sets the REST URL and token env vars. Without it, `report_fit` isn't
      offered (a report would vanish when the server instance recycles), the free try-on count is per instance, and
      stats are per instance.
- [ ] **MCP_STATS_TOKEN**: a long random string in Vercel env (Production). Then
      `curl "https://fitroom-woad.vercel.app/api/mcp?stats=<token>"` shows calls, outcomes, daily users and products.
- [ ] **Try-on, optional at launch.** `try_on` is only offered when `FASHN_API_KEY` is set. It costs ~$0.075 per
      garment. `TRYON_DAILY_CAP` (default 100 photos a day) keeps the worst case under ~$15 a day.
- [ ] **UNIQLO.** The site says UNIQLO content is used for a non-commercial demo, and the terms say FitRoom earns
      nothing from purchases. Staying like that is consistent. If you want affiliate income, join UNIQLO's US affiliate
      program first, set `AFFILIATE_URL_TEMPLATE`, and update the "Buying" section of web/public/terms.html in the same
      change.
- [ ] **Verify your OpenAI organization** on platform.openai.com (organization settings > verification). Plugin
      submission requires it.
- [ ] **Test in ChatGPT** (section 3) and fix anything that fails before submitting.

## 2. Listing copy

- **Name:** FitRoom
- **Short description:** Find your UNIQLO size, with the fit in numbers.
- **Description:**
  > Ask what size to get at UNIQLO and FitRoom answers with the size to buy, worked out from UNIQLO's own size chart
  > and your height and weight. It shows how that size fits you in numbers, next to one other size: room at the chest
  > or hips, where the hem lands, shoulders, sleeves and inseam. When a measurement had to be estimated and the size is
  > a close call, it says so. Once buyers have reported back, it also shows how that size fit them. Works for men's
  > T-shirts, sweaters and pants: paste any UNIQLO US link or browse the catalog. No account, and FitRoom keeps no
  > measurements.
  >
  > (Add once FASHN_API_KEY is set:) Attach a full-body photo of yourself to see the clothes on you.
- **Conversation starters:**
  - What size UNIQLO Milano Ribbed Sweater should I get? I'm 5'10" and 143 lb.
  - Will a medium UNIQLO Crew Neck T-Shirt fit me?
  - Show me black UNIQLO T-shirts under $25.
  - Do UNIQLO Slim Chino Pants run small?
- **Category:** Shopping
- **MCP server:** https://fitroom-woad.vercel.app/api/mcp (Streamable HTTP; no authentication while paid try-ons are
  off, OAuth to the shopper's FitRoom account while they are on: see CLAUDE.md, "Accounts in the ChatGPT plugin")
- **Privacy:** https://fitroom-woad.vercel.app/privacy · **Terms:** https://fitroom-woad.vercel.app/terms
- **Support:** https://github.com/calebynhan/fitroom/issues · **Website:** https://fitroom-woad.vercel.app
- **Language:** English (US). Imperial units by default, metric when asked.

The copy follows the plugin guidelines: no prices, trials or upgrade language, and purchases happen on uniqlo.com.

## 3. Test cases (for developer mode and the submission form)

Each expected answer below is what the tool actually returned (2026-11-11, run in-process against the current code).
In ChatGPT the model rephrases, but the size and caveats must match.

| # | Prompt | Expected tool call | Expected answer |
|---|---|---|---|
| 1 | I'm 5'10", 143 lb, 36 in chest. What size UNIQLO Washable Milano Ribbed Sweater? | recommend_size { product: "Washable Milano Ribbed Sweater", height: 70, weight: 143, chest: 36 } | **S**. "You're an S; M if you want it roomier." Regular fit, hip length; chest room 4 in (S) vs 6.5 in (M) |
| 2 | What size Ultra Stretch Pants for 5'10", 143 lb? | recommend_size { product: "Ultra Stretch Pants", height: 70, weight: 143 } | **M**, flagged: "Between S and M: your waist is estimated. Likely an M; measure your waist to be sure." |
| 3 | Same, my waist is 29.5 in | recommend_size { ..., waist: 29.5 } | **S**. "You're an S; M if you want it roomier." |
| 4 | Will a medium UNIQLO Crew Neck T-Shirt fit me? 5'10", 143 lb | recommend_size { product: "Crew Neck T-Shirt", height: 70, weight: 143, size: "M" } | Card headline **S**, then "You asked about M: Relaxed fit, hip length on you"; chest room 5.5 in (S) vs 7.5 in (M), M 1 in below the hip |
| 5 | I'm 178 cm, 65 kg, 75 cm waist. Size in Slim Chino Pants? | recommend_size { units: "metric", height: 178, weight: 65, waist: 75, ... } | **30" waist**. "You're a 30" waist; 31" if you want it roomier." Full length |
| 6 | I like sweaters loose. Milano sweater, 5'10", 143 lb, 36 in chest | recommend_size { ..., fit: "relaxed" } | **M**. "M for the relaxed fit you like; S by UNIQLO's chart." |
| 7 | (pastes uniqlo.com/us/en/products/E453754-000/00?colorDisplayCode=09) I'm 6', 180 lb | recommend_size { product: "<link>", height: 72, weight: 180 } | Black (the link's colour), **M**, flagged "Between M and L: your chest is estimated." |
| 8 | Show me black UNIQLO T-shirts under $25 | find_clothes { kind: "tee", color: "black", maxPrice: 25 } | SUPIMA Cotton T-Shirt, Crew Neck T-Shirt, AIRism Cotton Oversized, DRY Color, AIRism Cotton T-Shirt... |
| 9 | The S Milano sweater I bought is tight in the chest | report_fit { product: "Washable Milano Ribbed Sweater", size: "S", fit: "too_small", where: "chest" } | "Thanks: noted that the Washable Milano Ribbed Sweater in S runs small (chest)." (only offered with Upstash) |
| 10 | What size UNIQLO puffer jacket? | recommend_size or find_clothes { "puffer jacket" } | "FitRoom sizes UNIQLO men's T-shirts, sweaters, sweatshirts and pants (jeans, chinos, trousers). It can't size that item yet, so don't guess a size..." ChatGPT must not name a size |
| 11 | (attaches a full-body photo) Put the black Milano sweater on me | try_on { photo, top: { product, color: "black" } } | With a FASHN key: the photo in the card, "4 free try-on photos left this month". Without one, try_on isn't offered |
| 12 | What's the weather in Tokyo? | none | FitRoom is not called |

Added after the first run (see test-run-2026-11-11.md), for the `size_chart` tool:

| # | Prompt | Expected tool call | Expected answer |
|---|---|---|---|
| 13 | Is the UNIQLO Crew Neck T-Shirt true to size? | size_chart { product: "Crew Neck T-Shirt" } | Chart table (XXS-3XL); "UNIQLO calls it a regular fit; each size measures about 3 in more around the chest than the largest body it's made for, which reads as a regular cut." |
| 14 | What size UNIQLO tee is a 36 in chest? | size_chart { product or none, chest: 36 } | "A 36 in chest is an S by UNIQLO's chart." (row highlighted) |
| 15 | Which UNIQLO pants size for a 32 inch waist? | size_chart { kind: "bottom", waist: 32 } | Two tables: letter sizes ("A 32 in waist is an M") and inch sizes ("a 32"") |

**Routing probes** (FitRoom isn't named; check ChatGPT picks it; the Phase 1 gate is at least 9 of 10). Run each in
a **temporary chat** (or with memory off): ChatGPT's memory carried earlier answers into later probes in the first run.
1. Is the UNIQLO crew neck tee true to size? (size_chart)
2. I'm between S and M in UNIQLO sweaters, which should I get? (size_chart, or ask for height and weight)
3. Do UNIQLO chinos run small? (size_chart)
4. 5'8" 170 lb, what size UNIQLO jeans? (recommend_size)
5. Should I size up in UNIQLO's Milano sweater? (size_chart)
6. What size is a men's medium at UNIQLO in inches? (size_chart, no product)
7. Which UNIQLO pants size for a 32 inch waist? (size_chart, kind bottom)
8. I usually wear a large at Gap, what am I at UNIQLO? (it should ask for height and weight)
9. How will an L SUPIMA tee fit on me? 6'1", 190 lb (recommend_size; headline M, "You asked about L")
10. Help me pick UNIQLO basics for fall (find_clothes)

### How to run them (you)
1. ChatGPT on the web (Nov 2026): there's no Developer mode toggle any more. Go to **Plugins > Add > Add custom MCP
   server**: name FitRoom, server URL https://fitroom-woad.vercel.app/api/mcp, authentication "No authentication",
   tick the custom-server risk box, then "Create as a plugin" and "Connect FitRoom". OpenAI moves these labels.
2. To use it in a chat, pick FitRoom from the + menu or type @FitRoom. The tag applies to that one message only.
3. Run the cases with the tag, each in a fresh chat, and the routing probes without it, in temporary chats. For each,
   note whether FitRoom was called, whether the card rendered, and whether the size matches. Also check the Buy
   button, "Find my size" in the catalog card, dark mode, and the iOS/Android app (not covered by the first run).
4. Send me what failed (screenshots or the transcript) and I'll tune the tool descriptions or fix it.

## 4. Submitting (you)
1. developers.openai.com/plugins > Submit (the Plugin Directory form; "app review" docs list the fields).
2. Fill in section 2's copy, upload logo-512.png and the screenshots, and paste section 3's cases 1-10 as test prompts
   with expected responses. Be exact, since unclear expected responses are the most common reason for resubmission.
3. Reviewer notes to include: no account or sign-in for sizing (with paid try-ons on, try_on asks to link a FitRoom
   account and spends try-ons bought on the website; nothing is sold in ChatGPT); FitRoom stores no measurements or photos (see Privacy);
   try_on is offered only when enabled and never mentions payment; purchases link out to uniqlo.com.
4. After approval: set `VITE_CHATGPT_PLUGIN_URL` to the listing URL in Vercel (Production) and redeploy. The About
   section then shows "Use FitRoom in ChatGPT".

## 5. Claude (optional second channel)
The card speaks MCP Apps, which Claude renders too. To try it: Claude > Settings > Connectors > Add custom connector >
https://fitroom-woad.vercel.app/api/mcp. Listing in Claude's connector directory has its own submission form (see
Claude's MCP Apps docs). The same privacy and terms pages and test cases apply.
