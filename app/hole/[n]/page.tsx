"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AccuracyPill from "@/components/AccuracyPill";
import ScorecardBar from "@/components/ScorecardBar";
import { fetchCourse } from "@/lib/course";
import { isZeroCoordinate, pacesToFeet, safeDistanceYards } from "@/lib/geo";
import { getStoredRound, saveRound } from "@/lib/round-storage";
import { emptySGTotals, loadSGBaseline, recalculateRoundSG, type SGBaseline } from "@/lib/sg";
import { buildRoundStats, resolveParByHole } from "@/lib/stats";
import type { Coordinate, CourseGps, HoleGps, LieType, Round, SGCategory, SGDebugInfo, ShotEvent, StartLieType, StrokeEvent } from "@/lib/types";

type PositionState = { lat: number; lng: number; accuracy: number };
const MAX_GPS_ACCURACY_METERS = 100;
const MAX_REASONABLE_DISTANCE_YARDS = 3000;

const HOLE_HCP = [17, 13, 7, 3, 11, 5, 15, 1, 9, 8, 10, 4, 6, 2, 16, 12, 14, 18];
const CLUBS = ["Driver", "3W", "5W", "4i", "5i", "6i", "7i", "8i", "9i", "PW", "52", "56", "60", "Putter"];
const LIES: Array<{ label: string; value: LieType }> = [
  { label: "Fairway", value: "fairway" },
  { label: "Rough", value: "rough" },
  { label: "Sand", value: "sand" },
  { label: "Green", value: "green" },
  { label: "Penalty", value: "penalty" },
];
const SG_LABELS: Record<SGCategory, string> = {
  off_tee: "Off Tee",
  approach: "Approach",
  short_game: "Short",
  putting: "Putting",
  penalty: "Penalty",
};
type PendingShotDraft = {
  id: string;
  lat: number;
  lng: number;
  distance_from_prev_yd: number;
  start_distance_yds: number;
  end_distance_yds: number;
  start_lie: StartLieType;
};

function nowIso() {
  return new Date().toISOString();
}
function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function formatSG(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
function formatPct(value: number | null) {
  return value === null ? "--" : `${Math.round(value)}%`;
}
function formatFlag(value: boolean | null) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "--";
}
function findHole(course: CourseGps | null, n: number): HoleGps | null {
  if (!course) return null;
  return course.holes[String(n)] ?? null;
}
function isCoordinateInRange(coord: Coordinate): boolean {
  return Math.abs(coord.lat) <= 90 && Math.abs(coord.lng) <= 180;
}
function normalizeCoordinate(coord: Coordinate): Coordinate | null {
  if (isCoordinateInRange(coord)) return coord;
  const swapped = { lat: coord.lng, lng: coord.lat };
  if (isCoordinateInRange(swapped)) return swapped;
  return null;
}
function formatDebugValue(value: string | number): string {
  if (typeof value === "number") return value.toFixed(2);
  return value;
}
function holeSG(round: Round | null, holeNo: number): number {
  if (!round) return 0;
  return round.events.filter((e) => e.hole === holeNo).reduce((sum, e) => sum + (e.sg ?? 0), 0);
}
function holePuttingSG(round: Round | null, holeNo: number): number {
  if (!round) return 0;
  return round.events.filter((e) => e.hole === holeNo && e.type === "green").reduce((sum, e) => sum + (e.sg ?? 0), 0);
}
function holeCategorySG(round: Round | null, holeNo: number): Record<SGCategory, number> {
  const totals = emptySGTotals();
  if (!round) return totals;
  for (const event of round.events) {
    if (event.hole !== holeNo || !event.sg_category) continue;
    totals[event.sg_category] += event.sg ?? 0;
  }
  return totals;
}

