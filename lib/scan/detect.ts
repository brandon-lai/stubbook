/**
 * Finds the ticket in a photo: four corners, or null.
 *
 * No single cue works on every surface. Edges drown on wood grain; colour
 * difference fails for white paper on a white desk; saturation only helps with
 * coloured tickets. So each strategy proposes outlines, every outline is scored
 * on how much it looks like a ticket (big, four-cornered, convex, roughly
 * rectangular, not the frame itself), and the best one wins.
 */
import { withMats, type CV } from "./cv";
import { interiorAngles, orderQuad, polygonArea, type Pt, type Quad } from "./geometry";

export interface Detection {
  corners: Quad;
  score: number;
  method: string;
}

const WORK = 640;

/** src: RGBA cv.Mat of the frame. Returns corners in src pixel coordinates. */
export function detectQuad(cv: CV, src: CV, debug?: Detection[]): Detection | null {
  return withMats((keep) => {
    const k = WORK / Math.max(src.cols, src.rows);
    const small = keep(new cv.Mat());
    cv.resize(src, small, new cv.Size(Math.round(src.cols * k), Math.round(src.rows * k)), 0, 0, cv.INTER_AREA);
    const W = small.cols, H = small.rows, area = W * H;

    const rgb = keep(new cv.Mat());
    cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);
    const gray = keep(new cv.Mat());
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    // CLAHE lifts low-light frames enough for the edge pass to see the paper.
    const eq = keep(new cv.Mat());
    const clahe = keep(new cv.CLAHE(2.5, new cv.Size(8, 8)));
    clahe.apply(gray, eq);

    // Edge evidence used to vet every candidate: a real ticket outline runs along
    // strong edges for most of its length; a vignette or lighting blob does not.
    const support = keep(new cv.Mat());
    {
      const b = keep(new cv.Mat());
      cv.GaussianBlur(eq, b, new cv.Size(3, 3), 0);
      cv.Canny(b, support, 30, 90);
    }

    const binaries: [string, CV][] = [];

    // A. Edges. Canny thresholds from the median so dim and bright frames both work.
    {
      const blur = keep(new cv.Mat());
      cv.GaussianBlur(eq, blur, new cv.Size(5, 5), 0);
      const med = median(blur);
      const edges = keep(new cv.Mat());
      cv.Canny(blur, edges, Math.max(10, 0.5 * med), Math.min(255, Math.max(40, 1.2 * med)));
      const k3 = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
      cv.dilate(edges, edges, k3, new cv.Point(-1, -1), 2);
      binaries.push(["edges", edges]);
    }

    // A2. Edges after a heavy median blur. Marble veins, wood grain and fabric weave
    //     are thin; the median erases them while keeping the paper's outline and
    //     its shadow, which are long and wide.
    for (const ks of [11, 21]) {
      const mb = keep(new cv.Mat());
      cv.medianBlur(eq, mb, ks);
      const med = median(mb);
      const edges = keep(new cv.Mat());
      cv.Canny(mb, edges, Math.max(8, 0.25 * med), Math.max(24, 0.6 * med));
      const k3 = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
      cv.dilate(edges, edges, k3, new cv.Point(-1, -1), 2);
      binaries.push([`smooth-edges-${ks}`, edges]);
    }

    // B. Distance from the surface colour, sampled around the frame border.
    {
      const lab = keep(new cv.Mat());
      cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
      const bg = borderMedian(lab);
      const d = new Uint8Array(W * H);
      const L = lab.data as Uint8Array;
      for (let i = 0, j = 0; i < d.length; i++, j += 3) {
        const v = Math.abs(L[j] - bg[0]) * 0.6 + Math.abs(L[j + 1] - bg[1]) * 1.4 + Math.abs(L[j + 2] - bg[2]) * 1.4;
        d[i] = v > 255 ? 255 : v;
      }
      const dm = keep(new cv.Mat(H, W, cv.CV_8UC1));
      (dm.data as Uint8Array).set(d);
      cv.GaussianBlur(dm, dm, new cv.Size(5, 5), 0);
      const bin = keep(new cv.Mat());
      cv.threshold(dm, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      binaries.push(["colour", clean(cv, keep, bin)]);
    }

    // C. Saturation, for coloured tickets on neutral surfaces (and vice versa).
    {
      const hsv = keep(new cv.Mat());
      cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      const ch = keep(new cv.MatVector());
      cv.split(hsv, ch);
      const s = ch.get(1);
      keep(s);
      cv.GaussianBlur(s, s, new cv.Size(7, 7), 0);
      const bin = keep(new cv.Mat());
      cv.threshold(s, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      binaries.push(["saturation", clean(cv, keep, bin)]);
      const inv = keep(new cv.Mat());
      cv.bitwise_not(bin, inv);
      binaries.push(["saturation-inv", clean(cv, keep, inv)]);
    }

    // D. Brightness, both ways: light paper on a dark surface and the reverse.
    {
      const blur = keep(new cv.Mat());
      cv.GaussianBlur(eq, blur, new cv.Size(9, 9), 0);
      const bin = keep(new cv.Mat());
      cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      binaries.push(["bright", clean(cv, keep, bin)]);
      const inv = keep(new cv.Mat());
      cv.bitwise_not(bin, inv);
      binaries.push(["dark", clean(cv, keep, inv)]);
    }

    let best: Detection | null = null;
    for (const [method, bin] of binaries) {
      const contours = keep(new cv.MatVector());
      const hier = keep(new cv.Mat());
      cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        keep(c);
        const a = cv.contourArea(c);
        if (a < area * 0.05) continue;
        const hull = keep(new cv.Mat());
        cv.convexHull(c, hull, false, true);
        const q = quadFromHull(cv, keep, hull);
        if (!q) continue;
        const base = scoreQuad(q.pts, a, cv.contourArea(hull), W, H) * (q.fallback ? 0.8 : 1);
        if (base <= 0) continue;
        const r = refine(support, orderQuad(q.pts));
        const s = base * r.support ** 2;
        const cand = { corners: orderQuad(r.quad.map(([x, y]) => [x / k, y / k] as Pt)), score: s, method };
        debug?.push({ ...cand, method: `${method} base=${base.toFixed(2)} sup=${r.support.toFixed(2)}` });
        if (!best || s > best.score) best = cand;
      }
    }
    return best && best.score > 0.12 ? best : null;
  });
}

