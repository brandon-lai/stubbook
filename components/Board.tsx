"use client";

/**
 * The collage. Tickets are absolutely positioned on a fixed-width board
 * (BOARD_W units) scaled to the container, so a layout looks the same on a phone
 * and a laptop, and the shared view matches the owner's.
 *
 * Gestures when editable:
 *   drag a ticket            move it (it comes to the top, like picking it up)
 *   two fingers on a ticket  rotate and resize together
 *   handles (selected)       rotate (top), resize (corner), for mouse users
 *   tap                      flip to the back: route, date, note, photo
 *   keyboard (focused)       arrows move, [ ] rotate, + - resize, Enter flips
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BASE_W, BOARD_W, boardHeight, bounds, type Placement } from "@/lib/layout";
import { formatDate, routeLine } from "@/lib/format";
import type { Fields } from "@/lib/types";

export interface BoardTicket {
  id: string;
  src: string | null;
  aspect: number;
  fields: Fields;
  note: string;
  photoSrc?: string | null;
}

interface Props {
  tickets: BoardTicket[];
  placements: Placement[];
  editable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onChange?: (ps: Placement[], committed: boolean) => void;
  landedId?: string | null;
  animate?: boolean;
  minHeight?: number;
  empty?: React.ReactNode;
  /** Thumbnails: no interaction, no back faces. */
  static?: boolean;
  /** View-only boards: zoom so the tickets fill the width (up to 2.2x), height follows the content. */
  fitContent?: boolean;
  /** Smallest board scale (px per board unit). Below it the board scrolls sideways instead of shrinking. */
  minScale?: number;
}

