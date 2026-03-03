"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ScorecardBar from "@/components/ScorecardBar";
import { fetchCourse } from "@/lib/course";
import { distanceYards, pacesToFeet } from "@/lib/geo";
import { getStoredRound, saveRound } from "@/lib/round-storage";
import type { Coordinate, Course, Hole, LieType, Round, ShotEvent, StrokeEvent } from "@/lib/types";

type PositionState = { lat: number; lng: number; accuracy: number };

const CLUBS = ["Driver","3W","5W","4i","5i","6i","7i","8i","9i","PW","52°","56°","60°","Putter"];
const HOLE_PARS = [5,3,4,4,3,4,3,5,4,4,3,5,3,4,5,3,4,5];
const HOLE_HCP  = [17,13,7,3,11,5,15,1,9,8,10,4,6,2,16,12,14,18];

const LIES: Array<{ label: string; value: LieType; icon: string; color: string }> = [
  { label: "Fairway", value: "fairway", icon: "🌿", color: "#16a34a" },
  { label: "Rough",   value: "rough",   icon: "🌾", color: "#65a30d" },
  { label: "Sand",    value: "sand",    icon: "🏖️",  color: "#d97706" },
  { label: "Green",   value: "green",   icon: "🎯", color: "#0284c7" },
];

function findHole(course: Course | null, round: Round | null, n: number): Hole | null {
  if (!course) return null;
  const teeSetId = round?.tee_set_id ?? course.tee_sets[0]?.id;
  const teeSet = course.tee_sets.find(t => t.id === teeSetId) ?? course.tee_sets[0];
  return teeSet?.holes.find(h => h.hole === n) ?? null;
}