function clean(cv: CV, keep: <M extends { delete(): void }>(m: M) => M, bin: CV) {
  const kClose = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
  const kOpen = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
  cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kClose);
  cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kOpen);
  return bin;
}

/** Four corners from a convex hull: polygon simplification at increasing tolerance, else the minimum-area rectangle. */
function quadFromHull(cv: CV, keep: <M extends { delete(): void }>(m: M) => M, hull: CV): { pts: Pt[]; fallback: boolean } | null {
  const peri = cv.arcLength(hull, true);
  for (const eps of [0.015, 0.025, 0.035, 0.05, 0.07]) {
    const approx = keep(new cv.Mat());
    cv.approxPolyDP(hull, approx, eps * peri, true);
    if (approx.rows === 4) {
      const d = approx.data32S as Int32Array;
      return { pts: [[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]], fallback: false };
    }
    if (approx.rows < 4) break;
  }
  const r = cv.minAreaRect(hull);
  const pts = cv.RotatedRect.points(r) as { x: number; y: number }[];
  return { pts: pts.map((p) => [p.x, p.y] as Pt), fallback: true };
}

function scoreQuad(pts: Pt[], contourArea: number, hullArea: number, W: number, H: number) {
  const q = orderQuad(pts);
  const qa = polygonArea(q);
  const frac = qa / (W * H);
  if (frac < 0.05 || frac > 0.97) return 0;
  // The outline should fill its quad (a ticket, not an L-shaped blob) and the
  // quad should not overshoot the outline much (curled paper overshoots a bit).
  const fill = Math.min(contourArea, hullArea) / qa;
  if (fill < 0.7) return 0;
  const fit = Math.min(1, fill) * (fill > 1.12 ? 0.6 : 1);
  // Corners near 90°. Perspective skews them, so be lenient.
  const angles = interiorAngles(q);
  const worst = Math.max(...angles.map((x) => Math.abs(90 - x)));
  if (worst > 50) return 0;
  const angleScore = 1 - (worst / 50) ** 2 * 0.6;
  // A quad hugging the frame edge is usually the frame or the table, not the ticket.
  const m = 4;
  const touching = q.filter(([x, y]) => x < m || y < m || x > W - m || y > H - m).length;
  const edgePenalty = touching >= 3 ? 0.25 : touching === 2 ? 0.6 : touching === 1 ? 0.85 : 1;
  // Bigger is better, with diminishing returns past a third of the frame.
  const sizeScore = Math.min(1, Math.sqrt(frac / 0.33));
  return sizeScore * fit * angleScore * edgePenalty;
}

