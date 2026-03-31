import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // Forward to OpenAI Whisper
    const whisperForm = new FormData();
    whisperForm.append("file", audioFile, "audio.webm");
    whisperForm.append("model", "whisper-1");
    whisperForm.append("language", "en");
    whisperForm.append("response_format", "json");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: whisperForm,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[transcribe] Whisper error:", response.status, err);
      return NextResponse.json({ error: `Whisper API error: ${response.status}` }, { status: 502 });
    }

    const data = await response.json();
    const transcript = data.text?.trim() ?? "";

    console.log("[transcribe] transcript:", transcript);
    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("[transcribe] error:", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
