// Draws every detection candidate for one photo: node scripts/fixtures/candidates.mjs <photo-name> <out.jpg>
import { chromium } from "playwright";
import sharp from "sharp";
import { readFileSync } from "node:fs";
const [name, out] = process.argv.slice(2);
const photos = JSON.parse(readFileSync("fixtures/synthetic/photos.json", "utf8"));
const b = await chromium.launch(); const p = await b.newPage();
await p.route("**/__fx/**", (r) => r.fulfill({ body: readFileSync("fixtures/" + decodeURIComponent(new URL(r.request().url()).pathname.slice(6))), contentType: "image/jpeg" }));
await p.goto("http://localhost:3340/dev/lab"); await p.waitForFunction(() => window.__lab?.ready);
const c = await p.evaluate((u) => window.__lab.detect(u), `/__fx/synthetic/photos/${name}.jpg`);
await b.close();
const ph = photos[name];
const colors = ["#f00", "#f80", "#ff0", "#0ff", "#f0f", "#00f", "#fff"];
const svg = `<svg width="${ph.width}" height="${ph.height}" xmlns="http://www.w3.org/2000/svg"><polygon points="${ph.corners.map((x) => x.join(",")).join(" ")}" fill="none" stroke="#0f0" stroke-width="10"/>` +
  c.slice(0, 7).map((d, i) => `<polygon points="${d.corners.map((x) => x.join(",")).join(" ")}" fill="none" stroke="${colors[i]}" stroke-width="5"/><text x="20" y="${50 + i * 46}" font-size="40" fill="${colors[i]}" font-family="Helvetica">${d.score.toFixed(3)} ${d.method}</text>`).join("") + "</svg>";
const buf = await sharp(`fixtures/synthetic/photos/${name}.jpg`).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
await sharp(buf).resize(900).jpeg().toFile(out);
console.log(c.length, "candidates");
