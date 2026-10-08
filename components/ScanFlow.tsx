"use client";

/**
 * Capture to collage. Camera or upload -> cut out -> confirm -> lands on the
 * collage. The confirm screen opens as soon as the cut-out exists; reading
 * (barcodes, OCR, what to blur) finishes behind it and fills the fields in.
 * Saving never waits on a parse that failed: an unreadable ticket saves with
 * type "other" and whatever the user typed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CornerEditor from "./CornerEditor";
import FieldsForm from "./FieldsForm";
import Scanner, { type Capture } from "./Scanner";
import { autoPlace } from "@/lib/layout";
import { backPhoto, rotateCanvas, scaled, toBlob } from "@/lib/encode";
import type { Quad } from "@/lib/scan/geometry";
import { cut, locate, read, renderBlurred, warmUp, type Kind, type ReadResult, type SourceMode } from "@/lib/scan/pipeline";
import { loadFile, loadImage } from "@/lib/scan/source";
import { createCollage, getTicket, listCollages, newId, placementsFor, putImage, putPlacements, putTicket, type Collage, type Ticket } from "@/lib/store";
import { emptyFields, type BlurBox, type FieldSource, type Fields } from "@/lib/types";

type Stage = "camera" | "working" | "corners" | "confirm";

const SAMPLES = ["/samples/photos/boarding.jpg", "/samples/photos/concert.jpg", "/samples/photos/rail.jpg", "/samples/photos/museum.jpg"];

declare global { interface Window { __stubbook?: { opened: number; captured?: number; saved?: number; read?: number; landed?: number } } }

export default function ScanFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const [stage, setStage] = useState<Stage>("camera");
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{ canvas: HTMLCanvasElement; mode: SourceMode } | null>(null);
  const [kind, setKind] = useState<Kind>("paper");
  const [corners, setCorners] = useState<Quad | null>(null);
  const [cutout, setCutout] = useState<HTMLCanvasElement | null>(null);
  const [cutUrl, setCutUrl] = useState<string>("");
  const [reading, setReading] = useState(false);
  const readJob = useRef<Promise<ReadResult | null> | null>(null);
  const [boxes, setBoxes] = useState<BlurBox[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<Fields>(emptyFields());
  const [sources, setSources] = useState<Partial<Record<keyof Fields, FieldSource>>>({});
  const [confidence, setConfidence] = useState(0);
  const touched = useRef(new Set<keyof Fields>());
  const [blurOn, setBlurOn] = useState(true);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [collages, setCollages] = useState<Collage[]>([]);
  const [target, setTarget] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [blurPreview, setBlurPreview] = useState(false);
  const [blurUrl, setBlurUrl] = useState("");
  // save() awaits the reading pass, so it must read the state as it is after
  // reading finished, not as it was when the button was pressed.
  const latest = useRef({ boxes, removed, fields, sources, confidence });
  latest.current = { boxes, removed, fields, sources, confidence };

  useEffect(() => {
    warmUp();
    window.__stubbook = { opened: performance.now() };
    listCollages().then((cs) => {
      setCollages(cs);
      const want = params.get("c");
      setTarget(want && cs.some((c) => c.id === want) ? want : cs[0]?.id ?? "new");
    });
    // Files shared to the installed app (Android share sheet) arrive via the service worker's cache.
    if (params.get("shared") === "1") {
      caches.open("share-target").then(async (cache) => {
        const r = await cache.match("/shared-file");
        if (!r) return;
        await cache.delete("/shared-file");
        const blob = await r.blob();
        const name = r.headers.get("x-filename") || "shared";
        void begin(new File([blob], name, { type: blob.type }));
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Cut with the given corners, show the confirm screen, then read in the background. */
  const process = useCallback(async (src: { canvas: HTMLCanvasElement; mode: SourceMode }, q: Quad, k: Kind) => {
    setStage("working");
    try {
      const c = await cut(src.canvas, q, k);
      setCutout(c);
      setCutUrl(c.toDataURL("image/png"));
      setStage("confirm");
      startRead(c);
    } catch (e) {
      setError(`That photo could not be processed (${(e as Error).message}). Try again, or adjust the corners by hand.`);
      setStage("corners");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startRead(c: HTMLCanvasElement) {
    setReading(true);
    setBoxes([]);
    setRemoved(new Set());
    const job = read(c).then((r) => {
      setBoxes(r.boxes);
      // Fill only what the user has not typed over.
      setFields((f) => {
        const next = { ...f };
        for (const key of Object.keys(r.parse.fields) as (keyof Fields)[]) if (!touched.current.has(key)) (next as Record<string, string>)[key] = r.parse.fields[key];
        return next;
      });
      setSources(r.parse.sources);
      setConfidence(r.parse.confidence);
      if (window.__stubbook) window.__stubbook.read = performance.now();
      return r;
    }).catch(() => null).finally(() => setReading(false));
    readJob.current = job;
  }

  async function onCapture(c: Capture) {
    if (window.__stubbook) window.__stubbook.captured = performance.now();
    const src = { canvas: c.canvas, mode: "camera" as SourceMode };
    setSource(src);
    setKind("paper");
    if (c.corners) { setCorners(c.corners); await process(src, c.corners, "paper"); return; }
    // Shutter pressed with no outline on screen: look once more on the full frame, else ask for corners.
    setStage("working");
    const loc = await locate(c.canvas, "camera");
    setCorners(loc.corners);
    if (loc.detected) await process(src, loc.corners, "paper");
    else setStage("corners");
  }

  async function begin(file: File | string) {
    setStage("working");
    setError(null);
    try {
      const src = typeof file === "string" ? { canvas: await loadImage(file), mode: "image" as SourceMode } : await loadFile(file);
      setSource(src);
      const loc = await locate(src.canvas, src.mode);
      setKind(loc.kind);
      setCorners(loc.corners);
      await process(src, loc.corners, loc.kind);
    } catch {
      setError("That file could not be opened. Photos (JPG, PNG, HEIC where supported) and PDFs work.");
      setStage("camera");
    }
  }

  function rotate() {
    if (!cutout) return;
    const r = rotateCanvas(cutout, 1);
    setCutout(r);
    setCutUrl(r.toDataURL("image/png"));
    startRead(r);
  }

  // The blurred preview, so the user can see exactly what a shared link will show.
  useEffect(() => {
    if (!cutout || !blurPreview) return;
    setBlurUrl(renderBlurred(cutout, boxes.filter((b) => !removed.has(b.id))).toDataURL("image/png"));
  }, [cutout, boxes, removed, blurPreview]);

  async function save() {
    if (!cutout || !source) return;
    setSaving(true);
    try {
      // Blur needs the reading pass; it takes about a second and never blocks on a failed parse.
      await readJob.current;
      // Wait one frame so the read's state updates have rendered into `latest`.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const { boxes, removed, fields, sources, confidence } = latest.current;
      const finalBoxes = boxes.filter((b) => !removed.has(b.id));
      const blurred = renderBlurred(cutout, finalBoxes);
      let collageId = target;
      if (!collageId || collageId === "new") collageId = (await createCollage(collages.length ? "New collage" : "My tickets")).id;
      const id = newId(12);
      const ticket: Ticket = {
        id, createdAt: Date.now(), kind, fields, sources, confidence, note: note.trim(), blurOff: !blurOn,
        boxes: finalBoxes, corners, width: cutout.width, height: cutout.height, hasPhoto: Boolean(photo), imageVersion: 1,
      };
      await Promise.all([
        toBlob(cutout).then((b) => putImage(id, "cutout", b)),
        toBlob(blurred).then((b) => putImage(id, "blurred", b)),
        toBlob(scaled(source.canvas, 2000), "image/jpeg", 0.85).then((b) => putImage(id, "original", b)),
        photo ? putImage(id, "photo", photo) : Promise.resolve(),
      ]);
      await putTicket(ticket);
      const existing = await placementsFor(collageId);
      const aspects = new Map<string, number>();
      for (const p of existing) { const t = await getTicket(p.ticketId); if (t) aspects.set(t.id, t.height / t.width); }
      const placement = autoPlace(existing, aspects, { ticketId: id, aspect: cutout.height / cutout.width });
      await putPlacements(collageId, [placement]);
      if (window.__stubbook) window.__stubbook.saved = performance.now();
      router.push(`/c/${collageId}?landed=${id}`);
    } catch (e) {
      setError(`Could not save the ticket: ${(e as Error).message}`);
      setSaving(false);
    }
  }

  function startDraw(e: React.PointerEvent<HTMLDivElement>) {
    if (!drawing || !cutout) return;
    const el = e.currentTarget, r = el.getBoundingClientRect(), k = cutout.width / r.width;
    const x0 = (e.clientX - r.left) * k, y0 = (e.clientY - r.top) * k;
    const id = `m${Date.now()}`;
    try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
    setBoxes((bs) => [...bs, { id, reason: "manual", x: x0, y: y0, w: 1, h: 1 }]);
    const move = (ev: PointerEvent) => {
      const x1 = (ev.clientX - r.left) * k, y1 = (ev.clientY - r.top) * k;
      setBoxes((bs) => bs.map((b) => (b.id === id ? { ...b, x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) } : b)));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setBoxes((bs) => bs.filter((b) => b.id !== id || (b.w > 8 && b.h > 8)));
      setDrawing(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  if (stage === "camera") {
    return (
      <>
        <Scanner
          onCapture={onCapture}
          onUpload={(f) => void begin(f)}
          onSample={() => void begin(SAMPLES[Math.floor(Math.random() * SAMPLES.length)])}
          onClose={() => router.push(target && target !== "new" ? `/c/${target}` : "/")}
        />
        {(error || params.get("shared") === "missed") && (
          <div className="note error" style={{ position: "fixed", top: 70, left: 16, right: 16, zIndex: 60 }}>
            {error ?? "The shared file did not come through. Open Stubbook once, then share again; or upload the file here."}
          </div>
        )}
      </>
    );
  }
  if (stage === "working") {
    return <div className="processing" role="status"><div className="stack" style={{ justifyItems: "center" }}><div className="spinner" style={{ width: 28, height: 28 }} /><p>Cutting out your ticket…</p></div></div>;
  }
  if (stage === "corners" && source && corners) {
    return (
      <>
        <CornerEditor source={source.canvas} corners={corners} onCancel={() => setStage(cutout ? "confirm" : "camera")} onDone={(q) => { setCorners(q); void process(source, q, kind); }} />
        {error && <div className="note error" style={{ position: "fixed", top: 16, left: 16, right: 16, zIndex: 60 }}>{error}</div>}
      </>
    );
  }

  const live = boxes.filter((b) => !removed.has(b.id));
  const shown = cutout ? { w: cutout.width, h: cutout.height } : { w: 1, h: 1 };
  return (
    <div className="confirm">
      <header className="topbar"><div className="wrap">
        <button className="btn ghost small" onClick={() => { setCutout(null); setStage("camera"); }}>← Rescan</button>
        <span className="spacer" />
        <span className="kicker">Check the details</span>
      </div></header>
      <div className="wrap" style={{ maxWidth: 680 }}>
        <div className="confirm-preview">
          <div className="stage">
            <div className={`imgwrap${drawing ? " drawing" : ""}`} onPointerDown={startDraw}>
              <img src={blurPreview && blurUrl ? blurUrl : cutUrl} alt="Your ticket, cut out" draggable={false} />
              {!blurPreview && boxes.map((b) => {
                const off = removed.has(b.id);
                return (
                  <button
                    key={b.id}
                    className={`blurbox${b.reason === "manual" ? " manual" : ""}`}
                    style={{ left: `${(b.x / shown.w) * 100}%`, top: `${(b.y / shown.h) * 100}%`, width: `${(b.w / shown.w) * 100}%`, height: `${(b.h / shown.h) * 100}%`, opacity: off ? 0.35 : 1, borderStyle: off ? "dotted" : undefined }}
                    onClick={(e) => { e.stopPropagation(); setRemoved((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; }); }}
                    aria-label={`${off ? "Blur again" : "Do not blur"}: ${b.reason.replace("-", " ")}`}
                    title={off ? "Tap to blur again" : `Blurred: ${b.reason.replace("-", " ")}. Tap to unblur.`}
                  />
                );
              })}
            </div>
          </div>
          <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
            <span className="reading" role="status">
              {reading ? <><span className="spinner" />Reading the ticket…</> : `${live.length} area${live.length === 1 ? "" : "s"} blurred${confidence ? "" : " · nothing read, fill in what you like"}`}
            </span>
            <div className="row">
              <button className="btn small" onClick={() => setBlurPreview(!blurPreview)} aria-pressed={blurPreview}>{blurPreview ? "Show boxes" : "Preview blur"}</button>
              <button className="btn small" onClick={() => setDrawing(!drawing)} aria-pressed={drawing} disabled={blurPreview}>{drawing ? "Drag over it…" : "Add blur"}</button>
              <button className="btn small icon" onClick={rotate} aria-label="Rotate a quarter turn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></svg>
              </button>
              {source && source.mode !== "pdf" && <button className="btn small" onClick={() => setStage("corners")}>Corners</button>}
            </div>
          </div>
        </div>

        <div className="stack" style={{ marginTop: 18 }}>
          <label className="switch">
            <input type="checkbox" checked={blurOn} onChange={(e) => setBlurOn(e.target.checked)} />
            <span><b>Blur codes and numbers</b><br /><span className="muted small">Barcodes, booking references, ticket and frequent flyer numbers. Turning this off only changes what you see on your own collages; shared links always show the blurred version.</span></span>
          </label>
          <FieldsForm fields={fields} sources={sources} onChange={(f, k) => { touched.current.add(k); setFields(f); }} />
          <div className="field">
            <label htmlFor="f-note">Note for the back</label>
            <textarea id="f-note" className="input" value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} placeholder="Who you were with, what you remember" />
          </div>
          <div className="row">
            <label className="btn small" style={{ cursor: "pointer" }}>
              {photo ? "Change photo" : "Add a photo to the back"}
              <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await backPhoto(f)); }} />
            </label>
            {photo && <button className="btn small ghost" onClick={() => setPhoto(null)}>Remove photo</button>}
          </div>
          <div className="field">
            <label htmlFor="f-collage">Collage</label>
            <select id="f-collage" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              {collages.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              <option value="new">{collages.length ? "A new collage" : "My tickets (new)"}</option>
            </select>
          </div>
          {error && <div className="note error">{error}</div>}
        </div>
      </div>
      <div className="confirm-bar"><div className="wrap">
        <span className="small muted" style={{ flex: 1 }}>{reading ? "Fields fill in as the ticket is read." : "Fix anything that looks wrong."}</span>
        <button className="btn primary" onClick={save} disabled={saving} data-testid="save">
          {saving ? (reading ? "Finishing…" : "Saving…") : "Put it on the collage"}
        </button>
      </div></div>
    </div>
  );
}
