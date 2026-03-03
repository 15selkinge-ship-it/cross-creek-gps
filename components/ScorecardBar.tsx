"use client";
import Link from "next/link";
import type { Round } from "@/lib/types";

type Props = { round: Round | null; currentHole: number; className?: string; };

function holeStrokes(round: Round | null, hole: number): number {
  if (!round) return 0;
  return round.events.filter(e => e.hole === hole).reduce((s, e) => s + e.stroke_value, 0);
}

const PARS = [5,3,4,4,3,4,3,5,4,4,3,5,3,4,5,3,4,5];

function scoreBg(s: number, par: number) {
  if (!s) return "transparent";
  const d = s - par;
  if (d <= -2) return "#78350f"; if (d === -1) return "#14532d";
  if (d === 0) return "#1a2a1e"; if (d === 1) return "#7c2d12"; return "#7f1d1d";
}
function scoreCol(s: number, par: number) {
  if (!s) return "#1f3d28";
  const d = s - par;
  if (d <= -2) return "#fde68a"; if (d === -1) return "#86efac";
  if (d === 0) return "#86efac"; if (d === 1) return "#fdba74"; return "#fca5a5";
}

export default function ScorecardBar({ round, currentHole, className }: Props) {
  const perHole = Array.from({ length: 18 }, (_, i) => holeStrokes(round, i + 1));
  const out = perHole.slice(0,9).reduce((s,v)=>s+v,0);
  const inn = perHole.slice(9).reduce((s,v)=>s+v,0);
  const total = out + inn;

  return (
    <div className={`sticky top-0 z-10 ${className ?? ""}`.trim()}
      style={{ background: "rgba(10,15,13,0.96)", backdropFilter: "blur(16px)", borderBottom: "1px solid #1f3d28" }}>
      <div className="mx-auto max-w-md px-3 py-2">
        <div className="flex items-center gap-2">
          <Link href="/" aria-label="Home"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl active:opacity-60"
            style={{ background: "#1a2a1e", border: "1px solid #1f3d28" }}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#22c55e" strokeWidth="2">
              <path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V21h14V9.8"/>
            </svg>
          </Link>

          <div className="flex flex-1 gap-[3px] overflow-x-auto no-scrollbar">
            {perHole.map((strokes, idx) => {
              const hole = idx + 1;
              const isCurrent = hole === currentHole;
              return (
                <Link key={hole} href={`/hole/${hole}`}
                  className="flex w-[26px] shrink-0 flex-col items-center rounded-md py-[3px] transition-transform active:scale-90"
                  style={{
                    background: strokes > 0 ? scoreBg(strokes, PARS[idx]) : isCurrent ? "#1a2a1e" : "transparent",
                    border: isCurrent ? "1px solid #22c55e" : "1px solid transparent",
                    boxShadow: isCurrent ? "0 0 6px rgba(34,197,94,0.4)" : "none",
                  }}>
                  <span style={{ fontSize: "8px", color: isCurrent ? "#22c55e" : "#166534" }}>{hole}</span>
                  <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: "11px", fontWeight: 700, color: strokes > 0 ? scoreCol(strokes, PARS[idx]) : isCurrent ? "#22c55e" : "#1f3d28" }}>
                    {strokes > 0 ? strokes : "·"}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-1"
            style={{ background: "#111a14", border: "1px solid #1f3d28" }}>
            {(["Out",out],["In",inn],["Tot",total]) && [["Out",out],["In",inn],["Tot",total]].map(([label, val], i) => (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <div className="h-4 w-px" style={{ background: "#1f3d28" }} />}
                <div className="text-center">
                  <div style={{ fontSize: "8px", color: "#4ade80", opacity: 0.5, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: "12px", fontWeight: 700, color: label === "Tot" ? "#22c55e" : "#f0fdf4" }}>
                    {(val as number) > 0 ? val : "—"}
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