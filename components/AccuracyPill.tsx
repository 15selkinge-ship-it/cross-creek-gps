"use client";

type AccuracyPillProps = {
  accuracyM?: number | null;
  noGps?: boolean;
};

type AccuracyStatus = {
  label: "Excellent" | "Good" | "Fair" | "Poor" | "No GPS" | "Acquiring";
  color: string;
  border: string;
};

function getAccuracyStatus(accuracyM?: number | null, noGps?: boolean): AccuracyStatus {
  if (noGps) {
    return { label: "No GPS", color: "#94a3b8", border: "#334155" };
  }
  if (typeof accuracyM !== "number" || !Number.isFinite(accuracyM)) {
    return { label: "Acquiring", color: "#94a3b8", border: "#334155" };
  }
  if (accuracyM <= 5) {
    return { label: "Excellent", color: "#22c55e", border: "#166534" };
  }
  if (accuracyM <= 10) {
    return { label: "Good", color: "#84cc16", border: "#3f6212" };
  }
  if (accuracyM <= 20) {
    return { label: "Fair", color: "#f59e0b", border: "#92400e" };
  }
  return { label: "Poor", color: "#f97316", border: "#9a3412" };
}

export default function AccuracyPill({ accuracyM, noGps = false }: AccuracyPillProps) {
  const status = getAccuracyStatus(accuracyM, noGps);
  const roundedAccuracy = typeof accuracyM === "number" && Number.isFinite(accuracyM) ? Math.round(accuracyM) : null;

  return (
    <div className="mt-3 flex items-center justify-between rounded-xl border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <div style={{ color: "var(--text-muted)" }}>
        Accuracy: {roundedAccuracy !== null ? `+/-${roundedAccuracy}m` : "--"}
      </div>
      <div className="rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ color: status.color, borderColor: status.border }}>
        {status.label}
      </div>
    </div>
  );
}
