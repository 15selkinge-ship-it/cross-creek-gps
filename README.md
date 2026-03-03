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
8. Tap `Clear Round` to remove the saved round.

## Data Notes

- Course GPS data loads from `data/course-gps.json` via `/api/course-gps`.
- Round data is stored in `localStorage` key `cc_round_v1`.
- Hole screen uses `navigator.geolocation.watchPosition` for live yardage.
- SG baseline loads from `public/sg_expected.json` (version stored on round as `sg_baseline_version`).
- Shot events now store:
  - `start_distance_yds`, `end_distance_yds`
  - `start_lie`, `end_lie`
  - computed `sg` and `sg_category`
- Green events store `first_putt_ft = first_putt_paces * 3` and compute putting SG as `E(green, first_putt_ft) - putts`.
- Penalty events apply +1 stroke and SG penalty of `-1.0`.
- Round-level SG aggregates are saved as:
  - `sg_total`
  - `sg_by_category` (`off_tee`, `approach`, `short_game`, `putting`, `penalty`)
- Round summary is available at `/round-summary` with hole-by-hole strokes/SG/putting SG and category totals.
