export type DashboardSeed = {
  date: string;
  greeting: string;
  daily_score: number;
  readiness_score: number;
  workout_title: string;
  workout_volume_kg: number;
  total_calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  today_steps: number;
  active_calories: number;
  sleep_hours: number;
  training_load: number;
  recovery_label: string;
  recent_meals: Array<{ name: string; calories: number; protein_g: number }>;
  recent_workouts: Array<{ name: string; volume_kg: number; status: string }>;
  recent_activity: Array<{ type: string; value: string; status: string }>;
};

export const dashboardSeed: DashboardSeed = {
  date: "Wed, Sep 23",
  greeting: "Good morning",
  daily_score: 82,
  readiness_score: 84,
  workout_title: "Upper Body Strength",
  workout_volume_kg: 210,
  total_calories: 1640,
  protein_g: 126,
  carbs_g: 170,
  fat_g: 52,
  today_steps: 9620,
  active_calories: 428,
  sleep_hours: 7.4,
  training_load: 116,
  recovery_label: "Recovered",
  recent_meals: [
    { name: "Chicken biryani", calories: 540, protein_g: 26 },
    { name: "Overnight oats", calories: 420, protein_g: 30 },
    { name: "Protein shake", calories: 260, protein_g: 28 },
  ],
  recent_workouts: [{ name: "Bench Press", volume_kg: 72, status: "planned" }],
  recent_activity: [
    { type: "Steps", value: "9,620", status: "on track" },
    { type: "Active energy", value: "428 kcal", status: "steady" },
  ],
};

export type RecommendationSeed = {
  exercise: string;
  target: string;
  reason: string;
  sets: Array<{ reps: number; weight_kg: number; rpe: number; completed: boolean }>;
};

export const recommendationSeed: RecommendationSeed[] = [
  {
    exercise: "Bench Press",
    target: "70 kg × 8",
    reason: "You completed 67.5 kg × 8 last session with RIR 2. A small progression is suggested.",
    sets: [
      { reps: 8, weight_kg: 70, rpe: 8.2, completed: false },
      { reps: 8, weight_kg: 67.5, rpe: 8.5, completed: false },
    ],
  },
  {
    exercise: "Pull-up",
    target: "5 reps × 4 sets",
    reason: "Last week you handled 3 × 5 with controlled tempo. Volume is still within your recovery window.",
    sets: [
      { reps: 5, weight_kg: 0, rpe: 7.8, completed: false },
      { reps: 5, weight_kg: 0, rpe: 8.2, completed: false },
    ],
  },
];

export const mealSeed = [
  { name: "Chicken Biryani", calories: 540, protein: 26, carbs: 52, fat: 18 },
  { name: "Greek Yogurt Bowl", calories: 320, protein: 29, carbs: 18, fat: 10 },
  { name: "Salad Wrap", calories: 410, protein: 19, carbs: 35, fat: 14 },
];

export const activitySeed = [
  { title: "Tempo run", distance: "8.4 km", duration: "41 min", calories: "420 kcal" },
  { title: "Cycle commute", distance: "12.7 km", duration: "33 min", calories: "310 kcal" },
  { title: "Walk", distance: "5.1 km", duration: "52 min", calories: "220 kcal" },
];
