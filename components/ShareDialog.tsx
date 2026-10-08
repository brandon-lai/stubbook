"use client";

import { useEffect, useState } from "react";
import { publish, shareUrl, unpublish, ShareError } from "@/lib/share-client";
import type { Collage } from "@/lib/store";

interface Props {
  collage: Collage;
  recentTrip: boolean;
  onClose: () => void;
  onChange: (c: Collage) => void;
}

export default function ShareDialog({ collage, recentTrip, onClose, onChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const shared = collage.visibility === "link" && collage.shareToken;

  async function share() {
    setBusy("Preparing…");
    setError(null);
    try {
      onChange(await publish(collage.id, (d, t) => setBusy(t ? `Uploading tickets ${d} of ${t}…` : "Creating the link…")));
    } catch (e) {
      setError(e instanceof ShareError ? e.message : "Sharing failed. Check your connection and try again.");
    } finally { setBusy(null); }
  }

  async function stop() {
    setBusy("Removing the link…");
    setError(null);
    try { onChange(await unpublish(collage.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not stop sharing."); } finally { setBusy(null); }
  }

  async function copy() {
    if (!collage.shareToken) return;
    try { await navigator.clipboard.writeText(shareUrl(collage.shareToken)); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked: the URL is selectable */ }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(e) => e.stopPropagation()}>
        <header><h2 id="share-title" style={{ flex: 1 }}>Who sees this collage</h2><button className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button></header>
        <div className="stack">
          <label className="switch" style={{ alignItems: "center" }}>
            <input type="radio" name="vis" checked={!shared} onChange={() => shared && stop()} disabled={!!busy} />
            <span><b>Private</b> <span className="muted small">· only on this device</span></span>
          </label>
          <label className="switch" style={{ alignItems: "center" }}>
            <input type="radio" name="vis" checked={!!shared} onChange={() => !shared && share()} disabled={!!busy} />
            <span><b>Anyone with the link</b> <span className="muted small">· read-only</span></span>
          </label>
          <p className="small muted">
            A shared link shows the blurred version of every ticket, with its route, date, note and back photo. Original photos stay on this device. It updates when you change the collage.
          </p>
          {recentTrip && !shared && (
            <div className="note">This collage has a ticket from the last two weeks. Anyone with the link will see where you went and when.</div>
          )}
          {busy && <div className="reading" role="status"><span className="spinner" />{busy}</div>}
          {error && <div className="note error" role="alert">{error}</div>}
          {shared && collage.shareToken && (
            <div className="card stack">
              <input className="input mono small" readOnly value={shareUrl(collage.shareToken)} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
              <div className="row">
                <button className="btn primary small" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
                <a className="btn small" href={shareUrl(collage.shareToken)} target="_blank" rel="noreferrer">Open</a>
                <span className="spacer" />
                <button className="btn small danger" onClick={stop} disabled={!!busy}>Stop sharing</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
