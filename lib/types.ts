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

export type SGCategory = "off_tee" | "approach" | "short_game" | "putting" | "penalty";

export type SGCategoryTotals = Record<SGCategory, number>;

export type SGMeta = {
  sg: number;
  sg_category: SGCategory;
};

export type ShotEvent = {
  id: string;
  hole: number;
  type: "shot";
  stroke_value: 1;
  timestamp: string;
  lat?: number;
  lng?: number;
  distance_from_prev_yd?: number;
  start_distance_yds?: number;
  end_distance_yds?: number;
  start_lie?: Exclude<LieType, "penalty">;
  end_lie?: LieType;
  notes?: string;
} & Partial<SGMeta>;

export type PenaltyEvent = {
  id: string;
  hole: number;
  type: "penalty";
  stroke_value: 1;
  timestamp: string;
  notes?: string;
} & Partial<SGMeta>;

export type GreenEvent = {
  id: string;
  type: "green";
  hole: number;
  first_putt_paces: number;
  first_putt_ft: number;
  putts: number;
  stroke_value: number;
  timestamp: string;
} & Partial<SGMeta>;

export type StrokeEvent = ShotEvent | PenaltyEvent | GreenEvent;

export type Round = {
  id: string;
  started_at: string;
  updated_at: string;
  tee_set_id: string;
  current_hole: number;
  events: StrokeEvent[];
  sg_total?: number;
  sg_by_category?: SGCategoryTotals;
  sg_baseline_version?: string;
};
