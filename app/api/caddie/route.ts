import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

async function loadHoleFeatures(holeNumber: number): Promise<string> {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(process.cwd(), "public", "course-features.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    const hole = data.holes[String(holeNumber)];
    if (!hole) return "";

    const lines = [
      `Hole ${holeNumber} — Par ${hole.par}, ${hole.yards_blue} yards, Handicap ${hole.handicap}`,
      `Shape: ${hole.shape?.replace("_", " ") ?? "straight"}`,
      `Description: ${hole.description}`,
      `Tee shot: ${hole.tee_shot}`,
      `Hazards: ${hole.hazards?.join(", ") ?? "none"}`,
      `Green: ${hole.green}`,
      `Strategy: ${hole.strategy}`,
      hole.lay_up_target ? `Lay-up target: ${hole.lay_up_target}` : null,
      `Miss: ${hole.miss}`,
    ].filter(Boolean);

    return lines.join("\n");
  } catch {
    return "";
  }
}

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
  verbal_summary?: string | null;
  audio_base64?: string | null;
}

interface ErrorResponse {
  error: string;
  raw?: string;
}

const SYSTEM_PROMPT = `You are a concise, experienced golf caddie and stat tracker.

CRITICAL — COURSE KNOWLEDGE RULE:
You have detailed course notes for each hole at Cross Creek Biggs-Kreigh which are provided in the user message. Use these notes to give specific, accurate caddie advice — referencing actual hazards, green slopes, and strategy for this specific hole. Do not invent additional hazards or features beyond what is in the course notes. If course notes are not provided for a hole, give generic directional advice only.

DISTANCE INTERPRETATION RULE:
Any distance the player states is always distance remaining to the pin, unless they explicitly say otherwise.
- "170 rough" = 170 yards to the pin, ball in the rough
- "7 iron 150" = 150 yards to the pin, hitting 7 iron
- "fairway, 140 out" = 140 yards to the pin from the fairway
- "hit it 170" = carried the ball 170 yards (shot distance, not pin distance)
- "laying up to 100" = will have 100 yards to the pin after the layup
- "laid up, 80 out" = 80 yards to the pin after layup
Never interpret a standalone number or "X out" as carry distance. Always treat it as distance to pin unless the player says "hit it X" or "I hit it X yards".

When populating shot_context.distance_to_pin_yards, use the stated distance directly.
When populating inferred_shots.estimated_distance_to_pin_after_yards for the previous shot, subtract the stated distance from the prior pin distance if known.

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

PUTT TENSE RULE — critical:
- Past tense ONLY triggers hole_result: "putted", "two putted", "made the putt", "missed it", "tapped in", "holed out", "3 putt", "lipped out", "got up and down", "two putt par", "three putt bogey"
- Present or future putt language is ALWAYS shot_context: "on the green", "looking at a two putt", "going to putt", "need to two putt", "have a birdie putt", "30 footer for par", "I'm putting"
- The key test: has the putt already been STRUCK AND COMPLETED? If not, it is shot_context, never hole_result.

Also use hole_result when:
- The player states putts taken in past tense (putts already completed), even without an explicit score word
- Examples that should ALL trigger hole_result:
  - "2 putt" (past — just finished)
  - "two putted"
  - "three putt"
  - "putted from 20 feet, 2 putt"
  - "made the putt"
  - "missed the putt, 3 putt"
  - "tapped in"
  - "holed it from off the green"
- Putting is always the final act of a hole — if the player describes putts ALREADY TAKEN, the hole is complete
- When hole_result is triggered by a putt statement and no explicit total score is given, infer hole_score from the full shot reconstruction
- Use the priorTranscripts to reconstruct all shots that happened before the putting

If you are unsure whether something is shot_result or hole_result, ask: has the putt already been struck and completed? If not, use shot_context. If yes, use hole_result.

GPS VS VOICE RECONCILIATION — read carefully:
- strokesThisHole = shots already GPS-button-logged by the player (may be 0 for voice-only rounds)
- priorTranscripts = ALL voice updates this hole, regardless of whether GPS was also used
- DO NOT add strokesThisHole to the count of priorTranscripts — they may describe the same shots
- Use priorTranscripts as the primary source of truth for shot sequence
- If strokesThisHole > count of shots described in priorTranscripts, add anonymous tee shot entries to fill the gap
- ALWAYS verify: sum of all inferred_shots stroke_value fields equals hole_score before returning
- If they do not match, recount and correct before responding

Example — par 4, priorTranscripts has "missed green, chipping from 20 yards", current transcript is "2 putt":
- Shot 1: tee (driver, tee to fairway)
- Shot 2: approach (missed green, rough/fairway to rough near green)
- Shot 3: chip (rough/fringe to green, ~20 yards)
- Shots 4-5: 2 putts
- Total: 5 strokes = bogey on par 4
- Do NOT return birdie. Do NOT assume only 2 shots before the putts.

hole_score should equal the total count of inferred_shots. Verify this before returning.

Use transcript_type "round_context" when:
- The player describes match play, handicap strokes, or overall round situation
- Examples: "9 hole match", "I'm getting two strokes", "I'm up 2"

Use transcript_type "match_context" when:
- The player describes the current match state mid-round

CADDIE RECOMMENDATION RULES:
- For shot_context: ALWAYS return club, target, miss, strategy_mode — no exceptions
- For shot_result: ALWAYS return caddie_recommendation unless the player has explicitly holed out or the hole is clearly over. After a bad shot (bunker, penalty, missed green) the player needs advice MORE not less — always give the next shot recommendation
- For hole_result: caddie_recommendation MAY be null — use verbal_summary instead (see below)
- Never return a generic "aim for the center" — use the lie, distance, and course notes to be specific

VERBAL SUMMARY RULE:
For hole_result, always populate verbal_summary with a 1-2 sentence spoken summary of the hole result. Examples: "Bogey five. Solid approach but the three-putt hurt." or "Par four, great scramble from the rough." or "Birdie! That's how you play it." For all other transcript_type values, set verbal_summary to null.

TONE AND STYLE:
- Speak like a real caddie — brief, confident, direct
- Use natural phrasing not robotic labels: say "take dead aim at the center" not "target: center of green"
- For the club recommendation, just name the club simply: "Seven iron" not "7 iron"
- For miss direction, phrase it naturally: "anything left is fine, stay away from the right bunker" — but ONLY mention bunkers if the course notes or player told you they exist
- Keep recommendations to 2-3 sentences maximum when spoken aloud
- If pattern insight is present, lead with it conversationally: "You've been pulling your irons left today, aim a touch right of your normal line"

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
  "inferred_shots": [],
  "verbal_summary": null
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

  const { transcript, priorTranscripts, gpsDistanceYards, currentHole, par, strokesThisHole, sgTotal, roundEvents, holeNumber } = body;

  console.log("[caddie] request:", JSON.stringify({ transcript, priorTranscripts, strokesThisHole, currentHole }));

  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return NextResponse.json({ error: "transcript is required" }, { status: 400 });
  }

  const holeFeatures = (holeNumber ?? currentHole) ? await loadHoleFeatures(holeNumber ?? currentHole ?? 1) : "";

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
  ${holeFeatures ? `\nCross Creek Biggs-Kreigh Hole ${holeNumber ?? currentHole} — Course Notes:\n${holeFeatures}\n` : ""}${priorContext}
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
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2000,
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
      verbal_summary: parsed.verbal_summary ?? null,
    };

    // Build TTS text and generate audio server-side
    function buildTTSText(res: CaddieResponse): string {
      // For hole_result use verbal_summary
      if (res.verbal_summary) return res.verbal_summary;
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

    console.log("[caddie] response type:", result.transcript_type, "hole_score:", result.round_update?.hole_score, "inferred_shots:", result.inferred_shots?.length ?? 0);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[caddie] error:", err, "raw:", raw);
    return NextResponse.json(
      { error: "Failed to parse AI response", raw: raw.slice(0, 500) },
      { status: 502 }
    );
  }
}
