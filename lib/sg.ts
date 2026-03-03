import type {
  GreenEvent,
  LieType,
  PenaltyEvent,
  Round,
  SGCategory,
  SGCategoryTotals,
  ShotEvent,
  StartLieType,
  StrokeEvent,
} from "./types";
import { DEFAULT_PAR_BY_HOLE } from "./stats";

type CurvePoint = { distance: number; expected: number };
type SGLieCurves = {
  fairway: CurvePoint[];
  rough: CurvePoint[];
  sand: CurvePoint[];
  green: CurvePoint[];
};

type RawSGBaseline = {
  version: string;
  lies?: SGLieCurves;
  skill_baselines?: Partial<Record<"scratch" | "10hcp" | "20hcp", { lies: SGLieCurves }>>;
};

type SkillLevel = "scratch" | "10hcp" | "20hcp";

type SGBaseline = {
  version: string;
  skill: SkillLevel;
  lies: SGLieCurves;
};

type BaselineLie = keyof SGLieCurves;

type SGShotBreakdown = {
  category: SGCategory;
  startLie: StartLieType | "penalty";
  startDistance: number;
  startUnit: "yd" | "ft";
  endLie: LieType | "holed";
  endDistance: number;
  endUnit: "yd" | "ft";
  eStart: number;
  eEnd: number;
  sg: number;
};

const SG_CATEGORY_KEYS: SGCategory[] = ["off_tee", "approach", "short_game", "putting", "penalty"];
export const SHORT_MAX_YD = 30;
export const ACTIVE_SKILL_BASELINE: SkillLevel = "scratch";

let baselineCache: SGBaseline | null = null;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hasCurves(value: unknown): value is SGLieCurves {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SGLieCurves>;
  return Boolean(candidate.fairway && candidate.rough && candidate.sand && candidate.green);
}

function ensureMonotonic(points: CurvePoint[]): CurvePoint[] {
  if (points.length <= 1) return points;
  const sorted = [...points].sort((a, b) => a.distance - b.distance);
  const cleaned: CurvePoint[] = [];
  let maxExpected = -Infinity;

  for (const point of sorted) {
    if (!Number.isFinite(point.distance) || !Number.isFinite(point.expected)) continue;
    const nextExpected = Math.max(maxExpected, point.expected);
    cleaned.push({ distance: Math.max(0, point.distance), expected: nextExpected });
    maxExpected = nextExpected;
  }

  return cleaned;
}

function normalizeBaseline(raw: RawSGBaseline): SGBaseline {
  const skillBaseline = raw.skill_baselines?.[ACTIVE_SKILL_BASELINE];
  const sourceCurves = hasCurves(skillBaseline?.lies)
    ? skillBaseline.lies
    : hasCurves(raw.lies)
      ? raw.lies
      : null;

  if (!sourceCurves) {
    throw new Error("SG baseline is missing required lie curves.");
  }

  return {
    version: raw.version,
    skill: ACTIVE_SKILL_BASELINE,
    lies: {
      fairway: ensureMonotonic(sourceCurves.fairway),
      rough: ensureMonotonic(sourceCurves.rough),
      sand: ensureMonotonic(sourceCurves.sand),
      green: ensureMonotonic(sourceCurves.green),
    },
  };
}

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
  const parsed = (await response.json()) as RawSGBaseline;
  baselineCache = normalizeBaseline(parsed);
  return baselineCache;
}

function toBaselineLie(lie: LieType | StartLieType): BaselineLie {
  if (lie === "green") return "green";
  if (lie === "sand") return "sand";
  if (lie === "rough") return "rough";
  return "fairway";
}