type Gesture =
  | { kind: "drag"; id: string; start: Placement; x0: number; y0: number; t0: number; moved: boolean; pointer: number }
  | { kind: "pinch"; id: string; start: Placement; a0: number; d0: number }
  | { kind: "rotate" | "resize"; id: string; start: Placement; cx: number; cy: number; a0: number; d0: number; pointer: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function Board(props: Props) {
  const { tickets, placements, editable, selectedId, onSelect, onChange, landedId } = props;
  // ref: the element whose width sets the scale. inner: the board itself when it scrolls inside ref.
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const boardEl = () => (props.minScale ? inner.current : ref.current);
  const [width, setWidth] = useState(0);
  const [boxH, setBoxH] = useState(0);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const live = useRef(placements);
  live.current = placements;

  // Measure synchronously first: waiting for ResizeObserver leaves an empty
  // board for a frame (and forever in some headless captures).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    setBoxH(el.getBoundingClientRect().height);
    const ro = new ResizeObserver(([e]) => { setWidth(e.contentRect.width); setBoxH(e.contentRect.height); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = width / BOARD_W || 0;
  let k = props.minScale ? Math.max(fit, props.minScale) : fit;
  // Thumbnails zoom to their tickets, so a collage of two does not look empty.
  let ox = 0, oy = 0;
  let fittedHeight = 0;
  if (props.fitContent && !editable && placements.length && width) {
    const bs = placements.map((p) => bounds(p, tickets.find((t) => t.id === p.ticketId)?.aspect ?? 0.4));
    const x0 = Math.min(...bs.map((b) => b.x0)) - 30, x1 = Math.max(...bs.map((b) => b.x1)) + 30;
    const y0 = Math.min(...bs.map((b) => b.y0)) - 30, y1 = Math.max(...bs.map((b) => b.y1)) + 30;
    k = Math.min(width / (x1 - x0), fit * 2.2);
    ox = (width - (x1 - x0) * k) / 2 - x0 * k;
    oy = -y0 * k;
    fittedHeight = Math.max((y1 - y0) * k, 160);
  }
  if (props.static && placements.length && width && boxH) {
    const bs = placements.map((p) => bounds(p, tickets.find((t) => t.id === p.ticketId)?.aspect ?? 0.4));
    const x0 = Math.min(...bs.map((b) => b.x0)) - 30, x1 = Math.max(...bs.map((b) => b.x1)) + 30;
    const y0 = Math.min(...bs.map((b) => b.y0)) - 30, y1 = Math.max(...bs.map((b) => b.y1)) + 30;
    k = Math.min(width / (x1 - x0), boxH / (y1 - y0), fit * 2.2);
    ox = (width - (x1 - x0) * k) / 2 - x0 * k;
    oy = (boxH - (y1 - y0) * k) / 2 - y0 * k;
  }
  const aspects = new Map(tickets.map((t) => [t.id, t.aspect]));
  const height = boardHeight(placements, aspects, props.minHeight ?? 640) * k;
  const byId = new Map(tickets.map((t) => [t.id, t]));

  const update = useCallback((id: string, patch: Partial<Placement>, committed = false) => {
    const next = live.current.map((p) => (p.ticketId === id ? { ...p, ...patch } : p));
    live.current = next;
    onChange?.(next, committed);
  }, [onChange]);

  const raise = (id: string) => {
    const top = Math.max(0, ...live.current.map((p) => p.z));
    const p = live.current.find((q) => q.ticketId === id);
    if (p && p.z < top) update(id, { z: top + 1 });
  };

  const flip = (id: string) => setFlipped((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const boardPoint = (e: { clientX: number; clientY: number }) => {
    const r = boardEl()!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const capture = (el: Element, id: number) => { try { (el as HTMLElement).setPointerCapture(id); } catch { /* pointer already gone */ } };

  function onTicketDown(e: React.PointerEvent, id: string) {
    if (props.static) return;
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = live.current.find((q) => q.ticketId === id);
    if (!p) return;
    if (!editable) { gesture.current = { kind: "drag", id, start: p, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, pointer: e.pointerId }; return; }
    onSelect?.(id);
    capture(e.currentTarget, e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const target = gesture.current?.id ?? id;
      const tp = live.current.find((q) => q.ticketId === target) ?? p;
      gesture.current = { kind: "pinch", id: target, start: tp, a0: Math.atan2(b.y - a.y, b.x - a.x), d0: Math.hypot(b.x - a.x, b.y - a.y) || 1 };
    } else {
      gesture.current = { kind: "drag", id, start: p, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, pointer: e.pointerId };
    }
  }

  /** Second finger on empty board while a ticket is selected: pinch that ticket. Small tickets on phones are hard to pinch directly. */
  function onBoardDown(e: React.PointerEvent) {
    if (!editable || props.static) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const id = selectedId;
    if (!id || pointers.current.size !== 2) return;
    const p = live.current.find((q) => q.ticketId === id);
    if (!p) return;
    capture(e.currentTarget, e.pointerId);
    const [a, b] = [...pointers.current.values()];
    gesture.current = { kind: "pinch", id, start: p, a0: Math.atan2(b.y - a.y, b.x - a.x), d0: Math.hypot(b.x - a.x, b.y - a.y) || 1 };
  }

  function onHandleDown(e: React.PointerEvent, id: string, kind: "rotate" | "resize") {
    e.stopPropagation();
    capture(e.currentTarget, e.pointerId);
    const p = live.current.find((q) => q.ticketId === id)!;
    const pt = boardPoint(e);
    gesture.current = { kind, id, start: p, cx: p.x, cy: p.y, a0: Math.atan2(pt.y - p.y, pt.x - p.x), d0: Math.hypot(pt.x - p.x, pt.y - p.y) || 1, pointer: e.pointerId };
  }

  function onMove(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "drag") {
      if (g.pointer !== e.pointerId) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.moved && Math.hypot(dx, dy) < 6) return;
      if (!editable) return;
      if (!g.moved) { g.moved = true; raise(g.id); }
      const t = byId.get(g.id);
      const half = (BASE_W * g.start.scale) / 2;
      update(g.id, { x: clamp(g.start.x + dx / k, -half * 0.5, BOARD_W + half * 0.5), y: Math.max(-half * (t?.aspect ?? 0.4) * 0.5, g.start.y + dy / k) });
    } else if (g.kind === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const ang = Math.atan2(b.y - a.y, b.x - a.x), d = Math.hypot(b.x - a.x, b.y - a.y);
      update(g.id, { rotation: g.start.rotation + ((ang - g.a0) * 180) / Math.PI, scale: clamp(g.start.scale * (d / g.d0), 0.3, 3) });
    } else {
      if (g.pointer !== e.pointerId) return;
      const pt = boardPoint(e);
      if (g.kind === "rotate") {
        let rot = g.start.rotation + ((Math.atan2(pt.y - g.cy, pt.x - g.cx) - g.a0) * 180) / Math.PI;
        // Snap to level within 2°: tidy layouts are a common goal.
        const r = ((rot % 360) + 360) % 360;
        if (Math.min(r, 360 - r) < 2) rot -= r > 180 ? r - 360 : r;
        update(g.id, { rotation: rot });
      } else {
        update(g.id, { scale: clamp(g.start.scale * (Math.hypot(pt.x - g.cx, pt.y - g.cy) / g.d0), 0.3, 3) });
      }
    }
  }

  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "drag" && g.pointer === e.pointerId) {
      if (!g.moved && performance.now() - g.t0 < 450) flip(g.id);
      else if (g.moved) onChange?.(live.current, true);
      gesture.current = null;
    } else if (g.kind === "pinch") {
      if (pointers.current.size < 2) { onChange?.(live.current, true); gesture.current = null; }
    } else if (g.pointer === e.pointerId) {
      onChange?.(live.current, true);
      gesture.current = null;
    }
  }

  function onKey(e: React.KeyboardEvent, id: string) {
    const p = live.current.find((q) => q.ticketId === id);
    if (!p) return;
    const step = e.shiftKey ? 40 : 10;
    const map: Record<string, Partial<Placement>> = editable ? {
      ArrowLeft: { x: p.x - step }, ArrowRight: { x: p.x + step }, ArrowUp: { y: p.y - step }, ArrowDown: { y: p.y + step },
      "[": { rotation: p.rotation - 3 }, "]": { rotation: p.rotation + 3 }, "+": { scale: clamp(p.scale * 1.08, 0.3, 3) }, "=": { scale: clamp(p.scale * 1.08, 0.3, 3) }, "-": { scale: clamp(p.scale / 1.08, 0.3, 3) },
    } : {};
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(id); return; }
    if (map[e.key]) { e.preventDefault(); update(id, map[e.key], true); }
  }

  // Clicking empty board clears the selection.
  useEffect(() => {
    if (!editable) return;
    const el = boardEl();
    const clear = (e: PointerEvent) => { if (e.target === el) onSelect?.(null); };
    el?.addEventListener("pointerdown", clear);
    return () => el?.removeEventListener("pointerdown", clear);
  }, [editable, onSelect]);

  const board = (
    <div
      ref={props.minScale ? inner : ref}
      className={`board${editable ? " editing" : ""}${props.animate ? " animate" : ""}`}
      style={{ height: props.static ? "100%" : fittedHeight || height || undefined, minHeight: props.static ? undefined : 200, width: props.minScale ? BOARD_W * k : undefined, touchAction: editable && selectedId ? "none" : undefined }}
      onPointerDown={onBoardDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {k > 0 && placements.map((p) => {
        const t = byId.get(p.ticketId);
        if (!t) return null;
        const w = BASE_W * p.scale * k, h = w * t.aspect;
        const sel = editable && selectedId === t.id;
        const isFlipped = flipped.has(t.id);
        const label = [t.fields.title, routeLine(t.fields), formatDate(t.fields.date)].filter(Boolean).join(", ") || "Ticket";
        return (
          <div
            key={t.id}
            className={`tk${sel ? " selected" : ""}${isFlipped ? " flipped" : ""}${landedId === t.id ? " landing" : ""}`}
            style={{ width: w, height: h, zIndex: p.z, transform: `translate(${ox + p.x * k - w / 2}px, ${oy + p.y * k - h / 2}px) rotate(${p.rotation}deg)`, touchAction: editable ? "none" : "manipulation" }}
            onPointerDown={(e) => onTicketDown(e, t.id)}
            onKeyDown={(e) => onKey(e, t.id)}
            onFocus={() => editable && onSelect?.(t.id)}
            tabIndex={props.static ? -1 : 0}
            role={props.static ? undefined : "button"}
            aria-label={`${label}. ${isFlipped ? "Showing the back." : "Tap to flip."}`}
            data-ticket={t.id}
          >
            <div className="tk-inner">
              <div className="tk-face tk-front">{t.src ? <img src={t.src} alt="" draggable={false} /> : null}</div>
              {!props.static && <Back t={t} w={w} />}
            </div>
            {sel && (
              <>
                <span className="tk-ring" />
                <span className="tk-handle rotate" onPointerDown={(e) => onHandleDown(e, t.id, "rotate")} aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></svg>
                </span>
                <span className="tk-handle resize" onPointerDown={(e) => onHandleDown(e, t.id, "resize")} aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 20h6v-6M10 4H4v6M20 20 4 4" /></svg>
                </span>
              </>
            )}
          </div>
        );
      })}
      {!placements.length && props.empty && <div className="board-empty">{props.empty}</div>}
    </div>
  );
  return props.minScale ? <div ref={ref} className="board-scroll">{board}</div> : board;
}

function Back({ t, w }: { t: BoardTicket; w: number }) {
  // Type scales with the ticket so a small ticket's back still fits.
  const fs = clamp(w / 22, 8, 15);
  const route = routeLine(t.fields);
  return (
    <div className="tk-face tk-back" style={{ fontSize: fs }}>
      <div className="kicker" style={{ fontSize: fs * 0.72 }}>{t.fields.type}</div>
      {(t.fields.title || route) && <div className="route" style={{ fontSize: fs * 1.35 }}>{route || t.fields.title}</div>}
      {route && t.fields.title && <div className="meta">{t.fields.title}</div>}
      <div className="meta">{[formatDate(t.fields.date), t.fields.carrier, t.fields.seat && `Seat ${t.fields.seat}`].filter(Boolean).join(" · ")}</div>
      {t.note && <div className="tnote">{t.note}</div>}
      {t.photoSrc && <img className="photo" src={t.photoSrc} alt="" draggable={false} />}
    </div>
  );
}
