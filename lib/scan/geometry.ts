export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt];

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polygonArea(q: Pt[]) {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % q.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

/**
 * Orders four points clockwise and picks which one is "top-left" so the ticket
 * comes out the way the camera saw it: the top edge is the one pointing most
 * nearly rightward. A ticket held upright within ±45° stays upright.
 */
export function orderQuad(pts: Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const cw = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let best = 0, bestCos = -2;
  for (let s = 0; s < 4; s++) {
    const a = cw[s], b = cw[(s + 1) % 4];
    const c = (b[0] - a[0]) / (dist(a, b) || 1);
    if (c > bestCos) { bestCos = c; best = s; }
  }
  return [0, 1, 2, 3].map((i) => cw[(best + i) % 4]) as Quad;
}

export function rotateQuad(q: Quad, turns: number): Quad {
  const k = ((turns % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => q[(i + k) % 4]) as Quad;
}

export function interiorAngles(q: Quad) {
  return q.map((p, i) => {
    const a = q[(i + 3) % 4], b = q[(i + 1) % 4];
    const v1 = [a[0] - p[0], a[1] - p[1]], v2 = [b[0] - p[0], b[1] - p[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  });
}

/** Mean corner distance between two quads, as a fraction of the larger quad's diagonal. */
export function quadError(a: Quad, b: Quad) {
  const diag = Math.max(dist(a[0], a[2]), dist(b[0], b[2]));
  return a.reduce((s, p, i) => s + dist(p, b[i]), 0) / 4 / diag;
}

/** Intersection over union of two convex quads, by rasterising onto a coarse grid. */
export function quadIoU(a: Quad, b: Quad, n = 200) {
  const xs = [...a, ...b].map((p) => p[0]), ys = [...a, ...b].map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const inside = (q: Quad, x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4];
      const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (c !== 0) { if (sign && Math.sign(c) !== sign) return false; sign = Math.sign(c); }
    }
    return true;
  };
  let inter = 0, uni = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0), y = y0 + ((j + 0.5) / n) * (y1 - y0);
    const ia = inside(a, x, y), ib = inside(b, x, y);
    if (ia && ib) inter++;
    if (ia || ib) uni++;
  }
  return uni ? inter / uni : 0;
}
