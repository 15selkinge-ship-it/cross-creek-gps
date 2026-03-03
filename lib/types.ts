export type Coordinate = {
  lat: number;
  lng: number;
};

export type HoleGps = {
  tee: Coordinate;
  greenCenter: Coordinate;
};

export type CourseGps = {
  holes: Record<string, HoleGps>;
  parByHole?: Record<string, number>;
};

export type LieType = "fairway" | "rough" | "sand" | "green" | "penalty";
export type StartLieType = Exclude<LieType, "penalty"> | "tee";

export type SGCategory = "off_tee" | "approach" | "short_game" | "putting" | "penalty";

export type SGCategoryTotals = Record<SGCategory, number>;

export type SGDebugInfo = {
  category: SGCategory;
  start_lie: StartLieType | "penalty";
  start_distance: number;
  start_unit: "yd" | "ft";
  end_lie: LieType | "holed";
  end_distance: number;
  end_unit: "yd" | "ft";
  e_start: number;
  e_end: number;
  sg_shot: number;
};

export type SGMeta = {
  sg: number;
  sg_category: SGCategory;
  sg_debug?: SGDebugInfo;
};

export type ShotEvent = {
  id: string;
  hole: number;
  type: "shot";
  stroke_value: 1;
  timestamp: string;
  lat: number;
  lng: number;
  distance_from_prev_yd: number;
  start_distance_yds: number;
  end_distance_yds: number;
  start_lie: StartLieType;
  end_lie: LieType;
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
  ended_at?: string;
  updated_at: string;
  tee_set_id: string;
  current_hole: number;
  events: StrokeEvent[];
  sg_total?: number;
  sg_by_category?: SGCategoryTotals;
  sg_baseline_version?: string;
};
