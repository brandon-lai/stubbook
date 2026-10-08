"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Board, { type BoardTicket } from "./Board";
import { createCollage, getTicket, imageUrl, listCollages, ownerView, placementsFor, type Collage } from "@/lib/store";
import type { Placement } from "@/lib/layout";
import { prefetchRuntimes } from "@/lib/scan/prefetch";

interface Thumb { c: Collage; tickets: BoardTicket[]; placements: Placement[] }

/** Collages on this device, or the introduction when there are none yet. */
export default function Home({ intro }: { intro: React.ReactNode }) {
  const router = useRouter();
  const [thumbs, setThumbs] = useState<Thumb[] | null>(null);

  useEffect(() => {
    prefetchRuntimes();
    (async () => {
      const cs = await listCollages().catch(() => [] as Collage[]);
      setThumbs(await Promise.all(cs.map(async (c) => {
        const ps = await placementsFor(c.id);
        const ts = await Promise.all(ps.map(async (p) => {
          const t = await getTicket(p.ticketId);
          return t ? { id: t.id, src: await imageUrl(t.id, ownerView(t), t.imageVersion), aspect: t.height / t.width, fields: t.fields, note: "" } : null;
        }));
        return { c, tickets: ts.filter(Boolean) as BoardTicket[], placements: ps };
      })));
    })();
  }, []);

  if (thumbs === null) return <div style={{ minHeight: "60vh" }} />;
  if (!thumbs.length) return <>{intro}</>;
  return (
    <main className="wrap">
      <div className="row" style={{ marginTop: 22 }}>
        <h1 style={{ fontSize: 34 }}>Your collages</h1>
        <span className="spacer" />
        <Link className="btn primary" href="/scan">Scan a ticket</Link>
      </div>
      <div className="collage-grid">
        {thumbs.map(({ c, tickets, placements }) => (
          <Link key={c.id} href={`/c/${c.id}`} className="collage-card">
            <div className="thumb"><Board tickets={tickets} placements={placements} static minHeight={750} /></div>
            <div className="row" style={{ gap: 8 }}>
              <h3 style={{ flex: 1 }}>{c.title}</h3>
              {c.visibility === "link" && <span className="status-chip on"><span className="dot" />Shared</span>}
            </div>
            <span className="small muted" style={{ marginTop: -8 }}>{placements.length} ticket{placements.length === 1 ? "" : "s"}</span>
          </Link>
        ))}
        <button className="new-card" onClick={async () => { const c = await createCollage("New collage"); router.push(`/c/${c.id}`); }}>
          <span className="stack" style={{ justifyItems: "center" }}><span style={{ fontSize: 28 }}>＋</span>New collage<span className="small muted">one per trip, per year, or one for everything</span></span>
        </button>
      </div>
    </main>
  );
}
