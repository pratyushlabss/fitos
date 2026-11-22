import type { GeoPoint } from "@fitos/types";

const EARTH_RADIUS_M = 6371000;

export function distanceBetween(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function totalDistance(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceBetween(points[i - 1], points[i]);
  return total;
}

export function elevationGain(points: GeoPoint[]): number {
  let gain = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].elevation_m;
    const next = points[i].elevation_m;
    if (prev !== null && next !== null && next - prev > 1) gain += next - prev;
  }
  return Math.round(gain);
}

export function paceSecondsPerKm(distanceM: number, durationS: number): number | null {
  if (distanceM < 50 || durationS <= 0) return null;
  return durationS / (distanceM / 1000);
}

export function formatPace(secondsPerKm: number | null): string {
  if (!secondsPerKm || !Number.isFinite(secondsPerKm)) return "–";
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

export function caloriesEstimate(sport: string, distanceM: number, weightKg = 75): number {
  const perKmPerKg = sport === "ride" ? 0.3 : sport === "walk" || sport === "hike" ? 0.75 : 1.0;
  return Math.round((distanceM / 1000) * weightKg * perKmPerKg);
}

export function parseGpx(xml: string): { points: GeoPoint[]; name: string | null } {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("This file is not valid GPX.");
  const nodes = Array.from(doc.getElementsByTagName("trkpt")).concat(Array.from(doc.getElementsByTagName("rtept")));
  const points: GeoPoint[] = nodes
    .map((node) => {
      const ele = node.getElementsByTagName("ele")[0]?.textContent;
      const time = node.getElementsByTagName("time")[0]?.textContent;
      return {
        lat: Number(node.getAttribute("lat")),
        lng: Number(node.getAttribute("lon")),
        elevation_m: ele ? Number(ele) : null,
        recorded_at: time ?? null,
      };
    })
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (points.length < 2) throw new Error("The GPX file has no track points.");
  const name = doc.getElementsByTagName("name")[0]?.textContent ?? null;
  return { points, name };
}

export function simplify(points: GeoPoint[], maxPoints = 600): GeoPoint[] {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const result: GeoPoint[] = [];
  for (let i = 0; i < maxPoints; i += 1) result.push(points[Math.floor(i * step)]);
  result.push(points[points.length - 1]);
  return result;
}

export function projectRoute(points: GeoPoint[], width: number, height: number, padding = 8): string {
  if (points.length < 2) return "";
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const spanX = Math.max((maxLng - minLng) * Math.cos(midLat), 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return points
    .map((p, i) => {
      const x = offsetX + (p.lng - minLng) * Math.cos(midLat) * scale;
      const y = height - (offsetY + (p.lat - minLat) * scale);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
