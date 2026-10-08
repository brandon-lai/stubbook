import { hasDatabase } from "@/lib/server/db";
import { json, noDatabase, ipOf, secretOf } from "@/lib/server/http";
import { allow, clientKey, createShare } from "@/lib/server/shares";
import { ShareBody } from "@/lib/share-schema";

/** Share a collage by link. Body: title + manifest. Returns the token and the image hashes to upload. */
export async function POST(req: Request) {
  if (!hasDatabase()) return noDatabase();
  const secret = secretOf(req);
  if (!secret || secret.length < 20 || secret.length > 100) return json({ error: "Missing owner secret." }, 401);
  if (!(await allow(clientKey(ipOf(req), "share"), 30, 60))) return json({ error: "Too many shares from here in the last hour. Try again later." }, 429);
  const parsed = ShareBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "That collage could not be shared.", issues: parsed.error.issues.slice(0, 3) }, 400);
  const r = await createShare(secret, parsed.data.title, parsed.data.manifest);
  return json(r, 201);
}
