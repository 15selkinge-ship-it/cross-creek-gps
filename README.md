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

- Course data loads client-side from `public/course.json`.
- Round data is stored in `localStorage` key `cc_round_v1`.
- Hole screen uses `navigator.geolocation.watchPosition` for live yardage.
