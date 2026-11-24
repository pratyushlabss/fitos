// Stable ids for fitos_food_db rows: UUIDs pass through, text ids map to UUIDv5.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NS = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
export async function uuidFor(id: string): Promise<string> {
  if (UUID.test(id)) return id.toLowerCase();
  const ns = NS.replace(/-/g, "").match(/../g)!.map((h) => parseInt(h, 16));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-1", new Uint8Array([...ns, ...new TextEncoder().encode(`fitos_food_db:${id}`)]))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
