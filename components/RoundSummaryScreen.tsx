"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchCourse } from "@/lib/course";
import { getStoredRound, saveRound } from "@/lib/round-storage";
import { emptySGTotals, loadSGBaseline, recalculateRoundSG } from "@/lib/sg";
import { buildRoundStats } from "@/lib/stats";
import type { CourseGps, Round, SGCategory } from "@/lib/types";

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

function formatPct(value: number | null): string {
  return value === null ? "--" : `${Math.round(value)}%`;
}

function formatFlag(value: boolean | null): string {
  if (value === true) return "Y";
  if (value === false) return "N";
  return "-";
}

function formatToPar(value: number): string {
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : `${value}`;
}

export default function RoundSummaryScreen() {
  const router = useRouter();
  const [round, setRound] = useState<Round | null>(null);
  const [course, setCourse] = useState<CourseGps | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const stored = getStoredRound();
    if (!stored) {
      setRound(null);
      return () => {
        alive = false;
      };
    }

    fetchCourse().then((data) => {
      if (alive) setCourse(data);
    }).catch(() => {
      if (alive) setError("Unable to load course data.");
    });

    loadSGBaseline()
      .then((baseline) => {
        if (!alive) return;
        const withSg = recalculateRoundSG(stored, baseline);
        setRound(withSg);
        saveRound(withSg);
      })
      .catch(() => {
        if (!alive) return;
        setRound(stored);
        setError((prev) => prev ?? "Unable to load SG baseline.");
      });

    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => buildRoundStats(round, course), [round, course]);
  const totalSg = round?.sg_total ?? 0;
  const categoryTotals = round?.sg_by_category ?? emptySGTotals();

  function handleResumeEdit() {
    if (!round) return;
    const resumed: Round = { ...round, ended_at: undefined };
    setRound(resumed);
    saveRound(resumed);
    router.push(`/hole/${resumed.current_hole}`);
  }

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
        <Link className="underline" href="/">Home</Link>
      </div>
      {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

      <div className="mb-3 rounded border p-3">
        <div className="text-xs opacity-70">
          Started {new Date(round.started_at).toLocaleString()}
        </div>
        <div className="text-xs opacity-70">
          {round.ended_at ? `Ended ${new Date(round.ended_at).toLocaleString()}` : "Round in progress"}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-xs opacity-70">Score</div>
            <div className="font-semibold">{stats.strokesTotal}</div>
          </div>
          <div>
            <div className="text-xs opacity-70">To Par</div>
            <div className="font-semibold">{formatToPar(stats.toPar)}</div>
          </div>
          <div>
            <div className="text-xs opacity-70">Putts</div>
            <div className="font-semibold">
              {stats.puttsTotal} ({stats.puttsAvg === null ? "--" : stats.puttsAvg.toFixed(2)} avg)
            </div>
          </div>
        </div>
      </div>

      <div className="mb-3 rounded border p-3 text-sm">
        <div className="mb-2 font-semibold">Round Dashboard</div>
        <div className="grid grid-cols-2 gap-2">
          <div>FIR: {stats.fir.hits}/{stats.fir.attempts} ({formatPct(stats.fir.pct)})</div>
          <div>GIR: {stats.gir.hits}/{stats.gir.attempts} ({formatPct(stats.gir.pct)})</div>
          <div>U&amp;D: {stats.upAndDown.hits}/{stats.upAndDown.attempts} ({formatPct(stats.upAndDown.pct)})</div>
          <div>Strokes: {stats.strokesTotal}</div>
        </div>
      </div>

      <div className="mb-3 rounded border p-3">
        <div>Total SG: {formatSG(totalSg)}</div>
        <div className="text-xs opacity-80">Baseline: {round.sg_baseline_version ?? "n/a"}</div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {Object.entries(SG_LABELS).map(([key, label]) => (
            <div key={key}>
              {label}: {formatSG(categoryTotals[key as SGCategory] ?? 0)}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border p-3">
        <div className="mb-2 font-semibold">Hole-by-Hole</div>
        <div className="space-y-1 text-xs">
          {stats.holes.map((hole) => (
            <div key={hole.hole} className="grid grid-cols-8 gap-1 border-b py-1 last:border-b-0">
              <div>H{hole.hole}</div>
              <div>{hole.strokes || "-"}</div>
              <div>{hole.putts || "-"}</div>
              <div>{formatFlag(hole.fir)}</div>
              <div>{formatFlag(hole.gir)}</div>
              <div>{formatFlag(hole.upAndDown)}</div>
              <div>{hole.toPar === null ? "-" : formatToPar(hole.toPar)}</div>
              <div>{formatSG(hole.sg)}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-8 gap-1 text-[10px] opacity-70">
          <div>Hole</div>
          <div>Stk</div>
          <div>Putt</div>
          <div>FIR</div>
          <div>GIR</div>
          <div>U&amp;D</div>
          <div>ToPar</div>
          <div>SG</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="h-11 rounded border" onClick={() => router.push(`/hole/${round.current_hole}`)}>
          Back to Hole {round.current_hole}
        </button>
        <button className="h-11 rounded border" onClick={handleResumeEdit}>
          Resume/Edit
        </button>
      </div>
    </main>
  );
}
