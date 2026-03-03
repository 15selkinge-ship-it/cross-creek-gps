import assert from "node:assert/strict";
import test from "node:test";
import { recalculateRoundSG, type SGBaseline } from "@/lib/sg";
import { buildRoundStats } from "@/lib/stats";
import type { CourseGps, Round } from "@/lib/types";

const baseline: SGBaseline = {
  version: "test-baseline",
  lies: {
    fairway: [
      { distance: 0, expected: 1.0 },
      { distance: 250, expected: 3.0 },
    ],
    rough: [
      { distance: 0, expected: 1.0 },
      { distance: 250, expected: 3.2 },
    ],
    sand: [
      { distance: 0, expected: 1.1 },
      { distance: 250, expected: 3.4 },
    ],
    green: [
      { distance: 0, expected: 1.0 },
      { distance: 60, expected: 2.0 },
    ],
  },
};

function baseRound(events: Round["events"]): Round {
  return {
    id: "r1",
    started_at: "2026-03-03T00:00:00.000Z",
    updated_at: "2026-03-03T00:00:00.000Z",
    tee_set_id: "default",
    current_hole: 1,
    events,
  };
}

test("par 3 first tee shot contributes to approach SG, not off_tee", () => {
  const round = baseRound([
    {
      id: "s1",
      hole: 2,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:00:01.000Z",
      start_lie: "fairway",
      end_lie: "green",
      start_distance_yds: 180,
      end_distance_yds: 0,
    },
  ]);

  const recalculated = recalculateRoundSG(round, baseline);
  const firstShot = recalculated.events[0];

  assert.equal(firstShot.type, "shot");
  assert.equal(firstShot.sg_category, "approach");
  assert.equal(recalculated.sg_by_category?.off_tee ?? 0, 0);
  assert.equal(recalculated.sg_by_category?.approach ?? 0, firstShot.sg ?? 0);
});

test("missed GIR + reaches green + par with one putt is an up-and-down", () => {
  const round = baseRound([
    {
      id: "h3s1",
      hole: 3,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:00:01.000Z",
      start_lie: "fairway",
      end_lie: "rough",
      start_distance_yds: 390,
      end_distance_yds: 200,
    },
    {
      id: "h3s2",
      hole: 3,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:00:02.000Z",
      start_lie: "rough",
      end_lie: "rough",
      start_distance_yds: 200,
      end_distance_yds: 40,
    },
    {
      id: "h3s3",
      hole: 3,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:00:03.000Z",
      start_lie: "rough",
      end_lie: "green",
      start_distance_yds: 40,
      end_distance_yds: 0,
    },
    {
      id: "h3g1",
      hole: 3,
      type: "green",
      first_putt_paces: 2,
      first_putt_ft: 6,
      putts: 1,
      stroke_value: 1,
      timestamp: "2026-03-03T00:00:04.000Z",
    },
  ]);

  const stats = buildRoundStats(round, null);
  const hole = stats.holes[2];

  assert.equal(hole.gir, false);
  assert.equal(hole.upAndDownAttempt, true);
  assert.equal(hole.upAndDown, true);
});

test("GIR holes do not count as up-and-down attempts", () => {
  const course: CourseGps = {
    holes: {},
    parByHole: { "4": 4 },
  };
  const round = baseRound([
    {
      id: "h4s1",
      hole: 4,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:00:01.000Z",
      start_lie: "fairway",
      end_lie: "fairway",
      start_distance_yds: 380,
      end_distance_yds: 140,
    },
    {
      id: "h4s2",
      hole: 4,
      type: "shot",
      stroke_value: 1,
      timestamp: "2026-03-03T00:00:02.000Z",
      start_lie: "fairway",
      end_lie: "green",
      start_distance_yds: 140,
      end_distance_yds: 0,
    },
    {
      id: "h4g1",
      hole: 4,
      type: "green",
      first_putt_paces: 8,
      first_putt_ft: 24,
      putts: 2,
      stroke_value: 2,
      timestamp: "2026-03-03T00:00:03.000Z",
    },
  ]);

  const stats = buildRoundStats(round, course);
  const hole = stats.holes[3];

  assert.equal(hole.gir, true);
  assert.equal(hole.upAndDownAttempt, false);
  assert.equal(hole.upAndDown, null);
});
