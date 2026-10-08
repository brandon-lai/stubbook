/**
 * Publishing a collage by link. What leaves the device: the title, the layout,
 * each ticket's public fields and note, the blurred image, and the back photo if
 * one was added. Never the original photo or the unblurred cut-out: the manifest
 * schema has no field for them, and this module only ever reads "blurred".
 */
import type { Manifest } from "./share-schema";
import { getCollage, getImage, getTicket, ownerSecret, placementsFor, putCollage, type Collage } from "./store";

export class ShareError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function sha256Hex(b: Blob) {
  const d = await crypto.subtle.digest("SHA-256", await b.arrayBuffer());
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

async function dims(b: Blob) {
  const bmp = await createImageBitmap(b);
  const r = { w: bmp.width, h: bmp.height };
  bmp.close();
  return r;
}

async function build(collageId: string) {
  const c = await getCollage(collageId);
  if (!c) throw new ShareError("That collage is gone.", 404);
  const ps = await placementsFor(collageId);
  const blobs = new Map<string, Blob>();
  const tickets: Manifest["tickets"] = [];
  for (const p of ps) {
    const t = await getTicket(p.ticketId);
    const img = await getImage(p.ticketId, "blurred");
    if (!t || !img) continue;
    const h = await sha256Hex(img);
    blobs.set(h, img);
    let photo: Manifest["tickets"][number]["photo"] = null;
    const ph = t.hasPhoto ? await getImage(p.ticketId, "photo") : undefined;
    if (ph) { const hh = await sha256Hex(ph); blobs.set(hh, ph); photo = { hash: hh, ...(await dims(ph)) }; }
    tickets.push({ id: t.id, fields: t.fields, note: t.note.slice(0, 600), image: { hash: h, ...(await dims(img)) }, photo });
  }
  const ids = new Set(tickets.map((t) => t.id));
  const placements = ps.filter((p) => ids.has(p.ticketId)).map(({ ticketId, x, y, rotation, scale, z }) => ({ ticketId, x, y, rotation, scale, z }));
  return { c, body: { title: c.title.slice(0, 120) || "Untitled collage", manifest: { tickets, placements } }, blobs };
}

async function call(method: string, url: string, secret: string, body?: BodyInit, type = "application/json") {
  const r = await fetch(url, { method, headers: { "x-owner-secret": secret, ...(body ? { "content-type": type } : {}) }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ShareError(j.error || `Sharing failed (${r.status}).`, r.status);
  return j;
}

/** Creates or refreshes the link for a collage. Returns the updated collage. */
export async function publish(collageId: string, onProgress?: (done: number, total: number) => void): Promise<Collage> {
  const secret = await ownerSecret();
  const { c, body, blobs } = await build(collageId);
  let token = c.shareToken;
  let missing: string[];
  if (token) {
    try {
      missing = (await call("PUT", `/api/shares/${token}`, secret, JSON.stringify(body))).missing;
    } catch (e) {
      // The link was revoked elsewhere or the database was reset: start a new one.
      if (e instanceof ShareError && e.status === 404) token = undefined; else throw e;
      missing = [];
    }
  } else missing = [];
  if (!token) {
    const r = await call("POST", "/api/shares", secret, JSON.stringify(body));
    token = r.token as string;
    missing = r.missing;
  }
  let done = 0;
  onProgress?.(0, missing.length);
  // A few uploads at a time: fast on good connections, gentle on bad ones.
  const queue = [...missing];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let h = queue.shift(); h; h = queue.shift()) {
      const b = blobs.get(h);
      if (b) await call("PUT", `/api/shares/${token}/assets/${h}`, secret, b, b.type || "image/webp");
      onProgress?.(++done, missing.length);
    }
  }));
  const next: Collage = { ...c, visibility: "link", shareToken: token, sharedAt: Date.now() };
  await putCollage(next);
  return next;
}

export async function unpublish(collageId: string): Promise<Collage> {
  const c = await getCollage(collageId);
  if (!c) throw new ShareError("That collage is gone.", 404);
  if (c.shareToken) {
    try {
      await call("DELETE", `/api/shares/${c.shareToken}`, await ownerSecret());
    } catch (e) {
      if (!(e instanceof ShareError && e.status === 404)) throw e;
    }
  }
  const next: Collage = { ...c, visibility: "private", shareToken: undefined, sharedAt: undefined };
  await putCollage(next);
  return next;
}

export const shareUrl = (token: string) => `${location.origin}/s/${token}`;
