"use client";

/** Manual crop: drag the four corners onto the ticket. The fallback for curled, creased or low-contrast tickets. */
import { useEffect, useRef, useState } from "react";
import type { Quad } from "@/lib/scan/geometry";

interface Props {
  source: HTMLCanvasElement;
  corners: Quad;
  onDone: (q: Quad) => void;
  onCancel: () => void;
}

export default function CornerEditor({ source, corners, onDone, onCancel }: Props) {
  const [q, setQ] = useState<Quad>(corners);
  const img = useRef<HTMLImageElement>(null);
  const [url] = useState(() => source.toDataURL("image/jpeg", 0.85));
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<number | null>(null);

  useEffect(() => {
    const el = img.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    el.addEventListener("load", measure);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const k = box.w / source.width || 0;
  const move = (e: React.PointerEvent) => {
    if (drag.current === null || !img.current) return;
    const r = img.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(source.width, (e.clientX - r.left) / k));
    const y = Math.max(0, Math.min(source.height, (e.clientY - r.top) / k));
    setQ((prev) => prev.map((p, i) => (i === drag.current ? [x, y] : p)) as Quad);
  };

  return (
    <div className="corners" onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
      <div className="scan-top" style={{ position: "relative" }}>
        <p style={{ flex: 1, textAlign: "center" }}>Drag the corners onto the ticket&apos;s edges</p>
      </div>
      <div className="area">
        <div className="frame">
          <img ref={img} src={url} alt="Your photo" draggable={false} />
          {k > 0 && (
            <>
              <svg viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden>
                <polygon points={q.map(([x, y]) => `${x * k},${y * k}`).join(" ")} fill="rgba(185,71,45,.18)" stroke="#fff" strokeWidth="2" />
              </svg>
              {q.map(([x, y], i) => (
                <span
                  key={i}
                  className="corner-handle"
                  style={{ left: x * k, top: y * k }}
                  onPointerDown={(e) => { drag.current = i; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* gone */ } }}
                  role="slider"
                  aria-label={["Top-left corner", "Top-right corner", "Bottom-right corner", "Bottom-left corner"][i]}
                  aria-valuetext={`${Math.round(x)}, ${Math.round(y)}`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    const d = e.shiftKey ? 20 : 4;
                    const delta: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
                    if (!delta[e.key]) return;
                    e.preventDefault();
                    setQ((prev) => prev.map((p, j) => (j === i ? [p[0] + delta[e.key][0], p[1] + delta[e.key][1]] : p)) as Quad);
                  }}
                />
              ))}
            </>
          )}
        </div>
      </div>
      <div className="bar">
        <button className="btn" onClick={onCancel}>Back</button>
        <button className="btn primary" onClick={() => onDone(q)}>Use these corners</button>
      </div>
    </div>
  );
}
