import { hasDatabase } from "@/lib/server/db";
import { json, noDatabase, ownerError, ipOf, secretOf } from "@/lib/server/http";
import { allow, clientKey, getAsset, MAX_ASSET_BYTES, putAsset } from "@/lib/server/shares";

type Ctx = { params: Promise<{ token: string; hash: string }> };

/** A shared collage's (blurred) image. Content-addressed, so it can be cached forever. */
export async function GET(_req: Request, { params }: Ctx) {
  if (!hasDatabase()) return new Response("Not found", { status: 404 });
  const { token, hash } = await params;
  const a = await getAsset(token, hash);
  if (!a) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(a.bytes), {
    headers: { "Content-Type": a.content_type, "Cache-Control": "public, max-age=31536000, immutable", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" },
  });
}

/** Upload one image for a shared collage. Owner only; the hash must match the bytes and the manifest. */
export async function PUT(req: Request, { params }: Ctx) {
  if (!hasDatabase()) return noDatabase();
  if (!(await allow(clientKey(ipOf(req), "asset"), 900, 60))) return json({ error: "Too many uploads from here in the last hour." }, 429);
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_ASSET_BYTES) return ownerError(413);
  const { token, hash } = await params;
  const bytes = Buffer.from(await req.arrayBuffer());
  const r = await putAsset(token, secretOf(req), hash, bytes);
  return r.ok ? json(r.value, 201) : ownerError(r.status);
}
