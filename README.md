# Cross Creek Golf Tracker (V1)

Mobile-first GPS golf round tracker built with Next.js App Router, TypeScript, and Tailwind CSS.

## How To Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## How To Use

1. On Home (`/`), tap `Start Round` to begin a new round.
2. Tap `Resume Round` to continue from the saved current hole.
3. On `/hole/[n]`, allow location permissions so live distance to green updates.
4. Tap `Log Shot Here` at the ball location to add a stroke event.
5. Pick the lie in the modal:
   - `Penalty` adds an immediate extra penalty stroke event (+1).
   - `Green` opens a putt-distance prompt in paces, then stores feet (`paces * 3`).
6. Use header navigation for `Prev`, `Next`, and `Home`.
7. On Home, tap `Export JSON` to download `cross-creek-round.json`.
8. Tap `End Round` on a hole at any time to timestamp and lock the round, then view `/round`.
9. Tap `Resume/Edit` from `/round` (or the hole footer) to unlock edits.
10. Tap `Clear Round` to remove the saved round.

## Data Notes

- Course GPS data loads from `data/course-gps.json` via `/api/course-gps`.
- Round data is stored in `localStorage` key `cc_round_v1`.
- Hole screen uses `navigator.geolocation.watchPosition` for live yardage.
- SG baseline loads from `public/sg_expected.json` (version stored on round as `sg_baseline_version`).
- Shot events now store:
  - `start_distance_yds`, `end_distance_yds`
  - `start_lie`, `end_lie`
  - computed `sg` and `sg_category`
  - SG category rule for first shot:
    - Par 4/5: first shot counts as `off_tee`
    - Par 3: first shot counts as `approach`
- Green events store `first_putt_ft = first_putt_paces * 3` and compute putting SG as `E(green, first_putt_ft) - putts`.
- Penalty events apply +1 stroke and SG penalty of `-1.0`.
- Round-level SG aggregates are saved as:
  - `sg_total`
  - `sg_by_category` (`off_tee`, `approach`, `short_game`, `putting`, `penalty`)
- Round summary is available at `/round` (and alias `/round-summary`) with SG + dashboard totals and hole-by-hole rows.

## Round Dashboard Metrics

- Pars come from `data/course-gps.json` `parByHole` (fallback in `lib/stats.ts` is marked TODO).
- `Strokes per hole`: sum of all `stroke_value` events on that hole (`shot` + `green` putts + `penalty`).
- `Putts per hole`: latest `green` event `putts` for that hole (`0` if none).
- `FIR` (par 4/5 only):
  - Uses the first non-penalty tee-shot result (`end_lie`).
  - If first tee shot is penalty, continues until a tee shot in play is found.
  - Round denominator: completed par 4/5 holes with an in-play tee shot recorded.
- `GIR`:
  - Requires a `green` event.
  - True when strokes before first `green` event are `<= par - 2` (putts excluded; penalty events still count as strokes).
  - Round denominator: holes with a `green` event.
- `Up & Down`:
  - Applicable only when `GIR` is false and a `green` event exists.
  - Attempt is any missed-GIR hole that reached green.
  - Success requires both:
    - Hole score `<= par`
    - No non-`green` events after the first `green` event (only putting events from first green to hole-out).
  - Penalties before reaching green are allowed and counted in strokes.
  - Round denominator: up-and-down attempts only.
- `To Par`:
  - Round to-par uses scored holes only (`strokes > 0`), so early-ended rounds are relative to holes played.

## Current Data Limits

- Hole completion is inferred by presence of a `green` event.
- If `end_lie` or `end_distance_yds` is missing for relevant shots, FIR / Up & Down may be unknown.
- If multiple `green` events exist on one hole, GIR uses the first green timestamp and putts use the latest stored green event.
