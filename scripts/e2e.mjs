// End-to-end in real Chrome: capture -> confirm -> collage -> arrange -> reload.
//
//   node scripts/e2e.mjs [base] [shots-dir]
//
// Phase 1 has no camera: "Try a sample ticket", then a PDF upload.
// Phase 2 feeds Chrome a fake camera (a video of a ticket on a table) and times
// the PRD's goal: opening the camera to seeing the ticket on the collage, < 15 s.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:3340";
const SHOTS = process.argv[3] || "fixtures/out/e2e";
mkdirSync(SHOTS, { recursive: true });
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };

async function phase1() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(BASE + "/");
  await page.getByTestId("start").click();
  await page.waitForURL("**/scan");
  await page.getByText("Try a sample ticket").click({ timeout: 20000 });
  await page.getByTestId("save").waitFor({ timeout: 60000 });
  await page.getByText(/areas? blurred/).waitFor({ timeout: 60000 });
  await shot(page, "1-confirm");
  const fields = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("input.input")].map((i) => [i.id, i.value])));
  console.log("  fields:", JSON.stringify(fields));
  await page.getByTestId("save").click();
  await page.waitForURL(/\/c\/[a-z0-9]+/, { timeout: 30000 });
  await page.locator(".tk").first().waitFor();
  await page.waitForTimeout(1200);
  await shot(page, "2-collage-one");
  ok((await page.locator(".tk").count()) === 1, "first ticket landed on a new collage");
  const collageUrl = page.url().split("?")[0];

  // Second ticket: the boarding-pass PDF through the upload button.
  await page.getByTestId("add-ticket").click();
  await page.waitForURL("**/scan**");
  const input = page.locator('input[type=file][accept*="pdf"]').first();
  await input.setInputFiles("fixtures/synthetic/flat/boarding-a4.pdf");
  await page.getByText(/areas? blurred/).waitFor({ timeout: 60000 });
  const f2 = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("input.input")].map((i) => [i.id, i.value])));
  console.log("  pdf fields:", JSON.stringify(f2));
  ok(f2["f-origin"] === "YYZ" && f2["f-dest"] === "CDG" && f2["f-date"] === "2026-09-03", "PDF boarding pass parsed from its barcode");
  await shot(page, "3-confirm-pdf");
  await page.getByTestId("save").click();
  await page.waitForURL(/\/c\//);
  await page.waitForTimeout(1200);
  ok((await page.locator(".tk").count()) === 2, "second ticket on the same collage");
  await shot(page, "4-collage-two");

  // Tap flips; drag moves.
  const t = page.locator(".tk").first();
  await t.tap();
  await page.waitForTimeout(700);
  ok(await t.evaluate((el) => el.classList.contains("flipped")), "tap flips the ticket");
  await shot(page, "5-flipped");
  const before = await t.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 140, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await t.boundingBox();
  ok(Math.abs(after.y - before.y - 140) < 20, "drag moves the ticket");

  await page.selectOption('select[aria-label="Arrange tickets"]', "grid");
  await page.waitForTimeout(800);
  await shot(page, "6-grid");
  await page.goto(collageUrl);
  await page.locator(".tk").first().waitFor();
  ok((await page.locator(".tk").count()) === 2, "collage persists across reload");
  await page.goto(BASE + "/");
  await page.locator(".collage-card").first().waitFor();
  await page.waitForTimeout(500);
  await shot(page, "7-home-list");
  await browser.close();
}

