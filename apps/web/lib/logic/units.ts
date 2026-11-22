import type { UnitSystem } from "@fitos/types";

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

export function weightUnit(units: UnitSystem): "kg" | "lb" {
  return units === "imperial" ? "lb" : "kg";
}

export function lengthUnit(units: UnitSystem): "cm" | "in" {
  return units === "imperial" ? "in" : "cm";
}

export function toDisplayWeight(kg: number, units: UnitSystem): number {
  const value = units === "imperial" ? kg / KG_PER_LB : kg;
  return Math.round(value * 10) / 10;
}

export function fromDisplayWeight(value: number, units: UnitSystem): number {
  return units === "imperial" ? Math.round(value * KG_PER_LB * 1000) / 1000 : value;
}

export function toDisplayLength(cm: number, units: UnitSystem): number {
  const value = units === "imperial" ? cm / CM_PER_IN : cm;
  return Math.round(value * 10) / 10;
}

export function fromDisplayLength(value: number, units: UnitSystem): number {
  return units === "imperial" ? Math.round(value * CM_PER_IN * 100) / 100 : value;
}

export function formatWeight(kg: number, units: UnitSystem): string {
  return `${toDisplayWeight(kg, units).toLocaleString()} ${weightUnit(units)}`;
}

export function formatVolume(kg: number, units: UnitSystem): string {
  const value = toDisplayWeight(kg, units);
  const unit = weightUnit(units);
  return value >= 10000 ? `${(value / 1000).toFixed(1)}k ${unit}` : `${Math.round(value).toLocaleString()} ${unit}`;
}