/**
 * Snaps each side of a rough quad onto the real paper edge: sample the edge map
 * in a band across the side, keep the edge pixel nearest the current line at
 * each sample, fit a line through them, and intersect neighbouring lines for the
 * corners. Twice, with a narrowing band. Returns the refined quad and its edge
 * support: the share of samples that found an edge within 2px of the final line.
 */
function refine(edges: CV, q: Quad): { quad: Quad; support: number } {
  const d = edges.data as Uint8Array, W = edges.cols, H = edges.rows;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && d[(y | 0) * W + (x | 0)] > 0;
  let quad = q;
  let support = 0;
  for (const R of [14, 6]) {
    const lines: { p: Pt; u: Pt }[] = [];
    let hits = 0, total = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n: Pt = [-u[1], u[0]];
      const pts: Pt[] = [];
      const steps = Math.max(10, Math.round(len / 4));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        if (t < 0.08 || t > 0.92) continue; // corners are often rounded or torn
        const cx = a[0] + (b[0] - a[0]) * t, cy = a[1] + (b[1] - a[1]) * t;
        total++;
        for (let o = 0; o <= R; o++) {
          let found: Pt | null = null;
          if (on(cx + n[0] * o, cy + n[1] * o)) found = [cx + n[0] * o, cy + n[1] * o];
          else if (o && on(cx - n[0] * o, cy - n[1] * o)) found = [cx - n[0] * o, cy - n[1] * o];
          if (found) { pts.push(found); if (o <= 2 || R < 10) hits += o <= 2 ? 1 : 0; break; }
        }
      }
      if (pts.length < 6) { lines.push({ p: a, u }); continue; }
      lines.push(fitLine(pts, u));
    }
    const next = [0, 1, 2, 3].map((i) => intersect(lines[(i + 3) % 4], lines[i]) ?? quad[i]) as Quad;
    // Reject a refinement that collapsed or flew off: keep the previous quad.
    const moved = Math.max(...next.map((p, i) => Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1])));
    if (moved < R * 2.5) quad = next;
    support = total ? hits / total : 0;
  }
  return { quad, support };
}

function fitLine(pts: Pt[], hint: Pt): { p: Pt; u: Pt } {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let u: Pt = [Math.cos(ang), Math.sin(ang)];
  if (u[0] * hint[0] + u[1] * hint[1] < 0) u = [-u[0], -u[1]];
  return { p: [mx, my], u };
}

function intersect(l1: { p: Pt; u: Pt }, l2: { p: Pt; u: Pt }): Pt | null {
  const den = l1.u[0] * l2.u[1] - l1.u[1] * l2.u[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((l2.p[0] - l1.p[0]) * l2.u[1] - (l2.p[1] - l1.p[1]) * l2.u[0]) / den;
  return [l1.p[0] + l1.u[0] * t, l1.p[1] + l1.u[1] * t];
}

function median(m: CV) {
  const d = m.data as Uint8Array;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
  let acc = 0;
  const half = d.length / 8;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= half) return v; }
  return 128;
}

function borderMedian(lab: CV): [number, number, number] {
  const W = lab.cols, H = lab.rows, d = lab.data as Uint8Array;
  const band = Math.max(4, Math.round(Math.min(W, H) * 0.04));
  const ch: number[][] = [[], [], []];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (x >= band && x < W - band && y >= band && y < H - band) continue;
    const i = (y * W + x) * 3;
    ch[0].push(d[i]); ch[1].push(d[i + 1]); ch[2].push(d[i + 2]);
  }
  return ch.map((c) => c.sort((a, b) => a - b)[c.length >> 1]) as [number, number, number];
}
