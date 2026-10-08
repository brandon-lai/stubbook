/** The shape of a shared collage, validated on the server and used by both sides. */
import { z } from "zod";
import { TICKET_TYPES } from "./types";

const str = (n: number) => z.string().max(n);
const hash = z.string().regex(/^[0-9a-f]{64}$/);

export const AssetRef = z.object({ hash, w: z.number().int().min(1).max(4000), h: z.number().int().min(1).max(4000) });

export const SharedTicket = z.object({
  id: z.string().regex(/^[a-z0-9]{6,32}$/),
  fields: z.object({
    type: z.enum(TICKET_TYPES),
    title: str(120),
    origin: str(120),
    destination: str(120),
    date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
    carrier: str(120),
    seat: str(60),
  }),
  note: str(600),
  /** Always the blurred image. There is no field for an unblurred one. */
  image: AssetRef,
  photo: AssetRef.nullable(),
});

export const SharedPlacement = z.object({
  ticketId: z.string().regex(/^[a-z0-9]{6,32}$/),
  x: z.number().min(-500).max(1500),
  y: z.number().min(-500).max(50000),
  rotation: z.number().min(-360).max(360),
  scale: z.number().min(0.1).max(5),
  z: z.number().int().min(0).max(100000),
});

export const Manifest = z.object({
  tickets: z.array(SharedTicket).max(300),
  placements: z.array(SharedPlacement).max(300),
});
export type Manifest = z.infer<typeof Manifest>;

export const ShareBody = z.object({ title: str(120).min(1), manifest: Manifest });
export type ShareBody = z.infer<typeof ShareBody>;

export function referencedHashes(m: Manifest): Set<string> {
  const s = new Set<string>();
  for (const t of m.tickets) { s.add(t.image.hash); if (t.photo) s.add(t.photo.hash); }
  return s;
}
