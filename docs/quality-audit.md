# FitRoom quality audit, 2026-11-10

Status: Phase 0 (measurement) and Phase 1 (robustness and privacy) done; findings 1-5 and 9-12 fixed.

What was tested, what is wrong, and a plan to improve it that can be measured. Covers the free try-on engine (the
default), sizing and the fit card, the catalog and the UI, on branch `claude/focused-turing-yuhkiq` (PR #2).

## How it was tested

| Layer | Method | Scale |
|---|---|---|
| Try-on quality | Real FASHN VTON v1.5 Space runs on the owner's own photos (front, selfie, beach) and the Space's examples, judged by eye and with pixel metrics (`web/src/eval/metrics.ts`) | 10 passes, 6 garments |
| Try-on inputs | Every catalog colourway's catalogue and garment-only photo checked on UNIQLO's CDN; the flat-lay/model detector run on every product, checked against labels by eye | 34 items, 237 colourways, 68 photos |
| Sizing and fit card | The shipped `pickSize` / `sizeAdvice` / `fitCard` over every item x a grid of men's bodies (155-200 cm, BMI 17-35), plus measurement-error sensitivity | 3,400 cases |
| Failure modes | Real browser with faults injected: Space unreachable, Space hanging, product photos missing | 3 scenarios |
| UI | Chromium desktop (1440 px) and phones (iPhone 13, Pixel 7): axe-core scan, keyboard tab order, overflow, tap targets, lightbox, paste-a-link failure | 2 states, 3 devices |
| Code | Independent review of `git diff origin/main...HEAD` (48 files) for correctness bugs | whole branch |

## Scorecard

| Area | Verdict |
|---|---|
| Keeps the shopper's identity | **Strong.** Above the garment, pixels changed by 0.7-3.2 / 255 in every run; the composite then uses the original photo there (full resolution). |
| Garment type and look | **Good.** Correct garment and cut in 8/8 clean runs. |
| Garment colour | **Fair.** Median dE 9.4 (sweater) from the product with garment-only photos (was 16 with the catalogue photo); mostly lightness from the room's light. |
| Shows the right size | **No, by design.** The model ignores size; the fit card carries it. |
| Robustness | **Weak.** A stalled Space locks the app; retry can destroy a partial photo; removed photos can be re-sent. |
| Size recommendation | **Logically sound, overconfident.** Monotonic, ordered, no NaN in 3,400 cases; but with estimated measurements the answer flips for 41-54% of bodies within 1 SD. |
| Accessibility / mobile | **Mostly fine.** No overflow, keyboard reachable; small swatches, two axe issues. |
| Capacity | **Fragile.** Anonymous visitors get ~2 GPU-minutes a day (2-4 passes); one shared queue on a Space we don't control. |

## Findings by priority

P0 = harms users or their privacy now; P1 = wrong results or broken flows in common cases; P2 = polish and edge cases.

### P0
1. **A stalled Space locks the app until reload** (`tryon/space.ts` runSpace, `look/shoot.ts` exclusive). Reproduced: with
   the Space accepting and never answering, the frame read "Sending your photo..." for 150 s+, every button disabled; the
   only way out is a reload, which deletes the shopper's photos. No timeout on the job, the result download or the
   garment fetches; no Cancel. *Fix:* per-pass deadline that extends while the queue position moves (e.g. 90 s without
   progress, 4 min total), `job.cancel()` on timeout, a Cancel button, timeouts on fetches.
2. **Removed photos can still be uploaded** (`tryon/shoot.ts` module-level `inputs`). After the shopper removes a photo,
   Retry on the out-of-date look re-sends it to the public Space, which keeps uploads. *Fix:* drop cached inputs whose
   `photoVersion` is stale; no Retry on out-of-date looks.

### P1
3. **Retry on a partial photo can replace it with an error** (`tryon/shoot.ts` shootView). Common after a quota error.
   *Fix:* keep the previous done state if the retry produces nothing.
4. **A busy Space is reported as a bad photo.** Gradio says "This application is currently busy"; the error mapper
   expects "queue is full". "GPU task aborted" also falls through. *Fix:* match the client's real messages; test them.
5. **Flat pants sent as "model" photos.** Wide Sweatpants, Wide Cargo and Barrel Pants have the waistband where the
   detector looks for a head (3/34 products wrong). *Fix, verified offline 68/68 (was 65/68):* call it a model shot only
   when the top-centre is covered *and* the upper third has skin (> 1%).
6. **The fit card calls stretch tees "tight".** AIRism T-Shirt (and DRY-EX XXL) are cut smaller than the body on
   purpose; the recommended size shows "up to 6 cm tight" in 75/3,400 cases. *Fix:* when the body is inside the size's
   own range, word negative room as a stretch / close fit.
7. **Overconfident sizes from estimates.** A 1-SD measurement error changes the recommended top in 41% and pants in 54%
   of bodies, but the UI says "You're an S" either way. *Fix:* when a size rests on estimates and the body is within
   1 SD of a size boundary, say so ("between S and M: measure your chest") and put that measurement first.
8. **Styling is still copied for 8 products** whose garment-only photo is itself a model shot (Crew Neck T, AIRism
   Cotton T, DRY V-Neck T, Milano Knitted T, Slim Chino, Ankle Pants, DRY-EX Tapered, Linen Relaxed), and for 14/237
   colourways without one. UNIQLO's other angles are model shots too. *Mitigation:* say so in the size panel for these
   items; measure with the eval whether `flat-lay` + a crop of the garment does better.
9. **Two try-on photo tiles in a three-column grid** (CSS order: `.photo-tiles` overrides `.photo-tiles-2`).
10. **A transient network error caches the styled catalogue photo for the session** (`tryon/garment.ts`). *Fix:* fall
    back only on 403/404 or a non-image; throw on network errors and 5xx.

### P2
11. Status text reads "Starting the free GPU..." for the whole pass (gradio reports pending/position 0 while running)
    and "21th in line".
12. WebP data downloaded as `.jpg` when the composite falls back.
13. The "Measure clothes" panel snaps shut when the last field is cleared (`open={hasRef}`).
14. Imperial range text shows maxima that are then rejected (35.5 in = 90.2 cm > 90).
15. The size panel under an out-of-date look describes the current outfit, not the one in the photo.
16. 10/34 items have duplicate colour names (Crew Neck T: Blue x3): ambiguous swatch labels and captions.
17. Colour swatches are 20 x 20 px on phones (WCAG 2.2 target size is 24 px).
18. axe: the scrolling photo pane isn't keyboard-focusable; two landmarks share the name "Your photos".
19. The catalog can't be rebuilt from cloud sessions (UNIQLO blocks those IPs); other women's items may remain until
    `npm run catalog` runs locally with the new `sizeGender` rule.

### Test coverage gaps
`runSpace` (status mapping, error events, cancel), `describeSpaceError` with gradio's real messages, `sharpenResult`
(needs a browser), `loadGarmentPhoto` on real UNIQLO images, try-on retry after quota / after a photo is removed,
`FitSection` reference feedback, UI tests for the size panel and photo tiles.

## Systematic plan

Each phase has a gate that is measured, not judged by eye.

### Phase 0: measure (done in this commit)
- `web/eval.html` + `src/eval/main.ts` (dev only): runs a fixed set of 6 garments (flat and worn photos, light and dark,
  tops and tall pants) on the shopper's photos through the real pipeline and scores each result.
- `src/eval/metrics.ts`: **changed area** (garment applied, scene not redrawn), **above-garment difference** (identity),
  **colour dE and lightness** vs the product's fabric, with plain-language flags. Validated on today's results: it flags
  every problem seen by eye.
- `src/fit/sizing.population.test.ts`: the sizing invariants over 3,400 cases, plus a to-do for finding 6.

Baseline (2026-11-10, owner's photos): changed 1.6-9.5% on clean runs, above-garment 0.7-1.7, colour dE 4.7-9.4 with
garment-only photos; flags on the selfie (38% redrawn) and dark-on-dark pants (0.5% changed).

### Phase 1: robustness and privacy (P0, P1 3-5, 9-10) - done 2026-11-10
Fix findings 1-5, 9, 10, 11, 12 with tests for each (fake runner for timeouts/cancel, real gradio messages, retry and
removed-photo paths). **Gate:** fault-injection script passes: a hanging Space ends in a retryable message within the
deadline and Cancel frees the app; no request carries a removed photo; retry never loses a finished photo.

Result: all fixed, each with tests (web: 82 passing). Gate run in Chromium against a Space that answers config and
uploads but never the job: stalled run ended after 120 s with "taking too long" + Retry and the app free; Cancel freed
it in 3 ms; removing the photo mid-run stopped it in 3 ms with no further uploads and no Retry; photo tiles two per
row. Detector re-checked on all 68 catalog photos: 68/68.

### Phase 2: fit honesty (P1 6-7, P2 14, 16)
Stretch-aware wording; borderline-size confidence ("between S and M, measure X"), ranked by which measurement would
change the answer; colour names with codes. **Gate:** the population test's to-do is on and passing; for estimated
bodies, every answer that flips within 1 SD is labelled borderline (0 silent flips).

### Phase 3: try-on quality (P1 8, eval-driven)
Run the eval set before and after each change; keep a change only if it improves the metrics without new flags.
Candidates, in order of expected value: garment crop + `flat-lay` for worn product photos; `num_timesteps` 30 vs 50;
seed sweeps; sharpening the side photo; a second engine (the eval page makes swapping Spaces a one-line change).
**Gate:** median colour dE <= 8 on the set, 0 "garment barely changed" flags on contrasting outfits, above-garment
<= 3 on every sharp photo.

### Phase 4: capacity and reliability
- Duplicate the FASHN Space to our own Hugging Face account (free: 2 ZeroGPU Spaces): our own queue, no dependency on
  FASHN keeping the demo up; keep FASHN's as fallback.
- Optional "Sign in with Hugging Face" so shoppers use their own free account (5 GPU-min/day vs 2) and queue priority.
- Anonymous counts of try-on outcomes (ok / quota / busy / timeout, no photos) to see real failure rates.
**Gate:** a week of outcome counts with timeouts < 2% and a known quota rate.

### Phase 5: UX and launch
Tap targets, axe issues, panel and range-text fixes (P2 13, 15, 17, 18), then the remaining v1 items in CLAUDE.md
(save/share outfits, OG image, analytics, About). **Gate:** axe clean on both states; every flow checked on the live URL
on desktop and a phone.

## How to rerun

    cd web && npm test                          # includes the population invariants
    cd web && npm run dev                       # then open http://localhost:5173/eval.html, pick photos, Run
