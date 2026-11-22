import type { BodyMeasurement, ProgressPhoto } from "@fitos/types";

import { currentUserId, numOrNull, supabase, unwrap, type Row } from "./base";
import { removeImage, signedImageUrls, uploadImage } from "./storage";

export async function listMeasurements(limit = 120): Promise<BodyMeasurement[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("body_measurements")
      .select("id, measured_at, weight_kg, body_fat_pct, waist_cm, chest_cm, arms_cm, legs_cm, notes")
      .eq("user_id", userId)
      .order("measured_at", { ascending: false })
      .limit(limit),
  );
  return (rows ?? []).map((row: Row) => ({
    id: String(row.id),
    measured_at: String(row.measured_at),
    weight_kg: numOrNull(row.weight_kg),
    body_fat_pct: numOrNull(row.body_fat_pct),
    waist_cm: numOrNull(row.waist_cm),
    chest_cm: numOrNull(row.chest_cm),
    arms_cm: numOrNull(row.arms_cm),
    legs_cm: numOrNull(row.legs_cm),
    notes: (row.notes as string | null) ?? null,
  }));
}

export async function addMeasurement(input: Omit<BodyMeasurement, "id">): Promise<void> {
  const userId = await currentUserId();
  unwrap(await supabase.from("body_measurements").insert({ ...input, user_id: userId }));
}

export async function deleteMeasurement(id: string): Promise<void> {
  unwrap(await supabase.from("body_measurements").delete().eq("id", id));
}

export type ProgressPhotoWithUrl = ProgressPhoto & { url: string | null };

export async function listProgressPhotos(): Promise<ProgressPhotoWithUrl[]> {
  const userId = await currentUserId();
  const rows = unwrap(
    await supabase
      .from("progress_photos")
      .select("id, storage_path, taken_at, notes")
      .eq("user_id", userId)
      .order("taken_at", { ascending: false })
      .limit(60),
  );
  const photos = (rows ?? []) as ProgressPhoto[];
  const urls = await signedImageUrls("progress-photos", photos.map((photo) => photo.storage_path));
  return photos.map((photo) => ({ ...photo, url: urls[photo.storage_path] ?? null }));
}

export async function addProgressPhoto(file: Blob, notes: string | null): Promise<void> {
  const userId = await currentUserId();
  const path = await uploadImage("progress-photos", file);
  unwrap(
    await supabase
      .from("progress_photos")
      .insert({ user_id: userId, storage_path: path, notes, taken_at: new Date().toISOString() }),
  );
}

export async function deleteProgressPhoto(photo: ProgressPhoto): Promise<void> {
  unwrap(await supabase.from("progress_photos").delete().eq("id", photo.id));
  await removeImage("progress-photos", photo.storage_path);
}