export default function HolePage() {
  const params = useParams<{ n: string }>();
  const router = useRouter();
  const holeNumber = Number(params.n);
  const [mounted, setMounted] = useState(false);
  const [geoSupported, setGeoSupported] = useState(false);
  const [course, setCourse] = useState<CourseGps | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [sgBaseline, setSgBaseline] = useState<SGBaseline | null>(null);
  const [position, setPosition] = useState<PositionState | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsPermissionDenied, setGpsPermissionDenied] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lieModalOpen, setLieModalOpen] = useState(false);
  const [puttModalOpen, setPuttModalOpen] = useState(false);
  const [pendingShotDraft, setPendingShotDraft] = useState<PendingShotDraft | null>(null);
  const [selectedLie, setSelectedLie] = useState<LieType | null>(null);
  const [selectedClub, setSelectedClub] = useState<string | null>(null);
  const [puttPaces, setPuttPaces] = useState("");
  const [puttCount, setPuttCount] = useState(2);

  const isValid = Number.isInteger(holeNumber) && holeNumber >= 1 && holeNumber <= 18;
  const hole = useMemo(() => findHole(course, holeNumber), [course, holeNumber]);
  const parByHole = useMemo(() => resolveParByHole(course), [course]);
  const par = isValid ? (parByHole[holeNumber] ?? 4) : 4;
  const hcp = isValid ? HOLE_HCP[holeNumber - 1] : 0;

  useEffect(() => {
    setMounted(true);
    setRound(getStoredRound());
    setGeoSupported(typeof navigator !== "undefined" && "geolocation" in navigator);
    fetchCourse().then(setCourse).catch(() => setLoadError("Unable to load course data."));
    loadSGBaseline().then(setSgBaseline).catch(() => setLoadError("Unable to load SG baseline."));
  }, []);

  useEffect(() => {
    if (!isValid || !hole || !geoSupported) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGpsPermissionDenied(false);
        setGpsError(null);
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        setGpsPermissionDenied(denied);
        setGpsError(denied ? "Location permission denied." : "Could not get location. Tap retry.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [geoSupported, hole, isValid, retryCount]);

  useEffect(() => {
    if (!round || !sgBaseline) return;
    if (round.sg_baseline_version === sgBaseline.version && round.sg_total !== undefined) return;
    const withSg = recalculateRoundSG(round, sgBaseline, parByHole);
    setRound(withSg);
    saveRound(withSg);
  }, [round, sgBaseline, parByHole]);

  useEffect(() => {
    if (!round?.ended_at) return;
    setLieModalOpen(false);
    setPuttModalOpen(false);
    setPendingShotDraft(null);
  }, [round?.ended_at]);

  function updateRound(nextRound: Round) {
    const stamped = { ...nextRound, updated_at: nowIso() };
    const withSG = sgBaseline ? recalculateRoundSG(stamped, sgBaseline, parByHole) : stamped;
    setRound(withSG);
    saveRound(withSG);
  }
  function ensureRound(): Round | null {
    if (round) return round;
    if (!course) return null;
    const nextRound: Round = {
      id: uid(),
      started_at: nowIso(),
      updated_at: nowIso(),
      tee_set_id: "default",
      current_hole: holeNumber,
      events: [],
      sg_total: 0,
      sg_by_category: emptySGTotals(),
    };
    updateRound(nextRound);
    return nextRound;
  }
  function lastShotOnHole(activeRound: Round): ShotEvent | null {
    return ([...activeRound.events].reverse().find((e) => e.hole === holeNumber && e.type === "shot") as ShotEvent | undefined) ?? null;
  }
  function startLieForShot(activeRound: Round): StartLieType {
    const lastShot = lastShotOnHole(activeRound);
    if (!lastShot?.end_lie) return "tee";
    if (lastShot.end_lie === "penalty") return "fairway";
    return lastShot.end_lie;
  }
  function startCoordinateForShot(activeRound: Round, fallbackCoord: Coordinate): Coordinate {
    const lastShot = lastShotOnHole(activeRound);
    if (lastShot && Number.isFinite(lastShot.lat) && Number.isFinite(lastShot.lng)) {
      const normalizedLast = normalizeCoordinate({ lat: lastShot.lat, lng: lastShot.lng });
      if (normalizedLast && !isZeroCoordinate(normalizedLast)) return normalizedLast;
    }
    const tee = hole?.tee ? normalizeCoordinate(hole.tee) : null;
    if (tee && !isZeroCoordinate(tee)) return tee;
    return fallbackCoord;
  }

  function handleLogShot() {
    if (round?.ended_at) return;
    if (!hole || !position) return setGpsError("Waiting for GPS fix...");
    if (position.accuracy > MAX_GPS_ACCURACY_METERS) return setGpsError("Waiting for accurate GPS fix...");
    const rawCurrentCoord = { lat: position.lat, lng: position.lng };
    const currentCoord = normalizeCoordinate(rawCurrentCoord);
    if (!currentCoord) return setGpsError("Invalid GPS coordinate received.");
    if (isZeroCoordinate(currentCoord)) return setGpsError("Waiting for accurate GPS fix...");
    const greenCenter = normalizeCoordinate(hole.greenCenter);
    if (!greenCenter || isZeroCoordinate(greenCenter)) return setGpsError("Green center is invalid for this hole.");
    if (!sgBaseline) return setLoadError("SG baseline is still loading. Try again in a moment.");
    const activeRound = ensureRound();
    if (!activeRound) return;
    const startCoord = startCoordinateForShot(activeRound, currentCoord);
    const startLie = startLieForShot(activeRound);
    const distanceFromPrevYards = safeDistanceYards(startCoord, currentCoord);
    const startDistanceYards = safeDistanceYards(startCoord, greenCenter);
    const endDistanceYards = safeDistanceYards(currentCoord, greenCenter);
    const clampDistance = (value: number | null, label: string): number | null => {
      if (value === null) return null;
      if (value > MAX_REASONABLE_DISTANCE_YARDS) {
        console.warn(`[gps] Unrealistic ${label}: ${value.toFixed(1)} yards on hole ${holeNumber}.`);
        return null;
      }
      return Math.max(0, value);
    };
    const distanceFromPrev = clampDistance(distanceFromPrevYards, "shot distance from previous");
    const startDistance = clampDistance(startDistanceYards, "start distance");
    const endDistance = clampDistance(endDistanceYards, "end distance");
    if (distanceFromPrev === null || startDistance === null || endDistance === null) {
      return setGpsError("Shot could not be logged due to invalid GPS distance.");
    }
    setPendingShotDraft({
      id: uid(),
      lat: currentCoord.lat,
      lng: currentCoord.lng,
      distance_from_prev_yd: distanceFromPrev,
      start_distance_yds: startDistance,
      end_distance_yds: endDistance,
      start_lie: startLie,
    });
    setSelectedLie(null);
    setSelectedClub(null);
    setLieModalOpen(true);
  }
  function handleConfirmLog() {
    if (round?.ended_at) return;
    if (!round || !pendingShotDraft || !selectedLie) return;
    const shotEvent: ShotEvent = {
      id: pendingShotDraft.id,
      hole: holeNumber,
      type: "shot",
      stroke_value: 1,
      timestamp: nowIso(),
      lat: pendingShotDraft.lat,
      lng: pendingShotDraft.lng,
      distance_from_prev_yd: pendingShotDraft.distance_from_prev_yd,
      start_distance_yds: pendingShotDraft.start_distance_yds,
      end_distance_yds: pendingShotDraft.end_distance_yds,
      start_lie: pendingShotDraft.start_lie,
      end_lie: selectedLie,
      notes: selectedClub ?? undefined,
    };
    const withLie = { ...round, current_hole: holeNumber, events: [...round.events, shotEvent] };
    updateRound(withLie);
    if (selectedLie === "penalty") {
      updateRound({ ...withLie, events: [...withLie.events, { id: uid(), hole: holeNumber, type: "penalty", stroke_value: 1, timestamp: nowIso(), notes: "Penalty stroke" }] });
      setLieModalOpen(false);
      setPendingShotDraft(null);
      return;
    }
    setLieModalOpen(false);
    if (selectedLie === "green") {
      setPuttPaces("");
      setPuttCount(2);
      setPuttModalOpen(true);
      return;
    }
    setPendingShotDraft(null);
  }
  function handleSavePutts() {
    if (round?.ended_at) return setPuttModalOpen(false);
    if (!round || !pendingShotDraft) return setPuttModalOpen(false);
    const paces = Number(puttPaces);
    if (!Number.isFinite(paces) || paces < 0) return;
    updateRound({
      ...round,
      events: [
        ...round.events,
        { id: uid(), type: "green", hole: holeNumber, first_putt_paces: paces, first_putt_ft: pacesToFeet(paces), putts: puttCount, stroke_value: puttCount, timestamp: nowIso() },
      ],
    });
    setPuttModalOpen(false);
    setPendingShotDraft(null);
  }
  function handleUndo() {
    if (round?.ended_at) return;
    if (!round || round.events.length === 0) return;
    updateRound({ ...round, current_hole: holeNumber, events: round.events.slice(0, -1) });
    setLieModalOpen(false);
    setPuttModalOpen(false);
    setPendingShotDraft(null);
  }
  function handleGoToHole(n: number) {
    if (round) updateRound({ ...round, current_hole: n });
    router.push(`/hole/${n}`);
  }
  function handleEndRound() {
    const activeRound = ensureRound();
    if (!activeRound) return;
    const endedRound: Round = { ...activeRound, ended_at: nowIso(), current_hole: holeNumber };
    updateRound(endedRound);
    router.push("/round");
  }
  function handleResumeEdit() {
    if (!round) return;
    updateRound({ ...round, ended_at: undefined, current_hole: holeNumber });
  }

  const strokesThisHole = round?.events.filter((e) => e.hole === holeNumber).reduce((s, e) => s + e.stroke_value, 0) ?? 0;
  const currentCoord = position ? normalizeCoordinate({ lat: position.lat, lng: position.lng }) : null;
  const greenCenter = hole?.greenCenter ? normalizeCoordinate(hole.greenCenter) : null;
  const isAccurateFix = Boolean(position && position.accuracy <= MAX_GPS_ACCURACY_METERS);
  const hasValidCurrentCoord = Boolean(currentCoord && !isZeroCoordinate(currentCoord));
  const hasValidGreenCenter = Boolean(greenCenter && !isZeroCoordinate(greenCenter));
  const rawDistanceYards = currentCoord && greenCenter && isAccurateFix ? safeDistanceYards(currentCoord, greenCenter) : null;
  const isUnrealisticDistance = rawDistanceYards !== null && rawDistanceYards > MAX_REASONABLE_DISTANCE_YARDS;
  const distYards =
    mounted && isAccurateFix && hasValidCurrentCoord && hasValidGreenCenter && rawDistanceYards !== null && !isUnrealisticDistance
      ? Math.round(rawDistanceYards)
      : null;
  const waitingForAccurateFix = mounted && (!isAccurateFix || !hasValidCurrentCoord);
  const sgTotal = round?.sg_total ?? 0;
  const sgThisHole = holeSG(round, holeNumber);
  const sgPuttingThisHole = holePuttingSG(round, holeNumber);
  const sgRoundByCategory = round?.sg_by_category ?? emptySGTotals();
  const sgHoleByCategory = holeCategorySG(round, holeNumber);
  const roundStats = useMemo(() => buildRoundStats(round, course), [round, course]);
  const holeStats = roundStats.holes[holeNumber - 1];
  const isRoundEnded = Boolean(round?.ended_at);
  const showGpsDebug = process.env.NEXT_PUBLIC_DEBUG_GPS === "1";
  const showSgDebug = process.env.NEXT_PUBLIC_DEBUG_SG === "1";
  const noGps = !geoSupported || gpsPermissionDenied;
  const holeEvents = round?.events.filter((event) => event.hole === holeNumber) ?? [];
  const holeSgDebugRows = holeEvents.filter((event) => event.sg_debug).map((event, index) => ({
    index: index + 1,
    category: event.sg_category ?? "-",
    debug: event.sg_debug as SGDebugInfo,
  }));

  useEffect(() => {
    if (isUnrealisticDistance && rawDistanceYards !== null) {
      console.warn(`[gps] Unrealistic distance to green center: ${rawDistanceYards.toFixed(1)} yards on hole ${holeNumber}.`);
    }
  }, [holeNumber, isUnrealisticDistance, rawDistanceYards]);

  if (!isValid) return <main><p>Invalid hole number.</p></main>;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-primary)", paddingBottom: "6rem" }}>
      <ScorecardBar round={round} currentHole={holeNumber} course={course} />
      <div className="mx-auto max-w-md px-4 py-4">
        <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <button onClick={() => holeNumber > 1 && handleGoToHole(holeNumber - 1)}>Prev</button>
            <div>Hole {holeNumber} | Par {par} | Hcp {hcp}</div>
            <button onClick={() => holeNumber < 18 && handleGoToHole(holeNumber + 1)}>Next</button>
          </div>
        </div>
        <div className="mt-3 rounded-xl border p-4 text-center" style={{ borderColor: "var(--border)" }}>
          <div>To Pin</div>
          <div style={{ fontSize: "3rem", fontWeight: 800 }}>{distYards !== null ? distYards : "--"}</div>
          <div>yards</div>
          <AccuracyPill accuracyM={position?.accuracy ?? null} noGps={noGps} />
          {waitingForAccurateFix && <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>Waiting for accurate GPS fix...</div>}
          {!waitingForAccurateFix && !hasValidGreenCenter && <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>Green center coordinates unavailable.</div>}
        </div>
        {showGpsDebug && (
          <div className="mt-3 rounded-xl border p-4 text-xs" style={{ borderColor: "var(--border)" }}>
            <div>GPS Lat: {position ? position.lat.toFixed(6) : "--"}</div>
            <div>GPS Lng: {position ? position.lng.toFixed(6) : "--"}</div>
            <div>GPS Accuracy (m): {position ? position.accuracy.toFixed(1) : "--"}</div>
            <div>Green Center Lat: {greenCenter ? greenCenter.lat.toFixed(6) : "--"}</div>
            <div>Green Center Lng: {greenCenter ? greenCenter.lng.toFixed(6) : "--"}</div>
            <div>Computed Distance (yd): {distYards !== null ? distYards : "--"}</div>
          </div>
        )}
        {showSgDebug && (
          <div className="mt-3 rounded-xl border p-4 text-xs" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 text-sm font-semibold">SG Debug</div>
            <div className="mb-2">Hole Total: {formatSG(sgThisHole)}</div>
            <div className="mb-2 grid grid-cols-5 gap-1">
              {Object.entries(SG_LABELS).map(([key, label]) => (
                <div key={`sg-debug-${key}`}>
                  {label}: {formatSG(sgHoleByCategory[key as SGCategory] ?? 0)}
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse">
                <thead>
                  <tr>
                    <th className="border p-1 text-left">#</th>
                    <th className="border p-1 text-left">Cat</th>
                    <th className="border p-1 text-left">Start</th>
                    <th className="border p-1 text-left">End</th>
                    <th className="border p-1 text-left">E(start)</th>
                    <th className="border p-1 text-left">E(end)</th>
                    <th className="border p-1 text-left">SG</th>
                  </tr>
                </thead>
                <tbody>
                  {holeSgDebugRows.map((row) => (
                    <tr key={`sg-row-${row.index}`}>
                      <td className="border p-1">{row.index}</td>
                      <td className="border p-1">{row.category}</td>
                      <td className="border p-1">{`${row.debug.start_lie} ${formatDebugValue(row.debug.start_distance)} ${row.debug.start_unit}`}</td>
                      <td className="border p-1">{`${row.debug.end_lie} ${formatDebugValue(row.debug.end_distance)} ${row.debug.end_unit}`}</td>
                      <td className="border p-1">{formatDebugValue(row.debug.e_start)}</td>
                      <td className="border p-1">{formatDebugValue(row.debug.e_end)}</td>
                      <td className="border p-1">{formatSG(row.debug.sg_shot)}</td>
                    </tr>
                  ))}
                  {holeSgDebugRows.length === 0 && (
                    <tr>
                      <td className="border p-1" colSpan={7}>No SG events on this hole.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="mt-3 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
          <div>This Hole: {strokesThisHole || "-"}</div>
          <button onClick={handleUndo} disabled={!round || isRoundEnded || round.events.filter((e) => e.hole === holeNumber).length === 0}>Undo</button>
          {isRoundEnded && <div className="mt-2 text-xs text-amber-300">Round ended. Resume/Edit to make changes.</div>}
        </div>
        <div className="mt-3 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
          <div>Round SG {formatSG(sgTotal)}</div>
          <div>Hole SG {formatSG(sgThisHole)}</div>
          <div>Putting SG {formatSG(sgPuttingThisHole)}</div>
          <div className="mt-2 grid grid-cols-5 gap-1 text-xs">
            {Object.entries(SG_LABELS).map(([key, label]) => <div key={key}>{label}: {formatSG(sgRoundByCategory[key as SGCategory] ?? 0)}</div>)}
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1 text-xs">
            {Object.entries(SG_LABELS).map(([key, label]) => <div key={`hole-${key}`}>{label}: {formatSG(sgHoleByCategory[key as SGCategory] ?? 0)}</div>)}
          </div>
        </div>
        <div className="mt-3 rounded-xl border p-3 text-xs" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 text-sm font-semibold">Round Dashboard</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}>
              <div>FIR</div>
              <div>Hole: {holeStats ? formatFlag(holeStats.fir) : "--"}</div>
              <div>Round: {formatPct(roundStats.fir.pct)}</div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}>
              <div>GIR</div>
              <div>Hole: {holeStats ? formatFlag(holeStats.gir) : "--"}</div>
              <div>Round: {formatPct(roundStats.gir.pct)}</div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}>
              <div>Up&amp;Down</div>
              <div>Hole: {holeStats ? formatFlag(holeStats.upAndDown) : "--"}</div>
              <div>Round: {formatPct(roundStats.upAndDown.pct)}</div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}>
              <div>Putts</div>
              <div>Hole: {holeStats?.putts ?? 0}</div>
              <div>Avg: {roundStats.puttsAvg === null ? "--" : roundStats.puttsAvg.toFixed(2)}</div>
            </div>
            <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}>
              <div>Strokes</div>
              <div>Hole: {holeStats?.strokes ?? 0}</div>
              <div>Total: {roundStats.strokesTotal}</div>
            </div>
          </div>
        </div>
        {gpsError && <div className="mt-3 rounded-xl border p-3 text-sm text-amber-300" style={{ borderColor: "#92400e" }}>{gpsError} <button onClick={() => { setGpsPermissionDenied(false); setGpsError(null); setRetryCount((c) => c + 1); }}>Retry GPS</button></div>}
        {loadError && <div className="mt-3 rounded-xl border p-3 text-sm text-red-300" style={{ borderColor: "#7f1d1d" }}>{loadError}</div>}
      </div>
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-3" style={{ background: "linear-gradient(to top, var(--bg-primary) 70%, transparent)" }}>
        <div className="mx-auto max-w-md">
          <button className="mb-2 h-10 w-full rounded-xl border" style={{ borderColor: "var(--border)" }} onClick={() => router.push("/round")}>Round Summary</button>
          {isRoundEnded ? (
            <button className="mb-2 h-10 w-full rounded-xl border" style={{ borderColor: "#22c55e" }} onClick={handleResumeEdit}>
              Resume/Edit Round
            </button>
          ) : (
            <button className="mb-2 h-10 w-full rounded-xl border" style={{ borderColor: "#7f1d1d", color: "#fca5a5" }} onClick={handleEndRound}>
              End Round
            </button>
          )}
          <button className="h-14 w-full rounded-xl border bg-green-500 text-green-950 disabled:opacity-40" style={{ borderColor: "#22c55e" }} onClick={handleLogShot} disabled={isRoundEnded || !mounted || !hole || !position || !sgBaseline || !isAccurateFix || !hasValidCurrentCoord || !hasValidGreenCenter}>Log Shot Here</button>
        </div>
      </div>

      {lieModalOpen && (
        <div
          className="fixed inset-0 z-20 flex items-end bg-black/70"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            setLieModalOpen(false);
            setPendingShotDraft(null);
          }}
        >
          <div className="w-full rounded-t-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
            <div className="text-sm uppercase">Lie</div>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {LIES.map((lie) => <button className="rounded border p-2 text-xs" style={{ borderColor: selectedLie === lie.value ? "#22c55e" : "var(--border)" }} key={lie.value} onClick={() => setSelectedLie(lie.value)}>{lie.label}</button>)}
            </div>
            <div className="mt-3 text-sm uppercase">Club (optional)</div>
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {CLUBS.map((club) => <button key={club} className="rounded border px-2 py-1 text-xs" style={{ borderColor: selectedClub === club ? "#22c55e" : "var(--border)" }} onClick={() => setSelectedClub(selectedClub === club ? null : club)}>{club}</button>)}
            </div>
            <button className="mt-3 h-12 w-full rounded bg-green-500 text-green-950 disabled:opacity-40" onClick={handleConfirmLog} disabled={isRoundEnded || !selectedLie}>Log Shot</button>
          </div>
        </div>
      )}

      {puttModalOpen && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/70">
          <div className="w-full rounded-t-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
            <div className="text-sm uppercase">On The Green</div>
            <label className="mt-2 block text-sm">First putt distance (paces)</label>
            <input className="mt-1 w-full rounded border p-2" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }} inputMode="decimal" type="number" min="0" step="0.5" value={puttPaces} onChange={(e) => setPuttPaces(e.target.value)} />
            {puttPaces && Number(puttPaces) > 0 && <div className="mt-1 text-xs">~ {pacesToFeet(Number(puttPaces)).toFixed(1)} ft</div>}
            <label className="mt-3 block text-sm">Number of putts</label>
            <div className="mt-1 grid grid-cols-7 gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map((n) => <button key={n} className="rounded border p-2" style={{ borderColor: puttCount === n ? "#22c55e" : "var(--border)" }} onClick={() => setPuttCount(n)}>{n}</button>)}
            </div>
            <button className="mt-3 h-12 w-full rounded bg-green-500 text-green-950 disabled:opacity-40" onClick={handleSavePutts} disabled={isRoundEnded}>Save Putting</button>
          </div>
        </div>
      )}
    </main>
  );
}
