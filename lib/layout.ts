/**
 * Where tickets go on the collage. Pure functions over placements, so the same
 * code places tickets on the owner's device and lays out the read-only share.
 *
 * The collage is a fixed-width board (BOARD_W units) that grows downward. Each
 * placement stores the ticket's centre, rotation in degrees, a scale, and its
 * layer order; a ticket's unscaled width on the board is BASE_W.
 */
export const BOARD_W = 1000;
export const BASE_W = 300;

export interface Placement {
  ticketId: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  z: number;
}

export interface Sized {
  ticketId: string;
  /** Cut-out aspect ratio, height / width. */
  aspect: number;
  /** For arrange-by-date. ISO date or "". */
  date?: string;
}

export function sizeOf(p: Placement, aspect: number) {
  const w = BASE_W * p.scale;
  return { w, h: w * aspect };
}

/** Axis-aligned bounds of a rotated placement. */
export function bounds(p: Placement, aspect: number) {
  const { w, h } = sizeOf(p, aspect);
  const r = (p.rotation * Math.PI) / 180;
  const bw = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r));
  const bh = Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r));
  return { x0: p.x - bw / 2, y0: p.y - bh / 2, x1: p.x + bw / 2, y1: p.y + bh / 2 };
}

export function boardHeight(ps: Placement[], aspects: Map<string, number>, min = 700) {
  let h = min;
  for (const p of ps) h = Math.max(h, bounds(p, aspects.get(p.ticketId) ?? 0.4).y1 + 60);
  return Math.ceil(h);
}

/** Seeded PRNG (mulberry32) so a layout is reproducible from its ticket ids. */
export function rng(seed: string) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (Math.imul(31, a) + seed.charCodeAt(i)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const overlapArea = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/**
 * Auto-place: the open spot that overlaps existing tickets least, with a slight
 * random tilt. Candidates are scanned top-down so the board fills from the top;
 * ties go to the higher spot. Touching or barely overlapping is allowed (that is
 * what makes a collage look hand-made); covering more than 12% of another ticket
 * is not, unless the board has no such spot, in which case it grows downward.
 */
export function autoPlace(existing: Placement[], aspects: Map<string, number>, item: Sized, seed = item.ticketId): Placement {
  const r = rng(seed);
  const rotation = Math.round((r() * 2 - 1) * 7 * 10) / 10 || 1.5;
  const scale = item.aspect > 1.2 ? 0.72 : 1; // tall tickets (museum cards, phone passes) a little smaller
  const z = existing.reduce((m, p) => Math.max(m, p.z), 0) + 1;
  const others = existing.map((p) => ({ p, b: bounds(p, aspects.get(p.ticketId) ?? 0.4) }));
  const probe = (x: number, y: number) => ({ ticketId: item.ticketId, x, y, rotation, scale, z });
  const bottom = others.reduce((m, o) => Math.max(m, o.b.y1), 0);
  let best: Placement | null = null, bestCost = Infinity;
  const step = 36;
  for (let y = 40; y <= bottom + 400; y += step) {
    for (let x = 40; x <= BOARD_W - 40; x += step) {
      const p = probe(x + (r() - 0.5) * 14, y + (r() - 0.5) * 14);
      const b = bounds(p, item.aspect);
      if (b.x0 < 12 || b.x1 > BOARD_W - 12 || b.y0 < 12) continue;
      const area = (b.x1 - b.x0) * (b.y1 - b.y0);
      let worst = 0, total = 0;
      for (const o of others) {
        const ov = overlapArea(b, o.b);
        total += ov;
        worst = Math.max(worst, ov / Math.min(area, (o.b.x1 - o.b.x0) * (o.b.y1 - o.b.y0)));
      }
      if (worst > 0.12) continue;
      // Prefer high on the board and close to (but not on top of) neighbours.
      const cost = y * 1.0 + total * 0.002 + Math.abs(x - BOARD_W / 2) * 0.05;
      if (cost < bestCost) { bestCost = cost; best = p; }
    }
    if (best && y > best.y + 200) break;
  }
  return best ?? probe(BOARD_W / 2, bottom + 40 + (BASE_W * scale * item.aspect) / 2);
}

export type ArrangeMode = "date" | "scatter" | "grid";

/** Re-lays out every ticket. The user can move anything afterwards. */
export function arrange(mode: ArrangeMode, items: Sized[], seed = "arrange"): Placement[] {
  const aspects = new Map(items.map((i) => [i.ticketId, i.aspect]));
  if (mode === "scatter") {
    const r = rng(seed);
    const order = [...items].sort(() => r() - 0.5);
    const out: Placement[] = [];
    for (const it of order) out.push(autoPlace(out, aspects, it, `${seed}:${it.ticketId}`));
    return out;
  }
  // Grid and by-date share a row packer: rows of tickets scaled to a common height.
  const sorted = mode === "date"
    ? [...items].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.ticketId.localeCompare(b.ticketId))
    : items;
  const gap = 28, margin = 36, rowH = 150;
  const out: Placement[] = [];
  let x = margin, y = margin, row: Placement[] = [];
  const flush = () => {
    // Centre the finished row.
    const used = x - gap - margin, slack = BOARD_W - 2 * margin - used;
    for (const p of row) p.x += slack / 2;
    row = [];
  };
  sorted.forEach((it, i) => {
    const h = Math.min(rowH, it.aspect > 1.2 ? rowH * 1.6 : rowH);
    const scale = h / it.aspect / BASE_W;
    const w = BASE_W * scale;
    if (x + w > BOARD_W - margin && row.length) { flush(); x = margin; y += rowH + gap; }
    const p: Placement = { ticketId: it.ticketId, x: x + w / 2, y: y + h / 2, rotation: mode === "date" ? (i % 2 ? 1.2 : -1.2) : 0, scale: Math.min(scale, 1.3), z: i + 1 };
    out.push(p);
    row.push(p);
    x += w + gap;
  });
  flush();
  // Rows can hold one tall ticket; re-run vertical spacing on the actual heights.
  return relaxRows(out, aspects, gap, margin);
}

function relaxRows(ps: Placement[], aspects: Map<string, number>, gap: number, margin: number) {
  const rows = new Map<number, Placement[]>();
  for (const p of ps) {
    const key = Math.round(p.y);
    const arr = rows.get(key) ?? [];
    arr.push(p);
    rows.set(key, arr);
  }
  let y = margin;
  for (const [, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const h = Math.max(...row.map((p) => sizeOf(p, aspects.get(p.ticketId) ?? 0.4).h));
    for (const p of row) p.y = y + h / 2;
    y += h + gap;
  }
  return ps;
}
