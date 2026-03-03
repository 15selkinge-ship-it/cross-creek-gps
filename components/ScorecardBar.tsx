"use client";

import Link from "next/link";
import type { Round } from "@/lib/types";

type ScorecardBarProps = {
  round: Round | null;
  currentHole: number;
  className?: string;
};

function holeStrokes(round: Round | null, hole: number): number {
  if (!round) {
    return 0;
  }
  return round.events.reduce((total, event) => {
    if (event.hole !== hole) {
      return total;
    }
    return total + event.stroke_value;
  }, 0);
}

export default function ScorecardBar({ round, currentHole, className }: ScorecardBarProps) {
  const perHole = Array.from({ length: 18 }, (_, idx) => holeStrokes(round, idx + 1));
  const out = perHole.slice(0, 9).reduce((sum, value) => sum + value, 0);
  const inn = perHole.slice(9, 18).reduce((sum, value) => sum + value, 0);
  const total = out + inn;

  return (
    <div
      className={`sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 py-2 backdrop-blur ${className ?? ""}`.trim()}
    >
      <div className="rounded-xl bg-white px-2 py-2 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href="/"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-200 text-slate-800"
              aria-label="Home"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 10.5 12 3l9 7.5" />
                <path d="M5 9.8V21h14V9.8" />
              </svg>
            </Link>
            <div className="flex min-w-0 gap-1 overflow-x-auto pb-1">
              {perHole.map((strokes, idx) => {
                const hole = idx + 1;
                const isCurrent = hole === currentHole;
                return (
                  <Link
                    key={hole}
                    href={`/hole/${hole}`}
                    className={`w-10 shrink-0 rounded-md border px-1 py-1 text-center text-[10px] ${
                      isCurrent
                        ? "border-emerald-600 bg-emerald-100 text-emerald-900"
                        : "border-slate-200 bg-slate-100 text-slate-700"
                    }`}
                  >
                    <div className="leading-tight">{hole}</div>
                    <div className="text-xs font-semibold leading-tight">{strokes > 0 ? strokes : "-"}</div>
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center text-[10px] sm:w-auto">
            <div className="rounded-md bg-slate-100 px-2 py-1">
              <div className="text-slate-500">OUT</div>
              <div className="text-sm font-semibold text-slate-900">{out || "-"}</div>
            </div>
            <div className="rounded-md bg-slate-100 px-2 py-1">
              <div className="text-slate-500">IN</div>
              <div className="text-sm font-semibold text-slate-900">{inn || "-"}</div>
            </div>
            <div className="rounded-md bg-slate-900 px-2 py-1 text-white">
              <div className="text-slate-300">TOT</div>
              <div className="text-sm font-semibold">{total || "-"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
