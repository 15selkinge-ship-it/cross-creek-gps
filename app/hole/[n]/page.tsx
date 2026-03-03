"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ScorecardBar from "@/components/ScorecardBar";
import { fetchCourse } from "@/lib/course";
import { distanceYards, pacesToFeet } from "@/lib/geo";
import { getStoredRound, saveRound } from "@/lib/round-storage";
import { emptySGTotals, loadSGBaseline, recalculateRoundSG, type SGBaseline } from "@/lib/sg";
import type { Coordinate, Course, Hole, LieType, Round, SGCategory, ShotEvent, StrokeEvent } from "@/lib/types";

type PositionState = { lat: number; lng: number; accuracy: number };

const HOLE_PARS = [5, 3, 4, 4, 3, 4, 3, 5, 4, 4, 3, 5, 3, 4, 5, 3, 4, 5];
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

function nowIso() {
  return new Date().toISOString();
}
function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function formatSG(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
function findHole(course: Course | null, round: Round | null, n: number): Hole | null {
  if (!course) return null;
  const teeSetId = round?.tee_set_id ?? course.tee_sets[0]?.id;
  const teeSet = course.tee_sets.find((t) => t.id === teeSetId) ?? course.tee_sets[0];
  return teeSet?.holes.find((h) => h.hole === n) ?? null;
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
  const [course, setCourse] = useState<Course | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [sgBaseline, setSgBaseline] = useState<SGBaseline | null>(null);
  const [position, setPosition] = useState<PositionState | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lieModalOpen, setLieModalOpen] = useState(false);
  const [puttModalOpen, setPuttModalOpen] = useState(false);
  const [pendingShotId, setPendingShotId] = useState<string | null>(null);
  const [selectedLie, setSelectedLie] = useState<LieType | null>(null);
  const [selectedClub, setSelectedClub] = useState<string | null>(null);
  const [puttPaces, setPuttPaces] = useState("");
  const [puttCount, setPuttCount] = useState(2);

  const isValid = Number.isInteger(holeNumber) && holeNumber >= 1 && holeNumber <= 18;
  const hole = useMemo(() => findHole(course, round, holeNumber), [course, round, holeNumber]);
  const par = isValid ? HOLE_PARS[holeNumber - 1] : 4;
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
        setGpsError(null);
      },
      () => setGpsError("Could not get location. Tap retry."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [geoSupported, hole, isValid, retryCount]);

  useEffect(() => {
    if (!round || !sgBaseline) return;
    if (round.sg_baseline_version === sgBaseline.version && round.sg_total !== undefined) return;
    const withSg = recalculateRoundSG(round, sgBaseline);
    setRound(withSg);
    saveRound(withSg);
  }, [round, sgBaseline]);

  function updateRound(nextRound: Round) {
    const stamped = { ...nextRound, updated_at: nowIso() };
    const withSG = sgBaseline ? recalculateRoundSG(stamped, sgBaseline) : stamped;
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
      tee_set_id: course.tee_sets[0]?.id ?? "default",
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
  function startLieForShot(activeRound: Round): Exclude<LieType, "penalty"> {
    const lastShot = lastShotOnHole(activeRound);
    if (!lastShot?.end_lie || lastShot.end_lie === "penalty") return "fairway";
    return lastShot.end_lie;
  }
  function startCoordinateForShot(activeRound: Round): Coordinate {
    const lastShot = lastShotOnHole(activeRound);
    if (lastShot && typeof lastShot.lat === "number" && typeof lastShot.lng === "number") return { lat: lastShot.lat, lng: lastShot.lng };
    return hole?.tee ?? { lat: 0, lng: 0 };
  }

  function handleLogShot() {
    if (!hole || !position) return setGpsError("Waiting for GPS fix...");
    if (!sgBaseline) return setLoadError("SG baseline is still loading. Try again in a moment.");
    const activeRound = ensureRound();
    if (!activeRound) return;
    const startCoord = startCoordinateForShot(activeRound);
    const shotCountOnHole = activeRound.events.filter((e) => e.hole === holeNumber && e.type === "shot").length;
    const eventId = uid();
    const shotEvent: StrokeEvent = {
      id: eventId,
      hole: holeNumber,
      type: "shot",
      stroke_value: 1,
      timestamp: nowIso(),
      lat: position.lat,
      lng: position.lng,
      distance_from_prev_yd: distanceYards(startCoord, { lat: position.lat, lng: position.lng }),
      start_distance_yds: distanceYards(startCoord, hole.green_center),
      end_distance_yds: distanceYards({ lat: position.lat, lng: position.lng }, hole.green_center),
      start_lie: shotCountOnHole === 0 ? "fairway" : startLieForShot(activeRound),
    };
    updateRound({ ...activeRound, current_hole: holeNumber, events: [...activeRound.events, shotEvent] });
    setPendingShotId(eventId);
    setSelectedLie(null);
    setSelectedClub(null);
    setLieModalOpen(true);
  }
  function handleConfirmLog() {
    if (!round || !pendingShotId || !selectedLie) return;
    const withLie = { ...round, events: round.events.map((e) => (e.id === pendingShotId ? { ...e, end_lie: selectedLie, notes: selectedClub ?? undefined } : e)) };
    updateRound(withLie);
    if (selectedLie === "penalty") {
      updateRound({ ...withLie, events: [...withLie.events, { id: uid(), hole: holeNumber, type: "penalty", stroke_value: 1, timestamp: nowIso(), notes: "Penalty stroke" }] });
      setLieModalOpen(false);
      setPendingShotId(null);
      return;
    }
    setLieModalOpen(false);
    if (selectedLie === "green") {
      setPuttPaces("");
      setPuttCount(2);
      setPuttModalOpen(true);
      return;
    }
    setPendingShotId(null);
  }
  function handleSavePutts() {
    if (!round || !pendingShotId) return setPuttModalOpen(false);
    const paces = Number(puttPaces);
    if (!Number.isFinite(paces) || paces < 0) return;
    updateRound({ ...round, events: [...round.events, { id: uid(), type: "green", hole: holeNumber, first_putt_paces: paces, first_putt_ft: pacesToFeet(paces), putts: puttCount, stroke_value: puttCount, timestamp: nowIso() }] });
    setPuttModalOpen(false);
    setPendingShotId(null);
  }
  function handleUndo() {
    if (!round || round.events.length === 0) return;
    updateRound({ ...round, current_hole: holeNumber, events: round.events.slice(0, -1) });
    setLieModalOpen(false);
    setPuttModalOpen(false);
    setPendingShotId(null);
  }
  function handleGoToHole(n: number) {
    if (round) updateRound({ ...round, current_hole: n });
    router.push(`/hole/${n}`);
  }

  const strokesThisHole = round?.events.filter((e) => e.hole === holeNumber).reduce((s, e) => s + e.stroke_value, 0) ?? 0;
  const distYards = hole && position ? Math.round(distanceYards({ lat: position.lat, lng: position.lng }, hole.green_center)) : null;
  const sgTotal = round?.sg_total ?? 0;
  const sgThisHole = holeSG(round, holeNumber);
  const sgPuttingThisHole = holePuttingSG(round, holeNumber);
  const sgRoundByCategory = round?.sg_by_category ?? emptySGTotals();
  const sgHoleByCategory = holeCategorySG(round, holeNumber);

  if (!isValid) return <main><p>Invalid hole number.</p></main>;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-primary)", paddingBottom: "6rem" }}>
      <ScorecardBar round={round} currentHole={holeNumber} />
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
          <div style={{ fontSize: "3rem", fontWeight: 800 }}>{mounted && distYards !== null ? distYards : "-"}</div>
          <div>yards</div>
        </div>
        <div className="mt-3 rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
          <div>This Hole: {strokesThisHole || "-"}</div>
          <button onClick={handleUndo} disabled={!round || round.events.filter((e) => e.hole === holeNumber).length === 0}>Undo</button>
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
        {gpsError && <div className="mt-3 rounded-xl border p-3 text-sm text-amber-300" style={{ borderColor: "#92400e" }}>{gpsError} <button onClick={() => setRetryCount((c) => c + 1)}>Retry GPS</button></div>}
        {loadError && <div className="mt-3 rounded-xl border p-3 text-sm text-red-300" style={{ borderColor: "#7f1d1d" }}>{loadError}</div>}
      </div>
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-3" style={{ background: "linear-gradient(to top, var(--bg-primary) 70%, transparent)" }}>
        <div className="mx-auto max-w-md">
          <button className="mb-2 h-10 w-full rounded-xl border" style={{ borderColor: "var(--border)" }} onClick={() => router.push("/round-summary")}>Round Summary</button>
          <button className="h-14 w-full rounded-xl border bg-green-500 text-green-950 disabled:opacity-40" style={{ borderColor: "#22c55e" }} onClick={handleLogShot} disabled={!mounted || !hole || !position || !sgBaseline}>Log Shot Here</button>
        </div>
      </div>

      {lieModalOpen && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/70" onClick={(e) => e.target === e.currentTarget && setLieModalOpen(false)}>
          <div className="w-full rounded-t-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
            <div className="text-sm uppercase">Lie</div>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {LIES.map((lie) => <button className="rounded border p-2 text-xs" style={{ borderColor: selectedLie === lie.value ? "#22c55e" : "var(--border)" }} key={lie.value} onClick={() => setSelectedLie(lie.value)}>{lie.label}</button>)}
            </div>
            <div className="mt-3 text-sm uppercase">Club (optional)</div>
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {CLUBS.map((club) => <button key={club} className="rounded border px-2 py-1 text-xs" style={{ borderColor: selectedClub === club ? "#22c55e" : "var(--border)" }} onClick={() => setSelectedClub(selectedClub === club ? null : club)}>{club}</button>)}
            </div>
            <button className="mt-3 h-12 w-full rounded bg-green-500 text-green-950 disabled:opacity-40" onClick={handleConfirmLog} disabled={!selectedLie}>Log Shot</button>
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
            <div className="mt-1 grid grid-cols-6 gap-2">
              {[1, 2, 3, 4, 5, 6].map((n) => <button key={n} className="rounded border p-2" style={{ borderColor: puttCount === n ? "#22c55e" : "var(--border)" }} onClick={() => setPuttCount(n)}>{n}</button>)}
            </div>
            <button className="mt-3 h-12 w-full rounded bg-green-500 text-green-950" onClick={handleSavePutts}>Save Putting</button>
          </div>
        </div>
      )}
    </main>
  );
}
