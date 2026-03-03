"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCourse } from "@/lib/course";
import {
  clearStoredRound,
  getStoredRound,
  saveRound,
} from "@/lib/round-storage";
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
  };
}

export default function Home() {
  const router = useRouter();
  const [round, setRound] = useState<Round | null>(() => getStoredRound());
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCourse()
      .then(setCourse)
      .catch(() => setError("Unable to load /public/course.json."));
  }, []);

  function handleStartRound() {
    const teeSetId = course?.tee_sets?.[0]?.id ?? "default";
    const nextRound = createRound(teeSetId);
    saveRound(nextRound);
    setRound(nextRound);
    router.push("/hole/1");
  }

  function handleResumeRound() {
    if (!round) {
      return;
    }
    router.push(`/hole/${round.current_hole}`);
  }

  function handleExportRound() {
    if (!round) {
      return;
    }

    const blob = new Blob([JSON.stringify(round, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cross-creek-round.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleClearRound() {
    const confirmed = window.confirm("Clear the current round?");
    if (!confirmed) {
      return;
    }
    clearStoredRound();
    setRound(null);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-slate-50 p-4">
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Cross Creek Golf Tracker</h1>
        <p className="mt-1 text-sm text-slate-600">
          {course ? `${course.course} • ${course.tee_sets[0]?.name ?? "Tee set"}` : "Loading course..."}
        </p>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </section>

      <section className="grid gap-3">
        <button
          type="button"
          onClick={handleStartRound}
          className="h-14 rounded-xl bg-emerald-600 text-lg font-semibold text-white"
        >
          Start Round
        </button>
        <button
          type="button"
          onClick={handleResumeRound}
          disabled={!round}
          className="h-14 rounded-xl bg-slate-900 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Resume Round
        </button>
        <button
          type="button"
          onClick={handleExportRound}
          disabled={!round}
          className="h-14 rounded-xl bg-sky-700 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={handleClearRound}
          disabled={!round}
          className="h-14 rounded-xl bg-rose-700 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Clear Round
        </button>
      </section>

      <section className="rounded-2xl bg-white p-4 text-sm text-slate-700 shadow-sm">
        <p>Storage key: <code>cc_round_v1</code></p>
        <p className="mt-1">
          {round
            ? `Round started ${new Date(round.started_at).toLocaleString()}`
            : "No saved round yet."}
        </p>
      </section>
    </main>
  );
}