export function expectedStrokes(baseline: SGBaseline, lie: LieType | StartLieType, distance: number): number {
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

function toExpectedInput(lie: LieType | StartLieType, distanceYards: number): { value: number; unit: "yd" | "ft" } {
  if (lie === "green") {
    return { value: Math.max(0, distanceYards * 3), unit: "ft" };
  }
  return { value: Math.max(0, distanceYards), unit: "yd" };
}

function hasEarlierInPlayTeeShot(roundEvents: StrokeEvent[], event: ShotEvent): boolean {
  for (const current of roundEvents) {
    if (current.id === event.id) break;
    if (current.hole !== event.hole || current.type !== "shot") continue;
    if (current.start_lie === "tee" && current.end_lie !== "penalty") return true;
  }
  return false;
}

export function categorizeShot(
  event: StrokeEvent,
  options: { parByHole: Record<number, number>; roundEvents?: StrokeEvent[]; shortMaxYd?: number }
): SGCategory {
  if (event.type === "green") return "putting";
  if (event.type === "penalty") return "penalty";

  const shortMaxYd = options.shortMaxYd ?? SHORT_MAX_YD;
  const par = options.parByHole[event.hole] ?? DEFAULT_PAR_BY_HOLE[event.hole] ?? 4;

  if (par !== 3 && event.start_lie === "tee") {
    if (!options.roundEvents || !hasEarlierInPlayTeeShot(options.roundEvents, event)) {
      return "off_tee";
    }
  }

  const startDistanceYd = Number.isFinite(event.start_distance_yds) ? event.start_distance_yds : Number.POSITIVE_INFINITY;
  return startDistanceYd <= shortMaxYd ? "short_game" : "approach";
}

function computeShotSG(baseline: SGBaseline, shot: ShotEvent, category: SGCategory): SGShotBreakdown {
  const validStartDistance = Number.isFinite(shot.start_distance_yds) ? shot.start_distance_yds : 0;
  const validEndDistance = Number.isFinite(shot.end_distance_yds) ? shot.end_distance_yds : 0;
  const validStartLie = shot.start_lie ?? "fairway";
  const validEndLie = shot.end_lie ?? "fairway";

  const holedOut = validEndDistance <= 0;
  const endInput = holedOut
    ? { value: 0, unit: validEndLie === "green" ? ("ft" as const) : ("yd" as const) }
    : toExpectedInput(validEndLie, validEndDistance);
  const safeStartInput = toExpectedInput(validStartLie, validStartDistance);

  const eStart = expectedStrokes(baseline, validStartLie, safeStartInput.value);
  const eEnd = holedOut ? 0 : expectedStrokes(baseline, validEndLie, endInput.value);
  const sg = round2(eStart - 1 - eEnd);

  return {
    category,
    startLie: validStartLie,
    startDistance: round2(safeStartInput.value),
    startUnit: safeStartInput.unit,
    endLie: holedOut ? "holed" : validEndLie,
    endDistance: round2(endInput.value),
    endUnit: endInput.unit,
    eStart: round2(eStart),
    eEnd: round2(eEnd),
    sg,
  };
}

function computePuttingSG(baseline: SGBaseline, event: GreenEvent): SGShotBreakdown {
  const startFt = Math.max(0, event.first_putt_ft);
  const putts = Math.max(0, event.putts);
  const eStart = expectedStrokes(baseline, "green", startFt);
  const sg = putts === 0 ? 0 : round2(eStart - putts);

  return {
    category: "putting",
    startLie: "green",
    startDistance: round2(startFt),
    startUnit: "ft",
    endLie: "holed",
    endDistance: 0,
    endUnit: "ft",
    eStart: round2(eStart),
    eEnd: 0,
    sg,
  };
}

function computePenaltySG(): SGShotBreakdown {
  return {
    category: "penalty",
    startLie: "penalty",
    startDistance: 0,
    startUnit: "yd",
    endLie: "penalty",
    endDistance: 0,
    endUnit: "yd",
    eStart: 0,
    eEnd: 0,
    sg: -1,
  };
}

function sumCategoryTotals(events: StrokeEvent[]): SGCategoryTotals {
  const totals = emptySGTotals();
  for (const event of events) {
    if (!event.sg_category) continue;
    totals[event.sg_category] += event.sg ?? 0;
  }
  for (const key of SG_CATEGORY_KEYS) {
    totals[key] = round2(totals[key]);
  }
  return totals;
}

export function recalculateRoundSG(
  round: Round,
  baseline: SGBaseline,
  parByHole: Record<number, number> = DEFAULT_PAR_BY_HOLE
): Round {
  const events: StrokeEvent[] = round.events.map((event) => {
    if (event.type === "shot") {
      const sgCategory = categorizeShot(event, { parByHole, roundEvents: round.events, shortMaxYd: SHORT_MAX_YD });
      const breakdown = computeShotSG(baseline, event, sgCategory);
      return {
        ...event,
        sg_category: sgCategory,
        sg: breakdown.sg,
        sg_debug: {
          category: breakdown.category,
          start_lie: breakdown.startLie,
          start_distance: breakdown.startDistance,
          start_unit: breakdown.startUnit,
          end_lie: breakdown.endLie,
          end_distance: breakdown.endDistance,
          end_unit: breakdown.endUnit,
          e_start: breakdown.eStart,
          e_end: breakdown.eEnd,
          sg_shot: breakdown.sg,
        },
      };
    }

    if (event.type === "green") {
      const breakdown = computePuttingSG(baseline, event);
      return {
        ...event,
        sg_category: "putting" as const,
        sg: breakdown.sg,
        sg_debug: {
          category: breakdown.category,
          start_lie: breakdown.startLie,
          start_distance: breakdown.startDistance,
          start_unit: breakdown.startUnit,
          end_lie: breakdown.endLie,
          end_distance: breakdown.endDistance,
          end_unit: breakdown.endUnit,
          e_start: breakdown.eStart,
          e_end: breakdown.eEnd,
          sg_shot: breakdown.sg,
        },
      };
    }

    const breakdown = computePenaltySG();
    const penaltyEvent: PenaltyEvent = {
      ...event,
      sg_category: "penalty",
      sg: breakdown.sg,
      sg_debug: {
        category: breakdown.category,
        start_lie: breakdown.startLie,
        start_distance: breakdown.startDistance,
        start_unit: breakdown.startUnit,
        end_lie: breakdown.endLie,
        end_distance: breakdown.endDistance,
        end_unit: breakdown.endUnit,
        e_start: breakdown.eStart,
        e_end: breakdown.eEnd,
        sg_shot: breakdown.sg,
      },
    };
    return penaltyEvent;
  });

  const sgByCategory = sumCategoryTotals(events);
  const sgTotal = round2(events.reduce((sum, event) => sum + (event.sg ?? 0), 0));

  return {
    ...round,
    events,
    sg_total: sgTotal,
    sg_by_category: sgByCategory,
    sg_baseline_version: baseline.version,
  };
}

export type { SGBaseline };
