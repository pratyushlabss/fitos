import { compressImage, extensionFor } from "@/lib/image";

import { currentUserId, supabase } from "./base";

export type Bucket = "avatars" | "post-media" | "progress-photos";

export async function uploadImage(bucket: Bucket, file: Blob): Promise<string> {
  const userId = await currentUserId();
  const compressed = await compressImage(file);
  const path = `${userId}/${crypto.randomUUID()}.${extensionFor(compressed)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, compressed, {
    contentType: compressed.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function removeImage(bucket: Bucket, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}

export function publicImageUrl(bucket: Bucket, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function signedImageUrls(bucket: Bucket, paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unique, 60 * 60);
  if (error) throw new Error(error.message);
  const map: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
  }
  return map;
}