function nowIso() { return new Date().toISOString(); }
function uid() { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

export default function HolePage() {
  const params = useParams<{ n: string }>();
  const router = useRouter();
  const holeNumber = Number(params.n);

  const [mounted, setMounted]             = useState(false);
  const [geoSupported, setGeoSupported]   = useState(false);
  const [course, setCourse]               = useState<Course | null>(null);
  const [round, setRound]                 = useState<Round | null>(null);
  const [position, setPosition]           = useState<PositionState | null>(null);
  const [gpsError, setGpsError]           = useState<string | null>(null);
  const [retryCount, setRetryCount]       = useState(0);
  const [lieModalOpen, setLieModalOpen]   = useState(false);
  const [puttModalOpen, setPuttModalOpen] = useState(false);
  const [pendingShotId, setPendingShotId] = useState<string | null>(null);
  const [selectedLie, setSelectedLie]     = useState<LieType | null>(null);
  const [selectedClub, setSelectedClub]   = useState<string | null>(null);
  const [puttPaces, setPuttPaces]         = useState("");
  const [puttCount, setPuttCount]         = useState(2);
  const [loadError, setLoadError]         = useState<string | null>(null);

  const isValid = Number.isInteger(holeNumber) && holeNumber >= 1 && holeNumber <= 18;
  const hole = useMemo(() => findHole(course, round, holeNumber), [course, round, holeNumber]);
  const par = isValid ? HOLE_PARS[holeNumber - 1] : 4;
  const hcp = isValid ? HOLE_HCP[holeNumber - 1] : 0;

  useEffect(() => {
    setMounted(true);
    setRound(getStoredRound());
    setGeoSupported(typeof navigator !== "undefined" && "geolocation" in navigator);
    fetchCourse().then(setCourse).catch(() => setLoadError("Unable to load course data."));
  }, []);

  useEffect(() => {
    if (!isValid || !hole || !geoSupported) return;
    const id = navigator.geolocation.watchPosition(
      pos => { setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); setGpsError(null); },
      err => {
        if (err.code === err.PERMISSION_DENIED) setGpsError("Location denied. Please allow and retry.");
        else if (err.code === err.TIMEOUT) setGpsError("GPS timed out. Move to open sky and retry.");
        else setGpsError("Could not get location. Tap retry.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [geoSupported, hole, isValid, retryCount]);

  function updateRound(r: Round) {
    const stamped = { ...r, updated_at: nowIso() };
    setRound(stamped); saveRound(stamped);
  }

  function ensureRound(): Round | null {
    if (round) return round;
    if (!course) return null;
    const r: Round = { id: uid(), started_at: nowIso(), updated_at: nowIso(), tee_set_id: course.tee_sets[0]?.id ?? "default", current_hole: holeNumber, events: [] };
    updateRound(r); return r;
  }

  function handleLogShot() {
    if (!hole || !position) { setGpsError("Waiting for GPS fix..."); return; }
    const activeRound = ensureRound();
    if (!activeRound) return;
    const lastShot = [...activeRound.events].reverse().find(e => e.hole === holeNumber && e.type === "shot" && typeof (e as ShotEvent).lat === "number") as (ShotEvent & Coordinate) | undefined;
    const prev: Coordinate = lastShot ? { lat: lastShot.lat!, lng: lastShot.lng! } : hole.tee;
    const eventId = uid();
    const shotEvent: StrokeEvent = {
      id: eventId, hole: holeNumber, type: "shot", stroke_value: 1, timestamp: nowIso(),
      lat: position.lat, lng: position.lng,
      distance_from_prev_yd: distanceYards(prev, { lat: position.lat, lng: position.lng }),
    };
    updateRound({ ...activeRound, current_hole: holeNumber, events: [...activeRound.events, shotEvent] });
    setPendingShotId(eventId);
    setSelectedLie(null);
    setSelectedClub(null);
    setLieModalOpen(true);
  }

  function handleConfirmLog() {
    if (!round || !pendingShotId || !selectedLie) return;
    const withLie = { ...round, events: round.events.map(e => e.id === pendingShotId ? { ...e, lie: selectedLie, notes: selectedClub ?? undefined } : e) };
    updateRound(withLie);
    if (selectedLie === "penalty") {
      updateRound({ ...withLie, events: [...withLie.events, { id: uid(), hole: holeNumber, type: "penalty", stroke_value: 1, timestamp: nowIso(), notes: "Penalty stroke" }] });
      setLieModalOpen(false); setPendingShotId(null); return;
    }
    setLieModalOpen(false);
    if (selectedLie === "green") { setPuttPaces(""); setPuttCount(2); setPuttModalOpen(true); return; }
    setPendingShotId(null);
  }

  function handleSavePutts() {
    if (!round || !pendingShotId) { setPuttModalOpen(false); return; }
    const paces = Number(puttPaces);
    if (!Number.isFinite(paces) || paces < 0) return;
    updateRound({ ...round, events: [...round.events, { id: uid(), type: "green", hole: holeNumber, first_putt_paces: paces, first_putt_ft: pacesToFeet(paces), putts: puttCount, stroke_value: puttCount, timestamp: nowIso() }] });
    setPuttModalOpen(false); setPendingShotId(null);
  }

  function handleUndo() {
    if (!round || round.events.length === 0) return;
    updateRound({ ...round, current_hole: holeNumber, events: round.events.slice(0, -1) });
    setLieModalOpen(false); setPuttModalOpen(false); setPendingShotId(null);
  }

  function handleGoToHole(n: number) {
    if (round) updateRound({ ...round, current_hole: n });
    router.push(`/hole/${n}`);
  }

  const strokesThisHole = round?.events.filter(e => e.hole === holeNumber).reduce((s,e)=>s+e.stroke_value,0) ?? 0;
  const distYards = hole && position ? Math.round(distanceYards({ lat: position.lat, lng: position.lng }, hole.green_center)) : null;

  const scoreVsPar = strokesThisHole > 0 ? strokesThisHole - par : null;
  const scoreLabel = scoreVsPar === null ? null : scoreVsPar <= -2 ? "Eagle" : scoreVsPar === -1 ? "Birdie" : scoreVsPar === 0 ? "Par" : scoreVsPar === 1 ? "Bogey" : `+${scoreVsPar}`;
  const scoreColor = scoreVsPar === null ? "#4ade80" : scoreVsPar <= -2 ? "#fde68a" : scoreVsPar === -1 ? "#86efac" : scoreVsPar === 0 ? "#86efac" : scoreVsPar === 1 ? "#fdba74" : "#fca5a5";

  if (!isValid) {
    return (
      <main style={{ background: "var(--bg-primary)", minHeight: "100vh" }}>
        <ScorecardBar round={round} currentHole={1} />
        <div className="mx-auto max-w-md p-5">
          <p style={{ color: "var(--text-primary)" }}>Invalid hole number.</p>
          <button onClick={() => router.push("/")} className="mt-4 h-12 w-full rounded-xl" style={{ background: "#22c55e", color: "#052e16", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700 }}>Back Home</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ background: "var(--bg-primary)", minHeight: "100vh", paddingBottom: "6rem" }}>
      <ScorecardBar round={round} currentHole={holeNumber} />

      {/* Hole header */}
      <div className="mx-auto max-w-md px-4 pt-4">
        <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
          <button onClick={() => holeNumber > 1 && handleGoToHole(holeNumber - 1)} disabled={holeNumber <= 1}
            className="flex h-10 w-10 items-center justify-center rounded-xl active:opacity-60 disabled:opacity-20"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>

          <div className="text-center">
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: "2.2rem", color: "var(--text-primary)", lineHeight: 1 }}>
              HOLE {holeNumber}
            </div>
            <div className="flex items-center justify-center gap-3 mt-1">
              <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.1em" }}>PAR {par}</span>
              <span style={{ color: "var(--border)", fontSize: "0.7rem" }}>·</span>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.1em" }}>HCP {hcp}</span>
            </div>
          </div>

          <button onClick={() => holeNumber < 18 && handleGoToHole(holeNumber + 1)} disabled={holeNumber >= 18}
            className="flex h-10 w-10 items-center justify-center rounded-xl active:opacity-60 disabled:opacity-20"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>

        {/* GPS Yardage — the hero element */}
        <div className="mt-3 rounded-2xl px-4 py-6 text-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
            To Pin
          </div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: "5.5rem", lineHeight: 1, color: mounted && distYards !== null ? "#22c55e" : "#1f3d28", transition: "color 0.3s" }}>
            {mounted && distYards !== null ? distYards : "—"}
          </div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, fontSize: "1.1rem", color: "#166534", letterSpacing: "0.1em", marginTop: "-0.25rem" }}>
            YARDS
          </div>
          {mounted && position && (
            <div style={{ color: "#166534", fontSize: "0.65rem", marginTop: "0.5rem" }}>
              GPS ±{Math.round(position.accuracy)}m
            </div>
          )}
          {mounted && !position && !gpsError && (
            <div style={{ color: "#166534", fontSize: "0.75rem", marginTop: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}>
              <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e", animation: "pulse 1.5s infinite" }} />
              Acquiring GPS...
            </div>
          )}
        </div>

        {/* Score this hole */}
        <div className="mt-3 flex items-center justify-between rounded-2xl px-5 py-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
          <div>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.15em" }}>This Hole</div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "2.5rem", color: scoreColor, lineHeight: 1 }}>
              {strokesThisHole || "—"}
            </div>
          </div>
          {scoreLabel && (
            <div className="rounded-xl px-4 py-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "1.1rem", color: scoreColor, letterSpacing: "0.05em" }}>
                {scoreLabel}
              </div>
            </div>
          )}
          <button onClick={handleUndo} disabled={!round || round.events.filter(e=>e.hole===holeNumber).length === 0}
            className="h-10 rounded-xl px-3 text-xs font-semibold transition-opacity active:opacity-60 disabled:opacity-20"
            style={{ background: "var(--bg-elevated)", color: "#fca5a5", border: "1px solid #3f1a1a", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, letterSpacing: "0.05em" }}>
            UNDO
          </button>
        </div>

        {/* GPS error */}
        {gpsError && (
          <div className="mt-3 rounded-2xl p-4" style={{ background: "#1c1008", border: "1px solid #92400e" }}>
            <p style={{ color: "#fde68a", fontSize: "0.85rem" }}>{gpsError}</p>
            <button onClick={() => setRetryCount(c=>c+1)} className="mt-2 h-10 rounded-xl px-4 text-sm font-bold"
              style={{ background: "#92400e", color: "#fef3c7", fontFamily: "'Barlow Condensed',sans-serif" }}>
              Retry GPS
            </button>
          </div>
        )}
        {loadError && (
          <div className="mt-3 rounded-2xl p-4" style={{ background: "#1c0a0a", border: "1px solid #7f1d1d" }}>
            <p style={{ color: "#fca5a5", fontSize: "0.85rem" }}>{loadError}</p>
          </div>
        )}
      </div>

      {/* Log Shot — pinned to bottom */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-3" style={{ background: "linear-gradient(to top, var(--bg-primary) 70%, transparent)" }}>
        <div className="mx-auto max-w-md">
          <button onClick={handleLogShot} disabled={!mounted || !hole || !position}
            className="h-16 w-full rounded-2xl transition-transform active:scale-[0.98] disabled:opacity-30"
            style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.3rem", letterSpacing: "0.1em", textTransform: "uppercase", background: "#22c55e", color: "#052e16", boxShadow: "0 0 30px rgba(34,197,94,0.2)" }}>
            Log Shot Here
          </button>
        </div>
      </div>

      {/* Lie + Club modal */}
      {lieModalOpen && (
        <div className="fixed inset-0 z-20 flex items-end animate-fade-in" style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={e => { if (e.target === e.currentTarget) setLieModalOpen(false); }}>
          <div className="w-full animate-slide-up rounded-t-3xl p-5" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderBottom: "none" }}>
            <div className="mb-1 h-1 w-12 mx-auto rounded-full" style={{ background: "var(--border)" }} />
            <h2 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.4rem", color: "var(--text-primary)", letterSpacing: "0.05em", marginBottom: "1rem", marginTop: "0.5rem" }}>
              LOG SHOT
            </h2>

            {/* Lie selector */}
            <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "0.5rem" }}>Lie</p>
            <div className="grid grid-cols-4 gap-2 mb-5">
              {LIES.map(lie => (
                <button key={lie.value} onClick={() => setSelectedLie(lie.value)}
                  className="flex flex-col items-center justify-center rounded-2xl py-3 transition-all active:scale-95"
                  style={{
                    background: selectedLie === lie.value ? lie.color : "var(--bg-card)",
                    border: selectedLie === lie.value ? `1px solid ${lie.color}` : "1px solid var(--border)",
                    boxShadow: selectedLie === lie.value ? `0 0 12px ${lie.color}60` : "none",
                  }}>
                  <span style={{ fontSize: "1.4rem", marginBottom: "0.2rem" }}>{lie.icon}</span>
                  <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "0.75rem", color: selectedLie === lie.value ? "#fff" : "var(--text-secondary)", letterSpacing: "0.05em" }}>
                    {lie.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Club selector */}
            <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "0.5rem" }}>Club <span style={{ opacity: 0.4 }}>(optional)</span></p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-5">
              {CLUBS.map(club => (
                <button key={club} onClick={() => setSelectedClub(selectedClub === club ? null : club)}
                  className="shrink-0 rounded-xl px-3 py-2 transition-all active:scale-95"
                  style={{
                    fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, fontSize: "0.85rem",
                    background: selectedClub === club ? "#22c55e" : "var(--bg-card)",
                    color: selectedClub === club ? "#052e16" : "var(--text-secondary)",
                    border: selectedClub === club ? "1px solid #22c55e" : "1px solid var(--border)",
                    whiteSpace: "nowrap",
                  }}>
                  {club}
                </button>
              ))}
            </div>

            <button onClick={handleConfirmLog} disabled={!selectedLie}
              className="h-14 w-full rounded-2xl transition-transform active:scale-[0.98] disabled:opacity-30"
              style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.1rem", letterSpacing: "0.1em", background: "#22c55e", color: "#052e16" }}>
              LOG SHOT
            </button>
          </div>
        </div>
      )}

      {/* Putt modal */}
      {puttModalOpen && (
        <div className="fixed inset-0 z-30 flex items-end animate-fade-in" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="w-full animate-slide-up rounded-t-3xl p-5" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderBottom: "none" }}>
            <div className="mb-1 h-1 w-12 mx-auto rounded-full" style={{ background: "var(--border)" }} />
            <h2 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.4rem", color: "var(--text-primary)", marginBottom: "1.25rem", marginTop: "0.5rem" }}>
              ON THE GREEN
            </h2>

            <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "0.4rem" }}>First Putt Distance (paces)</p>
            <input
              inputMode="decimal" type="number" min="0" step="0.5"
              value={puttPaces} onChange={e => setPuttPaces(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-2xl font-bold outline-none"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "'Barlow Condensed',sans-serif" }}
              placeholder="0"
            />
            {puttPaces && Number(puttPaces) > 0 && (
              <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                ≈ {pacesToFeet(Number(puttPaces)).toFixed(1)} ft
              </p>
            )}

            <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", margin: "1rem 0 0.5rem" }}>Number of Putts</p>
            <div className="grid grid-cols-6 gap-2 mb-5">
              {[1,2,3,4,5,6].map(n => (
                <button key={n} onClick={() => setPuttCount(n)}
                  className="h-12 rounded-xl text-lg font-bold transition-all active:scale-95"
                  style={{
                    fontFamily: "'Barlow Condensed',sans-serif",
                    background: puttCount === n ? "#22c55e" : "var(--bg-card)",
                    color: puttCount === n ? "#052e16" : "var(--text-secondary)",
                    border: puttCount === n ? "1px solid #22c55e" : "1px solid var(--border)",
                  }}>
                  {n}
                </button>
              ))}
            </div>

            <button onClick={handleSavePutts}
              className="h-14 w-full rounded-2xl active:scale-[0.98]"
              style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.1rem", letterSpacing: "0.1em", background: "#22c55e", color: "#052e16" }}>
              SAVE PUTTING
            </button>
          </div>
        </div>
      )}
    </main>
  );
}