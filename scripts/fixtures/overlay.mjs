// Draws detected (red) and true (green) corners over the lab's photos: node scripts/fixtures/overlay.mjs <out-dir> [filter]
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
const [out, filter = ""] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const rows = JSON.parse(readFileSync("fixtures/out/report.json", "utf8"));
const photos = JSON.parse(readFileSync("fixtures/synthetic/photos.json", "utf8"));
for (const r of rows.filter((r) => r.corners && r.name.includes(filter) && photos[r.name])) {
  const p = photos[r.name];
  const poly = (q, c) => `<polygon points="${q.map((x) => x.join(",")).join(" ")}" fill="none" stroke="${c}" stroke-width="6"/>`;
  const svg = `<svg width="${p.width}" height="${p.height}" xmlns="http://www.w3.org/2000/svg">${poly(p.corners, "#0f0")}${poly(r.corners, "#f00")}<text x="20" y="60" font-size="48" fill="#ff0" font-family="Helvetica">${r.method} ${r.iou}</text></svg>`;
  const buf = await sharp(`fixtures/synthetic/photos/${r.name}.jpg`).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  await sharp(buf).resize(640).jpeg().toFile(`${out}/${r.name}.jpg`);
}
