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
}

interface ErrorResponse {
  error: string;
  raw?: string;
}

const SYSTEM_PROMPT = `You are a concise, experienced golf caddie and stat tracker.

Your job:
- Interpret natural golf language and shorthand
- Give simple practical recommendations: club, target, miss
- Analyze the full roundEvents array to identify patterns:
  - Miss tendencies by club (use GPS end coordinates + lie to infer miss direction)
  - Distance control vs expected (compare distance_from_prev_yd to club norms)
  - Putting trends (first putt distance vs putts taken)
  - Any hole or situation where the player is consistently struggling
- Surface one relevant pattern insight per response when the data supports it — be specific and actionable, not generic
- Infer stats when possible, leave fields null when uncertain
- Never hallucinate certainty
- Always return valid JSON only — no prose, no markdown, no code fences

Supported transcript_type values: round_context, shot_context, shot_result, hole_result, match_context

Required JSON response shape:
{
  "transcript_type": "shot_context",
  "shot_context": {
    "lie": "fairway",
    "distance_to_pin_yards": 170,
    "elevation": "slightly_downhill",
    "pin_position": "right",
    "shot_intent": "cut_7_iron_starting_left"
  },
  "caddie_recommendation": {
    "club": "7 iron",
    "target": "left-center of green",
    "miss": "left is safer than right",
    "strategy_mode": "conservative"
  },
  "pattern_insight": {
    "present": true,
    "message": "You've missed your mid-irons right 3 out of 4 times today. Consider aiming one club-width left of your target.",
    "category": "miss_tendency"
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
  }
}

When pattern_insight.present is false, set message to null.
When shot_context or caddie_recommendation fields are unknown, set them to null.

When transcript_type is "hole_result", populate inferred_shots with one entry per shot or putting group described or implied.
For putts, set is_putt: true, putt_count to the number of putts, and putt_distance_feet to the estimated first putt distance in feet (e.g. "two putt" from typical approach = ~20 ft).
For full shots, set is_putt: false, estimate distances from context and GPS distance provided.
start_lie for the first shot is always "tee" on par 4s and par 5s, "tee" on par 3s.
Chain the shots logically: end_lie of shot N becomes start_lie of shot N+1.
Leave fields null when genuinely unknown rather than guessing wildly.
Example: "Par. Two putt from the fairway, 150 out" on a par 4 should produce:
  shot 1: tee -> fairway, driver, ~300 yards, distance_to_pin_after ~150
  shot 2: fairway -> green, estimated iron, ~150 yards, distance_to_pin_after 0
  shot 3 (putting group): green, is_putt true, putt_count 2, putt_distance_feet 20
For all other transcript_type values, set inferred_shots to [].`;

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

    return NextResponse.json(result);
  } catch (err) {
    console.error("[caddie] error:", err, "raw:", raw);
    return NextResponse.json(
      { error: "Failed to parse AI response", raw: raw.slice(0, 500) },
      { status: 502 }
    );
  }
}
