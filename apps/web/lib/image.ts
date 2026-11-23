const MAX_EDGE = 1280;
const TARGET_BYTES = 300 * 1024;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to <img> decoding
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function draw(source: ImageBitmap | HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function compressImage(file: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
  const source = await decode(file);
  let best: Blob | null = null;
  for (const edge of [maxEdge, Math.min(maxEdge, 1024), 800].filter((value, index, list) => list.indexOf(value) === index)) {
    const canvas = draw(source, edge);
    for (const quality of [0.82, 0.72, 0.62, 0.52]) {
      let blob = await encode(canvas, "image/webp", quality);
      if (!blob || blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg", quality);
      if (!blob) continue;
      best = blob;
      if (blob.size <= TARGET_BYTES) return blob;
    }
  }
  if (!best) throw new Error("Could not compress image");
  return best;
}

export function extensionFor(blob: Blob): string {
  return blob.type === "image/webp" ? "webp" : "jpg";
}
