import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import SharedBoard from "@/components/SharedBoard";
import Logo from "@/components/Logo";
import { hasDatabase } from "@/lib/server/db";
import { getShare, isToken } from "@/lib/server/shares";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const s = hasDatabase() && isToken(token) ? await getShare(token) : null;
  // Link-only means unlisted: never indexed, whatever it is called.
  return { title: s?.title ?? "Shared collage", robots: { index: false, follow: false } };
}

/** A shared collage: read-only, and only ever the blurred images the owner uploaded. */
export default async function Page({ params }: Props) {
  const { token } = await params;
  if (!hasDatabase() || !isToken(token)) notFound();
  const share = await getShare(token);
  if (!share) notFound();
  const asset = (h: string) => `/api/shares/${token}/assets/${h}`;
  const tickets = share.manifest.tickets.map((t) => ({
    id: t.id, src: asset(t.image.hash), aspect: t.image.h / t.image.w, fields: t.fields, note: t.note, photoSrc: t.photo ? asset(t.photo.hash) : null,
  }));
  return (
    <>
      <header className="topbar"><div className="wrap">
        <Link href="/" className="brand"><Logo /></Link>
        <span className="spacer" />
        <Link className="btn small" href="/">Make your own</Link>
      </div></header>
      <main className="wrap">
        <div className="shared-head">
          <span className="kicker">Shared collage</span>
          <h1>{share.title}</h1>
          <p className="small muted">{tickets.length} ticket{tickets.length === 1 ? "" : "s"} · tap one to see its back</p>
        </div>
        <SharedBoard tickets={tickets} placements={share.manifest.placements} />
      </main>
      <footer className="footer wrap">Read-only. Barcodes and booking codes are blurred. Tickets are keepsakes, not valid for travel or entry.</footer>
    </>
  );
}
