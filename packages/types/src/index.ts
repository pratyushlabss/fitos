export type Visibility = "private" | "friends" | "public";

export type Provenance = {
  source: string;
  source_version: string;
  confidence: number;
};

export type Macronutrients = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type FoodItemPrediction = {
  name: string;
  portion_grams: number;
  macros: Macronutrients;
  brand: string | null;
  barcode: string | null;
  usda_fdc_id: string | null;
  provenance: Provenance;
};

export type NormalizedFoodPrediction = {
  items: FoodItemPrediction[];
  overall_confidence: number;
  provenance: Provenance;
  notes: string | null;
};

export type NutritionLookup = {
  name: string;
  brand: string | null;
  barcode: string | null;
  serving_grams: number;
  macros_per_serving: Macronutrients;
  provenance: Provenance;
  external_id: string;
};

export type WorkoutSet = {
  id: string;
  set_index: number;
  reps: number;
  weight_kg: number;
  rpe: number | null;
  is_warmup: boolean;
  completed: boolean;
};

export type WorkoutExercise = {
  id: string;
  exercise_id: string | null;
  exercise_name: string;
  muscle_group: string | null;
  equipment: string | null;
  order_index: number;
  notes: string | null;
  sets: WorkoutSet[];
};

export type Workout = {
  id: string;
  user_id: string;
  title: string;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  visibility: Visibility;
  total_volume_kg: number;
  exercises: WorkoutExercise[];
};

export type ActivitySport = "run" | "ride" | "walk" | "hike" | "other";
export type ActivitySource =
  | "native_gps"
  | "apple_health"
  | "health_connect"
  | "gpx"
  | "fit";

export type GeoPoint = {
  lat: number;
  lng: number;
  elevation_m: number | null;
  recorded_at: string | null;
};

export type Activity = {
  id: string;
  user_id: string;
  sport: ActivitySport;
  source: ActivitySource;
  started_at: string;
  ended_at: string | null;
  duration_s: number;
  distance_m: number;
  elevation_gain_m: number;
  avg_pace_s_per_km: number | null;
  polyline: GeoPoint[];
  visibility: Visibility;
  title: string | null;
};
