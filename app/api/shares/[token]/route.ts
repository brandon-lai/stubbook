import { hasDatabase } from "@/lib/server/db";
import { json, noDatabase, ownerError, secretOf } from "@/lib/server/http";
import { deleteShare, updateShare } from "@/lib/server/shares";
import { ShareBody } from "@/lib/share-schema";

type Ctx = { params: Promise<{ token: string }> };

/** Replace a shared collage's layout and tickets. Owner only. */
export async function PUT(req: Request, { params }: Ctx) {
  if (!hasDatabase()) return noDatabase();
  const { token } = await params;
  const parsed = ShareBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "That collage could not be shared." }, 400);
  const r = await updateShare(token, secretOf(req), parsed.data.title, parsed.data.manifest);
  return r.ok ? json(r.value) : ownerError(r.status);
}

/** Stop sharing: the row and every image are deleted. Owner only. */
export async function DELETE(req: Request, { params }: Ctx) {
  if (!hasDatabase()) return noDatabase();
  const { token } = await params;
  const r = await deleteShare(token, secretOf(req));
  return r.ok ? json({ ok: true }) : ownerError(r.status);
}
