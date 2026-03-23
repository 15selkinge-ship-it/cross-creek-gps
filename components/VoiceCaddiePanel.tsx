"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StrokeEvent } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface InferredShot {
  shot_number: number;
  club: string | null;
  start_lie: "tee" | "fairway" | "rough" | "sand" | "green" | "penalty";
  end_lie: "fairway" | "rough" | "sand" | "green" | "penalty";
  estimated_distance_yards: number | null;
  estimated_distance_to_pin_after_yards: number | null;
  is_putt: boolean;
  putt_distance_feet: number | null;
  putt_count: number | null;
}

interface CaddieRecommendation {
  club: string | null;
  target: string | null;
  miss: string | null;
  strategy_mode: string | null;
}

interface PatternInsight {
  present: boolean;
  message: string | null;
  category: string | null;
}

interface RoundUpdate {
  score_relative: number | null;
  hole_score: number | null;
  gir: boolean | null;
  putts: number | null;
  up_and_down_attempt: boolean | null;
  up_and_down_success: boolean | null;
}

interface ShotContext {
  lie: string | null;
  distance_to_pin_yards: number | null;
  elevation: string | null;
  pin_position: string | null;
  shot_intent: string | null;
}

interface CaddieResponse {
  transcript_type: string;
  shot_context: ShotContext | null;
  caddie_recommendation: CaddieRecommendation | null;
  pattern_insight: PatternInsight;
  round_update: RoundUpdate;
  strokes_gained_estimate: {
    off_the_tee: number | null;
    approach: number | null;
    around_green: number | null;
    putting: number | null;
  };
  inferred_shots?: InferredShot[];
}

interface HistoryEntry {
  id: string;
  transcript: string;
  response: CaddieResponse;
  timestamp: string;
}

interface VoiceCaddiePanelProps {
  currentHole: number;
  par: number;
  strokesThisHole: number;
  sgTotal: number;
  roundEvents: StrokeEvent[];
  gpsDistanceYards: number | null;
  onHoleComplete?: (inferredShots: InferredShot[], holeScore: number) => void;
}

// ── Web Speech API — minimal local types (not in standard DOM lib) ─────────

interface SRResultItem { transcript: string }
interface SRResult { readonly length: number; [index: number]: SRResultItem }
interface SRResultList { readonly length: number; [index: number]: SRResult }
interface SREvent { results: SRResultList }
interface SRErrorEvent { error: string }
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

// ── Web Speech API detection ───────────────────────────────────────────────

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"] ?? null) as SpeechRecognitionConstructor | null;
}

// ── Helper: speak text via speechSynthesis ─────────────────────────────────

