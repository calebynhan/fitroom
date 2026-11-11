# FitRoom as a ChatGPT plugin: research and plan, 2026-11-11

Question: can FitRoom become a ChatGPT plugin and use it for distribution, with 5 free generations per person (no
FitRoom account), then charge for more?

## Status (2026-11-11): the endpoint is built

`/api/mcp` (api/mcp.ts, api/_lib/mcp/; contract in CLAUDE.md, "ChatGPT plugin") implements Phases 1 and 2 below in code:
`recommend_size`, `find_clothes`, `try_on` and one widget, in the FitRoom design. Verified:
- Through the MCP protocol with the SDK client (api/mcp.test.ts): tools, widget resource, the documented default-body
  sizes, word-for-word parity with the website's size advice on all 34 catalog items, every catalog name resolving to
  its item, try-on against a fake FASHN API (top then pants, partial photo, 5 free per user, daily cap, private
  photo links refused), errors in shopper words.
- On a Vercel preview: the function loads (catalog and widget bundled), CORS, the self-description at GET /api/mcp.
- In a browser: the widget in a spec-following MCP Apps host page (Playwright, CSP from the declared domains):
  handshake, auto height, Buy link through the host, "Find my size" as a chat message, the photo even when the host
  drops `_meta`, dark theme, a 360 px width, and ChatGPT's plain `window.openai` path. No console errors.

Not yet done, in order:
1. **Phase 0 decisions**: read the live plugin guidelines; UNIQLO affiliate program (set `AFFILIATE_URL_TEMPLATE`).
2. **Try-on on**: a FASHN API key (`FASHN_API_KEY`, ~$0.075 per garment) and Upstash/Vercel KV for shared counters,
   in Vercel (Production). Without the key `try_on` says it isn't switched on and everything else works.
