import type { Course } from "./types";

export async function fetchCourse(): Promise<Course> {
  const response = await fetch("/course.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load course data.");
  }
  return (await response.json()) as Course;
}
