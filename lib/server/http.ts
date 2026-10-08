import "server-only";
import { NextResponse } from "next/server";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const NO_DB = "Sharing is not switched on for this deployment yet. Your collages are saved on this device; everything except link sharing works.";
export const noDatabase = () => json({ error: NO_DB }, 503);

export function ipOf(req: Request) {
  const h = req.headers;
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}

export const secretOf = (req: Request) => req.headers.get("x-owner-secret");

export const ownerError = (status: number) =>
  json({ error: status === 404 ? "No shared collage at this link." : status === 403 ? "This device does not own that shared collage." : status === 413 ? "That image is too large." : "That request was not valid." }, status);
