"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getStoredRound } from "@/lib/round-storage";
import { emptySGTotals, loadSGBaseline, recalculateRoundSG } from "@/lib/sg";
import type { Round, SGCategory } from "@/lib/types";

const SG_LABELS: Record<SGCategory, string> = {
  off_tee: "Off Tee",
  approach: "Approach",
  short_game: "Short Game",
  putting: "Putting",
  penalty: "Penalty",
};

function formatSG(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export default function RoundSummaryPage() {
  const [round, setRound] = useState<Round | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredRound();
    if (!stored) {
      setRound(null);
      return;
    }
    loadSGBaseline()
      .then((baseline) => setRound(recalculateRoundSG(stored, baseline)))
      .catch(() => {
        setRound(stored);
        setError("Unable to load SG baseline.");
      });
  }, []);

  const holes = useMemo(() => {
    if (!round) return [];
    return Array.from({ length: 18 }, (_, i) => i + 1).map((hole) => {
      const events = round.events.filter((e) => e.hole === hole);
      return {
        hole,
        strokes: events.reduce((sum, e) => sum + e.stroke_value, 0),
        sg: events.reduce((sum, e) => sum + (e.sg ?? 0), 0),
        puttingSg: events.filter((e) => e.type === "green").reduce((sum, e) => sum + (e.sg ?? 0), 0),
      };
    });
  }, [round]);

  const totalStrokes = holes.reduce((sum, h) => sum + h.strokes, 0);
  const totalSg = round?.sg_total ?? 0;
  const categoryTotals = round?.sg_by_category ?? emptySGTotals();

  if (!round) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-bold">Round Summary</h1>
        <p className="mt-2">No round found.</p>
        <Link className="mt-4 inline-block underline" href="/">Back Home</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-4 pb-8">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">Round Summary</h1>
        <Link className="underline" href={`/hole/${round.current_hole}`}>Back to Hole {round.current_hole}</Link>
      </div>
      {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

      <div className="mb-3 rounded border p-3">
        <div>Total Strokes: {totalStrokes}</div>
        <div>Total SG: {formatSG(totalSg)}</div>
        <div className="text-xs opacity-80">Baseline: {round.sg_baseline_version ?? "n/a"}</div>
      </div>

      <div className="mb-3 rounded border p-3">
        <div className="mb-2 font-semibold">SG by Category</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {Object.entries(SG_LABELS).map(([key, label]) => (
            <div key={key}>
              {label}: {formatSG(categoryTotals[key as SGCategory] ?? 0)}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border p-3">
        <div className="mb-2 font-semibold">Hole-by-Hole</div>
        <div className="space-y-1 text-sm">
          {holes.map((h) => (
            <div key={h.hole} className="grid grid-cols-4 gap-2 border-b py-1 last:border-b-0">
              <div>H{h.hole}</div>
              <div>Stk {h.strokes || "-"}</div>
              <div>SG {formatSG(h.sg)}</div>
              <div>Putt {formatSG(h.puttingSg)}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
