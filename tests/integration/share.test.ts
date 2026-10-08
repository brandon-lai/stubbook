/**
 * Sharing, against a live server and a real database. The criteria that involve
 * identity and privacy: only the owner can change or revoke a share, the server
 * only stores what the manifest references, every image is re-encoded (no
 * metadata survives), revoking deletes everything, and the schema has nowhere to
 * put an original photo or a raw IP.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.BASE || "http://localhost:3340";
if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
const hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const secret = () => "owner-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
// Each test uses its own fake client IP so the rate limits do not interfere.
let ipN = 0;
const ip = () => `198.51.100.${++ipN}`;

let img: Buffer, imgHash: string, gpsJpeg: Buffer, gpsHash: string;

function manifest(hashes: { hash: string; w: number; h: number }[]) {
  return {
    title: "Tokyo, March",
    manifest: {
      tickets: hashes.map((h, i) => ({
        id: `ticket${i}abc`,
        fields: { type: "flight", title: "NW 18", origin: "SFO", destination: "NRT", date: "2026-03-14", carrier: "Northwind Air", seat: "32K" },
        note: "window seat",
        image: h,
        photo: null,
      })),
      placements: hashes.map((_, i) => ({ ticketId: `ticket${i}abc`, x: 300 + i * 50, y: 200, rotation: -3, scale: 1, z: i + 1 })),
    },
  };
}

async function api(method: string, path: string, opts: { secret?: string; body?: unknown; raw?: Buffer; ip?: string } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(opts.secret ? { "x-owner-secret": opts.secret } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
      "x-forwarded-for": opts.ip ?? ip(),
    },
    body: opts.raw ? new Uint8Array(opts.raw) : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* binary */ }
  return { status: r.status, json, headers: r.headers };
}

beforeAll(async () => {
  img = await sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 240, g: 230, b: 210, alpha: 1 } } }).webp().toBuffer();
  imgHash = hex(img);
  // A photo with a GPS position in its EXIF, like a phone camera writes.
  gpsJpeg = await sharp({ create: { width: 200, height: 150, channels: 3, background: "#88aacc" } })
    .withExif({ IFD0: { Make: "TestPhone", Model: "X" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 46/1 30/1", GPSLongitudeRef: "W", GPSLongitude: "122/1 25/1 10/1" } })
    .jpeg().toBuffer();
  gpsHash = hex(gpsJpeg);
});
afterAll(() => sql.end());

describe("creating a share", () => {
  it("refuses without an owner secret", async () => {
    expect((await api("POST", "/api/shares", { body: manifest([]) })).status).toBe(401);
  });
  it("refuses a malformed body", async () => {
    const r = await api("POST", "/api/shares", { secret: secret(), body: { title: "x", manifest: { tickets: [{ id: "BAD ID" }], placements: [] } } });
    expect(r.status).toBe(400);
  });
  it("creates a share, stores only the owner's hash, and asks for the images", async () => {
    const s = secret();
    const r = await api("POST", "/api/shares", { secret: s, body: manifest([{ hash: imgHash, w: 300, h: 120 }]) });
    expect(r.status).toBe(201);
    expect(r.json.token).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(r.json.missing).toEqual([imgHash]);
    const [row] = await sql`select owner_hash from shares where token = ${r.json.token as string}`;
    expect(row.owner_hash).toBe(createHash("sha256").update(s).digest("hex"));
    expect(row.owner_hash).not.toContain(s);
  });
});

describe("images", () => {
  async function share(hashes = [{ hash: imgHash, w: 300, h: 120 }]) {
    const s = secret();
    const r = await api("POST", "/api/shares", { secret: s, body: manifest(hashes) });
    return { s, token: r.json.token as string };
  }

  it("accepts the owner's image when the hash matches and serves it with long caching", async () => {
    const { s, token } = await share();
    expect((await api("PUT", `/api/shares/${token}/assets/${imgHash}`, { secret: s, raw: img })).status).toBe(201);
    const get = await fetch(`${BASE}/api/shares/${token}/assets/${imgHash}`);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/webp");
    expect(get.headers.get("cache-control")).toContain("immutable");
    expect(get.headers.get("x-robots-tag")).toBe("noindex");
  });
  it("refuses an upload from anyone but the owner", async () => {
    const { token } = await share();
    expect((await api("PUT", `/api/shares/${token}/assets/${imgHash}`, { secret: secret(), raw: img })).status).toBe(403);
    expect((await api("PUT", `/api/shares/${token}/assets/${imgHash}`, { raw: img })).status).toBe(403);
  });
  it("refuses bytes that do not match the hash, and hashes the manifest does not reference", async () => {
    const { s, token } = await share();
    const other = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    expect((await api("PUT", `/api/shares/${token}/assets/${imgHash}`, { secret: s, raw: other })).status).toBe(400);
    expect((await api("PUT", `/api/shares/${token}/assets/${hex(other)}`, { secret: s, raw: other })).status).toBe(400);
  });
  it("refuses something that is not an image", async () => {
    const junk = Buffer.from("<script>alert(1)</script>".repeat(10));
    const { s, token } = await share([{ hash: hex(junk), w: 10, h: 10 }]);
    expect((await api("PUT", `/api/shares/${token}/assets/${hex(junk)}`, { secret: s, raw: junk })).status).toBe(400);
  });
  it("refuses an image over 3 MB", async () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 10, 1);
    const { s, token } = await share([{ hash: hex(big), w: 10, h: 10 }]);
    expect((await api("PUT", `/api/shares/${token}/assets/${hex(big)}`, { secret: s, raw: big })).status).toBe(413);
  });
  it("strips EXIF, GPS included, by re-encoding", async () => {
    expect((await sharp(gpsJpeg).metadata()).exif).toBeTruthy(); // the input really has it
    const { s, token } = await share([{ hash: gpsHash, w: 200, h: 150 }]);
    expect((await api("PUT", `/api/shares/${token}/assets/${gpsHash}`, { secret: s, raw: gpsJpeg })).status).toBe(201);
    const served = Buffer.from(await (await fetch(`${BASE}/api/shares/${token}/assets/${gpsHash}`)).arrayBuffer());
    const meta = await sharp(served).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(served.includes(Buffer.from("TestPhone"))).toBe(false);
  });
});

