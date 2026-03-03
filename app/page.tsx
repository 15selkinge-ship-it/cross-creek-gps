"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCourse } from "@/lib/course";
import { clearStoredRound, getStoredRound, saveRound } from "@/lib/round-storage";
import { emptySGTotals, loadSGBaseline, recalculateRoundSG } from "@/lib/sg";
import type { Course, Round } from "@/lib/types";

function createRound(teeSetId: string): Round {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    started_at: now,
    updated_at: now,
    tee_set_id: teeSetId,
    current_hole: 1,
    events: [],
    sg_total: 0,
    sg_by_category: emptySGTotals(),
  };
}

export default function Home() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [round, setRound] = useState<Round | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const stored = getStoredRound();
    if (stored) {
      loadSGBaseline()
        .then((baseline) => {
          const withSg = recalculateRoundSG(stored, baseline);
          setRound(withSg);
          saveRound(withSg);
        })
        .catch(() => setRound(stored));
    } else {
      setRound(null);
    }
    fetchCourse().then(setCourse).catch(() => setError("Unable to load course data."));
  }, []);

  function handleStartRound() {
    const teeSetId = course?.tee_sets?.[0]?.id ?? "default";
    const nextRound = createRound(teeSetId);
    saveRound(nextRound);
    setRound(nextRound);
    router.push("/hole/1");
  }
  function handleResumeRound() {
    if (round) router.push(`/hole/${round.current_hole}`);
  }
  function handleRoundSummary() {
    if (round) router.push("/round-summary");
  }
  function handleExportRound() {
    if (!round) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(round, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "cross-creek-round.json" }).click();
    URL.revokeObjectURL(url);
  }
  function handleClearRound() {
    if (!window.confirm("Clear the current round?")) return;
    clearStoredRound();
    setRound(null);
  }

  const totalStrokes = round?.events.reduce((sum, e) => sum + e.stroke_value, 0) ?? 0;
  const holesPlayed = round ? new Set(round.events.map((e) => e.hole)).size : 0;

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      <div className="h-[3px] w-full" style={{ background: "var(--green-vivid)" }} />
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-12">
        <div className="mb-8 text-center">
          <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: "2.6rem", letterSpacing: "0.06em", color: "var(--text-primary)", lineHeight: 1 }}>
            CROSS CREEK
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.25em", textTransform: "uppercase" }}>
            Decatur, Indiana
          </p>
          {error && <p style={{ color: "#ef4444", fontSize: "0.8rem", marginTop: "0.5rem" }}>{error}</p>}
        </div>

        {mounted && round && (
          <div className="mb-6 rounded-2xl p-4" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[["Hole", round.current_hole], ["Strokes", totalStrokes], ["Holes", holesPlayed]].map(([label, val]) => (
                <div key={label as string}>
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "2rem", color: "var(--text-primary)", lineHeight: 1 }}>{val}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</div>
                </div>
              ))}
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.65rem", textAlign: "center", marginTop: "0.75rem", opacity: 0.8 }}>
              SG {round.sg_total !== undefined ? (round.sg_total >= 0 ? "+" : "") + round.sg_total.toFixed(2) : "n/a"}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button onClick={handleStartRound} className="h-16 w-full rounded-2xl" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: "1.25rem", letterSpacing: "0.1em", textTransform: "uppercase", background: "#22c55e", color: "#052e16" }}>
            {round ? "New Round" : "Start Round"}
          </button>
          <button onClick={handleResumeRound} disabled={!round} className="h-12 w-full rounded-xl disabled:opacity-30" style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
            Resume Round{round ? ` - Hole ${round.current_hole}` : ""}
          </button>
          <button onClick={handleRoundSummary} disabled={!round} className="h-12 w-full rounded-xl disabled:opacity-30" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            Round Summary
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={handleExportRound} disabled={!round} className="h-12 rounded-xl disabled:opacity-30" style={{ background: "var(--bg-card)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
              Export JSON
            </button>
            <button onClick={handleClearRound} disabled={!round} className="h-12 rounded-xl disabled:opacity-30" style={{ background: "var(--bg-card)", color: "#fca5a5", border: "1px solid #3f1a1a" }}>
              Clear Round
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
