import { NextResponse } from "next/server";

/**
 * Web Share Target endpoint (Android, installed app). The service worker
 * normally intercepts this POST and keeps the file on the device; this route
 * only runs when it did not (first visit, worker not yet active), and says so.
 */
export async function POST(req: Request) {
  return NextResponse.redirect(new URL("/scan?shared=missed", req.url), 303);
}
