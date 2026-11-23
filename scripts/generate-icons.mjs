// One-off: render PWA icons from apps/web/public/icon.svg. Run with `node scripts/generate-icons.mjs`.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, "apps/web/public");
const svg = await readFile(path.join(publicDir, "icon.svg"), "utf8");

// iOS and Android masks crop the corners themselves, so those variants get a full-bleed square.
const fullBleed = svg.replace(/<rect([^>]*?)\srx="[^"]*"/, "<rect$1");

const outputs = [
  { file: "icon-192.png", size: 192, source: svg },
  { file: "icon-512.png", size: 512, source: svg },
  { file: "icon-maskable-512.png", size: 512, source: fullBleed },
  { file: "apple-touch-icon.png", size: 180, source: fullBleed },
];

for (const { file, size, source } of outputs) {
  await sharp(Buffer.from(source), { density: Math.ceil((size / 64) * 72) })
    .resize(size, size)
    .flatten(file === "icon-192.png" || file === "icon-512.png" ? false : { background: "#121A2B" })
    .png()
    .toFile(path.join(publicDir, file));
  console.log(`wrote ${file}`);
}
