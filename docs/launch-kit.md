# FitRoom in ChatGPT: launch kit

How FitRoom gets in front of a lot of people, and drafts to start with. Prepared 2026-11-11. Posting is done by the
owner; nothing here is posted automatically.

## How distribution works in ChatGPT (2026)
- **The Plugin Directory**: people who search for it find it.
- **The model's choice**: for people who connected FitRoom, ChatGPT calls a tool when the question matches the tool's
  name and description. Ours are written around "what size should I get" questions.
- **"Enhanced distribution"**: in-conversation suggestions with an Install button, plus placement on the directory's
  main pages. This is where hundreds of thousands of people come from. Reported (secondary sources): OpenAI picks
  plugins for it by usage and user satisfaction, nobody can apply, and new plugins rarely get it at launch.

So the job is: get listed, bring real users in from outside, keep them happy, and let the numbers earn the
suggestions. ChatGPT has its own free Try On button, so FitRoom leads with **size**, the question OpenAI's feature
doesn't answer.

## What to watch
`curl "https://fitroom-woad.vercel.app/api/mcp?stats=<MCP_STATS_TOKEN>"` (needs Upstash for real numbers):
- **Weekly users** (`week.users`), and **active days per user** (`week.activeDaysPerUser`). Above 1 means people come
  back.
- **Outcomes per tool**: `recommend_size:ok` vs `:error` (errors mean wrong product names or bad input, so read the
  `[mcp-event]` lines in Vercel logs), `:borderline` (people who'd get a better answer by measuring), `find_clothes:empty`.
- **Products**: what people ask about, which decides which categories to add next.
- **Fit reports**: the loop that improves answers. Ask for them in posts ("tell ChatGPT how it fit").

Weekly targets for the first month: week 1, 50 users with error rate under 10%; week 2, 200; week 4, 1,000 and 1.3+
active days per user. Below that, fix answers before pushing reach.

## Channels, in order
1. **The website.** Once listed, set `VITE_CHATGPT_PLUGIN_URL` so the About section links to the listing. Allowed:
   the plugin rules restrict what happens inside ChatGPT, not on your own site.
2. **Short videos (TikTok, Reels, Shorts).** Screen recordings of real ChatGPT conversations. The hook is the question
   everyone has.
3. **Communities.** Answer real "what size" questions, as the builder, disclosed, within each community's rules.
4. **Fit and menswear creators.** They answer sizing questions all day.
5. **Launch posts.** Show HN, Product Hunt, X / Threads / LinkedIn.

Never: fake reviews or testimonials, bought installs, screenshots of results that didn't happen, promises that a size
will fit, or upsells inside ChatGPT.

## Drafts

### Video 1: "Stop guessing your UNIQLO size" (20 s)
- 0-2 s, text on screen: "I asked ChatGPT what size UNIQLO sweater to buy"
- 2-12 s: screen recording. Type "I'm 5'10", 143 lb, 36 in chest. What size Washable Milano Ribbed Sweater?" and the
  FitRoom card appears: S, "M if you want it roomier", chest room 4 in vs 6.5 in.
- 12-17 s: zoom on the fit card. Voice: "It reads UNIQLO's own size chart and tells you where the hem lands."
- 17-20 s: "FitRoom in ChatGPT. Search 'FitRoom' in plugins."

### Video 2: "Between two sizes?" (15 s)
- Ask about Ultra Stretch Pants with only height and weight. The card says "Between S and M: your waist is
  estimated." Measure the waist on camera, ask again: "S".
- Text: "It tells you when it's guessing. Then measure once."

### Video 3: "Does it run small?" (15 s, once reports exist)
- Ask about a size with five or more fit reports: "Shoppers who bought the S: ..."
- Text: "Real buyers, not the model's photo."

### r/uniqlo post (check the subreddit's rules on self-promotion first; post as the builder)
> **I built a free sizing helper for UNIQLO inside ChatGPT, and I'd like feedback**
>
> I kept returning UNIQLO knits because the size on the model didn't match me. So I made FitRoom: give ChatGPT your
> height and weight (plus chest/waist if you know them) and it reads UNIQLO's own size chart, tells you the size, and
> shows the fit in numbers next to the next size (chest room, where the hem lands, sleeve). It says so when it's
> guessing from an estimate. Men's tees, sweaters and pants for now. No account, and it doesn't keep measurements.
>
> If you try it, I'd love to know where it's wrong: "it said S, the M fit better" is exactly what I need. You can also
> tell ChatGPT how something you bought fits, and it passes that on anonymously to the next person.

For bigger fashion subreddits, self-promotion is usually only allowed in designated threads. Use those, or answer
individual sizing questions only when FitRoom actually answers them, and say that you built it.

### Show HN
> **Show HN: FitRoom – what size to buy at UNIQLO, answered from the size chart (ChatGPT plugin)**
>
> FitRoom is an MCP server that ChatGPT calls when you ask what size to get at UNIQLO. It runs the same sizing code as
> the website: UNIQLO's body-measurement ranges against your measurements (ANSUR II regressions fill in what you don't
> know, and it flags when that estimate decides the size), plus a fit card from the garment measurements. Buyers can
> report how a size fit; once a size has five reports, the advice shows them. Stateless on Vercel, with a widget in the
> MCP Apps format. The site has a free photo try-on too.

### X / Threads / LinkedIn
> UNIQLO sizing, answered properly: ask ChatGPT "what size should I get?" and FitRoom reads UNIQLO's size chart against
> your height and weight, then shows the fit in numbers. It says when it's a close call. Free, no account. [listing link]

### Creator DM
> Hi [name], I make FitRoom, a free ChatGPT plugin that answers "what size UNIQLO should I get" from the size chart and
> your measurements, with the fit in numbers (chest room, hem, sleeve). Your followers ask you this a lot, so I thought
> it might be useful. Happy to walk you through it, no strings attached. If you find a size it gets wrong, I want to
> know.

## Four-week plan
| Week | Do | Gate before moving on |
|---|---|---|
| 0 | Upstash + stats token; test in developer mode (docs/plugin-kit section 3); submit | 9/10 routing probes; no failed cases |
| 1 (after approval) | Website link; r/uniqlo post; video 1 | Error rate < 10%; read every error |
| 2 | Videos 2-3; answer sizing threads; three creator DMs | 200 weekly users |
| 3 | Show HN / Product Hunt; add the most-asked missing products | Fit reports coming in |
| 4 | Review stats; tune tool descriptions for the questions that missed | 1,000 weekly users, 1.3+ active days per user |
