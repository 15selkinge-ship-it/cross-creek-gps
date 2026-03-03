import type { Round } from "./types";

export const ROUND_STORAGE_KEY = "cc_round_v1";

export function getStoredRound(): Round | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(ROUND_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Round;
  } catch {
    return null;
  }
}

export function saveRound(round: Round): void {
  if (typeof window === "undefined") {
    return;
  }

  const withTimestamp: Round = {
    ...round,
    updated_at: new Date().toISOString(),
  };
  window.localStorage.setItem(ROUND_STORAGE_KEY, JSON.stringify(withTimestamp));
}

export function clearStoredRound(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ROUND_STORAGE_KEY);
}
