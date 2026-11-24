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

export type UnitSystem = "metric" | "imperial";
export type Goal = "build_muscle" | "lose_fat" | "strength" | "endurance" | "general";

export type Profile = {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
  unit_system: UnitSystem;
  default_visibility: Visibility;
  goal: Goal | null;
  height_cm: number | null;
  calorie_target: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
  timezone: string;
  onboarded_at: string | null;
};

export type ProfileCard = {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  is_private: boolean;
  followers: number;
  following: number;
  workouts: number;
  follow_status: "pending" | "accepted" | null;
  follows_me: boolean;
  blocked_by_me: boolean;
  can_view: boolean;
  streak: number | null;
  volume_30d: number | null;
  workouts_30d: number | null;
  prs_30d: number | null;
};

export type ProfileSearchResult = {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  is_private: boolean;
  follow_status: "pending" | "accepted" | null;
};

export type Exercise = {
  id: string;
  user_id: string | null;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  is_global: boolean;
};

export type RoutineExercise = {
  id: string;
  routine_id: string;
  exercise_id: string | null;
  exercise_name: string;
  order_index: number;
  sets: number;
  reps: number;
  target_weight_kg: number | null;
};

export type Routine = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  routine_exercises: RoutineExercise[];
};

export type WorkoutWithDetail = Workout & {
  routine_id: string | null;
};

export type PersonalRecordType = "max_weight" | "max_reps" | "estimated_1rm" | "volume";

export type PersonalRecord = {
  id: string;
  exercise_name: string;
  record_type: PersonalRecordType;
  value: number;
  workout_id: string | null;
  achieved_at: string;
};

export type MealType = "breakfast" | "lunch" | "dinner" | "snacks";

export type MealItem = {
  id: string;
  meal_id: string;
  name: string;
  amount_grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  quantity: number;
  unit: ServingUnit;
  food_id: string | null;
  source: MealItemSource;
  source_version: string | null;
  confidence: number;
  analysis_id: string | null;
};

export type Meal = {
  id: string;
  meal_type: MealType;
  log_date: string;
  meal_items: MealItem[];
};

export type MealItemSource = "search" | "text_ai" | "photo_ai" | "barcode" | "manual" | "chat";
export type ServingUnit = "roti" | "katori" | "ladle" | "piece" | "plate" | "cup" | "tbsp" | "g" | "serving";
export type FoodSource = "ifct" | "ai" | "user" | "barcode" | "verified";
export type Per100 = { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number };
export type Serving = { unit: ServingUnit; grams: number; label: string | null; specific?: boolean };

export type FoodHit = {
  food_id: string;
  name: string;
  cuisine: string | null;
  source: FoodSource;
  verified: boolean;
  is_dish: boolean;
  is_own: boolean;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g: number | null;
  serving_grams: number | null;
  servings: Serving[];
  score?: number;
};

export type DraftIngredient = { food_id: string | null; name: string; grams: number; per100: Per100; source: FoodSource; notes: string | null };

export type DraftItem = {
  key: string;
  food_id: string | null;
  name: string;
  is_dish: boolean;
  cuisine: string | null;
  quantity: number;
  unit: ServingUnit;
  grams: number;
  per100: Per100;
  source: FoodSource;
  own: boolean;
  confidence: number;
  match_score: number | null;
  ingredients: DraftIngredient[];
  servings: Serving[];
};

export type FoodDraft = {
  analysis_id: string | null;
  input_type: "text" | "photo" | "barcode";
  input_text: string | null;
  image_path: string | null;
  cuisine: string | null;
  confidence: number;
  question: string | null;
  items: DraftItem[];
  meal_type: MealType | null;
  date: string | null;
  cache_hit: boolean;
  ai_calls: number;
  candidates_count: number;
  // Server sanity-check notes: adjusted portions, dropped low-confidence items, second look.
  notes?: string[];
};

export type NutritionDay = {
  log_date: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  items: number;
};

export type FavouriteMealItem = {
  id: string;
  food_id: string | null;
  name: string;
  quantity: number;
  unit: ServingUnit;
  grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
};

export type FavouriteMeal = { id: string; name: string; meal_type: MealType | null; favourite_meal_items: FavouriteMealItem[] };

export type CoachMessage = { id: string; role: "user" | "assistant"; content: string; created_at: string };

export type BodyMeasurement = {
  id: string;
  measured_at: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  waist_cm: number | null;
  chest_cm: number | null;
  arms_cm: number | null;
  legs_cm: number | null;
  notes: string | null;
};

export type ProgressPhoto = {
  id: string;
  storage_path: string;
  taken_at: string;
  notes: string | null;
};

export type RecoveryCheckIn = {
  day: string;
  sleep_hours: number | null;
  sleep_quality: number | null;
  stress: number | null;
  soreness: number | null;
  resting_hr: number | null;
  notes: string | null;
};

export type RecoveryDay = {
  day: string;
  recovery_score: number | null;
  readiness_score: number | null;
  confidence: number;
  data_completeness: number;
  missing_inputs: string[];
  components: Record<string, number | null>;
};

export type PostType = "workout" | "activity" | "achievement" | "challenge" | "text" | "photo";

export type FeedPost = {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  post_type: PostType;
  body: string | null;
  media_path: string | null;
  workout_id: string | null;
  workout_title: string | null;
  workout_volume_kg: number | null;
  workout_started_at: string | null;
  workout_completed_at: string | null;
  workout_exercise_count: number | null;
  activity_id: string | null;
  activity_sport: ActivitySport | null;
  activity_distance_m: number | null;
  activity_duration_s: number | null;
  visibility: Visibility;
  created_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  saved_by_me: boolean;
};

export type PostComment = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profiles: { username: string | null; display_name: string; avatar_url: string | null } | null;
};

export type LeaderboardRow = {
  user_id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  volume_kg: number;
  workouts: number;
  streak: number;
  is_me: boolean;
};

export type AppNotification = {
  kind: "like" | "comment" | "follow" | "follow_request";
  actor_id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  post_id: string | null;
  body: string | null;
  created_at: string;
};

export type ConversationSummary = {
  conversation_id: string;
  other_user_id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
  last_body: string | null;
  last_at: string | null;
  last_sender_id: string | null;
  unread: number;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};
