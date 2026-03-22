"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AccuracyPill from "@/components/AccuracyPill";
import ScorecardBar from "@/components/ScorecardBar";
import VoiceCaddiePanel from "@/components/VoiceCaddiePanel";
import { fetchCourse } from "@/lib/course";
import { isZeroCoordinate, pacesToFeet, safeDistanceYards } from "@/lib/geo";
import { getStoredRound, saveRound } from "@/lib/round-storage";
import { emptySGTotals, loadSGBaseline, recalculateRoundSG, type SGBaseline } from "@/lib/sg";
import { buildRoundStats, resolveParByHole } from "@/lib/stats";
import type {
  Coordinate, CourseGps, GreenEvent, HoleGps, LieType, Round,
  SGCategory, SGDebugInfo, ShotEvent, StartLieType, StrokeEvent,
} from "@/lib/types";

type PositionState = { lat: number; lng: number; accuracy: number };
const MAX_GPS_ACCURACY_METERS = 100;
const MAX_REASONABLE_DISTANCE_YARDS = 3000;
const HOLE_HCP = [17,13,7,3,11,5,15,1,9,8,10,4,6,2,16,12,14,18];
const CLUBS = ["Driver","3W","5W","4i","5i","6i","7i","8i","9i","PW","52","56","60","Putter"];
const LIES: Array<{ label: string; value: LieType; icon: string; color: string }> = [
  { label: "Fairway", value: "fairway", icon: "🌿", color: "#16a34a" },
  { label: "Rough",   value: "rough",   icon: "🌾", color: "#65a30d" },
  { label: "Sand",    value: "sand",    icon: "🏖️",  color: "#d97706" },
  { label: "Green",   value: "green",   icon: "🎯", color: "#0284c7" },
  { label: "Penalty", value: "penalty", icon: "⛔", color: "#dc2626" },
];
const SG_LABELS: Record<SGCategory, string> = {
  off_tee: "Off Tee", approach: "Approach", short_game: "Short",
  putting: "Putting", penalty: "Penalty",
};

type ScoreInfo = { label: string; color: string; bg: string; glow: string; emoji: string };

function getScoreInfo(strokes: number, par: number): ScoreInfo | null {
  if (!strokes) return null;
  const d = strokes - par;
  if (d <= -2) return { label: "Eagle!",  color: "#fde68a", bg: "#78350f", glow: "#f59e0b", emoji: "🦅" };
  if (d === -1) return { label: "Birdie",  color: "#86efac", bg: "#14532d", glow: "#22c55e", emoji: "🐦" };
  if (d ===  0) return { label: "Par",     color: "#86efac", bg: "#1a2a1e", glow: "#22c55e", emoji: "✓"  };
  if (d ===  1) return { label: "Bogey",   color: "#fdba74", bg: "#7c2d12", glow: "#f97316", emoji: ""   };
  if (d ===  2) return { label: "Double",  color: "#fca5a5", bg: "#7f1d1d", glow: "#ef4444", emoji: ""   };
  return           { label: `+${d}`,   color: "#fca5a5", bg: "#7f1d1d", glow: "#ef4444", emoji: "💀" };
}

type PendingShotDraft = {
  id: string; lat: number; lng: number;
  distance_from_prev_yd: number; start_distance_yds: number;
  end_distance_yds: number; start_lie: StartLieType;
};