function speak(text: string, muted: boolean) {
  if (muted || typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.05;
  utt.pitch = 1;
  utt.volume = 1;
  window.speechSynthesis.speak(utt);
}

function buildSpeechText(rec: CaddieRecommendation | null): string {
  if (!rec) return "No recommendation available.";
  const parts: string[] = [];
  if (rec.club) parts.push(rec.club + ".");
  if (rec.target) parts.push("Aim " + rec.target + ".");
  if (rec.miss) parts.push("Miss " + rec.miss + ".");
  return parts.join(" ") || "No recommendation available.";
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function VoiceCaddiePanel({
  currentHole,
  par,
  strokesThisHole,
  sgTotal,
  roundEvents,
  gpsDistanceYards,
  onHoleComplete,
}: VoiceCaddiePanelProps) {
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caddieResponse, setCaddieResponse] = useState<CaddieResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [muted, setMuted] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognition());
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;
    setTranscript("");
    setError(null);

    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (e: SREvent) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        parts.push(e.results[i][0].transcript);
      }
      setTranscript(parts.join(" "));
    };

    rec.onerror = (e: SRErrorEvent) => {
      setError(`Mic error: ${e.error}. Try the text input below.`);
      setIsRecording(false);
    };

    rec.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = rec;
    rec.start();
    setIsRecording(true);
  }, []);

  const handleToggleRecord = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      // Prime speech synthesis within the user gesture for mobile Chrome reliability
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const submitToAI = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setError("Please say or type something first.");
        return;
      }

      setLoading(true);
      setError(null);
      setCaddieResponse(null);

      try {
        const res = await fetch("/api/caddie", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: trimmed,
            gpsDistanceYards,
            currentHole,
            par,
            strokesThisHole,
            sgTotal,
            roundEvents,
            holeNumber: currentHole,
          }),
        });

        const data = await res.json();

        if (!res.ok || data.error) {
          setError(data.error ?? "AI caddie error. Try again.");
          return;
        }

        const caddie = data as CaddieResponse;
        setCaddieResponse(caddie);

        // Speak the recommendation (delayed for mobile Chrome speechSynthesis reliability)
        setTimeout(() => speak(buildSpeechText(caddie.caddie_recommendation), muted), 50);

        // Auto-log hole from voice if hole_result with inferred shots
        if (
          caddie.transcript_type === "hole_result" &&
          caddie.round_update?.hole_score != null &&
          (caddie.inferred_shots?.length ?? 0) > 0
        ) {
          setTimeout(() => onHoleComplete?.(caddie.inferred_shots!, caddie.round_update!.hole_score!), 100);
        }

        // Add to history (keep last 5)
        setHistory(prev => [
          {
            id: `${Date.now()}`,
            transcript: trimmed,
            response: caddie,
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 5));

        // Clear inputs
        setTranscript("");
        setTextInput("");
      } catch {
        setError("Network error. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [currentHole, gpsDistanceYards, muted, onHoleComplete, par, roundEvents, sgTotal, strokesThisHole]
  );

  // Auto-submit when recording stops and transcript is non-empty
  const prevRecording = useRef(false);
  useEffect(() => {
    if (prevRecording.current && !isRecording && transcript.trim()) {
      submitToAI(transcript);
    }
    prevRecording.current = isRecording;
  }, [isRecording, transcript, submitToAI]);

  const handleTextSubmit = () => submitToAI(textInput);

  // ── Render ───────────────────────────────────────────────────────────────

  const rec = caddieResponse?.caddie_recommendation;
  const insight = caddieResponse?.pattern_insight;
  const roundUpdate = caddieResponse?.round_update;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>

      {/* ── Record / Input Panel ── */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "1rem", color: "var(--text-secondary)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
            AI Caddie
          </div>
          <button
            onClick={() => {
              setMuted(m => !m);
              if (typeof window !== "undefined") window.speechSynthesis?.cancel();
            }}
            title={muted ? "Unmute caddie voice" : "Mute caddie voice"}
            style={{
              height: 32, padding: "0 10px", borderRadius: 10,
              background: muted ? "#1a2a1e" : "var(--bg-elevated)",
              border: `1px solid ${muted ? "var(--border)" : "#22c55e40"}`,
              color: muted ? "#86efac80" : "#86efac",
              fontFamily: "'Barlow Condensed',sans-serif",
              fontWeight: 600, fontSize: "0.75rem", letterSpacing: "0.06em",
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            {muted ? "MUTED" : "SOUND ON"}
          </button>
        </div>

        {speechSupported ? (
          <>
            <button
              onClick={handleToggleRecord}
              disabled={loading}
              style={{
                height: 64, width: "100%", borderRadius: 16, border: "none",
                fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800,
                fontSize: "1.2rem", letterSpacing: "0.1em", textTransform: "uppercase",
                background: isRecording ? "#22c55e" : "var(--bg-elevated)",
                color: isRecording ? "#052e16" : "var(--text-primary)",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
                boxShadow: isRecording
                  ? "0 0 0 4px rgba(34,197,94,0.2), 0 0 28px rgba(34,197,94,0.35)"
                  : "none",
                animation: isRecording ? "caddie-pulse 1.8s ease-in-out infinite" : "none",
                transition: "background 0.2s, color 0.2s, box-shadow 0.2s",
              }}
            >
              {isRecording ? "● RECORDING — TAP TO SEND" : loading ? "THINKING..." : "TAP TO SPEAK"}
            </button>

            {(isRecording || transcript) && (
              <div style={{
                marginTop: 10, padding: "10px 14px",
                background: "var(--bg-elevated)", borderRadius: 12,
                border: `1px solid ${isRecording ? "#22c55e40" : "var(--border)"}`,
                color: isRecording ? "#86efac" : "var(--text-primary)",
                fontSize: "0.9rem", minHeight: 44, lineHeight: 1.45,
                transition: "border-color 0.2s",
              }}>
                {transcript || <span style={{ opacity: 0.4 }}>Listening...</span>}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#fde68a", fontSize: "0.8rem", marginBottom: 8 }}>
            Voice input not supported in this browser. Use text below.
          </div>
        )}

        {/* Text fallback — always shown on non-speech browsers, optional on others */}
        {(!speechSupported) && (
          <div style={{ display: "flex", gap: 8, marginTop: speechSupported ? 10 : 0 }}>
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleTextSubmit()}
              placeholder="Describe your shot or situation..."
              disabled={loading}
              style={{
                flex: 1, padding: "12px 14px", borderRadius: 12,
                border: "1px solid var(--border)", background: "var(--bg-elevated)",
                color: "var(--text-primary)", fontSize: "1rem", outline: "none",
                fontFamily: "Barlow, sans-serif",
              }}
            />
            <button
              onClick={handleTextSubmit}
              disabled={loading || !textInput.trim()}
              style={{
                padding: "0 16px", borderRadius: 12, border: "none",
                background: textInput.trim() && !loading ? "#22c55e" : "#1a2a1e",
                color: textInput.trim() && !loading ? "#052e16" : "#1f3d28",
                fontFamily: "'Barlow Condensed',sans-serif",
                fontWeight: 700, fontSize: "0.9rem", cursor: "pointer",
                transition: "background 0.2s, color 0.2s",
              }}
            >
              {loading ? "..." : "SEND"}
            </button>
          </div>
        )}

        {/* Also show text input below Record button as optional typed override */}
        {speechSupported && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleTextSubmit()}
              placeholder="Or type here..."
              disabled={loading || isRecording}
              style={{
                flex: 1, padding: "10px 14px", borderRadius: 12,
                border: "1px solid var(--border)", background: "var(--bg-elevated)",
                color: "var(--text-primary)", fontSize: "0.95rem", outline: "none",
                fontFamily: "Barlow, sans-serif", opacity: isRecording ? 0.4 : 1,
              }}
            />
            <button
              onClick={handleTextSubmit}
              disabled={loading || isRecording || !textInput.trim()}
              style={{
                padding: "0 14px", borderRadius: 12, border: "none",
                background: textInput.trim() && !loading && !isRecording ? "#22c55e" : "#1a2a1e",
                color: textInput.trim() && !loading && !isRecording ? "#052e16" : "#1f3d28",
                fontFamily: "'Barlow Condensed',sans-serif",
                fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
                transition: "background 0.2s, color 0.2s",
              }}
            >
              {loading ? "..." : "SEND"}
            </button>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: "10px 14px", background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 12, color: "#fca5a5", fontSize: "0.83rem" }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Caddie Recommendation Card ── */}
      {rec && (
        <div style={{ background: "var(--bg-card)", border: "1px solid #22c55e30", borderRadius: 16, padding: 16, animation: "caddie-fade 0.3s ease-out" }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "0.85rem", color: "#22c55e", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 12 }}>
            Caddie Advice
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {rec.club && (
              <StatCard label="Club" value={rec.club} accent="#22c55e" />
            )}
            {rec.target && (
              <StatCard label="Target" value={rec.target} accent="#86efac" />
            )}
            {rec.miss && (
              <StatCard label="Miss" value={rec.miss} accent="#fbbf24" />
            )}
            {rec.strategy_mode && (
              <StatCard label="Strategy" value={rec.strategy_mode} accent="#86efac" />
            )}
          </div>

          {caddieResponse?.shot_context && (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {caddieResponse.shot_context.lie && <Chip label={caddieResponse.shot_context.lie} />}
              {caddieResponse.shot_context.distance_to_pin_yards != null && (
                <Chip label={`${caddieResponse.shot_context.distance_to_pin_yards} yds`} />
              )}
              {caddieResponse.shot_context.elevation && <Chip label={caddieResponse.shot_context.elevation} />}
              {caddieResponse.shot_context.pin_position && <Chip label={`pin: ${caddieResponse.shot_context.pin_position}`} />}
            </div>
          )}
        </div>
      )}

      {/* ── Pattern Insight Card ── */}
      {insight?.present && insight.message && (
        <div style={{
          background: "#1c1400",
          border: "1px solid #f59e0b60",
          borderRadius: 16, padding: 16,
          animation: "caddie-fade 0.35s ease-out",
        }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "0.85rem", color: "#f59e0b", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 8 }}>
            Pattern Insight
          </div>
          <p style={{ color: "#fde68a", fontSize: "0.9rem", margin: 0, lineHeight: 1.5 }}>
            {insight.message}
          </p>
          {insight.category && (
            <div style={{ marginTop: 8 }}>
              <Chip label={insight.category.replace(/_/g, " ")} accent="#f59e0b" />
            </div>
          )}
        </div>
      )}

      {/* ── Round Update Card ── */}
      {roundUpdate && Object.values(roundUpdate).some(v => v !== null) && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 16, animation: "caddie-fade 0.4s ease-out" }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: "0.85rem", color: "var(--text-secondary)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 10 }}>
            Round Update
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {roundUpdate.hole_score != null && (
              <StatCard label="Score" value={String(roundUpdate.hole_score)} />
            )}
            {roundUpdate.score_relative != null && (
              <StatCard
                label="To Par"
                value={roundUpdate.score_relative >= 0 ? `+${roundUpdate.score_relative}` : String(roundUpdate.score_relative)}
                accent={roundUpdate.score_relative < 0 ? "#22c55e" : roundUpdate.score_relative === 0 ? "#86efac" : "#fca5a5"}
              />
            )}
            {roundUpdate.putts != null && (
              <StatCard label="Putts" value={String(roundUpdate.putts)} />
            )}
            {roundUpdate.gir != null && (
              <StatCard label="GIR" value={roundUpdate.gir ? "Yes" : "No"} accent={roundUpdate.gir ? "#22c55e" : "#fca5a5"} />
            )}
            {roundUpdate.up_and_down_success != null && (
              <StatCard label="U&D" value={roundUpdate.up_and_down_success ? "Yes" : "No"} accent={roundUpdate.up_and_down_success ? "#22c55e" : "#fca5a5"} />
            )}
          </div>
        </div>
      )}

      {/* ── Interaction History ── */}
      {history.length > 0 && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          <button
            onClick={() => setHistoryOpen(o => !o)}
            style={{
              width: "100%", padding: "12px 16px", background: "transparent",
              border: "none", display: "flex", alignItems: "center", justifyContent: "space-between",
              cursor: "pointer",
            }}
          >
            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "0.85rem", color: "var(--text-secondary)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Recent ({history.length})
            </span>
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="#86efac" strokeWidth="2.5"
              style={{ transform: historyOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {historyOpen && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "8px 16px 12px" }}>
              {history.map((entry, i) => (
                <div key={entry.id} style={{ paddingTop: i > 0 ? 10 : 0, borderTop: i > 0 ? "1px solid var(--border)" : "none", marginTop: i > 0 ? 10 : 0 }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: "0.75rem", marginBottom: 4, lineHeight: 1.3, opacity: 0.7 }}>
                    "{entry.transcript}"
                  </div>
                  {entry.response.caddie_recommendation?.club && (
                    <div style={{ color: "var(--text-primary)", fontSize: "0.82rem" }}>
                      <span style={{ color: "#22c55e" }}>{entry.response.caddie_recommendation.club}</span>
                      {entry.response.caddie_recommendation.target && ` → ${entry.response.caddie_recommendation.target}`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes caddie-pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(34,197,94,0.2), 0 0 28px rgba(34,197,94,0.35); }
          50%       { box-shadow: 0 0 0 8px rgba(34,197,94,0.1), 0 0 40px rgba(34,197,94,0.5); }
        }
        @keyframes caddie-fade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ label, value, accent = "var(--text-primary)" }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 10px 8px", textAlign: "center" }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: "1rem", color: accent, lineHeight: 1.2, wordBreak: "break-word" }}>
        {value}
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 3 }}>
        {label}
      </div>
    </div>
  );
}

function Chip({ label, accent = "var(--text-secondary)" }: { label: string; accent?: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 20,
      background: "var(--bg-elevated)", border: "1px solid var(--border)",
      color: accent, fontSize: "0.72rem", fontFamily: "Barlow, sans-serif",
      fontWeight: 500, letterSpacing: "0.04em",
    }}>
      {label}
    </span>
  );
}
