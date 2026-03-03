import type {
  GreenEvent,
  LieType,
  PenaltyEvent,
  Round,
  SGCategory,
  SGCategoryTotals,
  ShotEvent,
  StrokeEvent,
} from "./types";

type CurvePoint = { distance: number; expected: number };
type SGBaseline = {
  version: string;
  lies: {
    fairway: CurvePoint[];
    rough: CurvePoint[];
    sand: CurvePoint[];
    green: CurvePoint[];
  };
};

type BaselineLie = keyof SGBaseline["lies"];

const SG_CATEGORY_KEYS: SGCategory[] = [
  "off_tee",
  "approach",
  "short_game",
  "putting",
  "penalty",
];

let baselineCache: SGBaseline | null = null;

export function emptySGTotals(): SGCategoryTotals {
  return {
    off_tee: 0,
    approach: 0,
    short_game: 0,
    putting: 0,
    penalty: 0,
  };
}

export async function loadSGBaseline(): Promise<SGBaseline> {
  if (baselineCache) {
    return baselineCache;
  }
  const response = await fetch("/sg_expected.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load SG baseline.");
  }
  const parsed = (await response.json()) as SGBaseline;
  baselineCache = parsed;
  return parsed;
}

function toBaselineLie(lie: LieType | "tee"): BaselineLie {
  if (lie === "green") return "green";
  if (lie === "sand") return "sand";
  if (lie === "rough") return "rough";
  return "fairway";
}

export function expectedStrokes(
  baseline: SGBaseline,
  lie: LieType | "tee",
  distance: number
): number {
  const curve = baseline.lies[toBaselineLie(lie)];
  if (curve.length === 0) {
    return 0;
  }

  const d = Math.max(0, distance);
  if (d <= curve[0].distance) {
    return curve[0].expected;
  }
  const last = curve[curve.length - 1];
  if (d >= last.distance) {
    return last.expected;
  }

  for (let i = 0; i < curve.length - 1; i += 1) {
    const a = curve[i];
    const b = curve[i + 1];
    if (d >= a.distance && d <= b.distance) {
      const t = (d - a.distance) / (b.distance - a.distance);
      return a.expected + (b.expected - a.expected) * t;
    }
  }
  return last.expected;
}

function distanceForLie(lie: LieType | "tee", yards: number): number {
  if (lie === "green") {
    return yards * 3;
  }
  return yards;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function shotCategory(shotIndexOnHole: number, shot: ShotEvent): SGCategory {
  if (shotIndexOnHole === 0) return "off_tee";
  if ((shot.start_distance_yds ?? 0) <= 50) return "short_game";
  return "approach";
}

function shotSG(baseline: SGBaseline, shot: ShotEvent): number | null {
  if (
    shot.start_distance_yds === undefined ||
    shot.end_distance_yds === undefined ||
    !shot.start_lie ||
    !shot.end_lie
  ) {
    return null;
  }

  const eStart = expectedStrokes(
    baseline,
    shot.start_lie,
    distanceForLie(shot.start_lie, shot.start_distance_yds)
  );
  const eEnd = expectedStrokes(
    baseline,
    shot.end_lie,
    distanceForLie(shot.end_lie, shot.end_distance_yds)
  );
  return round2(eStart - eEnd - 1);
}

function puttingSG(baseline: SGBaseline, event: GreenEvent): number {
  const eStart = expectedStrokes(baseline, "green", event.first_putt_ft);
  return round2(eStart - event.putts);
}

function penaltySG(): number {
  return -1;
}

export function recalculateRoundSG(round: Round, baseline: SGBaseline): Round {
  const sgByCategory = emptySGTotals();
  const shotCountsByHole: Record<number, number> = {};

  const events: StrokeEvent[] = round.events.map((event) => {
    if (event.type === "shot") {
      const holeShotIndex = shotCountsByHole[event.hole] ?? 0;
      shotCountsByHole[event.hole] = holeShotIndex + 1;
      const sgCategory = shotCategory(holeShotIndex, event);
      const sg = shotSG(baseline, event);
      const finalized = {
        ...event,
        sg_category: sgCategory,
        sg: sg ?? 0,
      };
      sgByCategory[sgCategory] += finalized.sg;
      return finalized;
    }
    if (event.type === "green") {
      const sgCategory: SGCategory = "putting";
      const sg = puttingSG(baseline, event);
      const finalized = {
        ...event,
        sg_category: sgCategory,
        sg,
      };
      sgByCategory[sgCategory] += finalized.sg;
      return finalized;
    }

    const sgCategory: SGCategory = "penalty";
    const sg = penaltySG();
    const penaltyEvent: PenaltyEvent = {
      ...event,
      sg_category: sgCategory,
      sg,
    };
    sgByCategory[sgCategory] += penaltyEvent.sg ?? 0;
    return penaltyEvent;
  });

  for (const key of SG_CATEGORY_KEYS) {
    sgByCategory[key] = round2(sgByCategory[key]);
  }
  const sgTotal = round2(SG_CATEGORY_KEYS.reduce((sum, key) => sum + sgByCategory[key], 0));

  return {
    ...round,
    events,
    sg_total: sgTotal,
    sg_by_category: sgByCategory,
    sg_baseline_version: baseline.version,
  };
}

export type { SGBaseline };
