// Contact sheet: node scripts/fixtures/sheet.mjs <dir> <out.jpg> [cell=300]
import sharp from "sharp";
import { readdirSync } from "node:fs";
const [dir, out, cellArg] = process.argv.slice(2);
const cell = Number(cellArg || 300), cols = 5;
const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const rows = Math.ceil(files.length / cols);
const tiles = await Promise.all(files.map(async (f, i) => {
  const img = await sharp(`${dir}/${f}`).resize(cell, cell - 24, { fit: "contain", background: "#888" }).toBuffer();
  const label = Buffer.from(`<svg width="${cell}" height="24"><rect width="100%" height="100%" fill="#111"/><text x="4" y="16" font-size="12" font-family="Helvetica" fill="#fff">${i}: ${f.slice(0, 40).replace(/&/g, "&amp;")}</text></svg>`);
  return [{ input: img, left: (i % cols) * cell, top: Math.floor(i / cols) * cell }, { input: label, left: (i % cols) * cell, top: Math.floor(i / cols) * cell + cell - 24 }];
}));
await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: "#222" } }).composite(tiles.flat()).jpeg({ quality: 80 }).toFile(out);
console.log(out, files.length);
