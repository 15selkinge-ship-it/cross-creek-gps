import type { Coordinate } from "./types";

const EARTH_RADIUS_METERS = 6371000;
const METERS_TO_YARDS = 1.0936133;
const FEET_PER_PACE = 3;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineDistanceMeters(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return EARTH_RADIUS_METERS * c;
}

export function metersToYards(meters: number): number {
  return meters * METERS_TO_YARDS;
}

export function distanceYards(a: Coordinate, b: Coordinate): number {
  return metersToYards(haversineDistanceMeters(a, b));
}

export function pacesToFeet(paces: number): number {
  return paces * FEET_PER_PACE;
}
