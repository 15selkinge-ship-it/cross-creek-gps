import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import type { CourseGps } from "@/lib/types";

export async function GET() {
  try {
    const filePath = join(process.cwd(), "data", "course-gps.json");
    const raw = await readFile(filePath, "utf8");
    const courseGps = JSON.parse(raw) as CourseGps;
    return NextResponse.json(courseGps);
  } catch {
    return NextResponse.json({ error: "Could not load course GPS data." }, { status: 500 });
  }
}
