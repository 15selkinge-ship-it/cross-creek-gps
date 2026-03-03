"use client";
import Link from "next/link";
import { resolveParByHole } from "@/lib/stats";
import type { CourseGps, Round, StrokeEvent } from "@/lib/types";

type Props = { round: Round | null; currentHole: number; course?: CourseGps | null; className?: string; };

type SegmentStat = {
  label: "Out" | "In" | "Tot";
  strokes: number;
  toPar: number | null;
};

function holeEvents(round: Round | null, hole: number): StrokeEvent[] {
  if (!round) return [];
  return round.events.filter((event) => event.hole === hole);
}

function holeStrokes(events: StrokeEvent[]): number {
  return events.reduce((sum, event) => sum + event.stroke_value, 0);
}

function isHoleCompleted(events: StrokeEvent[], roundEnded: boolean): boolean {
  if (events.some((event) => event.type === "green")) return true;
  return roundEnded && holeStrokes(events) > 0;
}

function formatToPar(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : `${value}`;
}

function scoreBg(s: number, par: number) {
  if (!s) return "transparent";
  const d = s - par;
  if (d <= -2) return "#78350f";
  if (d === -1) return "#14532d";
  if (d === 0) return "#1a2a1e";
  if (d === 1) return "#7c2d12";
  return "#7f1d1d";
}

function scoreCol(s: number, par: number) {
  if (!s) return "#1f3d28";
  const d = s - par;
  if (d <= -2) return "#fde68a";
  if (d === -1) return "#86efac";
  if (d === 0) return "#86efac";
  if (d === 1) return "#fdba74";
  return "#fca5a5";
}

function sumValues(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

export default function ScorecardBar({ round, currentHole, course, className }: Props) {
  const parByHole = resolveParByHole(course ?? null);
  const roundEnded = Boolean(round?.ended_at);

  const strokesByHole = Array.from({ length: 18 }, (_, idx) => {
    const events = holeEvents(round, idx + 1);
    return holeStrokes(events);
  });

  const completedByHole = Array.from({ length: 18 }, (_, idx) => {
    const events = holeEvents(round, idx + 1);
    return isHoleCompleted(events, roundEnded);
  });

  const toParByHole = Array.from({ length: 18 }, (_, idx) => {
    const hole = idx + 1;
    return completedByHole[idx] ? strokesByHole[idx] - parByHole[hole] : null;
  });

  const out = sumValues(strokesByHole.slice(0, 9));
  const inn = sumValues(strokesByHole.slice(9));
  const total = out + inn;

  const outToParValues = toParByHole.slice(0, 9).filter((value): value is number => value !== null);
  const inToParValues = toParByHole.slice(9).filter((value): value is number => value !== null);
  const allToParValues = toParByHole.filter((value): value is number => value !== null);

  const outToPar = outToParValues.length > 0 ? sumValues(outToParValues) : null;
  const inToPar = inToParValues.length > 0 ? sumValues(inToParValues) : null;
  const totalToPar = allToParValues.length > 0 ? sumValues(allToParValues) : null;

  const segments: SegmentStat[] = [
    { label: "Out", strokes: out, toPar: outToPar },
    { label: "In", strokes: inn, toPar: inToPar },
    { label: "Tot", strokes: total, toPar: totalToPar },
  ];

  return (
    <div
      className={`sticky top-0 z-10 ${className ?? ""}`.trim()}
      style={{ background: "rgba(10,15,13,0.96)", backdropFilter: "blur(16px)", borderBottom: "1px solid #1f3d28" }}
    >
      <div className="mx-auto max-w-md px-3 py-2">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            aria-label="Home"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl active:opacity-60"
            style={{ background: "#1a2a1e", border: "1px solid #1f3d28" }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#22c55e" strokeWidth="2">
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.8V21h14V9.8" />
            </svg>
          </Link>

          <div className="flex flex-1 gap-[3px] overflow-x-auto no-scrollbar">
            {strokesByHole.map((strokes, idx) => {
              const hole = idx + 1;
              const isCurrent = hole === currentHole;
              return (
                <Link
                  key={hole}
                  href={`/hole/${hole}`}
                  className="flex w-[26px] shrink-0 flex-col items-center rounded-md py-[2px] transition-transform active:scale-90"
                  style={{
                    background: strokes > 0 ? scoreBg(strokes, parByHole[hole]) : isCurrent ? "#1a2a1e" : "transparent",
                    border: isCurrent ? "1px solid #22c55e" : "1px solid transparent",
                    boxShadow: isCurrent ? "0 0 6px rgba(34,197,94,0.4)" : "none",
                  }}
                >
                  <span style={{ fontSize: "8px", color: isCurrent ? "#22c55e" : "#166534" }}>{hole}</span>
                  <span
                    style={{
                      fontFamily: "'Barlow Condensed',sans-serif",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: strokes > 0 ? scoreCol(strokes, parByHole[hole]) : isCurrent ? "#22c55e" : "#1f3d28",
                    }}
                  >
                    {strokes > 0 ? strokes : "·"}
                  </span>
                  <span style={{ fontSize: "7px", color: isCurrent ? "#86efac" : "#4ade80", opacity: 0.7 }}>
                    {formatToPar(toParByHole[idx])}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-1" style={{ background: "#111a14", border: "1px solid #1f3d28" }}>
            {segments.map((segment, i) => (
              <div key={segment.label} className="flex items-center gap-2">
                {i > 0 && <div className="h-4 w-px" style={{ background: "#1f3d28" }} />}
                <div className="text-center">
                  <div style={{ fontSize: "8px", color: "#4ade80", opacity: 0.5, textTransform: "uppercase" }}>{segment.label}</div>
                  <div
                    style={{
                      fontFamily: "'Barlow Condensed',sans-serif",
                      fontSize: "12px",
                      fontWeight: 700,
                      color: segment.label === "Tot" ? "#22c55e" : "#f0fdf4",
                    }}
                  >
                    {segment.strokes > 0 ? segment.strokes : "—"}
                  </div>
                  <div style={{ fontSize: "7px", color: "#4ade80", opacity: 0.65, whiteSpace: "nowrap" }}>
                    To Par: {formatToPar(segment.toPar)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
