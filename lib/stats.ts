import type { CourseGps, GreenEvent, Round, ShotEvent, StrokeEvent } from "@/lib/types";

export const DEFAULT_PAR_BY_HOLE: Record<number, number> = {
  // TODO: Replace with authoritative per-hole pars if the scorecard changes.
  1: 5,
  2: 3,
  3: 4,
  4: 4,
  5: 3,
  6: 4,
  7: 3,
  8: 5,
  9: 4,
  10: 4,
  11: 3,
  12: 5,
  13: 3,
  14: 4,
  15: 5,
  16: 3,
  17: 4,
  18: 5,
};

export type HoleFlag = boolean | null;

export type HoleStats = {
  hole: number;
  par: number;
  completed: boolean;
  strokes: number;
  putts: number;
  sg: number;
  puttingSg: number;
  toPar: number | null;
  fir: HoleFlag;
  firAttempt: boolean;
  gir: HoleFlag;
  girAttempt: boolean;
  upAndDown: HoleFlag;
  upAndDownAttempt: boolean;
};

export type RatioStats = {
  hits: number;
  attempts: number;
  pct: number | null;
};

export type RoundStats = {
  holes: HoleStats[];
  strokesTotal: number;
  puttsTotal: number;
  puttsAvg: number | null;
  toPar: number;
  fir: RatioStats;
  gir: RatioStats;
  upAndDown: RatioStats;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pct(hits: number, attempts: number): number | null {
  if (attempts <= 0) return null;
  return (hits / attempts) * 100;
}

function getFirstGreenIndex(events: StrokeEvent[]): number {
  return events.findIndex((event) => event.type === "green");
}

function getLastGreenEvent(events: StrokeEvent[]): GreenEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === "green") {
      return events[i] as GreenEvent;
    }
  }
  return null;
}

function getFir(shotEvents: ShotEvent[], par: number): { fir: HoleFlag; attempt: boolean } {
  if (par !== 4 && par !== 5) {
    return { fir: null, attempt: false };
  }

  for (const shot of shotEvents) {
    if (!shot.end_lie) continue;
    if (shot.end_lie === "penalty") continue;
    return { fir: shot.end_lie === "fairway", attempt: true };
  }

  return { fir: null, attempt: false };
}

function getUpAndDown(
  holeEvents: StrokeEvent[],
  firstGreenIndex: number,
  gir: HoleFlag,
  par: number,
  strokes: number
): { value: HoleFlag; attempt: boolean } {
  if (firstGreenIndex < 0 || gir !== false) {
    return { value: null, attempt: false };
  }

  const eventsAfterFirstGreen = holeEvents.slice(firstGreenIndex + 1);
  const hasOnlyPuttingAfterGreen = eventsAfterFirstGreen.every((event) => event.type === "green");
  return {
    value: hasOnlyPuttingAfterGreen && strokes <= par,
    attempt: true,
  };
}

export function resolveParByHole(course: CourseGps | null): Record<number, number> {
  const resolved: Record<number, number> = {};

  for (let hole = 1; hole <= 18; hole += 1) {
    const coursePar = course?.parByHole?.[String(hole)];
    resolved[hole] = isFiniteNumber(coursePar) ? coursePar : DEFAULT_PAR_BY_HOLE[hole];
  }

  return resolved;
}

export function buildRoundStats(round: Round | null, course: CourseGps | null): RoundStats {
  const parByHole = resolveParByHole(course);
  const events = round?.events ?? [];
  const holes: HoleStats[] = [];

  for (let hole = 1; hole <= 18; hole += 1) {
    const par = parByHole[hole];
    const holeEvents = events.filter((event) => event.hole === hole);
    const strokes = holeEvents.reduce((sum, event) => sum + event.stroke_value, 0);
    const sg = holeEvents.reduce((sum, event) => sum + (event.sg ?? 0), 0);
    const puttingSg = holeEvents
      .filter((event) => event.type === "green")
      .reduce((sum, event) => sum + (event.sg ?? 0), 0);

    const firstGreenIndex = getFirstGreenIndex(holeEvents);
    const hasGreenEvent = firstGreenIndex >= 0;
    const completed = hasGreenEvent;
    const lastGreenEvent = getLastGreenEvent(holeEvents);
    const putts = lastGreenEvent?.putts ?? 0;

    const eventsBeforeGreen = hasGreenEvent ? holeEvents.slice(0, firstGreenIndex) : holeEvents;
    const strokesBeforeGreen = eventsBeforeGreen.reduce((sum, event) => sum + event.stroke_value, 0);
    const gir: HoleFlag = hasGreenEvent ? strokesBeforeGreen <= par - 2 : null;
    const girAttempt = hasGreenEvent;

    const shotEvents = holeEvents.filter((event) => event.type === "shot") as ShotEvent[];
    const firResult = getFir(shotEvents, par);
    const fir = firResult.fir;
    const firAttempt = completed && firResult.attempt;

    const upAndDownResult = getUpAndDown(holeEvents, firstGreenIndex, gir, par, strokes);

    holes.push({
      hole,
      par,
      completed,
      strokes,
      putts,
      sg,
      puttingSg,
      toPar: strokes > 0 ? strokes - par : null,
      fir,
      firAttempt,
      gir,
      girAttempt,
      upAndDown: upAndDownResult.value,
      upAndDownAttempt: upAndDownResult.attempt,
    });
  }

  const scoredHoles = holes.filter((hole) => hole.strokes > 0);
  const puttHoles = holes.filter((hole) => hole.completed);
  const firAttempts = holes.filter((hole) => hole.firAttempt);
  const girAttempts = holes.filter((hole) => hole.girAttempt);
  const upAndDownAttempts = holes.filter((hole) => hole.upAndDownAttempt);

  const strokesTotal = holes.reduce((sum, hole) => sum + hole.strokes, 0);
  const puttsTotal = holes.reduce((sum, hole) => sum + hole.putts, 0);
  const firHits = firAttempts.filter((hole) => hole.fir === true).length;
  const girHits = girAttempts.filter((hole) => hole.gir === true).length;
  const upAndDownHits = upAndDownAttempts.filter((hole) => hole.upAndDown === true).length;
  const parForScoredHoles = scoredHoles.reduce((sum, hole) => sum + hole.par, 0);

  return {
    holes,
    strokesTotal,
    puttsTotal,
    puttsAvg: puttHoles.length > 0 ? puttsTotal / puttHoles.length : null,
    toPar: strokesTotal - parForScoredHoles,
    fir: { hits: firHits, attempts: firAttempts.length, pct: pct(firHits, firAttempts.length) },
    gir: { hits: girHits, attempts: girAttempts.length, pct: pct(girHits, girAttempts.length) },
    upAndDown: { hits: upAndDownHits, attempts: upAndDownAttempts.length, pct: pct(upAndDownHits, upAndDownAttempts.length) },
  };
}