function nowIso() { return new Date().toISOString(); }
function uid()    { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function formatSG(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`; }
function formatPct(v: number | null) { return v === null ? "--" : `${Math.round(v)}%`; }
function formatFlag(v: boolean | null) { return v === true ? "Yes" : v === false ? "No" : "--"; }
function findHole(c: CourseGps | null, n: number): HoleGps | null { return c?.holes[String(n)] ?? null; }
function isCoordinateInRange(c: Coordinate) { return Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180; }
function normalizeCoordinate(c: Coordinate): Coordinate | null {
  if (isCoordinateInRange(c)) return c;
  const s = { lat: c.lng, lng: c.lat };
  return isCoordinateInRange(s) ? s : null;
}
function formatDebugValue(v: string | number) { return typeof v === "number" ? v.toFixed(2) : v; }
function holeSG(r: Round | null, h: number) {
  return r?.events.filter(e => e.hole === h).reduce((s, e) => s + (e.sg ?? 0), 0) ?? 0;
}
function holePuttingSG(r: Round | null, h: number) {
  return r?.events.filter(e => e.hole === h && e.type === "green").reduce((s, e) => s + (e.sg ?? 0), 0) ?? 0;
}
function holeCategorySG(r: Round | null, h: number): Record<SGCategory, number> {
  const t = emptySGTotals();
  if (!r) return t;
  for (const e of r.events) { if (e.hole === h && e.sg_category) t[e.sg_category] += e.sg ?? 0; }
  return t;
}
function isGreenEvent(event: StrokeEvent): event is GreenEvent {
  return event.type === "green";
}

// ── Score celebration overlay ──────────────────────────────────────────────
function ScoreCelebration({ info, onDone }: { info: ScoreInfo; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, [onDone]);
  const isGood = ["Eagle!", "Birdie", "Par"].includes(info.label);
  return (
    <div onClick={onDone} style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: `radial-gradient(ellipse at center, ${info.glow}28 0%, rgba(0,0,0,0.88) 65%)`, animation: "cel-in 0.2s ease-out" }}>
      <div style={{ width: 200, height: 200, borderRadius: "50%", border: `2px solid ${info.glow}`, boxShadow: `0 0 50px ${info.glow}55, 0 0 100px ${info.glow}22`, background: info.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", animation: "cel-pop 0.45s cubic-bezier(0.34,1.56,0.64,1)" }}>
        {info.emoji && <div style={{ fontSize: "2.5rem", lineHeight: 1, marginBottom: 4 }}>{info.emoji}</div>}
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: info.label.length > 5 ? "1.9rem" : "2.6rem", color: info.color, letterSpacing: "0.04em", textTransform: "uppercase" }}>{info.label}</div>
      </div>
      {isGood && Array.from({ length: 18 }).map((_, i) => (
        <div key={i} style={{ position: "absolute", left: `${8 + Math.random() * 84}%`, top: `${8 + Math.random() * 84}%`, width: 7, height: 7, borderRadius: "50%", background: [info.glow, "#ffffff", info.color][i % 3], animation: `cel-p${(i % 4) + 1} ${0.85 + i * 0.03}s ease-out ${(i * 0.035).toFixed(2)}s both`, opacity: 0 }} />
      ))}
      <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.72rem", marginTop: "1.5rem" }}>tap to dismiss</p>
      <style>{`
        @keyframes cel-in  { from{opacity:0} to{opacity:1} }
        @keyframes cel-pop { 0%{transform:scale(.25);opacity:0} 65%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
        @keyframes cel-p1  { 0%{opacity:.9;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(-35px,-80px) scale(0)} }
        @keyframes cel-p2  { 0%{opacity:.9;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(30px,-90px) scale(0)} }
        @keyframes cel-p3  { 0%{opacity:.9;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(-20px,-70px) scale(0)} }
        @keyframes cel-p4  { 0%{opacity:.9;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(40px,-75px) scale(0)} }
      `}</style>
    </div>
  );
}

// ── Animated yardage display ───────────────────────────────────────────────
function YardageDisplay({ yards, mounted }: { yards: number | null; mounted: boolean }) {
  const [display, setDisplay] = useState<number | null>(null);
  const prevRef = useRef<number | null>(null);
  useEffect(() => {
    if (!mounted || yards === null) { setDisplay(null); return; }
    if (prevRef.current === null) {
      let cur = yards + 75;
      const iv = setInterval(() => {
        cur -= Math.ceil((cur - yards) * 0.28 + 1);
        setDisplay(Math.max(yards, cur));
        if (cur <= yards) { setDisplay(yards); clearInterval(iv); }
      }, 38);
      prevRef.current = yards;
      return () => clearInterval(iv);
    }
    prevRef.current = yards;
    setDisplay(yards);
  }, [yards, mounted]);
  return (
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: "5.5rem", lineHeight: 1, letterSpacing: "-0.02em", color: display !== null ? "#22c55e" : "#1f3d28", textShadow: display !== null ? "0 0 40px rgba(34,197,94,0.3)" : "none", transition: "color 0.4s" }}>
      {display !== null ? display : "—"}
    </div>
  );
}

export default function HolePage() {
  const params = useParams<{ n: string }>();
  const router = useRouter();
  const holeNumber = Number(params.n);

  const [mounted, setMounted]               = useState(false);
  const [geoSupported, setGeoSupported]     = useState(false);
  const [course, setCourse]                 = useState<CourseGps | null>(null);
  const [round, setRound]                   = useState<Round | null>(null);
  const [sgBaseline, setSgBaseline]         = useState<SGBaseline | null>(null);
  const [position, setPosition]             = useState<PositionState | null>(null);
  const [gpsError, setGpsError]             = useState<string | null>(null);
  const [gpsPermissionDenied, setGpsDenied] = useState(false);
  const [retryCount, setRetryCount]         = useState(0);
  const [loadError, setLoadError]           = useState<string | null>(null);
  const [lieModalOpen, setLieModalOpen]     = useState(false);
  const [puttModalOpen, setPuttModalOpen]   = useState(false);
  const [pendingShotDraft, setPending]      = useState<PendingShotDraft | null>(null);
  const [selectedLie, setSelectedLie]       = useState<LieType | null>(null);
  const [selectedClub, setSelectedClub]     = useState<string | null>(null);
  const [puttPaces, setPuttPaces]           = useState("");
  const [puttCount, setPuttCount]           = useState(2);
  const [celebration, setCelebration]       = useState<ScoreInfo | null>(null);
  const [prevHasGreen, setPrevHasGreen]     = useState(false);
  const [slideOut, setSlideOut]             = useState<"left"|"right"|null>(null);
  const [logPulse, setLogPulse]             = useState(false);

  const isValid = Number.isInteger(holeNumber) && holeNumber >= 1 && holeNumber <= 18;
  const hole      = useMemo(() => findHole(course, holeNumber), [course, holeNumber]);
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
      pos => { setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); setGpsDenied(false); setGpsError(null); },
      err => { const d = err.code === err.PERMISSION_DENIED; setGpsDenied(d); setGpsError(d ? "Location permission denied." : "Could not get location. Tap retry."); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [geoSupported, hole, isValid, retryCount]);

  useEffect(() => {
    if (!round || !sgBaseline) return;
    if (round.sg_baseline_version === sgBaseline.version && round.sg_total !== undefined) return;
    const w = recalculateRoundSG(round, sgBaseline, parByHole);
    setRound(w); saveRound(w);
  }, [round, sgBaseline, parByHole]);

  useEffect(() => {
    if (!round?.ended_at) return;
    setLieModalOpen(false); setPuttModalOpen(false); setPending(null);
  }, [round?.ended_at]);

  const strokesThisHole = round?.events.filter(e => e.hole === holeNumber).reduce((s, e) => s + e.stroke_value, 0) ?? 0;
  const hasGreenEvent   = Boolean(round?.events.some(e => e.hole === holeNumber && e.type === "green"));

  // Fire celebration when green event first appears
  useEffect(() => {
    if (hasGreenEvent && !prevHasGreen && strokesThisHole > 0) {
      const info = getScoreInfo(strokesThisHole, par);
      if (info) setTimeout(() => setCelebration(info), 350);
    }
    setPrevHasGreen(hasGreenEvent);
  }, [hasGreenEvent, strokesThisHole, par, prevHasGreen]);

  function updateRound(r: Round) {
    const stamped = { ...r, updated_at: nowIso() };
    const withSG  = sgBaseline ? recalculateRoundSG(stamped, sgBaseline, parByHole) : stamped;
    setRound(withSG); saveRound(withSG);
  }
  function ensureRound(): Round | null {
    if (round) return round;
    if (!course) return null;
    const r: Round = { id: uid(), started_at: nowIso(), updated_at: nowIso(), tee_set_id: "default", current_hole: holeNumber, events: [], sg_total: 0, sg_by_category: emptySGTotals() };
    updateRound(r); return r;
  }
  function lastShotOnHole(r: Round): ShotEvent | null {
    return ([...r.events].reverse().find(e => e.hole === holeNumber && e.type === "shot") as ShotEvent | undefined) ?? null;
  }
  function startLieForShot(r: Round): StartLieType {
    const l = lastShotOnHole(r);
    if (!l?.end_lie) return "tee";
    return l.end_lie === "penalty" ? "fairway" : l.end_lie;
  }
  function startCoordinateForShot(r: Round, fallback: Coordinate): Coordinate {
    const l = lastShotOnHole(r);
    if (l && Number.isFinite(l.lat) && Number.isFinite(l.lng)) {
      const n = normalizeCoordinate({ lat: l.lat, lng: l.lng });
      if (n && !isZeroCoordinate(n)) return n;
    }
    const tee = hole?.tee ? normalizeCoordinate(hole.tee) : null;
    return (tee && !isZeroCoordinate(tee)) ? tee : fallback;
  }

  function handleLogShot() {
    if (round?.ended_at) return;
    if (!hole || !position) return setGpsError("Waiting for GPS fix...");
    if (position.accuracy > MAX_GPS_ACCURACY_METERS) return setGpsError("Waiting for accurate GPS fix...");
    const cur = normalizeCoordinate({ lat: position.lat, lng: position.lng });
    if (!cur || isZeroCoordinate(cur)) return setGpsError("Waiting for accurate GPS fix...");
    const gc = normalizeCoordinate(hole.greenCenter);
    if (!gc || isZeroCoordinate(gc)) return setGpsError("Green center is invalid for this hole.");
    if (!sgBaseline) return setLoadError("SG baseline is still loading. Try again in a moment.");
    const ar = ensureRound(); if (!ar) return;
    const startCoord = startCoordinateForShot(ar, cur);
    const clamp = (v: number | null, lbl: string): number | null => {
      if (v === null) return null;
      if (v > MAX_REASONABLE_DISTANCE_YARDS) { console.warn(`[gps] Unrealistic ${lbl}: ${v.toFixed(1)} yards on hole ${holeNumber}.`); return null; }
      return Math.max(0, v);
    };
    const dfp = clamp(safeDistanceYards(startCoord, cur), "shot distance from previous");
    const sd  = clamp(safeDistanceYards(startCoord, gc),  "start distance");
    const ed  = clamp(safeDistanceYards(cur, gc),         "end distance");
    if (dfp === null || sd === null || ed === null) return setGpsError("Shot could not be logged due to invalid GPS distance.");
    setLogPulse(true); setTimeout(() => setLogPulse(false), 350);
    setPending({ id: uid(), lat: cur.lat, lng: cur.lng, distance_from_prev_yd: dfp, start_distance_yds: sd, end_distance_yds: ed, start_lie: startLieForShot(ar) });
    setSelectedLie(null); setSelectedClub(null); setLieModalOpen(true);
  }

  function handleConfirmLog() {
    if (round?.ended_at || !round || !pendingShotDraft || !selectedLie) return;
    const shotEvent: ShotEvent = {
      id: pendingShotDraft.id, hole: holeNumber, type: "shot", stroke_value: 1, timestamp: nowIso(),
      lat: pendingShotDraft.lat, lng: pendingShotDraft.lng,
      distance_from_prev_yd: pendingShotDraft.distance_from_prev_yd,
      start_distance_yds: pendingShotDraft.start_distance_yds,
      end_distance_yds: pendingShotDraft.end_distance_yds,
      start_lie: pendingShotDraft.start_lie, end_lie: selectedLie,
      notes: selectedClub ?? undefined,
    };
    const withLie = { ...round, current_hole: holeNumber, events: [...round.events, shotEvent] };
    updateRound(withLie);
    if (selectedLie === "penalty") {
      updateRound({ ...withLie, events: [...withLie.events, { id: uid(), hole: holeNumber, type: "penalty", stroke_value: 1, timestamp: nowIso(), notes: "Penalty stroke" }] });
      setLieModalOpen(false); setPending(null); return;
    }
    setLieModalOpen(false);
    if (selectedLie === "green") { setPuttPaces(""); setPuttCount(2); setPuttModalOpen(true); return; }
    setPending(null);
  }

  function handleSavePutts() {
    if (round?.ended_at) return setPuttModalOpen(false);
    if (!round || !pendingShotDraft) return setPuttModalOpen(false);
    const paces = Number(puttPaces);
    if (!Number.isFinite(paces) || paces < 0) return;
    const startFt = pacesToFeet(paces);
    const puttEvent = {
      id: uid(),
      type: "green" as const,
      hole: holeNumber,
      start_putt_distance_ft: startFt,
      start_putt_distance_paces: paces,
      first_putt_paces: paces,
      first_putt_ft: startFt,
      putts: puttCount,
      stroke_value: puttCount,
      timestamp: nowIso(),
      ...(position ? { gps_lat: position.lat, gps_lng: position.lng } : {}),
    };
    updateRound({ ...round, events: [...round.events, puttEvent] });
    setPuttModalOpen(false); setPending(null);
  }

  function handleUndo() {
    if (round?.ended_at || !round || !round.events.length) return;
    updateRound({ ...round, current_hole: holeNumber, events: round.events.slice(0, -1) });
    setLieModalOpen(false); setPuttModalOpen(false); setPending(null);
  }

  function handleGoToHole(n: number) {
    setSlideOut(n > holeNumber ? "left" : "right");
    setTimeout(() => { if (round) updateRound({ ...round, current_hole: n }); router.push(`/hole/${n}`); }, 200);
  }

  function handleEndRound() {
    const ar = ensureRound(); if (!ar) return;
    updateRound({ ...ar, ended_at: nowIso(), current_hole: holeNumber });
    router.push("/round");
  }

  function handleResumeEdit() {
    if (!round) return;
    updateRound({ ...round, ended_at: undefined, current_hole: holeNumber });
  }

  const currentCoord  = position ? normalizeCoordinate({ lat: position.lat, lng: position.lng }) : null;
  const greenCenter   = hole?.greenCenter ? normalizeCoordinate(hole.greenCenter) : null;
  const isAccurateFix = Boolean(position && position.accuracy <= MAX_GPS_ACCURACY_METERS);
  const hasValidCur   = Boolean(currentCoord && !isZeroCoordinate(currentCoord));
  const hasValidGC    = Boolean(greenCenter && !isZeroCoordinate(greenCenter));
  const rawDistYards  = currentCoord && greenCenter && isAccurateFix ? safeDistanceYards(currentCoord, greenCenter) : null;
  const isUnrealistic = rawDistYards !== null && rawDistYards > MAX_REASONABLE_DISTANCE_YARDS;
  const distYards     = mounted && isAccurateFix && hasValidCur && hasValidGC && rawDistYards !== null && !isUnrealistic ? Math.round(rawDistYards) : null;
  const waitingFix    = mounted && (!isAccurateFix || !hasValidCur);
  const sgTotal       = round?.sg_total ?? 0;
  const sgThisHole    = holeSG(round, holeNumber);
  const sgPuttingHole = holePuttingSG(round, holeNumber);
  const sgRoundByCat  = round?.sg_by_category ?? emptySGTotals();
  const sgHoleByCat   = holeCategorySG(round, holeNumber);
  const roundStats    = useMemo(() => buildRoundStats(round, course), [round, course]);
  const holeStats     = roundStats.holes[holeNumber - 1];
  const isRoundEnded  = Boolean(round?.ended_at);
  const noGps         = !geoSupported || gpsPermissionDenied;
  const showGpsDebug  = process.env.NEXT_PUBLIC_DEBUG_GPS === "1";
  const showSgDebug   = process.env.NEXT_PUBLIC_DEBUG_SG === "1";
  const holeEvents    = round?.events.filter(e => e.hole === holeNumber) ?? [];
  const sgDebugRows   = holeEvents.filter(e => e.sg_debug).map((e, i) => ({ index: i + 1, category: e.sg_category ?? "-", debug: e.sg_debug as SGDebugInfo }));
  const puttingDebugLines = holeEvents
    .filter((event): event is GreenEvent => isGreenEvent(event) && Boolean(event.sg_debug))
    .map((event, i) => {
      const usedDistanceFt = Number.isFinite(event.start_putt_distance_ft) ? event.start_putt_distance_ft : event.first_putt_ft;
      return {
        id: `${event.id}-${i}`,
        usedDistanceFt,
        expectedStrokes: event.sg_debug?.e_start ?? 0,
        putts: event.putts,
        sgPutt: event.sg ?? 0,
      };
    });
  const scoreInfo     = getScoreInfo(strokesThisHole, par);
  const canLog        = !isRoundEnded && mounted && !!hole && !!position && !!sgBaseline && isAccurateFix && hasValidCur && hasValidGC;

  useEffect(() => {
    if (isUnrealistic && rawDistYards !== null) console.warn(`[gps] Unrealistic distance to green center: ${rawDistYards.toFixed(1)} yards on hole ${holeNumber}.`);
  }, [holeNumber, isUnrealistic, rawDistYards]);

  if (!isValid) return <main style={{ background: "var(--bg-primary)", minHeight: "100vh", padding: "2rem" }}><p style={{ color: "var(--text-primary)" }}>Invalid hole number.</p></main>;

  const scoreBg     = scoreInfo ? scoreInfo.bg    : "var(--bg-card)";
  const scoreBorder = scoreInfo ? `${scoreInfo.glow}50` : "var(--border)";
  const scoreGlow   = scoreInfo ? `0 0 24px ${scoreInfo.glow}20` : "none";

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg-primary)", paddingBottom: "9rem" }}>

      {celebration && <ScoreCelebration info={celebration} onDone={() => setCelebration(null)} />}

      <ScorecardBar round={round} currentHole={holeNumber} course={course} />

      {/* slide transition wrapper */}
      <div style={{ transform: slideOut ? `translateX(${slideOut === "left" ? "-56px" : "56px"})` : "translateX(0)", opacity: slideOut ? 0 : 1, transition: slideOut ? "transform 0.2s ease-in, opacity 0.2s ease-in" : "none" }}>
        <div className="mx-auto max-w-md px-4 pt-4" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>

          {/* hole header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: "12px 16px" }}>
            <button onClick={() => holeNumber > 1 && handleGoToHole(holeNumber - 1)} disabled={holeNumber <= 1}
              style={{ width: 40, height: 40, borderRadius: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: holeNumber > 1 ? "pointer" : "default", opacity: holeNumber <= 1 ? 0.2 : 1, transition: "opacity 0.2s" }}>
              <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 900, fontSize: "2.2rem", color: "var(--text-primary)", lineHeight: 1 }}>HOLE {holeNumber}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 4 }}>
                <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.1em" }}>PAR {par}</span>
                <span style={{ color: "var(--border)" }}>·</span>
                <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.1em" }}>HCP {hcp}</span>
              </div>
            </div>
            <button onClick={() => holeNumber < 18 && handleGoToHole(holeNumber + 1)} disabled={holeNumber >= 18}
              style={{ width: 40, height: 40, borderRadius: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: holeNumber < 18 ? "pointer" : "default", opacity: holeNumber >= 18 ? 0.2 : 1, transition: "opacity 0.2s" }}>
              <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

          {/* GPS yardage hero */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 4 }}>To Pin</div>
            <YardageDisplay yards={distYards} mounted={mounted} />
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, fontSize: "1.1rem", color: "#166534", letterSpacing: "0.1em", marginTop: -4 }}>YARDS</div>
            <div style={{ marginTop: 8 }}><AccuracyPill accuracyM={position?.accuracy ?? null} noGps={noGps} /></div>
            {waitingFix && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8, color: "#166534", fontSize: "0.75rem" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "gps-blink 1.4s ease-in-out infinite" }} />
                Acquiring GPS...
              </div>
            )}
            {!waitingFix && !hasValidGC && <div style={{ color: "#166534", fontSize: "0.75rem", marginTop: 8 }}>Green center coordinates unavailable.</div>}
          </div>

          {/* AI voice caddie */}
          <VoiceCaddiePanel
            currentHole={holeNumber}
            par={par}
            strokesThisHole={strokesThisHole}
            sgTotal={sgTotal}
            roundEvents={round?.events ?? []}
            gpsDistanceYards={distYards}
          />

          {/* score this hole */}
          <div style={{ background: scoreBg, border: `1px solid ${scoreBorder}`, boxShadow: scoreGlow, borderRadius: 16, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", transition: "background 0.5s, border-color 0.5s, box-shadow 0.5s" }}>
            <div>
              <div style={{ color: "var(--text-secondary)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.15em" }}>This Hole</div>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "3rem", color: scoreInfo ? scoreInfo.color : "var(--text-primary)", lineHeight: 1, transition: "color 0.4s" }}>
                {strokesThisHole || "—"}
              </div>
            </div>
            {scoreInfo && strokesThisHole > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 12, background: "rgba(0,0,0,0.3)", animation: "cel-in 0.3s ease-out" }}>
                {scoreInfo.emoji && <span style={{ fontSize: "1rem" }}>{scoreInfo.emoji}</span>}
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "1.05rem", color: scoreInfo.color, letterSpacing: "0.04em" }}>{scoreInfo.label}</div>
              </div>
            )}
            <button onClick={handleUndo} disabled={!round || isRoundEnded || holeEvents.length === 0}
              style={{ height: 40, padding: "0 12px", borderRadius: 10, background: "rgba(0,0,0,0.3)", color: "#fca5a5", border: "1px solid #3f1a1a", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, fontSize: "0.85rem", letterSpacing: "0.05em", opacity: (!round || isRoundEnded || holeEvents.length === 0) ? 0.25 : 1, cursor: "pointer" }}>
              UNDO
            </button>
          </div>

          {isRoundEnded && (
            <div style={{ background: "#1c1008", border: "1px solid #92400e", borderRadius: 16, padding: "12px 16px", textAlign: "center" }}>
              <p style={{ color: "#fde68a", fontSize: "0.85rem", fontWeight: 600, margin: 0 }}>Round ended.</p>
              <button onClick={handleResumeEdit} style={{ marginTop: 8, height: 36, padding: "0 16px", borderRadius: 10, background: "#92400e", color: "#fef3c7", border: "none", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}>
                Resume / Edit
              </button>
            </div>
          )}

          {/* SG summary */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 16 }}>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 10 }}>Strokes Gained</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              {([["Round", sgTotal], ["This Hole", sgThisHole], ["Putting", sgPuttingHole]] as [string,number][]).map(([lbl, val]) => (
                <div key={lbl} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 6px", textAlign: "center" }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "1.1rem", color: val >= 0 ? "#22c55e" : "#fca5a5" }}>{formatSG(val)}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>{lbl}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4 }}>
              {Object.entries(SG_LABELS).map(([k, lbl]) => (
                <div key={k} style={{ background: "var(--bg-elevated)", borderRadius: 8, padding: "6px 2px", textAlign: "center" }}>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "0.85rem", color: (sgRoundByCat[k as SGCategory] ?? 0) >= 0 ? "#22c55e" : "#fca5a5" }}>{formatSG(sgRoundByCat[k as SGCategory] ?? 0)}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.52rem", textTransform: "uppercase" }}>{lbl}</div>
                </div>
              ))}
            </div>
          </div>

          {/* round dashboard */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 16 }}>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: 10 }}>Round Stats</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
              {([
                ["FIR",   holeStats ? formatFlag(holeStats.fir)       : "—", formatPct(roundStats.fir.pct)],
                ["GIR",   holeStats ? formatFlag(holeStats.gir)       : "—", formatPct(roundStats.gir.pct)],
                ["U&D",   holeStats ? formatFlag(holeStats.upAndDown) : "—", formatPct(roundStats.upAndDown.pct)],
                ["Putts", String(holeStats?.putts ?? 0),                     roundStats.puttsAvg === null ? "--" : `${roundStats.puttsAvg.toFixed(1)} avg`],
              ] as [string,string,string][]).map(([lbl, hVal, rVal]) => (
                <div key={lbl} style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12, padding: "8px 4px", textAlign: "center" }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>{lbl}</div>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "1.1rem", color: "var(--text-primary)" }}>{hVal}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.58rem", opacity: 0.6 }}>{rVal}</div>
                </div>
              ))}
            </div>
          </div>

          {/* GPS debug */}
          {showGpsDebug && (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, fontSize: "0.72rem", fontFamily: "monospace", color: "var(--text-secondary)" }}>
              <div>GPS Lat: {position ? position.lat.toFixed(6) : "--"}</div>
              <div>GPS Lng: {position ? position.lng.toFixed(6) : "--"}</div>
              <div>GPS Accuracy (m): {position ? position.accuracy.toFixed(1) : "--"}</div>
              <div>Green Center Lat: {greenCenter ? greenCenter.lat.toFixed(6) : "--"}</div>
              <div>Green Center Lng: {greenCenter ? greenCenter.lng.toFixed(6) : "--"}</div>
              <div>Computed Distance (yd): {distYards !== null ? distYards : "--"}</div>
            </div>
          )}

          {/* SG debug */}
          {showSgDebug && (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>SG Debug — Hole Total: {formatSG(sgThisHole)}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, marginBottom: 10 }}>
                {Object.entries(SG_LABELS).map(([k, l]) => <div key={`sd-${k}`}>{l}: {formatSG(sgHoleByCat[k as SGCategory] ?? 0)}</div>)}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{["#","Cat","Start","End","E(start)","E(end)","SG"].map(h => <th key={h} style={{ border: "1px solid var(--border)", padding: "4px 6px", textAlign: "left" }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {sgDebugRows.map(r => (
                      <tr key={`sr-${r.index}`}>
                        {[r.index, r.category, `${r.debug.start_lie} ${formatDebugValue(r.debug.start_distance)} ${r.debug.start_unit}`, `${r.debug.end_lie} ${formatDebugValue(r.debug.end_distance)} ${r.debug.end_unit}`, formatDebugValue(r.debug.e_start), formatDebugValue(r.debug.e_end), formatSG(r.debug.sg_shot)].map((cell, ci) => (
                          <td key={ci} style={{ border: "1px solid var(--border)", padding: "4px 6px" }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                    {!sgDebugRows.length && <tr><td colSpan={7} style={{ border: "1px solid var(--border)", padding: "4px 6px" }}>No SG events on this hole.</td></tr>}
                  </tbody>
                </table>
              </div>
              {!!puttingDebugLines.length && (
                <div style={{ marginTop: 10, fontFamily: "monospace" }}>
                  {puttingDebugLines.map((line, i) => (
                    <div key={line.id}>
                      PUTT#{i + 1}: used distance_ft={formatDebugValue(line.usedDistanceFt)}, expected strokes={formatDebugValue(line.expectedStrokes)}, putts={line.putts}, SG_putt={formatSG(line.sgPutt)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* errors */}
          {gpsError && (
            <div style={{ background: "#1c1008", border: "1px solid #92400e", borderRadius: 16, padding: 16 }}>
              <p style={{ color: "#fde68a", fontSize: "0.85rem", margin: 0 }}>{gpsError}</p>
              <button onClick={() => { setGpsDenied(false); setGpsError(null); setRetryCount(c => c + 1); }}
                style={{ marginTop: 8, height: 36, padding: "0 16px", borderRadius: 10, background: "#92400e", color: "#fef3c7", border: "none", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, cursor: "pointer" }}>
                Retry GPS
              </button>
            </div>
          )}
          {loadError && (
            <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 16, padding: "12px 16px" }}>
              <p style={{ color: "#fca5a5", fontSize: "0.85rem", margin: 0 }}>{loadError}</p>
            </div>
          )}
        </div>
      </div>

      {/* bottom bar */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "12px 16px 24px", background: "linear-gradient(to top, var(--bg-primary) 65%, transparent)" }}>
        <div className="mx-auto max-w-md" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={() => router.push("/round")}
              style={{ height: 40, borderRadius: 12, background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, fontSize: "0.85rem", letterSpacing: "0.05em", cursor: "pointer" }}>
              Round Summary
            </button>
            {isRoundEnded ? (
              <button onClick={handleResumeEdit}
                style={{ height: 40, borderRadius: 12, background: "var(--bg-elevated)", color: "#22c55e", border: "1px solid #22c55e40", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}>
                Resume/Edit Round
              </button>
            ) : (
              <button onClick={handleEndRound}
                style={{ height: 40, borderRadius: 12, background: "var(--bg-elevated)", color: "#fca5a5", border: "1px solid #3f1a1a", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer" }}>
                End Round
              </button>
            )}
          </div>
          <button onClick={handleLogShot} disabled={!canLog}
            style={{
              height: 64, width: "100%", borderRadius: 20, border: "none",
              fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.3rem", letterSpacing: "0.1em", textTransform: "uppercase",
              background: canLog ? "#22c55e" : "#1a2a1e",
              color: canLog ? "#052e16" : "#1f3d28",
              cursor: canLog ? "pointer" : "not-allowed",
              boxShadow: logPulse ? "0 0 0 10px rgba(34,197,94,0.15), 0 0 30px rgba(34,197,94,0.3)" : canLog ? "0 0 24px rgba(34,197,94,0.2)" : "none",
              transform: logPulse ? "scale(0.97)" : "scale(1)",
              transition: "box-shadow 0.3s, transform 0.15s, background 0.3s, color 0.3s",
            }}>
            Log Shot Here
          </button>
        </div>
      </div>

      {/* lie modal */}
      {lieModalOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) { setLieModalOpen(false); setPending(null); } }}
          style={{ position: "fixed", inset: 0, zIndex: 20, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.78)", animation: "cel-in 0.18s ease-out" }}>
          <div style={{ width: "100%", background: "var(--bg-elevated)", borderTop: "1px solid var(--border)", borderRadius: "24px 24px 0 0", padding: "20px 20px 32px", animation: "modal-up 0.28s cubic-bezier(0.32,0.72,0,1)" }}>
            <div style={{ width: 48, height: 4, borderRadius: 2, background: "var(--border)", margin: "0 auto 16px" }} />
            <h2 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.4rem", color: "var(--text-primary)", letterSpacing: "0.04em", margin: "0 0 4px" }}>LOG SHOT</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", margin: "0 0 12px" }}>Where did it land?</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, marginBottom: 20 }}>
              {LIES.map(lie => (
                <button key={lie.value} onClick={() => setSelectedLie(lie.value)} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "10px 4px", borderRadius: 16, cursor: "pointer", background: selectedLie === lie.value ? lie.color : "var(--bg-card)", border: `1px solid ${selectedLie === lie.value ? lie.color : "var(--border)"}`, boxShadow: selectedLie === lie.value ? `0 0 12px ${lie.color}60` : "none", transition: "all 0.15s" }}>
                  <span style={{ fontSize: "1.3rem", marginBottom: 3 }}>{lie.icon}</span>
                  <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "0.62rem", color: selectedLie === lie.value ? "#fff" : "var(--text-secondary)", letterSpacing: "0.04em" }}>{lie.label}</span>
                </button>
              ))}
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", margin: "0 0 8px" }}>Club <span style={{ opacity: 0.4 }}>(optional)</span></p>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 20 }} className="no-scrollbar">
              {CLUBS.map(club => (
                <button key={club} onClick={() => setSelectedClub(selectedClub === club ? null : club)} style={{ flexShrink: 0, padding: "8px 12px", borderRadius: 12, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 600, fontSize: "0.85rem", background: selectedClub === club ? "#22c55e" : "var(--bg-card)", color: selectedClub === club ? "#052e16" : "var(--text-secondary)", border: `1px solid ${selectedClub === club ? "#22c55e" : "var(--border)"}`, whiteSpace: "nowrap", cursor: "pointer", transition: "all 0.15s" }}>{club}</button>
              ))}
            </div>
            <button onClick={handleConfirmLog} disabled={isRoundEnded || !selectedLie} style={{ height: 56, width: "100%", borderRadius: 16, border: "none", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.1rem", letterSpacing: "0.1em", background: selectedLie ? "#22c55e" : "#1a2a1e", color: selectedLie ? "#052e16" : "#1f3d28", opacity: isRoundEnded ? 0.3 : 1, cursor: selectedLie ? "pointer" : "not-allowed", transition: "background 0.2s, color 0.2s" }}>LOG SHOT</button>
          </div>
        </div>
      )}

      {/* putt modal */}
      {puttModalOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 30, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.78)", animation: "cel-in 0.18s ease-out" }}>
          <div style={{ width: "100%", background: "var(--bg-elevated)", borderTop: "1px solid var(--border)", borderRadius: "24px 24px 0 0", padding: "20px 20px 32px", animation: "modal-up 0.28s cubic-bezier(0.32,0.72,0,1)" }}>
            <div style={{ width: 48, height: 4, borderRadius: 2, background: "var(--border)", margin: "0 auto 16px" }} />
            <h2 style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.4rem", color: "var(--text-primary)", margin: "0 0 16px" }}>🎯 ON THE GREEN</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", margin: "0 0 6px" }}>First putt distance (paces)</p>
            <input inputMode="decimal" type="number" min="0" step="0.5" value={puttPaces} onChange={e => setPuttPaces(e.target.value)} placeholder="0"
              style={{ width: "100%", padding: "12px 16px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontFamily: "'Barlow Condensed',sans-serif", fontSize: "1.6rem", fontWeight: 700, outline: "none", boxSizing: "border-box" }} />
            {puttPaces && Number(puttPaces) > 0 && <p style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginTop: 4 }}>≈ {pacesToFeet(Number(puttPaces)).toFixed(1)} ft</p>}
            <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.15em", margin: "16px 0 8px" }}>Number of putts</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, marginBottom: 20 }}>
              {[0,1,2,3,4,5,6].map(n => (
                <button key={n} onClick={() => setPuttCount(n)} style={{ height: 48, borderRadius: 12, fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "1.2rem", background: puttCount === n ? "#22c55e" : "var(--bg-card)", color: puttCount === n ? "#052e16" : "var(--text-secondary)", border: `1px solid ${puttCount === n ? "#22c55e" : "var(--border)"}`, cursor: "pointer", transition: "all 0.15s" }}>{n}</button>
              ))}
            </div>
            <button onClick={handleSavePutts} disabled={isRoundEnded} style={{ height: 56, width: "100%", borderRadius: 16, border: "none", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1.1rem", letterSpacing: "0.1em", background: "#22c55e", color: "#052e16", opacity: isRoundEnded ? 0.3 : 1, cursor: "pointer" }}>SAVE PUTTING</button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes gps-blink { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes modal-up  { from{transform:translateY(100%)} to{transform:translateY(0)} }
        @keyframes cel-in    { from{opacity:0} to{opacity:1} }
        @keyframes cel-pop   { 0%{transform:scale(.25);opacity:0} 65%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
        @keyframes cel-p1    { 0%{opacity:.9;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(-35px,-80px) scale(0)} }
        @keyframes cel-p2    { 0%{opacity:.9;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(30px,-90px) scale(0)} }
        @keyframes cel-p3    { 0%{opacity:.9;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(-20px,-70px) scale(0)} }
        @keyframes cel-p4    { 0%{opacity:.9;transform:translate(0,0) scale(1)} 100%{opacity:0;transform:translate(40px,-75px) scale(0)} }
      `}</style>
    </main>
  );
}
