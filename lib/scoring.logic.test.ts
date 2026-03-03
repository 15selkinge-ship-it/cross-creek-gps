import assert from "node:assert/strict";
import test from "node:test";
import { recalculateRoundSG, type SGBaseline } from "./sg.ts";
import type { Round } from "./types.ts";

const baseline: SGBaseline = {
  version: "v1_scratch",
  skill: "scratch",
  lies: {
    fairway: [
      { distance: 0, expected: 0 },
      { distance: 30, expected: 2.35 },
      { distance: 40, expected: 2.55 },
      { distance: 100, expected: 3.2 },
      { distance: 300, expected: 4.95 },
    ],
    rough: [
      { distance: 0, expected: 0 },
      { distance: 30, expected: 2.5 },
      { distance: 100, expected: 3.4 },
      { distance: 300, expected: 5.2 },
    ],
    sand: [
      { distance: 0, expected: 0 },
      { distance: 30, expected: 3.05 },
      { distance: 100, expected: 4.0 },
      { distance: 200, expected: 5.2 },
    ],
    green: [
      { distance: 0, expected: 0 },
      { distance: 6, expected: 1.35 },
      { distance: 9, expected: 1.5 },
      { distance: 30, expected: 2.22 },
      { distance: 60, expected: 2.72 },
    ],
  },
};

const parByHole = {
  1: 4,
  2: 4,
  3: 4,
};

function makeRound(events: Round["events"]): Round {
  return {
    id: "sg-sim-1",
    started_at: "2026-03-03T00:00:00.000Z",
    updated_at: "2026-03-03T00:00:00.000Z",
    tee_set_id: "default",
    current_hole: 3,
    events,
  };
}

test("synthetic SG harness: short vs approach categorization, putting equation, and total consistency", () => {
  const round = makeRound([
    {
      id: "h1-s1",
      hole: 1,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:00:01.000Z",
      lat: 40.1,
      lng: -84.9,
      distance_from_prev_yd: 280,
      start_distance_yds: 300,
      end_distance_yds: 20,
      start_lie: "tee",
      end_lie: "fairway",
    },
    {
      id: "h1-s2",
      hole: 1,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:00:02.000Z",
      lat: 40.101,
      lng: -84.901,
      distance_from_prev_yd: 18,
      start_distance_yds: 20,
      end_distance_yds: 0,
      start_lie: "fairway",
      end_lie: "green",
    },
    {
      id: "h1-g1",
      hole: 1,
      type: "green",
      first_putt_paces: 3,
      first_putt_ft: 9,
      putts: 2,
      stroke_value: 2,
      timestamp: "2026-03-03T00:00:03.000Z",
    },
    {
      id: "h2-s1",
      hole: 2,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:01:01.000Z",
      lat: 40.2,
      lng: -84.8,
      distance_from_prev_yd: 260,
      start_distance_yds: 280,
      end_distance_yds: 40,
      start_lie: "tee",
      end_lie: "rough",
    },
    {
      id: "h2-s2",
      hole: 2,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:01:02.000Z",
      lat: 40.201,
      lng: -84.801,
      distance_from_prev_yd: 35,
      start_distance_yds: 40,
      end_distance_yds: 4,
      start_lie: "rough",
      end_lie: "green",
    },
    {
      id: "h2-g1",
      hole: 2,
      type: "green",
      first_putt_paces: 2,
      first_putt_ft: 6,
      putts: 1,
      stroke_value: 1,
      timestamp: "2026-03-03T00:01:03.000Z",
    },
    {
      id: "h3-s1",
      hole: 3,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:02:01.000Z",
      lat: 40.3,
      lng: -84.7,
      distance_from_prev_yd: 255,
      start_distance_yds: 270,
      end_distance_yds: 25,
      start_lie: "tee",
      end_lie: "sand",
    },
    {
      id: "h3-s2",
      hole: 3,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:02:02.000Z",
      lat: 40.301,
      lng: -84.701,
      distance_from_prev_yd: 15,
      start_distance_yds: 25,
      end_distance_yds: 0,
      start_lie: "sand",
      end_lie: "green",
    },
    {
      id: "h3-g1",
      hole: 3,
      type: "green",
      first_putt_paces: 3,
      first_putt_ft: 9,
      putts: 0,
      stroke_value: 0,
      timestamp: "2026-03-03T00:02:03.000Z",
    },
    {
      id: "h3-p1",
      hole: 3,
      type: "penalty",
      stroke_value: 1,
      timestamp: "2026-03-03T00:02:04.000Z",
    },
  ]);

  const recalculated = recalculateRoundSG(round, baseline, parByHole);

  const h1s2 = recalculated.events.find((event) => event.id === "h1-s2");
  const h2s2 = recalculated.events.find((event) => event.id === "h2-s2");
  const h1g1 = recalculated.events.find((event) => event.id === "h1-g1");

  assert.equal(h1s2?.sg_category, "short_game");
  assert.equal(h2s2?.sg_category, "approach");

  assert.equal(h1g1?.type, "green");
  const expectedPutting = Number((1.5 - 2).toFixed(2));
  assert.equal(h1g1.sg, expectedPutting);

  const byCategory = recalculated.sg_by_category ?? {
    off_tee: 0,
    approach: 0,
    short_game: 0,
    putting: 0,
    penalty: 0,
  };
  assert.notEqual(byCategory.short_game, 0);
  assert.notEqual(byCategory.approach, 0);

  const categoriesSum = Object.values(byCategory).reduce((sum, value) => sum + value, 0);
  const shotsSum = recalculated.events.reduce((sum, event) => sum + (event.sg ?? 0), 0);

  assert.equal(Number(categoriesSum.toFixed(2)), Number(shotsSum.toFixed(2)));
  assert.equal(Number((recalculated.sg_total ?? 0).toFixed(2)), Number(shotsSum.toFixed(2)));
});
