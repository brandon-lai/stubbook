/**
 * The owner's data lives on their device, in IndexedDB: tickets, their images,
 * collages and placements. Nothing here touches the network.
 *
 * Why on-device: the original photo and the unblurred cut-out are the sensitive
 * parts of a ticket, and the simplest way to keep them private is for them never
 * to leave the phone. The server only ever receives the blurred images, and only
 * for collages the owner chooses to share (lib/share-client.ts).
 */
import type { Placement } from "./layout";
import type { BlurBox, FieldSource, Fields } from "./types";
import type { Quad } from "./scan/geometry";

export interface Ticket {
  id: string;
  createdAt: number;
  kind: "paper" | "digital";
  fields: Fields;
  sources: Partial<Record<keyof Fields, FieldSource>>;
  confidence: number;
  note: string;
  /** Owner chose to see this ticket unblurred on their own collages. Shares are always blurred. */
  blurOff: boolean;
  boxes: BlurBox[];
  corners: Quad | null;
  /** Cut-out size in pixels; aspect = height / width. */
  width: number;
  height: number;
  hasPhoto: boolean;
  /** Bumped whenever the blurred image changes, so shares re-upload it. */
  imageVersion: number;
}

export interface Collage {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  visibility: "private" | "link";
  shareToken?: string;
  sharedAt?: number;
}

export type ImageKind = "original" | "cutout" | "blurred" | "photo";

export interface StoredPlacement extends Placement {
  collageId: string;
}

const DB = "stubbook";
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("tickets", { keyPath: "id" });
        d.createObjectStore("collages", { keyPath: "id" });
        const p = d.createObjectStore("placements", { keyPath: ["collageId", "ticketId"] });
        p.createIndex("byCollage", "collageId");
        p.createIndex("byTicket", "ticketId");
        d.createObjectStore("images");
        d.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Ask the browser not to evict this origin's data under storage pressure.
    void navigator.storage?.persist?.().catch(() => {});
  }
  return dbp;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction(stores, mode);
    const r = fn(t);
    let value: T;
    if (r) r.onsuccess = () => { value = r.result; };
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const newId = (n = 16) => {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(a, (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b & 31]).join("");
};

// Collages ------------------------------------------------------------------

export const listCollages = () => tx<Collage[]>(["collages"], "readonly", (t) => t.objectStore("collages").getAll()).then((c) => c.sort((a, b) => b.updatedAt - a.updatedAt));
export const getCollage = (id: string) => tx<Collage | undefined>(["collages"], "readonly", (t) => t.objectStore("collages").get(id));
export const putCollage = (c: Collage) => tx(["collages"], "readwrite", (t) => { t.objectStore("collages").put(c); });

export async function createCollage(title: string): Promise<Collage> {
  const c: Collage = { id: newId(10), title, createdAt: Date.now(), updatedAt: Date.now(), visibility: "private" };
  await putCollage(c);
  return c;
}

export async function touchCollage(id: string) {
  const c = await getCollage(id);
  if (c) await putCollage({ ...c, updatedAt: Date.now() });
}

export async function deleteCollage(id: string) {
  const ps = await placementsFor(id);
  await tx(["collages", "placements"], "readwrite", (t) => {
    t.objectStore("collages").delete(id);
    for (const p of ps) t.objectStore("placements").delete([id, p.ticketId]);
  });
  // Tickets that are on no other collage go too.
  for (const p of ps) if (!(await collagesForTicket(p.ticketId)).length) await deleteTicket(p.ticketId);
}

// Tickets -------------------------------------------------------------------

export const getTicket = (id: string) => tx<Ticket | undefined>(["tickets"], "readonly", (t) => t.objectStore("tickets").get(id));
export const putTicket = (tk: Ticket) => tx(["tickets"], "readwrite", (t) => { t.objectStore("tickets").put(tk); });
export const listTickets = () => tx<Ticket[]>(["tickets"], "readonly", (t) => t.objectStore("tickets").getAll());

export async function deleteTicket(id: string) {
  await tx(["tickets", "images"], "readwrite", (t) => {
    t.objectStore("tickets").delete(id);
    for (const k of ["original", "cutout", "blurred", "photo"]) t.objectStore("images").delete(`${id}:${k}`);
  });
}

export const putImage = (ticketId: string, kind: ImageKind, blob: Blob) => tx(["images"], "readwrite", (t) => { t.objectStore("images").put(blob, `${ticketId}:${kind}`); });
export const getImage = (ticketId: string, kind: ImageKind) => tx<Blob | undefined>(["images"], "readonly", (t) => t.objectStore("images").get(`${ticketId}:${kind}`));
export const deleteImage = (ticketId: string, kind: ImageKind) => tx(["images"], "readwrite", (t) => { t.objectStore("images").delete(`${ticketId}:${kind}`); });

// Placements ----------------------------------------------------------------

export const placementsFor = (collageId: string) =>
  tx<StoredPlacement[]>(["placements"], "readonly", (t) => t.objectStore("placements").index("byCollage").getAll(collageId));

export const collagesForTicket = (ticketId: string) =>
  tx<StoredPlacement[]>(["placements"], "readonly", (t) => t.objectStore("placements").index("byTicket").getAll(ticketId)).then((ps) => ps.map((p) => p.collageId));

export async function putPlacements(collageId: string, ps: Placement[]) {
  await tx(["placements"], "readwrite", (t) => { for (const p of ps) t.objectStore("placements").put({ ...p, collageId }); });
  await touchCollage(collageId);
}

export async function removeFromCollage(collageId: string, ticketId: string) {
  await tx(["placements"], "readwrite", (t) => { t.objectStore("placements").delete([collageId, ticketId]); });
  await touchCollage(collageId);
  if (!(await collagesForTicket(ticketId)).length) await deleteTicket(ticketId);
}

// Meta ----------------------------------------------------------------------

const getMeta = <T,>(k: string) => tx<T | undefined>(["meta"], "readonly", (t) => t.objectStore("meta").get(k));
const putMeta = (k: string, v: unknown) => tx(["meta"], "readwrite", (t) => { t.objectStore("meta").put(v, k); });

/** A random secret proving this device owns its shared collages. Only its hash is stored on the server. */
export async function ownerSecret(): Promise<string> {
  let s = await getMeta<string>("ownerSecret");
  if (!s) { s = newId(32); await putMeta("ownerSecret", s); }
  return s;
}

// Object URLs for images, cached per ticket+kind+version so lists do not leak URLs.
const urls = new Map<string, string>();
export async function imageUrl(ticketId: string, kind: ImageKind, version = 0): Promise<string | null> {
  const key = `${ticketId}:${kind}:${version}`;
  const hit = urls.get(key);
  if (hit) return hit;
  const blob = await getImage(ticketId, kind);
  if (!blob) return null;
  for (const [k, u] of urls) if (k.startsWith(`${ticketId}:${kind}:`)) { URL.revokeObjectURL(u); urls.delete(k); }
  const u = URL.createObjectURL(blob);
  urls.set(key, u);
  return u;
}

/** Which image the owner sees: blurred unless they turned blur off for this ticket. */
export const ownerView = (t: Ticket): ImageKind => (t.blurOff ? "cutout" : "blurred");
