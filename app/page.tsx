"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCourse } from "@/lib/course";
import { clearStoredRound, getStoredRound, saveRound } from "@/lib/round-storage";
import type { Course, Round } from "@/lib/types";

function createRound(teeSetId: string): Round {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), started_at: now, updated_at: now, tee_set_id: teeSetId, current_hole: 1, events: [] };
}

export default function Home() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [round, setRound] = useState<Round | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setRound(getStoredRound());
    fetchCourse().then(setCourse).catch(() => setError("Unable to load course data."));
  }, []);

  function handleStartRound() {
    const teeSetId = course?.tee_sets?.[0]?.id ?? "default";
    const r = createRound(teeSetId);
    saveRound(r); setRound(r); router.push("/hole/1");
  }
  function handleResumeRound() { if (round) router.push(`/hole/${round.current_hole}`); }
  function handleExportRound() {
    if (!round) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(round, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "cross-creek-round.json" }).click();
    URL.revokeObjectURL(url);
  }
  function handleClearRound() {
    if (window.confirm("Clear the current round?")) { clearStoredRound(); setRound(null); }
  }

  const totalStrokes = round?.events.reduce((s, e) => s + e.stroke_value, 0) ?? 0;
  const holesPlayed = round ? new Set(round.events.map(e => e.hole)).size : 0;

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      {/* Subtle grid texture */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{ backgroundImage: "repeating-linear-gradient(45deg,#22c55e 0px,#22c55e 1px,transparent 1px,transparent 14px)" }} />
      {/* Top accent */}
      <div className="h-[3px] w-full" style={{ background: "var(--green-vivid)" }} />

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-12">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mb-2 flex items-center justify-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <line x1="12" y1="4" x2="12" y2="21" stroke="#22c55e" strokeWidth="2" strokeLinecap="round"/>
              <path d="M12 4 L21 8.5 L12 13" fill="#22c55e"/>
              <ellipse cx="12" cy="21" rx="4" ry="1.5" fill="#22c55e" opacity="0.3"/>
            </svg>
            <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: "2.8rem", letterSpacing: "0.06em", color: "var(--text-primary)", lineHeight: 1 }}>
              CROSS CREEK
            </h1>
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.25em", textTransform: "uppercase" }}>
            Biggs-Kreigh · Decatur, Indiana
          </p>
          {error && <p style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "0.5rem" }}>{error}</p>}
        </div>

        {/* Active round status */}
        {mounted && round && (
          <div className="mb-6 animate-fade-in rounded-2xl p-4"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
              <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                Round In Progress
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[["Hole", round.current_hole], ["Strokes", totalStrokes], ["Holes", holesPlayed]].map(([label, val]) => (
                <div key={label as string}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "2rem", color: label === "Hole" ? "#22c55e" : "var(--text-primary)", lineHeight: 1 }}>{val}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
                </div>
              ))}
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.65rem", textAlign: "center", marginTop: "0.75rem", opacity: 0.5 }}>
              Started {new Date(round.started_at).toLocaleString()}
            </p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          <button onClick={handleStartRound}
            className="h-16 w-full rounded-2xl transition-transform active:scale-[0.98]"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "1.25rem", letterSpacing: "0.1em", textTransform: "uppercase", background: "#22c55e", color: "#052e16", boxShadow: "0 0 32px rgba(34,197,94,0.25)" }}>
            {round ? "New Round" : "Start Round"}
          </button>

          <button onClick={handleResumeRound} disabled={!round}
            className="h-14 w-full rounded-2xl transition-transform active:scale-[0.98] disabled:opacity-30"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "1.1rem", letterSpacing: "0.08em", textTransform: "uppercase", background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
            Resume Round{round ? ` — Hole ${round.current_hole}` : ""}
          </button>

          <div className="grid grid-cols-2 gap-3 mt-1">
            <button onClick={handleExportRound} disabled={!round}
              className="h-12 rounded-xl transition-transform active:scale-[0.97] disabled:opacity-30"
              style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "0.9rem", letterSpacing: "0.08em", textTransform: "uppercase", background: "var(--bg-card)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
              Export JSON
            </button>
            <button onClick={handleClearRound} disabled={!round}
              className="h-12 rounded-xl transition-transform active:scale-[0.97] disabled:opacity-30"
              style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: "0.9rem", letterSpacing: "0.08em", textTransform: "uppercase", background: "var(--bg-card)", color: "#fca5a5", border: "1px solid #3f1a1a" }}>
              Clear Round
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}