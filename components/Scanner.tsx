"use client";

/**
 * Live camera scan. Every ~120 ms a downscaled frame goes through the same
 * detector the pipeline uses and the outline is drawn over the video. When the
 * outline holds still for about two thirds of a second the frame is captured
 * automatically (the shutter works any time, with or without an outline).
 */
import { useEffect, useRef, useState } from "react";
import { loadCv } from "@/lib/scan/cv";
import { detectQuad } from "@/lib/scan/detect";
import { quadError, type Quad } from "@/lib/scan/geometry";
import { frameFromVideo } from "@/lib/scan/source";

export interface Capture { canvas: HTMLCanvasElement; corners: Quad | null }

interface Props {
  onCapture: (c: Capture) => void;
  onUpload: (f: File) => void;
  onSample: () => void;
  onClose: () => void;
}

const STABLE_FRAMES = 6;

export default function Scanner({ onCapture, onUpload, onSample, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const last = useRef<{ q: Quad; score: number } | null>(null);
  const stable = useRef(0);
  const done = useRef(false);
  const [status, setStatus] = useState<"starting" | "live" | "denied" | "none">("starting");
  const [hint, setHint] = useState("Starting the camera…");
  const [torch, setTorch] = useState<boolean | null>(null);
  const [auto, setAuto] = useState(true);
  const autoRef = useRef(auto);
  autoRef.current = auto;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus("none"); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play().catch(() => {});
        const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
        setStatus("live");
        setHint("Lay the ticket flat and fit it in the frame");
        const cv = await loadCv();
        const small = document.createElement("canvas");
        const tick = () => {
          if (!alive || done.current) return;
          const vw = v.videoWidth, vh = v.videoHeight;
          if (vw && vh) {
            const k = 640 / Math.max(vw, vh);
            small.width = Math.round(vw * k);
            small.height = Math.round(vh * k);
            small.getContext("2d", { willReadFrequently: true })!.drawImage(v, 0, 0, small.width, small.height);
            const src = cv.imread(small);
            let det = null;
            try { det = detectQuad(cv, src); } catch { /* a bad frame */ } finally { src.delete(); }
            const q = det ? (det.corners.map(([x, y]) => [x / k, y / k]) as Quad) : null;
            if (q && det && det.score > 0.3) {
              const still = last.current && quadError(last.current.q, q) < 0.015;
              stable.current = still ? stable.current + 1 : 0;
              last.current = { q, score: det.score };
              setHint(stable.current >= 2 ? "Hold still…" : "Ticket found");
              if (autoRef.current && stable.current >= STABLE_FRAMES) { shoot(); return; }
            } else {
              stable.current = 0;
              last.current = null;
              setHint("Lay the ticket flat and fit it in the frame");
            }
            draw(q, stable.current);
          }
          timer = setTimeout(tick, 120);
        };
        tick();
      } catch (e) {
        setStatus((e as Error).name === "NotAllowedError" ? "denied" : "none");
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Draws the outline in screen space, accounting for object-fit: cover. */
  function draw(q: Quad | null, still: number) {
    const c = overlay.current, v = video.current;
    if (!c || !v) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    if (!q) return;
    const s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
    const ox = (r.width - v.videoWidth * s) / 2, oy = (r.height - v.videoHeight * s) / 2;
    g.beginPath();
    q.forEach(([x, y], i) => { const px = (ox + x * s) * dpr, py = (oy + y * s) * dpr; if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath();
    const ready = Math.min(1, still / STABLE_FRAMES);
    g.fillStyle = `rgba(185, 71, 45, ${0.12 + ready * 0.18})`;
    g.fill();
    g.lineWidth = 3 * dpr;
    g.strokeStyle = ready >= 1 ? "#fff" : "rgba(255, 248, 242, 0.9)";
    g.stroke();
  }

  function shoot() {
    const v = video.current;
    if (!v || done.current || !v.videoWidth) return;
    done.current = true;
    navigator.vibrate?.(20);
    onCapture({ canvas: frameFromVideo(v), corners: last.current?.q ?? null });
  }

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setTorch(null); }
  }

  const upload = (
    <>
      <input ref={fileInput} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { done.current = true; onUpload(f); } }} />
      <button className="btn" onClick={() => fileInput.current?.click()} aria-label="Upload a photo, screenshot or PDF">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>
        Upload
      </button>
    </>
  );

  return (
    <div className="scan">
      <div className="scan-view">
        <video ref={video} playsInline muted autoPlay />
        <canvas ref={overlay} className="overlay" />
        <div className="scan-top">
          <button className="btn icon" onClick={onClose} aria-label="Close the scanner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <span className="spacer" />
          {status === "live" && (
            <button className="btn small" onClick={() => setAuto(!auto)} aria-pressed={auto}>{auto ? "Auto capture on" : "Auto capture off"}</button>
          )}
          {torch !== null && (
            <button className="btn icon" onClick={toggleTorch} aria-pressed={torch} aria-label={torch ? "Turn the light off" : "Turn the light on"}>
              <svg viewBox="0 0 24 24" fill={torch ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M9 2h6l-1 7h4l-8 13 2-9H8z" /></svg>
            </button>
          )}
        </div>
        {status !== "live" && status !== "starting" && (
          <div className="scan-fallback">
            <h2 style={{ color: "#f4efe6" }}>{status === "denied" ? "Camera access is off" : "No camera here"}</h2>
            <p style={{ color: "#cfc6b6" }}>
              {status === "denied"
                ? "Allow camera access for this site to scan paper tickets, or upload a photo, screenshot or PDF instead."
                : "Upload a photo of a ticket, a screenshot of a mobile pass, or a boarding-pass PDF."}
            </p>
            <div className="row" style={{ justifyContent: "center" }}>
              <div className="scan-side">{upload}</div>
              <button className="btn" onClick={onSample} style={{ background: "transparent", color: "#f4efe6", borderColor: "rgba(255,255,255,.25)" }}>Try a sample ticket</button>
            </div>
          </div>
        )}
        {status === "live" && <div className="scan-hint" role="status">{hint}</div>}
      </div>
      <div className="scan-bottom">
        <div className="scan-side">{upload}</div>
        <button className={`shutter${auto ? " auto" : ""}`} onClick={shoot} disabled={status !== "live"} aria-label="Take the photo"><span /></button>
        <div className="scan-side">
          <button className="btn" onClick={() => { done.current = true; onSample(); }}>Sample</button>
        </div>
      </div>
    </div>
  );
}
