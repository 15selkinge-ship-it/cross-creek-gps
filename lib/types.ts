export type Coordinate = {
  lat: number;
  lng: number;
};

export type Hole = {
  hole: number;
  tee: Coordinate;
  green_center: Coordinate;
};

export type TeeSet = {
  id: string;
  name: string;
  holes: Hole[];
};

export type Course = {
  course: string;
  tee_sets: TeeSet[];
};

export type LieType = "fairway" | "rough" | "sand" | "green" | "penalty";

export type StrokeEvent = {
  id: string;
  hole: number;
  type: "shot" | "penalty";
  stroke_value: 1;
  timestamp: string;
  lat?: number;
  lng?: number;
  distance_from_prev_yd?: number;
  lie?: LieType;
  putt_distance_ft?: number;
  notes?: string;
};

export type Round = {
  id: string;
  started_at: string;
  updated_at: string;
  tee_set_id: string;
  current_hole: number;
  events: StrokeEvent[];
};
