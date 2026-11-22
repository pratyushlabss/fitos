export async function shareStoryCard(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({
      files: [file],
      title: "FitOS",
      text: "Session complete",
    });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function createStoryCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  return canvas;
}

export type ShareCardData = {
  eyebrow: string;
  title: string;
  subtitle: string;
  stats: Array<{ label: string; value: string }>;
  lines: string[];
  footer: string;
};

export async function renderShareCard(data: ShareCardData): Promise<Blob> {
  const canvas = createStoryCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const { width, height } = canvas;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#0B1220");
  bg.addColorStop(0.55, "#070b14");
  bg.addColorStop(1, "#06281d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.8, height * 0.15, 0, width * 0.8, height * 0.15, 700);
  glow.addColorStop(0, "rgba(61,220,151,0.35)");
  glow.addColorStop(1, "rgba(61,220,151,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const font = "Inter, -apple-system, system-ui, sans-serif";
  ctx.fillStyle = "#3DDC97";
  ctx.font = `600 40px ${font}`;
  ctx.fillText(data.eyebrow.toUpperCase(), 96, 220);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 96px ${font}`;
  wrapText(ctx, data.title, 96, 340, width - 192, 108, 2);
  ctx.fillStyle = "#8B98B3";
  ctx.font = `500 44px ${font}`;
  ctx.fillText(data.subtitle, 96, 590);

  data.stats.slice(0, 4).forEach((stat, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 96 + col * 460;
    const y = 700 + row * 260;
    ctx.fillStyle = "rgba(18,26,43,0.9)";
    roundRect(ctx, x, y, 428, 220, 40);
    ctx.fill();
    ctx.fillStyle = "#8B98B3";
    ctx.font = `600 32px ${font}`;
    ctx.fillText(stat.label.toUpperCase(), x + 40, y + 70);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 72px ${font}`;
    ctx.fillText(stat.value, x + 40, y + 160, 360);
  });

  ctx.fillStyle = "#d1d9e6";
  ctx.font = `500 40px ${font}`;
  data.lines.slice(0, 6).forEach((line, index) => ctx.fillText(line, 96, 1300 + index * 64, width - 192));

  ctx.fillStyle = "#3DDC97";
  ctx.font = `700 48px ${font}`;
  ctx.fillText("FitOS", 96, height - 140);
  ctx.fillStyle = "#8B98B3";
  ctx.font = `500 36px ${font}`;
  ctx.fillText(data.footer, 96, height - 84);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render card"))), "image/png"));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      line = word;
      if (lines >= maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y + lines * lineHeight, maxWidth);
}

export function shareFileNow(file: File, text: string): Promise<"shared" | "downloaded" | "cancelled"> {
  if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.({ files: [file] })) {
    return navigator
      .share({ files: [file], title: "FitOS", text })
      .then(() => "shared" as const)
      .catch((error: unknown) => (error instanceof DOMException && error.name === "AbortError" ? "cancelled" : Promise.reject(error)));
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Promise.resolve("downloaded");
}