async function phase2(warm) {
  const y4m = path.resolve(SHOTS, "../camera.y4m");
  if (!existsSync(y4m)) {
    // A ticket on a table, held a little unsteadily: 4 s at 10 fps.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", "fixtures/synthetic/photos/concert-stub__wood-clean.jpg", "-t", "4", "-r", "10",
      "-vf", "scale=1280:960,crop=1240:930:20+8*sin(t*3):15+6*cos(t*2),scale=1280:960,format=yuv420p", y4m]);
  }
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  if (warm) {
    // The usual path: land on the home page, look around, tap Scan.
    await page.goto(BASE + "/");
    await page.waitForTimeout(6000);
    await page.getByTestId("start").click();
  } else {
    await page.goto(BASE + "/scan"); // worst case: a cold link straight to the scanner
  }
  await page.waitForTimeout(1500);
  await shot(page, `8-camera-${warm ? "warm" : "cold"}`);
  await page.getByTestId("save").waitFor({ timeout: 30000 });
  await page.getByText(/areas? blurred/).waitFor({ timeout: 60000 });
  await shot(page, "9-camera-confirm");
  await page.getByTestId("save").click();
  await page.waitForURL(/\/c\//);
  await page.locator(".tk").first().waitFor();
  await page.waitForFunction(() => window.__stubbook?.landed, null, { timeout: 10000 }).catch(() => {});
  const t = await page.evaluate(() => window.__stubbook ?? null);
  // Client-side navigation keeps window, so the marks span scanner to collage.
  console.log("  timing marks (ms since page load):", JSON.stringify(t));
  if (t?.landed) {
    const total = (t.landed - t.opened) / 1000;
    console.log(`  [${warm ? "via home" : "cold link"}] camera opened -> ticket on collage: ${total.toFixed(1)} s (auto-capture ${((t.captured - t.opened) / 1000).toFixed(1)} s, read ${((t.read - t.captured) / 1000).toFixed(1)} s, includes the scripted tap on Save)`);
    ok(total < 15, "capture to collage under 15 s");
  } else ok(false, "landing time recorded");
  await shot(page, "10-camera-landed");
  await browser.close();
}

async function phase3() {
  // Sharing through the UI. Only runs when the deployment has a database.
  const probe = await fetch(BASE + "/api/shares", { method: "POST", headers: { "x-owner-secret": "x".repeat(24), "content-type": "application/json" }, body: "{}" });
  if (probe.status === 503) { console.log("  (no database here: sharing phase skipped)"); return; }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(BASE + "/scan");
  await page.getByText("Try a sample ticket").click({ timeout: 20000 });
  await page.getByText(/areas? blurred/).waitFor({ timeout: 60000 });
  await page.getByTestId("save").click();
  await page.waitForURL(/\/c\//);
  await page.locator(".tk").first().waitFor();
  await page.getByRole("button", { name: "Share" }).click();
  await page.getByText("Anyone with the link").click();
  const link = page.locator('input[aria-label="Share link"]');
  await link.waitFor({ timeout: 30000 });
  const url = await link.inputValue();
  ok(/\/s\/[0-9A-Za-z]{22}$/.test(url), `share link created (${url.replace(BASE, "")})`);
  await shot(page, "11-share-dialog");
  await page.keyboard.press("Escape");
  ok(!(await page.locator(".sheet-backdrop").count()), "Escape closes the share dialog");

  const viewer = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await viewer.goto(url);
  await viewer.locator(".tk img").first().waitFor();
  await viewer.waitForTimeout(800);
  const srcs = await viewer.$$eval(".tk img", (els) => els.map((e) => e.getAttribute("src")));
  ok(srcs.length === 1 && srcs.every((s) => /\/api\/shares\/.+\/assets\/[0-9a-f]{64}$/.test(s)), "shared view shows the uploaded (blurred) image");
  await shot(viewer, "12-shared-view");
  const posBefore = await viewer.locator(".tk").first().evaluate((el) => el.style.transform);

  // Turn the ticket as the owner, with the keyboard; the link republishes itself.
  // (Rotation, not position: a lone ticket is recentred by the view's zoom-to-fit.)
  const t = page.locator(".tk").first();
  await t.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("]");
  await page.getByText("Updating link…").waitFor({ timeout: 5000 }).catch(() => {});
  await page.getByText("Shared by link").waitFor({ timeout: 20000 });
  await viewer.reload();
  await viewer.locator(".tk").first().waitFor();
  const posAfter = await viewer.locator(".tk").first().evaluate((el) => el.style.transform);
  ok(posBefore !== posAfter, "shared view follows the owner's edits");

  await page.getByRole("button", { name: "Share" }).click();
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await page.locator('input[aria-label="Share link"]').waitFor({ state: "detached", timeout: 20000 });
  const gone = await fetch(url);
  ok(gone.status === 404, "stop sharing removes the link");
  await browser.close();
}

await phase1();
await phase2(false);
await phase2(true);
await phase3();
