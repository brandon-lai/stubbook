import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { referencedHashes, type Manifest } from "../share-schema";
import { sql } from "./db";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** 22 base62 characters: about 131 bits, unguessable. */
export function newToken() {
  const b = randomBytes(22);
  return Array.from(b, (x) => B62[x % 62]).join("");
}
export const isToken = (t: string) => /^[0-9A-Za-z]{22}$/.test(t);

export const sha256 = (b: string | Buffer | Uint8Array) => createHash("sha256").update(b).digest("hex");

function ownerMatches(secret: string | null, ownerHash: string) {
  if (!secret || secret.length < 20 || secret.length > 100) return false;
  const a = Buffer.from(sha256(secret), "hex"), b = Buffer.from(ownerHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ShareRow { token: string; owner_hash: string; title: string; manifest: Manifest; updated_at: Date }

export async function getShare(token: string): Promise<ShareRow | null> {
  if (!isToken(token)) return null;
  const [row] = await sql()<ShareRow[]>`select token, owner_hash, title, manifest, updated_at from shares where token = ${token}`;
  return row ?? null;
}

async function missingAssets(token: string, m: Manifest) {
  const want = [...referencedHashes(m)];
  if (!want.length) return [];
  const have = new Set((await sql()<{ hash: string }[]>`select hash from share_assets where token = ${token} and hash = any(${want})`).map((r) => r.hash));
  return want.filter((h) => !have.has(h));
}

export async function createShare(secret: string, title: string, manifest: Manifest) {
  const token = newToken();
  await sql()`insert into shares (token, owner_hash, title, manifest) values (${token}, ${sha256(secret)}, ${title}, ${sql().json(manifest as never)})`;
  return { token, missing: await missingAssets(token, manifest) };
}

export type OwnerResult<T> = { ok: true; value: T } | { ok: false; status: 403 | 404 };

export async function updateShare(token: string, secret: string | null, title: string, manifest: Manifest): Promise<OwnerResult<{ missing: string[] }>> {
  const row = await getShare(token);
  if (!row) return { ok: false, status: 404 };
  if (!ownerMatches(secret, row.owner_hash)) return { ok: false, status: 403 };
  const keep = [...referencedHashes(manifest)];
  await sql().begin(async (tx) => {
    await tx`update shares set title = ${title}, manifest = ${tx.json(manifest as never)}, updated_at = now() where token = ${token}`;
    // Images no longer on the collage are deleted, not orphaned.
    await tx`delete from share_assets where token = ${token} and not (hash = any(${keep}))`;
  });
  return { ok: true, value: { missing: await missingAssets(token, manifest) } };
}

export async function deleteShare(token: string, secret: string | null): Promise<OwnerResult<null>> {
  const row = await getShare(token);
  if (!row) return { ok: false, status: 404 };
  if (!ownerMatches(secret, row.owner_hash)) return { ok: false, status: 403 };
  await sql()`delete from shares where token = ${token}`;
  return { ok: true, value: null };
}

export const MAX_ASSET_BYTES = 3 * 1024 * 1024;

/**
 * Stores one image for a share. The hash must be one the manifest references and
 * must match the bytes. The image is decoded and re-encoded, which drops every
 * metadata block (EXIF GPS included) and anything that is not a picture.
 */
export async function putAsset(token: string, secret: string | null, hash: string, bytes: Buffer): Promise<OwnerResult<{ width: number; height: number }> | { ok: false; status: 400 | 413 }> {
  const row = await getShare(token);
  if (!row) return { ok: false, status: 404 };
  if (!ownerMatches(secret, row.owner_hash)) return { ok: false, status: 403 };
  if (bytes.length > MAX_ASSET_BYTES) return { ok: false, status: 413 };
  if (sha256(bytes) !== hash || !referencedHashes(row.manifest).has(hash)) return { ok: false, status: 400 };
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await sharp(bytes, { limitInputPixels: 4000 * 4000 })
      .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 90 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return { ok: false, status: 400 };
  }
  await sql()`
    insert into share_assets (token, hash, bytes, content_type, width, height)
    values (${token}, ${hash}, ${out.data}, 'image/webp', ${out.info.width}, ${out.info.height})
    on conflict (token, hash) do nothing`;
  return { ok: true, value: { width: out.info.width, height: out.info.height } };
}

export async function getAsset(token: string, hash: string) {
  if (!isToken(token) || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const [row] = await sql()<{ bytes: Buffer; content_type: string }[]>`select bytes, content_type from share_assets where token = ${token} and hash = ${hash}`;
  return row ?? null;
}

/** HMAC of the client IP. Raw IPs are never stored. */
export function clientKey(ip: string, scope: string) {
  const secret = process.env.IP_HASH_SECRET || "dev-only-secret";
  return `${scope}:${createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32)}`;
}

/** Sliding-window limit. Returns false when the caller is over it. */
export async function allow(key: string, limit: number, windowMinutes: number) {
  const db = sql();
  const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from rate_events where key = ${key} and at > now() - make_interval(mins => ${windowMinutes})`;
  if (n >= limit) return false;
  await db`insert into rate_events (key) values (${key})`;
  if (Math.random() < 0.02) await db`delete from rate_events where at < now() - interval '1 day'`;
  return true;
}
