"use client";

import { useEffect, useState } from "react";
import FieldsForm from "./FieldsForm";
import { backPhoto } from "@/lib/encode";
import { BASE_W } from "@/lib/layout";
import { collagesForTicket, deleteImage, getTicket, imageUrl, placementsFor, putImage, putPlacements, putTicket, type Collage, type Ticket } from "@/lib/store";

interface Props {
  ticketId: string;
  collage: Collage;
  collages: Collage[];
  onClose: () => void;
  onSaved: (t: Ticket) => void;
  onRemove: () => void;
}

/** Ticket details: fields, note, back photo, blur preference, and which collages it is on. */
export default function TicketSheet({ ticketId, collage, collages, onClose, onSaved, onRemove }: Props) {
  const [t, setT] = useState<Ticket | null>(null);
  const [on, setOn] = useState<string[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    getTicket(ticketId).then(async (x) => {
      if (!x) return;
      setT(x);
      if (x.hasPhoto) setPhotoUrl(await imageUrl(x.id, "photo", x.imageVersion));
    });
    collagesForTicket(ticketId).then(setOn);
  }, [ticketId]);

  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  if (!t) return null;
  const save = async (next: Ticket) => { setT(next); await putTicket(next); onSaved(next); };

  async function addTo(id: string) {
    if (!id || on.includes(id)) return;
    const existing = await placementsFor(id);
    const top = Math.max(0, ...existing.map((p) => p.z));
    // Drop it at the top of the other collage; auto-place would need every ticket's aspect.
    await putPlacements(id, [{ ticketId, x: 500 + (existing.length % 3) * 40 - 40, y: 120 + (t!.height / t!.width) * BASE_W * 0.5, rotation: -3 + (existing.length % 5) * 1.5, scale: 1, z: top + 1 }]);
    setOn([...on, id]);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="tk-title" onClick={(e) => e.stopPropagation()}>
        <header><h2 id="tk-title" style={{ flex: 1 }}>Ticket details</h2><button className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></header>
        <div className="stack">
          <FieldsForm fields={t.fields} sources={t.sources} onChange={(f, k) => save({ ...t, fields: f, sources: { ...t.sources, [k]: "user" } })} />
          <div className="field">
            <label htmlFor="t-note">Note for the back</label>
            <textarea id="t-note" className="input" value={t.note} maxLength={600} onChange={(e) => save({ ...t, note: e.target.value })} />
          </div>
          <div className="row">
            {photoUrl && <img src={photoUrl} alt="Photo on the back" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6 }} />}
            <label className="btn small" style={{ cursor: "pointer" }}>
              {t.hasPhoto ? "Change photo" : "Add a photo to the back"}
              <input type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                await putImage(t.id, "photo", await backPhoto(f));
                const next = { ...t, hasPhoto: true, imageVersion: t.imageVersion + 1 };
                await save(next);
                setPhotoUrl(await imageUrl(t.id, "photo", next.imageVersion));
              }} />
            </label>
            {t.hasPhoto && <button className="btn small ghost" onClick={async () => { await deleteImage(t.id, "photo"); setPhotoUrl(null); await save({ ...t, hasPhoto: false, imageVersion: t.imageVersion + 1 }); }}>Remove photo</button>}
          </div>
          <label className="switch">
            <input type="checkbox" checked={!t.blurOff} onChange={(e) => save({ ...t, blurOff: !e.target.checked })} />
            <span><b>Blur codes and numbers</b><br /><span className="muted small">Only changes what you see here. Shared links always show the blurred version.</span></span>
          </label>
          <div className="field">
            <span className="label">On {on.length} collage{on.length === 1 ? "" : "s"}</span>
            <div className="row">
              {collages.filter((c) => on.includes(c.id)).map((c) => <span key={c.id} className="status-chip on"><span className="dot" />{c.title}</span>)}
            </div>
            {collages.some((c) => !on.includes(c.id)) && (
              <select className="input" value="" onChange={(e) => addTo(e.target.value)} aria-label="Also add to another collage">
                <option value="">Also add to…</option>
                {collages.filter((c) => !on.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            {confirmRemove ? (
              <>
                <span className="small muted">{on.length > 1 ? `Remove from “${collage.title}”? It stays on your other collages.` : "Remove it? This was its only collage, so the ticket is deleted."}</span>
                <button className="btn small" onClick={() => setConfirmRemove(false)}>Keep</button>
                <button className="btn small primary" onClick={onRemove}>Remove</button>
              </>
            ) : (
              <button className="btn small danger" onClick={() => setConfirmRemove(true)}>Remove from this collage</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