3. **Deploy to production** (previews sit behind Vercel Authentication, which ChatGPT can't pass), then in ChatGPT:
   Settings > Apps & Connectors > developer mode > create a connector for `https://fitroom-woad.vercel.app/api/mcp`,
   no authentication, and run the Phase 1 prompt set. Not tested inside ChatGPT itself yet.
4. Privacy policy and terms pages, then submit to the Plugin Directory (Phase 3).

## Short answer

1. **"ChatGPT plugin" is the right name again.** The 2023 plugins (ai-plugin.json + OpenAPI) were shut down in 2024.
   Apps (Apps SDK, built on MCP) came in October 2025, and on 2026-07-09 OpenAI renamed the App Directory the Plugin
   Directory. A plugin bundles one or more apps (an MCP server plus an optional UI), skills and templates, and one listing
   reaches ChatGPT and Codex.
2. **5 free generations without a FitRoom account: yes.** ChatGPT sends each tool call an anonymised per-user id
   (`_meta["openai/subject"]`), so we can count free uses per person without our own sign-up.
3. **"Then make them pay for more" inside ChatGPT: no, not under the current rules.** The plugin guidelines forbid
   selling digital goods (subscriptions, credits, tokens), including "freemium upsells", showing plans, starting a
   subscription or promoting upgrades. Commerce is allowed for physical goods only, with checkout on our own site. What
   is allowed: someone who already pays us (bought on our website) signs in from the plugin and gets what their plan
   includes.
4. **ChatGPT launched its own try-on on 2026-10-01.** It's free, it's built in, and it's a "Try on" button on
   clothing in ChatGPT shopping results (selfie or full-body photo, Images 2.5, reference photos saved). So "see the
   clothes on me" is already a free OpenAI feature in that same place. OpenAI says theirs does not guarantee fit or size.
   That gap is what FitRoom does.
5. **Recommendation:** build a plugin that leads with **size and fit** (what to buy, how it will sit, in numbers). That
   part is cheap: no GPU and no photos needed. Add try-on photos as a capped free extra. Make money where the rules allow
   it, from **affiliate links to the item in the recommended size**, and keep any paid generations on the website. Treat
   the plugin as a sales channel, not a moat (see "Is it a moat?").

## What a plugin is now (Apps SDK)

| Date | What happened |
|---|---|
| 2023 → 2024 | Original ChatGPT plugins, then deprecated (replaced by GPTs / Actions) |
| 2025-10 | Apps in ChatGPT + Apps SDK (MCP server + UI component) |
| 2025-12 | Third-party submissions open, App Directory |
| 2026-03 | Native Instant Checkout pulled back; checkout moves into merchants' own apps |
| 2026-07-09 | App Directory becomes the Plugin Directory (shared by ChatGPT and Codex); existing apps unaffected |
| 2026-09-29 | Plugin Extensions (sidebar apps, conversation panels), all plans |
| 2026-10-01 | ChatGPT's own virtual Try On + Favorites in shopping |

The parts we would use:
- **MCP server** (Streamable HTTP) exposing tools. The model decides when to call them, based on each tool's
  description.
- **UI component**: our HTML/JS rendered in a sandboxed iframe under the tool result, talking to ChatGPT through
  `window.openai` (tool output, widget state, follow-up messages). Its network access is limited to the domains we
  declare in the widget CSP.
- **Files**: list a tool parameter in `_meta["openai/fileParams"]` and ChatGPT passes a photo the user attached as
  `{ download_url, file_id, mime_type?, file_name? }`; a widget can also call `window.openai.uploadFile(file)` and then
  `getFileDownloadUrl({ fileId })`.
- **Auth**: OAuth 2.1, declared per tool with `securitySchemes`. `[{type:"noauth"},{type:"oauth2"}]` = works signed
  out, does more signed in. ChatGPT starts account linking only when a tool needs it.
- **Identity hint**: `_meta["openai/subject"]` (anonymised user id, documented for rate limiting) and
  `_meta["openai/session"]` (anonymised conversation id). Not authentication.

## The money rules vs. the plan

| Idea | Allowed? |
|---|---|
| 5 free try-on photos per ChatGPT user, no FitRoom account | **Yes** (count per `openai/subject`) |
| After 5: "Buy 20 more for $5" button, Stripe in the widget | **No** (digital goods, freemium upsell, embedded checkout) |
| Showing plans or prices, "Upgrade" prompts, a link to our checkout or upgrade page | **No** |
| Pricing, free trials or discounts in the directory listing | **No** |
| A paying website member signs in (OAuth) and gets their plan's photos in ChatGPT | **Yes** |
| Saying a feature needs a plan, without starting a checkout | **Yes**, carefully worded |
| "Buy the M at UNIQLO" link (physical goods, checkout on the retailer's site) | **Yes** |

So "free in ChatGPT, pay in ChatGPT" is out, and a plugin built to push people to a paywall on our site is the
"indirect upsell" the review rejects. What works:
- **In ChatGPT:** free size advice, free capped photos, and affiliate revenue on the clothes people buy.
- **On the website:** the 5-free-then-pay model (Stripe), as planned. Members can link their account in the plugin.
- OpenAI says it is "exploring additional monetization options over time, including digital goods". Keep entitlements
  on the server (an account has N photos) so a ChatGPT purchase flow can be added later without reworking anything.

## Competing with ChatGPT's own Try On

What's public (launch coverage, 2026-10-01): a Try on button on eligible clothing results in ChatGPT shopping; the
user gives a selfie or full-body photo; made with Images 2.5; reference photos are kept for future try-ons (Settings >
Personalization); one report says Free-plan users have it; merchants are allowlisted. OpenAI's caveat: the images may not
reproduce the product or the person exactly, and they don't guarantee fit or size.

What follows:
- For "show me in this", ChatGPT will usually use its own button. A FitRoom plugin will mostly be called for **"what
  size should I buy / how will it fit"**, so that is the tool to make excellent and to describe well.
- What FitRoom can claim and they don't: the size from the retailer's own chart against your measurements, honest about
  uncertainty ("Between S and M: your chest is estimated. Measure it to be sure"); the fit card in numbers (chest room,
  where the hem lands, sleeve, inseam); a photo that keeps your actual photo and repaints only the clothes (the quality
  audit measured 0.7-3.2/255 change above the garment). Whether Images 2.5 redraws the face is unverified.
- What we can't claim: neither engine shows *size* in the photo (FASHN ignores size; see Photo engines in CLAUDE.md).

## Proposed plugin

**Tools** (all reuse code that exists: `web/src/fit/sizing.ts`, `fit/fitCard.ts`, `body/profile.ts` estimates are
plain TS with no browser dependencies, plus `catalog.json` and `/api/product`):

| Tool | Auth | Input | Output |
|---|---|---|---|
| `recommend_size` | noauth | product link or id; height, weight; optional chest / waist / hips / inseam; Close / Regular / Relaxed; units | `sizeAdvice` + fit card (chosen size vs one other) + "Buy the S at UNIQLO" link. No GPU, no photo |
| `find_clothes` | noauth | slot, shape, colour, price | product cards from the catalog |
| `try_on` | noauth + oauth2 | photo (file param), top id + colour, bottoms id + colour | one front photo with the outfit; 5 free per user, members per plan |

Model-facing descriptions say when to call: "Use when the user asks what size to buy, whether something will fit, or
how a UNIQLO item sits on their body." A `try_on` description says "only photos of the user themselves".

**Widget**: one "fitting room" card in the FitRoom design system: product, recommended size with the borderline note,
fit card, the photo frame with progress, Buy links. Widget CSP: our domain only (product photos through our `/uniqlo/*`
rewrite). A Plugin Extensions side panel that keeps the outfit across turns is worth a look later.

**Free quota**: count per `openai/subject` in a shared store (Upstash Redis / Vercel KV, already on the Production
list). Suggested: 5 outfit photos per person per month (one outfit = top + bottoms = 2 passes), a global daily spend cap,
and the existing `PHOTOREAL_DISABLED` style kill switch. If `openai/subject` is missing (forum reports of `_meta`
dropping out), fall back to `openai/session` + IP, stricter.

**Inference**: the free FASHN Space doesn't work behind a plugin. Called from our server, every user would share *our*
ZeroGPU quota (anonymous 2 GPU-min/day, PRO 40), i.e. a handful of outfits a day for everyone. Options:

| Engine | Cost per outfit (2 images) | Notes |
|---|---|---|
| FASHN API v1.6 | ~$0.15 ($0.075/image on demand; failures free) | 5-8 s per image, commercial use, zero ops. 5 free outfits ≈ $0.75 per user at most |
| fal.ai FASHN v1.6 | ~$0.15 | same model, another vendor |
| FASHN VTON v1.5 self-hosted (Apache-2.0) on a serverless GPU | estimated around a cent or two, unverified | cheapest at volume; cold starts and ops are ours |
| Widget calls the free Space from the user's browser | $0 | prototype only: no SLA, the user's own quota (~2-4 passes a day), photo goes to a third party from inside ChatGPT |

Start on the FASHN API and move to self-hosting when volume justifies it.

**Photos**: the user attaches the photo in ChatGPT (OpenAI holds it under its own terms). Our tool gets a
`download_url`, fetches it, sends it to the try-on API and returns the result to the widget only, inline in `_meta`
(which the model doesn't see), so FitRoom stores and logs nothing. Open: tool-result size limits for an inline image, and
the FASHN API's own retention (must be in our privacy policy). "Their photos are theirs" in CLAUDE.md changes when this
ships (a contract change: edit it in the same commit).

**Hosting**: the same Vercel project, a new `api/mcp.ts` (MCP TypeScript SDK; Vercel has an MCP handler). Two FASHN
API calls fit easily in `maxDuration` 120.

## Before any money changes hands

- **UNIQLO content.** CLAUDE.md says it's used "for a non-commercial demo". Affiliate revenue or paid photos make it
  commercial. Join UNIQLO's US affiliate program (listed on FlexOffers / Rakuten; the commission rate isn't public, one
  site says 6% for an unnamed market) and use product data and images the way its terms allow, or get UNIQLO's
  permission. An affiliate agreement doesn't obviously cover our use of their commerce API.
- **FASHN's free Space** is for the demo; don't build a paid product on it (the model weights are Apache-2.0, so
  self-hosting is fine).
- **Plugin review**: privacy policy, terms, support contact, data deletion; likeness rules (OpenAI's usage policies
  forbid using someone's likeness without consent); a minors policy for photos.

## Rough unit economics (assumptions, not data)

A $40-60 UNIQLO item at ~6% commission = $2.40-3.60 per kept sale (returns claw it back). At $0.15 per outfit
photo (FASHN API), break-even is about 1 kept purchase per 20 outfit photos; self-hosted at ~$0.02, about 1 per 150.
`recommend_size` costs nearly nothing per call, which is another reason to lead with it.

## Is it a moat?

No. A plugin is a channel: anyone can ship one, the model and the directory decide who gets called, and OpenAI already
put its own try-on in this exact spot. Candidates for a real moat:
- **Fit outcome data.** After a purchase, ask "did the S fit?" and use the answers to correct size picks per item.
  Nobody else has that per-item calibration, and OpenAI's try-on makes no fit claims.
- **Retailers as the customer.** Returns cost the retailer. Lower return rates are something a brand pays for (B2B),
  which may be worth more than consumer credits.

## Plan with gates

| Phase | Work | Gate |
|---|---|---|
| 0. Decide (1 day) | Read the live guidelines page (I couldn't open it from this session); apply to the UNIQLO affiliate program; pick the inference vendor | Rules confirmed in writing; affiliate decision |
| 1. Size plugin | `api/mcp.ts` with `recommend_size` + `find_clothes` + the widget; test in ChatGPT developer mode | Called for ≥ 9/10 size questions in a fixed prompt set; same answers as the web app for the same inputs (shared code + tests) |
| 2. Try-on | `try_on` on the FASHN API, quota per subject in Upstash, daily spend cap | p95 < 30 s; quota holds across instances; no photo in logs or storage (audited) |
| 3. Ship | Affiliate links, privacy policy, submit to the Plugin Directory | Approved |
| 4. Paid members | Website freemium (Stripe) + OAuth account linking in the plugin | Only once the website has paying users |

**Phase 4, built 2026-11-11** (off until paid try-ons are configured; CLAUDE.md "Paid try-ons" and "Accounts in the
ChatGPT plugin"): the website gives 5 free try-ons per FitRoom account (Google sign-in), then packs on Stripe; FitRoom is
the plugin's OAuth server (CIMD clients, PKCE, RFC 9207 `iss`), and while paid try-ons are on, `try_on` needs the linked
account and spends its try-ons (the daily cap stays; the monthly allowance per ChatGPT user is off). Nothing is sold in
ChatGPT: an empty account gets the reason and a link to /try-ons.html. The guidelines page was read directly on
2026-11-11 (Commerce section): it allows explaining that a feature needs more credits and linking an informational page.

## Not verified (check before building)

developers.openai.com and techcrunch.com are blocked by this session's network settings, so the rules above come from
search-engine excerpts of OpenAI's pages and from news coverage, not from reading the pages. Still to check: the exact
link rules in the plugin guidelines; whether logged-out ChatGPT users can use plugins; how reliably `openai/subject`
arrives; size limits for inline images in tool results; FASHN API data retention; UNIQLO affiliate terms and rate;
whether ChatGPT's Try On covers UNIQLO.

## Sources

- OpenAI plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines and
  https://developers.openai.com/apps-sdk/app-submission-guidelines
- Apps SDK reference (file params, uploadFile, `_meta`): https://developers.openai.com/apps-sdk/reference ; changelog:
  https://learn.chatgpt.com/apps-sdk/changelog
- Plugins in ChatGPT and Codex (directory migration 2026-07-09): https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex
- Developers can submit apps (2025-12): https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/
- `openai/subject` for rate limiting: https://community.openai.com/t/openai-apps-authentication-flows-using-meta-openai-subject-as-an-identifier/1368010
- Mixed auth per tool: https://docs.skybridge.tech/build/auth ; https://stytch.com/blog/guide-to-authentication-for-the-openai-apps-sdk/
- Monetization threads: https://community.openai.com/t/chatgpt-app-monetization-apps-sdk/1372343 ;
  https://community.openai.com/t/chatgpt-apps-premium-subscriptions/1371574
- Checkout pullback: https://digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/
- Plugin Extensions: https://workos.com/blog/ai-era-app-store-moment-openai-plugins
- ChatGPT Try On: https://techcrunch.com/2026/10/01/chatgpt-can-now-virtually-try-on-clothes-for-you/ ;
  https://retaildive.com/news/virtual-try-on-launch-chatgpt/832244 ;
  https://www.retailgazette.co.uk/blog/2026/10/chatgpt-takes-on-fashions-fitting-rooms-as-openai-makes-major-play-for-shoppers/
- Sign in with ChatGPT (website use is a limited trial): https://developers.openai.com/siwc
- FASHN API pricing: https://help.fashn.ai/plans-and-pricing/api-pricing ; https://docs.fashn.ai/api-reference/tryon-v1-6
- UNIQLO US affiliate listing: https://www.flexoffers.com/affiliate-programs/uniqlo-usa-affiliate-program
- OpenAI usage policies (likeness, biometrics): https://openai.com/policies/usage-policies/
