"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ScorecardBar from "@/components/ScorecardBar";
import { fetchCourse } from "@/lib/course";
import { distanceYards, pacesToFeet } from "@/lib/geo";
import { getStoredRound, saveRound } from "@/lib/round-storage";
import type { Coordinate, Course, Hole, LieType, Round, ShotEvent, StrokeEvent } from "@/lib/types";

type PositionState = {
  lat: number;
  lng: number;
  accuracy: number;
};

const lieOptions: Array<{ label: string; value: LieType }> = [
  { label: "Fairway", value: "fairway" },
  { label: "Rough", value: "rough" },
  { label: "Sand", value: "sand" },
  { label: "Green", value: "green" },
  { label: "Penalty", value: "penalty" },
];

function findHole(course: Course | null, round: Round | null, holeNumber: number): Hole | null {
  if (!course) {
    return null;
  }
  const teeSetId = round?.tee_set_id ?? course.tee_sets[0]?.id;
  const teeSet = course.tee_sets.find((item) => item.id === teeSetId) ?? course.tee_sets[0];
  return teeSet?.holes.find((item) => item.hole === holeNumber) ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createEventId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isGpsShotOnHole(event: StrokeEvent, holeNumber: number): event is ShotEvent & Coordinate {
  return (
    event.hole === holeNumber &&
    event.type === "shot" &&
    typeof event.lat === "number" &&
    typeof event.lng === "number"
  );
}

export default function HolePage() {
  const params = useParams<{ n: string }>();
  const router = useRouter();
  const holeNumber = Number(params.n);

  const [mounted, setMounted] = useState(false);
  const [geolocationSupported, setGeolocationSupported] = useState(false);
  const [course, setCourse] = useState<Course | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [position, setPosition] = useState<PositionState | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lieModalOpen, setLieModalOpen] = useState(false);
  const [puttModalOpen, setPuttModalOpen] = useState(false);
  const [pendingShotId, setPendingShotId] = useState<string | null>(null);
  const [puttPaces, setPuttPaces] = useState("");
  const [puttCount, setPuttCount] = useState(2);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hole = useMemo(() => findHole(course, round, holeNumber), [course, round, holeNumber]);
  const isHoleNumberValid = Number.isInteger(holeNumber) && holeNumber >= 1 && holeNumber <= 18;

  useEffect(() => {
    setMounted(true);
    setRound(getStoredRound());
    setGeolocationSupported(typeof navigator !== "undefined" && "geolocation" in navigator);

    fetchCourse()
      .then(setCourse)
      .catch(() => setLoadError("Unable to load course data from /public/course.json."));
  }, []);

  useEffect(() => {
    if (!isHoleNumberValid || !hole) {
      return;
    }

    if (!geolocationSupported) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (gpsPosition) => {
        setPosition({
          lat: gpsPosition.coords.latitude,
          lng: gpsPosition.coords.longitude,
          accuracy: gpsPosition.coords.accuracy,
        });
        setGpsError(null);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGpsError("Location permission was denied. Please allow location and tap Retry.");
          return;
        }
        if (error.code === error.TIMEOUT) {
          setGpsError("GPS timed out. Move to open sky and tap Retry.");
          return;
        }
        setGpsError("Could not get your location. Please tap Retry.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [geolocationSupported, hole, isHoleNumberValid, retryCount]);

  function updateRound(nextRound: Round) {
    const stampedRound = { ...nextRound, updated_at: nowIso() };
    setRound(stampedRound);
    saveRound(stampedRound);
  }

  function applyToEvent(roundData: Round, eventId: string, updater: (event: StrokeEvent) => StrokeEvent): Round {
    return {
      ...roundData,
      events: roundData.events.map((event) => (event.id === eventId ? updater(event) : event)),
    };
  }

  function eventStrokes(event: StrokeEvent): number {
    return Number.isFinite(event.stroke_value) ? event.stroke_value : 0;
  }

  function ensureRound(): Round | null {
    if (round) {
      return round;
    }

    if (!course) {
      return null;
    }

    const teeSetId = course.tee_sets[0]?.id ?? "default";
    const newRound: Round = {
      id: createEventId(),
      started_at: nowIso(),
      updated_at: nowIso(),
      tee_set_id: teeSetId,
      current_hole: Math.min(Math.max(holeNumber, 1), 18),
      events: [],
    };
    updateRound(newRound);
    return newRound;
  }

  function handleRetryGps() {
    setRetryCount((value) => value + 1);
  }

  function handleLogShot() {
    if (!hole || !position) {
      setGpsError("No current GPS fix yet. Wait for location, then try again.");
      return;
    }

    const activeRound = ensureRound();
    if (!activeRound) {
      setLoadError("Unable to create a round right now.");
      return;
    }

    const lastGpsShotOnHole = [...activeRound.events]
      .reverse()
      .find((event): event is ShotEvent & Coordinate => isGpsShotOnHole(event, holeNumber));

    const previousCoordinate: Coordinate = lastGpsShotOnHole
      ? { lat: lastGpsShotOnHole.lat, lng: lastGpsShotOnHole.lng }
      : hole.tee;

    const shotCoordinate: Coordinate = { lat: position.lat, lng: position.lng };
    const eventId = createEventId();
    const shotEvent: StrokeEvent = {
      id: eventId,
      hole: holeNumber,
      type: "shot",
      stroke_value: 1,
      timestamp: nowIso(),
      lat: shotCoordinate.lat,
      lng: shotCoordinate.lng,
      distance_from_prev_yd: distanceYards(previousCoordinate, shotCoordinate),
    };

    updateRound({
      ...activeRound,
      current_hole: holeNumber,
      events: [...activeRound.events, shotEvent],
    });

    setPendingShotId(eventId);
    setLieModalOpen(true);
  }

  function handleSelectLie(lie: LieType) {
    if (!round || !pendingShotId) {
      setLieModalOpen(false);
      return;
    }

    const withLie = applyToEvent(round, pendingShotId, (event) => ({ ...event, lie }));
    updateRound(withLie);

    if (lie === "penalty") {
      const penaltyEvent: StrokeEvent = {
        id: createEventId(),
        hole: holeNumber,
        type: "penalty",
        stroke_value: 1,
        timestamp: nowIso(),
        notes: "Penalty stroke",
      };
      updateRound({
        ...withLie,
        events: [...withLie.events, penaltyEvent],
      });
      setLieModalOpen(false);
      setPendingShotId(null);
      return;
    }

    setLieModalOpen(false);
    if (lie === "green") {
      setPuttPaces("");
      setPuttCount(2);
      setPuttModalOpen(true);
      return;
    }

    setPendingShotId(null);
  }

  function handleSavePuttingEntry() {
    if (!round || !pendingShotId) {
      setPuttModalOpen(false);
      return;
    }

    const paces = Number(puttPaces);
    if (!Number.isFinite(paces) || paces < 0) {
      return;
    }
    if (!Number.isInteger(puttCount) || puttCount < 0) {
      return;
    }

    const greenEvent: StrokeEvent = {
      id: createEventId(),
      type: "green",
      hole: holeNumber,
      first_putt_paces: paces,
      first_putt_ft: pacesToFeet(paces),
      putts: puttCount,
      stroke_value: puttCount,
      timestamp: nowIso(),
    };
    updateRound({
      ...round,
      events: [...round.events, greenEvent],
    });
    setPuttModalOpen(false);
    setPendingShotId(null);
  }

  function handleUndoLastAction() {
    if (!round || round.events.length === 0) {
      return;
    }

    updateRound({
      ...round,
      current_hole: holeNumber,
      events: round.events.slice(0, -1),
    });
    setLieModalOpen(false);
    setPuttModalOpen(false);
    setPendingShotId(null);
  }

  function handleGoToHole(nextHole: number) {
    if (!round) {
      router.push(`/hole/${nextHole}`);
      return;
    }

    updateRound({ ...round, current_hole: nextHole });
    router.push(`/hole/${nextHole}`);
  }

  const strokesThisHole = round
    ? round.events.filter((event) => event.hole === holeNumber).reduce((total, event) => total + eventStrokes(event), 0)
    : 0;
  const totalStrokes = round ? round.events.reduce((total, event) => total + eventStrokes(event), 0) : 0;

  const distanceToGreenYards =
    hole && position
      ? Math.round(distanceYards({ lat: position.lat, lng: position.lng }, hole.green_center))
      : null;

  if (!isHoleNumberValid) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-md bg-slate-50 p-4">
        <ScorecardBar round={round} currentHole={Math.min(Math.max(holeNumber, 1), 18)} />
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Invalid hole</h1>
          <p className="mt-2 text-sm text-slate-700">Use a hole number from 1 through 18.</p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-4 h-12 w-full rounded-xl bg-slate-900 font-semibold text-white"
          >
            Back Home
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-slate-50 p-4">
      <ScorecardBar round={round} currentHole={holeNumber} />

      <header className="mt-3 rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-900">Hole {holeNumber}</h1>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={holeNumber <= 1}
              onClick={() => handleGoToHole(holeNumber - 1)}
              className="h-11 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={holeNumber >= 18}
              onClick={() => handleGoToHole(holeNumber + 1)}
              className="h-11 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              Next
            </button>
          </div>
        </div>
      </header>

      <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">Distance to green center</p>
        <p className="mt-1 text-4xl font-bold text-emerald-700">
          {mounted && distanceToGreenYards !== null ? `${distanceToGreenYards} yd` : "—"}
        </p>
        {mounted && position ? (
          <p className="mt-1 text-xs text-slate-500">GPS accuracy: {Math.round(position.accuracy)} m</p>
        ) : null}
      </section>

      <section className="mt-3 rounded-2xl bg-white p-4 text-sm text-slate-700 shadow-sm">
        <p>
          Strokes this hole: <span className="font-semibold text-slate-900">{strokesThisHole}</span>
        </p>
        <p>
          Total strokes: <span className="font-semibold text-slate-900">{totalStrokes}</span>
        </p>
      </section>

      {mounted && !geolocationSupported ? (
        <section className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          This browser does not support GPS location.
        </section>
      ) : null}

      {gpsError ? (
        <section className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{gpsError}</p>
          <button
            type="button"
            onClick={handleRetryGps}
            className="mt-3 h-11 rounded-lg bg-amber-700 px-4 font-semibold text-white"
          >
            Retry GPS
          </button>
        </section>
      ) : null}

      {loadError ? (
        <section className="mt-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {loadError}
        </section>
      ) : null}

      <button
        type="button"
        onClick={handleLogShot}
        disabled={!mounted || !hole || !position}
        className="mt-4 h-16 w-full rounded-2xl bg-emerald-600 text-xl font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        Log Shot Here
      </button>
      <button
        type="button"
        onClick={handleUndoLastAction}
        disabled={!round || round.events.length === 0}
        className="mt-2 h-12 w-full rounded-xl bg-slate-200 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      >
        Undo Last Action
      </button>

      {lieModalOpen ? (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40 p-4">
          <div className="w-full rounded-2xl bg-white p-4 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">Select Lie</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {lieOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelectLie(option.value)}
                  className="h-12 rounded-lg bg-slate-100 font-semibold text-slate-900"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {puttModalOpen ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40 p-4">
          <div className="w-full rounded-2xl bg-white p-4 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">Putting</h2>
            <label htmlFor="paces" className="mt-2 block text-sm text-slate-700">
              First putt distance in paces (1 pace = 3 ft)
            </label>
            <input
              id="paces"
              inputMode="decimal"
              type="number"
              min="0"
              step="0.1"
              value={puttPaces}
              onChange={(event) => setPuttPaces(event.target.value)}
              className="mt-2 h-12 w-full rounded-lg border border-slate-300 px-3 text-lg"
            />
            <p className="mt-1 text-xs text-slate-500">
              {puttPaces === "" || Number(puttPaces) < 0 || !Number.isFinite(Number(puttPaces))
                ? "Enter a valid value."
                : `${pacesToFeet(Number(puttPaces)).toFixed(1)} ft`}
            </p>
            <p className="mt-3 text-sm text-slate-700">Number of putts</p>
            <div className="mt-2 grid grid-cols-6 gap-2">
              {[0, 1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPuttCount(value)}
                  className={`h-11 rounded-lg text-base font-semibold ${
                    puttCount === value
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-900"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleSavePuttingEntry}
              className="mt-3 h-12 w-full rounded-lg bg-slate-900 font-semibold text-white"
            >
              Save Putting
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
