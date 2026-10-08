"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Board, { type BoardTicket } from "./Board";
import Logo from "./Logo";
import ShareDialog from "./ShareDialog";
import TicketSheet from "./TicketSheet";
import { arrange, type ArrangeMode, type Placement } from "@/lib/layout";
import { publish } from "@/lib/share-client";
import { prefetchRuntimes } from "@/lib/scan/prefetch";
import {
  deleteCollage, getCollage, getTicket, imageUrl, listCollages, ownerView, placementsFor, putCollage, putPlacements, removeFromCollage,
  type Collage, type Ticket,
} from "@/lib/store";

export default function CollageView({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [collage, setCollage] = useState<Collage | null | undefined>(undefined);
  const [collages, setCollages] = useState<Collage[]>([]);
  const [tickets, setTickets] = useState<Map<string, Ticket>>(new Map());
  const [boardTickets, setBoardTickets] = useState<BoardTicket[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [landed, setLanded] = useState<string | null>(params.get("landed"));
  const [sync, setSync] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collageRef = useRef<Collage | null>(null);
  collageRef.current = collage ?? null;

  const toBoard = useCallback(async (ts: Ticket[]) => Promise.all(ts.map(async (t) => ({
    id: t.id, src: await imageUrl(t.id, ownerView(t), t.imageVersion), aspect: t.height / t.width, fields: t.fields, note: t.note,
    photoSrc: t.hasPhoto ? await imageUrl(t.id, "photo", t.imageVersion) : null,
  }))), []);

  const load = useCallback(async () => {
    const c = await getCollage(id);
    setCollage(c ?? null);
    if (!c) return;
    setCollages(await listCollages());
    const ps = await placementsFor(id);
    const ts = (await Promise.all(ps.map((p) => getTicket(p.ticketId)))).filter(Boolean) as Ticket[];
    setTickets(new Map(ts.map((t) => [t.id, t])));
    setBoardTickets(await toBoard(ts));
    setPlacements(ps.map(({ ticketId, x, y, rotation, scale, z }) => ({ ticketId, x, y, rotation, scale, z })));
  }, [id, toBoard]);

  useEffect(() => { void load(); prefetchRuntimes(); }, [load]);

  // The landing animation runs once; drop the query param so a reload does not replay it.
  // Capture-to-collage timing (the PRD's 15-second goal): mark when the new ticket is on screen.
  useEffect(() => {
    if (landed && boardTickets.some((t) => t.id === landed && t.src) && window.__stubbook && !("landed" in window.__stubbook)) {
      requestAnimationFrame(() => { (window.__stubbook as Record<string, number>).landed = performance.now(); });
    }
  }, [landed, boardTickets]);

  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => { setLanded(null); router.replace(`/c/${id}`, { scroll: false }); }, 900);
    // Bring the new ticket into view.
    requestAnimationFrame(() => document.querySelector(`[data-ticket="${landed}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    return () => clearTimeout(t);
  }, [landed, id, router]);

  /** A shared collage republishes itself a moment after the owner stops changing it. */
  const scheduleSync = useCallback(() => {
    if (collageRef.current?.visibility !== "link") return;
    setSync("pending");
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      try { setCollage(await publish(id)); setSync("ok"); } catch { setSync("error"); }
    }, 2500);
  }, [id]);

  const onChange = useCallback((ps: Placement[], committed: boolean) => {
    setPlacements(ps);
    if (committed) { void putPlacements(id, ps); scheduleSync(); }
  }, [id, scheduleSync]);

  function doArrange(mode: ArrangeMode) {
    const items = placements.map((p) => {
      const t = tickets.get(p.ticketId);
      return { ticketId: p.ticketId, aspect: t ? t.height / t.width : 0.4, date: t?.fields.date };
    });
    const next = arrange(mode, items, `${id}:${Date.now()}`);
    setAnimate(true);
    onChange(next, true);
    setTimeout(() => setAnimate(false), 600);
  }

  function layer(dir: "front" | "back") {
    if (!selected) return;
    const zs = placements.map((p) => p.z);
    const z = dir === "front" ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
    // Keep z non-negative by shifting everyone up when sending to the back.
    const next = placements.map((p) => (p.ticketId === selected ? { ...p, z } : p));
    const min = Math.min(...next.map((p) => p.z));
    onChange(min < 0 ? next.map((p) => ({ ...p, z: p.z - min })) : next, true);
  }

  async function rename(title: string) {
    if (!collage) return;
    const next = { ...collage, title: title.trim() || "Untitled collage", updatedAt: Date.now() };
    setCollage(next);
    await putCollage(next);
    scheduleSync();
  }

  if (collage === undefined) return <main className="wrap" style={{ padding: 40 }}><div className="spinner" /></main>;
  if (collage === null) {
    return (
      <main className="wrap stack" style={{ padding: "60px 16px" }}>
        <h1>Not on this device</h1>
        <p className="muted">Collages live on the device that made them. If someone shared one with you, open their share link instead.</p>
        <Link className="btn" href="/">Your collages</Link>
      </main>
    );
  }

  const recentTrip = [...tickets.values()].some((t) => t.fields.date && Date.now() - Date.parse(t.fields.date) < 14 * 864e5 && Date.parse(t.fields.date) <= Date.now() + 864e5);

  return (
    <>
      <header className="topbar"><div className="wrap">
        <Link href="/" className="brand" aria-label="Stubbook, all collages"><Logo /></Link>
        <span className="spacer" />
        {collage.visibility === "link" && (
          <span className={`status-chip on`} title="Anyone with the link can view">
            <span className="dot" />{sync === "pending" ? "Updating link…" : sync === "error" ? "Link not updated" : "Shared by link"}
          </span>
        )}
        <button className="btn small" onClick={() => setSharing(true)}>Share</button>
      </div></header>
      <main className="wrap" style={{ paddingBottom: 110 }}>
        <div style={{ marginTop: 16 }}>
          <input className="title-input" defaultValue={collage.title} key={collage.id} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} aria-label="Collage title" />
          <p className="small muted">{placements.length} ticket{placements.length === 1 ? "" : "s"} · drag to move, tap to flip, two fingers to turn and resize</p>
        </div>
        <div className="toolbar">
          <Link className="btn primary" href={`/scan?c=${collage.id}`} data-testid="add-ticket">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M8 12h8" /></svg>
            Add a ticket
          </Link>
          <select className="input" style={{ width: "auto", minHeight: 44, borderRadius: 999 }} value="" onChange={(e) => e.target.value && doArrange(e.target.value as ArrangeMode)} disabled={placements.length < 2} aria-label="Arrange tickets">
            <option value="">Arrange…</option>
            <option value="date">By date</option>
            <option value="scatter">Scattered</option>
            <option value="grid">Tidy grid</option>
          </select>
        </div>
        <Board
          tickets={boardTickets}
          placements={placements}
          editable
          selectedId={selected}
          onSelect={setSelected}
          onChange={onChange}
          landedId={landed}
          animate={animate}
          empty={<div className="stack" style={{ justifyItems: "center" }}><h3>No tickets yet</h3><p>Scan a paper ticket or upload a pass, and it lands here.</p><Link className="btn primary" href={`/scan?c=${collage.id}`}>Add a ticket</Link></div>}
        />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
          {confirmDelete ? (
            <span className="row">
              <span className="small muted">Delete this collage{placements.length ? " and tickets that are on no other collage" : ""}?</span>
              <button className="btn small" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button className="btn small primary" onClick={async () => { if (collage.shareToken) { try { const { unpublish } = await import("@/lib/share-client"); await unpublish(collage.id); } catch { /* best effort */ } } await deleteCollage(collage.id); router.push("/"); }}>Delete</button>
            </span>
          ) : (
            <button className="btn small ghost danger" onClick={() => setConfirmDelete(true)}>Delete collage</button>
          )}
        </div>
      </main>
      {selected && (
        <div className="actionbar" role="toolbar" aria-label="Selected ticket">
          <button className="btn small" onClick={() => setDetails(selected)}>Details</button>
          <button className="btn small" onClick={() => layer("front")}>To front</button>
          <button className="btn small" onClick={() => layer("back")}>To back</button>
          <button className="btn small" onClick={() => setSelected(null)} aria-label="Done">Done</button>
        </div>
      )}
      {details && (
        <TicketSheet
          ticketId={details}
          collage={collage}
          collages={collages}
          onClose={() => setDetails(null)}
          onSaved={async (t) => {
            setTickets((m) => new Map(m).set(t.id, t));
            const [bt] = await toBoard([t]);
            setBoardTickets((bs) => bs.map((b) => (b.id === t.id ? bt : b)));
            scheduleSync();
          }}
          onRemove={async () => {
            await removeFromCollage(collage.id, details);
            setDetails(null);
            setSelected(null);
            await load();
            scheduleSync();
          }}
        />
      )}
      {sharing && <ShareDialog collage={collage} recentTrip={recentTrip} onClose={() => setSharing(false)} onChange={(c) => { setCollage(c); setSync("ok"); }} />}
    </>
  );
}