describe("updating and revoking", () => {
  it("only the owner can update; dropped images are deleted", async () => {
    const s = secret();
    const { json } = await api("POST", "/api/shares", { secret: s, body: manifest([{ hash: imgHash, w: 300, h: 120 }]) });
    const token = json.token as string;
    await api("PUT", `/api/shares/${token}/assets/${imgHash}`, { secret: s, raw: img });
    expect((await api("PUT", `/api/shares/${token}`, { secret: secret(), body: manifest([]) })).status).toBe(403);
    const up = await api("PUT", `/api/shares/${token}`, { secret: s, body: manifest([]) });
    expect(up.status).toBe(200);
    const [{ n }] = await sql`select count(*)::int as n from share_assets where token = ${token}`;
    expect(n).toBe(0);
  });
  it("only the owner can revoke; revoking removes the page and every image", async () => {
    const s = secret();
    const { json } = await api("POST", "/api/shares", { secret: s, body: manifest([{ hash: imgHash, w: 300, h: 120 }]) });
    const token = json.token as string;
    await api("PUT", `/api/shares/${token}/assets/${imgHash}`, { secret: s, raw: img });
    expect((await fetch(`${BASE}/s/${token}`)).status).toBe(200);
    expect((await api("DELETE", `/api/shares/${token}`, { secret: secret() })).status).toBe(403);
    expect((await api("DELETE", `/api/shares/${token}`, { secret: s })).status).toBe(200);
    expect((await fetch(`${BASE}/s/${token}`)).status).toBe(404);
    expect((await fetch(`${BASE}/api/shares/${token}/assets/${imgHash}`)).status).toBe(404);
    const [{ n }] = await sql`select count(*)::int as n from share_assets where token = ${token}`;
    expect(n).toBe(0);
  });
  it("the shared page is noindex and shows the title", async () => {
    const s = secret();
    const { json } = await api("POST", "/api/shares", { secret: s, body: manifest([{ hash: imgHash, w: 300, h: 120 }]) });
    const html = await (await fetch(`${BASE}/s/${json.token}`)).text();
    expect(html).toContain("Tokyo, March");
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  });
});

describe("limits and schema", () => {
  it("rate-limits share creation per client", async () => {
    const who = "203.0.113.77";
    await sql`delete from rate_events`;
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await api("POST", "/api/shares", { secret: secret(), body: manifest([]), ip: who })).status);
    expect(codes.slice(0, 30).every((c) => c === 201)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
    // Stored as an HMAC, never the address.
    const keys = await sql`select distinct key from rate_events`;
    expect(keys.some((k) => String(k.key).includes(who))).toBe(false);
  });
  it("has no column for a raw IP or an original image", async () => {
    const cols = await sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('shares','share_assets','rate_events')`;
    const names = cols.map((c) => String(c.column_name));
    expect(names.filter((n) => /(^|_)ip($|_)/.test(n))).toEqual([]);
    expect(names.filter((n) => /original|unblurred|cutout/.test(n))).toEqual([]);
  });
  it("has row level security on every table", async () => {
    const rows = await sql`select relname, relrowsecurity from pg_class where relname in ('shares','share_assets','rate_events')`;
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });
});
