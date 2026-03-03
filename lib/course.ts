import type { CourseGps } from "./types";

export async function fetchCourse(): Promise<CourseGps> {
  const response = await fetch("/api/course-gps", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load course data.");
  }
  return (await response.json()) as CourseGps;
}
