// Runs the capture pipeline over every fixture in real Chrome and scores it.
//
//   node scripts/lab.mjs [filter]        (dev server on :3340, or BASE=...)
//
// Writes cut-outs and blurred images to fixtures/out/ and prints, per photo:
// corner IoU against ground truth, barcode decode, field accuracy, the privacy
// check on the blurred output, and timings. Exits non-zero if any privacy check fails.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3340";
const filter = process.argv[2] || "";
const truth = JSON.parse(readFileSync("fixtures/synthetic/truth.json", "utf8"));
const photos = JSON.parse(readFileSync("fixtures/synthetic/photos.json", "utf8"));
mkdirSync("fixtures/out", { recursive: true });

const jobs = [];
for (const [name, p] of Object.entries(photos)) jobs.push({ name, url: `/__fx/synthetic/photos/${name}.jpg`, mode: "camera", ticket: p.ticket, corners: p.corners });
jobs.push({ name: "boarding-wallet (screenshot)", url: "/__fx/synthetic/flat/boarding-wallet.png", mode: "image", ticket: "boarding-wallet" });
jobs.push({ name: "boarding-a4 (pdf)", url: "/__fx/synthetic/flat/boarding-a4.pdf", mode: "pdf", ticket: "boarding-a4" });
for (const f of readdirSync("fixtures/real/raw").sort()) jobs.push({ name: `real/${f}`, url: `/__fx/real/raw/${f}`, mode: "image" });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.route("**/__fx/**", (route) => {
  const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace("/__fx/", ""));
  const file = path.join("fixtures", rel);
  route.fulfill({ body: readFileSync(file), contentType: file.endsWith(".pdf") ? "application/pdf" : file.endsWith(".png") ? "image/png" : "image/jpeg" });
});
page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 200)); });
await page.goto(`${BASE}/dev/lab`);
await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 60000 });

const norm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const rows = [];
let privacyFail = 0;
for (const j of jobs.filter((j) => j.name.includes(filter))) {
  const r = await page.evaluate(([u, m]) => window.__lab.run(u, m), [j.url, j.mode]);
  const slug = j.name.replace(/[^a-z0-9]+/gi, "_");
  writeFileSync(`fixtures/out/${slug}.cutout.png`, Buffer.from(r.cutout.split(",")[1], "base64"));
  writeFileSync(`fixtures/out/${slug}.json`, JSON.stringify({ ...r, cutout: undefined, blurred: undefined }, null, 1));
  writeFileSync(`fixtures/out/${slug}.blurred.png`, Buffer.from(r.blurred.split(",")[1], "base64"));
  const t = j.ticket ? truth[j.ticket] : null;
  const row = { name: j.name, ms: r.timings.total, method: r.located.method, kind: r.located.kind };
  row.corners = r.located.corners.map((c) => c.map(Math.round));
  if (j.corners) row.iou = +quadIoU(r.located.corners, j.corners).toFixed(3);
  if (t) {
    row.barcode = t.barcode ? (r.barcodes.some((b) => b.text === t.barcode.text) ? "read" : "missed") : "-";
    const f = r.parse.fields, tf = t.fields;
    const checks = ["type", "origin", "destination", "date", "carrier", "seat"].filter((k) => tf[k]);
    const ok = checks.filter((k) => k === "carrier" ? norm(f[k]).includes(norm(tf[k]).slice(0, 6)) || norm(tf[k]).includes(norm(f[k])) && norm(f[k]).length > 3 : norm(f[k]) === norm(tf[k]));
    row.fields = `${ok.length}/${checks.length}`;
    row.missedFields = checks.filter((k) => !ok.includes(k)).map((k) => `${k}=${JSON.stringify(f[k])}`).join(" ");
    const before = norm(r.text), after = norm(r.blurredText);
    const leaks = t.sensitive.filter((s) => after.includes(norm(s)));
    const visible = t.sensitive.filter((s) => before.includes(norm(s)));
    row.privacy = r.blurredDecodes.length || leaks.length ? `LEAK ${[...r.blurredDecodes.map((d) => "barcode:" + d.slice(0, 12)), ...leaks].join(",")}` : `ok (${visible.length}/${t.sensitive.length} readable before)`;
    if (row.privacy.startsWith("LEAK")) privacyFail++;
  } else {
    row.privacy = r.blurredDecodes.length ? `LEAK barcode` : "ok";
    if (r.blurredDecodes.length) privacyFail++;
    row.fields = Object.entries(r.parse.fields).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ").slice(0, 120);
  }
  row.timing = Object.entries(r.timings).filter(([k]) => k !== "total").map(([k, v]) => `${k}:${v}`).join(" ");
  rows.push(row);
  console.log(JSON.stringify(row));
}
await browser.close();
const syn = rows.filter((r) => r.iou !== undefined);
if (syn.length) {
  const good = syn.filter((r) => r.iou >= 0.9).length;
  console.log(`\ncorners: ${good}/${syn.length} with IoU >= 0.9; mean IoU ${(syn.reduce((s, r) => s + r.iou, 0) / syn.length).toFixed(3)}`);
  console.log(`time: median ${median(rows.map((r) => r.ms))} ms, max ${Math.max(...rows.map((r) => r.ms))} ms`);
}
console.log(`privacy: ${rows.length - privacyFail}/${rows.length} clean`);
writeFileSync("fixtures/out/report.json", JSON.stringify(rows, null, 1));
process.exit(privacyFail ? 1 : 0);

function median(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }
function quadIoU(a, b, n = 160) {
  const pts = [...a, ...b], xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const inside = (q, x, y) => { let sign = 0; for (let i = 0; i < 4; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4]; const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (c) { if (sign && Math.sign(c) !== sign) return false; sign = Math.sign(c); } } return true; };
  let inter = 0, uni = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0), y = y0 + ((j + 0.5) / n) * (y1 - y0);
    const ia = inside(a, x, y), ib = inside(b, x, y);
    if (ia && ib) inter++; if (ia || ib) uni++;
  }
  return uni ? inter / uni : 0;
}
