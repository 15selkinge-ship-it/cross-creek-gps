import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

interface CaddieRequest {
  transcript: string;
  priorTranscripts?: string[];
  gpsDistanceYards?: number | null;
  currentHole?: number;
  par?: number;
  strokesThisHole?: number;
  sgTotal?: number;
  roundEvents?: unknown[];
  holeNumber?: number;
}

interface InferredShot {
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

interface CaddieResponse {
  transcript_type: string;
  shot_context: {
    lie: string | null;
    distance_to_pin_yards: number | null;
    elevation: string | null;
    pin_position: string | null;
    shot_intent: string | null;
  } | null;
  caddie_recommendation: {
    club: string | null;
    target: string | null;
    miss: string | null;
    strategy_mode: string | null;
  } | null;
  pattern_insight: {
    present: boolean;
    message: string | null;
    category: string | null;
  };
  round_update: {
    score_relative: number | null;
    hole_score: number | null;
    gir: boolean | null;
    putts: number | null;
    up_and_down_attempt: boolean | null;
    up_and_down_success: boolean | null;
  };
  strokes_gained_estimate: {
    off_the_tee: number | null;
    approach: number | null;
    around_green: number | null;
    putting: number | null;
  };
  inferred_shots?: InferredShot[];
  audio_base64?: string | null;
}

interface ErrorResponse {
  error: string;
  raw?: string;
}

const SYSTEM_PROMPT = `You are a concise, experienced golf caddie and stat tracker.

CRITICAL CLASSIFICATION RULES — follow these exactly:

Use transcript_type "shot_context" when:
- The player describes their current situation before hitting (lie, distance, conditions)
- The player describes what shot they are about to hit
- The player asks for advice
- Examples: "fairway 150 out", "in the rough", "going to lay up", "thinking 7 iron", "pin is back left"

Use transcript_type "shot_result" when:
- The player describes what just happened to a single shot
- The hole is NOT finished yet
- Examples: "missed right", "hit it fat", "in the bunker", "chipped out", "on the green now"

Use transcript_type "hole_result" ONLY when:
- The player explicitly states the final score or outcome of the complete hole
- You hear words like: "par", "bogey", "birdie", "eagle", "double", "made it", "holed out", "two putt par", "three putt bogey", "finished", "that's a 5"
- The hole is definitively complete — not just a single shot description
- When in doubt, do NOT use hole_result — use shot_result instead
- NEVER use hole_result for a pre-shot description like "going to lay up" or "thinking about hitting driver"

Also use hole_result when:
- The player states putts taken, even without an explicit score word
- Examples that should ALL trigger hole_result:
  - "2 putt"
  - "two putt"
  - "three putt"
  - "putted from 20 feet, 2 putt"
  - "made the putt"
  - "missed the putt, 3 putt"
  - "tapped in"
  - "holed it from off the green"
- Putting is always the final act of a hole — if the player describes putts taken, the hole is complete
- When hole_result is triggered by a putt statement and no explicit total score is given, infer hole_score as: strokesThisHole (provided in context) + putts taken
- Use the priorTranscripts to reconstruct all shots that happened before the putting

If you are unsure whether something is shot_result or hole_result, ask: does this statement describe the final act of completing the hole? Putting always does. A chip or approach shot does not unless the player says they holed it.

Use transcript_type "round_context" when:
- The player describes match play, handicap strokes, or overall round situation
- Examples: "9 hole match", "I'm getting two strokes", "I'm up 2"

Use transcript_type "match_context" when:
- The player describes the current match state mid-round

CADDIE ADVICE RULES:
- For shot_context: always return a caddie_recommendation with club, target, miss, strategy_mode
- For shot_result: give brief advice on next shot if useful, otherwise null
- For hole_result: caddie_recommendation can be null
- Be concise and specific — one club, one target, one miss direction
- Analyze roundEvents for miss patterns and surface one insight when data supports it

INFERRED SHOTS RULES:
- Only populate inferred_shots when transcript_type is "hole_result"
- Use ALL prior updates this hole (provided in context) plus the latest to reconstruct the full shot sequence
- For all other transcript types, set inferred_shots to []

JSON response shape — always return all fields:
{
  "transcript_type": "shot_context",
  "shot_context": {
    "lie": "fairway",
    "distance_to_pin_yards": 150,
    "elevation": null,
    "pin_position": null,
    "shot_intent": "lay_up"
  },
  "caddie_recommendation": {
    "club": "7 iron",
    "target": "center of fairway, 100 out",
    "miss": "short is fine, avoid the water left",
    "strategy_mode": "conservative"
  },
  "pattern_insight": {
    "present": false,
    "message": null,
    "category": null
  },
  "round_update": {
    "score_relative": null,
    "hole_score": null,
    "gir": null,
    "putts": null,
    "up_and_down_attempt": null,
    "up_and_down_success": null
  },
  "strokes_gained_estimate": {
    "off_the_tee": null,
    "approach": null,
    "around_green": null,
    "putting": null
  },
  "inferred_shots": []
}

When pattern_insight.present is false, set message and category to null.
Always return valid JSON only — no prose, no markdown, no code fences.`;

export async function POST(req: NextRequest): Promise<NextResponse<CaddieResponse | ErrorResponse>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  let body: CaddieRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { transcript, priorTranscripts, gpsDistanceYards, currentHole, par, strokesThisHole, sgTotal, roundEvents } = body;

  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }

  const priorContext = (priorTranscripts && priorTranscripts.length > 0)
    ? `\nPrior updates this hole:\n${priorTranscripts.map((t, i) => `  ${i + 1}. "${t}"`).join("\n")}`
    : "";

  const userMessage = `
Current situation:
- Hole: ${currentHole ?? "unknown"}
- Par: ${par ?? "unknown"}
- GPS distance to pin: ${gpsDistanceYards != null ? `${gpsDistanceYards} yards` : "unavailable"}
- Strokes this hole: ${strokesThisHole ?? 0}
- Round strokes gained total: ${sgTotal ?? 0}
${priorContext}
Latest update: "${transcript.trim()}"

Full round events (for pattern analysis):
${JSON.stringify(roundEvents ?? [], null, 0)}

Consider ALL updates this hole together when determining transcript_type and building inferred_shots. If the latest update completes the hole story (e.g. "got up and down for par", "made the putt", "two putt bogey"), set transcript_type to "hole_result" and reconstruct ALL shots across all updates into inferred_shots. Otherwise set transcript_type to "shot_context" or "shot_result" and give caddie advice for the current situation.

Return JSON only.`.trim();

  let raw = "";
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 900,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: `OpenAI API error: ${response.status}`, raw: err }, { status: 502 });
    }

    const data = await response.json();
    raw = data.choices?.[0]?.message?.content ?? "";

    const parsed = JSON.parse(raw) as CaddieResponse;

    // Ensure required shape with defensive defaults
    const result: CaddieResponse = {
      transcript_type: parsed.transcript_type ?? "shot_context",
      shot_context: parsed.shot_context ?? null,
      caddie_recommendation: parsed.caddie_recommendation ?? null,
      pattern_insight: {
        present: parsed.pattern_insight?.present === true,
        message: parsed.pattern_insight?.present ? (parsed.pattern_insight?.message ?? null) : null,
        category: parsed.pattern_insight?.present ? (parsed.pattern_insight?.category ?? null) : null,
      },
      round_update: parsed.round_update ?? {
        score_relative: null,
        hole_score: null,
        gir: null,
        putts: null,
        up_and_down_attempt: null,
        up_and_down_success: null,
      },
      strokes_gained_estimate: parsed.strokes_gained_estimate ?? {
        off_the_tee: null,
        approach: null,
        around_green: null,
        putting: null,
      },
      inferred_shots: parsed.inferred_shots ?? [],
    };

    // Build TTS text and generate audio server-side
    function buildTTSText(res: CaddieResponse): string {
      const rec = res.caddie_recommendation;
      const insight = res.pattern_insight;
      const parts: string[] = [];
      if (rec?.club) parts.push(rec.club + ".");
      if (rec?.target) parts.push("Aim " + rec.target + ".");
      if (rec?.miss) parts.push("Miss " + rec.miss + ".");
      if (insight?.present && insight.message) parts.push(insight.message);
      return parts.join(" ").trim();
    }

    const ttsText = buildTTSText(result);
    let audioBase64: string | null = null;

    if (ttsText) {
      try {
        const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "tts-1",
            voice: "onyx",
            input: ttsText,
            response_format: "mp3",
          }),
        });

        if (ttsResponse.ok) {
          const audioBuffer = await ttsResponse.arrayBuffer();
          audioBase64 = Buffer.from(audioBuffer).toString("base64");
        } else {
          console.error("[tts] failed:", ttsResponse.status);
        }
      } catch (err) {
        console.error("[tts] error:", err);
        // Non-fatal — caddie response still returns, just without audio
      }
    }

    result.audio_base64 = audioBase64;

    return NextResponse.json(result);
  } catch (err) {
    console.error("[caddie] error:", err, "raw:", raw);
    return NextResponse.json(
      { error: "Failed to parse AI response", raw: raw.slice(0, 500) },
      { status: 502 }
    );
  }
}
