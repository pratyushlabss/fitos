export const RECOVERY_ALGORITHM = "recovery_v1.0";

type Metric = number | null;

export type RecoveryFeatures = {
  sleep_hours: Metric;
  sleep_score: Metric;
  stress_score: Metric;
  soreness_score: Metric;
  training_load: Metric;
  workout_count: Metric;
  activity_load: Metric;
  calories: Metric;
  protein_g: Metric;
  hrv: Metric;
  resting_hr: Metric;
  protein_target_g: number;
  calorie_target: number;
};

export type ComponentKey = "sleep" | "stress" | "training_load" | "activity_load" | "nutrition" | "soreness" | "cardio";

const WEIGHTS: Record<ComponentKey, number> = {
  sleep: 0.25,
  stress: 0.1,
  training_load: 0.2,
  activity_load: 0.1,
  nutrition: 0.15,
  soreness: 0.1,
  cardio: 0.1,
};

const COMPLETENESS: Record<string, number> = {
  sleep: 20,
  cardio: 15,
  workout: 15,
  nutrition: 15,
  activity: 10,
  stress: 10,
  soreness: 10,
  hydration: 5,
};

export type RecoveryResult = {
  recovery_score: number | null;
  readiness_score: number | null;
  inputs: Record<ComponentKey, number | null>;
  missing_inputs: ComponentKey[];
  data_completeness: number;
  confidence: number;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

function sleep(f: RecoveryFeatures): number | null {
  const parts: number[] = [];
  if (f.sleep_hours !== null) parts.push(Math.min(f.sleep_hours / 8, 1.15) * 100);
  if (f.sleep_score !== null) parts.push(f.sleep_score);
  return parts.length ? clamp(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
}

function inverse(value: Metric): number | null {
  return value === null ? null : clamp(100 - value);
}

function training(f: RecoveryFeatures): number | null {
  if (f.training_load === null) return f.workout_count === null ? null : 88;
  return clamp(100 - Math.min(f.training_load, 120) * 0.7);
}

function activity(f: RecoveryFeatures): number | null {
  if (f.activity_load === null) return null;
  const v = f.activity_load;
  return clamp(v <= 70 ? 55 + v * 0.5 : 90 - (v - 70) * 0.4);
}

function nutrition(f: RecoveryFeatures): number | null {
  if (f.calories === null) return null;
  const protein = f.protein_g === null ? 70 : Math.min(100, (f.protein_g / f.protein_target_g) * 100);
  const calories = 100 - Math.min(Math.abs(f.calories - f.calorie_target) / (f.calorie_target / 100), 40);
  return clamp(protein * 0.6 + calories * 0.4);
}

function cardio(f: RecoveryFeatures): number | null {
  const parts: number[] = [];
  if (f.hrv !== null) parts.push(Math.min(f.hrv / 70, 1.2) * 100);
  if (f.resting_hr !== null) parts.push(Math.max(0, 100 - Math.max(0, f.resting_hr - 50) * 2));
  return parts.length ? clamp(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
}

export function scoreDay(f: RecoveryFeatures): RecoveryResult {
  const inputs: Record<ComponentKey, number | null> = {
    sleep: sleep(f),
    stress: inverse(f.stress_score),
    training_load: training(f),
    activity_load: activity(f),
    nutrition: nutrition(f),
    soreness: inverse(f.soreness_score),
    cardio: cardio(f),
  };
  const keys = Object.keys(WEIGHTS) as ComponentKey[];
  const present = keys.filter((key) => inputs[key] !== null);
  const missing = keys.filter((key) => inputs[key] === null);

  let recovery: number | null = null;
  if (present.length) {
    const weightSum = present.reduce((sum, key) => sum + WEIGHTS[key], 0);
    recovery = Math.round(present.reduce((sum, key) => sum + (inputs[key] ?? 0) * WEIGHTS[key], 0) / weightSum);
  }
  let readiness = recovery;
  if (recovery !== null && f.training_load !== null) {
    const freshness = Math.max(0, 100 - Math.min(f.training_load, 100));
    readiness = Math.round(recovery * 0.85 + freshness * 0.15);
  }

  const domains: Record<string, boolean> = {
    sleep: f.sleep_hours !== null || f.sleep_score !== null,
    cardio: f.hrv !== null || f.resting_hr !== null,
    workout: f.workout_count !== null,
    nutrition: f.calories !== null,
    activity: f.activity_load !== null,
    stress: f.stress_score !== null,
    soreness: f.soreness_score !== null,
    hydration: false,
  };
  const total = Object.values(COMPLETENESS).reduce((a, b) => a + b, 0);
  const completeness = Math.round(
    (100 * Object.entries(domains).reduce((sum, [key, ok]) => sum + (ok ? COMPLETENESS[key] : 0), 0)) / total,
  );

  const coverage = present.length / keys.length;
  let confidence = (completeness / 100) * 0.55 + coverage * 0.25 + 0.7 * 0.2;
  if (missing.includes("sleep")) confidence = Math.min(confidence, 0.58);
  if (!missing.includes("sleep") && !missing.includes("cardio") && completeness >= 80) confidence = Math.max(confidence, 0.8);
  confidence = Math.round(Math.max(0, Math.min(1, confidence)) * 1000) / 1000;

  return {
    recovery_score: recovery,
    readiness_score: readiness,
    inputs,
    missing_inputs: missing,
    data_completeness: completeness,
    confidence,
  };
}

export function readinessLabel(score: number | null): "unknown" | "high" | "moderate" | "low" {
  if (score === null) return "unknown";
  if (score >= 80) return "high";
  if (score >= 65) return "moderate";
  return "low";
}

export type CoachAdvice = { headline: string; body: string; recommendation: string; focus: string[] };

const COMPONENT_NAMES: Record<ComponentKey, string> = {
  sleep: "sleep",
  stress: "stress",
  training_load: "training load",
  activity_load: "activity",
  nutrition: "nutrition",
  soreness: "soreness",
  cardio: "resting heart rate",
};

export function componentName(key: ComponentKey): string {
  return COMPONENT_NAMES[key];
}

export function explain(result: RecoveryResult, soreness: Metric): CoachAdvice {
  if (result.recovery_score === null) {
    return {
      headline: "Recovery unavailable",
      body: `There is not enough data for a score yet. Missing: ${result.missing_inputs.map(componentName).join(", ") || "core signals"}.`,
      recommendation: "Log sleep and at least one of training, nutrition or a check-in.",
      focus: ["complete today's check-in"],
    };
  }
  const helpers: string[] = [];
  const drags: string[] = [];
  const { inputs } = result;
  if ((inputs.sleep ?? 0) >= 75) helpers.push("sleep");
  else if (inputs.sleep !== null) drags.push("sleep");
  if ((inputs.nutrition ?? 0) >= 75) helpers.push("nutrition");
  if (inputs.training_load !== null && inputs.training_load < 70) drags.push("training load");
  if (inputs.soreness !== null && inputs.soreness < 70) drags.push("soreness");
  if (inputs.stress !== null && inputs.stress < 60) drags.push("stress");

  const score = result.recovery_score;
  const [headline, recommendation] =
    score >= 75
      ? [`Recovery ${score}: good`, "Moderate to full training is reasonable. Keep 1–3 reps in reserve on last sets."]
      : score >= 60
        ? [`Recovery ${score}: moderate`, "Keep training moderate. Avoid taking lower-body sets to failure."]
        : [`Recovery ${score}: low`, "Prioritise easy movement, protein and sleep. Skip failure sets."];

  const helperText = helpers.length ? helpers.join(" and ") : "the signals you logged";
  const dragText = drags.length ? drags.join(" and ") : "nothing major";
  let body = `${capitalize(helperText)} ${helpers.length === 1 ? "is" : "are"} helping. The main constraint is ${dragText}.`;
  body += ` Confidence ${Math.round(result.confidence * 100)}% from ${result.data_completeness}% data completeness.`;

  const focus = ["hydration", "protein target", "earlier bedtime"];
  if (soreness !== null && soreness >= 60) focus.unshift("light mobility");
  return { headline, body, recommendation, focus };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
